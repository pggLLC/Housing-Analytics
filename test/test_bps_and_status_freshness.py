#!/usr/bin/env python3
"""
Guards for the two defects the QCEW repair run exposed in
scripts/build_co_housing_costs_insight.py.

1. Census BPS permits fetched nothing. BPS_BASE_URL pointed at
   www.census.gov/construction/bps/csv/co{year}a.csv -- a path that 404s for
   every year -- and the pipeline requested it with a two-digit year on top
   of that, producing `co24a.csv`. The committed permits parquet was therefore
   placeholder data, not Census figures: against the real 2024 file, Denver
   read 10,041 units where Census reports 3,994.

2. `maps_complete` was computed from Path.exists(). When BPS died its map was
   simply not regenerated, and the file left over from an earlier run kept
   satisfying that check -- so the status file reported every map complete,
   and the article page suppressed its own warning banner, while showing a
   map built from placeholder data.

Fixtures are hand-built from the published BPS column layout; they do not
reuse the parser under test.
"""
import csv
import importlib.util
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_co_housing_costs_insight.py"

try:
    import pandas  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - environment guard
    sys.exit(
        "test_bps_and_status_freshness requires pandas (pip install pandas) — "
        "refusing to report a pass it did not earn"
    )

failures = []


def check(condition, message):
    print(f"  {'✓' if condition else '✗'} {message}")
    if not condition:
        failures.append(message)


