# Housing-Analytics

An educational platform providing data-driven insights into LIHTC (Low-Income Housing Tax Credit) allocations, affordable housing market trends, and related economic indicators.

## Repository Contents

### HTML Pages

| File | Description |
|------|-------------|
| `index.html` | Home page — LIHTC Analytics Hub overview |
| `dashboard.html` | Main analytics dashboard |
| `about.html` | About the project |
| `insights.html` | Housing market insights |
| `regional.html` | Regional housing data |
| `census-dashboard.html` | U.S. Census data dashboard |
| `economic-dashboard.html` | Economic indicators dashboard |
| `colorado-market.html` | Colorado housing market deep dive |
| `colorado-deep-dive.html` | Extended Colorado analysis |
| `construction-commodities.html` | Construction commodity prices |
| `article-pricing.html` | Pricing analysis articles |
| `LIHTC-dashboard.html` | LIHTC-specific analytics |
| `lihtc-enhancement-ahcia.html` | LIHTC enhancement and AHCIA data |
| `lihtc-guide-for-stakeholders.html` | Stakeholder reference guide |
| `housing-legislation-2026.html` | 2026 housing legislation tracker |
| `cra-expansion-analysis.html` | CRA expansion analysis |
| `state-allocation-map.html` | Federal LIHTC allocation map by state |

### Stylesheets (`css/`)

| File | Purpose |
|------|---------|
| `css/styles.css` | Base site styles |
| `css/site-theme.css` | Site-wide color theme and typography |
| `css/unified-theme.css` | Unified dark/light theme variables |
| `css/responsive-nav.css` | Responsive navigation styles |
| `css/predictions-dashboard.css` | Predictions dashboard layout |

### JavaScript (`js/`)

| File | Purpose |
|------|---------|
| `js/main.js` | Site entry point |
| `js/navigation.js` | Site navigation logic |
| `js/responsive-nav.js` | Responsive nav with resize handling |
| `js/dashboard.js` | Dashboard initialization |
| `js/data.js` / `js/data-service.js` | Data loading and transformation |
| `js/config.js` | API and feature configuration |
| `js/app.js` | Application bootstrap |
| `js/metrics.js` | Key metrics computation |
| `js/forecasting.js` | Housing trend forecasting |
| `js/trend-analysis.js` | Trend analysis utilities |
| `js/policy-simulator.js` | Policy impact simulator |
| `js/fred-kpi-cards.js` | FRED economic KPI cards |
| `js/fred-construction-commodities.js` | Construction commodity price charts |
| `js/state-allocations-*.js` | State LIHTC allocation data (2024–2026) |
| `js/vendor/` | Bundled third-party libraries (Chart.js, D3, Leaflet, TopoJSON) |

### Documentation (`docs/`)

| File | Description |
|------|-------------|
| `docs/IMPLEMENTATION-GUIDE.md` | Upgrade and implementation instructions |
| `docs/QUICK-REFERENCE.md` | Developer quick-reference card |
| `docs/EXAMPLE-USAGE.html` | Component usage examples |

### Other

| File/Folder | Description |
|-------------|-------------|
| `DEPLOYMENT_GUIDE.md` | GitHub Pages deployment instructions |
| `AUTOMATION_SETUP_GUIDE.md` | Automated monitoring setup |
| `DAILY_AUTOMATION_SETUP.md` | Daily monitoring schedule setup |
| `WEBSITE_MONITORING_SETUP.md` | Website health monitoring guide |
| `TESTING_GUIDE.md` | Testing procedures |
| `test/` | Automated test scripts |
| `.github/workflows/` | GitHub Actions CI/CD workflows |
| `data/` | Static data files |
| `includes/` | Shared HTML fragments (e.g., header) |
| `serverless/` | Serverless function configuration |
| `cloudflare-worker/` | Cloudflare Worker scripts |

## Deployment

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for step-by-step instructions to deploy this site on GitHub Pages.

## License

See [LICENSE](LICENSE) for terms of use.
