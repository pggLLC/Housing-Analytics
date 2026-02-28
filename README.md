# Affordable Housing Intelligence

> Data-driven market intelligence for affordable housing professionals — policymakers, developers, and researchers tracking the Low-Income Housing Tax Credit (LIHTC) program.

[![Deploy to GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://pggllc.github.io/Housing-Analytics/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Open PRs](https://img.shields.io/github/issues-pr/pggLLC/Housing-Analytics)](https://github.com/pggLLC/Housing-Analytics/pulls)

---

## Overview

Affordable Housing Intelligence is a static web application providing comprehensive data insights on:
- **State LIHTC Allocations** — IRS per-capita cap data, year-over-year comparisons
- **Colorado Market Deep Dive** — CHFA priorities, Denver metro trends, AMI gap analysis
- **Economic Indicators** — Federal Reserve FRED data, construction costs, CPI
- **Legislative Tracker** — AHCIA, CRA expansion, housing policy updates
- **Regional Analysis** — Multifamily trends, CRA footprints, national allocation maps

## Live Pages

| Page | Description |
|------|-------------|
| `index.html` | Home — overview and navigation hub |
| `economic-dashboard.html` | FRED-powered economic indicators dashboard |
| `LIHTC-dashboard.html` | State LIHTC allocation maps and data |
| `state-allocation-map.html` | D3 choropleth map of federal allocations |
| `regional.html` | Regional housing market analysis |
| `colorado-deep-dive.html` | Colorado LIHTC market deep dive (Leaflet maps) |
| `colorado-market.html` | Colorado market overview and forecast |
| `construction-commodities.html` | Construction cost commodity tracking |
| `housing-needs-assessment.html` | Housing Needs Assessment starter (Colorado-focused; Census + LEHD + DOLA/SDO) |
| `cra-expansion-analysis.html` | CRA expansion analysis and forecast |
| `housing-legislation-2026.html` | 2026 housing legislation tracker |
| `insights.html` | Market insights and research articles |
| `article-pricing.html` | Housing pricing analysis article |
| `lihtc-guide-for-stakeholders.html` | LIHTC program guide |
| `lihtc-enhancement-ahcia.html` | LIHTC enhancement and AHCIA data |
| `census-dashboard.html` | U.S. Census data integration |
| `dashboard.html` | Analytics dashboard |
| `about.html` | About the project and methodology |

## Project Structure

```
Housing-Analytics/
├── index.html                   # Entry point
├── *.html                       # 17 page files
│
├── css/
│   ├── site-theme.css           # Design tokens, dark/light mode, typography
│   ├── layout.css               # Containers, grids, print styles
│   ├── pages.css                # Shared components (buttons, cards, hero, etc.)
│   ├── predictions-dashboard.css # Economic dashboard layout
│   └── colorado-deep-dive.css   # Colorado deep dive specific styles
│
├── js/
│   ├── navigation.js            # Header/footer injection + mobile menu styles
│   ├── dark-mode-toggle.js      # OS-aware dark/light mode with persistence
│   ├── mobile-menu.js           # Hamburger menu for mobile
│   ├── config.js                # API configuration (FRED, Census keys)
│   ├── api-config-wrapper.js    # API key wrapper/guard
│   ├── contrast-guard.js        # Accessibility contrast checking
│   ├── citations.js             # Data source citation tooltips
│   ├── data-service.js          # Data fetching utilities
│   ├── fred-cards.js            # Federal Reserve FRED KPI cards
│   ├── fred-commodities.js      # Commodity price charts
│   ├── housing-data-integration.js # Housing market data integration
│   ├── housing-predictions.js   # Forecasting models
│   ├── census-geo.js            # Census geographic data
│   ├── co-ami-gap.js            # Colorado AMI gap analysis
│   ├── state-allocations-2024.js # 2024 IRS allocation data
│   ├── state-allocations-2025.js # 2025 IRS allocation data
│   ├── state-allocations-2026.js # 2026 IRS allocation data
│   ├── trend-analysis.js        # Trend computation utilities
│   ├── policy-simulator.js      # Policy impact simulator
│   ├── map-overlay.js           # Map overlay utilities
│   ├── ui-interactions.js       # UI interaction handlers
│   └── vendor/                  # Vendored libraries (no CDN dependency)
│       ├── chart.umd.min.js     # Chart.js v4
│       ├── d3.v7.min.js         # D3.js v7
│       ├── topojson.v3.min.js   # TopoJSON v3
│       ├── leaflet.js           # Leaflet.js maps
│       └── leaflet.css          # Leaflet map styles
│
├── data/
│   ├── allocations.json         # LIHTC allocation data
│   ├── census-acs-state.json    # ACS state-level data
│   ├── co_ami_gap_by_county.json # Colorado AMI gap by county
│   ├── fred-data.json           # Cached FRED economic data
│   ├── prop123_jurisdictions.json # Prop 123 jurisdiction data
│   └── states-10m.json          # US states TopoJSON
│
└── .github/
    └── workflows/
        └── deploy.yml           # Auto-deploy to GitHub Pages
```

## CSS Architecture

The site uses a **3-file CSS stack** — no build step required:

```html
<link rel="stylesheet" href="css/site-theme.css">   <!-- tokens, dark mode -->
<link rel="stylesheet" href="css/layout.css">        <!-- containers, grids -->
<link rel="stylesheet" href="css/pages.css">         <!-- all shared components -->
```

Some pages add a 4th file for page-specific styles (e.g., `predictions-dashboard.css`).

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

Some dashboards use live API data. Create `js/config.local.js` (gitignored) with your API keys:

```js
// js/config.local.js — NOT committed to git
window.LIHTC_CONFIG = {
  FRED_API_KEY: 'your-fred-api-key-here',
  CENSUS_API_KEY: 'your-census-api-key-here'
};
```

Free API keys:
- **FRED**: https://fred.stlouisfed.org/docs/api/api_key.html
- **Census**: https://api.census.gov/data/key_signup.html

Without API keys, dashboards fall back to cached data in `/data/*.json`.

### Kalshi Prediction Market Data

The Housing Prediction Market Dashboard (`economic-dashboard.html`) loads live probability
data from `data/kalshi/prediction-market.json`, fetched weekly by
`.github/workflows/fetch-kalshi.yml`.

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
4. The GitHub Actions workflow (`.github/workflows/deploy.yml`) will auto-deploy on every push to `main`

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

All data is sourced from authoritative public sources:

| Source | Data |
|--------|------|
| [IRS LIHTC Database](https://www.irs.gov/credits-deductions/businesses/low-income-housing-tax-credit) | Annual allocation caps and per-capita amounts |
| [U.S. Census ACS](https://www.census.gov/programs-surveys/acs) | AMI, income, housing cost burden |
| [Federal Reserve FRED](https://fred.stlouisfed.org/) | Construction costs, CPI, interest rates |
| [HUD / HUDUSER](https://www.huduser.gov/) | Fair market rents, income limits |
| [CHFA ArcGIS FeatureServer](https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer/0) | **Primary** source for Colorado LIHTC project locations (Colorado Housing and Finance Authority) |
| [CHFA Colorado](https://www.chfainfo.com/) | Colorado-specific LIHTC QAP and allocations |
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
| `data/prop123_jurisdictions.json` | `colorado-deep-dive.html` Prop 123 commitment table (`js/prop123-map.js`) | Populate from the [CDOLA commitment-filings portal](https://cdola.colorado.gov/commitment-filings) or run `node scripts/fetch-prop123.js` if available |

Without these files the affected panels display placeholder dashes or an explanatory message rather than crashing. All other panels continue to function normally.

## Browser Support

- Chrome 90+, Firefox 90+, Safari 14+, Edge 90+
- Requires CSS Custom Properties, Grid, and `color-mix()` (for hover effects)
- `color-mix()` gracefully degrades on older browsers — hover states just use the base color

## License

MIT © Affordable Housing Intelligence

This tool is provided for educational and research purposes. All economic data is sourced from public federal and state databases. This is not investment advice.
