<!-- sync-banner:start -->
> **⚠️ Superseded** — See [`FEATURE_COMPLETE.md`](FEATURE_COMPLETE.md) for the current feature status matrix.  
> *Auto-synced 2026-04-20 by `scripts/sync-docs.mjs` · 38 pages · 884 data files · 37 workflows*
<!-- sync-banner:end -->

> **⚠️ Deprecated:** This document is superseded by [`FEATURE_COMPLETE.md`](FEATURE_COMPLETE.md), which contains the current feature status matrix.

# COHO Analytics — Implementation Status Matrix

**Generated:** 2026-03-10  
**Scope:** Every file in the Housing-Analytics repository  
**Purpose:** Authoritative planning artifact for the consolidation phase of the COHO Analytics platform. Documents what is fully implemented, what is partial, what is stubbed, and what should be moved, merged, or retired.

---

## Status Legend

| Symbol | Status | Definition |
|--------|--------|------------|
| ✅ | **Implemented** | Fully functional, tested, integrated |
| 🔶 | **Partial** | Core logic exists but missing connectors, stubs, or neutral fallbacks remain |
| 🟡 | **Stub** | File exists but contains placeholder/skeleton/hardcoded defaults |
| 📦 | **Legacy** | Superseded or archived; candidate for removal or `_dev/` move |
| 🔧 | **Needs Refactor** | Functional but has technical debt / maintainability concern |

---

## HTML Pages (root-level)

| File | Status | Notes |
|------|--------|-------|
| `index.html` | ✅ Implemented | Home page, navigation hub, FRED KPI cards |
| `housing-needs-assessment.html` | ✅ Implemented | Full HNA page — extensive sections (tenure, burden, projections, LEHD, Prop 123, exports) |
| `market-analysis.html` | ✅ Implemented | Report-style PMA/site-selection page with scoring, sections, calculator mount |
| `colorado-deep-dive.html` | ✅ Implemented | Leaflet maps, CHFA projects, QCT/DDA overlays, Prop 123, regional predictions |
| `economic-dashboard.html` | ✅ Implemented | FRED-powered KPI cards, economic indicators |
| `LIHTC-dashboard.html` | ✅ Implemented | D3 choropleth, allocation data, CHFA integration |
| `state-allocation-map.html` | ✅ Implemented | D3 SVG map with 2024–2026 allocation data |
| `regional.html` | ✅ Implemented | Leaflet map, per-capita chart, regional comparisons |
| `colorado-market.html` | ✅ Implemented | County demographics, AMI gap, economic indicators |
| `market-intelligence.html` | ✅ Implemented | Statewide market data dashboard |
| `chfa-portfolio.html` | ✅ Implemented | CHFA LIHTC project portfolio viewer |
| `compliance-dashboard.html` | ✅ Implemented | Prop 123 compliance tracking |
| `dashboard.html` | 📦 Legacy | Original analytics dashboard; superseded by specialized pages |
| `dashboard-data-quality.html` | ✅ Implemented | Data quality monitoring UI |
| `dashboard-data-sources-ui.html` | ✅ Implemented | 43+ data sources catalog UI |
| `data-status.html` | ✅ Implemented | Data freshness status page |
| `insights.html` | ✅ Implemented | Market insights and research articles |
| `article-pricing.html` | ✅ Implemented | Housing pricing analysis article |
| `policy-briefs.html` | ✅ Implemented | Research summaries |
| `construction-commodities.html` | 📦 Legacy | Construction cost tracking; flagged for chart fixes; candidate for `_dev/` |
| `census-dashboard.html` | 📦 Legacy | Census data integration; superseded by HNA |
| `colorado-elections.html` | ✅ Implemented | Election data page |
| `cra-expansion-analysis.html` | ✅ Implemented | CRA opportunity analysis |
| `housing-legislation-2026.html` | ✅ Implemented | 2026 legislation tracker |
| `lihtc-guide-for-stakeholders.html` | ✅ Implemented | LIHTC basics guide (noted as potentially unreferenced in nav) |
| `lihtc-enhancement-ahcia.html` | ✅ Implemented | AHCIA provisions page |
| `about.html` | ✅ Implemented | About and methodology |
| `privacy-policy.html` | ✅ Implemented | Privacy policy |
| `sitemap.html` | ✅ Implemented | HTML sitemap |
| `og-card.html` | ✅ Implemented | OpenGraph card preview |

