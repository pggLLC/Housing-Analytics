#!/usr/bin/env python3
"""Build the HNA comparative ranking index.

Reads all data/hna/summary/{geoid}.json files and cross-references:
  - data/hna/projections/{countyFips5}.json  (population projections)
  - data/hna/chas_affordability_gap.json     (cost-burden by AMI tier)
  - data/co_ami_gap_by_county.json           (affordability gap units, county)
  - data/co_ami_gap_by_place.json            (affordability gap units, place;
                                              preferred for places/CDPs)

Writes:
  data/hna/ranking-index.json

Designed to run in GitHub Actions after build_hna_data.py completes.
"""

from __future__ import annotations

import glob
import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGIONS: dict[str, list[str]] = {
    "Front Range":   ["08001", "08005", "08013", "08014", "08019", "08031",
                      "08035", "08041", "08059", "08069", "08101", "08123"],
    "Western Slope": ["08007", "08029", "08045", "08051", "08053",
                      "08077", "08085", "08103", "08113", "08121"],
    "Mountains":     ["08009", "08015", "08037", "08047", "08049", "08065",
                      "08093", "08097", "08107", "08117", "08119"],
    "Eastern Plains":["08011", "08017", "08023", "08025", "08039", "08057",
                      "08061", "08063", "08071", "08073", "08075", "08079",
                      "08087", "08089", "08095", "08099", "08111", "08115", "08125"],
    "San Luis Valley":["08003", "08021", "08055", "08083", "08105", "08109"],
    "Southwest":     ["08027", "08033", "08043", "08067", "08081", "08091"],
}

# Build reversed lookup: county fips -> region
COUNTY_REGION: dict[str, str] = {}
for _region, _fips_list in REGIONS.items():
    for _fips in _fips_list:
        COUNTY_REGION[_fips] = _region


_ACS_SENTINEL_THRESHOLD: float = -1_000_000.0
# Geographies where more than this fraction of critical metrics are null
# are flagged with hasIncompleteData: true in the ranking output.
_INCOMPLETE_DATA_THRESHOLD = 0.2
_MIN_RATE_DENOMINATOR = 50

# QAP-aligned axis weights. CHFA's screenable QAP categories are Community
# Need (25 pts) and Geography / Opportunity (20 pts), roughly 55 / 45.
AXIS_WEIGHTS = {
    "community_need": 0.55,
    "opportunity": 0.45,
}

COMMUNITY_NEED_WEIGHTS = {
    "gap_pressure_score": 0.35,
    "cost_burden_pressure_score": 0.25,
    "affordability_intensity_score": 0.15,
    "future_pressure_score": 0.15,
}

OPPORTUNITY_WEIGHTS = {
    "opportunity_mobility_score": 0.35,
    "walkability_score": 0.25,
    "amenity_access_score": 0.25,
    "qct_dda_score": 0.15,
}

COMMUTER_AUGMENT_ALPHA = 0.15

GAP_COUNT_WEIGHT = 0.5
GAP_RATE_WEIGHT = 0.5
COST_ALL_RENTER_WEIGHT = 0.40
COST_SEVERE_WEIGHT = 0.30
COST_DEEP_TIER_WEIGHT = 0.30
AFFORDABILITY_HOMEBUYER_WEIGHT = 0.50
AFFORDABILITY_RENTER_WEIGHT = 0.50
FUTURE_UNITS_WEIGHT = 0.70
FUTURE_SENIOR_WEIGHT = 0.30
CONFIDENCE_PENALTY_PER_IMPUTED_FACTOR = 0.03
CONFIDENCE_PENALTY_PER_APPROXIMATED_FIELD = 0.01
MIN_CONFIDENCE_MULTIPLIER = 0.85


def utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_float(val, default: float = 0.0) -> float:
    """Convert value to float, returning *default* on failure or sentinel.

    ACS API responses include -666666666 for variables that are "not
    available" for a geography.  Passing this value through to ranking
    calculations produces wildly incorrect sort results, so any numeric
    value ≤ ``_ACS_SENTINEL_THRESHOLD`` is treated as missing and mapped
    to *default*.
    """
    if val is None:
        return default
    try:
        f = float(val)
        if f <= _ACS_SENTINEL_THRESHOLD:
            return default
        return f
    except (TypeError, ValueError, OverflowError):
        return default


def _load_json(path: str) -> dict | list | None:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"  [warn] could not load {path}: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Load cross-reference datasets
# ---------------------------------------------------------------------------

def load_ami_gap() -> dict[str, dict]:
    """Return dict keyed by 5-digit county FIPS with AMI gap metrics."""
    path = os.path.join(ROOT, "data", "co_ami_gap_by_county.json")
    data = _load_json(path)
    if not data:
        return {}
    result: dict[str, dict] = {}
    counties = data.get("counties", [])
    if isinstance(counties, list):
        for c in counties:
            fips = str(c.get("fips", "")).zfill(5)
            if fips:
                result[fips] = c
    return result


def load_ami_gap_by_place() -> dict[str, dict]:
    """Return dict keyed by 7-digit place GEOID with place-specific AMI gap metrics.

    This file is produced by ``scripts/hna/build_place_ami_gap.py`` and replaces
    the previous behaviour of proportionally scaling county aggregates by
    population share. Place-specific data fixes the systemic bug where two
    places in the same county (e.g. Fruita and Clifton, both Mesa County)
    appeared to have identical AMI mix profiles. When this file is missing
    or a particular place is absent, callers fall back to county-scaled.
    """
    path = os.path.join(ROOT, "data", "co_ami_gap_by_place.json")
    data = _load_json(path)
    if not data:
        return {}
    places = data.get("places", {})
    if isinstance(places, dict):
        # Normalize keys to 7-digit
        return {str(k).zfill(7): v for k, v in places.items()}
    return {}


def load_chas() -> dict[str, dict]:
    """Return dict keyed by 5-digit county FIPS with CHAS cost-burden data."""
    path = os.path.join(ROOT, "data", "hna", "chas_affordability_gap.json")
    data = _load_json(path)
    if not data:
        return {}
    counties = data.get("counties", {})
    if isinstance(counties, dict):
        return counties
    return {}


def load_place_chas() -> dict[str, dict]:
    """Return dict keyed by 7-digit place GEOID with TIGER-apportioned place CHAS.

    Produced by ``scripts/hna/build_place_chas.py`` via area-weighted tract
    apportionment of HUD CHAS 2018-2022 against TIGER 2024 place boundaries.
    Each record carries the same ``renter_hh_by_ami`` schema as the county
    file. When a place is absent (no TIGER coverage), callers fall back to
    the county aggregate so the ranking-index always emits a value.
    """
    path = os.path.join(ROOT, "data", "hna", "place-chas.json")
    data = _load_json(path)
    if not data:
        return {}
    places = data.get("places", {})
    if isinstance(places, dict):
        return {str(k).zfill(7): v for k, v in places.items()}
    return {}


def load_place_lehd() -> dict[str, dict]:
    """Return dict keyed by 7-digit place GEOID with TIGER-apportioned place LEHD.

    Produced by ``scripts/hna/build_place_lehd.py`` from county-level LEHD
    WAC tables apportioned by place-pop share across each county the place
    spans. Each record's ``lehd`` block exposes ``inflow`` / ``within`` /
    ``outflow`` / ``C000`` in the same shape as the county LEHD files.
    """
    path = os.path.join(ROOT, "data", "hna", "place-lehd.json")
    data = _load_json(path)
    if not data:
        return {}
    places = data.get("places", {})
    if isinstance(places, dict):
        return {str(k).zfill(7): v for k, v in places.items()}
    return {}


def load_lehd_index() -> dict[str, dict]:
    """Return dict keyed by 5-digit county FIPS with LEHD commuting data.

    Only county-level LEHD files (8-digit filenames like '08001.json') are
    loaded; place/CDP files are excluded because they roll up to county.
    """
    lehd_dir = os.path.join(ROOT, "data", "hna", "lehd")
    result: dict[str, dict] = {}
    if not os.path.isdir(lehd_dir):
        return result
    for fname in os.listdir(lehd_dir):
        if not fname.endswith(".json"):
            continue
        fips = fname[:-5].zfill(5)
        # Only 5-digit county FIPS files (e.g. 08001.json)
        if len(fips) != 5:
            continue
        data = _load_json(os.path.join(lehd_dir, fname))
        if data and isinstance(data, dict):
            result[fips] = data
    return result


def load_projection(county_fips5: str) -> dict | None:
    """Load DOLA population projection for a county."""
    path = os.path.join(ROOT, "data", "hna", "projections", f"{county_fips5}.json")
    return _load_json(path)


def load_sya(county_fips5: str) -> dict | None:
    """Load DOLA single-year-age projection for a county."""
    path = os.path.join(ROOT, "data", "hna", "dola_sya", f"{county_fips5}.json")
    return _load_json(path)


def load_county_populations() -> dict[str, int]:
    """Return dict keyed by 5-digit county FIPS with ACS population.

    Reads DP05_0001E from each county summary file so that place/CDP
    in-commuter counts can be scaled by the place's share of county
    population rather than being assigned the full county inflow.
    """
    summary_dir = os.path.join(ROOT, "data", "hna", "summary")
    result: dict[str, int] = {}
    if not os.path.isdir(summary_dir):
        return result
    for fname in os.listdir(summary_dir):
        if not fname.endswith(".json"):
            continue
        fips = fname[:-5]
        # Only 5-digit county FIPS files (e.g. 08013.json)
        if len(fips) != 5:
            continue
        data = _load_json(os.path.join(summary_dir, fname))
        if data and isinstance(data, dict):
            pop = safe_float(data.get("acsProfile", {}).get("DP05_0001E", 0))
            if pop > 0:
                result[fips] = int(pop)
    return result


