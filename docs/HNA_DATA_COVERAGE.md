# HNA Data Coverage

This document describes geography coverage expectations for the Housing Needs Assessment (HNA) module, including which geographies have full data, which use county-scaled projections, and known limitations.

---

## Geography Types

| Type    | Count | Source                              |
|---------|-------|-------------------------------------|
| County  | 64    | TIGERweb State_County MapServer/1   |
| Place   | 55    | Census ACS 5-year 2024 place names  |
| CDP     | 208   | Census ACS 5-year 2024 CDP names    |
| **Total** | **327** |                                 |

All 64 Colorado counties are required in every county-level data file. See [Rule 4](../CHANGELOG.md) in the governance rules.

---

## Canonical Registry

**`data/hna/geography-registry.json`** is the canonical source of truth for all geographies used in the HNA selector and comparative ranking index.

Each entry includes:
- `geoid` — 5-digit (county) or 7-digit (place/CDP) string FIPS code
- `name` — human-readable geography name
- `type` — one of `county`, `place`, `cdp`, `state`
- `hasHnaSummary` — whether a full HNA summary JSON file exists in `data/hna/summary/`
- `hasRanking` — whether the geography appears in `data/hna/ranking-index.json`
- `projectionMode` — see below
- `containingCounty` — 5-digit county FIPS for places and CDPs

---

## Projection Modes

| Mode            | Description                                                             |
|-----------------|-------------------------------------------------------------------------|
| `direct`        | DOLA State Demography Office SYA data available for this geography      |
| `county_scaled` | Projection derived by scaling county-level DOLA totals to local share   |
| `none`          | No projection data available; HNA displays base-year figures only       |

> **Caveat:** County-scaled projections are estimates. They assume the geography's share of county population remains constant over the projection horizon. They are labeled clearly in the HNA UI as "County-scaled projection."

---

## Data Gaps and Incomplete Geographies

The HNA UI shows a warning banner when a geography's data is incomplete:
- Missing HNA summary → "Data not available for this geography"
- No projection data → "Population projection unavailable; showing base-year data"
- Missing ranking entry → geography is excluded from the comparative ranking index

These are informational warnings, not errors. The UI continues to function with available data.

---

## Coverage Validation

Run `pytest tests/test_hna_geography_coverage.py` to verify:
- Exactly 64 counties in geo-config and registry
- No duplicate GEOIDs
- All FIPS codes are correctly formatted (5-digit for counties, 7-digit for places/CDPs)
- All geo-config geographies are present in the registry
- All ranked geographies are selectable in geo-config

---

## Updating Geography Lists

When the Census updates place or CDP lists:
1. Re-run `scripts/hna/build_hna_data.py` to regenerate `data/hna/geo-config.json`
2. Re-run the geography-registry generation script to update `data/hna/geography-registry.json`
3. Re-run `scripts/rebuild_manifest.py` to update `data/manifest.json`
4. Verify tests still pass: `pytest tests/test_hna_geography_coverage.py`