---

## JavaScript — Core Platform (`js/`)

| File | Status | Notes |
|------|--------|-------|
| `js/housing-needs-assessment.js` | 🔧 Needs Refactor | **~4,657 lines** — monolithic page orchestrator. #1 maintainability issue. Must decompose into section modules (tenure, burden, projections, compliance, exports, etc.) |
| `js/market-analysis.js` | 🔧 Needs Refactor | **~1,293 lines** — large page orchestrator. Should delegate more to `js/market-analysis/` submodules |
| `js/data-service-portable.js` | ✅ Implemented | Centralized data resolution; local-first with API fallback |
| `js/navigation.js` | ✅ Implemented | Header/footer injection, mega-menu with 4 groups, 30+ page links |
| `js/main.js` | ✅ Implemented | Home page interactions, scroll animations, utility exports |
| `js/config.js` | ✅ Implemented | Runtime config (empty API keys; data served from cached JSON) |
| `js/dark-mode-toggle.js` | ✅ Implemented | OS-aware dark/light toggle with localStorage persistence |
| `js/mobile-menu.js` | ✅ Implemented | Hamburger menu for mobile |
| `js/contrast-guard.js` | ✅ Implemented | Accessibility contrast checking utility |
| `js/citations.js` | ✅ Implemented | Data source citation definitions (Novogradac, HUD, Census, CHFA, FRED, etc.) |
| `js/audit-hook.js` | ✅ Implemented | Optional diagnostics panel (activates with `?audit=1`) |
| `js/geo-search.js` | ✅ Implemented | Nominatim geocoding for Colorado Deep Dive map |
| `js/regional.js` | ✅ Implemented | Regional analysis Leaflet map + charts |
| `js/fred-cards.js` | ✅ Implemented | FRED KPI card rendering |
| `js/fred-commodities.js` | ✅ Implemented | Commodity price charts |
| `js/housing-data-integration.js` | ✅ Implemented | Housing market data integration layer |
| `js/housing-predictions.js` | ✅ Implemented | National forecasting models |
| `js/colorado-regional-predictions.js` | ✅ Implemented | Colorado 5-region predictions |
| `js/census-geo.js` | ✅ Implemented | Census geographic data utilities |
| `js/co-ami-gap.js` | ✅ Implemented | Colorado AMI gap analysis |
| `js/state-allocations-2024.js` | ✅ Implemented | 2024 IRS allocation data |
| `js/state-allocations-2025.js` | ✅ Implemented | 2025 IRS allocation data |
| `js/state-allocations-2026.js` | ✅ Implemented | 2026 IRS allocation data |
| `js/trend-analysis.js` | ✅ Implemented | Trend computation utilities |
| `js/policy-simulator.js` | ✅ Implemented | Policy impact simulator |
| `js/map-overlay.js` | ✅ Implemented | Map overlay utilities |
| `js/ui-interactions.js` | ✅ Implemented | UI interaction handlers |
| `js/deal-calculator.js` | ✅ Implemented | Full LIHTC feasibility calculator: 4% vs 9% credit toggle with auto-switching equity pricing, first mortgage sizing (DCR/rate/term), sources-and-uses table, QCT/DDA basis boost checkbox wired to HudEgis overlay, county-specific AMI limits via HudFmr |
| `js/app.js` | 📦 Legacy | Original dashboard entry point using ES module imports; likely superseded |
| `js/data.js` | 📦 Legacy | Simple data loader using DataService; likely superseded by data-service-portable |
| `js/fetch-helper.js` | ✅ Implemented | `safeFetchJSON` / `fetchWithTimeout` utilities |
| `js/cache-manager.js` | ✅ Implemented | Client-side caching layer |
| `js/data-freshness.js` | ✅ Implemented | Data freshness UI updater |
| `js/hna-export.js` | ✅ Implemented | HNA export functionality |
| `js/api-config-wrapper.js` | ✅ Implemented | API key wrapper/guard |

---

## JavaScript — Market Analysis Modules (`js/market-analysis/`)

