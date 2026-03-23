#!/usr/bin/env python3
"""Build the HNA comparative ranking index.

Reads all data/hna/summary/{geoid}.json files and cross-references:
  - data/hna/projections/{countyFips5}.json  (population projections)
  - data/hna/chas_affordability_gap.json     (cost-burden by AMI tier)
  - data/co_ami_gap_by_county.json           (affordability gap units)

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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGIONS: dict[str, list[str]] = {
    "Front Range":   ["08001", "08005", "08013", "08014", "08019", "08031",
                      "08035", "08041", "08059", "08069", "08101", "08123"],
    "Western Slope": ["08007", "08021", "08029", "08045", "08051", "08053",
                      "08077", "08085", "08113", "08121"],
    "Mountains":     ["08009", "08015", "08037", "08047", "08065", "08097",
                      "08107", "08117", "08119", "08049"],
    "Eastern Plains":["08011", "08017", "08023", "08025", "08039", "08057",
                      "08061", "08063", "08071", "08073", "08075", "08079",
                      "08087", "08089", "08099", "08111", "08115", "08125"],
    "San Luis Valley":["08003", "08021", "08055", "08083", "08105", "08109"],
    "Southwest":     ["08033", "08043", "08067", "08081", "08091"],
}

# Build reversed lookup: county fips -> region
COUNTY_REGION: dict[str, str] = {}
for _region, _fips_list in REGIONS.items():
    for _fips in _fips_list:
        COUNTY_REGION[_fips] = _region


_ACS_SENTINEL = -666666666.0  # Census ACS "not available" float sentinel
# Geographies where more than this fraction of critical metrics are null
# are flagged with hasIncompleteData: true in the ranking output.
_INCOMPLETE_DATA_THRESHOLD = 0.2


def utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_float(val, default: float = 0.0) -> float:
    """Convert value to float, returning default on failure or for ACS sentinel."""
    if val is None:
        return default
    try:
        f = float(val)
        # Treat the ACS "not available" sentinel as missing data
        if f == _ACS_SENTINEL:
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


def load_projection(county_fips5: str) -> dict | None:
    """Load DOLA population projection for a county."""
    path = os.path.join(ROOT, "data", "hna", "projections", f"{county_fips5}.json")
    return _load_json(path)


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
    chas_by_county: dict[str, dict],
) -> dict:
    """Derive ranking metrics from a summary record.

    Returns a metrics dict with:
      housing_gap_units          int   — gap at 30% AMI (county-only; place: scaled by pop share)
      pct_cost_burdened          float — % renters paying ≥30% of income (CHAS or ACS fallback)
      ami_gap_30pct              int   — units gap at 30% AMI (same as housing_gap_units)
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

    # Rental vacancy — DP04_0005E = vacant for rent, DP04_0001E = total units
    total_units = int(safe_float(acs.get("DP04_0001E")))
    vacant_for_rent = int(safe_float(acs.get("DP04_0005E")))
    rental_units = int(total_units * (pct_renter / 100.0)) if total_units and pct_renter else 1
    vacancy_rate = round((vacant_for_rent / max(rental_units, 1)) * 100, 1) if vacant_for_rent else 0.0

    # Cost burden: ACS DP04_0146PE = % renters paying ≥30% income
    pct_cost_burdened_acs = safe_float(acs.get("DP04_0146PE"))

    # Prefer CHAS cost-burden over ACS (CHAS is more precise for AMI tiers)
    pct_cost_burdened = pct_cost_burdened_acs

    # Determine county FIPS for cross-reference lookups
    county_fips5 = ""
    if geo_type == "county":
        county_fips5 = geoid[:5].zfill(5) if geoid else ""
    else:
        # For places/CDPs, containingCounty may be in the summary geo block
        county_fips5 = geo.get("containingCounty", geoid[:5]).zfill(5)

    # --- AMI gap at 30% AMI (housing unit deficit) ---
    housing_gap_units = 0
    ami_gap_30 = 0
    if county_fips5 and county_fips5 in ami_gap_by_county:
        county_data = ami_gap_by_county[county_fips5]
        gap_dict = county_data.get("gap_units_minus_households_le_ami_pct", {})
        raw_gap = safe_float(gap_dict.get("30", 0))
        # gap is negative (deficit), convert to positive "units needed"
        county_gap = int(abs(raw_gap))
        if geo_type == "county":
            housing_gap_units = county_gap
        else:
            # Scale by population share within county
            county_pop = safe_float(
                ami_gap_by_county[county_fips5].get("households_le_ami_pct", {}).get("100", 0)
            )
            # fallback: use county summary data pop to scale
            county_pop_fallback = safe_float(
                county_data.get("households_le_ami_pct", {}).get("100", households or 1)
            )
            place_pop = population or 0
            county_total = county_pop_fallback or 1
            share = min(place_pop / county_total, 1.0) if county_total else 0.0
            housing_gap_units = int(county_gap * share)
        ami_gap_30 = housing_gap_units

    # --- CHAS cost-burden override (county only) ---
    if geo_type == "county" and county_fips5 in chas_by_county:
        chas_county = chas_by_county[county_fips5]
        renter_data = chas_county.get("renter_hh_by_ami", {})
        # Aggregate: total cost-burdened / total renter households across all tiers
        total_renter_hh = 0
        total_burdened = 0
        for _tier, tier_data in renter_data.items():
            total_renter_hh += safe_float(tier_data.get("total", 0))
            total_burdened += safe_float(tier_data.get("cost_burdened", 0))
        if total_renter_hh > 0:
            pct_cost_burdened = round((total_burdened / total_renter_hh) * 100, 1)

    # --- 20-year population projection ---
    population_projection_20yr = 0
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

    return {
        "housing_gap_units": housing_gap_units,
        "pct_cost_burdened": round(pct_cost_burdened, 1),
        "ami_gap_30pct": ami_gap_30,
        "population_projection_20yr": population_projection_20yr,
        "population": population,
        "median_hh_income": median_income,
        "vacancy_rate": vacancy_rate,
        "pct_renters": round(pct_renter, 1),
        "gross_rent_median": gross_rent,
        "_null_critical_count": null_critical_count,
    }


