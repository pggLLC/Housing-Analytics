# CHANGELOG

## Docs & Inventory Sync
**Date:** March 2026 (2026-03-15)

### Summary
Addressed 12 documentation issues identified in a comprehensive repo audit:
- Fixed incorrect `config.js` claims in `DATA-SOURCES.md` and `README.md`
- Updated README Live Pages table to reflect all 25 current HTML pages
- Added deprecation notices to superseded data-source docs
- Fixed `QUICK-REFERENCE.md` API key instructions (security)
- Updated `GIS_DATA_MODEL.md` §1 folder tree to match actual `data/` layout
- Updated `DATA-SOURCES.md` — `chfa-lihtc.json` now shows 716 features (✅ Fixed)
- Archived `docs/repo-audit.md` with historical notice
- Added changelog entries for HNA tool, Market Analysis, Market Intelligence, GIS fixes, Compliance Dashboard, and CHFA Portfolio
- Updated `PMA_SCORING.md` AMI figure with vintage guidance
- Moved `DATA-SOURCES.md` and `SETUP-DATA-SOURCES.md` to `docs/` directory
- Created `scripts/sync-docs.mjs` automated inventory generator and `docs:sync` npm script
- Added `docs/GENERATED-INVENTORY.md` with auto-generated inventory
- Added `.github/workflows/docs-sync.yml` scheduled workflow
- Added deprecation notices to `docs/SITE-DESIGN-AUDIT.md` and `docs/implementation-status.md`

---

## CHFA Portfolio + Compliance Dashboard + GIS Fixes
**Date:** March 2026 (2026-03-06)

### Summary
Completed three major feature deliveries and fixed GIS data reliability issues:

- **CHFA Portfolio page** (`chfa-portfolio.html`) — Multifamily portfolio browser powered by `co-lihtc-map.js` in portfolio mode, with CHFA ArcGIS fallback. Displays 716 Colorado LIHTC properties.
- **Compliance Dashboard** (`compliance-dashboard.html`) — Prop 123 / HB 22-1093 compliance tracking; fully offline-capable using `data/prop123_jurisdictions.json` and `data/policy/prop123_jurisdictions.json`.
- **GIS Data Fixes** — Resolved 0-feature CHFA LIHTC fetch bug; `data/chfa-lihtc.json` now reliably populated with 716 features. Fixed CHFA ArcGIS FeatureServer query to use correct service URL and `outSR=4326`.
- **`docs/SITE_AUDIT_GIS.md`** — Comprehensive GIS reliability audit with per-page failure modes, fallback chain documentation, and fix verification status.

---

## HNA Tool Launch + Market Analysis + Market Intelligence
**Date:** March 2026 (2026-03-01 through 2026-03-05)

### Summary
Completed three flagship tool releases:

- **Housing Needs Assessment** (`housing-needs-assessment.html` + `js/housing-needs-assessment.js`) — Full HNA tool integrating Census ACS, LEHD LODES, DOLA/SDO projections, PMA scoring, Prop 123 historical tracker, and PDF/CSV/JSON export. 9 analysis modules: commuting, barriers, employment centers, schools, transit, competitive set, opportunities, infrastructure, and justification narrative. Orchestrated by `pma-analysis-runner.js` (9-step event-emitter pipeline).
- **Market Analysis** (`market-analysis.html` + `js/market-analysis.js`) — Report-style PMA/site-selection tool with 5-dimension scoring (demand, capture risk, rent pressure, land/supply, workforce), radar chart, and CHFA-style capture-rate simulator. New modules: `js/market-data-quality.js` and `js/market-analysis-enhancements.js`. Benchmark data in `data/market/reference-projects.json` (50 CO projects).
- **Market Intelligence** (`market-intelligence.html` + `js/market-intelligence.js`) — Market overview page combining ACS state-level and FRED economic indicators.

### Data Pipelines Added
- `build-hna-data.yml` — weekly rebuild of HNA data cache (Census, LEHD, DOLA/SDO, municipal)
- `fetch-chas-data.yml` — CHAS affordability gap data
- `fetch_fmr_api.py` + `data/hud-fmr-income-limits.json` — HUD FMR/Income Limits (FY2025, 64 counties)
- `data/hna/municipal/municipal-config.json` — 32 municipalities with 7-digit place FIPS

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
