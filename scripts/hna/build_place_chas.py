#!/usr/bin/env python3
"""
build_place_chas.py
===================
Build a place-level cost-burden dataset by aggregating HUD CHAS tract-level
records up to Colorado places and CDPs.

Background
----------
``data/hna/chas_affordability_gap.json`` is keyed by 5-digit county FIPS.
Until now, ``build_ranking_index.py`` exposed county-level cost-burden
percentages (``pct_burdened_lte30``, ``pct_burdened_31to50``,
``pct_burdened_51to80``) on every place/CDP record, so two places in the
same county appeared to have identical cost-burden mix even when their
underlying renter income distributions are different.

PR #768 fixed the AMI gap fields by pulling place-level ACS B19001+B25063
directly. CHAS has no place-level publication (HUD ships sumlevels 050,
140, 160, 170 separately and the 160/place file is gated behind a CDN
WAF challenge), so we aggregate the tract file ourselves:

  1. ``scripts/fetch_chas.py`` now persists tract-level records to
     ``data/market/chas_co_tract.json`` (added in this PR).
  2. ``data/hna/derived/tract_place_lookup.json`` maps each tract GEOID
     to its dominant containing place via the Census Geocoder. Built
     once on first run; cached for reuse.
  3. For each place, sum the per-AMI-tier ``total`` and burden counts
     across the tracts mapped to it. Compute ``pct_burdened`` per tier.
  4. Output ``data/co_chas_by_place.json`` keyed by 7-digit place GEOID.

Limitations
-----------
* Tracts are assigned to a single place via centroid containment. A
  tract that spans a place boundary contributes ALL its counts to the
  place containing its centroid. For most Colorado places this is fine
  (tracts mostly fit inside a place or sit entirely outside any place);
  it's worst for very small CDPs where the tract is bigger than the
  CDP itself.
* Tracts that fall outside any incorporated/designated place are
  unmapped and contribute to no place — they belong to unincorporated
  county area. Those rows are still in the county-level file.
* In Colorado, most tracts have centroids in unincorporated land, so
  this approach yields a small-N place set (~50 places). The places
  that DO get tract aggregation are mostly large incorporated cities
  (Denver, Aurora, Boulder, Fort Collins, etc.). Smaller CDPs and
  rural towns inherit the county CHAS via build_ranking_index.py.
  A future PR can replace centroid containment with a TIGER PLACE
  shapefile spatial join (geopandas) to capture ALL tracts that
  intersect a place, with population-weighted apportionment for
  partially-overlapping tracts.
* Each place record carries ``tract_count`` and ``total_renter_hh``
  so callers can decide whether the aggregation is dense enough to
  surface.

Usage
-----
    python3 scripts/hna/build_place_chas.py
    python3 scripts/hna/build_place_chas.py --rebuild-cache
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRACT_INPUT = os.path.join(REPO_ROOT, "data", "market", "chas_co_tract.json")
TRACT_CENTROIDS = os.path.join(REPO_ROOT, "data", "market", "tract_centroids_co.json")
TRACT_PLACE_CACHE = os.path.join(
    REPO_ROOT, "data", "hna", "derived", "tract_place_lookup.json"
)
COUNTY_CHAS = os.path.join(REPO_ROOT, "data", "hna", "chas_affordability_gap.json")
OUT_FILE = os.path.join(REPO_ROOT, "data", "co_chas_by_place.json")

GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
COLORADO_FIPS = "08"
AMI_TIERS = ("lte30", "31to50", "51to80", "81to100")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get_json(url: str, *, timeout: int = 30, retries: int = 3) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0 build_place_chas.py"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


def lookup_place_for_centroid(lat: float, lon: float) -> str | None:
    """Return the 7-digit place GEOID containing (lat, lon), or None.

    Hits the Census Geocoder with both Incorporated Places and Census
    Designated Places layers. Incorporated takes precedence when the point
    lies within both (rare; CDPs are typically outside city limits). If the
    centroid falls in unincorporated land, returns None.
    """
    params = {
        "x": str(lon),
        "y": str(lat),
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "layers": "Incorporated Places,Census Designated Places",
        "format": "json",
    }
    url = f"{GEOCODER_BASE}?{urllib.parse.urlencode(params)}"
    try:
        d = http_get_json(url, timeout=15, retries=2)
    except Exception:  # noqa: BLE001
        return None
    geos = d.get("result", {}).get("geographies", {}) or {}
    for layer in ("Incorporated Places", "Census Designated Places"):
        rows = geos.get(layer) or []
        if not rows:
            continue
        geoid = str(rows[0].get("GEOID", "")).zfill(7)
        if geoid and len(geoid) == 7:
            return geoid
    return None


def build_tract_place_cache() -> dict[str, str]:
    """Build {tract_geoid11: place_geoid7} via Census Geocoder. Cached at
    TRACT_PLACE_CACHE. Tracts not in any place get value '' (empty string).
    """
    with open(TRACT_CENTROIDS, "r", encoding="utf-8") as f:
        centroids_doc = json.load(f)
    tracts = centroids_doc.get("tracts", [])
    print(f"  Building tract→place lookup ({len(tracts)} tracts via Geocoder)...")

    out: dict[str, str] = {}
    api_failures = 0
    no_place = 0
    for i, t in enumerate(tracts, 1):
        geoid = str(t.get("geoid", "")).zfill(11)
        lat = t.get("lat")
        lon = t.get("lon")
        if not geoid or lat is None or lon is None:
            continue
        try:
            place = lookup_place_for_centroid(float(lat), float(lon))
        except Exception:  # noqa: BLE001
            place = None
            api_failures += 1
        out[geoid] = place or ""
        if not place:
            no_place += 1
        if i % 100 == 0:
            print(f"    looked up {i}/{len(tracts)} "
                  f"(unmapped: {no_place}, errors: {api_failures})")
        time.sleep(0.05)  # polite pacing

    print(f"  Final: {len(out)} tract→place mappings "
          f"(in-place: {len(out) - no_place}, unincorporated: {no_place}, "
          f"errors: {api_failures})")

    os.makedirs(os.path.dirname(TRACT_PLACE_CACHE), exist_ok=True)
    payload = {
        "meta": {
            "generated_at": utc_now(),
            "source": "Census Geocoder coordinates → "
                      "Incorporated Places + Census Designated Places",
            "tract_count": len(out),
            "in_place_count": len(out) - no_place,
            "unincorporated_count": no_place,
            "api_failures": api_failures,
        },
        "tracts": out,
    }
    with open(TRACT_PLACE_CACHE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    print(f"  Cached to {TRACT_PLACE_CACHE}")
    return out


def load_tract_place_cache() -> dict[str, str]:
    if not os.path.exists(TRACT_PLACE_CACHE):
        return {}
    with open(TRACT_PLACE_CACHE, "r", encoding="utf-8") as f:
        d = json.load(f)
    return d.get("tracts", {}) if isinstance(d, dict) else {}


def load_tract_chas() -> list[dict]:
    if not os.path.exists(TRACT_INPUT):
        raise SystemExit(
            f"✗ {TRACT_INPUT} missing — run scripts/fetch_chas.py first."
        )
    with open(TRACT_INPUT, "r", encoding="utf-8") as f:
        d = json.load(f)
    return d.get("records", []) if isinstance(d, dict) else []


def load_county_renter_totals() -> dict[str, int]:
    """Return {county_fips5: total_renter_hh} from the county CHAS file.

    Used for coverage calculation — what fraction of a county's renters
    are captured by the tracts we mapped into each place.
    """
    out: dict[str, int] = {}
    if not os.path.exists(COUNTY_CHAS):
        return out
    with open(COUNTY_CHAS, "r", encoding="utf-8") as f:
        d = json.load(f)
    for fips5, county in (d.get("counties", {}) or {}).items():
        renter = county.get("renter_hh_by_ami", {}) or {}
        total = sum(int(renter.get(t, {}).get("total", 0) or 0) for t in AMI_TIERS)
        out[str(fips5).zfill(5)] = total
    return out


def aggregate_to_places(
    tract_records: list[dict], tract_to_place: dict[str, str]
) -> dict[str, dict]:
    """Sum tract records into place-level renter/owner cost-burden tables.

    Returns {place_geoid7: {renter_hh_by_ami: {...}, owner_hh_by_ami: {...},
                            tract_count: int, total_renter_hh: int}}.
    """

    def _empty_tier() -> dict[str, int]:
        return {
            "total": 0,
            "cost_burdened_30pct": 0,
            "cost_burdened_50pct": 0,
        }

    def _zero_record() -> dict:
        return {
            "renter_hh_by_ami": {t: _empty_tier() for t in AMI_TIERS},
            "owner_hh_by_ami":  {t: _empty_tier() for t in AMI_TIERS},
            "tract_count": 0,
            "total_renter_hh": 0,
        }

    out: dict[str, dict] = {}

    for rec in tract_records:
        tract_geoid = str(rec.get("geoid", "")).zfill(11)
        place_geoid = tract_to_place.get(tract_geoid, "")
        if not place_geoid:
            continue  # unincorporated — not aggregated to any place

        bucket = out.setdefault(place_geoid, _zero_record())
        bucket["tract_count"] += 1

        for tenure_key in ("renter_hh_by_ami", "owner_hh_by_ami"):
            src = rec.get(tenure_key, {}) or {}
            dst = bucket[tenure_key]
            for tier in AMI_TIERS:
                src_tier = src.get(tier, {}) or {}
                dst_tier = dst[tier]
                dst_tier["total"] += int(src_tier.get("total", 0) or 0)
                dst_tier["cost_burdened_30pct"] += int(
                    src_tier.get("cost_burdened_30pct",
                                 src_tier.get("cost_burdened", 0)) or 0
                )
                dst_tier["cost_burdened_50pct"] += int(
                    src_tier.get("cost_burdened_50pct",
                                 src_tier.get("severely_burdened", 0)) or 0
                )

        # Track total renter HH for coverage calc
        bucket["total_renter_hh"] = sum(
            bucket["renter_hh_by_ami"][t]["total"] for t in AMI_TIERS
        )

    # Compute pct_burdened per tier (matches the schema build_ranking_index expects)
    for place_geoid, rec in out.items():
        for tenure_key in ("renter_hh_by_ami", "owner_hh_by_ami"):
            for tier in AMI_TIERS:
                td = rec[tenure_key][tier]
                total = td["total"]
                cb30 = td["cost_burdened_30pct"]
                # Legacy alias the rest of the code reads
                td["cost_burdened"] = cb30
                td["severely_burdened"] = td["cost_burdened_50pct"]
                td["pct_cost_burdened"] = (
                    round(cb30 / total, 4) if total > 0 else 0.0
                )

    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--rebuild-cache", action="store_true",
        help="Force rebuild of the tract→place cache via Census Geocoder.",
    )
    p.add_argument(
        "--out", default=OUT_FILE,
        help=f"Output path (default: {OUT_FILE}).",
    )
    args = p.parse_args()

    print("Building place-level CHAS cost-burden from tract aggregation...")

    tract_records = load_tract_chas()
    print(f"  Loaded {len(tract_records)} tract records from {TRACT_INPUT}")

    if args.rebuild_cache or not os.path.exists(TRACT_PLACE_CACHE):
        tract_to_place = build_tract_place_cache()
    else:
        tract_to_place = load_tract_place_cache()
    in_place = sum(1 for v in tract_to_place.values() if v)
    print(f"  Loaded {len(tract_to_place)} tract→place mappings "
          f"({in_place} mapped, {len(tract_to_place) - in_place} unincorporated)")

    place_map = aggregate_to_places(tract_records, tract_to_place)
    print(f"  Built {len(place_map)} place records from tract aggregation")

    # Build output records
    county_renter_totals = load_county_renter_totals()
    records: dict[str, Any] = {}
    for place_geoid, rec in sorted(place_map.items()):
        # Coverage: this place's renter HH ÷ containing-county's renter HH.
        # >1.0 is fine for densely tract-covered places where the
        # tract centroid happens to fall in this place but the tract
        # extends across boundaries.
        county_fips5 = ""
        # Heuristic: pick the first tract's county as the place's county.
        # This is good enough for coverage display; the actual containing-
        # county comes from data/hna/derived/place_county_lookup.json.
        for tract_geoid, mapped_place in tract_to_place.items():
            if mapped_place == place_geoid:
                county_fips5 = tract_geoid[:5]
                break
        county_total = county_renter_totals.get(county_fips5, 0)
        coverage = (
            round(rec["total_renter_hh"] / county_total, 3)
            if county_total > 0 else 0.0
        )
        records[place_geoid] = {
            "geoid": place_geoid,
            "tract_count": rec["tract_count"],
            "total_renter_hh": rec["total_renter_hh"],
            "containing_county_fips": county_fips5,
            "county_renter_hh": county_total,
            "coverage_vs_county": coverage,
            "renter_hh_by_ami": rec["renter_hh_by_ami"],
            "owner_hh_by_ami":  rec["owner_hh_by_ami"],
        }

    payload = {
        "meta": {
            "state": "CO",
            "generated_at": utc_now(),
            "source": "HUD CHAS sumlevel-140 (tract) aggregated to place via "
                      "Census Geocoder centroid containment",
            "place_count": len(records),
            "method": "tract_centroid_containment",
            "note": "Tracts are assigned to a single place by centroid "
                    "containment (Geocoder layers: Incorporated Places + "
                    "Census Designated Places). Tracts with centroid in "
                    "unincorporated land contribute to no place. Coverage "
                    "field shows tracted-place renter HH ÷ county renter HH.",
        },
        "places": records,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"✓ Wrote {len(records)} place records to {args.out}")

    # Sanity check: Fruita and Clifton should differ
    def _tier_pct(rec: dict, tier: str) -> float:
        td = rec.get("renter_hh_by_ami", {}).get(tier, {})
        total = td.get("total", 0)
        cb30 = td.get("cost_burdened_30pct", 0)
        return round(100 * cb30 / total, 1) if total > 0 else 0.0

    fruita = records.get("0828745")
    clifton = records.get("0815165")
    if fruita and clifton:
        f_lte30 = _tier_pct(fruita, "lte30")
        c_lte30 = _tier_pct(clifton, "lte30")
        print(f"  Sanity: Fruita lte30 burdened%  = {f_lte30}% "
              f"({fruita['tract_count']} tracts, "
              f"{fruita['total_renter_hh']} renter HH, "
              f"coverage {fruita['coverage_vs_county']:.1%})")
        print(f"          Clifton lte30 burdened% = {c_lte30}% "
              f"({clifton['tract_count']} tracts, "
              f"{clifton['total_renter_hh']} renter HH, "
              f"coverage {clifton['coverage_vs_county']:.1%})")
        if abs(f_lte30 - c_lte30) > 1.0:
            print(f"  ✓ Fruita vs Clifton lte30 differ ({abs(f_lte30 - c_lte30):.1f} pts).")
        else:
            print("  ⚠ Fruita and Clifton lte30 within 1pt — investigate "
                  "(may legitimately match if both tracts had similar burden).",
                  file=sys.stderr)
    else:
        print(f"  ⚠ Fruita/Clifton not found in output — Fruita: {bool(fruita)}, "
              f"Clifton: {bool(clifton)}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
