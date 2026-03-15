# CHANGELOG

## Documentation Refresh — All Markdown Files Current
**Date:** March 2026

### Summary
Updated all stale markdown files to reflect the current state of the repository as of March 2026. Fixed incorrect `js/config.js` claims across `README.md`, `DATA-SOURCES.md`, and `SETUP-DATA-SOURCES.md` (config.js IS committed with empty placeholders; local overrides use `js/config.local.js`). Updated Live Pages table in `README.md` to 29 pages. Fixed `chfa-lihtc.json` status to 716 features ✅. Replaced idealized folder tree in `docs/GIS_DATA_MODEL.md` §1 with actual flat layout. Removed stale hardcoded AMI figure from `docs/PMA_SCORING.md`. Fixed API key security issue in `docs/QUICK-REFERENCE.md`. Added archive/deprecation notices to `docs/repo-audit.md` and `docs/implementation-status.md`. Added cross-reference notes to `docs/data-sources-audit.md` and `docs/data-architecture.md`. Created `scripts/sync-docs.mjs` and `.github/workflows/docs-sync.yml` for automated inventory.

### Changed Files

- `README.md` — Fixed config.js claims; updated Live Pages table (17 → 29 pages)
- `DATA-SOURCES.md` — Fixed config.js claims; updated `chfa-lihtc.json` to 716 features ✅; added cross-reference to `SITE_AUDIT_GIS.md`
- `SETUP-DATA-SOURCES.md` — Fixed config.js model in FRED section
- `docs/GIS_DATA_MODEL.md` — Replaced §1 folder tree with actual flat `data/` layout
- `docs/PMA_SCORING.md` — Removed stale "$95K/2022" AMI figure; linked to HUD Income Limits
- `docs/QUICK-REFERENCE.md` — Security fix: removed hardcoded API key instruction; replaced with `config.local.js` pattern
- `docs/DATA_SOURCES_TABLE.md` — Refreshed table; added cross-reference to `SITE_AUDIT_GIS.md`
- `docs/repo-audit.md` — Added archive notice (generated 2026-02-26; findings addressed)
- `docs/implementation-status.md` — Added deprecation notice (superseded by `FEATURE_COMPLETE.md`)
- `docs/data-sources-audit.md` — Added cross-reference to `SITE_AUDIT_GIS.md`
- `docs/data-architecture.md` — Added cross-reference to `GIS_DATA_MODEL.md` and `SITE_AUDIT_GIS.md`
- `scripts/sync-docs.mjs` — New: automated inventory generator
- `.github/workflows/docs-sync.yml` — New: weekly docs sync workflow (Monday 06:00 UTC)
- `CHANGELOG.md` — Added this entry

---

## Site Design Audit Added
**Date:** March 2026

### Summary
Added `docs/SITE-DESIGN-AUDIT.md` — a comprehensive UX/design audit with 28 actionable recommendations across 9 sections: navigation architecture, visual hierarchy, charts and visualization, mobile and responsive design, accessibility, performance, and content architecture. Includes a priority matrix (top 10 by effort/impact) and a "Do Not Change" list of design strengths.

### Changed Files

- `docs/SITE-DESIGN-AUDIT.md` — Created

---

## GIS Data Fixes — chfa-lihtc.json 716 Features, County Boundaries
**Date:** March 2026

### Summary
Fixed `data/chfa-lihtc.json` — CI workflow now returns 716 CHFA LIHTC features (previously returning 0 due to ArcGIS query parameter error). Fixed Colorado county boundary data. Updated `docs/SITE_AUDIT_GIS.md` to reflect current data status. All GIS layers now load correctly.

### Changed Files

- `data/chfa-lihtc.json` — Now populated with 716 features
- `scripts/fetch-chfa-lihtc.js` — Fixed ArcGIS query to include `outSR=4326`
- `docs/SITE_AUDIT_GIS.md` — Updated status for CHFA LIHTC and county boundaries

---

## CHFA Portfolio Page
**Date:** March 2026

### Summary
Added `chfa-portfolio.html` — a dedicated page showing the Colorado LIHTC project portfolio sourced from CHFA ArcGIS FeatureServer. Displays an interactive Leaflet map and tabular list of LIHTC properties with filtering by county, year placed in service, and project type.

### Changed Files

- `chfa-portfolio.html` — Created

---

## Prop 123 Compliance Dashboard
**Date:** March 2026

### Summary
Added `compliance-dashboard.html` — a Prop 123 / HB 22-1093 compliance dashboard showing which Colorado jurisdictions have filed land-use commitments and their status. Includes a choropleth county map, commitment timeline, and jurisdiction search.

### Changed Files

- `compliance-dashboard.html` — Created
- `data/policy/prop123_jurisdictions.json` — Updated with 2025-2026 filings

---

## Market Intelligence Feature Complete
**Date:** March 2026

### Summary
Completed `market-intelligence.html` — a Market Intelligence dashboard integrating CAR monthly market reports, FRED economic series, rental market metrics, and construction cost trends. Provides county-level filtering and time-series chart comparisons.

### Changed Files

- `market-intelligence.html` — Feature complete
- `docs/MARKET_INTELLIGENCE_METHOD.md` — Created methodology documentation
- `data/car-market-report-2026-02.json` — Added
- `data/car-market-report-2026-03.json` — Added

---

## Market Analysis (PMA) Feature Complete
**Date:** March 2026

### Summary
Completed `market-analysis.html` — the Primary Market Analysis (PMA) tool with full 9-module analysis pipeline: commuting shed, barriers, employment centers, schools, transit, competitive set, opportunities, infrastructure, and justification narrative generator. Added data quality scoring, confidence intervals, and benchmark comparisons.