def load_summary_populations() -> dict[str, int]:
    """Return ACS population keyed by any summary GEOID."""
    summary_dir = os.path.join(ROOT, "data", "hna", "summary")
    result: dict[str, int] = {}
    if not os.path.isdir(summary_dir):
        return result
    for fname in os.listdir(summary_dir):
        if not fname.endswith(".json"):
            continue
        geoid = fname[:-5]
        data = _load_json(os.path.join(summary_dir, fname))
        if data and isinstance(data, dict):
            pop = safe_float(data.get("acsProfile", {}).get("DP05_0001E"))
            if pop > 0:
                result[geoid] = int(pop)
    return result


def _load_tract_populations() -> dict[str, float]:
    path = os.path.join(ROOT, "data", "market", "acs_tract_metrics_co.json")
    data = _load_json(path) or {}
    tracts = data.get("tracts", []) if isinstance(data, dict) else []
    result: dict[str, float] = {}
    for rec in sorted(tracts, key=lambda r: str(r.get("geoid", ""))):
        geoid = str(rec.get("geoid", ""))
        pop = safe_float(rec.get("pop"))
        if geoid and pop > 0:
            result[geoid] = pop
    return result


def _weighted(values: list[tuple[float, float]]) -> float | None:
    ordered = sorted(values, key=lambda item: (float(item[0]), float(item[1])))
    den = sum(w for _v, w in ordered if w > 0)
    if den <= 0:
        return None
    return sum(v * w for v, w in ordered if w > 0) / den


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_mi = 3958.8
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return radius_mi * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _load_point_features(rel_path: str) -> list[tuple[float, float]]:
    data = _load_json(os.path.join(ROOT, rel_path)) or {}
    result: list[tuple[float, float]] = []
    features = data.get("features", []) if isinstance(data, dict) else []
    for feat in sorted(
        features,
        key=lambda f: tuple(f.get("geometry", {}).get("coordinates", [])) if isinstance(f, dict) else (),
    ):
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates", [])
        if geom.get("type") == "Point" and len(coords) >= 2:
            lon = safe_float(coords[0], default=float("nan"))
            lat = safe_float(coords[1], default=float("nan"))
            if math.isfinite(lat) and math.isfinite(lon):
                result.append((lat, lon))
    return sorted(result)


def build_opportunity_context() -> dict[str, dict]:
    """Aggregate tract/amenity opportunity layers to place and county GEOIDs.

    Place tract aggregation is population-weighted using tract population times
    share_of_tract_area. When tract population is unavailable, share_of_place_area
    provides a deterministic fallback. County rows are county-context aggregates.
    """
    membership_data = _load_json(os.path.join(ROOT, "data", "hna", "place-tract-membership.json")) or {}
    memberships = membership_data.get("places", {}) if isinstance(membership_data, dict) else {}
    tract_pop = _load_tract_populations()

    oi = _load_json(os.path.join(ROOT, "data", "market", "opportunity_insights_co.json")) or {}
    mobility_by_tract = {
        str(k): safe_float(v.get("mobilityIndex"), default=float("nan"))
        for k, v in sorted((oi.get("tracts", {}) if isinstance(oi, dict) else {}).items())
    }

    walk_data = _load_json(os.path.join(ROOT, "data", "market", "walkability_scores_co.json")) or {}
    walk_by_tract = {}
    walk_rows = walk_data.get("tracts", []) if isinstance(walk_data, dict) else []
    for rec in sorted(walk_rows, key=lambda r: str(r.get("geoid", ""))):
        geoid = str(rec.get("geoid", ""))
        walk = safe_float(rec.get("walk_score"), default=float("nan"))
        transit = safe_float(rec.get("transit_score"), default=float("nan"))
        if geoid and math.isfinite(walk) and math.isfinite(transit):
            walk_by_tract[geoid] = (walk + transit) / 2
        elif geoid and math.isfinite(walk):
            walk_by_tract[geoid] = walk

    qct_tracts_seen = set()
    qct = _load_json(os.path.join(ROOT, "data", "qct-colorado.json")) or {}
    qct_features = qct.get("features", []) if isinstance(qct, dict) else []
    for feat in sorted(qct_features, key=lambda f: str(f.get("properties", {}).get("GEOID", ""))):
        geoid = str(feat.get("properties", {}).get("GEOID", ""))
        if len(geoid) == 11:
            qct_tracts_seen.add(geoid)
    qct_tracts = sorted(qct_tracts_seen)
    qct_tract_lookup = set(qct_tracts)

    dda_counties_seen = set()
    dda = _load_json(os.path.join(ROOT, "data", "dda-colorado.json")) or {}
    dda_features = dda.get("features", []) if isinstance(dda, dict) else []
    for feat in sorted(dda_features, key=lambda f: str(f.get("properties", {}).get("GEOID", ""))):
        geoid = str(feat.get("properties", {}).get("GEOID", ""))
        if len(geoid) == 5:
            dda_counties_seen.add(geoid)
    dda_counties = sorted(dda_counties_seen)
    dda_county_lookup = set(dda_counties)

    centroids_data = _load_json(os.path.join(ROOT, "data", "co-place-centroids.json")) or {}
    centroids = centroids_data.get("byGeoid", {}) if isinstance(centroids_data, dict) else {}
    amenities = {
        "grocery": (_load_point_features("data/amenities/grocery_co.geojson"), 8.0),
        "healthcare": (_load_point_features("data/amenities/healthcare_co.geojson"), 10.0),
        "schools": (_load_point_features("data/amenities/schools_co.geojson"), 6.0),
        "transit": (_load_point_features("data/amenities/transit_stops_co.geojson"), 3.0),
    }
    populations = load_summary_populations()

    place_context: dict[str, dict] = {}
    county_parts: dict[str, list[tuple[dict, float]]] = {}

    for place_geoid, place in sorted(memberships.items()):
        tract_rows = place.get("tracts", [])
        mobility_vals: list[tuple[float, float]] = []
        walk_vals: list[tuple[float, float]] = []
        qct_num = 0.0
        qct_den = 0.0
        counties_seen: set[str] = set()
        for row in sorted(tract_rows, key=lambda r: str(r.get("tract_geoid", ""))):
            tract = str(row.get("tract_geoid", ""))
            counties_seen.add(tract[:5])
            share = safe_float(row.get("share_of_tract_area", row.get("share_of_place_area", 0)))
            fallback_share = safe_float(row.get("share_of_place_area", 0))
            weight = tract_pop.get(tract, 0) * share
            if weight <= 0:
                weight = fallback_share
            mob = mobility_by_tract.get(tract)
            if isinstance(mob, (int, float)) and math.isfinite(mob):
                mobility_vals.append((mob, weight))
            walk = walk_by_tract.get(tract)
            if isinstance(walk, (int, float)) and math.isfinite(walk):
                walk_vals.append((walk, weight))
            qct_den += max(weight, 0)
            if tract in qct_tract_lookup:
                qct_num += max(weight, 0)

        mobility_score = _weighted(mobility_vals)
        walkability_score = _weighted(walk_vals)
        qct_share = (qct_num / qct_den) if qct_den > 0 else 0.0
        containing_county = sorted(counties_seen)[0] if counties_seen else str(place_geoid)[:5]
        dda_share = 1.0 if containing_county in dda_county_lookup else 0.0
        qct_dda_score = max(qct_share, dda_share) * 100

        amenity_scores: dict[str, float] = {}
        amenity_counts: dict[str, int] = {}
        centroid = centroids.get(str(place_geoid).zfill(7), {})
        lat = safe_float(centroid.get("lat"), default=float("nan"))
        lon = safe_float(centroid.get("lng"), default=float("nan"))
        if math.isfinite(lat) and math.isfinite(lon):
            for key, (points, radius) in sorted(amenities.items()):
                distances = [_haversine_miles(lat, lon, plat, plon) for plat, plon in points]
                within = [d for d in distances if d <= radius]
                nearest = min(distances) if distances else None
                count_score = min(len(within), 5) / 5 * 40
                distance_score = 0.0
                if nearest is not None and nearest <= radius:
                    distance_score = max(0.0, (1 - nearest / radius) * 60)
                amenity_scores[key] = round(min(100.0, count_score + distance_score), 1)
                amenity_counts[key] = len(within)
        amenity_access_score = _weighted([(v, 1.0) for v in amenity_scores.values()])
        amenity_context = "rural_sparsity" if amenity_counts and sum(amenity_counts.values()) == 0 else "centroid_radius"

        rec = {
            "opportunity_mobility_score": round(mobility_score, 1) if mobility_score is not None else None,
            "walkability_score": round(walkability_score, 1) if walkability_score is not None else None,
            "amenity_access_score": round(amenity_access_score, 1) if amenity_access_score is not None else None,
            "qct_dda_score": round(qct_dda_score, 1),
            "qct_share": round(qct_share * 100, 1),
            "dda_share": round(dda_share * 100, 1),
            "amenity_access_context": amenity_context,
            "opportunity_geography_level": "place",
            "_opportunity_aggregated_fields": [],
        }
        place_context[str(place_geoid).zfill(7)] = rec
        pop_weight = populations.get(str(place_geoid).zfill(7), 0) or 0
        for county in sorted(counties_seen or {containing_county}):
            county_parts.setdefault(county, []).append((rec, pop_weight or 1.0))

    context = dict(place_context)
    aliases = _load_json(os.path.join(ROOT, "data", "hna", "place-phantom-aliases.json")) or {}
    for alias, canonical in sorted((aliases.get("aliases", {}) if isinstance(aliases, dict) else {}).items()):
        alias7 = str(alias).zfill(7)
        canonical7 = str(canonical).zfill(7)
        if canonical7 in context and alias7 not in context:
            alias_rec = dict(context[canonical7])
            alias_rec["opportunity_geography_level"] = "place_alias"
            alias_rec["_opportunity_aggregated_fields"] = list(alias_rec.get("_opportunity_aggregated_fields", [])) + [
                "opportunity_alias_from_canonical_place"
            ]
            context[alias7] = alias_rec
    for county, parts in sorted(county_parts.items()):
        ordered_parts = sorted(
            parts,
            key=lambda item: (
                safe_float(item[0].get("opportunity_mobility_score"), default=-1),
                safe_float(item[0].get("walkability_score"), default=-1),
                safe_float(item[0].get("amenity_access_score"), default=-1),
                safe_float(item[0].get("qct_dda_score"), default=-1),
                safe_float(item[1], default=0),
            ),
        )
        rec: dict[str, Any] = {}
        for key in ("opportunity_mobility_score", "walkability_score", "amenity_access_score", "qct_dda_score", "qct_share", "dda_share"):
            val = _weighted([
                (safe_float(part.get(key), default=float("nan")), weight)
                for part, weight in ordered_parts
                if isinstance(part.get(key), (int, float))
            ])
            rec[key] = round(val, 1) if val is not None else None
        rec["amenity_access_context"] = "county_context"
        rec["opportunity_geography_level"] = "county_context"
        rec["_opportunity_aggregated_fields"] = [
            "opportunity_mobility_score",
            "walkability_score",
            "amenity_access_score",
            "qct_dda_score",
        ]
        context[county] = rec
    return context


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------

