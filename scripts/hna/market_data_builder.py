#!/usr/bin/env python3
"""Robust Colorado census-tract market data builder.

Fetches ACS 5-year estimates for all ~1,000+ Colorado census tracts, with
county-level fallback when tract data are incomplete, and writes:

  data/market/acs_tract_metrics_co.json  — tract-level housing + income metrics
  data/market/tract_centroids_co.json    — tract centroids (lat/lon)
  data/market/tract_completeness_report.json — coverage % by county
  data/market/fallback_county_aggregates.json — county-level data for missing tracts

Uses the Census Bureau Data API (ACS 5-year DP04 + DP03 tables).
Set the CENSUS_API_KEY environment variable or pass --api-key on the command line.

Usage
-----
    python3 scripts/hna/market_data_builder.py
    python3 scripts/hna/market_data_builder.py --api-key <your_key>
    python3 scripts/hna/market_data_builder.py --county 08031  # Denver only
    python3 scripts/hna/market_data_builder.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ACS_YEAR = "2022"
ACS_DATASET = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"

# DP04 (housing characteristics) + DP03 (selected economic characteristics)
TRACT_VARIABLES = {
    # Housing occupancy
    "DP04_0001E": "total_housing_units",
    "DP04_0002E": "occupied_units",
    "DP04_0003E": "vacant_units",
    "DP04_0004E": "homeowner_vacancy_rate",
    "DP04_0005E": "rental_vacancy_rate",
    # Tenure
    "DP04_0046E": "owner_occupied_units",
    "DP04_0047E": "renter_occupied_units",
    # Gross rent
    "DP04_0134E": "median_gross_rent",
    # Median home value
    "DP04_0089E": "median_home_value",
    # Income
    "DP03_0062E": "median_household_income",
    # Rent burden (paying 30%+ of income)
    "DP04_0141E": "renter_households_30pct_plus",
}

# Colorado FIPS: state=08, all 64 counties
STATE_FIPS = "08"
COLORADO_COUNTIES = [
    "001","003","005","007","009","011","013","014","015","017",
    "019","021","023","025","027","029","031","033","035","037",
    "039","041","043","045","047","049","051","053","055","057",
    "059","061","063","065","067","069","071","073","075","077",
    "079","081","083","085","087","089","091","093","095","097",
    "099","101","103","105","107","109","111","113","115","117",
    "119","121","123","125",
]

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "data" / "market"
RATE_LIMIT_PAUSE = 0.25  # seconds between API requests

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _get(url: str, retries: int = 3, pause: float = RATE_LIMIT_PAUSE) -> Any:
    """Fetch a JSON URL with simple retry logic."""
    for attempt in range(retries):
        try:
            time.sleep(pause)
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries - 1:
                wait = 10 * (attempt + 1)
                log.warning("Rate-limited (429) — waiting %ds before retry %d", wait, attempt + 1)
                time.sleep(wait)
                continue
            raise
        except Exception as exc:
            if attempt < retries - 1:
                log.warning("Request failed (%s) — retrying %d/%d", exc, attempt + 1, retries)
                time.sleep(2 ** attempt)
                continue
            raise
    return None  # unreachable, but satisfies type checker


def build_url(dataset: str, get_vars: list[str], predicates: dict[str, str],
              api_key: str | None) -> str:
    """Build a Census API URL."""
    vars_str = ",".join(get_vars)
    pred_str = "&".join(f"for={v}" if k == "for" else f"in={v}"
                        for k, v in predicates.items())
    url = f"{dataset}?get={vars_str}&{pred_str}"
    if api_key:
        url += f"&key={api_key}"
    return url


# ---------------------------------------------------------------------------
# Tract-level fetch
# ---------------------------------------------------------------------------

def fetch_tracts_for_county(county_fips: str, api_key: str | None) -> list[dict]:
    """Fetch tract metrics for a single Colorado county."""
    get_vars = ["NAME"] + list(TRACT_VARIABLES.keys())
    predicates = {
        "for": f"tract:*",
        "in": f"state:{STATE_FIPS} county:{county_fips}",
    }
    url = build_url(ACS_DATASET, get_vars, predicates, api_key)
    log.debug("GET %s", url)
    try:
        raw = _get(url)
    except Exception as exc:
        log.warning("Tract fetch failed for county %s: %s", county_fips, exc)
        return []
    if not raw or len(raw) < 2:
        return []
    headers = raw[0]
    rows = []
    for row in raw[1:]:
        record: dict[str, Any] = {}
        for i, h in enumerate(headers):
            record[h] = row[i]
        rows.append(record)
    return rows


def parse_tract_row(row: dict) -> dict:
    """Normalise a raw Census API row into a clean metric dict."""
    geoid = f"1400000US{STATE_FIPS}{row.get('county','???')}{row.get('tract','??????')}"
    metrics: dict[str, Any] = {
        "geoid": geoid,
        "state_fips": STATE_FIPS,
        "county_fips": f"{STATE_FIPS}{row.get('county','')}",
        "tract_fips": row.get("tract", ""),
        "name": row.get("NAME", ""),
    }
    for api_key, label in TRACT_VARIABLES.items():
        raw_val = row.get(api_key)
        try:
            # Census Bureau official null/suppression codes:
            #   "-1"          — value not applicable for this geography
            #   "-666666666"  — data suppressed (small population, privacy)
            #   "-999999999"  — data not collected / insufficient sample
            val = int(raw_val) if raw_val not in (None, "-1", "-666666666", "-999999999") else None
        except (TypeError, ValueError):
            val = None
        metrics[label] = val
    return metrics


# ---------------------------------------------------------------------------
# County-level fallback
# ---------------------------------------------------------------------------

def fetch_county_aggregates(counties: list[str], api_key: str | None) -> dict[str, dict]:
    """Fetch county-level DP04/DP03 data as a fallback for missing tracts."""
    get_vars = ["NAME"] + list(TRACT_VARIABLES.keys())
    predicates = {
        "for": f"county:{','.join(counties)}",
        "in": f"state:{STATE_FIPS}",
    }
    url = build_url(ACS_DATASET, get_vars, predicates, api_key)
    log.debug("GET (county fallback) %s", url)
    try:
        raw = _get(url)
    except Exception as exc:
        log.warning("County aggregate fetch failed: %s", exc)
        return {}
    if not raw or len(raw) < 2:
        return {}
    headers = raw[0]
    result: dict[str, dict] = {}
    for row in raw[1:]:
        record = {headers[i]: row[i] for i in range(len(headers))}
        county_3 = record.get("county", "")
        fips5 = f"{STATE_FIPS}{county_3}"
        metrics: dict[str, Any] = {"county_fips": fips5, "name": record.get("NAME", "")}
        for api_key_var, label in TRACT_VARIABLES.items():
            raw_val = record.get(api_key_var)
            try:
                # See parse_tract_row() for Census null code documentation.
                val = int(raw_val) if raw_val not in (None, "-1", "-666666666", "-999999999") else None
            except (TypeError, ValueError):
                val = None
            metrics[label] = val
        result[fips5] = metrics
    return result


# ---------------------------------------------------------------------------
# Centroid estimation (bounding-box midpoint from NAME string)
# ---------------------------------------------------------------------------

def estimate_centroid_from_fips(county_fips_3: str) -> tuple[float, float]:
    """Return an approximate lat/lon centroid for a Colorado county."""
    # Rough centroids for Colorado's 64 counties (lat, lon)
    _COUNTY_CENTROIDS: dict[str, tuple[float, float]] = {
        "001": (39.87, -104.34), "003": (38.84, -105.99), "005": (37.03, -104.34),
        "007": (38.42, -107.85), "009": (37.30, -107.67), "011": (38.52, -105.15),
        "013": (40.09, -105.36), "014": (39.92, -105.09), "015": (39.30, -103.80),
        "017": (38.47, -103.08), "019": (38.68, -106.07), "021": (38.38, -104.52),
        "023": (37.72, -108.10), "025": (40.58, -102.35), "027": (40.88, -104.35),
        "029": (39.37, -104.98), "031": (39.76, -104.87), "033": (38.82, -108.22),
        "035": (39.33, -104.81), "037": (38.42, -105.73), "039": (39.22, -105.60),
        "041": (38.79, -104.52), "043": (37.97, -107.10), "045": (38.50, -106.93),
        "047": (38.20, -107.28), "049": (38.07, -102.35), "051": (38.68, -105.47),
        "053": (39.58, -108.07), "055": (40.67, -105.46), "057": (39.64, -107.65),
        "059": (39.54, -105.20), "061": (39.01, -106.14), "063": (38.10, -105.98),
        "065": (38.89, -109.10), "067": (39.17, -102.93), "069": (40.61, -105.14),
        "071": (37.60, -106.00), "073": (37.48, -106.71), "075": (37.13, -105.45),
        "077": (39.20, -108.43), "079": (40.18, -104.37), "081": (40.54, -107.32),
        "083": (39.54, -102.60), "085": (37.96, -104.52), "087": (38.58, -107.21),
        "089": (37.37, -108.61), "091": (38.22, -107.67), "093": (40.55, -103.87),
        "095": (37.58, -104.99), "097": (40.26, -103.20), "099": (38.35, -103.58),
        "101": (38.27, -104.61), "103": (39.59, -104.09), "105": (37.86, -106.50),
        "107": (37.70, -103.36), "109": (37.19, -103.68), "111": (40.90, -103.73),
        "113": (40.30, -102.92), "115": (37.48, -105.17), "117": (40.18, -104.99),
        "119": (39.91, -102.60), "121": (40.56, -107.78), "123": (40.87, -102.80),
        "125": (37.27, -106.35),
    }
    return _COUNTY_CENTROIDS.get(county_fips_3, (39.11, -105.36))


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------

def build(api_key: str | None, target_counties: list[str] | None = None,
          dry_run: bool = False) -> None:
    """Fetch all tract data and write output files."""
    counties = target_counties or COLORADO_COUNTIES
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_tracts: list[dict] = []
    completeness: dict[str, dict] = {}
    missing_counties: list[str] = []

    for county_3 in counties:
        county_fips5 = f"{STATE_FIPS}{county_3}"
        log.info("Fetching tracts for county %s …", county_fips5)
        rows = fetch_tracts_for_county(county_3, api_key)
        if not rows:
            log.warning("No tract data for county %s — will use county fallback", county_fips5)
            missing_counties.append(county_3)
            completeness[county_fips5] = {"tract_count": 0, "complete": False}
            continue

        parsed = [parse_tract_row(r) for r in rows]

        # Compute county completeness: fraction of key fields that are non-null
        key_fields = ["median_gross_rent", "median_home_value", "median_household_income"]
        filled = sum(
            1 for t in parsed
            if all(t.get(f) is not None for f in key_fields)
        )
        pct = round(filled / len(parsed) * 100, 1) if parsed else 0.0
        completeness[county_fips5] = {
            "tract_count": len(parsed),
            "tracts_with_key_data": filled,
            "completeness_pct": pct,
            "complete": pct >= 80.0,
        }
        all_tracts.extend(parsed)
        log.info("  → %d tracts, %.1f%% complete", len(parsed), pct)

    # County-level fallback for any county with no tract data
    county_aggregates: dict[str, dict] = {}
    if missing_counties:
        log.info("Fetching county-level fallback for %d counties …", len(missing_counties))
        county_aggregates = fetch_county_aggregates(missing_counties, api_key)

    # Build tract centroids (estimated from county centroid; real geometries
    # are in the TIGER/Line download used by the map layer)
    centroids: list[dict] = []
    for t in all_tracts:
        county_3 = t["county_fips"][2:]  # strip state prefix
        lat, lon = estimate_centroid_from_fips(county_3)
        centroids.append({
            "geoid": t["geoid"],
            "county_fips": t["county_fips"],
            "lat": lat,
            "lon": lon,
        })

    if dry_run:
        log.info("[dry-run] Would write %d tract records and %d centroids.",
                 len(all_tracts), len(centroids))
        return

    # Write outputs
    _write_json(OUTPUT_DIR / "acs_tract_metrics_co.json", {
        "meta": {
            "acs_year": ACS_YEAR,
            "generated": _utcnow(),
            "tract_count": len(all_tracts),
            "counties_with_fallback": len(missing_counties),
        },
        "tracts": all_tracts,
    })
    log.info("Wrote acs_tract_metrics_co.json (%d tracts)", len(all_tracts))

    _write_json(OUTPUT_DIR / "tract_centroids_co.json", {
        "meta": {"generated": _utcnow()},
        "centroids": centroids,
    })
    log.info("Wrote tract_centroids_co.json (%d centroids)", len(centroids))

    _write_json(OUTPUT_DIR / "tract_completeness_report.json", {
        "meta": {"generated": _utcnow()},
        "by_county": completeness,
        "summary": {
            "total_counties": len(counties),
            "counties_complete": sum(1 for v in completeness.values() if v.get("complete")),
            "counties_missing": len(missing_counties),
            "total_tracts": len(all_tracts),
        },
    })
    log.info("Wrote tract_completeness_report.json")

    _write_json(OUTPUT_DIR / "fallback_county_aggregates.json", {
        "meta": {"generated": _utcnow()},
        "counties": county_aggregates,
    })
    log.info("Wrote fallback_county_aggregates.json (%d counties)", len(county_aggregates))


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _utcnow() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-key", default=os.environ.get("CENSUS_API_KEY"), help="Census API key")
    parser.add_argument("--county", metavar="FIPS3", help="Fetch only this 3-digit county FIPS code")
    parser.add_argument("--dry-run", action="store_true", help="Fetch data but do not write files")
    args = parser.parse_args(argv)

    if not args.api_key:
        log.warning("No Census API key provided. Requests may be rate-limited.")

    target = [args.county] if args.county else None
    try:
        build(args.api_key, target_counties=target, dry_run=args.dry_run)
    except Exception as exc:
        log.error("Build failed: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