| File | Status | Notes |
|------|--------|-------|
| `js/market-analysis/market-analysis-controller.js` | ✅ Implemented | Full orchestration layer. `_getDesignationFlags()` calls HudEgis.checkDesignation() with point-in-polygon against QCT/DDA GeoJSON overlays (224 QCT tracts). Returns qctFlag, ddaFlag, basisBoostEligible. Passes to deal calculator via setDesignationContext() |
| `js/market-analysis/site-selection-score.js` | ✅ Implemented | 6-component weighted scoring model (demand/subsidy/feasibility/access/policy/market). QCT/DDA basis boost awards 40-point unified bonus (IRC §42(d)(5)(B)). Uses neutral fallbacks when data absent — planning heuristic with transparent scoring |
| `js/market-analysis/market-report-renderers.js` | ✅ Implemented | Section-level HTML rendering with graceful degradation |
| `js/market-analysis/market-analysis-state.js` | ✅ Implemented | Global state container with get/set/subscribe pattern |
| `js/market-analysis/market-analysis-utils.js` | ✅ Implemented | Haversine, normalization, weighted scoring, formatting utilities |

---

## CSS (`css/`)

| File | Status | Notes |
|------|--------|-------|
| `css/site-theme.css` | ✅ Implemented | Single source of truth for design tokens, light/dark mode, typography. Fonts self-hosted in `assets/fonts/` |
| `css/layout.css` | ✅ Implemented | Containers, grids, sidebar, breadcrumbs, print styles |
| `css/pages.css` | ✅ Implemented | Comprehensive shared component library (buttons, cards, hero, etc.) |
| `css/styles.css` | 📦 Legacy | Original stylesheet; now theme-aware via CSS vars. Candidate for merge into pages.css |
| `css/accessibility.css` | ✅ Implemented | WCAG 2.1 AA: focus states, skip links, SR utilities, high contrast, reduced motion |
| `css/responsive.css` | ✅ Implemented | Mobile-first breakpoints, touch targets (44×44px), typography scaling |
| `css/responsive-nav.css` | 🗃 Archived | Superseded by `js/mobile-menu.js` — moved to `_audit/css/` |
| `css/performance.css` | ✅ Implemented | GPU hints, will-change, contain, lazy-load placeholders, critical-path notes |
| `css/footer-theme.css` | ✅ Implemented | Footer-specific dark/light variables |
| `css/data-dashboard.css` | ✅ Implemented | Data sources dashboard grid, tabs, toolbar styles |
| `css/dark-mode.css` | ✅ Implemented | Dark mode transition overrides |

---

## GitHub Actions Workflows (`.github/workflows/`)

| File | Status | Notes |
|------|--------|-------|
| `ci-checks.yml` | ✅ Implemented | Runs on `pull_request`; artifact checks, reference validation |
| `site-audit.yml` | ✅ Implemented | Site audit workflow for PR checks |
| `deploy.yml` | ✅ Implemented | Auto-deploy to GitHub Pages |
| `build-hna-data.yml` | ✅ Implemented | Builds HNA cached data artifacts (Census API) |
| `market_data_build.yml` | ✅ Implemented | Builds market analysis data artifacts |
| `market_data_build.yml` | ✅ Implemented | Extended market data generation |
| `generate-housing-data.yml` | ✅ Implemented | Housing data generation pipeline |
| `fetch-fred-data.yml` | ✅ Implemented | FRED API data fetch with monitoring |
| `fetch-census-acs.yml` | ✅ Implemented | Census ACS data fetch |
| `fetch-kalshi.yml` | ✅ Implemented | Kalshi prediction market data fetch |
| `fetch-lihtc-data.yml` | ✅ Implemented | LIHTC data fetch from HUD |
| `fetch-chfa-lihtc.yml` | ✅ Implemented | CHFA ArcGIS LIHTC project fetch |
| `fetch-county-data.yml` | ✅ Implemented | County-level data fetch |
| `cache-hud-gis-data.yml` | ✅ Implemented | HUD eGIS data caching |
| `data-quality-check.yml` | ✅ Implemented | Data quality validation workflow |
| `data-refresh.yml` | ✅ Implemented | Coordinated data refresh |
| `daily-monitoring.yml` | ✅ Implemented | Daily data monitoring |
| `contrast-audit.yml` | ✅ Implemented | WCAG contrast audit |
| `audit-endpoints.yml` | ✅ Implemented | API endpoint health checks |
| `run-all-workflows.yml` | ✅ Implemented | Meta-workflow to trigger all data workflows |
| `redeploy-zip.yml` | ✅ Implemented | Redeploy from ZIP archive |
| `workflow-comment-trigger.yml` | ✅ Implemented | PR comment-triggered workflow dispatch |
| `car-data-update.yml` | ✅ Implemented | CAR market data update |
| `zillow-data-sync.yml` | ✅ Implemented | Zillow data synchronization |