def _get_county_fips(geoid: str, geo_type: str) -> str:
    """Derive the 5-digit county FIPS from a geoid."""
    if geo_type == "county":
        return geoid[:5].zfill(5)
    # For places/CDPs, look up containingCounty from summary data
    return ""


def compute_metrics(
    summary: dict,
    ami_gap_by_county: dict[str, dict],
    ami_gap_by_place: dict[str, dict],
    chas_by_county: dict[str, dict],
    lehd_by_county: dict[str, dict],
    county_populations: dict[str, int] | None = None,
    chas_by_place: dict[str, dict] | None = None,
    lehd_by_place: dict[str, dict] | None = None,
    opportunity_context: dict[str, dict] | None = None,
) -> dict:
    """Derive ranking metrics from a summary record.

    Returns a metrics dict with:
      housing_gap_units          int   — gap at 30% AMI (county-only; place: scaled by pop share)
      ami_gap_50pct              int   — unit deficit at 50% AMI (additional beyond 30%)
      ami_gap_60pct              int   — unit deficit at 60% AMI (additional beyond 50%)
      pct_cost_burdened          float — % renters paying ≥30% of income (CHAS or ACS fallback)
      pct_burdened_lte30         float — CHAS: % of ≤30% AMI renters that are cost-burdened
      pct_burdened_31to50        float — CHAS: % of 31–50% AMI renters that are cost-burdened
      pct_burdened_51to80        float — CHAS: % of 51–80% AMI renters that are cost-burdened
      missing_ami_tiers          list  — AMI bands with coverage < 75% and deficit > 100 units
      in_commuters               int   — LEHD inflow (workers coming in from other counties)
      commute_ratio              float — inflow / (inflow + within), 0–100 pct
      population_projection_20yr int   — projected population 20 years out
      population                 int   — current ACS population
      median_hh_income           int   — ACS median household income
      vacancy_rate               float — rental vacancy %
      pct_renters                float — % renter-occupied
    """
    geo = summary.get("geo", {})
    geo_type: str = geo.get("type", "county")
    geoid: str = geo.get("geoid", "")

    acs = summary.get("acsProfile", {})

    # Track which critical ACS fields are null/missing for data quality reporting.
    # After ETL normalization, sentinel values are already stored as null (None).
    CRITICAL_ACS_FIELDS = [
        "DP05_0001E",   # population
        "DP03_0062E",   # median household income
        "DP04_0089E",   # median home value (used by HNA display only)
        "DP04_0134E",   # median gross rent
        "DP04_0047PE",  # % renter-occupied
    ]
    null_critical_count = sum(
        1 for f in CRITICAL_ACS_FIELDS if acs.get(f) is None
    )

    population = int(safe_float(acs.get("DP05_0001E")))
    households = int(safe_float(acs.get("DP02_0001E")))
    median_income = int(safe_float(acs.get("DP03_0062E")))
    pct_renter = safe_float(acs.get("DP04_0047PE"))
    gross_rent = int(safe_float(acs.get("DP04_0134E")))

    # Housing stock composition by structure type (ACS DP04 UNITS IN
    # STRUCTURE bins). ACS does NOT publish vacancy split by structure
    # type — vacancy_rate above is whole-rental-market only. These
    # composition shares give the user the context needed to interpret
    # a single vacancy figure: a 5% vacancy in a market that's 80%
    # multifamily reads very differently than 5% in a market that's
    # 80% single-family detached.
    #   pct_multifamily = 5+-unit structures (industry LIHTC convention)
    #   pct_sf_detached  = 1-unit detached (single-family-owner-occupied)
    #   pct_2to4_units    = small multifamily / duplex-fourplex
    pct_multifamily = 0.0
    pct_sf_detached = 0.0
    pct_2to4_units = 0.0
    # ACS DP04 structure-type breakdown (sum 0007E..0014E gives the
    # structure-of-units denom; DP04_0006E exists in the API but isn't
    # populated in our cached summaries, so derive the denom locally).
    _sf_detached = safe_float(acs.get("DP04_0007E"))
    _sf_attached = safe_float(acs.get("DP04_0008E"))
    _2units      = safe_float(acs.get("DP04_0009E"))
    _3to4        = safe_float(acs.get("DP04_0010E"))
    _5to9        = safe_float(acs.get("DP04_0011E"))
    _10to19      = safe_float(acs.get("DP04_0012E"))
    _20plus      = safe_float(acs.get("DP04_0013E"))
    _mobile      = safe_float(acs.get("DP04_0014E"))
    _struct_total = (_sf_detached + _sf_attached + _2units + _3to4
                     + _5to9 + _10to19 + _20plus + _mobile)
    if _struct_total > 0:
        _mf_5plus = _5to9 + _10to19 + _20plus
        _2to4 = _2units + _3to4
        pct_multifamily = round((_mf_5plus / _struct_total) * 100, 1)
        pct_sf_detached = round((_sf_detached / _struct_total) * 100, 1)
        pct_2to4_units  = round((_2to4 / _struct_total) * 100, 1)

    # Rental vacancy — DP04_0005E IS the rental vacancy RATE (a percentage),
    # NOT a count of vacant rental units. Prior versions of this script
    # treated it as a count and divided by rental_units, producing
    # essentially 0% for every county (Denver came out as 0% when ACS
    # reports it as 5.8%). Use the value directly. Verified field meaning
    # against ACS 2023 5-year DP04 codebook:
    #   DP04_0001E = total housing units
    #   DP04_0003E = total vacant units (count)
    #   DP04_0004E = HOMEOWNER vacancy rate (percentage)
    #   DP04_0005E = RENTAL vacancy rate (percentage)  ← the field we want
    #
    # Small-N suppression: ACS publishes rental vacancy as either a number
    # or null when the underlying rental sample is too small. Some
    # processors map suppression → 0.0, indistinguishable from a genuine
    # 0%. Apply our own small-N gate: emit null when the place's rental
    # household count is below ~50 (per the ACS data-quality guidance for
    # rate stability at this granularity).
    total_units = int(safe_float(acs.get("DP04_0001E")))
    rental_units = int(total_units * (pct_renter / 100.0)) if total_units and pct_renter else 0
    vac_raw = acs.get("DP04_0005E")
    if vac_raw is None or rental_units < 50:
        # Either ACS suppressed the value OR the rental denominator is
        # too small for the rate to be statistically meaningful. Emit
        # null so the UI renders "—" and footnotes the suppression.
        vacancy_rate = None
    else:
        # Clamp to [0, 50]. Above ~50% is a sample artifact, not real
        # market signal — every CO market that hits this ceiling on the
        # raw ACS table is a sub-50-rental-unit place.
        vac_pct = safe_float(vac_raw)
        vacancy_rate = round(min(50.0, max(0.0, vac_pct)), 1)

    # Cost burden:
    #   Primary: ACS DP04 GRAPI bins (DP04_0141PE + DP04_0142PE) = share of
    #     renter households paying ≥30% of income. This field is present for
    #     both counties and places/CDPs, so it's the most accurate per-place
    #     signal.
    #   Legacy: DP04_0146PE was the "computed" cost-burden % but is null in
    #     our ACS payloads, so we derive from the bins directly.
    #   For counties, this ACS value is still overridden below by CHAS
    #     aggregation which is more precise for AMI-tier stratification.
    grapi_30to34 = safe_float(acs.get("DP04_0141PE"))
    grapi_35plus = safe_float(acs.get("DP04_0142PE"))
    # ACS publishes DP04_0141PE and DP04_0142PE rounded to one decimal place
    # independently. Their sum can therefore exceed 100 by up to ~0.2 pts
    # purely from rounding (e.g. Louviers CDP: 49.7 + 50.4 = 100.1). Clamp
    # to [0, 100] so the downstream `pct_cost_burdened ∈ [0, 100]` invariant
    # holds for ranking + UI display. Pre-fix: integration test
    # `All pct_cost_burdened values in [0,100]` failed for ~1 entry per build.
    pct_cost_burdened_acs = round(
        max(0.0, min(100.0, grapi_30to34 + grapi_35plus)),
        1,
    )

    pct_cost_burdened = pct_cost_burdened_acs

    # Determine county FIPS for cross-reference lookups
    county_fips5 = ""
    if geo_type == "county":
        county_fips5 = geoid[:5].zfill(5) if geoid else ""
    else:
        # For places/CDPs, containingCounty may be in the summary geo block
        county_fips5 = geo.get("containingCounty", geoid[:5]).zfill(5)

    # --- AMI gap at 30% AMI (housing unit deficit) ---
    # Resolution order:
    #   1. Place-specific data from co_ami_gap_by_place.json (preferred for
    #      places/CDPs; built directly from ACS B19001+B25063 per place).
    #   2. County aggregate from co_ami_gap_by_county.json, scaled by
    #      population share for places/CDPs (legacy fallback).
    # The place-level path fixes the systemic bug where Fruita and Clifton
    # (both Mesa County) appeared identical because the county aggregate was
    # scaled by population without using each place's actual income/rent
    # distribution. See scripts/hna/build_place_ami_gap.py for methodology.
    housing_gap_units = 0
    ami_gap_30 = 0
    ami_gap_50 = 0
    ami_gap_60 = 0
    low_income_households_lte30 = 0
    missing_ami_tiers: list[str] = []
    ami_gap_source = "none"  # one of: none, place_acs_direct, county_direct, county_proportional

    place_geoid7 = ""
    if geo_type != "county" and geoid:
        place_geoid7 = str(geoid).zfill(7)

    place_data = ami_gap_by_place.get(place_geoid7) if place_geoid7 else None

    if place_data:
        gap_dict = place_data.get("gap_units_minus_households_le_ami_pct", {})
        coverage_dict = place_data.get("coverage_le_ami_pct", {})

        def _place_gap_abs(band: str) -> int:
            return int(abs(safe_float(gap_dict.get(band, 0))))

        low_income_households_lte30 = int(safe_float(
            place_data.get("households_le_ami_pct", {}).get("30", 0)
        ))
        housing_gap_units = _place_gap_abs("30")
        ami_gap_50 = _place_gap_abs("50")
        ami_gap_60 = _place_gap_abs("60")
        ami_gap_30 = housing_gap_units
        ami_gap_source = "place_acs_direct"

        # Identify missing AMI tiers from place coverage
        for band, label in [("30", "30%"), ("40", "40%"), ("50", "50%"),
                            ("60", "60%"), ("70", "70%"), ("80", "80%")]:
            cov = safe_float(coverage_dict.get(band, 1.0))
            deficit = int(abs(safe_float(gap_dict.get(band, 0))))
            if cov < 0.75 and deficit > 100:
                missing_ami_tiers.append(label)

    elif county_fips5 and county_fips5 in ami_gap_by_county:
        county_data = ami_gap_by_county[county_fips5]
        gap_dict = county_data.get("gap_units_minus_households_le_ami_pct", {})
        coverage_dict = county_data.get("coverage_le_ami_pct", {})

        def _county_gap_abs(band: str) -> int:
            return int(abs(safe_float(gap_dict.get(band, 0))))

        county_gap_30 = _county_gap_abs("30")
        county_gap_50 = _county_gap_abs("50")
        county_gap_60 = _county_gap_abs("60")
        county_low_income_lte30 = int(safe_float(
            county_data.get("households_le_ami_pct", {}).get("30", 0)
        ))

        if geo_type == "county":
            housing_gap_units = county_gap_30
            ami_gap_50 = county_gap_50
            ami_gap_60 = county_gap_60
            low_income_households_lte30 = county_low_income_lte30
            ami_gap_source = "county_direct"
        else:
            # Legacy fallback: scale county aggregate by population share.
            # Triggers only when place_acs_direct data is missing for this
            # place (e.g. very small CDPs where ACS suppresses cells).
            # Prefer ACS county population (from county_populations); fall back
            # to households_le_ami_pct["100"] when the county summary is absent.
            county_total = float((county_populations or {}).get(county_fips5, 0))
            if county_total <= 0:
                county_total = safe_float(
                    county_data.get("households_le_ami_pct", {}).get("100", households or 1)
                )
            place_pop = population or 0
            share = min(place_pop / county_total, 1.0) if county_total else 0.0
            housing_gap_units = int(county_gap_30 * share)
            ami_gap_50 = int(county_gap_50 * share)
            ami_gap_60 = int(county_gap_60 * share)
            low_income_households_lte30 = int(county_low_income_lte30 * share)
            ami_gap_source = "county_proportional"
        ami_gap_30 = housing_gap_units

        # Identify missing AMI tiers: coverage < 75% and absolute deficit > 100 units
        for band, label in [("30", "30%"), ("40", "40%"), ("50", "50%"),
                            ("60", "60%"), ("70", "70%"), ("80", "80%")]:
            cov = safe_float(coverage_dict.get(band, 1.0))
            raw_deficit = int(abs(safe_float(gap_dict.get(band, 0))))
            # Scale deficit to place/CDP size using the same share already computed
            if geo_type == "county":
                deficit = raw_deficit
            else:
                county_total_miss = float((county_populations or {}).get(county_fips5, 0))
                if county_total_miss <= 0:
                    county_total_miss = safe_float(
                        county_data.get("households_le_ami_pct", {}).get("100", 1)
                    )
                place_pop_miss = population or 0
                share_miss = min(place_pop_miss / county_total_miss, 1.0) if county_total_miss else 0.0
                deficit = int(raw_deficit * share_miss)
            if cov < 0.75 and deficit > 100:
                missing_ami_tiers.append(label)

    housing_gap_rate_lte30 = None
    if low_income_households_lte30 >= _MIN_RATE_DENOMINATOR:
        housing_gap_rate_lte30 = round(
            (housing_gap_units / max(low_income_households_lte30, 1)) * 100,
            1,
        )

    # --- CHAS cost-burden override and demographic stratification ---
    # Resolution order:
    #   1. Place-specific CHAS from data/hna/place-chas.json (preferred for
    #      places/CDPs; built via TIGER 2024 spatial apportionment of tract-
    #      level CHAS 2018-2022).
    #   2. County aggregate from data/hna/chas_affordability_gap.json
    #      (counties + fallback for places not covered by place-chas).
    # Pre-fix: every place inherited its county's tier burden rates, so
    # any two places in the same county showed identical pct_burdened_*.
    pct_burdened_lte30 = 0.0
    pct_burdened_31to50 = 0.0
    pct_burdened_51to80 = 0.0
    pct_burdened_81to100 = 0.0
    pct_burdened_100plus = 0.0
    pct_renter_severe_burdened = None
    pct_deep_tier_burdened = None
    # Owner-side single aggregate (≥30% of income spent on housing). Surfaced
    # so Compare can fall back to CHAS when ACS DP04 SMOCAPI bins are
    # small-N-suppressed for CDPs / small places.
    pct_owner_burdened_30plus = 0.0
    chas_source = "none"  # one of: none, place, county

    def _place_tier_pct(td: dict) -> float:
        """Place-CHAS tier %: prefer the pre-computed ratio; fall back to
        cost_burdened_30pct / total when only counts are present."""
        pct = safe_float(td.get("pct_cost_burdened_30"))
        if pct:
            return round(pct * 100, 1)
        total = safe_float(td.get("total", 0))
        burdened = safe_float(td.get("cost_burdened_30pct", 0))
        return round((burdened / total) * 100, 1) if total > 0 else 0.0

    place_chas_rec = (chas_by_place or {}).get(place_geoid7) if place_geoid7 else None
    if place_chas_rec:
        rba = place_chas_rec.get("renter_hh_by_ami", {})
        pct_burdened_lte30   = _place_tier_pct(rba.get("lte30", {}))
        pct_burdened_31to50  = _place_tier_pct(rba.get("31to50", {}))
        pct_burdened_51to80  = _place_tier_pct(rba.get("51to80", {}))
        pct_burdened_81to100 = _place_tier_pct(rba.get("81to100", {}))
        pct_burdened_100plus = _place_tier_pct(rba.get("100plus", {}))
        owner_share = safe_float(place_chas_rec.get("summary", {}).get("owner_cb30_share"))
        pct_owner_burdened_30plus = round(owner_share * 100, 1) if owner_share else 0.0
        severe_share = safe_float(place_chas_rec.get("summary", {}).get("renter_cb50_share"))
        if severe_share:
            pct_renter_severe_burdened = round(severe_share * 100, 1)
        deep_total = sum(safe_float(rba.get(k, {}).get("total", 0)) for k in ("lte30", "31to50"))
        deep_burdened = sum(safe_float(rba.get(k, {}).get("cost_burdened_30pct", 0)) for k in ("lte30", "31to50"))
        if deep_total >= _MIN_RATE_DENOMINATOR:
            pct_deep_tier_burdened = round((deep_burdened / deep_total) * 100, 1)
        chas_source = "place"
    elif county_fips5 in chas_by_county:
        chas_county = chas_by_county[county_fips5]
        renter_data = chas_county.get("renter_hh_by_ami", {})
        owner_data  = chas_county.get("owner_hh_by_ami", {})

        def _tier_pct(key: str, src: dict = renter_data) -> float:
            td = src.get(key, {})
            total = safe_float(td.get("total", 0))
            # County file has both `cost_burdened` (legacy) and the canonical
            # `cost_burdened_30pct`. Prefer the canonical field so the same
            # helper works against either schema vintage.
            burdened = safe_float(td.get("cost_burdened_30pct", td.get("cost_burdened", 0)))
            return round((burdened / total) * 100, 1) if total > 0 else 0.0

        pct_burdened_lte30   = _tier_pct("lte30")
        pct_burdened_31to50  = _tier_pct("31to50")
        pct_burdened_51to80  = _tier_pct("51to80")
        pct_burdened_81to100 = _tier_pct("81to100")
        pct_burdened_100plus = _tier_pct("100plus")

        # Owner aggregate ≥30% of income: sum cost_burdened_30pct across
        # all owner tiers, divide by total owner households across tiers.
        if owner_data:
            owner_total    = sum(safe_float(owner_data.get(k, {}).get("total", 0))                  for k in ("lte30", "31to50", "51to80", "81to100", "100plus"))
            owner_burdened = sum(safe_float(owner_data.get(k, {}).get("cost_burdened_30pct", 0))    for k in ("lte30", "31to50", "51to80", "81to100", "100plus"))
            pct_owner_burdened_30plus = round((owner_burdened / owner_total) * 100, 1) if owner_total > 0 else 0.0

        chas_summary = chas_county.get("summary", {})
        severe_share = safe_float(chas_summary.get("renter_cb50_share"))
        if severe_share:
            pct_renter_severe_burdened = round(severe_share * 100, 1)
        else:
            renter_total = sum(safe_float(renter_data.get(k, {}).get("total", 0)) for k in ("lte30", "31to50", "51to80", "81to100", "100plus"))
            severe_total = sum(safe_float(renter_data.get(k, {}).get("cost_burdened_50pct", 0)) for k in ("lte30", "31to50", "51to80", "81to100", "100plus"))
            if renter_total >= _MIN_RATE_DENOMINATOR:
                pct_renter_severe_burdened = round((severe_total / renter_total) * 100, 1)

        deep_total = sum(safe_float(renter_data.get(k, {}).get("total", 0)) for k in ("lte30", "31to50"))
        deep_burdened = sum(safe_float(renter_data.get(k, {}).get("cost_burdened_30pct", renter_data.get(k, {}).get("cost_burdened", 0))) for k in ("lte30", "31to50"))
        if deep_total >= _MIN_RATE_DENOMINATOR:
            pct_deep_tier_burdened = round((deep_burdened / deep_total) * 100, 1)

        chas_source = "county"

        # Note: we intentionally keep pct_cost_burdened as the GRAPI-derived
        # value (DP04_0141PE + DP04_0142PE) so the metric is comparable across
        # counties and places (both populated from the geography's own ACS
        # profile). CHAS aggregation would filter to ≤100% AMI renters only,
        # which gives a materially different number than "all renters" and
        # isn't what the UI label ("% cost-burdened renters") claims.
        # CHAS is still the source for the AMI-tier stratified fields below.

    # --- LEHD in-commuting stats ---
    # Resolution order:
    #   1. Place-specific LEHD from data/hna/place-lehd.json (preferred for
    #      places/CDPs; produced by spatial apportionment of county WAC
    #      tables, with cross-county composition where the place spans
    #      multiple counties).
    #   2. County aggregate from data/hna/lehd/{fips}.json, scaled by the
    #      place's share of county population (legacy fallback for places
    #      not in the spatial-join coverage).
    in_commuters = 0
    commute_ratio = 0.0
    lehd_source = "none"  # one of: none, place, county_direct, county_proportional

    place_lehd_rec = (lehd_by_place or {}).get(place_geoid7) if place_geoid7 else None
    place_lehd_blob = place_lehd_rec.get("lehd") if place_lehd_rec else None

    if place_lehd_blob:
        place_inflow = int(safe_float(place_lehd_blob.get("inflow", 0)))
        place_within = int(safe_float(place_lehd_blob.get("within", 0)))
        place_total  = place_inflow + place_within
        in_commuters = place_inflow
        if place_total > 0:
            commute_ratio = round((place_inflow / place_total) * 100, 1)
        lehd_source = "place"
    elif county_fips5 and county_fips5 in lehd_by_county:
        lehd = lehd_by_county[county_fips5]
        raw_inflow  = int(safe_float(lehd.get("inflow",  0)))
        raw_within  = int(safe_float(lehd.get("within",  0)))
        total_employed = raw_inflow + raw_within
        if total_employed > 0:
            commute_ratio = round((raw_inflow / total_employed) * 100, 1)
        if geo_type == "county":
            in_commuters = raw_inflow
            lehd_source = "county_direct"
        else:
            # Scale county inflow by this place's share of county population.
            # county_populations is keyed by 5-digit county FIPS and holds the
            # ACS total population loaded from the county's summary file.
            county_pop = (county_populations or {}).get(county_fips5, 0)
            if county_pop > 0 and population > 0:
                share = min(population / county_pop, 1.0)
                in_commuters = int(raw_inflow * share)
                lehd_source = "county_proportional"
            # else: in_commuters stays 0 (county population unknown)

    # --- 20-year population projection ---
    population_projection_20yr = 0
    future_units_needed_20yr = None
    senior_share_growth_pp = None
    if geo_type == "county" and county_fips5:
        proj = load_projection(county_fips5)
        if proj:
            base_year = proj.get("baseYear", 2024)
            years = proj.get("years", [])
            pop_dola = proj.get("population_dola", [])
            target_year = base_year + 20
            if target_year in years:
                idx = years.index(target_year)
                if idx < len(pop_dola):
                    population_projection_20yr = int(safe_float(pop_dola[idx]))
            elif pop_dola:
                # Use last available year
                population_projection_20yr = int(safe_float(pop_dola[-1]))
            future_units = proj.get("housing_need", {}).get("incremental_units_needed_dola", [])
            if future_units:
                future_units_needed_20yr = int(round(safe_float(future_units[-1])))
    else:
        # For places: scale county projection by current population share
        if county_fips5:
            proj = load_projection(county_fips5)
            if proj and population:
                pop_dola = proj.get("population_dola", [])
                base_pop = safe_float(pop_dola[0]) if pop_dola else 0
                last_pop = safe_float(pop_dola[-1]) if pop_dola else 0
                if base_pop > 0:
                    growth_factor = last_pop / base_pop
                    population_projection_20yr = int(population * growth_factor)
                    future_units = proj.get("housing_need", {}).get("incremental_units_needed_dola", [])
                    if future_units:
                        share = min(population / base_pop, 1.0)
                        future_units_needed_20yr = int(round(safe_float(future_units[-1]) * share))

    sya = load_sya(county_fips5) if county_fips5 else None
    if sya:
        pressure = sya.get("seniorPressure", {})
        years = pressure.get("years", [])
        shares = pressure.get("share65plus", [])
        if years and shares and 2024 in years:
            base_idx = years.index(2024)
            target_year = 2044
            target_idx = None
            for i, year in enumerate(years):
                if year >= target_year:
                    target_idx = i
                    break
            if target_idx is None:
                target_idx = len(years) - 1
            if base_idx < len(shares) and target_idx < len(shares):
                senior_share_growth_pp = round(
                    safe_float(shares[target_idx]) - safe_float(shares[base_idx]),
                    2,
                )

    median_home_value_obj = acs.get("median_home_value")
    median_home_value = 0
    home_value_confidence = "missing"
    if isinstance(median_home_value_obj, dict):
        median_home_value = int(safe_float(median_home_value_obj.get("value", 0)))
        home_value_confidence = str(median_home_value_obj.get("confidence", "missing"))
    if median_home_value <= 0:
        median_home_value = int(safe_float(acs.get("DP04_0089E")))
        home_value_confidence = "acs_raw" if median_home_value > 0 else "missing"

    home_value_to_income = None
    rent_to_income = None
    if median_income > 0 and median_home_value > 0:
        home_value_to_income = round(median_home_value / median_income, 2)
    if median_income > 0 and gross_rent > 0:
        rent_to_income = round(((gross_rent * 12) / median_income) * 100, 1)

    opp_key = geoid if geo_type == "county" else place_geoid7
    opp = (opportunity_context or {}).get(opp_key, {})
    opportunity_mobility_score = opp.get("opportunity_mobility_score")
    walkability_score = opp.get("walkability_score")
    amenity_access_score = opp.get("amenity_access_score")
    qct_dda_score = opp.get("qct_dda_score")
    qct_share = opp.get("qct_share")
    dda_share = opp.get("dda_share")
    opportunity_geography_level = opp.get("opportunity_geography_level", "missing")
    amenity_access_context = opp.get("amenity_access_context", "missing")

    imputed_score_factors: list[str] = []
    if housing_gap_rate_lte30 is None:
        imputed_score_factors.append("housing_gap_rate_lte30")
    if pct_renter_severe_burdened is None:
        imputed_score_factors.append("pct_renter_severe_burdened")
    if pct_deep_tier_burdened is None:
        imputed_score_factors.append("pct_deep_tier_burdened")
    if home_value_to_income is None:
        imputed_score_factors.append("home_value_to_income")
    if rent_to_income is None:
        imputed_score_factors.append("rent_to_income")
    if future_units_needed_20yr is None:
        imputed_score_factors.append("future_units_needed_20yr")
    if senior_share_growth_pp is None:
        imputed_score_factors.append("senior_share_growth_pp")
    for key, value in (
        ("opportunity_mobility_score", opportunity_mobility_score),
        ("walkability_score", walkability_score),
        ("amenity_access_score", amenity_access_score),
        ("qct_dda_score", qct_dda_score),
    ):
        if not isinstance(value, (int, float)):
            imputed_score_factors.append(key)

    # Flag fields whose place-level values are downscaled from county sources
    # (per Q2b decision: approximate rather than hide). Consumers can surface
    # a disclaimer in the UI.
    #
    # Fields are added conditionally based on which resolution path each
    # one took:
    #   - AMI gap fields: place_acs_direct → not approximated; county_proportional → approximated.
    #   - CHAS pct_burdened_* tiers: chas_source == "place" → not approximated; "county" → approximated.
    #   - LEHD in_commuters: lehd_source == "place" → not approximated; county_proportional → approximated.
    #   - population_projection_20yr: always county-only (no place-level projection emits).
    approximated_fields: list[str] = []
    if geo_type != "county":
        if ami_gap_source != "place_acs_direct":
            approximated_fields.extend([
                "ami_gap_30pct",
                "ami_gap_50pct",
                "ami_gap_60pct",
                "missing_ami_tiers",
            ])
        if chas_source != "place":
            approximated_fields.extend([
                "pct_burdened_lte30",
                "pct_burdened_31to50",
                "pct_burdened_51to80",
                "pct_burdened_81to100",
                "pct_burdened_100plus",
                "pct_owner_burdened_30plus",
            ])
        if lehd_source != "place":
            approximated_fields.append("in_commuters")
        approximated_fields.append("population_projection_20yr")
    opportunity_aggregated_fields = list(opp.get("_opportunity_aggregated_fields", [])) if isinstance(opp, dict) else []

    return {
        "housing_gap_units": housing_gap_units,
        "low_income_households_lte30": low_income_households_lte30,
        "housing_gap_rate_lte30": housing_gap_rate_lte30,
        "pct_cost_burdened": round(pct_cost_burdened, 1),
        "pct_renter_severe_burdened": pct_renter_severe_burdened,
        "pct_deep_tier_burdened": pct_deep_tier_burdened,
        "ami_gap_30pct": ami_gap_30,
        "ami_gap_50pct": ami_gap_50,
        "ami_gap_60pct": ami_gap_60,
        "pct_burdened_lte30": pct_burdened_lte30,
        "pct_burdened_31to50": pct_burdened_31to50,
        "pct_burdened_51to80": pct_burdened_51to80,
        "pct_burdened_81to100": pct_burdened_81to100,
        "pct_burdened_100plus": pct_burdened_100plus,
        "pct_owner_burdened_30plus": pct_owner_burdened_30plus,
        "missing_ami_tiers": missing_ami_tiers,
        "in_commuters": in_commuters,
        "commute_ratio": commute_ratio,
        "population_projection_20yr": population_projection_20yr,
        "future_units_needed_20yr": future_units_needed_20yr,
        "senior_share_growth_pp": senior_share_growth_pp,
        "overcrowding_rate": None,
        "population": population,
        "median_hh_income": median_income,
        "median_home_value": median_home_value,
        "home_value_to_income": home_value_to_income,
        "rent_to_income": rent_to_income,
        "home_value_confidence": home_value_confidence,
        "opportunity_mobility_score": opportunity_mobility_score,
        "walkability_score": walkability_score,
        "amenity_access_score": amenity_access_score,
        "qct_dda_score": qct_dda_score,
        "qct_share": qct_share,
        "dda_share": dda_share,
        "opportunity_geography_level": opportunity_geography_level,
        "amenity_access_context": amenity_access_context,
        "vacancy_rate": vacancy_rate,
        "pct_renters": round(pct_renter, 1),
        "pct_multifamily": pct_multifamily,
        "pct_sf_detached": pct_sf_detached,
        "pct_2to4_units": pct_2to4_units,
        "gross_rent_median": gross_rent,
        "_ami_gap_source": ami_gap_source,
        "_chas_source": chas_source,
        "_lehd_source": lehd_source,
        "_null_critical_count": null_critical_count,
        "_approximated_fields": approximated_fields,
        "_imputed_score_factors": imputed_score_factors,
        "_opportunity_aggregated_fields": opportunity_aggregated_fields,
    }


