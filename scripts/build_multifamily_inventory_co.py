#!/usr/bin/env python3
"""
scripts/build_multifamily_inventory_co.py
==========================================
Pivots data/affordable-housing/properties.json into a per-geography rollup
for the Census Multifamily Lens. Sources are the unified affordable-housing
properties file (LIHTC + preservation + HUD MF + USDA RD).

Output:
  data/multifamily-inventory-co.json

Structure:
  {
    "meta": { ... },
    "state": {
      "total_records": int,
      "total_units": int,
      "lihtc": { "properties": int, "units": int, "pct_9": int, "pct_4": int, ... },
      "preservation_candidates": int,
      "hud_multifamily": int,
      "usda_rural": int,
      "yr_pis_distribution": { "decade": count, ... },
      "qct": int,        # in QCT
      "dda": int,        # in DDA
      "nonprofit": int   # non-profit sponsor
    },
    "counties": { "08001": {...same shape...}, ... },
    "places":   { "0807850": {...subset, name + lihtc only...}, ... }
  }
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = REPO_ROOT / "data" / "affordable-housing" / "properties.json"
CHFA_LIHTC_RAW = REPO_ROOT / "data" / "affordable-housing" / "lihtc" / "chfa-properties.json"
PRESERVATION = REPO_ROOT / "data" / "affordable-housing" / "preservation" / "chfa-preservation.json"
OUT = REPO_ROOT / "data" / "multifamily-inventory-co.json"

LIHTC_PROGRAM_TYPES = {
    "lihtc-9pct",
    "lihtc-4pct",
    "lihtc-state-paired",
    "lihtc-toc-paired",
    "lihtc-mihtc",
}


def _decade(year):
    try:
        y = int(year)
        if y < 1980 or y > 2030:
            return None
        return (y // 10) * 10
    except (TypeError, ValueError):
        return None


def _empty_record():
    return {
        "total_records": 0,
        "total_units": 0,
        "lihtc": {
            "properties": 0,
            "units": 0,
            "pct_9": 0,
            "pct_4": 0,
            "state_paired": 0,
            "toc_paired": 0,
        },
        "preservation_candidates": 0,
        "hud_multifamily": 0,
        "usda_rural": 0,
        "qct": 0,
        "dda": 0,
        "nonprofit": 0,
        "yr_pis_distribution": defaultdict(int),
    }


def _accumulate(bucket: dict, prop: dict, lihtc_lookup: dict):
    bucket["total_records"] += 1
    units = prop.get("total_units") or 0
    if isinstance(units, (int, float)) and units > 0:
        bucket["total_units"] += int(units)

    program_types = prop.get("program_type") or []
    if not isinstance(program_types, list):
        program_types = [program_types]

    pt_set = set(program_types)
    if pt_set & LIHTC_PROGRAM_TYPES:
        bucket["lihtc"]["properties"] += 1
        if isinstance(units, (int, float)) and units > 0:
            bucket["lihtc"]["units"] += int(units)
        if "lihtc-9pct" in pt_set:
            bucket["lihtc"]["pct_9"] += 1
        if "lihtc-4pct" in pt_set:
            bucket["lihtc"]["pct_4"] += 1
        if "lihtc-state-paired" in pt_set:
            bucket["lihtc"]["state_paired"] += 1
        if "lihtc-toc-paired" in pt_set:
            bucket["lihtc"]["toc_paired"] += 1

        # CHFA raw lookup gives us QCT / DDA / NON_PROF + YR_PIS
        chfa_id = prop.get("source_id")
        raw = lihtc_lookup.get(chfa_id)
        if raw:
            if str(raw.get("QCT", "")).upper() in ("Y", "1", "TRUE"):
                bucket["qct"] += 1
            if str(raw.get("DDA", "")).upper() in ("Y", "1", "TRUE"):
                bucket["dda"] += 1
            if str(raw.get("NON_PROF", "")).upper() in ("Y", "1", "TRUE"):
                bucket["nonprofit"] += 1
            dec = _decade(raw.get("YR_PIS"))
            if dec:
                bucket["yr_pis_distribution"][str(dec)] += 1

    if "preservation-candidate" in pt_set:
        bucket["preservation_candidates"] += 1
    if "hud-multifamily" in pt_set:
        bucket["hud_multifamily"] += 1
    if "usda-rural-development" in pt_set:
        bucket["usda_rural"] += 1


def _finalize(bucket: dict) -> dict:
    bucket["yr_pis_distribution"] = dict(sorted(bucket["yr_pis_distribution"].items()))
    return bucket


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: {SRC} not found.")
        return 1

    payload = json.loads(SRC.read_text())
    properties = payload.get("properties") or []

    # Build a fast lookup from CHFA LIHTC raw features for QCT/DDA/YR_PIS/NON_PROF.
    lihtc_lookup = {}
    if CHFA_LIHTC_RAW.exists():
        raw = json.loads(CHFA_LIHTC_RAW.read_text())
        for feat in raw.get("features", []):
            props = feat.get("properties", {})
            # source_id in unified is typically the CHFA project number.
            src_id = props.get("OBJECTID") or props.get("PROJECT") or props.get("source_id")
            if src_id:
                lihtc_lookup[str(src_id)] = props
            if props.get("PROJECT"):
                lihtc_lookup[props["PROJECT"]] = props

    state_bucket = _empty_record()
    counties = defaultdict(_empty_record)
    places = defaultdict(_empty_record)

    for prop in properties:
        _accumulate(state_bucket, prop, lihtc_lookup)

        fips = prop.get("county_fips") or ""
        if fips:
            # Counties are 5-digit codes in CO (08001..08125). Some records may
            # have only the 3-digit county sub-code; left-pad with state FIPS.
            if len(fips) == 3:
                fips = "08" + fips
            if len(fips) == 5 and fips.startswith("08"):
                _accumulate(counties[fips], prop, lihtc_lookup)

        # Optional place-level rollup if the property has a place GEOID.
        place_geoid = prop.get("place_geoid") or prop.get("place_fips")
        if place_geoid and len(str(place_geoid)) == 7:
            _accumulate(places[str(place_geoid)], prop, lihtc_lookup)

    state_bucket = _finalize(state_bucket)
    counties = {fips: _finalize(b) for fips, b in counties.items()}
    places = {g: _finalize(b) for g, b in places.items()}

    output = {
        "meta": {
            "source": "data/affordable-housing/properties.json (unified LIHTC + preservation + HUD MF + USDA RD)",
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "input_total_records": len(properties),
            "lihtc_lookup_size": len(lihtc_lookup),
            "notes": (
                "Per-county rollup uses the property's county_fips field. "
                "Preservation candidates from CHFA Preservation often lack county_fips "
                "(they aggregate at the property name + address level); statewide totals "
                "include them, county subtotals do not."
            ),
        },
        "state": state_bucket,
        "counties": counties,
        "places": places,
    }

    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"    state: {state_bucket['total_records']:,} records "
          f"({state_bucket['lihtc']['properties']:,} LIHTC, "
          f"{state_bucket['preservation_candidates']:,} preservation candidates)")
    print(f"    counties: {len(counties)} with affordable inventory")
    print(f"    places:   {len(places)} with place-level rollup")
    return 0


if __name__ == "__main__":
    sys.exit(main())
