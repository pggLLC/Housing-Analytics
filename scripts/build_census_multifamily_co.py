#!/usr/bin/env python3
"""
scripts/build_census_multifamily_co.py
=======================================
Build the Colorado multifamily-share snapshot consumed by census-dashboard.html.

The page used to call api.census.gov directly from the browser. In 2026 the
Census API began returning a 302 redirect to /missing_key.html for any
unauthenticated request, which the browser surfaces as a generic
"TypeError: Failed to fetch" because the cross-origin redirect is blocked by
CORS. This script captures the same DP04 fields at CI build time so the page
reads a cached JSON file and never has to call the API from the user's
browser.

Modes:
  * Live API mode    — when CENSUS_API_KEY is set in the env, fetches DP04
                       directly from the Census API (preferred in CI).
  * Derive-from-cache mode — when no key is set, derives the same record
                       shape from existing data/hna/summary/*.json files,
                       which already contain DP04 fields cached by the HNA
                       ETL pipeline. Used for local builds and as a
                       graceful fallback.

Output:
  data/census-multifamily-co.json

Fields per record:
  level       — "state" | "county" | "place"
  geoid       — full GEOID (02 / 05 / 07 digits)
  name        — Census label
  totalHU     — DP04_0001E total housing units
  pct_5_9     — % of HU in 5-9-unit structures
  pct_10_19   — % of HU in 10-19-unit structures
  pct_20p     — % of HU in 20+-unit structures
  pct_mf      — combined multifamily share (5+ units)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, List, Dict

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "census-multifamily-co.json"
HNA_SUMMARY_DIR = REPO_ROOT / "data" / "hna" / "summary"
PLACE_CENTROIDS_PATH = REPO_ROOT / "data" / "co-place-centroids.json"

ACS_YEAR_DEFAULT = 2023  # ACS 5-year 2019–2023 release
CO_FIPS = "08"

# DP04 fields — using the *current* (post-2018) variable layout:
#   DP04_0001E  Total housing units
#   DP04_0007E  1-unit detached     (count)
#   DP04_0008E  1-unit attached
#   DP04_0009E  2 units
#   DP04_0010E  3-4 units
#   DP04_0011E  5-9 units           ← 5+ unit threshold starts here
#   DP04_0012E  10-19 units
#   DP04_0013E  20+ units
#   DP04_0014E  Mobile home
# The Live API mode pulls the *PE percent estimates; derive mode computes
# percents from the count fields cached in HNA summaries.
LIVE_VARS = {
    "totalHU": "DP04_0001E",
    "pct_5_9": "DP04_0011PE",
    "pct_10_19": "DP04_0012PE",
    "pct_20p": "DP04_0013PE",
}
COUNT_FIELDS_NEW = ("DP04_0011E", "DP04_0012E", "DP04_0013E")  # places + counties

SLEEP_BETWEEN_CALLS = 0.4
MAX_RETRIES = 3


def _log(msg: str) -> None:
    print(msg, flush=True)


# ──────────────────────────────────────────────────────────────────────────
# Live Census API mode
# ──────────────────────────────────────────────────────────────────────────


def _fetch(url: str, retries: int = MAX_RETRIES) -> list:
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "COHO-Analytics/1.0 (+census-multifamily build)"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 204:
                    return []
                body = resp.read().decode("utf-8").strip()
                if not body:
                    return []
                return json.loads(body)
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
            last_err = e
            _log(f"  attempt {attempt}/{retries} failed for {url[:90]}…: {e}")
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"Census API fetch failed after {retries} attempts: {last_err}")


def _build_url(acs_year: int, get_fields: list, where: str, within: str, api_key: str) -> str:
    base = f"https://api.census.gov/data/{acs_year}/acs/acs5/profile"
    params = {
        "get": ",".join(get_fields),
        "for": where,
        "key": api_key,
    }
    if within:
        params["in"] = within
    return f"{base}?{urllib.parse.urlencode(params, safe=':*,')}"


def _parse_live_rows(raw: list, level: str) -> list:
    if not raw or len(raw) < 2:
        return []
    header = raw[0]
    idx = {h: i for i, h in enumerate(header)}
    records = []
    for row in raw[1:]:
        rec = {
            "level": level,
            "name": row[idx["NAME"]],
            "totalHU": _safe_int(row[idx[LIVE_VARS["totalHU"]]]),
            "pct_5_9": _safe_float(row[idx[LIVE_VARS["pct_5_9"]]]),
            "pct_10_19": _safe_float(row[idx[LIVE_VARS["pct_10_19"]]]),
            "pct_20p": _safe_float(row[idx[LIVE_VARS["pct_20p"]]]),
        }
        if level == "state":
            rec["geoid"] = row[idx["state"]]
        elif level == "county":
            rec["geoid"] = row[idx["state"]] + row[idx["county"]]
        elif level == "place":
            rec["geoid"] = row[idx["state"]] + row[idx["place"]]
        rec["pct_mf"] = _sum_pct(rec.get("pct_5_9"), rec.get("pct_10_19"), rec.get("pct_20p"))
        records.append(rec)
    return records


def fetch_live_state(acs_year: int, api_key: str) -> list:
    fields = ["NAME"] + list(LIVE_VARS.values())
    url = _build_url(acs_year, fields, f"state:{CO_FIPS}", "", api_key)
    return _parse_live_rows(_fetch(url), "state")


def fetch_live_counties(acs_year: int, api_key: str) -> list:
    fields = ["NAME"] + list(LIVE_VARS.values())
    url = _build_url(acs_year, fields, "county:*", f"state:{CO_FIPS}", api_key)
    return _parse_live_rows(_fetch(url), "county")


def fetch_live_places(acs_year: int, api_key: str) -> list:
    fields = ["NAME"] + list(LIVE_VARS.values())
    url = _build_url(acs_year, fields, "place:*", f"state:{CO_FIPS}", api_key)
    return _parse_live_rows(_fetch(url), "place")


# ──────────────────────────────────────────────────────────────────────────
# Derive-from-HNA-cache mode
# ──────────────────────────────────────────────────────────────────────────


def _safe_int(v):
    try:
        n = int(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        try:
            n = float(v)
            return int(n) if n >= 0 else None
        except (TypeError, ValueError):
            return None


def _safe_float(v):
    try:
        n = float(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _sum_pct(*values) -> Optional[float]:
    vals = [v for v in values if isinstance(v, (int, float))]
    return round(sum(vals), 1) if vals else None


def _load_centroid_names() -> dict:
    """Return {geoid: name} from data/co-place-centroids.json."""
    try:
        payload = json.loads(PLACE_CENTROIDS_PATH.read_text())
        return {g: rec.get("name", "") for g, rec in payload.get("byGeoid", {}).items()}
    except Exception:
        return {}


# ── DP04 variable-index maps ───────────────────────────────────────────────
# Counties + places use the *current* (post-2018) DP04 layout. The statewide
# 08.json HNA summary file uses an older Census API release that shifted four
# occupancy rows ahead of "Units in structure", so DP04_0007E means "5-9 units"
# at the state level vs "1-unit detached" at the place level.
COUNTY_PLACE_STRUCTURE = {
    "1_detached": "DP04_0007E",
    "1_attached": "DP04_0008E",
    "2_units":    "DP04_0009E",
    "3_4_units":  "DP04_0010E",
    "5_9":        "DP04_0011E",
    "10_19":      "DP04_0012E",
    "20p":        "DP04_0013E",
    "mobile":     "DP04_0014E",
}
STATE_STRUCTURE = {
    "1_detached": "DP04_0003E",
    "1_attached": "DP04_0004E",
    "2_units":    "DP04_0005E",
    "3_4_units":  "DP04_0006E",
    "5_9":        "DP04_0007E",
    "10_19":      "DP04_0008E",
    "20p":        "DP04_0009E",
    "mobile":     "DP04_0010E",
}
# Year-built distribution (10 cells in DP04_0017E–0026E for places/counties).
YEAR_BUILT_FIELDS = [
    ("built_2020_later", "DP04_0017E"),
    ("built_2010_2019",  "DP04_0018E"),
    ("built_2000_2009",  "DP04_0019E"),
    ("built_1990_1999",  "DP04_0020E"),
    ("built_1980_1989",  "DP04_0021E"),
    ("built_1970_1979",  "DP04_0022E"),
    ("built_1960_1969",  "DP04_0023E"),
    ("built_1950_1959",  "DP04_0024E"),
    ("built_1940_1949",  "DP04_0025E"),
    ("built_1939_earlier", "DP04_0026E"),
]


def derive_record(summary: dict) -> Optional[dict]:
    """Convert one HNA summary file into a comprehensive multifamily record."""
    geo = summary.get("geo") or {}
    profile = summary.get("acsProfile") or {}

    geoid = geo.get("geoid") or ""
    if not geoid:
        return None

    if geoid == "08":
        level = "state"
        struct_map = STATE_STRUCTURE
    elif len(geoid) == 5:
        level = "county"
        struct_map = COUNTY_PLACE_STRUCTURE
    elif len(geoid) == 7:
        level = "place"
        struct_map = COUNTY_PLACE_STRUCTURE
    else:
        return None

    totalHU = _safe_int(profile.get("DP04_0001E"))
    if not totalHU or totalHU <= 0:
        return None

    # Structure counts + shares
    counts = {}
    pcts = {}
    for label, var in struct_map.items():
        c = _safe_int(profile.get(var))
        counts[label] = c
        pcts[label] = round(c / totalHU * 100, 1) if isinstance(c, int) else None

    pct_mf = _sum_pct(pcts.get("5_9"), pcts.get("10_19"), pcts.get("20p"))

    # Year-built (counties/places only — state summary doesn't carry these)
    year_built = {}
    if level != "state":
        for label, var in YEAR_BUILT_FIELDS:
            year_built[label] = _safe_int(profile.get(var))

    # Tenure + rent
    pct_renter = _safe_float(profile.get("DP04_0047PE"))
    pct_owner = _safe_float(profile.get("DP04_0046PE"))
    renter_hh = _safe_int(profile.get("DP04_0047E"))
    median_rent = _safe_int(profile.get("DP04_0134E"))
    median_home_value = _safe_int(profile.get("DP04_0089E"))

    # Rent burden distribution (GRAPI %): DP04_0137-0142PE
    rent_burden = {
        "less_15":    _safe_float(profile.get("DP04_0137PE")),
        "15_19":      _safe_float(profile.get("DP04_0138PE")),
        "20_24":      _safe_float(profile.get("DP04_0139PE")),
        "25_29":      _safe_float(profile.get("DP04_0140PE")),
        "30_34":      _safe_float(profile.get("DP04_0141PE")),
        "35_plus":    _safe_float(profile.get("DP04_0142PE")),
    }
    # Cost-burdened (≥30% of income on rent) = sum of 30-34 + 35+ bands.
    pct_burdened = _sum_pct(rent_burden.get("30_34"), rent_burden.get("35_plus"))

    record = {
        "level": level,
        "geoid": geoid,
        "name": geo.get("label") or profile.get("NAME") or "",
        "totalHU": totalHU,
        # Legacy compact fields (kept for backward compatibility with the page).
        "pct_5_9": pcts.get("5_9"),
        "pct_10_19": pcts.get("10_19"),
        "pct_20p": pcts.get("20p"),
        "pct_mf": pct_mf,
        # Expanded structure breakdown
        "structure_pct": pcts,
        "structure_count": counts,
        # Tenure + rent + cost burden
        "pct_renter": pct_renter,
        "pct_owner": pct_owner,
        "renter_households": renter_hh,
        "median_gross_rent": median_rent,
        "median_home_value": median_home_value,
        "rent_burden_dist": {k: v for k, v in rent_burden.items() if v is not None},
        "pct_renter_cost_burdened": pct_burdened,
        # Year-built distribution (empty dict for state)
        "year_built": {k: v for k, v in year_built.items() if v is not None},
    }
    return record


def derive_all() -> Tuple[List[dict], List[dict], List[dict]]:
    """Walk data/hna/summary/ and split records into (state, counties, places)."""
    state_records = []
    county_records = []
    place_records = []
    centroid_names = _load_centroid_names()

    if not HNA_SUMMARY_DIR.exists():
        _log(f"ERROR: HNA summary directory missing: {HNA_SUMMARY_DIR}")
        return [], [], []

    for path in sorted(HNA_SUMMARY_DIR.glob("*.json")):
        try:
            summary = json.loads(path.read_text())
        except Exception:
            continue
        rec = derive_record(summary)
        if not rec:
            continue
        # If HNA didn't carry a usable name, fall back to Gazetteer centroid name.
        if not rec["name"]:
            rec["name"] = centroid_names.get(rec["geoid"], rec["geoid"])
        # Cosmetic: append ", Colorado" to align with live-API NAME field.
        if rec["level"] == "state":
            rec["name"] = "Colorado"
        elif rec["level"] == "county" and ", Colorado" not in rec["name"]:
            rec["name"] = f"{rec['name']}, Colorado"
        elif rec["level"] == "place" and ", Colorado" not in rec["name"]:
            rec["name"] = f"{rec['name']}, Colorado"

        if rec["level"] == "state":
            state_records.append(rec)
        elif rec["level"] == "county":
            county_records.append(rec)
        elif rec["level"] == "place":
            place_records.append(rec)

    return state_records, county_records, place_records


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Build CO multifamily snapshot")
    parser.add_argument("--acs-year", type=int, default=ACS_YEAR_DEFAULT)
    parser.add_argument(
        "--mode",
        choices=("auto", "live", "derive"),
        default="auto",
        help="auto (use live if key set, else derive); live (require key); derive (HNA cache)",
    )
    args = parser.parse_args()

    api_key = (os.environ.get("CENSUS_API_KEY") or "").strip()
    mode = args.mode
    if mode == "auto":
        mode = "live" if api_key else "derive"

    if mode == "live" and not api_key:
        _log("ERROR: --mode live requires CENSUS_API_KEY env var.")
        return 1

    if mode == "live":
        _log(f"Building CO multifamily snapshot via live Census API (ACS {args.acs_year} 5-year)…")
        state_rows = fetch_live_state(args.acs_year, api_key)
        _log(f"  state    : {len(state_rows)} record(s)")
        time.sleep(SLEEP_BETWEEN_CALLS)
        county_rows = fetch_live_counties(args.acs_year, api_key)
        _log(f"  counties : {len(county_rows)} record(s)")
        time.sleep(SLEEP_BETWEEN_CALLS)
        place_rows = fetch_live_places(args.acs_year, api_key)
        _log(f"  places   : {len(place_rows)} record(s)")
        if not state_rows or not county_rows:
            _log("ERROR: live fetch returned empty state/county data; existing snapshot preserved.")
            return 1
        source_label = f"U.S. Census Bureau ACS {args.acs_year} 5-year DP04 (live API)"
    else:
        _log("Building CO multifamily snapshot from HNA summary cache (derive mode)…")
        state_rows, county_rows, place_rows = derive_all()
        _log(f"  state    : {len(state_rows)} record(s)")
        _log(f"  counties : {len(county_rows)} record(s)")
        _log(f"  places   : {len(place_rows)} record(s)")
        if not state_rows or not county_rows or len(place_rows) < 100:
            _log("ERROR: derive mode produced insufficient records; existing snapshot preserved.")
            return 1
        source_label = "Derived from cached HNA ACS profile records (DP04 counts → shares)"

    payload = {
        "meta": {
            "source": source_label,
            "dataset": "DP04 (units in structure)",
            "variables": {
                "totalHU": "DP04_0001E (total housing units)",
                "pct_5_9": "DP04_0011* share of HU in 5–9 unit structures",
                "pct_10_19": "DP04_0012* share of HU in 10–19 unit structures",
                "pct_20p": "DP04_0013* share of HU in 20+ unit structures",
                "pct_mf": "sum of 5–9, 10–19, 20+ shares (5+ unit multifamily)",
            },
            "pulled_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "geography_scope": "Colorado: state + all counties + all places",
            "acs_year": args.acs_year,
            "mode": mode,
            "notes": (
                "Snapshot used by census-dashboard.html. The page no longer calls "
                "api.census.gov from the browser because unauthenticated requests "
                "now redirect to /missing_key.html (blocked by CORS)."
            ),
        },
        "state": sorted(state_rows, key=lambda r: r["name"]),
        "counties": sorted(county_rows, key=lambda r: r["name"]),
        "places": sorted(place_rows, key=lambda r: r["name"]),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    _log(f"OK  wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
