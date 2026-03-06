# Deployment Smoke-Test Checklist

A lightweight manual verification guide to run after every deployment. Each check includes expected behavior, quick troubleshooting steps, and common failure modes.

---

## Pre-Flight

- [ ] Clear browser cache and local storage before starting (`DevTools → Application → Clear storage`)
- [ ] Test in both desktop (≥1024px) and mobile (≤768px) viewports
- [ ] Open the browser DevTools Console before loading each page — note any errors

---

## 1. Core Pages Load Without Console Errors

### ✓ index.html (Home / Landing)

**Expected:** Page loads fully; hero section and navigation visible; no red console errors.

**Quick check:**
1. Navigate to `/index.html`
2. Open DevTools Console
3. Confirm zero errors (yellow warnings acceptable)

**Common failure modes:**
- Missing `js/main.js` or `js/navigation.js` → check file exists and path in `<script>` tag
- CORS errors from external fonts/icons → check network tab for blocked requests

---

### ✓ dashboard.html (LIHTC Dashboard)

**Expected:** Page loads; main chart area renders; sidebar data loads within 5 seconds.

**Quick check:**
1. Navigate to `/dashboard.html`
2. Confirm LIHTC allocation chart renders (not blank)
3. Confirm sidebar shows state totals

**Common failure modes:**
- `data/chfa-lihtc.json` missing or malformed → chart shows empty state
- `js/citations.js` path error → check console for 404

---

### ✓ market-analysis.html (Market Analysis)

**Expected:** Page loads; county selector populates; choropleth map renders with color fills.

**Quick check:**
1. Navigate to `/market-analysis.html`
2. Confirm county dropdown is populated
3. Select any county and confirm data panel updates

**Common failure modes:**
- `data/boundaries/counties_co.geojson` missing → map renders but no county boundaries
- `js/market-analysis.js` 404 → entire dashboard blank

---

### ✓ market-intelligence.html (Market Intelligence)

**Expected:** Page loads; trend charts populate; FRED data indicators show.

**Quick check:**
1. Navigate to `/market-intelligence.html`
2. Confirm at least one chart renders
3. Check for cache-age warning badge (acceptable if stale)

**Common failure modes:**
- `js/market-intelligence.js` missing → blank page
- FRED proxy unavailable → fallback to `data/fred-data.json`; warning badge should appear

---

### ✓ economic-dashboard.html (Economic Dashboard)

**Expected:** Page loads; employment trend chart and wage analysis sections render.

**Quick check:**
1. Navigate to `/economic-dashboard.html`
2. Confirm employment trend chart renders
3. Confirm wage band data visible

**Common failure modes:**
- `data/co-county-economic-indicators.json` missing → wage charts blank
- `js/fred-cards.js` error → FRED card section missing

---

### ✓ housing-needs-assessment.html (HNA)

**Expected:** Page loads; HNA economic indicators section renders; export buttons (PDF/CSV/JSON) are clickable.

**Quick check:**
1. Navigate to `/housing-needs-assessment.html`
2. Confirm "Economic Indicators" section has visible charts
3. Click "Export PDF" button — confirm download initiates or modal appears

**Common failure modes:**
- `data/hna/` directory missing required JSON files → indicators show "No data available"
- `js/hna-export.js` missing → export buttons throw console error

---

## 2. Maps Render with County Boundaries

**Expected:** On any map-enabled page (market-analysis, LIHTC-dashboard, census-dashboard), county boundary polygons render as visible outlines.

**Quick check:**
1. Open `market-analysis.html`
2. Wait for map to fully load
3. Confirm 64 county boundaries visible (outlines or fills)

**Troubleshooting:**
- If boundaries missing: check `data/boundaries/counties_co.geojson` exists and is valid JSON
- Run: `python3 -c "import json; json.load(open('data/boundaries/counties_co.geojson'))"` — should exit without error

**Common failure modes:**
- GeoJSON parse error → check for trailing commas or encoding issues
- DataService path resolution → ensure `DataService.baseMaps('boundaries/counties_co.geojson')` resolves correctly

---

## 3. Predictions Section Displays with Fallback Notice

**Expected:** On pages with a predictions/forecast section (market-intelligence, economic-dashboard), either live forecast data renders OR a visible fallback notice appears (not a silent blank section).

**Quick check:**
1. Open `market-intelligence.html`
2. Locate the "Price Forecast" or "Predictions" section
3. Confirm either chart OR fallback text is visible

**Troubleshooting:**
- Disconnect network, reload — fallback notice should appear within 5 seconds
- Check `js/housing-predictions.js` is loaded via `<script defer>` tag

**Common failure modes:**
- Silent failure (no fallback text) → `housing-predictions.js` error handler not triggered
- Infinite loading spinner → prediction API timeout not handled

---

## 4. HNA Economic Indicators Appear

**Expected:** On `housing-needs-assessment.html`, the Employment Trends, Wage Analysis, and Industry Breakdown sections render with data.

**Quick check:**
1. Navigate to `housing-needs-assessment.html`
2. Scroll to "Economic Indicators" section
3. Confirm all 3 subsections have visible chart elements (not skeleton/loading state)

**Troubleshooting:**
- Check `data/hna/` directory for required files
- Run: `node test/smoke.test.js` — verify HNA module loads cleanly

**Common failure modes:**
- Missing LEHD WAC snapshot → wage band charts blank; check `data/hna/` for WAC JSON files
- `window.__HNA_renderEmploymentTrend` not defined → `housing-needs-assessment.js` failed to initialize

---

## 5. Internal Links Work

**Expected:** All navigation links, sidebar links, and in-page anchor links resolve to correct pages without 404 errors.

**Quick check:**
1. From `index.html`, click each main navigation item
2. Confirm each target page loads without error
3. Use browser back button — confirm return to previous page works

**Troubleshooting:**
- Run: `grep -r 'href="' *.html | grep -v '#' | grep -v 'http'` to list all internal links
- Verify each linked `.html` file exists in repo root

**Common failure modes:**
- Renamed or deleted page without updating nav links → 404 on navigation
- Relative path errors (e.g., `../about.html`) in pages in subdirectories

---

## 6. Mobile Navigation Toggles Correctly

**Expected:** On viewports ≤768px, hamburger menu icon appears; clicking it opens/closes the mobile nav drawer smoothly.

**Quick check:**
1. Open browser DevTools → Toggle device toolbar → Select "iPhone 12" or similar
2. Navigate to `index.html`
3. Tap hamburger icon — nav drawer should open
4. Tap again or tap outside — nav drawer should close
5. Tap a nav link — navigate to correct page; drawer closes

**Troubleshooting:**
- Inspect `js/mobile-menu.js` is loaded and `DOMContentLoaded` handler fires
- Check `.nav-toggle` button exists in HTML and has correct `aria-expanded` attribute

**Common failure modes:**
- `js/mobile-menu.js` missing or 404 → hamburger visible but unresponsive
- CSS media query breakpoint mismatch → desktop nav visible alongside hamburger
- Missing `aria-expanded` toggle → accessibility issue (non-blocking for smoke test)

---

## Post-Deployment Sign-Off

| Check | Pass | Notes |
|-------|------|-------|
| 6 core pages load without errors | ☐ | |
| Maps render with county boundaries | ☐ | |
| Predictions section displays (live or fallback) | ☐ | |
| HNA economic indicators appear | ☐ | |
| Internal links work | ☐ | |
| Mobile navigation toggles correctly | ☐ | |

**Tester:** _______________  **Date:** _______________  **Environment:** _______________
