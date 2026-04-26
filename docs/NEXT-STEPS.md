# COHO Analytics — Branch & Main Analysis: Next Steps

**Generated:** 2026-03-24  
**Author:** Copilot analysis of `pggLLC/Housing-Analytics`

---

## 0. Immediate Next Steps (Post QA/QC — 2026-04-26)

This section supersedes older sequencing notes for the current sprint.

### 0.1 Execute production verification checklist (Issue #578)

1. Trigger and review:
   - `build-market-data.yml`
   - `build-hna-data.yml`
2. Confirm no deployment regressions on the live site:
   - font loading
   - map rendering
   - no console errors on core pages
3. Verify expected HNA summary artifact count in `data/hna/summary/`.

**Exit criteria:** checklist evidence posted to #578 with links/screenshots/log snippets.

### 0.2 Resolve operational pipeline failure (Issue #516)

1. Inspect failed run `#24019124215`.
2. Validate `CENSUS_API_KEY` in GitHub Actions secrets.
3. Re-run failed workflow after upstream health checks.
4. Add notification/escalation path for future pipeline failures.

**Exit criteria:** successful rerun + root-cause note captured in issue.

### 0.3 Complete feature QA checklist (Issue #550)

Validate and document:

- CHAS chart data correctness (Denver spot-check),
- source-badge placement,
- NHPD in competitive set,
- pro forma live updates,
- QAP slider behavior,
- scenario toggle (10/20-year) updates.

**Exit criteria:** pass/fail per item posted in #550, with regressions split into owner-assigned follow-up issues.

### 0.4 Data trust hardening (next PR batch)

1. Add automated link integrity checks for source URLs (prevent 404 source citations).
2. Add a jurisdiction-normalization regression suite for HNA comparative edge cases:
   - Fruita (city)
   - Clifton (CDP)
   - Boulder city label variants
3. Add accessibility contrast checks for the Pipeline Log presentation.

**Exit criteria:** CI checks fail on regression + docs updated in `TESTING.md`.

---

## 1. Repository State Summary

### Main Branch Health

| Check                              | Status                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| HNA functionality tests            | ✅ 657 passed, 0 failed                                                |
| Asset reference validation         | ✅ 34 HTML pages, 0 broken refs                                        |
| Critical data validation           | ✅ All required data files present                                     |
| Site validation (validate-site.js) | ✅ 28 passed, 0 warnings, 0 failed                                     |
| Fetch helper resolve tests         | ✅ 19 passed, 0 failed                                                 |
| GitHub Pages deployment            | ✅ Live at https://pggllc.github.io/Housing-Analytics/                 |
| Build Market Data CI               | ⚠️ Fails — `CENSUS_API_KEY` not set; tract_boundaries_co.geojson empty |

### Branch Inventory

- **Total branches:** 300+ (all `copilot/*` pattern)
- **Merged to main via PR:** 0 — all changes were applied directly to `main` through the automated quarantine/audit process
- **Branches status:** Historical artifacts; none contain pending features ahead of `main`

---

## 2. What Has Been Completed (Current Main State)

| Feature                                | Status      | Key Files                                                                                                                |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Housing Needs Assessment (HNA) tool    | ✅ Complete | `housing-needs-assessment.html`, `js/hna/` modules                                                                       |
| HNA Comparative Analysis ranking       | ✅ Complete | `hna-comparative-analysis.html`, `js/hna/hna-ranking-index.js`                                                           |
| Market Analysis (PMA) tool             | ✅ Complete | `market-analysis.html`, `js/market-analysis.js`                                                                          |
| PMA Phase 2 — Concept card + ACS cache | ✅ Complete | `js/lihtc-concept-card-renderer.js`, `js/market-analysis-cache-fix.js`                                                   |
| PMA Phase 2.1 — Constraint screening   | ✅ Complete | `js/environmental-screening.js`, `js/public-land-overlay.js`, `js/soft-funding-tracker.js`, `js/chfa-award-predictor.js` |
| Market Intelligence dashboard          | ✅ Complete | `market-intelligence.html`, `js/market-intelligence.js`                                                                  |
| LIHTC Allocations dashboard            | ✅ Complete | `lihtc-allocations.html`                                                                                                 |
| CHFA Portfolio page                    | ✅ Complete | `chfa-portfolio.html`                                                                                                    |
| Compliance Dashboard (Prop 123)        | ✅ Complete | `compliance-dashboard.html`                                                                                              |
| Colorado Deep Dive                     | ✅ Complete | `colorado-deep-dive.html`                                                                                                |
| Housing Legislation Tracker            | ✅ Complete | `housing-legislation-2026.html`                                                                                          |
| Preservation tracker (NHPD)            | ✅ Complete | `preservation.html`, `js/preservation.js`                                                                                |
| CRA Expansion Analysis                 | ✅ Complete | `cra-expansion-analysis.html`                                                                                            |
| WCAG 2.1 AA accessibility              | ✅ Complete | All 34 pages; aria-live, skip links, landmarks, touch targets                                                            |
| Dark/light mode                        | ✅ Complete | `css/site-theme.css`, `js/dark-mode-toggle.js`                                                                           |
| CI/CD pipeline (31 workflows)          | ✅ Complete | `.github/workflows/`                                                                                                     |
| FRED economic data pipeline            | ✅ Complete | `data/fred-data.json`, 39 series                                                                                         |
| CHFA LIHTC data (716 features)         | ✅ Complete | `data/chfa-lihtc.json`                                                                                                   |

