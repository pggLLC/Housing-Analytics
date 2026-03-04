# Feature Complete: Market Analysis + Market Intelligence

## Status Overview

All subsystems for the Market Analysis and Market Intelligence features are implemented,
tested, and deployed. CI checks pass. No live API keys are required for page load.

---

## Live URLs (GitHub Pages)

| Page | URL |
|------|-----|
| Market Analysis | `<repo-root>/market-analysis.html` |
| Market Intelligence | `<repo-root>/market-intelligence.html` |
| Colorado Deep Dive | `<repo-root>/colorado-deep-dive.html` |

---

## Functional Completeness Matrix

### Market Analysis (`market-analysis.html` + `js/market-analysis.js`)

| Subsystem | Status |
|-----------|--------|
| Interactive Leaflet map — click to place site marker | ✅ |
| PMA circle drawn at selected buffer radius (3/5/10/15 mi) | ✅ |
| Census tracts selected within PMA, ACS metrics aggregated | ✅ |
| PMA composite score (0–100) + tier label | ✅ |
| Radar chart — 5 dimensions (demand, capture_risk, rent_pressure, land_supply, workforce) | ✅ |
| Score breakdown card with all subscores | ✅ |
| LIHTC comps count + estimated units | ✅ |
| Capture rate simulator (proposed units × AMI mix) | ✅ |
| Real-time capture_rate calculation per AMI band | ✅ |
| Risk flags (capture ≥ 0.25, cost_burden ≥ 0.45, rent_pressure ≥ 1.10) | ✅ |
| JSON export (`exportJson()` → pma-result.json) | ✅ |
| CSV export (`exportCsv()` → pma-result.csv) | ✅ |
| Responsive 2-col → 1-col layout | ✅ |
| Sticky map panel | ✅ |

### Market Intelligence (`market-intelligence.html` + `js/market-intelligence.js`)

| Subsystem | Status |
|-----------|--------|
| Affordability Pressure card (cost_burden_rate, median_income, median_gross_rent, rent_pressure_index) | ✅ |
| Housing Supply & Vacancy card (vacancy_rate, renter_households) | ✅ |
| Affordable Inventory card (LIHTC count + units, map overlay) | ✅ |
| Capture / Penetration card (default scenario + threshold bands) | ✅ |
| Policy card (Prop 123 count by type, map overlay) | ✅ |
| Geography selector (statewide default + county dropdown) | ✅ |
| JSON + CSV export for current geography summary | ✅ |
| Error messages displayed for missing data (no silent failures) | ✅ |
| No live API calls required (all from local data artifacts) | ✅ |

### Proposition 123 & County Boundaries (`js/colorado-deep-dive.js`, `js/prop123-map.js`)

| Subsystem | Status |
|-----------|--------|
| `prop123Initialized` guard flag prevents duplicate init | ✅ |
| `loadWithFallback()` uses `DataService.baseData('policy/prop123_jurisdictions.json')` | ✅ |
| Fallback triggered if primary fetch fails | ✅ |
| Error message displayed on failure (no silent failures) | ✅ |
| County boundary stroke — light theme: `rgba(15,23,42,0.60)`, weight 2.25 px | ✅ |
| County boundary stroke — dark theme: `rgba(248,250,252,0.50)`, weight 2.25 px | ✅ |
| Theme toggle updates boundaries in real-time via MutationObserver | ✅ |

### Navigation

| Item | Status |
|------|--------|
| `{ label: "Market Analysis", href: "market-analysis.html" }` in `js/navigation.js` | ✅ |
| `{ label: "Market Intelligence", href: "market-intelligence.html" }` in `js/navigation.js` | ✅ |
| Active page class (`is-active`) applied | ✅ |
| Responsive nav: mobile hamburger + desktop flex | ✅ |

---

## Data Artifacts

| File | Size / Records | Notes |
|------|---------------|-------|
| `data/policy/prop123_jurisdictions.json` | 350+ jurisdictions | Prop 123 policy data |
| `data/market/tract_centroids_co.json` | 20 placeholder tracts | Expanded by CI builder |
| `data/market/acs_tract_metrics_co.json` | 20 placeholder tracts | Expanded by CI builder |
| `data/market/hud_lihtc_co.geojson` | 10 placeholder features | Expanded by CI builder |

> **Note:** Placeholder datasets ship with the repo. The weekly CI workflow
> (`build-market-data.yml`) replaces them with full ACS + HUD data.

---

## Known Limitations

- **ACS data lag:** 5-year ACS estimates lag by ~2 years. Rent and income figures
  reflect survey period, not current market conditions.
- **Placeholder data at initial deploy:** The `data/market/` files are small
  placeholders until the weekly build pipeline runs with a valid `CENSUS_API_KEY`.
- **Workforce dimension placeholder:** The `workforce` radar dimension uses a
  constant proxy (0.60) until LODES commute data is integrated.
- **No parcel/zoning layer:** Site-level land availability uses a proxy score;
  full parcel/zoning integration is a future enhancement.

---

## Future Enhancements

- LODES workforce integration for real commuter-shed scoring
- Parcel and zoning layer for land availability subscore
- Deeper site selection with comparable rent roll benchmarking
- Historical trend charts in Market Intelligence
- Multi-county aggregation view

---

## Deployment & Testing

### Running smoke tests locally
```bash
node test/smoke-market-analysis.js
```

### Running CI checks locally
```bash
# Verify required files exist and are valid JSON
bash .github/workflows/ci-checks.yml   # (run steps manually)

# Or use the validate script
node validate.js
```

### Rebuilding data artifacts (requires Census API key)
```bash
CENSUS_API_KEY=<your-key> python3 scripts/market/build_public_market_data.py
```

### GitHub Pages verification
After merging to `main`, GitHub Pages deploys automatically via `.github/workflows/deploy.yml`.
