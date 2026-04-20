# COHO Analytics

> COHO Analytics is a data-driven decision-support platform for affordable housing professionals — developers, housing authorities, policymakers, and researchers navigating LIHTC allocations, market feasibility, and housing affordability.

[![Deploy to GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://pggllc.github.io/Housing-Analytics/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Open PRs](https://img.shields.io/github/issues-pr/pggLLC/Housing-Analytics)](https://github.com/pggLLC/Housing-Analytics/pulls)

---

## Overview

COHO Analytics is a static web application providing comprehensive data insights on:
- **State LIHTC Allocations** — IRS per-capita cap data, year-over-year comparisons
- **Colorado Market Deep Dive** — CHFA priorities, Denver metro trends, AMI gap analysis
- **Economic Indicators** — Federal Reserve FRED data, construction costs, CPI
- **Legislative Tracker** — AHCIA, CRA expansion, housing policy updates
- **Regional Analysis** — Multifamily trends, CRA footprints, national allocation maps

## What's Next?

For the current prioritized work queue, see:
- [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md)

When choosing the next issue, start with the **P0** and **P1** items listed there, then proceed in the documented execution order.

## Live Pages (38 total)

| Page | Description |
|------|-------------|
| `index.html` | Home — overview and navigation hub |
| `economic-dashboard.html` | FRED-powered economic indicators dashboard with housing prediction markets |
| `lihtc-allocations.html` | LIHTC state allocation maps and data — consolidated from former LIHTC-dashboard + state-allocation-map pages |
| `regional.html` | Regional housing market analysis |
| `colorado-deep-dive.html` | Colorado housing market deep dive — county-level maps, regional predictions, and market overview (tab) |
| `housing-needs-assessment.html` | Housing Needs Assessment tool (Colorado-focused; Census + LEHD + DOLA/SDO) — 546 geographies (64 counties, 271 places, 211 CDPs) |
| `market-analysis.html` | Primary Market Analysis (PMA) tool — site scoring, supply/demand, LIHTC concept recommendation with housing needs alignment |
| `market-intelligence.html` | Market Intelligence dashboard — CAR data, FRED trends, rental metrics |
| `deal-calculator.html` | LIHTC Feasibility Calculator — 4% vs 9% credit sizing, sources & uses, first mortgage |
| `select-jurisdiction.html` | Jurisdiction selector — routes to HNA, comparative analysis, or scenario builder |
| `hna-comparative-analysis.html` | HNA Comparative Ranking — statewide jurisdiction needs ranking with scorecard |
| `hna-scenario-builder.html` | HNA Scenario Builder — what-if modeling for housing policy outcomes |
| `compliance-dashboard.html` | Prop 123 Compliance Dashboard — jurisdiction commitments map |
| `chfa-portfolio.html` | CHFA Portfolio — Colorado LIHTC project map and list |
| `preservation.html` | Affordable housing preservation tracker (NHPD) |
| `cra-expansion-analysis.html` | CRA expansion analysis and forecast |
| `housing-legislation-2026.html` | 2026 housing legislation tracker |
| `colorado-elections.html` | Colorado elections and housing ballot measures |
| `policy-briefs.html` | Weekly housing policy briefs |
| `data-status.html` | Live data pipeline status and freshness report |
| `data-review-hub.html` | Data quality review and validation hub |
| `insights.html` | Market insights and research articles |
| `article-pricing.html` | Housing pricing analysis article |
| `article-co-housing-costs.html` | Colorado housing costs analysis |
| `colorado-market.html` | Colorado market overview |
| `lihtc-guide-for-stakeholders.html` | LIHTC Basics — stakeholder guide for developers, housing authorities, and investors |
| `lihtc-enhancement-ahcia.html` | LIHTC enhancement and AHCIA data |
| `privacy-policy.html` | Privacy policy |
| `sitemap.html` | Site directory |
| `about.html` | About the project and methodology |
| `og-card.html` | Open Graph card preview |

### Archived Pages

The following pages have been moved to `archive/` and are no longer linked in the main navigation:

| Page | Reason |
|------|--------|
| `archive/dashboard.html` | Superseded by specialized dashboard pages |
| `archive/dashboard-data-quality.html` | Internal QA tool, not user-facing |
| `archive/dashboard-data-sources-ui.html` | Replaced by `data-status.html` |
| `archive/census-dashboard.html` | Subsumed by Housing Needs Assessment tool |
| `archive/construction-commodities.html` | Incomplete; data available in Economic Dashboard |

## Project Structure

```
Housing-Analytics/
├── index.html                     # Entry point
├── *.html                         # 38 page files (see Live Pages above)
│
├── css/                           # 16 stylesheets (no build step)
│   ├── site-theme.css             # Design tokens, dark/light mode, typography
│   ├── layout.css                 # Containers, grids, print styles
│   ├── pages.css                  # Shared components (buttons, cards, hero, etc.)
│   ├── navigation.css             # Header, footer, breadcrumb styles
│   ├── mobile-nav.css             # Hamburger menu and responsive nav
│   ├── dark-mode.css              # Dark mode overrides
│   ├── accessibility.css          # Focus rings, ARIA live regions, skip links
│   ├── responsive.css             # Breakpoint-specific overrides
│   ├── print.css                  # Print-optimized styles
│   ├── spacing.css                # Utility spacing classes
│   ├── data-dashboard.css         # Data status/quality dashboards
│   ├── comparative-analysis.css   # HNA comparison layouts
│   ├── scenario-builder.css       # HNA scenario builder forms
│   ├── help-modal.css             # Glossary/help modal overlay
│   ├── predictions-dashboard.css  # Economic dashboard prediction layout
│   └── colorado-regional-predictions.css # Regional predictions grid
│
├── js/                            # 136 JavaScript modules (ES5 IIFEs, no build step)
│   ├── config/
│   │   └── financial-constants.js # Centralized COHO_DEFAULTS (credit rates, equity, AMI)
│   ├── data-connectors/           # External data source adapters
│   │   ├── hud-fmr.js            # HUD Fair Market Rent / income limits
│   │   └── hud-egis.js           # QCT/DDA point-in-polygon overlay
│   ├── hna/                       # Housing Needs Assessment modules
│   │   ├── hna-controller.js     # HNA page orchestrator
│   │   ├── hna-renderers.js      # Section renderers + scorecard panel
│   │   ├── hna-comparison.js     # Comparative ranking engine
│   │   ├── hna-ranking-index.js  # Statewide jurisdiction ranking
│   │   ├── hna-export.js         # CSV/PDF export
│   │   └── hna-market-bridge.js  # HNA ↔ PMA data bridge
│   ├── market-analysis/           # PMA engine modules
│   │   ├── market-analysis-controller.js  # Site analysis orchestrator
│   │   ├── site-selection-score.js        # Multi-dimensional site scoring
│   │   └── housing-needs-fit-analyzer.js  # HNA gap ↔ concept alignment
│   ├── data-service-portable.js   # Central data loader (FRED, Census, market data)
│   ├── market-analysis.js         # PMA scoring engine (5 dimensions, 15 weights)
│   ├── deal-calculator.js         # LIHTC feasibility calculator (4%/9%, S&U)
│   ├── lihtc-deal-predictor.js    # Concept recommendation engine
│   ├── co-lihtc-map.js           # Colorado LIHTC project map (Leaflet)
│   ├── fetch-helper.js           # Retry + timeout fetch wrapper
│   └── vendor/                    # Vendored libraries (no CDN dependency)
│       ├── chart.umd.min.js      # Chart.js v4
│       ├── d3.v7.min.js          # D3.js v7
│       ├── topojson.v3.min.js    # TopoJSON v3
│       └── leaflet.js + .css     # Leaflet.js maps
│
├── data/
│   ├── allocations.json           # LIHTC allocation data (all 50 states)
│   ├── chfa-lihtc.json            # Colorado LIHTC projects (CHFA ArcGIS)
│   ├── co_ami_gap_by_county.json  # Colorado AMI gap by county (64 counties)
│   ├── fred-data.json             # Cached FRED economic data
│   ├── qct-colorado.json          # HUD Qualified Census Tracts (224 features)
│   ├── dda-colorado.json          # HUD Difficult Development Areas
│   ├── hud-fmr-income-limits.json # HUD FMR and income limits
│   ├── manifest.json              # Data pipeline build manifest
│   ├── hna/                       # Housing Needs Assessment data
│   │   ├── geo-config.json        # 546 geographies (counties, places, CDPs)
│   │   ├── ranking-index.json     # Statewide needs ranking
│   │   ├── local-resources.json   # Housing authorities, nonprofits, plans
│   │   └── summary/              # Per-jurisdiction JSON profiles (546 files)
│   ├── market/                    # PMA market data (35 files)
│   │   ├── lodes_co.json         # LEHD LODES commuting data
│   │   ├── food_access_co.json   # USDA Food Access Atlas
│   │   ├── climate_hazards_co.json # NOAA/EPA climate + EJ data
│   │   ├── utility_capacity_co.geojson # Utility service areas (351 features)
│   │   ├── environmental_constraints_co.geojson # Protected lands
│   │   └── ...                    # 30 additional market data files
│   ├── policy/                    # Policy and compliance data
│   │   ├── prop123_jurisdictions.json     # Prop 123 commitment status
│   │   ├── housing-policy-scorecard.json  # 7-dimension policy scorecard
│   │   ├── soft-funding-status.json       # Local funding programs
│   │   └── lihtc-assumptions.json         # Deal predictor assumptions
│   └── states-10m.json           # US states TopoJSON
│
├── scripts/                       # Data pipeline scripts
│   ├── hna/                       # HNA data builders
│   ├── market/                    # Market data fetchers (LODES, NOAA, EPA, DWR, etc.)
│   ├── policy/                    # Policy data builders (scorecard, prop123)
│   ├── kalshi/                    # Prediction market data
│   ├── audit/                     # Playwright site audit
│   └── validate-schemas.js        # Schema validation (85 checks)
│
├── test/                          # Unit + integration tests
│   ├── unit/                      # Module-level tests
│   └── smoke-market-analysis.js   # 185 smoke checks
│
└── .github/workflows/             # 37 CI/CD workflows
    ├── deploy.yml                 # GitHub Pages deploy
    ├── ci-checks.yml              # Schema validation + artifact checks
    ├── build-hna-data.yml         # HNA data pipeline
    ├── market_data_build.yml      # Market data pipeline
    ├── site-audit.yml             # Playwright site audit
    ├── accessibility.yml          # WCAG contrast/a11y audit
    └── ...                        # 31 additional data + monitoring workflows
```

## Market Analysis Tool — Phase 2

The PMA (Primary Market Analysis) tool on `market-analysis.html` includes a full Phase 2 LIHTC concept recommendation engine:

### Features

| Feature | Description |
|---------|-------------|
| **ACS Cache Persistence** | `js/market-analysis-cache-fix.js` — persists ACS tract data globally so the second (and subsequent) map clicks work without "No ACS data" errors |
| **LIHTC Concept Recommendation** | `js/lihtc-deal-predictor.js` — recommends 4% vs 9% execution, concept type, unit mix, AMI mix, capital stack, risks, and caveats |
| **Full Concept Card** | `js/lihtc-concept-card-renderer.js` — renders the complete recommendation card for both buffer and enhanced (commuting/hybrid) analysis modes |
| **Housing Needs Fit** | `js/market-analysis/housing-needs-fit-analyzer.js` — bridges local HNA data with the concept recommendation, showing AMI tier coverage %, alignment rating, and un-addressed gaps |
| **HNA-PMA Bridge** | `js/hna/hna-market-bridge.js` — converts HNA affordability gap and demand signals into deal predictor inputs |

### Concept Card Sections

- 🟢/🟡/🔴 Confidence badge + recommended execution (4% or 9%)
- Concept type and total unit count
- Unit mix breakdown (studio, 1-BR, 2-BR, 3-BR+)
- AMI mix breakdown (30%, 50%, 60%)
- Why this fits — rationale bullets
- ⚠ Key risks — warning flags
- Alternative path
- Indicative capital stack (collapsible)
- Important caveats (yellow warning box)
- 🏘 Housing Needs Fit — AMI tier coverage bars, alignment rating, and gap analysis grounded in local HNA data

### Testing

```bash
node test/test_lihtc_deal_predictor.js          # 68 tests
node test/test_hna_market_bridge.js             # 68 tests
node test/test_housing_needs_fit_analyzer.js    # 55 tests
node test/smoke-market-analysis.js              # 185 smoke checks
```

## CSS Architecture

The site uses a **16-file CSS stack** — no build step required. Core files loaded on every page:

```html
<link rel="stylesheet" href="css/site-theme.css">   <!-- tokens, dark mode -->
<link rel="stylesheet" href="css/layout.css">        <!-- containers, grids -->
<link rel="stylesheet" href="css/pages.css">         <!-- all shared components -->
```

Additional CSS files are loaded per-page as needed (e.g., `comparative-analysis.css`, `scenario-builder.css`).

### Design Tokens (in `site-theme.css`)

```css
/* Colors */
--accent, --accent2, --good, --warn, --bad, --info
--bg, --bg2, --bg3, --card, --text, --text-strong, --muted, --faint, --border

/* Spacing */
--sp1 through --sp6

/* Typography */
--h1, --h2, --font-sans, --font-mono, --small, --tiny

/* Shadows & Radius */
--shadow, --shadow-lg, --radius, --radius-lg
```

Dark mode is handled automatically via `@media (prefers-color-scheme: dark)` and the `.dark-mode` class for manual override.

## API Configuration

`js/config.js` is committed to the repository with empty placeholder API keys. In CI, secrets are
injected via GitHub Actions. For local development, create `js/config.local.js` (gitignored) with
your API keys:

```js
// js/config.local.js — NOT committed to git
window.CONFIG = {
  FRED_API_KEY: 'your-fred-api-key-here',
  CENSUS_API_KEY: 'your-census-api-key-here'
};
```

Free API keys:
- **FRED**: https://fred.stlouisfed.org/docs/api/api_key.html
- **Census**: https://api.census.gov/data/key_signup.html

Without API keys, dashboards fall back to cached data in `/data/*.json`.

### HUD GIS Overlay Cache (`cache-hud-gis-data.yml`)

The Colorado Deep Dive map loads QCT and DDA overlay data using a three-tier fallback:

1. **Cached file** — `data/qct-colorado.json` and `data/dda-colorado.json` (fastest, offline-safe)
2. **Live HUD ArcGIS API** — queries `STATEFP='08'` directly from HUD FeatureServer
3. **Embedded JS fallback** — representative data bundled in `colorado-deep-dive.html`

The cached files are updated every Monday at 04:00 UTC by
`.github/workflows/cache-hud-gis-data.yml`. **Run this workflow manually** (GitHub Actions
→ "Cache HUD GIS Overlay Data" → "Run workflow") whenever:
- The cached files are missing after a fresh clone or branch reset
- A new featured geography (e.g. Clifton CDP) needs its QCT/DDA tracts pre-cached
- The HUD overlay vintage changes (e.g. 2026 → 2027 designations are released)

No API secrets are required — HUD ArcGIS FeatureServer endpoints are public.

### Kalshi Prediction Market Data

The Housing Prediction Market Dashboard (`economic-dashboard.html`) loads live probability
data from `data/kalshi/prediction-market.json`, fetched weekly by
`.github/workflows/fetch-kalshi.yml`.

> **Note:** Colorado regional housing predictions (2025 point estimates, forecast ranges, and
> year-over-year changes across Denver Metro, Western Slope, Colorado Springs/Pueblo,
> Boulder/Northern Front Range, and Mountains) are displayed in the **Market Trends** tab of
> `colorado-deep-dive.html` and are rendered by `js/colorado-regional-predictions.js`.
> Forecasts incorporate CHFA reports, Colorado Division of Housing data, DMAR statistics,
> CBRE Mountain West outlook, Boulder County Assessor records, Colorado Springs Board of
> Realtors, and Colorado Ski Country USA resort-market data.

**Required GitHub Actions secrets** (Settings → Secrets and variables → Actions):

| Secret                | Description |
|-----------------------|-------------|
| `KALSHI_API_KEY`      | Kalshi access-key ID |
| `KALSHI_API_SECRET`   | RSA private key in PEM format |
| `KALSHI_API_BASE_URL` | *(Optional)* Defaults to `https://trading-api.kalshi.com` |

If the secrets are not configured or the Kalshi API is unreachable, the workflow writes an
empty `data/kalshi/prediction-market.json` and the dashboard automatically falls back to its
built-in illustrative demo values — the dashboard never breaks.

**Running the fetch script locally:**

```bash
# Without credentials — writes empty fallback JSON (dashboard uses mock data)
node scripts/kalshi/fetch_kalshi_prediction_markets.js

# With credentials
KALSHI_API_KEY=<key_id> \
KALSHI_API_SECRET="$(cat /path/to/private_key.pem)" \
  node scripts/kalshi/fetch_kalshi_prediction_markets.js
```

**Configuring market tickers:** Open `scripts/kalshi/fetch_kalshi_prediction_markets.js` and
update the `seriesTicker` / `eventTicker` fields in the `MARKET_CONFIG` array with the
verified Kalshi series or event tickers for each housing metric.

## Deployment

### GitHub Pages (Recommended)

1. Fork / push this repo to GitHub
2. Go to **Settings → Pages**
3. Source: `Deploy from a branch` → `main` / `/ (root)`
4. The GitHub Actions workflows (37 in `.github/workflows/`) handle deploy, data refresh, audits, and monitoring automatically

### Local Development

```bash
# Using npx serve (no install needed)
npx serve . -p 3000

# Or Python 3
python3 -m http.server 3000
```

Then open `http://localhost:3000`

### Netlify / Vercel

Drop the repo into Netlify or Vercel with these settings:
- **Build command**: *(none — static site)*
- **Publish directory**: `.` (root)

## Data Sources

All data is sourced from authoritative public sources (20+ APIs and datasets):

| Source | Data |
|--------|------|
| [IRS LIHTC Database](https://www.irs.gov/credits-deductions/businesses/low-income-housing-tax-credit) | Annual allocation caps and per-capita amounts |
| [U.S. Census ACS](https://www.census.gov/programs-surveys/acs) | AMI, income, housing cost burden, demographics |
| [Census LEHD/LODES](https://lehd.ces.census.gov/) | Workforce commuting patterns (origin-destination) |
| [Census TIGERweb](https://tigerweb.geo.census.gov/) | Incorporated place boundaries, CDPs |
| [Federal Reserve FRED](https://fred.stlouisfed.org/) | Construction costs, CPI, interest rates |
| [HUD / HUDUSER](https://www.huduser.gov/) | Fair market rents, income limits, QCT/DDA designations |
| [HUD eGIS ArcGIS](https://hudgis-hud.opendata.arcgis.com/) | QCT/DDA polygon overlays, PHA locations |
| [CHFA ArcGIS](https://services.arcgis.com/VTyQ9soqVukalItT/) | **Primary** Colorado LIHTC project locations |
| [FEMA NFHL](https://www.fema.gov/flood-maps) | Flood zone designations by tract |
| [EPA EJScreen / EJI](https://ejscreen.epa.gov/) | Environmental justice index, social vulnerability |
| [EPA Smart Location Database](https://www.epa.gov/smartgrowth/smart-location-mapping) | Transit access, walkability, job accessibility |
| [USDA Food Access Atlas](https://www.ers.usda.gov/data-products/food-access-research-atlas/) | Food desert designations |
| [Opportunity Insights](https://opportunityinsights.org/) | Upward mobility metrics by tract |
| [NOAA CDO](https://www.ncdc.noaa.gov/cdo-web/) | Climate normals, extreme weather stations |
| [Colorado DWR](https://dwr.state.co.us/) | Water district infrastructure (78 districts) |
| [Colorado DOLA](https://demography.dola.colorado.gov/) | Population projections, demographic estimates |
| [Colorado CDLE](https://www.colmigateway.com/) | Job vacancy rates by industry/region |
| [Colorado CDE](https://www.cde.state.co.us/) | School quality ratings |
| [CDOT](https://www.codot.gov/) | Traffic connectivity, AADT counts |
| [NHPD](https://preservationdatabase.org/) | National Housing Preservation Database |
| [BLS & BEA](https://www.bls.gov/) | Employment, wages, economic indicators |

> **Colorado LIHTC Data Provenance:** For Colorado, the CHFA ArcGIS FeatureServer is queried first for LIHTC project data. If it is unreachable or returns no data, the system automatically falls back to the HUD LIHTC ArcGIS service. The active data source is labeled (Source: CHFA / Source: HUD) on all Colorado LIHTC project listings and popups.

## Multi-Tier Fallback & Persistent Backup

All map overlay data (LIHTC, QCT, DDA) uses a four-tier fallback strategy so pages remain functional even when live APIs are unavailable:

| Tier | Source | Notes |
|------|--------|-------|
| 1 | **Live API** (CHFA ArcGIS → HUD ArcGIS) | Most current data; tried first |
| 2 | **Local `/data/` file** (e.g., `data/chfa-lihtc.json`) | Written by CI scripts on each successful deploy |
| 3 | **GitHub Pages backup** (`https://pggllc.github.io/Housing-Analytics/data/…`) | Same files served as static assets; always reflects the last good CI run |
| 4 | **Minimal embedded JSON** | Hard-coded representative records; used only if all above fail |

The persistent backup in tiers 2 and 3 is kept current by running `scripts/fetch-chfa-lihtc.js` (and equivalent scripts) as part of the GitHub Actions deploy workflow. No extra infrastructure is needed — the committed `/data/` files become the GitHub Pages backup automatically.

### Critical Data Files

The following files in `/data/` are **referenced by the UI but are not included as blank placeholders** because they require live data to be meaningful. Panels that depend on them show a warning/placeholder until the files are supplied:

| File | Referenced by | How to supply |
|------|--------------|--------------|
| `data/car-market.json` | `colorado-deep-dive.html` CAR market KPI panel | Run `node scripts/fetch-car-data.js` or configure the `FETCH_CAR_DATA` GitHub Actions workflow |
| `data/policy/prop123_jurisdictions.json` | `colorado-deep-dive.html` Prop 123 commitment table (`js/prop123-map.js`) | Populate from the [CDOLA commitment-filings portal](https://cdola.colorado.gov/commitment-filings) or run `node scripts/fetch-prop123.js` if available |

Without these files the affected panels display placeholder dashes or an explanatory message rather than crashing. All other panels continue to function normally.

## Browser Support

- Chrome 90+, Firefox 90+, Safari 14+, Edge 90+
- Requires CSS Custom Properties, Grid, and `color-mix()` (for hover effects)
- `color-mix()` gracefully degrades on older browsers — hover states just use the base color

## Automated Site Audit

The repository includes a Playwright-based audit workflow that loads key pages, records console errors and failed network requests, verifies that map/data requests fire, and produces JSON + HTML reports as GitHub Actions artifacts.

### Running locally

1. Start the static server (serves the repo root like GitHub Pages):
   ```bash
   node scripts/audit/serve-static.mjs
   ```
2. In a separate terminal, run the audit:
   ```bash
   AUDIT_BASE_URL=http://127.0.0.1:8080 npm run audit:site
   ```
3. Open `audit-report/<timestamp>/report.html` in your browser to view results.

### CI workflow

The `site-audit.yml` GitHub Actions workflow runs automatically on pull requests and can be triggered manually via `workflow_dispatch`. After a run, download the **audit-report** artifact from the Actions summary page and open `report.html` to inspect results.

The audit only fails CI on **hard failures**:
- JavaScript runtime errors
- Missing local data files (4xx on local requests)
- ArcGIS/Tigerweb service failures (5xx or network error)

### Audit diagnostics panel (`?audit=1`)

Four dashboards include `js/audit-hook.js`, which activates an overlay panel when the `?audit=1` query parameter is present. The panel shows the last 20 fetch/XHR URLs and any failures. It does nothing when the parameter is absent, so it has no effect on normal production use.

Example: `https://pggllc.github.io/Housing-Analytics/economic-dashboard.html?audit=1`

## License

MIT © COHO Analytics

This tool is provided for educational and research purposes. All economic data is sourced from public federal and state databases. This is not investment advice.

## Actionable Recommendations

- Docs and site-audit pipeline are automatically updated after every merge.

## 
