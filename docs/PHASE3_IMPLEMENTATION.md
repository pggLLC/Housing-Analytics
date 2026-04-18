# Phase 3 Implementation Roadmap — COHO Analytics

> **Epics:** [#444][444] · [#445][445] · [#446][446] · [#447][447]  
> **Status:** In Progress · Updated 2026-03-28

[444]: https://github.com/pggLLC/Housing-Analytics/issues/444
[445]: https://github.com/pggLLC/Housing-Analytics/issues/445
[446]: https://github.com/pggLLC/Housing-Analytics/issues/446
[447]: https://github.com/pggLLC/Housing-Analytics/issues/447

---

## Overview

Phase 3 builds on the Stage 1–3 data-quality audit and Phase 2.1 constraint-overlay work to deliver:

| Epic | Module | Status |
|------|--------|--------|
| #444 | Legislative & CRA Expansion Tracker | 🟡 In Progress |
| #445 | Enhanced LIHTC Deal Prediction Module | 🟡 In Progress |
| #446 | Documentation, Testing & Implementation Guidance | 🟡 In Progress |
| #447 | Data Quality, Monitoring & Infrastructure | 🟡 In Progress |

---

## Epic #444 — Legislative & CRA Expansion Tracker

**Objective:** Dynamic bill status tracking and CRA impact analysis for affordable housing legislation.

### New Files

| File | Purpose |
|------|---------|
| `js/legislative-tracker.js` | Bill status engine, LIHTC/CRA impact scoring |
| `housing-legislation-2026.html` | H.R. 6644 bill detail page with live tracker integration |
| `test/test_legislative_tracker.js` | 148-test suite |

### Key APIs

```js
const tracker = LegislativeTracker;

tracker.getAllBills();          // all bills with stageProgress, passageProbability
tracker.getBill('HR6644');     // single bill by ID
tracker.getBillsByTag('LIHTC'); // filter by tag
tracker.getMarketImpactSummary(); // weighted aggregate impact

// Returns CRA tract targeting signals (isLmiTract, cra_score)
tracker.getCraTractTargeting({ tractId, medianIncome, areaMedianIncome });
```

### Bill IDs

| ID | Bill | Stage |
|----|------|-------|
| `HR6644` | Housing for the 21st Century Act | Conference Committee |
| `AHCIA` | Affordable Housing Credit Improvement Act | Senate Committee |
| `ROAD` | Revitalizing Opportunity Areas & Developments Act | Senate Committee |
| `CRA-MOD` | CRA Modernization provisions | In Committee |

### Integration Points

- `housing-legislation-2026.html` loads `js/legislative-tracker.js` and calls `LegislativeTracker.getAllBills()` on `DOMContentLoaded` to populate the live bill status panel.
- `cra-expansion-analysis.html` uses `getCraTractTargeting()` for tract-level CRA signals.
- `js/lihtc-deal-predictor-enhanced.js` calls `getMarketImpactSummary()` to calculate equity pricing boost.

---

## Epic #445 — Enhanced LIHTC Deal Prediction Module

**Objective:** Extend `LIHTCDealPredictor` with Phase 3 data sources and scenario analysis.

### New Files

| File | Purpose |
|------|---------|
| `js/lihtc-deal-predictor-enhanced.js` | Phase 3 enhanced predictor (wraps base) |
| `test/test_lihtc_deal_predictor.js` | Extended test suite (110 tests) |

### Architecture

```
LIHTCDealPredictorEnhanced.predictEnhanced(inputs)
  ├─ LIHTCDealPredictor.predictConcept(inputs)  ← base recommendation
  ├─ _computePmaSignals()                        ← PMA demand tier
  ├─ _computeAffordabilityGapSignals()           ← AMI gap targeting
  └─ _computeLegislativeContext()                ← equity pricing boost
```

### Phase 3 Input Fields

| Field | Type | Description |
|-------|------|-------------|
| `geoid` | string | 5-digit county FIPS (e.g. `"08001"`) |
| `pmaScore` | number | PMA site score 0–100 |
| `pmaConfidence` | string | `'high'\|'medium'\|'low'` |
| `ami30UnitsNeeded` | number | 30% AMI unit gap from HNA |
| `ami50UnitsNeeded` | number | 50% AMI unit gap |
| `ami60UnitsNeeded` | number | 60% AMI unit gap |
| `totalUndersupply` | number | Total affordable unit gap |
| `pabCapAvailable` | boolean | PAB volume cap pre-allocated |
| `fmrData` | Object | HUD FMR data `{ oneBedroomFMR, … }` |
| `chfaHistoricalAwards` | number | Prior CHFA awards in county (5-yr) |
| `countyAffordabilityGap` | number | County gap score 0–100 |

### Phase 3 Output Fields

| Field | Description |
|-------|-------------|
| `result.base` | Full `DealRecommendation` from base predictor |
| `result.enhanced.pmaSignals` | `{ tier, score, supportsNinePct, supportsFourPct }` |
| `result.enhanced.affordabilityGapSignals` | `{ targeting, deepAffordabilityShare }` |
| `result.enhanced.legislativeContext` | `{ equityPricingBoost, activeBillCount, keyBills }` |
| `result.summary` | Plain-text summary for UI rendering |

### Usage

```js
// Browser
const result = LIHTCDealPredictorEnhanced.predictEnhanced({
  geoid:            '08013',   // Boulder County
  pmaScore:         82,
  pmaConfidence:    'high',
  proposedUnits:    80,
  ami30UnitsNeeded: 45,
  ami50UnitsNeeded: 25,
  isQct:            false,
  isDda:            false,
  pabCapAvailable:  true
});

console.log(result.base.recommendedExecution);           // '9%' | '4%' | 'Either'
console.log(result.enhanced.pmaSignals.tier);            // 'strong'
console.log(result.enhanced.legislativeContext.equityPricingBoost); // 0.06
console.log(result.summary);                             // plain-text report

// Batch scenario comparison
const scenarios = LIHTCDealPredictorEnhanced.evaluateScenarios([
  { label: '9% Base Case', geoid: '08013', pmaScore: 82, pabCapAvailable: false },
  { label: '4% PAB Case',  geoid: '08013', pmaScore: 82, pabCapAvailable: true  }
]);
```

---

## Epic #446 — Documentation, Testing & Implementation Guidance

**Objective:** Comprehensive documentation and expanded test coverage for all Phase 3 modules.

### New Files

| File | Purpose |
|------|---------|
| `docs/PHASE3_IMPLEMENTATION.md` | This file — implementation roadmap |
| `docs/PHASE3_PLAN.md` | Epic breakdown, sub-issue tracking |
| `docs/PHASE3_IMPLEMENTATION_GUIDE.md` | API reference and integration guide |
| `tests/phase3-setup.js` | Phase 3 test harness initialization |
| `test/test_legislative_tracker.js` | Legislative tracker tests (148 tests) |
| `test/test_lihtc_deal_predictor.js` | LIHTC predictor tests (110 tests) |

### Running Phase 3 Tests

```bash
# All JavaScript tests for Phase 3 modules
node test/test_legislative_tracker.js
node test/test_lihtc_deal_predictor.js

# Phase 3 setup validation
node tests/phase3-setup.js

# Full CI test suite
npm run test:ci

# Python accessibility and visualization tests
pytest tests/ -v
```

### CI Workflows

| Workflow | Schedule | Coverage |
|----------|----------|---------|
| `ci-checks.yml` | Every push/PR | JS smoke tests, HTML validation |
| `data-quality-check.yml` | Every 6 hours | Data file health checks |
| `accessibility.yml` | Weekly | WCAG 2.1 AA audit |
| `docs-sync.yml` | Weekly | Documentation freshness |

---

## Epic #447 — Data Quality, Monitoring & Infrastructure

**Objective:** Real-time health indicators, enhanced ETL validation, and WCAG 2.1 AA compliance.

### New Files

| File | Purpose |
|------|---------|
| `js/data-quality-monitor.js` | Real-time health polling with UI rendering |
| `scripts/setup-census-api-key.sh` | Guided Census API key setup script |

### Data Quality Monitor

The `DataQualityMonitor` module polls five critical datasets every 5 minutes and updates a health dashboard panel:

```js
// Start monitoring (call once on page load)
DataQualityMonitor.start();

// Render health panel
DataQualityMonitor.renderDashboard(document.getElementById('dqm-panel'));

// Listen for health events
document.addEventListener('dqm:degraded', function (e) {
  console.warn('Dataset degraded:', e.detail.key, e.detail.message);
});

// Get current snapshot
const status = DataQualityMonitor.getStatus();
// status['chfa-lihtc'].state  → 'healthy' | 'degraded' | 'stale' | 'error'

// Get history for sparkline
const history = DataQualityMonitor.getHistory('fred-data');
// [{ ts, state, count }, …]  (last 24 readings)
```

### Census API Key Setup

Issue #408 and #409 are caused by the `CENSUS_API_KEY` secret not being configured in GitHub Actions.

To set up the key:

```bash
# Interactive guided setup (requires GitHub CLI)
bash scripts/setup-census-api-key.sh

# Manual steps:
# 1. Get a free key at https://api.census.gov/data/key_signup.html
# 2. Add CENSUS_API_KEY to GitHub Settings → Secrets → Actions
# 3. Re-run: gh workflow run market_data_build.yml --repo pggLLC/Housing-Analytics
```

See `.github/WORKFLOW_TROUBLESHOOTING.md` for the full troubleshooting guide.

### WCAG 2.1 AA Compliance

All Phase 3 pages follow the governance rules established in Stage 3:

- Chart colors use `var(--chart-1)` through `var(--chart-7)` tokens only
- `--accent` token is `#096e65` (4.51:1 contrast ratio)
- All `<canvas>` elements have `role="img"` and `aria-label`
- `aria-live="polite"` regions announce filter/update events
- Touch targets are at least 44×44 CSS pixels (`.dot-wrap` class)
- Pages have `<header>`, `<main id="main-content">`, `<footer>` landmarks

---

## Acceptance Criteria

- [x] `js/legislative-tracker.js` — bill status engine with CRA impact scoring
- [x] `js/lihtc-deal-predictor.js` — enhanced with FMR, PAB cap, scenario sensitivity, CHFA context
- [x] `js/lihtc-deal-predictor-enhanced.js` — Phase 3 wrapper with PMA, affordability gap, legislative context
- [x] `js/data-quality-monitor.js` — real-time health polling and UI rendering
- [x] `housing-legislation-2026.html` — legislative tracker integration hooks
- [x] `test/test_legislative_tracker.js` — 148 tests passing
- [x] `test/test_lihtc_deal_predictor.js` — 110 tests passing
- [x] `tests/phase3-setup.js` — test harness initialization
- [x] `docs/PHASE3_IMPLEMENTATION.md` — this roadmap document
- [x] `docs/PHASE3_IMPLEMENTATION_GUIDE.md` — detailed API guide
- [x] `docs/PHASE3_PLAN.md` — epic breakdown
- [x] `scripts/setup-census-api-key.sh` — Census API key setup script
- [ ] GitHub sub-issues created for each epic (see `PHASE3_PLAN.md`)
- [ ] `CENSUS_API_KEY` secret renewed to resolve #408, #409

---

## Related Documentation

- [`docs/PHASE3_PLAN.md`](PHASE3_PLAN.md) — epic breakdown and sub-issue tracking
- [`docs/PHASE3_IMPLEMENTATION_GUIDE.md`](PHASE3_IMPLEMENTATION_GUIDE.md) — API reference
- [`docs/LIHTC_DEAL_PREDICTOR.md`](LIHTC_DEAL_PREDICTOR.md) — base predictor documentation
- [`.github/WORKFLOW_TROUBLESHOOTING.md`](../.github/WORKFLOW_TROUBLESHOOTING.md) — workflow failure guide
- [`CHANGELOG.md`](../CHANGELOG.md) — release history