spec = importlib.util.spec_from_file_location("co_housing_costs", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["co_housing_costs"] = mod
spec.loader.exec_module(mod)
cfg = mod.Config()

print("\nbps-and-status-freshness")

# ── 1. The dead Census path must not come back ──────────────────────────────
print("\n  BPS source selection")
check("www2.census.gov/econ/bps/County" in cfg.BPS_BASE_URL,
      "BPS_BASE_URL points at the live www2 County directory")
check("construction/bps/csv" not in cfg.BPS_BASE_URL,
      "the 404ing construction/bps/csv path is gone")
check(cfg.BPS_BASE_URL.format(year=2024).endswith("co2024a.txt"),
      "the year token renders four digits, not two (the old code built co24a)")

# ── 2. Units are summed across groups, and "rep" columns are excluded ───────
# Real layout: Date, State, County, Region, Division, Name, then
# (Bldgs, Units, Value) for 1-unit / 2-units / 3-4 units / 5+ units, then the
# same four groups repeated as "rep" revisions.
HEADER_1 = ("Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,"
            "3-4 units,,,5+ units,,,1-unit rep,,,2-units rep,,,3-4 units rep,,, 5+units rep")
HEADER_2 = ("Date,State,County,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,"
            "Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,"
            "Bldgs,Units,Value,Bldgs,Units,Value")


def row(state, county, u1, u2, u34, u5, rep=9999):
    # Values differ from Units so a Value/Units mix-up cannot pass; the four
    # "rep" groups are filled with a sentinel that must never be summed.
    return (f"2024,{state},{county},8,7,Test County         ,"
            f"1,{u1},111,2,{u2},222,3,{u34},333,4,{u5},444,"
            f"1,{rep},111,2,{rep},222,3,{rep},333,4,{rep},444")


fixture = "\n".join([
    HEADER_1, HEADER_2, "",
    row("08", "001", 100, 10, 8, 500),     # Colorado -> 618
    row("08", "031", 7, 0, 0, 3),          # Colorado -> 10
    row("35", "001", 1000, 0, 0, 0),       # New Mexico -> excluded
])

parsed = mod._parse_bps_county_file(fixture, "08")
by_fips = {r["county_fips"]: r for r in parsed}

print("\n  BPS parsing")
check(sorted(by_fips) == ["08001", "08031"],
      "keeps only the requested state's counties")
check(by_fips.get("08001", {}).get("total_units") == 618,
      f"sums Units across all four structure-size groups "
      f"(expected 618, got {by_fips.get('08001', {}).get('total_units')})")
check(all(r["total_units"] < 9999 for r in parsed),
      "the repeated 'rep' groups are excluded — including them would double counts")
check(by_fips.get("08001", {}).get("bps_year") == 2024,
      "takes the year from the survey-date column")
check(set(parsed[0]) == set(mod.BPS_OUTPUT_COLUMNS),
      f"emits the documented schema {mod.BPS_OUTPUT_COLUMNS}")

# ── 3. A reordered header must be refused, not silently mis-summed ──────────
# Positional indices would otherwise keep summing whatever now sits there.
print("\n  BPS schema drift")
shuffled = "\n".join([
    HEADER_1,
    HEADER_2.replace("Bldgs,Units,Value", "Units,Bldgs,Value"),
    "",
    row("08", "001", 100, 10, 8, 500),
])
check(mod._parse_bps_county_file(shuffled, "08") == [],
      "a sub-header that no longer puts Units where expected yields no rows")
check(mod._parse_bps_county_file("not,a,bps,file\n1,2,3", "08") == [],
      "unrelated CSV content yields no rows")

# ── 4. A left-behind map must not count as complete ─────────────────────────
print("\n  status freshness")
import tempfile
tmp = pathlib.Path(tempfile.mkdtemp())
maps, snaps = tmp / "maps", tmp / "snaps"
maps.mkdir(); snaps.mkdir()
mod.ASSETS_MAPS, mod.ASSETS_SNAPSHOTS = maps, snaps

EXPECTED = [
    "co_county_median_rent_latest.html", "co_county_rent_burden_30_latest.html",
    "co_county_vacancy_latest.html", "co_county_rent_change_10y_win.html",
    "co_county_rent_change_15y_win.html", "co_county_fhfa_hpi_change_10y.html",
    "co_county_construction_wages.html", "co_county_permits_per_capita.html",
]

# Every map on disk, but the permits map predates the run — exactly the state
# that reported maps_complete: true while showing placeholder data.
old_time = time.time() - 86400
for name in EXPECTED:
    (maps / name).write_text("<html></html>")
(snaps / "drivers_ranking.csv").write_text("feature,coefficient,source\n")
run_started = time.time()
import os
os.utime(maps / "co_county_permits_per_capita.html", (old_time, old_time))

mod._validate_outputs_and_write_status({"bps": {"status": "empty", "rows": 0}},
                                       run_started=run_started)
import json
status = json.loads((snaps / "pipeline-status.json").read_text())

check(status["maps_complete"] is False,
      "a map left over from an earlier run makes maps_complete false")
check(status["stale_maps"] == ["co_county_permits_per_capita.html"],
      f"the stale map is named, not just counted (saw {status['stale_maps']})")
check(status["missing_maps"] == [],
      "a stale map is reported as stale, not as missing — they are different faults")
check(status["maps_generated"] == 7,
      f"maps_generated counts only what this run wrote (saw {status['maps_generated']})")

# All maps rewritten -> complete again, so the guard is not simply always-false.
for name in EXPECTED:
    (maps / name).write_text("<html>fresh</html>")
(snaps / "drivers_ranking.csv").write_text("feature,coefficient,source\nx,1,y\n")
mod._validate_outputs_and_write_status({}, run_started=run_started)
status2 = json.loads((snaps / "pipeline-status.json").read_text())
check(status2["maps_complete"] is True and status2["stale_maps"] == [],
      "a run that rewrites every map reports complete with no stale entries")
check(status2["maps_generated"] == 8, "all eight count as generated when fresh")

# ── 5. The public snapshot must carry one cohort, not three ────────────────
# fetch_acs_county builds 2009/2014/2024 cohorts. Writing all three to a file
# named `_latest` gives three rows per county, and every consumer keys it by
# county_fips alone -- build_article_indicator_geojson.mjs indexed last-wins,
# so the 2009 rows won and the choropleth rendered 2009 rents as current.
print("\n  ACS snapshot cohort")
import pandas as pd

mod.ASSETS_SNAPSHOTS = snaps
frame = pd.DataFrame([
    {"county_fips": "08001", "county_name": "Adams", "acs_year": y,
     "median_gross_rent": rent, "median_hh_income": 1, "vacancy_rate": 0.1,
     "rent_burden_30_plus": 0.5}
    for y, rent in ((2024, 1781), (2014, 1100), (2009, 869))
] + [
    {"county_fips": "08031", "county_name": "Denver", "acs_year": y,
     "median_gross_rent": rent, "median_hh_income": 1, "vacancy_rate": 0.1,
     "rent_burden_30_plus": 0.5}
    for y, rent in ((2024, 1700), (2014, 1000), (2009, 800))
])
mod._save_acs_snapshot(frame)
snap_rows = list(csv.DictReader((snaps / "acs_county_latest.csv").open()))

check(len(snap_rows) == 2,
      f"one row per county, not one per cohort (saw {len(snap_rows)})")
check({r["acs_year"] for r in snap_rows} == {"2024"},
      f"only the newest cohort is written (saw {sorted({r['acs_year'] for r in snap_rows})})")
check(next(r["median_gross_rent"] for r in snap_rows if r["county_fips"] == "08001") == "1781",
      "the surviving Adams row is the 2024 rent, not the 2009 one")

# The renderer must also defend itself, in case a producer regresses.
geojson_builder = (ROOT / "scripts" / "build_article_indicator_geojson.mjs").read_text()
check("byFips[fips] = r;\n  }" not in geojson_builder,
      "the GeoJSON builder no longer indexes rows with a bare last-wins assignment")
check("prevYear" in geojson_builder,
      "the GeoJSON builder compares acs_year when a county appears more than once")

print()
if failures:
    print(f"FAIL — {len(failures)} assertion(s) failed")
    sys.exit(1)
print("PASS — BPS parsing and status-freshness guards hold")