# ---------------------------------------------------------------------------
# Percentile computation
# ---------------------------------------------------------------------------

COMMUTER_COUNT_WEIGHT = 0.5
COMMUTER_RATIO_WEIGHT = 0.5


def compute_percentile_ranks(
    entries: list[dict],
    metric: str,
    *,
    within_geo_type: bool = False,
) -> dict[str, float]:
    """Return {geoid: percentile_rank} for a metric.

    By default this preserves the historical mixed-pool behavior. For HNA
    scoring, use within_geo_type=True so counties, places, and CDPs are each
    ranked against comparable geographies.
    """
    result: dict[str, float] = {}
    pools: dict[str, list[dict]] = {"all": entries}
    if within_geo_type:
        pools = {}
        for entry in entries:
            pools.setdefault(entry.get("type", "unknown"), []).append(entry)

    for _pool_name, pool_entries in sorted(pools.items()):
        values = [
            (e["geoid"], e["metrics"].get(metric))
            for e in pool_entries
            if isinstance(e.get("metrics", {}).get(metric), (int, float))
        ]
        values_sorted = sorted(values, key=lambda x: (x[1], x[0]))
        n = len(values_sorted)
        for rank_idx, (geoid, _val) in enumerate(values_sorted):
            # percentile rank = (rank / n) * 100
            result[geoid] = round((rank_idx / max(n - 1, 1)) * 100, 1)
    return result


