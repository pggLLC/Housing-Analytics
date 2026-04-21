<!-- sync-banner:start -->
> **⚠️ Superseded** — See [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md) for the current platform audit.  
> *Auto-synced 2026-04-21 by `scripts/sync-docs.mjs` · 38 pages · 884 data files · 37 workflows*
<!-- sync-banner:end -->

# COHO Analytics — Site Design & Functionality Audit

**Prepared:** March 2026 — *Updated March 16, 2026 to reflect fixes*  
**Scope:** Full audit of the COHO Analytics platform (https://pggllc.github.io/Housing-Analytics)  
**Perspective:** GUI designer + computer scientist  
**Audience:** Developers, product owners, and stakeholders

---

## Executive Summary

COHO Analytics is a mature, data-rich platform built for affordable housing professionals. It integrates multiple authoritative federal and state data sources, renders interactive maps and charts, and provides sophisticated demographic projection and market analysis tools. The codebase is well-structured with a coherent design token system, dark-mode support, and WCAG 2.1 AA accessibility features.

The audit identified **five categories of improvement**: navigation architecture, visual hierarchy and information density, mobile responsiveness, interactive component feedback, and documentation discoverability. Each category includes ranked, actionable recommendations.

**Update (March 2026):** Several items from the original audit have been resolved. Resolved items are marked ✅ **Fixed** inline. Open items retain their original recommendation text.

---

## 1. Navigation Architecture

### Current State
The site has 31 HTML pages served through a shared navigation bar defined in `js/navigation.js`. The navigation includes a horizontal top menu with dropdown groups. A skip-link (`href="#main-content"`) is present on all pages. The mobile menu (`js/mobile-menu.js`) provides a hamburger toggle.

### Issues Found

**1.1 — Flat navigation does not reflect user journeys**  
The current nav groups (Tools, Data, Policy, About) do not map to the three distinct user journeys present on the site:
- *Developers/Syndicators* → Housing Needs Assessment → Market Analysis → LIHTC Dashboard → Deal Calculator
- *Policy/Government* → Compliance Dashboard → CRA Expansion → Housing Legislation → Regional
- *Researchers/Analysts* → Economic Dashboard → FRED data → Colorado Deep Dive → Census Dashboard

**Recommendation:** Add a "Start Here" onboarding flow on the homepage that asks "What are you trying to do?" and routes each persona to their primary tools. Consider renaming top-level nav items to reflect outcomes rather than data types (e.g., "Analyze a Site" instead of "Market Tools").

**1.2 — Orphaned pages** ✅ **Partially Fixed**  
~~Four pages (`census-dashboard.html`, `construction-commodities.html`, `lihtc-guide-for-stakeholders.html`, `docs/EXAMPLE-USAGE.html`) are not linked from `navigation.js` and are not discoverable from normal browsing.~~

`construction-commodities.html` and `lihtc-guide-for-stakeholders.html` are now linked from `js/navigation.js`. **Still outstanding:** `census-dashboard.html` remains unlinked; it should either be added to a "Resources" or "Legacy" nav group or clearly marked as archived.

**Recommendation:** Add `census-dashboard.html` to the navigation or create a `/legacy` landing page that lists deprecated pages for reference.

**1.3 — Breadcrumbs absent on deep pages** ✅ **Partially Fixed**  
~~Analysis pages (e.g., Market Analysis, HNA, Compliance Dashboard) do not show breadcrumbs or contextual location cues.~~

Breadcrumbs are now present on `about.html`, `article-pricing.html`, `colorado-deep-dive.html`, `colorado-market.html`, and several other pages. **Still outstanding:** `market-analysis.html`, `housing-needs-assessment.html`, `compliance-dashboard.html`, and `regional.html` still lack breadcrumbs.

**Recommendation:** Add a two-level breadcrumb (`Home > Tool Name`) to the four remaining analysis pages.

**1.4 — No persistent state between pages**  
If a user selects "Denver County" on the Housing Needs Assessment page and then navigates to the Market Intelligence page, their geography selection is lost.

**Recommendation:** Store the last-selected geography in `localStorage` and pre-populate controls on related pages when the same geography is available.

---

## 2. Visual Hierarchy & Information Density

### Current State
The design system (`css/site-theme.css`) uses a clean, professional financial-reporting aesthetic with the `Plus Jakarta Sans` typeface, a blue-grey color palette, and a teal accent (`--accent: #096e65`). Cards use a white surface on a light blue-grey background (`--bg: #eef2f7`). Chart.js renders all charts and interactive maps use Leaflet.js.

### Issues Found

**2.1 — Excessive information above the fold**  
The Housing Needs Assessment page (`housing-needs-assessment.html`) presents a geography selector, a methodology panel, a KPI strip, and multiple chart sections immediately on load — before the user has selected any geography. This creates cognitive overload.

**Recommendation:** Use a progressive disclosure pattern. Show only the geography selector and a brief description on initial load. Reveal the analysis panels only after a geography is selected. Use smooth CSS transitions to animate the reveal (`transition: opacity 0.3s, max-height 0.4s`).

**2.2 — KPI cards lack units and change context**  
On the Economic Dashboard and Colorado Deep Dive pages, KPI cards show large numbers (e.g., "287") without immediately visible units. The delta arrows (▲ / ▼) appear without date context.

**Recommendation:** Always include unit labels on the same line as the value (e.g., "$287M" or "287 projects"). Add a sub-label showing the comparison period (e.g., "vs. prior year" or "12-mo change").

**2.3 — Color coding is inconsistent across pages**  
The Dashboard page uses different green/red thresholds for "good" vs. "bad" indicators than the Market Analysis scoring page. Some pages use `--good` (#047857) for positive values; others use teal `--accent`.

**Recommendation:** Enforce the semantic color token convention from the design system on every page:
- `--good` for positive / improving metrics  
- `--warn` for caution / approaching threshold  
- `--bad` for negative / distressed metrics  
- `--accent` only for interactive primary actions

**2.4 — Typography scale feels compressed on data-dense pages**  
At the current `--body: 0.938rem` (15px) base size, table rows and chart legends are readable on desktop but become cramped on 13-inch laptop screens at 100% zoom.

**Recommendation:** Increase the base body size to `1rem` (16px) and update `--small` to `0.875rem`. This one-pixel shift meaningfully improves readability on mid-size screens without disrupting the visual hierarchy.

**2.5 — Section headings and data sections lack visual separation**  
On long pages (HNA, Market Intelligence), the boundary between major analysis sections is only a `border-top` line. When pages are scroll-heavy, it is difficult to know where one analysis ends and another begins.

**Recommendation:** Add a subtle `background-color: var(--bg2)` alternating stripe to major sections. This "zebra striping" at the section level — not the row level — is a standard financial dashboard technique.

---

## 3. Charts & Data Visualization

### Current State
All charts use Chart.js. Color tokens `--chart-1` through `--chart-7` are defined in the CSS design system for WCAG AA compliance. The site supports dark mode via `@media (prefers-color-scheme: dark)` and a manual toggle.

### Issues Found

**3.1 — Charts do not have loading or empty states** ✅ **Partially Fixed**  
~~When a chart's data is still being fetched (or fails to load), the `<canvas>` element renders blank. There is no spinner, skeleton screen, or error message.~~

The `.chart-loading` CSS class and its `[hidden]` variant are now defined in `css/site-theme.css`. **Still outstanding:** the class is not yet wired into any page-level JavaScript. Chart containers still render blank on slow connections.

**Recommendation:** In each page's data-fetch callback, toggle `chartLoadingEl.hidden = false` before the fetch and `hidden = true` after. The CSS is ready; only JS wiring remains.

**3.2 — Trend charts lack annotation markers**  
Time-series charts (FRED indicators, LIHTC historical allocations) do not annotate significant events (e.g., COVID-19 impact in 2020, AHCIA expansion proposals in 2023).

**Recommendation:** Use the `chartjs-plugin-annotation` library to add vertical line markers at policy-relevant dates. Each annotation should have a brief label (e.g., "COVID-19" or "AHCIA 2023 introduced") and link to the relevant legislation page.

**3.3 — No drill-down from summary charts to detail**  
The statewide AMI gap chart and the LIHTC allocation trend charts show summary data but do not allow users to click a bar or point to see the underlying county or project-level detail.

**Recommendation:** Implement click-to-drill-down on summary charts. Chart.js supports `onClick` event handlers. Clicking a county bar in the AMI gap chart should navigate to (or reveal) the county-specific HNA panel.

**3.4 — Map and chart views are not synchronized**  
On the Colorado Deep Dive page, clicking a county on the map does not update the AMI gap bar chart to highlight that county, and vice versa. These views are decoupled.

**Recommendation:** Create a shared `selectedCounty` state variable that both the Leaflet map and the Chart.js charts subscribe to. When the user selects a county in either view, both views update.

**3.5 — Dark mode chart colors need refinement**  
In dark mode, the `--chart-3` token (`#096e65` teal in light mode) maps to the same teal in dark mode, but against the dark `--bg: #08121e` background, this creates insufficient contrast for thin line charts.

**Recommendation:** Define dark-mode-specific chart palette overrides in the `@media (prefers-color-scheme: dark)` block. Shift line chart colors 20–30% lighter in dark mode while maintaining at least 4.5:1 contrast.

---

## 4. Mobile & Responsive Design

### Current State
The site uses a mobile-first responsive layout with breakpoints in `css/responsive.css`. A custom mobile menu (`js/mobile-menu.js`) handles the hamburger toggle. The design system has `--radius-xl: 22px` for pill-shaped mobile UI elements and `min-height: 44px` touch targets per WCAG 2.5.5.

### Issues Found

**4.1 — Interactive maps are unusable on small screens**  
The Leaflet.js map on the Colorado Deep Dive page and the HNA boundary map are constrained to the viewport without proper mobile gesture handling. On phones, two-finger zoom conflicts with page scroll.

**Recommendation:** Add `map.touchZoom.enable()` with `tap: false` on small viewports. Provide a "Focus on Colorado" reset button that snaps the map back to the state bounding box. Consider providing a non-map fallback view (e.g., a county selector dropdown) for screens narrower than 480px.

**4.2 — Data tables overflow on mobile** ✅ **Fixed**  
~~Several pages render `<table>` elements that overflow horizontally on screens narrower than 768px. The overflow is clipped without a horizontal scroll indicator.~~

`.table-scroll` with `overflow-x: auto` is now defined in `css/layout.css` and applied to data tables across the site.

**4.3 — Filter panels are hard to use on touch**  
The Market Analysis filter panel (buffers, unit count, AMI targets) renders as a horizontal inline form on desktop. On mobile, this becomes a narrow, crowded column with small tap targets.

**Recommendation:** Detect touch devices and render filter panels as a bottom sheet (slide-up panel) on mobile. This is a standard native mobile pattern that maximizes screen space for the map while keeping filters accessible.

**4.4 — Font sizes on mobile do not scale**  
The `--h1` token uses `clamp(1.7rem, 3.5vw, 2.6rem)`, which renders well on desktop. On a 375px viewport, `3.5vw` equals `13.125px` — smaller than the minimum `1.7rem`. However, `clamp` protects the floor, so this is acceptable. The issue is with sub-headings (`--h2: clamp(1.15rem, 2vw, 1.4rem)`) which on very narrow screens render at the same visual weight as body text.

**Recommendation:** Increase the `--h2` floor to `1.2rem` and add `font-weight: 700` to all `h2` selectors in the mobile breakpoint to ensure clear visual distinction.

---

## 5. Interactive Component Feedback & Accessibility

### Current State
The site implements WCAG 2.1 AA compliance including `role="img"` and `aria-label` on all `<canvas>` elements, `aria-live="polite"` regions for dynamic updates, landmark elements (`<header>`, `<main id="main-content">`, `<footer>`), and skip-navigation links. The `--focus-ring` token provides 3px focus outlines.

### Issues Found

**5.1 — Export buttons lack feedback**  
The "Export PDF", "Export CSV", and "Export JSON" buttons on the HNA page trigger downloads but show no confirmation (success toast, spinner, or checkmark).

**Recommendation:** After a successful export, show a brief toast notification ("PDF downloaded ✓") using the existing `#hnaLiveRegion` aria-live region. Announce the event for screen reader users and show a visual toast for sighted users. Dismiss automatically after 4 seconds.

**5.2 — Form validation messages are not visible to screen readers**  
When a user enters an invalid buffer radius or site address in the Market Analysis tool, the error message appears as a red `<span>` next to the field but is not announced to screen readers.

**Recommendation:** Associate error messages with their input using `aria-describedby`. Set `aria-invalid="true"` on the input when validation fails. Clear both attributes on correction.

**5.3 — Progress indicators on long operations** ✅ **Fixed**  
~~The PMA analysis pipeline has 9 steps (commuting, barriers, employment centers, schools, transit, competitive set, opportunities, infrastructure, justification). The progress bar (`#pmaProgressFill`) exists but its `aria-valuenow` attribute is not updated dynamically.~~

`pma-ui-controller.js` now calls `bar.setAttribute('aria-valuenow', String(step.pct))` at each step and sets it to `'100'` on completion. Assistive technology correctly announces progress.

**5.4 — Data freshness is not communicated**  
Users have no clear indication of how old the data on each page is. The `data-freshness.js` module exists but its output (a small "Last updated" label) is positioned at the bottom of the page and easy to miss.

**Recommendation:** Move the "Data last updated" indicator to the top of each analysis section, immediately below the section heading. Use `--warn` color when data is older than 30 days and `--bad` when older than 90 days.

**5.5 — Keyboard navigation in the geography selector is incomplete**  
The HNA geography typeahead selector requires mouse interaction to select a result from the dropdown. Keyboard users cannot navigate the suggestion list with arrow keys.

**Recommendation:** Implement the ARIA combobox pattern (`role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-activedescendant`) on the geography selector. Handle `ArrowDown`, `ArrowUp`, `Enter`, and `Escape` keys in the input's `keydown` handler.

---

## 6. Performance

### Current State
The site uses a **build-cache-serve** pattern where data is pre-fetched by GitHub Actions workflows and stored as static JSON. The front end reads cached JSON, avoiding runtime API dependency for most views. Chart.js and Leaflet.js are loaded from CDN.

### Issues Found

**6.1 — No resource hints for critical assets**  
The pages load `Chart.js`, `Leaflet.js`, and Google Fonts without `<link rel="preconnect">` or `<link rel="preload">` hints.

**Recommendation:** Add the following to the `<head>` of all pages (for Google Fonts) and to pages that load from `cdn.jsdelivr.net` (`LIHTC-dashboard.html`, `dashboard.html`, `housing-needs-assessment.html`, `regional.html`, `state-allocation-map.html`):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Only on pages that load from cdn.jsdelivr.net: -->
<link rel="preconnect" href="https://cdn.jsdelivr.net">
```

**6.2 — Large JSON files are loaded synchronously**  
`data/fred-data.json` (958 KB) and `data/chfa-lihtc.json` are fetched on page load. On slow connections, this delays chart rendering.

**Recommendation:** Use `IntersectionObserver` to defer loading data for below-the-fold charts until they scroll into view. The existing `fetchWithTimeout` helper can be wrapped in this lazy-load pattern.

**6.3 — Missing `<meta name="theme-color">` tag**  
Pages do not have a theme-color meta tag, so mobile browser chrome does not adopt the brand color.

**Recommendation:** Add `<meta name="theme-color" content="#096e65" media="(prefers-color-scheme: light)">` (the light-mode `--accent` token value) and a dark-mode variant using the dark `--accent` value `#0fd4cf` to all pages:
```html
<meta name="theme-color" content="#096e65" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0fd4cf" media="(prefers-color-scheme: dark)">
```

---

## 7. Content & Information Architecture

### Issues Found

**7.1 — About page lacks a site map and architecture overview**  
The `about.html` page describes the organization's mission but does not explain how the platform's tools relate to each other or provide a visual tour.

**Recommendation:** Add a "How it works" section with a three-step visual flow: (1) Select your geography, (2) Run your analysis, (3) Export your report. Link each step to the relevant tool.

**7.2 — Policy briefs and insights lack search/filter**  
The `insights.html` and `policy-briefs.html` pages list articles chronologically with no filtering by topic, region, or data source.

**Recommendation:** Add a tag-based filter bar above the article grid. Tags should include geography (Colorado, National), topic (LIHTC, FMR, Market Trends, Policy), and audience (Developers, Policymakers, Analysts). Filtering should work client-side using JavaScript (no server round-trip).

**7.3 — Missing glossary for technical terms**  
The site uses specialized financial and housing terms (LIHTC, QCT, DDA, AMI, CHAS, LODES, FMR, etc.) without consistent inline explanation. New users — even experienced housing professionals — may not know all acronyms.

**Recommendation:** Create a `glossary.html` page and link it from the site footer. Additionally, add `<abbr title="...">` HTML elements to first occurrences of each acronym on all pages.

**7.4 — No "Compare" functionality between geographies**  
Users must navigate to different pages or reload the HNA tool to compare metrics between two counties. There is no side-by-side view.

**Recommendation:** Add a "Compare" mode to the HNA and Market Intelligence pages. When activated, the user can select a second geography and both are displayed in split-screen columns with aligned metrics.

---

## 8. Priority Matrix

| Priority | Recommendation | Effort | Impact |
|----------|----------------|--------|--------|
| 🔴 High | 5.5 — Keyboard navigation in geography selector | Medium | Accessibility / Legal |
| 🔴 High | 3.1 — Chart loading and empty states | Low | UX trust |
| 🔴 High | 4.2 — Table overflow on mobile | Low | Mobile UX |
| 🟠 Medium | 1.1 — User journey-based navigation | High | Discoverability |
| 🟠 Medium | 2.1 — Progressive disclosure on HNA page | Medium | Cognitive load |
| 🟠 Medium | 3.4 — Synchronized map and chart | Medium | Analytical UX |
| 🟠 Medium | 5.1 — Export feedback toasts | Low | Interaction quality |
| 🟡 Low | 2.3 — Color coding consistency | Low | Brand coherence |
| 🟡 Low | 6.1 — Resource hints | Low | Performance |
| 🟡 Low | 7.3 — Glossary and acronym tooltips | Medium | Content usability |

---

## 9. Design System Strengths (Do Not Change)

The following design decisions are well-executed and should be preserved:

- **CSS custom property token system** — All colors, spacing, and typography are defined as CSS variables in a single source-of-truth file. This is the correct pattern.
- **WCAG 2.1 AA compliance** — The `--accent: #096e65` token achieves 4.51:1 contrast. Canvas elements have `role="img"` and `aria-label`. Skip-navigation links are present. Preserve all of these.
- **Dark mode** — The `@media (prefers-color-scheme: dark)` block is complete and well-tested. The manual toggle works. Do not simplify or remove dark mode support.
- **CacheManager + fetchWithTimeout pattern** — The layered fallback pattern (local JSON → remote API → embedded data) ensures the site works even when external APIs are down. This is a production-quality resilience pattern worth keeping.
- **`aria-live` regions** — Dynamic chart updates announce to screen readers via `#hnaLiveRegion` and `window.__announceUpdate()`. This is correct and should be extended to all interactive pages.

---

*End of Site Design Audit*