---

## Documentation (`docs/`)

| File | Status | Notes |
|------|--------|-------|
| `docs/DESIGN-SYSTEM.md` | ✅ Implemented | Complete design token reference, typography, spacing |
| `docs/accessibility.md` | ✅ Implemented | WCAG 2.1 AA checklist with per-criterion status |
| `docs/performance.md` | ✅ Implemented | Performance guide: CSS architecture, minification, critical path, fonts |
| `docs/dark-mode.md` | ✅ Implemented | Two-layer dark mode implementation guide |
| `docs/PMA_SCORING.md` | 🔧 Needs Refactor | PMA scoring methodology (5-dimension model with formulas). **Doc/code mismatch:** describes a 5-dimension model while `site-selection-score.js` implements a 6-component model — needs reconciliation |
| `docs/GIS_DATA_MODEL.md` | ✅ Implemented | GIS data architecture: folder structure, entity schemas (Jurisdiction, Site, PMA) |
| `docs/SITE_AUDIT_GIS.md` | ✅ Implemented | Complete 23-page inventory with map/JS/data/failure-mode matrix |
| `docs/repo-audit.md` | ✅ Implemented | Repository audit: unused files, legacy artifacts, cleanup recommendations |
| `docs/components.html` | ✅ Implemented | Living component library/styleguide HTML page |
| `docs/EXAMPLE-USAGE.html` | 📦 Legacy | Old-style LIHTC usage example; not referenced in navigation |

---

## Tests — `test/` (JavaScript + Python, plain Node.js harness)

| File | Status | Notes |
|------|--------|-------|
| `test/smoke.test.js` | ✅ Implemented | Smoke tests for 6 major pages, JS file existence, cross-references |
| `test/smoke-market-analysis.js` | ✅ Implemented | Market Analysis feature smoke tests (HTML elements, data artifacts, PMA module) |
| `test/acs-etl.test.js` | ✅ Implemented | ACS ETL pipeline unit tests (field mapping, coercion, freshness) |
| `test/validate-site.js` | ✅ Implemented | Site validation: JSON existence, link checks, hardcoded fetch detection, a11y |
| `test/split-lihtc-by-county.js` | ✅ Implemented | Unit tests for LIHTC county splitting script |
| `test/demographic_projections_test.py` | ✅ Implemented | Python tests for cohort component model, headship rates, housing demand projections |
| `test/economic_indicators_test.py` | ✅ Implemented | Python tests for employment growth, wage trends, industry concentration, job accessibility |
| `test/build_counties_co_test.py` | ✅ Implemented | Python tests for county boundary builder resilience |
| `test/lighthouse-audit.js` | ✅ Implemented | Zero-dependency HTML structure and accessibility checker — scans all pages for lang, h1, alt text, viewport, title |
| `test/website-monitor.js` | ✅ Implemented | Zero-dependency local link checker — validates all asset references across all HTML pages |

> **Note:** `test/` and `tests/` are split directories. `test/` uses plain Node.js/Python harnesses; `tests/` uses pytest. These should be consolidated into a single `tests/` directory.

---

## Tests — `tests/` (Python pytest suite)

| File | Status | Notes |
|------|--------|-------|
| `tests/conftest.py` | ✅ Implemented | Pytest config with WCAG compliance score summary |
| `tests/test_stage2_temporal.py` | ✅ Implemented | 55+ temporal engine checks (FRED metadata, CAR reports, projections, LIHTC trends) |
| `tests/test_stage3_accessibility.py` | ✅ Implemented | 46 WCAG 2.1 AA checks (tokens, focus, lang, skip-nav, landmarks, ARIA, canvas, colors) |
| `tests/test_stage3_visualization.py` | ✅ Implemented | 37 visualization accessibility checks (chart colors, ARIA, live regions, landmarks) |
| `tests/test_governance_stress.py` | ✅ Implemented | 12 adversarial governance probes (pre-commit detection, color compliance, canvas ARIA) |

---

## Schemas (`schemas/`)

