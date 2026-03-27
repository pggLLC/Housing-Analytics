# COHO Analytics — Implementation Plan (Phase 3–5)

> **Status:** Phase 3 complete · Phase 4 planned · Phase 5 planned  
> **Updated:** 2026-03-26

---

## Phase 3: Data Pipeline, Site Architecture & State Management ✅

### Completed (this PR)

- **`js/site-state.js`** — Shared site state manager with localStorage persistence, subscribe/event support, and DOM auto-wiring via `[data-state-key]` attributes
- **`js/chart-fix.js`** — Sitewide chart lifecycle manager using IntersectionObserver, ResizeObserver, and `<details>` toggle handling
- **`scripts/market/normalize_qct_dda_co.py`** — Normalize QCT/DDA designations into map-ready county/tract format
- **`scripts/market/validate_qct_dda_co.py`** — Schema validation for normalized output
- **Updated `fetch-fred-data.yml`** — Added Colorado-specific FRED series (unemployment, construction, housing)
- **Updated HTML pages** — `economic-dashboard.html`, `market-analysis.html`, `housing-needs-assessment.html`, `colorado-deep-dive.html`, `market-intelligence.html` now include `site-state.js` and `chart-fix.js`
- **Updated `js/navigation.js`** — Added information architecture comments; documented stub/primary page hierarchy
- **Documentation** — `docs/PMA_DATA_SOURCES_COMPLETE.md`, `docs/SITE_STATE_USAGE.md`, `docs/CHART_FIX_USAGE.md`

### Known Remaining Items

- `data/market/qct_dda_designations_co.json` is a stub; rebuild via `scripts/market/fetch_qct_dda.py` once firewall allows HUD GIS access (see PR #422)
- `colorado-market.html` is a stub page — either fully build it or add a server-side redirect to `colorado-deep-dive.html`
- Firewall allowlist for `data.denvergov.org` and `services1.arcgis.com` (see PR #422)

---

## Phase 4: LIHTC Award Probability Engine 🔜

### Objective

Build a data-driven award probability scoring engine that predicts CHFA LIHTC award likelihood for a given site, leveraging the Phase 3 state/data foundation.

### Planned Deliverables

#### 4.1 Award Probability Page (`award-probability.html`)
- County + site selector (reads from `SiteState.getCounty()`)
- Inputs: site address, unit count, bedroom mix, proposed rents, construction type
- Scoring dimensions:
  - Market demand signal (from HNA data)
  - QCT/DDA bonus eligibility (from `qct_dda_designations_co_normalized.json`)
  - Competitive supply pressure (from LIHTC portfolio)
  - Developer track record (from `chfa-awards-historical.json`)
  - Geographic priority (from CHFA QAP geographic preferences)
  - Financial feasibility (gap analysis, soft funding availability)

#### 4.2 CHFA QAP Integration
- Parse and store CHFA Qualified Allocation Plan scoring criteria
- Map QAP scoring items to available data signals
- Data file: `data/policy/qap-scoring-2025.json`

#### 4.3 Deal Prediction Module Enhancement
- Extend `js/chfa-award-predictor.js` with:
  - Probability output as % (e.g., "68% likely to receive award")
  - Confidence interval based on data quality
  - Comparable award history lookup

#### 4.4 Colorado Economic Context Integration
- Wire Colorado FRED series (added Phase 3) into award probability signals:
  - `COUR08000000000000006` → local unemployment pressure
  - `COBP` → construction activity
  - `COAHOMIDX` → market price pressure
- Display Colorado KPIs on `economic-dashboard.html` Colorado section

### Acceptance Criteria

- [ ] `award-probability.html` loads county context from `SiteState` without requiring re-entry
- [ ] QCT/DDA designation auto-detected for selected census tract
- [ ] Award probability score displayed with confidence level and data sources
- [ ] Colorado FRED section visible on `economic-dashboard.html`
- [ ] Historical award comps shown for selected county

---

## Phase 5: Zoning Intelligence & Regional Expansion 🔜

### Objective

Add parcel-level zoning intelligence for LIHTC site identification, and expand the platform beyond Colorado to peer states.

### Planned Deliverables

#### 5.1 Zoning Overlay Layer
- Fetch and normalize zoning data for Colorado metro areas (Denver, Boulder, Fort Collins, Colorado Springs, Pueblo)
- Data source: `scripts/market/fetch_zoning.py` (stub exists)
- Render as Leaflet tile overlay on `market-analysis.html`
- Flag parcels where multifamily residential is permitted as-of-right

#### 5.2 Parcel-Level Site Suitability
- Extend `scripts/market/fetch_parcel_data.py` to include:
  - Zoning classification
  - Flood zone (FEMA, already in `data/environmental/fema-flood-co.geojson`)
  - Transit access score
  - Schools score
- Output: `data/market/parcel_suitability_co.json`

#### 5.3 Regional Peer-State Expansion
- Extend ACS, FRED, HUD pipelines to include 5–10 peer states:
  - Utah, Arizona, New Mexico, Wyoming, Montana (Mountain West)
  - Texas, California, Washington (major affordable housing markets)
- Add state selector to `housing-needs-assessment.html` and `market-analysis.html`

#### 5.4 Automated Data Refresh Monitoring
- Implement `scripts/monitoring/data-freshness-check.py`
- Alert via Slack/GitHub Issue when any data file exceeds its expected refresh interval
- Dashboard: `data-status.html` (already exists) enhanced with per-source SLA

### Acceptance Criteria

- [ ] Zoning overlay visible on market analysis map for Denver metro
- [ ] Site suitability score generated for any parcel click in metro areas
- [ ] Peer-state data available in HNA tool (state selector)
- [ ] Data freshness alerts firing within 24 hours of a missed refresh

---

## Cross-Cutting Principles

1. **Static hosting compatible** — No build steps on the client; all data is pre-fetched and cached in `data/`
2. **WCAG 2.1 AA** — Every new page/component must pass Stage 3 accessibility tests (`tests/test_stage3_visualization.py`)
3. **Rule 1 (FIPS)** — All FIPS codes are 5-digit strings; never bare 3-digit codes
4. **Rule 18 (Sentinels)** — ETL output files must preserve `updated`/`fetchedAt`/`generated` timestamp keys
5. **Incremental changes** — Do not refactor pages into a SPA framework; use targeted additions
6. **Test coverage** — New modules need unit tests in `test/` (Jest-compatible)

---

## Related Issues & PRs

| Item | Status | Notes |
|---|---|---|
| PR #422 | Draft | TIGERweb + PMA data pipeline; blocked by firewall |
| Issue #447 | Open | Data Quality, Monitoring & Infrastructure |
| Issue #446 | Open | Documentation, Testing, Implementation Guidance |
| Issue #445 | Open | Enhanced LIHTC Deal Prediction Module → Phase 4 |
| Issue #444 | Open | Legislative & CRA Expansion Tracker |
| Issue #408 | Open | Market data build failure (missing CENSUS_API_KEY) |
| Issue #409 | Open | Market data build failure (missing CENSUS_API_KEY) |
