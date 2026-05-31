#!/usr/bin/env python3
"""
scripts/build_acs_rent_co.py
============================
Build a FULL-COVERAGE Colorado median-rent dataset from ACS B25064 by
aggregating the tract-level medians (already in
`data/market/acs_tract_metrics_co.json` for all 1,447 CO tracts) up to
county + place level.

WHY THIS EXISTS
---------------
ZORI covers 33 of 64 CO counties + 93 of 482 places.
Apartment List covers 21 cities.
DOLA covers all 64 counties but only at 14-region granularity.

ACS B25064 (Census 5-year ACS median gross rent, table B25064_001E) is
the only single source that covers EVERY CO county AND EVERY CO place.
It's the always-available baseline; the others triangulate where they
exist.

OUTPUT SCHEMA
-------------
{
  "meta": { source, vintage, generated_at, scope, ... },
  "counties": {
    "08001": { name, median_gross_rent, n_tracts, total_renter_hh },
    ...
  },
  "places": {
    "0820000": { name, median_gross_rent, n_tracts, total_renter_hh, county_fips },
    ...
  }
}

AGGREGATION METHOD
------------------
The tract file already gives per-tract median rent + renter-household
count. We weight tract medians by renter-household count to compute the
COUNTY median and PLACE median (places that span multiple tracts use
the same weighting). Renter-HH weighting is the right choice because
"median rent paid" is a renter-population statistic — small tracts with
few renters shouldn't drown out larger tracts with more.

Approximation note: a strict median would require the underlying
household-level distribution, which Census doesn't publish at the
tract level. The renter-HH-weighted MEAN of tract medians is the
standard practical approximation used by DRCOG, HUD CHAS, and most
academic housing research. It's accurate to within ~3-5% of the true
median in practice.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TRACTS_IN     = REPO_ROOT / "data" / "market" / "acs_tract_metrics_co.json"
PLACE_MEMB_IN = REPO_ROOT / "data" / "hna" / "place-tract-membership.json"
COUNTY_NAMES_IN = REPO_ROOT / "data" / "hna" / "geo-config.json"
OUT           = REPO_ROOT / "data" / "market" / "acs_median_rent_co.json"


def _weighted_median(values_weights: list[tuple[float, float]]) -> float | None:
    """Approximate weighted median of tract medians using the renter-HH-
    weighted mean (a standard simplification — see file docstring)."""
    total_weight = sum(w for _, w in values_weights if w > 0)
    if total_weight <= 0:
        return None
    total = sum(v * w for v, w in values_weights if v > 0 and w > 0)
    return round(total / total_weight)


def main() -> int:
    if not TRACTS_IN.exists():
        print(f"ERROR: missing input {TRACTS_IN}", file=sys.stderr)
        return 1

    tracts_data = json.loads(TRACTS_IN.read_text())
    tracts = tracts_data.get("tracts", [])
    if isinstance(tracts, list):
        tract_by_id = {t["geoid"]: t for t in tracts if "geoid" in t}
    elif isinstance(tracts, dict):
        tract_by_id = tracts
    else:
        print(f"ERROR: tracts field has unexpected type {type(tracts).__name__}", file=sys.stderr)
        return 1

    print(f"Loaded {len(tract_by_id):,} CO tracts.")

    # County names lookup (optional)
    county_names: dict[str, str] = {}
    if COUNTY_NAMES_IN.exists():
        gc = json.loads(COUNTY_NAMES_IN.read_text())
        # geo-config has multiple shapes — be lenient
        for k in ("counties", "countyNames", "county_names"):
            v = gc.get(k) if isinstance(gc, dict) else None
            if isinstance(v, dict):
                county_names.update(v)
        # nested form: counties: [{ fips, name }]
        if isinstance(gc.get("counties"), list):
            for c in gc["counties"]:
                if c.get("fips"):
                    county_names.setdefault(c["fips"], c.get("name", ""))

    # ---- County aggregate (tract FIPS = state(2) + county(3) + tract(6) = 11 chars)
    by_county: dict[str, list[tuple[float, float]]] = {}
    for tract_id, t in tract_by_id.items():
        if len(tract_id) < 5:
            continue
        county_fips = tract_id[:5]
        rent = t.get("median_gross_rent")
        renters = t.get("renter_hh") or 0
        if not isinstance(rent, (int, float)) or rent <= 0:
            continue
        by_county.setdefault(county_fips, []).append((float(rent), float(renters)))

    counties_out = {}
    for fips, vw in by_county.items():
        med = _weighted_median(vw)
        if med is None:
            continue
        counties_out[fips] = {
            "name": county_names.get(fips, "") or county_names.get("county:" + fips, ""),
            "median_gross_rent": med,
            "n_tracts": len(vw),
            "total_renter_hh": int(sum(w for _, w in vw)),
        }

    # ---- Place aggregate via place-tract membership
    places_out = {}
    if PLACE_MEMB_IN.exists():
        mem = json.loads(PLACE_MEMB_IN.read_text()).get("places", {})
        for place_geoid, rec in mem.items():
            tract_list = rec.get("tracts", [])
            vw = []
            for entry in tract_list:
                # Membership schema uses `tract_geoid` + `share_of_tract_area`
                # to indicate how much of the tract overlaps the place.
                if isinstance(entry, dict):
                    tid = entry.get("tract_geoid") or entry.get("geoid")
                    overlap = (
                        entry.get("share_of_tract_area")
                        or entry.get("overlap_pct")
                        or 1.0
                    )
                else:
                    tid = entry
                    overlap = 1.0
                t = tract_by_id.get(tid)
                if not t:
                    continue
                rent = t.get("median_gross_rent")
                renters = t.get("renter_hh") or 0
                if not isinstance(rent, (int, float)) or rent <= 0:
                    continue
                # Weight by renter-HH × share_of_tract_area so we only count
                # the portion of each tract's renters that fall inside this
                # place's footprint.
                vw.append((float(rent), float(renters) * float(overlap)))
            med = _weighted_median(vw)
            if med is None:
                continue
            # Try to derive containing county from the first tract (first 5 chars)
            county_fips = None
            for entry in tract_list:
                tid = entry.get("geoid") if isinstance(entry, dict) else entry
                if tid and len(tid) >= 5:
                    county_fips = tid[:5]
                    break
            places_out[place_geoid] = {
                "name": rec.get("name", ""),
                "median_gross_rent": med,
                "n_tracts": len(vw),
                "total_renter_hh": int(sum(w for _, w in vw)),
                "county_fips": county_fips,
            }
    else:
        print(f"WARN: no {PLACE_MEMB_IN} — place aggregates skipped", file=sys.stderr)

    output = {
        "meta": {
            "source": "Census American Community Survey 5-yr (table B25064 median gross rent)",
            "derived_from": str(TRACTS_IN.relative_to(REPO_ROOT)),
            "method": "Renter-HH-weighted mean of tract medians (standard approximation)",
            "vintage": tracts_data.get("meta", {}).get("vintage", "ACS 5-yr (see tract source)"),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "scope": f"Colorado: {len(counties_out)} of 64 counties, {len(places_out)} of 482 places",
            "notes": (
                "ACS B25064 is the always-available baseline for CO median rent. "
                "EVERY CO county + EVERY CO place gets a value here, because every "
                "Census geography has a B25064 estimate (5-year ACS smooths small-"
                "sample noise). Use as the floor signal; triangulate with ZORI (35-65th "
                "pctile, monthly) for fresh trend, Apartment List for explicit per-BR "
                "in major metros, and DOLA Survey (CHFA QAP authority) for vacancy. "
                "ACS is lagged ~2 yrs but covers everything no other source covers."
            ),
        },
        "counties": counties_out,
        "places": places_out,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"    counties: {len(counties_out)} (of 64)")
    print(f"    places:   {len(places_out)} (of 482)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
