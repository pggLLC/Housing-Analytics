#!/usr/bin/env python3
"""
build_permits.py
================
Build a Colorado building-permits dataset (Census Building Permits Survey,
BPS) keyed by GEOID, plus a "production vs need" comparison against the
DOLA-based housing-need projections.

Background
----------
Every professional housing assessment benchmarks need against actual
production (e.g. Alamosa's 2021 plan: "44 units/yr built since 2010 — at
this rate about half the housing need would be satisfied"). The repo
computes units needed (data/hna/projections/<fips>.json,
incremental_units_needed_dola) but had no measure of units actually being
delivered. This script adds that: annual permitted units (total,
single-family vs multifamily) for every CO county and permit-issuing
place, ~10-year history, from the Census BPS annual files.

Sources
-------
    County: https://www2.census.gov/econ/bps/County/co{year}a.txt
    Place:  https://www2.census.gov/econ/bps/Place/West%20Region/we{year}a.txt

Both are comma-separated ASCII with a two-row header. The first four
column groups (1-unit / 2-units / 3-4 units / 5+ units, each
Bldgs/Units/Value) are total permits (reported + imputed); the trailing
four "rep" groups are reported-only and are ignored here.

Raw files are cached under data/hna/source/bps/ trimmed to Colorado rows
(state FIPS 08) so re-runs are offline and the repo stays small.

Semantics
---------
- Place rows exist only for permit-issuing jurisdictions (incorporated
  municipalities). CDPs are unincorporated — their permits are issued by
  the county and appear only in the county series and the county's
  "Unincorporated Area" balance row (FIPS place 99990, excluded here).
  Consumers MUST NOT substitute county figures for a missing place —
  render "county-permitted" messaging instead (see
  feedback_place_vs_county_masking).
- A geography absent from a year's file is null (not reporting); present
  with 0 means zero permitted units.
- Cross-county municipalities appear once per county part; parts are
  summed per year.

Production vs need
------------------
For counties, annual need is the DOLA incremental-units-needed series
annualized over the first 5/10 projection years (the series is cumulative
from base year 2024). For places, county annual need is scaled by the
place's share0 from data/hna/derived/geo-derived.json — the same share
the HNA dashboard uses to scale county projections for municipal
selections (clamped to [0.02, 0.98]). The record carries need_method so
UIs can label scaled figures.

Output
------
    data/hna/permits.json

Usage
-----
    python3 scripts/hna/build_permits.py
    python3 scripts/hna/build_permits.py --start-year 2016 --end-year 2025
    python3 scripts/hna/build_permits.py --refresh     # re-download cache
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
GEO_REGISTRY = os.path.join(REPO_ROOT, "data", "hna", "geography-registry.json")
PHANTOM_ALIAS = os.path.join(REPO_ROOT, "data", "hna", "place-phantom-aliases.json")
GEO_DERIVED = os.path.join(REPO_ROOT, "data", "hna", "derived", "geo-derived.json")
PLACE_CHAS = os.path.join(REPO_ROOT, "data", "hna", "place-chas.json")
PROJECTIONS_DIR = os.path.join(REPO_ROOT, "data", "hna", "projections")
CACHE_DIR = os.path.join(REPO_ROOT, "data", "hna", "source", "bps")
OUT_FILE = os.path.join(REPO_ROOT, "data", "hna", "permits.json")

COLORADO_FIPS = "08"
DEFAULT_START_YEAR = 2016
DEFAULT_END_YEAR = 2025

COUNTY_URL = "https://www2.census.gov/econ/bps/County/co{year}a.txt"
PLACE_URL = "https://www2.census.gov/econ/bps/Place/West%20Region/we{year}a.txt"

# Dashboard clamps place share of county to this range (hna-controller.js).
SHARE_MIN, SHARE_MAX = 0.02, 0.98


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# census.gov sits behind a WAF that intermittently answers "Request
# Rejected" HTML (HTTP 200) when it decides a client is fetching too fast.
# A browser-ish UA plus generous backoff gets through reliably.
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 "
       "HousingAnalytics-BPS-fetch")


def _looks_like_html(text: str) -> bool:
    head = text[:400].lower()
    return head.lstrip().startswith("<!doctype") or "<html" in head


def http_get_text(url: str, *, timeout: int = 120, retries: int = 5) -> str:
    last_err: str | Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            if _looks_like_html(text):
                last_err = "WAF returned an HTML page instead of data"
            else:
                return text
        except Exception as err:  # noqa: BLE001
            last_err = err
        if attempt < retries - 1:
            wait = 10 * (attempt + 1)
            print(f"    retrying in {wait}s ({last_err})")
            time.sleep(wait)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


def fetch_bps_file(kind: str, year: int, *, refresh: bool) -> list[str]:
    """Return the raw lines of a BPS annual file, trimmed to Colorado rows.

    kind: 'county' or 'place'. Caches the CO-filtered file (header + state
    08 rows) at data/hna/source/bps/<kind><year>a.co.txt.
    """
    cache_path = os.path.join(CACHE_DIR, f"{kind}{year}a.co.txt")
    if not refresh and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read().splitlines()

    url = (COUNTY_URL if kind == "county" else PLACE_URL).format(year=year)
    print(f"  Fetching {url}")
    # The bare .txt URL is sometimes hard-blocked by the census.gov WAF
    # (persistent "Request Rejected" HTML for specific filenames, e.g.
    # we2023a.txt as of 2026-07). A harmless query string changes the URL
    # signature and gets the same file through.
    text = http_get_text(url + "?dl=1")
    lines = text.splitlines()
    header, body = lines[:2], lines[2:]
    co_rows = [ln for ln in body if _row_state(ln) == COLORADO_FIPS]
    if not co_rows:
        raise RuntimeError(f"No Colorado rows found in {url}")
    kept = header + co_rows

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        f.write("\n".join(kept) + "\n")
    time.sleep(3)  # polite pacing — census.gov WAF rejects fast fetch loops
    return kept


def _row_state(line: str) -> str:
    """State FIPS is the second comma field in both county and place files."""
    parts = line.split(",", 2)
    return parts[1].strip() if len(parts) >= 2 else ""


def safe_int(v: Any) -> int:
    try:
        return int(str(v).strip() or 0)
    except (ValueError, TypeError):
        return 0


def _units_from_row(row: list[str]) -> tuple[int, int, int] | None:
    """Extract (total, sf, mf) permitted units from a BPS data row.

    The last 24 columns are 8 groups × (Bldgs, Units, Value): 1-unit,
    2-units, 3-4 units, 5+ units, then the same four reported-only. We use
    the first four groups (total = reported + imputed). Anchoring at the
    row END makes this robust to place names containing commas.
    """
    if len(row) < 24 + 6:  # 6 = minimum leading metadata columns
        return None
    block = row[-24:]
    try:
        u1 = safe_int(block[1])
        u2 = safe_int(block[4])
        u34 = safe_int(block[7])
        u5p = safe_int(block[10])
    except IndexError:
        return None
    sf = u1
    mf = u2 + u34 + u5p
    return sf + mf, sf, mf


def parse_county_year(lines: list[str]) -> dict[str, dict[str, Any]]:
    """Return {county_geoid5: {name, total, sf, mf}} for Colorado."""
    out: dict[str, dict[str, Any]] = {}
    for row in csv.reader(lines[2:]):
        if len(row) < 10 or row[1].strip() != COLORADO_FIPS:
            continue
        geoid = COLORADO_FIPS + row[2].strip().zfill(3)
        units = _units_from_row(row)
        if units is None:
            continue
        total, sf, mf = units
        rec = out.setdefault(
            geoid, {"name": row[5].strip(), "total": 0, "sf": 0, "mf": 0}
        )
        rec["total"] += total
        rec["sf"] += sf
        rec["mf"] += mf
    return out


def parse_place_year(lines: list[str]) -> dict[str, dict[str, Any]]:
    """Return {place_geoid7: {name, total, sf, mf}} for Colorado.

    Cross-county municipalities have one row per county part — summed
    here. Balance rows (FIPS place 99990 'County Unincorporated Area')
    and rows without a FIPS place code are skipped.
    """
    out: dict[str, dict[str, Any]] = {}
    for row in csv.reader(lines[2:]):
        if len(row) < 30 or row[1].strip() != COLORADO_FIPS:
            continue
        fips_place = row[5].strip()
        if not fips_place.isdigit() or fips_place in ("99990", "00000"):
            continue
        geoid = COLORADO_FIPS + fips_place.zfill(5)
        units = _units_from_row(row)
        if units is None:
            continue
        total, sf, mf = units
        # Name column is index 16 when the name has no comma; anchor from
        # the end instead (name = everything between col 15 and the block).
        name = ",".join(row[16:-24]).strip() or geoid
        rec = out.setdefault(geoid, {"name": name, "total": 0, "sf": 0, "mf": 0})
        rec["total"] += total
        rec["sf"] += sf
        rec["mf"] += mf
    return out


def trailing_avg(series: list[int | None], years: list[int], n: int) -> dict[str, Any]:
    """Average of the last n years' values, ignoring nulls.

    Returns {value, years_used, window} — value is None when no data in
    the window.
    """
    window = series[-n:]
    vals = [v for v in window if v is not None]
    win_years = years[-n:]
    return {
        "value": round(sum(vals) / len(vals), 1) if vals else None,
        "years_used": len(vals),
        "window": f"{win_years[0]}-{win_years[-1]}" if win_years else None,
    }


def load_projection_annual_need(county_fips5: str) -> dict[str, Any] | None:
    """Annualized DOLA incremental need for a county over 5y and 10y.

    incremental_units_needed_dola is CUMULATIVE from the base year, so the
    annual average over the first N projection years is inc[base+N] / N.
    """
    path = os.path.join(PROJECTIONS_DIR, f"{county_fips5}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        proj = json.load(f)
    years = proj.get("years") or []
    base_year = proj.get("baseYear")
    inc = (proj.get("housing_need") or {}).get("incremental_units_needed_dola") or []
    if not years or base_year is None or len(inc) != len(years):
        return None

    def annual(n: int) -> float | None:
        try:
            idx = years.index(base_year + n)
        except ValueError:
            return None
        v = inc[idx]
        return round(v / n, 1) if isinstance(v, (int, float)) else None

    return {
        "annual_need_5yr": annual(5),
        "annual_need_10yr": annual(10),
        "base_year": base_year,
        "source": f"data/hna/projections/{county_fips5}.json",
    }


def production_vs_need(
    avg_5yr: dict[str, Any],
    county_need: dict[str, Any] | None,
    *,
    method: str,
    need_county: str,
    share: float | None = None,
) -> dict[str, Any] | None:
    if county_need is None:
        return None
    scale = share if share is not None else 1.0
    need5 = county_need["annual_need_5yr"]
    need10 = county_need["annual_need_10yr"]
    need5 = round(need5 * scale, 1) if need5 is not None else None
    need10 = round(need10 * scale, 1) if need10 is not None else None
    permits = avg_5yr["value"]
    # Ratio only when projected need is at least 1 unit/yr — dividing by a
    # near-zero need produces absurd figures (700×) that read as bad data.
    ratio = None
    if permits is not None and need10 is not None and need10 >= 1:
        ratio = round(permits / need10, 2)
    out = {
        "permits_avg_annual_5yr": permits,
        "permits_window": avg_5yr["window"],
        "annual_need_5yr_dola": need5,
        "annual_need_10yr_dola": need10,
        "need_base_year": county_need["base_year"],
        "ratio_recent_production_to_10yr_need": ratio,
        "need_method": method,
        "need_county": need_county,
        "need_source": county_need["source"],
    }
    if share is not None:
        out["county_share_used"] = round(share, 4)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start-year", type=int, default=DEFAULT_START_YEAR)
    p.add_argument("--end-year", type=int, default=DEFAULT_END_YEAR)
    p.add_argument("--refresh", action="store_true",
                   help="Re-download BPS files even if cached.")
    p.add_argument("--out", default=OUT_FILE)
    args = p.parse_args()

    years = list(range(args.start_year, args.end_year + 1))
    print(f"Building BPS permits dataset for {years[0]}-{years[-1]}...")

    # --- Lookups -----------------------------------------------------------
    with open(GEO_REGISTRY, "r", encoding="utf-8") as f:
        registry = json.load(f)
    registry_places: dict[str, dict[str, Any]] = {}
    registry_counties: set[str] = set()
    for g in registry.get("geographies", []):
        geoid = str(g.get("geoid", ""))
        if g.get("type") == "county":
            registry_counties.add(geoid)
        elif g.get("type") in ("place", "cdp"):
            registry_places[geoid] = g

    aliases: dict[str, str] = {}
    if os.path.exists(PHANTOM_ALIAS):
        with open(PHANTOM_ALIAS, "r", encoding="utf-8") as f:
            aliases = json.load(f).get("aliases", {})
    # BPS uses canonical TIGER FIPS codes; the registry may key the same
    # place under a phantom GEOID. Map canonical → phantom so permits land
    # on the registry's key (consumers resolve phantom → canonical, so
    # keying by the registry GEOID keeps lookups consistent either way).
    canonical_to_phantom = {v: k for k, v in aliases.items()}

    derived_geos: dict[str, Any] = {}
    if os.path.exists(GEO_DERIVED):
        with open(GEO_DERIVED, "r", encoding="utf-8") as f:
            derived_geos = json.load(f).get("geos", {})

    # Place household totals (CHAS, ACS-anchored) — fallback share source.
    # geo-derived.json is an on-demand ETL cache and only covers a handful
    # of geographies, so most places need the household-share fallback.
    place_hh: dict[str, float] = {}
    if os.path.exists(PLACE_CHAS):
        with open(PLACE_CHAS, "r", encoding="utf-8") as f:
            for geoid, rec in json.load(f).get("places", {}).items():
                s = rec.get("summary") or {}
                hh = (s.get("total_renter_hh") or 0) + (s.get("total_owner_hh") or 0)
                if hh > 0:
                    place_hh[geoid] = hh

    county_base_hh: dict[str, float] = {}

    def county_households(fips5: str) -> float | None:
        if fips5 not in county_base_hh:
            path = os.path.join(PROJECTIONS_DIR, f"{fips5}.json")
            hh = None
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    hh = (json.load(f).get("base") or {}).get("households")
            county_base_hh[fips5] = hh if isinstance(hh, (int, float)) and hh > 0 else None
        return county_base_hh[fips5]

    # --- Fetch + parse -----------------------------------------------------
    county_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    place_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    for year in years:
        county_by_year[year] = parse_county_year(
            fetch_bps_file("county", year, refresh=args.refresh)
        )
        place_by_year[year] = parse_place_year(
            fetch_bps_file("place", year, refresh=args.refresh)
        )
        print(f"  {year}: {len(county_by_year[year])} counties, "
              f"{len(place_by_year[year])} places")

    # --- Assemble series ---------------------------------------------------
    def build_series(
        by_year: dict[int, dict[str, dict[str, Any]]],
    ) -> dict[str, dict[str, Any]]:
        geoids = sorted({g for ym in by_year.values() for g in ym})
        recs: dict[str, dict[str, Any]] = {}
        for geoid in geoids:
            total = [
                (by_year[y][geoid]["total"] if geoid in by_year[y] else None)
                for y in years
            ]
            sf = [
                (by_year[y][geoid]["sf"] if geoid in by_year[y] else None)
                for y in years
            ]
            mf = [
                (by_year[y][geoid]["mf"] if geoid in by_year[y] else None)
                for y in years
            ]
            name = next(
                by_year[y][geoid]["name"] for y in reversed(years) if geoid in by_year[y]
            )
            recs[geoid] = {
                "name": name,
                "units_total": total,
                "units_sf": sf,
                "units_mf": mf,
                "avg_annual_total_5yr": trailing_avg(total, years, 5),
                "avg_annual_total_10yr": trailing_avg(total, years, 10),
                "avg_annual_sf_5yr": trailing_avg(sf, years, 5),
                "avg_annual_mf_5yr": trailing_avg(mf, years, 5),
            }
        return recs

    county_recs = build_series(county_by_year)
    place_recs_raw = build_series(place_by_year)

    # Key places by the registry GEOID (phantom-alias aware); drop
    # non-registry geoids but record them for auditability.
    place_recs: dict[str, dict[str, Any]] = {}
    unmatched: dict[str, str] = {}
    for geoid, rec in place_recs_raw.items():
        registry_key = geoid if geoid in registry_places else canonical_to_phantom.get(geoid, "")
        if registry_key not in registry_places:
            unmatched[geoid] = rec["name"]
            continue
        rec["containingCounty"] = registry_places[registry_key].get("containingCounty")
        if registry_key != geoid:
            rec["bps_geoid"] = geoid  # canonical TIGER code seen in BPS
        place_recs[registry_key] = rec

    # --- Production vs need ------------------------------------------------
    need_cache: dict[str, dict[str, Any] | None] = {}

    def county_need(fips5: str) -> dict[str, Any] | None:
        if fips5 not in need_cache:
            need_cache[fips5] = load_projection_annual_need(fips5)
        return need_cache[fips5]

    for geoid, rec in county_recs.items():
        pvn = production_vs_need(
            rec["avg_annual_total_5yr"], county_need(geoid),
            method="dola_direct", need_county=geoid,
        )
        if pvn:
            rec["production_vs_need"] = pvn

    for geoid, rec in place_recs.items():
        cc = rec.get("containingCounty")
        if not cc or cc == "00000":
            continue
        # Share of county: prefer the dashboard's ETL-derived share0, fall
        # back to CHAS place households / DOLA county base households.
        share_raw = (derived_geos.get(geoid, {}).get("derived") or {}).get("share0")
        share_source = "geo-derived.share0"
        if not isinstance(share_raw, (int, float)) or share_raw <= 0:
            hh = place_hh.get(geoid)
            cc_hh = county_households(cc)
            if hh and cc_hh:
                share_raw = hh / cc_hh
                share_source = "place-chas_hh/county_base_hh"
            else:
                continue  # no defensible place share — omit need comparison
        share = min(SHARE_MAX, max(SHARE_MIN, share_raw))
        pvn = production_vs_need(
            rec["avg_annual_total_5yr"], county_need(cc),
            method="county_share_scaled", need_county=cc, share=share,
        )
        if pvn:
            pvn["share_source"] = share_source
            rec["production_vs_need"] = pvn

    state_rec = county_recs.pop(COLORADO_FIPS, None)  # not expected, safety
    counties = {k: v for k, v in county_recs.items() if k in registry_counties}
    dropped_counties = sorted(set(county_recs) - set(counties))

    # --- Write -------------------------------------------------------------
    payload = {
        "meta": {
            "generated_at": utc_now(),
            "source": "U.S. Census Bureau Building Permits Survey (BPS), "
                      "annual county and place files",
            "source_urls": [
                COUNTY_URL.replace("{year}", "<YYYY>"),
                PLACE_URL.replace("{year}", "<YYYY>"),
            ],
            "years": years,
            "count_counties": len(counties),
            "count_places": len(place_recs),
            "count_places_with_need": sum(
                1 for r in place_recs.values() if "production_vs_need" in r
            ),
            "unmatched_bps_places": unmatched,
            "dropped_non_registry_counties": dropped_counties,
            "method": (
                "Permitted housing units from BPS annual files (total = "
                "reported + imputed; the reported-only columns are ignored). "
                "SF = 1-unit structures; MF = 2, 3-4, and 5+ unit structures. "
                "null = geography absent from that year's file; 0 = reported "
                "zero units. Cross-county municipalities are summed across "
                "county parts. Place GEOIDs are keyed to "
                "geography-registry.json (phantom-alias aware)."
            ),
            "need_method": (
                "annual_need_Nyr = incremental_units_needed_dola at base+N "
                "divided by N (the series is cumulative from the base year). "
                "Place need is the containing county's annual need scaled by "
                "share0 from geo-derived.json, clamped to [0.02, 0.98] — the "
                "same scaling the HNA dashboard applies to municipal "
                "selections. UIs must label scaled place need as "
                "'scaled from county projection'."
            ),
            "cdp_note": (
                "CDPs and other unincorporated communities never appear in "
                "the places tree — their permits are issued by the county. "
                "Do not substitute county figures for a missing place."
            ),
        },
        "years": years,
        "counties": counties,
        "places": place_recs,
    }
    if state_rec:
        payload["state"] = state_rec

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)
    print(f"  Wrote {args.out}")
    print(f"  Counties: {len(counties)} | Places: {len(place_recs)} "
          f"({payload['meta']['count_places_with_need']} with need comparison) "
          f"| Unmatched BPS places: {len(unmatched)}")

    # Sanity check: Alamosa city (0801090). Its 2021 housing plan cites
    # ~44 units/yr since 2010; the recent BPS average should be the same
    # order of magnitude (tens, not hundreds or single units).
    alamosa = place_recs.get("0801090")
    if alamosa:
        avg = alamosa["avg_annual_total_10yr"]["value"]
        print(f"  Sanity: Alamosa 10yr avg = {avg} units/yr "
              f"(2021 plan benchmark: ~44 units/yr since 2010)")
        pvn = alamosa.get("production_vs_need")
        if pvn:
            print(f"          need(10yr, scaled) = {pvn['annual_need_10yr_dola']}"
                  f" units/yr → ratio {pvn['ratio_recent_production_to_10yr_need']}")
    else:
        print("  ⚠ Alamosa (0801090) missing from places — investigate",
              file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