# ---------------------------------------------------------------------------
# Percentile computation
# ---------------------------------------------------------------------------

def compute_percentile_ranks(
    entries: list[dict],
    metric: str,
) -> dict[str, float]:
    """Return {geoid: percentile_rank} for a given metric across all entries."""
    values = [(e["geoid"], e["metrics"].get(metric, 0)) for e in entries]
    values_sorted = sorted(values, key=lambda x: x[1])
    n = len(values_sorted)
    result: dict[str, float] = {}
    for rank_idx, (geoid, _val) in enumerate(values_sorted):
        # percentile rank = (rank / n) * 100
        result[geoid] = round((rank_idx / max(n - 1, 1)) * 100, 1)
    return result


# ---------------------------------------------------------------------------
# Main build function
# ---------------------------------------------------------------------------

def build() -> None:
    summary_dir = os.path.join(ROOT, "data", "hna", "summary")
    out_path = os.path.join(ROOT, "data", "hna", "ranking-index.json")

    print("Loading cross-reference datasets…", file=sys.stderr)
    ami_gap = load_ami_gap()
    chas = load_chas()
    print(f"  AMI gap counties: {len(ami_gap)}", file=sys.stderr)
    print(f"  CHAS counties: {len(chas)}", file=sys.stderr)

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
            metrics = compute_metrics(summary, ami_gap, chas)
        except Exception as exc:
            print(f"  [warn] metrics failed for {geoid}: {exc}", file=sys.stderr)
            metrics = {
                "housing_gap_units": 0,
                "pct_cost_burdened": 0.0,
                "ami_gap_30pct": 0,
                "population_projection_20yr": 0,
                "population": 0,
                "median_hh_income": 0,
                "vacancy_rate": 0.0,
                "pct_renters": 0.0,
                "gross_rent_median": 0,
                "_null_critical_count": 0,
            }

        # Extract data-quality flag and remove private key from public metrics dict.
        null_critical_count = metrics.pop("_null_critical_count", 0)
        total_critical = 5  # number of CRITICAL_ACS_FIELDS checked in compute_metrics
        has_incomplete_data = null_critical_count > 0 and (null_critical_count / total_critical) > _INCOMPLETE_DATA_THRESHOLD

        entry = {
            "geoid": geoid,
            "name": label,
            "type": geo_type,
            "region": region,
            "metrics": metrics,
            "hasIncompleteData": has_incomplete_data,
            "nullCriticalMetrics": null_critical_count,
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

    # Compute percentile ranks for primary metric (housing_gap_units) across all entries
    pct_ranks = compute_percentile_ranks(entries, "housing_gap_units")
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

    # Sort by housing_gap_units descending and assign rank
    entries.sort(key=lambda e: e["metrics"]["housing_gap_units"], reverse=True)
    for rank_idx, e in enumerate(entries):
        e["rank"] = rank_idx + 1

    # Build output
    metrics_meta = [
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
                "HUD CHAS cost-burden data, and AMI gap modeling. "
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