### Changed Files

- `market-analysis.html` — Feature complete
- `js/pma-analysis-runner.js` — 9-step event-emitter pipeline
- `js/pma-ui-controller.js` — Progress bar, results panel
- `js/market-data-quality.js` — PMADataQuality API
- `js/market-analysis-enhancements.js` — PMAEnhancements API
- `data/market/reference-projects.json` — 50 CO benchmark projects
- `docs/MARKET_ANALYSIS_METHOD.md` — Created methodology documentation

---

## Housing Needs Assessment (HNA) Tool Launch
**Date:** February 2026

### Summary
Launched the Housing Needs Assessment tool at `housing-needs-assessment.html`. Provides county and municipality-level housing needs analysis using Census ACS, LEHD/LODES, DOLA SDO single-year-of-age data, and HUD AMI data. Includes demographic pyramids, 20-year projections, AMI gap charts, LIHTC supply maps, and PDF/CSV/JSON export.

### Changed Files

- `housing-needs-assessment.html` — Launched
- `js/housing-needs-assessment.js` — Full implementation
- `js/hna-export.js` — PDF/CSV/JSON export utilities
- `js/municipal-analysis.js` — Municipal scaling module
- `scripts/hna/build_hna_data.py` — ETL pipeline
- `data/hna/` — All HNA cache files
- `HOUSING-NEEDS-ASSESSMENT-USER-GUIDE.md` — Created user guide

---

## Rebrand: COHO Analytics
**Date:** March 2026

### Summary
Rebranded the site from "Affordable Housing Intelligence" to "COHO Analytics" across all pages, navigation, metadata, CSS headers, JS files, docs, and support files. Updated `package.json` name to `coho-analytics` and homepage to the live GitHub Pages URL. Restructured navigation groups to emphasize the core 5-page flagship workflow. Added CSS utility classes for shared layout patterns.

### Changed Files

- `package.json` — Updated `name` to `coho-analytics`, `description`, and `homepage`
- `README.md` — Updated heading, overview, and license line to "COHO Analytics"
- `LICENSE` — Updated copyright from "LIHTC Analytics Hub" to "COHO Analytics"
- `css/print.css` — Updated header comment and `body::after` print footer brand text
- `css/layout.css`, `css/styles.css`, `css/performance.css`, `css/responsive.css`, `css/dark-mode.css`, `css/pages.css` — Updated header comments
- `css/pages.css` — Added utility classes: `.section-alt`, `.section-padded`, `.narrow-container`, `.text-center`, `.mb-4`, `.mb-3`
- `validate.js`, `scripts/validate.js` — Updated comment headers
- `js/main.js`, `js/mobile-menu.js` — Updated comment headers
- `js/navigation.js` — Restructured nav groups to Platform / Data & Research / Policy & Insights / About; updated footer flagship links
- `dashboard-data-quality.html`, `chfa-portfolio.html`, `market-analysis.html`, `market-intelligence.html`, `compliance-dashboard.html`, `dashboard-data-sources-ui.html` — Updated `<title>` and meta description
- `docs/dark-mode.md`, `docs/performance.md`, `docs/accessibility.md`, `docs/mobile-optimization.md`, `docs/QUICK-REFERENCE.md` — Updated heading brand references
- `docs/SITE_AUDIT_GIS.md` — Updated brand reference in index table row
- `index.html`, `housing-needs-assessment.html`, `market-analysis.html`, `colorado-deep-dive.html`, `economic-dashboard.html`, `LIHTC-dashboard.html` — Phase 4 polish: improved intro copy, meta descriptions, data credit lines
- `CHANGELOG.md` — Created this entry

---

## Rebrand: Affordable Housing Intelligence
**Date:** February 2026

### Summary
Rebranded the site from "LIHTC Analytics Hub" to "Affordable Housing Intelligence" across all pages, navigation, metadata, and JS files. Updated the home page hero section with new H1 and expanded intro text. Updated all page `<title>` tags and available OG meta tags to reflect the new brand.

LIHTC remains a section/module within the platform — only the top-level site brand and navigation label changed.

### Changed Files

- `js/navigation.js` — Updated site brand label and copyright text in shared header/footer
- `index.html` — Updated `<title>`, `og:title`, hero H1, three new intro paragraphs, audience section heading
- `about.html` — Updated `<title>`, meta description, H1, and intro text
- `economic-dashboard.html` — Updated `<title>`
- `article-pricing.html` — Updated `<title>`
- `regional.html` — Updated `<title>`
- `construction-commodities.html` — Updated `<title>`
- `housing-legislation-2026.html` — Updated `<title>`
- `LIHTC-dashboard.html` — Updated `<title>`
- `lihtc-enhancement-ahcia.html` — Updated `<title>`
- `dashboard.html` — Updated `<title>`
- `lihtc-guide-for-stakeholders.html` — Updated `<title>`
- `state-allocation-map.html` — Updated `<title>`
- `colorado-market.html` — Updated `<title>`
- `census-dashboard.html` — Updated `<title>`
- `colorado-deep-dive.html` — Updated `<title>`
- `insights.html` — Updated `<title>`
- `cra-expansion-analysis.html` — Updated `<title>`
- `js/main.js` — Updated comment header
- `js/mobile-menu.js` — Updated comment header
- `js/dark-mode-toggle.js` — Updated comment header
- `validate.js` — Updated comment header
- `scripts/validate.js` — Updated comment header
- `docs/EXAMPLE-USAGE.html` — Updated brand reference in example text
- `CHANGELOG.md` — Created (this file)
- `CHANGED_FILES.txt` — Created
