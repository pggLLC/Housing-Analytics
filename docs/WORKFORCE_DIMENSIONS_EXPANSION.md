# Workforce Dimensions Expansion

## Overview

The PMA (Public Market Analysis) Workforce dimension (15% of overall PMA score) has been expanded from a single ACS employment indicator to a five-factor weighted composite that draws on multiple Colorado-specific data sources.

## Scoring Model

| Factor | Weight | Source | Connector |
|--------|--------|--------|-----------|
| Job accessibility | 25% | LODES/LEHD | `js/data-connectors/lodes-commute.js` |
| Educational attainment + employment | 25% | ACS | Built into `market-analysis.js` |
| CDLE vacancy rates | 20% | Colorado CDLE LMI | `js/data-connectors/cdle-jobs.js` |
| CDE school quality proximity | 15% | Colorado CDE | `js/data-connectors/cde-schools.js` |
| CDOT traffic connectivity | 15% | Colorado CDOT | `js/data-connectors/cdot-traffic.js` |

### Overall Workforce Score
```
workforce = (lodes × 0.25) + (acs × 0.25) + (cdle × 0.20) + (cde × 0.15) + (cdot × 0.15)
```

## Data Sources

### A. LODES/LEHD Commuting Data
- **File:** `data/market/lodes_co.json`
- **Connector:** `js/data-connectors/lodes-commute.js` (exposes `window.LodesCommute`)
- **API:** US Census LODES (Longitudinal Employer-Household Dynamics)
  - Public: `https://lehd.ces.census.gov/data/`
  - Data structure: Workplace Area Characteristics (WAC) by census tract
- **Vintage:** LODES 2021 (latest publicly available)
- **Metric:** Job-housing ratio (jobs per resident worker) per tract
- **Scoring:** Ratio 0.6–1.2 = 100 (ideal balance); below 0.3 or above 2.0 = penalised

### B. ACS Educational Attainment (Enhanced ACS)
- **Built into:** `js/market-analysis.js`
- **Variables:** `B06009_001E` (pop 25+), `B06009_003E–005E` (bachelor's+)
- **Currently proxied via:** Median HH income relative to CO statewide AMI
  - Higher income → skilled workforce proxy
  - Score = min(100, incomeRatio × 60)
- **Future:** Add `education_rate` (% bachelor's+) to ACS aggregation in `acs_tract_metrics_co.json`

### C. Colorado CDLE Job Postings
- **File:** `data/market/cdle_job_postings_co.json`
- **Connector:** `js/data-connectors/cdle-jobs.js` (exposes `window.CdleJobs`)
- **Source:** Colorado Department of Labor and Employment (CDLE) Labor Market Information
  - Portal: `https://www.colmigateway.com/`
  - Real data: Weekly job postings by county and industry sector
- **Metric:** Vacancy rate (job postings / labor force)
- **Scoring:**
  - < 1% vacancy → 40 (too tight — workforce shortage risk)
  - 1–2% → 70
  - 2–4% → 100 (ideal moderate vacancy)
  - 4–6% → 80
  - 6–9% → 60
  - > 9% → 30 (slack labour market)

### D. Colorado CDE School Boundaries
- **File:** `data/market/cde_schools_co.json`
- **Connector:** `js/data-connectors/cde-schools.js` (exposes `window.CdeSchools`)
- **Source:** Colorado Department of Education
  - Portal: `https://www.cde.state.co.us/accountability`
  - Metrics: Graduation rate, ELA/math proficiency, free/reduced lunch %
- **Metric:** Composite school quality score (0–100) of nearest district
- **Scoring:** Direct composite_quality_score from CDE data

### E. CDOT Traffic Counts
- **File:** `data/market/cdot_traffic_co.json`
- **Connector:** `js/data-connectors/cdot-traffic.js` (exposes `window.CdotTraffic`)
- **Source:** Colorado Department of Transportation Traffic Count Program
  - Portal: `https://www.codot.gov/programs/statewideplanning/traffic-data`
  - Metric: Annual Average Daily Traffic (AADT) at permanent count stations
- **Scoring:**
  - AADT < 5,000 → 30 (remote; limited connectivity)
  - AADT 5–15k → 50
  - AADT 15–30k → 65
  - AADT 30–60k → 80
  - AADT 60–100k → 90
  - AADT > 100k → 100 (major corridor)

## Graceful Degradation

All workforce connectors degrade gracefully:
- If a data file is missing or fails to load, the connector returns a neutral score (50) for that factor
- The overall workforce score will still be computed using available factors
- Console warnings are emitted for any missing data

## Upgrading to Real Data

The current data files contain synthetic approximations. To replace with real data:

1. **LODES:** Download Colorado WAC tables from `https://lehd.ces.census.gov/data/co/r2022/`
   - Files: `co_wac_S000_JT00_2021.csv`
   - Script: adapt `scripts/market/build_public_market_data.py`

2. **CDLE:** Download from CDLE LMI portal at `https://www.colmigateway.com/`
   - Monthly employment situation reports

3. **CDE:** Download district profiles from `https://www.cde.state.co.us/accountability/parcc`

4. **CDOT:** Download traffic station data from `https://www.codot.gov/programs/statewideplanning/traffic-data/files/2023-traffic-counts`

See `scripts/market/build_public_market_data.py` for fetch pattern to adapt.