---

## 3. Issues Fixed in This PR

The following validation issues were resolved as part of this analysis:

| Issue                                                                                                                                                              | Fix                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 3 redirect stub pages missing `<h1>` (`colorado-market.html`, `LIHTC-dashboard.html`, `state-allocation-map.html`)                                                 | Added `<h1>` headings to all three redirect pages                                                                    |
| `test/validate-site.js` false-positive empty href detection (JS template strings flagged as empty hrefs in `policy-briefs.html`, `dashboard-data-sources-ui.html`) | Fixed regex to strip `<script>` blocks before matching; use same-quote pair `(["'])\1` instead of mismatched bracket |
| `data/prop123_jurisdictions.json` redundant root-path entry in REQUIRED_JSON (all JS uses `data/policy/prop123_jurisdictions.json`)                                | Removed stale root-path entry from validator                                                                         |

---

## 4. Remaining Issues (Prioritized)

### P0 — Critical (blocking or data-impacting)

#### 4.1 Build Market Data CI — Census API Key Required

**Impact:** The `market_data_build.yml` workflow fails because `CENSUS_API_KEY` is missing.  
`tract_boundaries_co.geojson` is empty; tract centroid data (1605 records) comes from a prior run.

**Action:**

1. Set `CENSUS_API_KEY` in [GitHub Settings → Secrets → Actions](https://github.com/pggLLC/Housing-Analytics/settings/secrets/actions)
2. Manually trigger: `gh workflow run market_data_build.yml`
3. The workflow will populate `data/market/tract_boundaries_co.geojson` with full CO census tract polygons

#### 4.2 `data/co-county-boundaries.json` Has 0 Features

**Impact:** Market Analysis map and Colorado Deep Dive map fall back to live TIGERweb API for county boundaries instead of using the local cached file. Adds latency; breaks offline mode.

**Action:**

```bash
python3 scripts/boundaries/build_counties_co.py
```

Then commit the resulting `data/co-county-boundaries.json` (should be 64 features).

---

### P1 — High Priority (UX/Functionality)

#### 4.3 `census-dashboard.html` Not in Navigation

The Census Dashboard page exists at `census-dashboard.html` but is not linked from `js/navigation.js`. Users cannot discover it through normal browsing.

**Options:**

- Add it to a "Resources" or "Legacy" group in `js/navigation.js`
- Move it to `archive/census-dashboard.html` alongside other archived pages

**Recommended:** Archive it (it has been superseded by the HNA tool's census integration).

#### 4.4 Breadcrumbs Missing on 4 Core Analysis Pages

Per the [Site Design Audit](SITE-DESIGN-AUDIT.md), the following pages lack breadcrumbs:

- `market-analysis.html`
- `housing-needs-assessment.html`
- `compliance-dashboard.html`
- `regional.html`

**Action:** Add `<nav aria-label="Breadcrumb">` with `Home > [Page Name]` pattern (consistent with `about.html`).

#### 4.5 Persistent Geography State Between Pages

When a user selects "Denver County" on the HNA page and navigates to Market Intelligence, the selection is lost. This creates friction in the primary workflow (HNA → Market Analysis → LIHTC screening).

**Action:** Implement `localStorage`-backed geography persistence:

```js
localStorage.setItem(
  "coho:lastGeography",
  JSON.stringify({ type, geoid, name }),
);
```

Load and pre-populate controls on pages that share geography selectors.

---

### P2 — Medium Priority (Enhancements)

#### 4.6 Progressive Disclosure on HNA Page

The Housing Needs Assessment page (`housing-needs-assessment.html`) shows all analysis panels before a geography is selected, creating cognitive overload.

**Action:** Hide analysis panels initially with `display:none`; reveal with CSS transition after geography selection fires the `update()` call.

#### 4.7 KPI Cards — Units and Comparison Period Labels

On the Economic Dashboard and Colorado Deep Dive, KPI cards show raw numbers without units or date context.

**Action:** Append unit labels to values (e.g., "$287M", "2.1%") and add a sub-label showing comparison period ("vs. prior year", "12-mo change").

#### 4.8 Market Data Placeholder → Full Data

The `data/market/` directory has these placeholder counts:

- `tract_centroids_co.json`: 1605 records (built by prior CI run, should be 1605+)
- `acs_tract_metrics_co.json`: 1447 records (previously 4 placeholders — now populated)
- `hud_lihtc_co.geojson`: 360 features (was 10 placeholder, now 360)
- `tract_boundaries_co.geojson`: **0 features** — blocked by Census API key (see 4.1)

---

### P3 — Future Enhancements (Roadmap)

These items are documented in [FEATURE_COMPLETE.md](FEATURE_COMPLETE.md) and the [Site Design Audit](SITE-DESIGN-AUDIT.md):

| Enhancement                                                 | Estimated Effort | Value                                                                   |
| ----------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| LODES workforce integration for PMA commuter-shed scoring   | Medium           | High — fills the constant `0.60` proxy in the workforce radar dimension |
| Parcel/zoning layer for PMA land availability subscore      | Large            | High — currently uses proxy score                                       |
| Historical trend charts in Market Intelligence              | Medium           | Medium                                                                  |
| Multi-county aggregation view in HNA/Market Intelligence    | Medium           | Medium                                                                  |
| Rent roll benchmarking in PMA comparable analysis           | Large            | High                                                                    |
| Persona-based "Start Here" onboarding flow on index.html    | Small            | Medium                                                                  |
| Increased base font size (15px → 16px) for mid-size screens | Small            | Low                                                                     |
| Section zebra-striping on long analysis pages               | Small            | Low                                                                     |
| Semantic color token enforcement (--good / --warn / --bad)  | Small            | Low                                                                     |

---

## 5. Branch Cleanup Recommendation

All `copilot/*` branches are historical artifacts from the Copilot-assisted development workflow. None contain code ahead of `main`. They can be safely deleted to reduce repository clutter.

**To delete all merged/stale copilot branches:**

```bash
gh api repos/pggLLC/Housing-Analytics/branches --paginate \
  --jq '.[].name | select(startswith("copilot/"))' | \
  xargs -I{} gh api --method DELETE repos/pggLLC/Housing-Analytics/git/refs/heads/{}
```

> **Note:** Delete only after confirming no active work is in progress on any branch.

The one exception is `audit-fixes-comprehensive` — verify its content before deleting.

---

## 6. CI/CD Health

| Workflow               | Schedule         | Last Status | Notes                          |
| ---------------------- | ---------------- | ----------- | ------------------------------ |
| CI Checks              | PR + push        | ✅ success  | 34 HTML pages, data thresholds |
| Deploy to GitHub Pages | push to main     | ✅ success  | Auto-deploys                   |
| Fetch FRED Data        | Daily            | ✅ success  | 39 series                      |
| Fetch CHFA LIHTC       | Weekly Mon 05:00 | ✅ success  | 716 features                   |
| Cache HUD GIS Data     | Weekly Mon 04:00 | ✅ success  | QCT/DDA                        |
| Build Market Data      | Weekly + manual  | ⚠️ failure  | Needs `CENSUS_API_KEY`         |
| WCAG Contrast Audit    | push             | ✅ success  |                                |
| Site Audit             | push             | ✅ success  |                                |
| Archive, Audit & Docs  | push             | ✅ success  |                                |
| Build Redeploy ZIP     | push             | ✅ success  |                                |

---

## 7. Recommended Execution Order

For maximum impact with minimum risk, address items in this order:

1. ✅ **[DONE]** Fix h1 on redirect pages + validate-site.js false positives (this PR)
2. **Add `CENSUS_API_KEY` secret** → trigger `market_data_build.yml` → commit `tract_boundaries_co.geojson`
3. **Run `build_counties_co.py`** → commit `data/co-county-boundaries.json` with 64 features
4. **Archive `census-dashboard.html`** → update navigation to remove dead page
5. **Add breadcrumbs** to the 4 remaining analysis pages
6. **Implement persistent geography** via localStorage
7. Remaining P2/P3 items per roadmap above
