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
PLACE_CENTROIDS = REPO_ROOT / "data" / "co-place-centroids.json"
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


# ── L1 — Place-level lookup (city-name match + centroid distance sanity) ───
# properties.json carries city name + lat/lng but no place_geoid. The OF page
# does name-only matching (uppercase) which works for incorporated cities but
# silently drops CDP-name mismatches and unincorporated areas. Here we use
# both name AND distance — match city name to a place centroid, then verify
# the property's lat/lng is within MAX_CENTROID_MILES of that centroid before
# attributing the property to that place. Catches the common CHFA pattern
# where mailing-address city = "Montrose" but the property sits 2 mi south
# of the city centroid (still well within Montrose's affordable-market shed).
import math

MAX_CENTROID_MILES = 8.0  # generous — most place LIHTC sits within 8 mi of centroid

def _haversine_miles(lat1, lon1, lat2, lon2):
    R = 3958.8  # earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def _build_place_index():
    """Return (by_norm_name, by_geoid) for fast place lookup.

    by_norm_name maps "MONTROSE" → [{geoid, name, lat, lng, type}, …].
    Multiple entries possible: e.g. "Lakewood" matches both "Lakewood city"
    (Jefferson) and any "Lakewood CDP" elsewhere. Disambiguate via centroid
    distance.
    """
    if not PLACE_CENTROIDS.exists():
        return {}, {}
    payload = json.loads(PLACE_CENTROIDS.read_text())
    by_norm_name = defaultdict(list)
    by_geoid = {}
    for geoid, rec in payload.get("byGeoid", {}).items():
        name = (rec.get("name") or "").strip()
        if not name:
            continue
        # Normalize: drop "city" / "town" / "CDP" suffixes + collapse whitespace.
        norm = name.upper()
        for suffix in [" CITY", " TOWN", " CDP", " (CITY)", " (TOWN)", " (CDP)"]:
            norm = norm.replace(suffix, "")
        norm = " ".join(norm.split())
        by_norm_name[norm].append({
            "geoid": geoid,
            "name": name,
            "lat": rec.get("lat"),
            "lng": rec.get("lng"),
        })
        by_geoid[geoid] = rec
    return by_norm_name, by_geoid


def _resolve_place_geoid(prop, by_norm_name):
    """Best-effort place_geoid for one property. Returns geoid or None.

    Strategy:
      1. Normalize prop.city. Look up candidates in by_norm_name.
      2. If property has lat/lng, pick the nearest candidate within
         MAX_CENTROID_MILES; else pick the first candidate (city-name only).
      3. If no name match, fall back to lat/lng → nearest place centroid
         within MAX_CENTROID_MILES (catches "Berthoud" mistyped as "berthoud
         town", etc.).
    """
    city = (prop.get("city") or "").strip()
    plat = prop.get("lat")
    plng = prop.get("lng")
    if city:
        norm = city.upper()
        for suffix in [" CITY", " TOWN", " CDP"]:
            norm = norm.replace(suffix, "")
        norm = " ".join(norm.split())
        candidates = by_norm_name.get(norm, [])
        if candidates and plat is not None and plng is not None:
            best = None
            best_d = MAX_CENTROID_MILES + 1
            for c in candidates:
                if c["lat"] is None or c["lng"] is None:
                    continue
                d = _haversine_miles(plat, plng, c["lat"], c["lng"])
                if d < best_d:
                    best_d = d
                    best = c
            if best and best_d <= MAX_CENTROID_MILES:
                return best["geoid"]
        elif candidates:
            return candidates[0]["geoid"]
    return None


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

    # L1 — Build the city-name → place-geoid index once. ~482 CO places.
    by_norm_name, _by_geoid = _build_place_index()
    place_hits = 0
    place_misses = 0

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

        # L1 — Resolve place-geoid. First prefer any explicit field; otherwise
        # match via city-name + centroid-distance sanity check.
        place_geoid = prop.get("place_geoid") or prop.get("place_fips")
        if not (place_geoid and len(str(place_geoid)) == 7):
            place_geoid = _resolve_place_geoid(prop, by_norm_name)
        if place_geoid and len(str(place_geoid)) == 7:
            _accumulate(places[str(place_geoid)], prop, lihtc_lookup)
            place_hits += 1
        else:
            place_misses += 1

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
    print(f"    places:   {len(places)} with place-level rollup "
          f"({place_hits:,} hit / {place_misses:,} miss via city-name+centroid match)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