def _weighted_average(parts: list[tuple[float | None, float]]) -> float | None:
    """Weighted average that re-normalizes around missing factor parts."""
    total_weight = 0.0
    total = 0.0
    for value, weight in parts:
        if isinstance(value, (int, float)):
            total += float(value) * weight
            total_weight += weight
    if total_weight <= 0:
        return None
    return total / total_weight


def _pct(percentiles: dict[str, float], geoid: str) -> float | None:
    return percentiles.get(geoid)


# ---------------------------------------------------------------------------
# Main build function
# ---------------------------------------------------------------------------

def build() -> None:
    summary_dir = os.path.join(ROOT, "data", "hna", "summary")
    out_path = os.path.join(ROOT, "data", "hna", "ranking-index.json")

    print("Loading cross-reference datasets…", file=sys.stderr)
    ami_gap = load_ami_gap()
    ami_gap_place = load_ami_gap_by_place()
    chas = load_chas()
    chas_place = load_place_chas()
    lehd = load_lehd_index()
    lehd_place = load_place_lehd()
    county_pops = load_county_populations()
    opportunity_context = build_opportunity_context()
    print(f"  AMI gap counties: {len(ami_gap)}", file=sys.stderr)
    print(f"  AMI gap places (place-specific):  {len(ami_gap_place)}", file=sys.stderr)
    print(f"  CHAS counties: {len(chas)}", file=sys.stderr)
    print(f"  CHAS places (TIGER-apportioned):  {len(chas_place)}", file=sys.stderr)
    print(f"  LEHD counties: {len(lehd)}", file=sys.stderr)
    print(f"  LEHD places (TIGER-apportioned):  {len(lehd_place)}", file=sys.stderr)
    print(f"  County populations: {len(county_pops)}", file=sys.stderr)
    print(f"  Opportunity aggregates: {len(opportunity_context)}", file=sys.stderr)

    # Load all summary files
    all_files = sorted(glob.glob(os.path.join(summary_dir, "*.json")))
    print(f"Found {len(all_files)} summary files", file=sys.stderr)

    entries: list[dict] = []
    county_count = 0
    place_count = 0
    cdp_count = 0

    for path in all_files:
        geoid = os.path.basename(path).replace(".json", "")
        summary = _load_json(path)
        if not summary:
            continue

        geo = summary.get("geo", {})
        geo_type = geo.get("type", "")
        label = geo.get("label", geoid)

        # Skip statewide summary (geoid="08", type="state") and any unrecognized types
        if geo_type not in ("county", "place", "cdp") or not geoid:
            continue

        # Derive region (counties directly; places inherit from containingCounty)
        county_fips5 = ""
        if geo_type == "county":
            county_fips5 = geoid[:5].zfill(5)
        else:
            county_fips5 = geo.get("containingCounty", geoid[:5]).zfill(5)

        region = COUNTY_REGION.get(county_fips5, "Other")

        try:
            metrics = compute_metrics(
                summary, ami_gap, ami_gap_place, chas, lehd, county_pops,
                chas_by_place=chas_place, lehd_by_place=lehd_place,
                opportunity_context=opportunity_context,
            )
        except Exception as exc:
            print(f"  [warn] metrics failed for {geoid}: {exc}", file=sys.stderr)
            metrics = {
                "housing_gap_units": 0,
                "low_income_households_lte30": 0,
                "housing_gap_rate_lte30": None,
                "pct_cost_burdened": 0.0,
                "pct_renter_severe_burdened": None,
                "pct_deep_tier_burdened": None,
                "ami_gap_30pct": 0,
                "ami_gap_50pct": 0,
                "ami_gap_60pct": 0,
                "pct_burdened_lte30": 0.0,
                "pct_burdened_31to50": 0.0,
                "pct_burdened_51to80": 0.0,
                "pct_burdened_81to100": 0.0,
                "pct_burdened_100plus": 0.0,
                "pct_owner_burdened_30plus": 0.0,
                "missing_ami_tiers": [],
                "in_commuters": 0,
                "commute_ratio": 0.0,
                "population_projection_20yr": 0,
                "future_units_needed_20yr": None,
                "senior_share_growth_pp": None,
                "population": 0,
                "median_hh_income": 0,
                "median_home_value": 0,
                "home_value_to_income": None,
                "rent_to_income": None,
                "home_value_confidence": "missing",
                "opportunity_mobility_score": None,
                "walkability_score": None,
                "amenity_access_score": None,
                "qct_dda_score": None,
                "qct_share": None,
                "dda_share": None,
                "opportunity_geography_level": "missing",
                "amenity_access_context": "missing",
                "vacancy_rate": 0.0,
                "pct_renters": 0.0,
                "pct_multifamily": 0.0,
                "pct_sf_detached": 0.0,
                "pct_2to4_units": 0.0,
                "gross_rent_median": 0,
                "_ami_gap_source": "none",
                "_chas_source": "none",
                "_lehd_source": "none",
                "_null_critical_count": 0,
                "_approximated_fields": [],
                "_imputed_score_factors": [
                    "housing_gap_rate_lte30",
                    "pct_renter_severe_burdened",
                    "pct_deep_tier_burdened",
                    "home_value_to_income",
                    "rent_to_income",
                    "future_units_needed_20yr",
                    "senior_share_growth_pp",
                    "opportunity_mobility_score",
                    "walkability_score",
                    "amenity_access_score",
                    "qct_dda_score",
                ],
                "_opportunity_aggregated_fields": [],
            }

        # Extract data-quality flags and remove private keys from public metrics dict.
        null_critical_count = metrics.pop("_null_critical_count", 0)
        approximated_fields = metrics.pop("_approximated_fields", [])
        imputed_score_factors = metrics.pop("_imputed_score_factors", [])
        opportunity_aggregated_fields = metrics.pop("_opportunity_aggregated_fields", [])
        total_critical = 5  # number of CRITICAL_ACS_FIELDS checked in compute_metrics
        has_incomplete_data = (
            null_critical_count > 0
            and (null_critical_count / total_critical) > _INCOMPLETE_DATA_THRESHOLD
        ) or bool(imputed_score_factors)

        data_quality = {}
        if approximated_fields:
            data_quality["approximated_fields"] = approximated_fields
            # The 20-yr projection is the only field that uses the county
            # value directly (no scaling); every other approximated field
            # is population-share-scaled. Surface the right basis so
            # downstream UIs (Compare's approximation notice) don't claim
            # scaling when only the projection is flagged.
            _scaled = [f for f in approximated_fields if f != "population_projection_20yr"]
            data_quality["approximation_basis"] = (
                "county_scaled_by_population_share" if _scaled
                else "county_value_used_directly"
            )
        if imputed_score_factors:
            data_quality["imputed_score_factors"] = imputed_score_factors
        if opportunity_aggregated_fields:
            data_quality["opportunity_aggregated_fields"] = opportunity_aggregated_fields

        entry = {
            "geoid": geoid,
            "name": label,
            "type": geo_type,
            "region": region,
            "containingCounty": county_fips5,
            "metrics": metrics,
            "hasIncompleteData": has_incomplete_data,
            "nullCriticalMetrics": null_critical_count,
            "dataQuality": data_quality,
            "percentileRank": 0,  # filled in after sorting
            "medianComparison": 1.0,
        }
        entries.append(entry)

        if geo_type == "county":
            county_count += 1
        elif geo_type == "place":
            place_count += 1
        elif geo_type == "cdp":
            cdp_count += 1

    print(f"Processed: {county_count} counties, {place_count} places, {cdp_count} CDPs",
          file=sys.stderr)

    # Compute percentile ranks for B1 component scores. All scored factors use
    # per-geo-type pools so places rank against places, counties rank against
    # counties, and CDPs rank against CDPs.
    pct_gap_count = compute_percentile_ranks(entries, "housing_gap_units", within_geo_type=True)
    pct_gap_rate = compute_percentile_ranks(entries, "housing_gap_rate_lte30", within_geo_type=True)
    pct_cb = compute_percentile_ranks(entries, "pct_cost_burdened", within_geo_type=True)
    pct_severe_cb = compute_percentile_ranks(entries, "pct_renter_severe_burdened", within_geo_type=True)
    pct_deep_cb = compute_percentile_ranks(entries, "pct_deep_tier_burdened", within_geo_type=True)
    pct_home_value_income = compute_percentile_ranks(entries, "home_value_to_income", within_geo_type=True)
    pct_rent_income = compute_percentile_ranks(entries, "rent_to_income", within_geo_type=True)
    pct_future_units = compute_percentile_ranks(entries, "future_units_needed_20yr", within_geo_type=True)
    pct_senior_growth = compute_percentile_ranks(entries, "senior_share_growth_pp", within_geo_type=True)
    pct_mobility = compute_percentile_ranks(entries, "opportunity_mobility_score", within_geo_type=True)
    pct_walkability = compute_percentile_ranks(entries, "walkability_score", within_geo_type=True)
    pct_amenity = compute_percentile_ranks(entries, "amenity_access_score", within_geo_type=True)
    pct_qct_dda = compute_percentile_ranks(entries, "qct_dda_score", within_geo_type=True)
    pct_in = compute_percentile_ranks(entries, "in_commuters", within_geo_type=True)
    pct_commute_ratio = compute_percentile_ranks(entries, "commute_ratio", within_geo_type=True)

    # Materialize QAP-aligned axes. Commuter pressure augments community need
    # only; it never subtracts from a high-burden / low-commute geography.
    for e in entries:
        gid = e["geoid"]
        gap_pressure = _weighted_average([
            (_pct(pct_gap_count, gid), GAP_COUNT_WEIGHT),
            (_pct(pct_gap_rate, gid), GAP_RATE_WEIGHT),
        ])
        cost_burden_pressure = _weighted_average([
            (_pct(pct_cb, gid), COST_ALL_RENTER_WEIGHT),
            (_pct(pct_severe_cb, gid), COST_SEVERE_WEIGHT),
            (_pct(pct_deep_cb, gid), COST_DEEP_TIER_WEIGHT),
        ])
        affordability_intensity = _weighted_average([
            (_pct(pct_home_value_income, gid), AFFORDABILITY_HOMEBUYER_WEIGHT),
            (_pct(pct_rent_income, gid), AFFORDABILITY_RENTER_WEIGHT),
        ])
        future_pressure = _weighted_average([
            (_pct(pct_future_units, gid), FUTURE_UNITS_WEIGHT),
            (_pct(pct_senior_growth, gid), FUTURE_SENIOR_WEIGHT),
        ])
        opportunity_score = _weighted_average([
            (_pct(pct_mobility, gid), OPPORTUNITY_WEIGHTS["opportunity_mobility_score"]),
            (_pct(pct_walkability, gid), OPPORTUNITY_WEIGHTS["walkability_score"]),
            (_pct(pct_amenity, gid), OPPORTUNITY_WEIGHTS["amenity_access_score"]),
            (_pct(pct_qct_dda, gid), OPPORTUNITY_WEIGHTS["qct_dda_score"]),
        ])
        commuter_pressure = (
            COMMUTER_COUNT_WEIGHT * pct_in.get(gid, 0.0)
            + COMMUTER_RATIO_WEIGHT * pct_commute_ratio.get(gid, 0.0)
        )
        community_need_core = _weighted_average([
            (gap_pressure, COMMUNITY_NEED_WEIGHTS["gap_pressure_score"]),
            (cost_burden_pressure, COMMUNITY_NEED_WEIGHTS["cost_burden_pressure_score"]),
            (affordability_intensity, COMMUNITY_NEED_WEIGHTS["affordability_intensity_score"]),
            (future_pressure, COMMUNITY_NEED_WEIGHTS["future_pressure_score"]),
        ]) or 0.0
        community_need_augmented = min(
            100.0,
            community_need_core * (1 + COMMUTER_AUGMENT_ALPHA * (commuter_pressure / 100.0)),
        )
        factor_scores = {
            "gap_pressure_score": gap_pressure,
            "cost_burden_pressure_score": cost_burden_pressure,
            "affordability_intensity_score": affordability_intensity,
            "future_pressure_score": future_pressure,
            "commuter_pressure_score": commuter_pressure,
            "opportunity_score_raw": opportunity_score,
        }
        for key, value in factor_scores.items():
            e["metrics"][key] = round(value or 0.0, 1)
        e["metrics"]["commuter_pressure_score"] = round(commuter_pressure, 1)
        e["metrics"]["community_need_core_score"] = round(community_need_core, 1)
        e["metrics"]["community_need_augmented_raw"] = round(community_need_augmented, 1)

    pct_community_need = compute_percentile_ranks(
        entries, "community_need_augmented_raw", within_geo_type=True
    )

    # overall_need_score: QAP-aligned weighted blend of Community Need and
    # Opportunity, with a light confidence penalty for imputed / aggregated
    # inputs. Higher = stronger need-plus-opportunity screen.
    for e in entries:
        gid = e["geoid"]
        dq = e.get("dataQuality", {})
        confidence_penalty = 0.0
        confidence_penalty += len(dq.get("imputed_score_factors", [])) * CONFIDENCE_PENALTY_PER_IMPUTED_FACTOR
        confidence_penalty += len(dq.get("approximated_fields", [])) * CONFIDENCE_PENALTY_PER_APPROXIMATED_FIELD
        confidence_penalty += len(dq.get("opportunity_aggregated_fields", [])) * 0.005
        if e["metrics"].get("home_value_confidence") in ("low", "acs_raw"):
            confidence_penalty += 0.02
        if e["metrics"].get("opportunity_geography_level") == "county_context":
            confidence_penalty += 0.02
        confidence_multiplier = round(max(MIN_CONFIDENCE_MULTIPLIER, 1.0 - confidence_penalty), 3)

        community_need = pct_community_need.get(gid, 0.0)
        opportunity_score = e["metrics"].get("opportunity_score_raw", 0.0)
        raw_score = _weighted_average([
            (community_need, AXIS_WEIGHTS["community_need"]),
            (opportunity_score, AXIS_WEIGHTS["opportunity"]),
        ]) or 0.0
        e["metrics"]["community_need_score"] = round(community_need, 1)
        e["metrics"]["opportunity_score"] = round(opportunity_score, 1)
        e["metrics"]["overall_need_score_raw"] = round(raw_score, 1)
        e["metrics"]["score_confidence_multiplier"] = confidence_multiplier
        score = round(min(100.0, max(0.0, raw_score)) * confidence_multiplier, 1)
        e["metrics"]["overall_need_score"] = score

    # Compute percentile ranks for primary metric (housing_gap_units) across all entries
    pct_ranks = pct_gap_count  # already computed above
    for e in entries:
        e["percentileRank"] = pct_ranks.get(e["geoid"], 0.0)

    # Compute median comparison (relative to median housing_gap_units)
    all_gap_vals = sorted(
        [e["metrics"]["housing_gap_units"] for e in entries if e["metrics"]["housing_gap_units"] > 0]
    )
    if all_gap_vals:
        mid = len(all_gap_vals) // 2
        median_gap = all_gap_vals[mid] if len(all_gap_vals) % 2 else (all_gap_vals[mid - 1] + all_gap_vals[mid]) / 2
        for e in entries:
            gap = e["metrics"]["housing_gap_units"]
            e["medianComparison"] = round(gap / max(median_gap, 1), 2) if gap else 0.0
    else:
        median_gap = 0

    # Sort by overall_need_score descending, then assign rank
    entries.sort(key=lambda e: (-e["metrics"]["overall_need_score"], e["geoid"]))
    for rank_idx, e in enumerate(entries):
        e["rank"] = rank_idx + 1

    # Build output
    metrics_meta = [
        {
            "id": "overall_need_score",
            "label": "Overall Housing Need Score",
            "description": (
                "QAP-aligned screening index (0–100) blending Community Need (55%) "
                "and Opportunity / Geography (45%). Community Need uses B1 need "
                "factors with commuter pressure as an augment-only multiplier. "
                "Opportunity blends mobility, walkability, "
                "amenity access, and QCT/DDA context. Entries with imputed, county-"
                "context, or aggregated inputs receive a light confidence down-weight."
            ),
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "community_need_score",
            "label": "Community Need Axis",
            "description": "Type-scoped percentile score for QAP-style community need after commuter augment-only adjustment",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "opportunity_score",
            "label": "Opportunity Axis",
            "description": "Type-scoped percentile blend of mobility, walkability/transit, amenity access, and QCT/DDA context",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "gap_pressure_score",
            "label": "Gap Pressure Score",
            "description": "Type-scoped percentile blend of absolute 30% AMI unit gap and gap rate per low-income household",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "opportunity_mobility_score",
            "label": "Opportunity Mobility Score",
            "description": "Population-weighted Opportunity Insights tract mobility index aggregated to geography",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "walkability_score",
            "label": "Walkability / Transit Score",
            "description": "Population-weighted EPA Smart Location walk/transit score aggregated from tracts",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "amenity_access_score",
            "label": "Amenity Access Score",
            "description": "Centroid-radius access score for grocery, healthcare, schools, and transit stops; rural sparsity is labeled in context fields",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "qct_dda_score",
            "label": "QCT / DDA Score",
            "description": "QCT tract-share or county-level DDA context for the LIHTC 30% basis-boost geography signal",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "housing_gap_rate_lte30",
            "label": "30% AMI Gap Rate",
            "description": "30% AMI unit deficit divided by households at or below 30% AMI; suppressed below the minimum denominator floor",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "cost_burden_pressure_score",
            "label": "Cost-Burden Pressure Score",
            "description": "Type-scoped percentile blend of all-renter cost burden, severe renter burden, and deep-tier renter burden",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "pct_renter_severe_burdened",
            "label": "% Severely Rent-Burdened",
            "description": "HUD CHAS share of renter households paying at least 50% of income on housing",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "pct_deep_tier_burdened",
            "label": "% Burdened at ≤50% AMI",
            "description": "HUD CHAS share of renter households at or below 50% AMI paying at least 30% of income on housing",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "affordability_intensity_score",
            "label": "Affordability Intensity Score",
            "description": "Type-scoped percentile blend of median home value-to-income and median gross rent-to-income ratios",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "future_pressure_score",
            "label": "Future Pressure Score",
            "description": "Type-scoped percentile blend of DOLA 20-year incremental unit need and senior-share growth",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "housing_gap_units",
            "label": "Housing Units Needed (30% AMI)",
            "description": "Deficit of affordable housing units at 30% AMI",
            "unit": "units",
            "sortOrder": "descending",
        },
        {
            "id": "pct_cost_burdened",
            "label": "% Rent-Burdened Households",
            "description": "Percentage of renter households paying ≥30% of income on housing",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "ami_gap_30pct",
            "label": "Units Needed at 30% AMI",
            "description": "Unit deficit at 30% of Area Median Income",
            "unit": "units",
            "sortOrder": "descending",
        },
        {
            "id": "ami_gap_50pct",
            "label": "Units Needed at 50% AMI",
            "description": "Unit deficit at 50% of Area Median Income",
            "unit": "units",
            "sortOrder": "descending",
        },
        {
            "id": "ami_gap_60pct",
            "label": "Units Needed at 60% AMI",
            "description": "Unit deficit at 60% of Area Median Income (primary LIHTC tier)",
            "unit": "units",
            "sortOrder": "descending",
        },
        {
            "id": "pct_burdened_lte30",
            "label": "% Burdened at ≤30% AMI",
            "description": "CHAS: percentage of renter households at or below 30% AMI that are cost-burdened",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "pct_burdened_31to50",
            "label": "% Burdened at 31–50% AMI",
            "description": "CHAS: percentage of renter households at 31–50% AMI that are cost-burdened",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "pct_burdened_51to80",
            "label": "% Burdened at 51–80% AMI",
            "description": "CHAS: percentage of renter households at 51–80% AMI that are cost-burdened",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "in_commuters",
            "label": "In-Commuters (LEHD)",
            "description": "Workers employed in this county who live in another county (LEHD LODES OD)",
            "unit": "persons",
            "sortOrder": "descending",
        },
        {
            "id": "commute_ratio",
            "label": "In-Commute Ratio",
            "description": "Share of local jobs filled by workers living outside the geography (%)",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "commuter_pressure_score",
            "label": "Commuter Pressure Score",
            "description": "Type-scoped percentile blend of in-commuter count (50%) and in-commute ratio (50%)",
            "unit": "score",
            "sortOrder": "descending",
        },
        {
            "id": "score_confidence_multiplier",
            "label": "Score Confidence Multiplier",
            "description": "Multiplier applied to the raw composite score for imputed or county-approximated score inputs",
            "unit": "ratio",
            "sortOrder": "descending",
        },
        {
            "id": "population_projection_20yr",
            "label": "Population (20-yr Projection)",
            "description": "DOLA-projected population approximately 20 years from base year",
            "unit": "persons",
            "sortOrder": "descending",
        },
        {
            "id": "population",
            "label": "Current Population",
            "description": "ACS 5-year estimate of total population",
            "unit": "persons",
            "sortOrder": "descending",
        },
        {
            "id": "median_hh_income",
            "label": "Median Household Income",
            "description": "ACS median household income (most recent vintage)",
            "unit": "dollars",
            "sortOrder": "descending",
        },
        {
            "id": "pct_renters",
            "label": "% Renter-Occupied",
            "description": "Percentage of occupied housing units that are renter-occupied",
            "unit": "percent",
            "sortOrder": "descending",
        },
        {
            "id": "gross_rent_median",
            "label": "Median Gross Rent",
            "description": "ACS median gross rent (rent + utilities)",
            "unit": "dollars",
            "sortOrder": "descending",
        },
    ]

    output = {
        "metadata": {
            "generatedAt": utc_now_z(),
            "version": "1.0",
            "totalCounties": county_count,
            "totalPlaces": place_count,
            "totalCDPs": cdp_count,
            "totalEntries": len(entries),
            "medianHousingGap": int(median_gap),
            "note": (
                "Rankings derived from ACS 5-year estimates, DOLA population projections, "
                "HUD CHAS cost-burden data, LEHD LODES commuting flows, AMI gap modeling, "
                "Opportunity Insights, EPA Smart Location data, amenities, and QCT/DDA context. "
                "Overall need score weights: 55% community need and 45% opportunity. "
                "Commuter pressure is an augment-only community-need multiplier, not a standalone weight. "
                "Generated by scripts/hna/build_ranking_index.py."
            ),
        },
        "metrics": metrics_meta,
        "rankings": entries,
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)

    print(f"✓ Wrote {out_path} ({len(entries)} entries)", file=sys.stderr)


if __name__ == "__main__":
    build()