| File | Status | Notes |
|------|--------|-------|
| `schemas/manifest.schema.json` | ✅ Implemented | JSON Schema for data/manifest.json |
| `schemas/fred-data.schema.json` | ✅ Implemented | JSON Schema for FRED data with sentinel key rules |
| `schemas/chfa-lihtc.schema.json` | ✅ Implemented | JSON Schema for CHFA LIHTC GeoJSON |
| `schemas/co_ami_gap_by_county.schema.json` | ✅ Implemented | JSON Schema for AMI gap data (requires 64 counties) |

---

## Tools (`tools/`)

| File | Status | Notes |
|------|--------|-------|
| `tools/check-links.mjs` | ✅ Implemented | Dead-link checker for GitHub Pages |
| `tools/streamline-preflight.js` | ✅ Implemented | SEO/compliance preflight verification |
| `tools/copilot_apply_hardening.js` | 🗑 Deleted | Removed — was empty comment-only stub with no implementation |

---

## Root-level Files

| File | Status | Notes |
|------|--------|-------|
| `README.md` | 🔧 Needs Refactor | Substantially behind the codebase: describes ~17 pages (actual: 30+), ~6 CSS files (actual: 10+), only 1 workflow (actual: 24), outdated project structure tree |
| `package.json` | ✅ Implemented | Node.js project config with test scripts |
| `DATA-MANIFEST.json` | ✅ Implemented | Auto-generated data file index |
| `DATA-SOURCES.md` | ✅ Implemented | Comprehensive data source documentation |
| `DEPLOYMENT-GUIDE.txt` | ✅ Implemented | Deployment guide |
| `HOUSING-NEEDS-ASSESSMENT-USER-GUIDE.md` | ✅ Implemented | HNA user guide |
| `SETUP-DATA-SOURCES.md` | ✅ Implemented | Data source setup instructions |
| `TEST-CHECKLIST.md` | ✅ Implemented | Manual test checklist |
| `CHANGELOG.md` | ✅ Implemented | Change log |
| `COPILOT_PR_CHECK_PROMPT.md` | ✅ Implemented | Copilot PR review prompt |
| `CHANGED_FILES.txt` | 📦 Legacy | Process artifact; safe to remove if no longer used |
| `.env.example` | ✅ Implemented | Environment variable template |
| `validate.js` | ✅ Implemented | Root-level validation script |
| `sitemap.xml` | ✅ Implemented | XML sitemap |
| `robots.txt` | ✅ Implemented | Robots.txt |
| `LICENSE` | ✅ Implemented | MIT License |

---

## Summary Statistics

| Status | Count |
|--------|-------|
| ✅ Implemented | 120 |
| 🔶 Partial | 0 |
| 🟡 Stub | 0 |
| 📦 Legacy | 10 |
| 🔧 Needs Refactor | 4 |
| **Total** | **137** |

---

## Critical Gaps & Next Actions

The following items represent the highest-priority gaps identified during this audit. They are ordered by impact and urgency.

### 1. `js/housing-needs-assessment.js` Decomposition *(#1 Priority)*
At **~4,657 lines**, this is the single largest maintainability liability in the platform. The file acts as monolithic page orchestrator covering tenure, burden, projections, LEHD employment, Prop 123 compliance, exports, and chart rendering. It must be decomposed into focused section modules (e.g., `hna-tenure.js`, `hna-burden.js`, `hna-projections.js`, `hna-compliance.js`) that can be individually tested and updated.

### 2. ~~QCT/DDA Wiring in `market-analysis-controller.js`~~ ✅ RESOLVED
`_getDesignationFlags()` now calls `HudEgis.checkDesignation(lat, lon)` with ray-casting point-in-polygon against 224 QCT and 2,902 DDA polygon features loaded from `data/qct-colorado.json` and `data/dda-colorado.json`. Returns `{qctFlag, ddaFlag, basisBoostEligible}` and propagates to deal calculator via `setDesignationContext()`. Fallback returns all-false when HudEgis is unavailable. Unit tested (60 tests pass).

### 3. ~~Deal Calculator Upgrade~~ ✅ RESOLVED
`js/deal-calculator.js` now supports: 4% vs 9% credit rate toggle with auto-switching equity pricing (0.90/0.85), first-mortgage debt sizing (DCR/rate/term inputs), sources-and-uses table (equity/mortgage/deferred fee/gap/TDC), QCT/DDA basis boost checkbox wired to HudEgis overlay, county-specific AMI limits via HudFmr. Financial constants centralized in `js/config/financial-constants.js` (COHO_DEFAULTS).

