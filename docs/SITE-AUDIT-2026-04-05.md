# COHO Analytics — Site Audit
**Date:** 2026-04-05
**Scope:** Full technical, UX, and architectural review of Housing-Analytics repository

---

## Executive Summary

COHO Analytics is a mature, well-structured static web platform with 37 live pages, 160+ JS modules, 34 CI/CD workflows, and ~700 automated checks. The 5-step LIHTC workflow (jurisdiction → HNA → market → scenario → deal) is the strongest part of the product. The supporting exploration pages (deep dive, economic dashboard, allocations) are solid.

**Top issues by category:**

| Category | Issue | Severity |
|----------|-------|----------|
| **Reliability** | Data connectors lack error handling; silent failures on API outages | High |
| **Reliability** | Race conditions: HudFmr, hna-export load order dependencies | High |
| **Maintainability** | Hardcoded constants scattered across 15+ files (AMI limits, credit rates, ACS year) | High |
| **Maintainability** | Duplicate hna-export.js (root + hna/ directory) | Medium |
| **UX** | Exploration pages lack clear "what to do next" guidance | Medium |
| **UX** | No way to compare two jurisdictions side-by-side | Medium |
| **UX** | County context missing on comparative analysis page | Medium |
| **Performance** | ranking-index.json is 166K tokens; loaded entirely on page init | Medium |
| **Code quality** | 58 console.logs in market-analysis.js; 138 files with debug logging | Low |
| **CSS** | Duplicate colorado-deep-dive.css (root + pages/); 8 potentially unused CSS files | Low |
| **CSS** | predictions-dashboard.css uses hardcoded RGB colors, breaks dark mode | Low |

---

## Part 1: Prioritized Technical Findings

### Critical

**C1. Data connector error handling is inconsistent**
- **Problem:** 17 files in `js/data-connectors/` use raw `fetch()` without `.catch()`. If an API is down, functions return `undefined` silently, causing downstream rendering failures.
- **Affected:** All data-connector files, deal-calculator.js (HudFmr dependency)
- **Risk:** User sees blank sections or broken charts with no explanation
- **Fix:** Use `safeFetchJSON()` from fetch-helper.js consistently. Add fallback UI ("Data temporarily unavailable") for each connector.

**C2. HudFmr timing dependency in deal-calculator**
- **Problem:** `deal-calculator.js` calls `HudFmr.isLoaded()` synchronously on init. If HUD FMR data hasn't loaded yet, calculator renders with hardcoded fallback AMI limits ($930/$1240) that may be wrong for the selected county.
- **Affected:** deal-calculator.html
- **Risk:** Users see incorrect rent limits without any warning
- **Fix:** Emit `HudFmr:loaded` event; deal-calculator subscribes and recalculates. Show loading state until data arrives.

**C3. hna-export.js dual-file dependency**
- **Problem:** Root `hna-export.js` (281 lines) contains the real implementation. `hna/hna-export.js` (29 lines) is a thin wrapper that delegates to `window.__HNA_*`. If root file doesn't load first, exports silently fail.
- **Affected:** housing-needs-assessment.html export functionality
- **Risk:** Export buttons appear functional but produce nothing
- **Fix:** Consolidate into single `js/hna/hna-export.js`.

### High

**H1. Hardcoded constants across 15+ files**
- AMI limits, credit rates (9%/4%), mortgage assumptions (6.5%, 30yr), ACS vintage year, eligible basis percentage — all hardcoded in individual files instead of centralized config.
- **Fix:** Move to `config.js` or a `constants.json` loaded at startup.

**H2. workflow-state.js is 824 lines**
- Mixes project management, step tracking, localStorage persistence, migration logic, and event dispatch in one file.
- **Fix:** Not urgent, but should split into project-manager + step-manager when next refactoring.

**H3. Navigation styles embedded as JS string**
- `navigation.js` lines 91-168 contain all nav CSS as a template literal injected into `<head>`. Hard to maintain, can't be cached separately.
- **Fix:** Extract to `css/navigation.css` (already exists in components but isn't used by navigation.js).

### Medium

**M1. 8 potentially unused CSS files**
- `button-enhancements.css`, `dark-mode-transitions.css`, `footer-theme.css`, `mobile-nav.css`, `help-modal.css`, `performance.css`, `print.css`, `styles.css` — no HTML page links to them directly.
- **Fix:** Verify with grep for @import or JS-injected references. Remove confirmed dead files.

**M2. Duplicate colorado-deep-dive.css**
- Exists at both `css/colorado-deep-dive.css` (12.2 KB) and `css/pages/colorado-deep-dive.css` (10.3 KB).
- **Fix:** Determine which is canonical, delete the other.

**M3. housing-needs-assessment.css loaded twice on market-analysis.html**
- market-analysis.html links both `css/pages/market-analysis.css` and `css/pages/housing-needs-assessment.css`.
- **Fix:** Verify if HNA styles are actually needed on market-analysis page. If shared styles exist, extract to a common file.

**M4. ranking-index.json performance**
- 166K tokens loaded entirely on comparative analysis page init. On slow connections this delays rendering.
- **Fix:** Consider pagination (already has PAGE_SIZE=100 in JS) or lazy-load remaining entries after first page renders.

**M5. 22 legacy fix_*.py scripts clutter scripts directory**
- One-off fixes kept for audit trail but confuse new contributors.
- **Fix:** Move to `scripts/legacy/` with a README.

### Low

**L1. 138 JS files contain console.log statements**
- `market-analysis.js` has 58 alone. Not harmful but noisy in production.
- **Fix:** Review and remove unnecessary debug logging. Keep prefixed error/warn statements.

**L2. predictions-dashboard.css hardcoded colors**
- Uses `rgba(26, 115, 232, 1)` instead of theme variables. Breaks dark mode consistency.
- **Fix:** Replace with `var(--accent)` or appropriate token.

**L3. LIHTC-dashboard.html uses deprecated redirect**
- `http-equiv="refresh"` redirect to lihtc-allocations.html. Still loads scripts before redirecting.
- **Fix:** Replace with JS-only redirect or remove page entirely (update any inbound links).

---

## Part 2: Page-by-Page UX Assessment

### Workflow Pages (Strong)

| Page | Current State | Key Gap |
|------|--------------|---------|
| select-jurisdiction.html | Excellent. Clear framing, two entry paths, recent projects. | None significant |
| housing-needs-assessment.html | Excellent. Rich data, good educational framing. | Very long page — could benefit from progressive disclosure |
| market-analysis.html | Excellent. Leaflet map, radar scoring, PMA methodology. | Dense; first-time users may not know where to focus |
| hna-scenario-builder.html | Excellent. Interactive unit mix, AMI calculator. | None significant |
| deal-calculator.html | Excellent. Pro forma, education section, CRA lender list. | HudFmr timing issue (C2) |

### Exploration Pages (Good, with gaps)

| Page | Current State | Key Gap |
|------|--------------|---------|
| hna-comparative-analysis.html | Good ranking table, 547 geographies, CSV export. | **No county context view. No side-by-side comparison. No "what to do with this ranking" guidance.** |
| colorado-deep-dive.html | Excellent. County drill-down, LIHTC map, regional predictions. | Could link more explicitly to workflow entry |
| economic-dashboard.html | Excellent. Real-time FRED data, clear KPIs. | None significant |
| lihtc-allocations.html | Good. National view with state comparison. | Could better explain relevance to Colorado users |
| compliance-dashboard.html | Excellent. Prop 123 tracker with fallback data. | None significant |

### Content Pages (Adequate)

| Page | Assessment |
|------|-----------|
| insights.html | Good hub page. Cards are clear. |
| lihtc-guide-for-stakeholders.html | Excellent educational content. |
| article-co-housing-costs.html | Good. Interactive county maps. |
| policy-briefs.html | Adequate. Could use better framing. |
| about.html | Excellent. Data sources, methodology, disclaimers. |

### Pages That Need Attention

**hna-comparative-analysis.html** is the biggest UX gap. Users land on a 547-row ranking table with sorting and filtering but:
- No guidance on **why** they're looking at this data
- No way to **compare two jurisdictions** side-by-side
- No **county context** (which places are in my county?)
- No connection to **deal concepts** (does this need match my project idea?)
- The "Set as working jurisdiction" action exists but the exploration-to-action bridge is weak

This is the page that should become the comparison workspace.

---

## Part 3: Audience Assessment

### Developers (LIHTC)
**What they need:** Quickly assess whether a jurisdiction's need profile matches their project concept (family, senior, workforce, deeper-income). Compare two potential sites. Understand what to investigate next.
**What works:** HNA page, deal calculator, scenario builder are all strong.
**What's missing:** Side-by-side jurisdiction comparison. Concept-to-need alignment view. County-level context for site selection within a metro area.

### Investors / Syndicators
**What they need:** Where is need highest? What's the rough scale opportunity? Where does deeper diligence start?
**What works:** Ranking table, economic dashboard, allocation trends.
**What's missing:** Summary view of "strongest opportunity corridors." Deal concept comparison for portfolio allocation decisions.

### Policymakers / Planners (CHFA, DOLA, CDOH, Housing Authorities)
**What they need:** Which jurisdictions show strongest need indicators? How does need vary within a county? What concept types match different need patterns?
**What works:** Comparative analysis ranking, Prop 123 compliance, HNA demographics.
**What's missing:** County context panel showing all sub-jurisdictions. Policy commitment scorecard integrated with need data. Intra-county comparison.

### Educational / Intermediate Users
**What they need:** Understand what HNA comparison means. Learn why county context matters. See how concept types connect to need patterns.
**What works:** LIHTC guide, educational callouts, LIHTC tips components.
**What's missing:** Guided exploration on the comparative analysis page. "Why does this metric matter?" context on ranking columns.

---

## Part 4: Phased Implementation Plan — Comparison Workspace

### Phase 1: Foundation (1 PR)
**Goal:** County context panel + comparison setup on hna-comparative-analysis.html

**Files to modify:**
- `hna-comparative-analysis.html` — Add comparison setup bar and county context section
- `js/hna/hna-ranking-index.js` — Add county filtering, A/B selection state, row action buttons
- `css/pages/hna-comparative-analysis.css` — Styles for new sections

**Files to create:**
- `js/hna/hna-comparison.js` — Comparison state manager (A/B selection, county filter, persistence via SiteState)

**What it does:**
- Adds a comparison setup bar above the ranking table: county selector, Jurisdiction A/B display, swap/reset buttons
- When county selected, filters table to show only that county's jurisdictions (with "Show all" toggle)
- Ranking table rows get "Set as A" / "Set as B" action buttons
- Selected A/B rows are visually highlighted in the table
- Selections persist in SiteState so they survive page reload
- County-to-jurisdiction mapping uses existing geo-config.json `containingCounty` field where available

**What it does NOT do:** No side-by-side panel yet. No deal comparison. No scoring.

**Test plan:**
- Select Adams County → table filters to Adams County jurisdictions
- Click "Set as A" on one row, "Set as B" on another → both highlighted
- Reload page → selections preserved
- Click "Show all" → full 547-row table returns, A/B still highlighted
- Cross-county comparison: Set A from Adams, B from Denver → both highlighted correctly

### Phase 2: Side-by-Side Comparison (1 PR)
**Goal:** HNA metric comparison panel for A vs B

**Files to modify:**
- `hna-comparative-analysis.html` — Add comparison panel section
- `js/hna/hna-comparison.js` — Add data loading and comparison logic
- `css/pages/hna-comparative-analysis.css` — Comparison panel styles

**What it does:**
- When both A and B are selected, renders a structured comparison panel below the setup bar
- Loads summary data for both jurisdictions from `data/hna/summary/{geoid}.json`
- Compares: population, median income, % renters, % cost burdened, housing gap, overall need score, rank, in-commuters, vacancy
- Shows absolute differences with directional badges (higher/lower/similar)
- Adds 3-4 plain-English interpretation callouts (e.g., "A shows deeper affordability pressure")
- Missing data renders as "—" with explanation
- Panel collapses when only one jurisdiction selected

**What it does NOT do:** No deal comparison yet. No scoring model.

**Test plan:**
- Select A=Denver County, B=Adams County → comparison panel appears
- Verify all metrics load from summary files
- Clear B → panel collapses gracefully
- Select two jurisdictions with incomplete data → missing fields show "—"
- Verify mobile layout (panel stacks vertically)

### Phase 3: Deal Comparison Workspace (1 PR)
**Goal:** Two concept deals tied to A and B, with need alignment assessment

**Files to modify:**
- `hna-comparative-analysis.html` — Add deal comparison section
- `js/hna/hna-comparison.js` — Add deal input state and comparison logic
- `css/pages/hna-comparative-analysis.css` — Deal comparison styles

**Files to create:**
- `js/hna/hna-need-alignment.js` — Transparent need alignment model

**What it does:**
- Adds a deal input form for each jurisdiction (A and B): project name, total units, unit mix by AMI tier, development type, 4%/9%, optional TDC
- Reuses existing `deal-calculator.js` and `lihtc-deal-predictor.js` logic where possible — does NOT create a parallel calculator
- Compares deals on: share of local housing gap addressed, depth of affordability targeting, alignment to renter burden, scale relative to need
- Need alignment model uses only inputs already available (housing gap, cost burden, renter %, in-commuters, income, proposed units/targeting)
- Output: 4-5 dimensions rated Strong/Moderate/Limited with short explanations
- Explicit disclaimers: "This is concept fit assessment, not award prediction or feasibility analysis"
- Deal inputs persist in localStorage

**Scoring model design (to be finalized before coding):**
- **Gap coverage:** proposed units / housing gap → Strong (>5%), Moderate (1-5%), Limited (<1%)
- **Affordability depth:** weighted average AMI targeting vs local median → deeper = stronger
- **Burden alignment:** does unit mix target the income bands most cost-burdened?
- **Scale appropriateness:** is the project sized reasonably for the jurisdiction's population?
- **Demand signal:** in-commuter pressure + vacancy context

Each dimension is independently computed with clear formula. No opaque composite score.

**Test plan:**
- Enter Deal A (60 units, 60% AMI family) in Denver, Deal B (40 units, 30% AMI senior) in Adams → comparison renders
- Verify alignment ratings are plausible and explainable
- Test with missing HNA data → graceful degradation
- Verify disclaimers are visible
- Export comparison as PDF (if existing export infrastructure supports it)

### Phase 4: Polish and Hardening (1 PR)
**Goal:** UX improvements, edge cases, documentation

**What it does:**
- Add "How to use this page" collapsible guide at top
- Add column tooltips on ranking table ("Why this metric matters")
- Improve mobile layout for comparison and deal panels
- Add keyboard accessibility for A/B selection
- Write `docs/COMPARISON-WORKSPACE.md` explaining the feature
- Update `docs/GENERATED-INVENTORY.md` to include new files

---

## Part 5: Recommended Quick Fixes (Do Before Comparison Workspace)

These are independent of the comparison workspace and should be separate PRs:

1. **Consolidate hna-export.js** — Move root implementation into `js/hna/hna-export.js`, delete root file. (30 min)
2. **Add safeFetchJSON to data connectors** — Replace raw `fetch()` in the 5 most critical connectors with `safeFetchJSON()`. (1 hr)
3. **Fix HudFmr timing** — Add `HudFmr:loaded` event, subscribe in deal-calculator.js. (30 min)
4. **Move legacy scripts** — `mkdir scripts/legacy && mv scripts/fix_*.py scripts/legacy/`. (5 min)
5. **Delete confirmed unused CSS** — Verify and remove dead CSS files. (30 min)
6. **Clean market-analysis.js logging** — Remove 50+ unnecessary console.logs. (15 min)

---

## Appendix: File Inventory Summary

| Category | Count |
|----------|-------|
| Live HTML pages | 37 |
| Archive HTML pages | 6 |
| JavaScript files | 160+ |
| CSS files | 28 |
| Data files (JSON/GeoJSON/CSV) | 877 |
| Python scripts | 70 |
| JavaScript scripts | 27 |
| GitHub Actions workflows | 34 |
| Test files | 46 |
| Documentation files | 70+ |
| CI checks | ~700 |