### 4. ~~PMA Scoring Doc vs. Implementation Mismatch~~ ✅ RESOLVED
`docs/PMA_SCORING.md` updated to document the actual 5-dimension weighted model (Demand 30%, Capture Risk 25%, Rent Pressure 15%, Land/Supply 15%, Workforce 15%) with the 5-source workforce composite (LODES 25%, ACS 25%, CDLE 20%, CDE 15%, CDOT 15%). `site-selection-score.js` implements a separate 6-component site selection model — both are now accurately documented.

### 5. ~~README Modernization~~ ✅ RESOLVED
`README.md` updated to reflect: 38 pages, 16 CSS files, 136 JS modules, 37 GitHub Actions workflows, 21 data sources, and accurate project structure tree including `data/hna/`, `data/market/`, `data/policy/`, `scripts/`, `test/`, and CI workflow directories.

### 6. Test Directory Consolidation
The repository has two parallel test directories: `test/` (plain Node.js/Python harnesses, no framework) and `tests/` (pytest suite). This split creates confusion about where new tests should live and makes it difficult to run the full test suite with a single command. Both directories should be consolidated under `tests/`, with Node.js test scripts invoked from `tests/js/`.

### 7. CI Unification
No single PR gate currently runs the full JS + Python + browser test stack together. `ci-checks.yml` covers artifact and reference checks; the pytest suite runs separately; Lighthouse and link-crawler stubs have no CI integration at all. A unified `ci.yml` gate should run: (1) `node test/smoke.test.js`, (2) `pytest tests/`, (3) `node tools/check-links.mjs`, (4) `node tools/streamline-preflight.js`.

### 8. Google Fonts External Dependency ✅ Resolved
Fonts are now self-hosted in `assets/fonts/plus-jakarta-sans/` and `assets/fonts/dm-mono/` via `@font-face` declarations in `css/site-theme.css`. The Google Fonts CDN import has been removed.

### 9. Legacy File Cleanup
The following files are candidates for archival to `_dev/` or outright deletion:

| File | Reason |
|------|--------|
| `dashboard.html` | Superseded by specialized pages |
| `census-dashboard.html` | Superseded by HNA page |
| `construction-commodities.html` | Flagged for chart fixes; inactive |
| `CHANGED_FILES.txt` | Process artifact with no runtime role |
| `css/styles.css` | Merge remaining unique rules into `pages.css` then remove |
| `js/app.js` | ES module entry point for retired dashboard |
| `js/data.js` | Superseded by `data-service-portable.js` |
| `docs/EXAMPLE-USAGE.html` | Unreferenced old-style usage example |

### 10. ~~Stub Completion~~ ✅ RESOLVED
- **`tools/copilot_apply_hardening.js`** — Deleted (was empty comment-only stub).
- **`test/lighthouse-audit.js`** — Rewritten as zero-dependency HTML structure and accessibility checker. Scans all 49 HTML pages for lang attributes, heading structure, alt text, inline handlers, viewport meta, and title elements.
- **`test/website-monitor.js`** — Rewritten as zero-dependency local link checker. Validates 839 asset references (CSS, JS, data, images) across all HTML pages.

---

## Directories Not Fully Auditable

The following directories contain additional files that were only partially enumerable via the API. They are not covered by the tables above. Refer to the [live repository tree](https://github.com/pggLLC/Housing-Analytics) for the complete file inventory.

| Directory | Contents |
|-----------|----------|
| `scripts/` | Python ETL scripts for HNA, demographic projections, economic indicators, LIHTC, and data build pipelines |
| `data/` | Cached JSON data artifacts (FRED series, ACS tables, LIHTC/CHFA data, AMI gap, HNA outputs, market data) |
| `serverless/` | Serverless function handlers (likely Netlify or Vercel) |
| `cloudflare-worker/` | Cloudflare Worker source (`cloudflare-worker.js`) with CORS headers and `ctx.waitUntil` cache pattern |
| `assets/` | Images, icons, fonts, and static media |
| `maps/` | GeoJSON boundary files and map tile references |

## Actionable Recommendations

- Docs and site-audit pipeline are automatically updated after every merge.

## 