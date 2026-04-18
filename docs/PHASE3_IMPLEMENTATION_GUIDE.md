# Phase 3 Implementation Guide — COHO Analytics

> **Phase 3 Epics:** #444 · #445 · #446 · #447  
> **Updated:** 2026-03-27

This guide explains how to integrate and extend the Phase 3 modules added to the COHO Analytics platform.

---

## 1. Legislative Tracker (`js/legislative-tracker.js`)

### Overview

The `LegislativeTracker` module provides structured bill status data and LIHTC/CRA impact scoring for key affordable housing legislation. It replaces ad-hoc bill tracking with a queryable, testable data layer.

### Loading the Module

**Browser:**
```html
<script src="js/legislative-tracker.js"></script>
<!-- Exposed as window.LegislativeTracker -->
```

**Node.js / Test:**
```js
const tracker = require('./js/legislative-tracker');
```

### API Reference

#### `getAllBills()` → `Bill[]`
Returns all tracked bills with computed `stageProgress`, `passageProbability`, and `combinedImpactScore`.

```js
const bills = LegislativeTracker.getAllBills();
// bills[0].stageProgress    → 71  (% through legislative process)
// bills[0].passageProbability → 85 (% likelihood of passage)
// bills[0].combinedImpactScore → 8 (LIHTC+CRA impact 0–10)
```

#### `getBill(id)` → `Bill | null`
Get a single bill by ID (`'HR6644'`, `'AHCIA'`, `'ROAD'`, `'CRA-MOD'`).

#### `getBillsByTag(tag)` → `Bill[]`
Filter bills by tag. Available tags: `'LIHTC'`, `'CRA'`, `'rural'`, `'bipartisan'`, etc.

#### `getMarketImpactSummary()` → `Object`
Returns aggregate impact summary across all active bills, weighted by passage probability:
```js
{
  activeBillCount: 4,
  weightedLihtcImpactScore: 6.8,
  weightedCraImpactScore: 5.3,
  keyLihtcProvisions: [...],
  keyCraProvisions: [...],
  marketOutlook: 'Favorable — ...'
}
```

#### `getCraTractTargeting(tractType)` → `Object | null`
Returns CRA targeting analysis for a given census tract type.
- `'lmi'` — Low-to-Moderate Income (max CRA weight)
- `'distressed'` — Distressed/underserved tracts
- `'rural'` — Rural tracts (enhanced under ROAD Act)
- `'opportunity_zone'` — OZ tracts (dual benefit possible)
- `'non_lmi'` — Non-LMI tracts (limited CRA credit)

#### `getLegislativeTimeline()` → `TimelineEntry[]`
Returns chronologically ordered timeline events with projected future dates.

### Adding New Bills

Edit the `BILLS` array in `js/legislative-tracker.js`. Each bill requires:

```js
{
  id:          'UNIQUE_ID',          // string, e.g. 'HR1234'
  title:       'Full Bill Title',
  shortTitle:  'Short Name',
  stage:       STAGES.COMMITTEE,    // use a STAGES constant
  lastUpdated: '2026-MM-DD',
  summary:     'One paragraph description.',
  lihtcImpact: {
    score:       0,                 // 0–10
    description: '...',
    provisions:  ['provision 1', 'provision 2']
  },
  craImpact: null,                  // or same shape as lihtcImpact
  tags: ['LIHTC', 'CRA']
}
```

### Updating Bill Status

To update a bill's stage after a legislative event:
1. Find the bill object in the `BILLS` array
2. Update `stage` to the new `STAGES.*` constant
3. Update `lastUpdated` to today's ISO date
4. For House votes, add `houseVote: 'XXX-YY'`
5. Run `node test/test_legislative_tracker.js` to verify all tests pass

---

## 2. Enhanced LIHTC Deal Predictor (`js/lihtc-deal-predictor.js`)

### Overview

Phase 3 adds four major enhancements to the LIHTC Deal Predictor:
1. **PAB volume cap analysis** — determines if 4% execution is feasible
2. **HUD FMR alignment** — maps proposed rents to HUD Fair Market Rent benchmarks
3. **Scenario sensitivity** — equity pricing, demand, and saturation ranges
4. **CHFA award context** — historical award signals and QAP competitiveness notes

### New Input Fields

| Field | Type | Description |
|-------|------|-------------|
| `pabCapAvailable` | `boolean` | PAB volume cap pre-allocated for 4% execution |
| `fmrData` | `Object` | `{ oneBedroomFMR, twoBedroomFMR, threeBedroomFMR }` from HUD API |
| `chfaHistoricalAwards` | `number` | # of CHFA awards in county in last 5 years |
| `countyAffordabilityGap` | `number` | County affordability gap score 0–100 |

### New Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `pabCapNote` | `string \| null` | PAB status note (only for 4% recommendations) |
| `fmrAlignment` | `Object \| null` | Bedroom-level FMR-to-AMI rent mapping |
| `scenarioSensitivity` | `Object` | Equity pricing, demand, saturation ranges |
| `chfaAwardContext` | `Object \| null` | County award signal + QAP note |

### Example Usage

```js
var rec = LIHTCDealPredictor.predictConcept({
  // Existing inputs
  geoid:                '08031',  // Denver County
  pmaScore:             75,
  proposedUnits:        80,
  ami30UnitsNeeded:     25,
  competitiveSetSize:   2,
  isQct:                true,
  softFundingAvailable: 1200000,
  medianRentToIncome:   0.35,

  // Phase 3 new inputs
  pabCapAvailable:       false,    // PAB cap not yet allocated
  fmrData: {
    oneBedroomFMR:   1450,
    twoBedroomFMR:   1750,
    threeBedroomFMR: 2050
  },
  chfaHistoricalAwards:  3,
  countyAffordabilityGap: 68
});

// Core outputs (unchanged)
console.log(rec.recommendedExecution);  // '9%' | '4%' | 'Either'
console.log(rec.confidence);            // 'high' | 'medium' | 'low'

// Phase 3 new outputs
console.log(rec.pabCapNote);            // null (9% path) or PAB guidance string
console.log(rec.fmrAlignment.oneBR);    // { fmr: 1450, maxRentAt60Ami: 1334, ... }
console.log(rec.scenarioSensitivity);   // { equityPricingRange, demandSignalRange, saturationRange }
console.log(rec.chfaAwardContext);      // { countyAwardsLast5Years: 3, countyAwardSignal: 'high', ... }
```

### Integrating HUD FMR Data

Use the existing `js/data-connectors/hud-fmr.js` connector to load FMR data:

```js
// In housing-needs-assessment.html or market-analysis.html
const fmrData = await HudFmr.getFmrForCounty(geoid);
const inputs  = {
  ...existingInputs,
  fmrData: {
    oneBedroomFMR:   fmrData.oneBedroomFMR,
    twoBedroomFMR:   fmrData.twoBedroomFMR,
    threeBedroomFMR: fmrData.threeBedroomFMR
  }
};
const rec = LIHTCDealPredictor.predictConcept(inputs);
```

### PAB Cap Status

PAB volume cap status must be obtained from CHFA directly. For automated tracking:
- CHFA publishes annual PAB cap allocation schedules: https://www.chfainfo.com
- Cap availability typically known by Q1 each year
- Store in a config or data file keyed by county FIPS for automated lookup

---

## 3. CI Workflow Failures (#408, #409)

### Root Cause

Both failures stem from an expired or missing `CENSUS_API_KEY` GitHub Actions secret.

### Resolution Steps

1. Obtain a new Census API key: https://api.census.gov/data/key_signup.html
2. Navigate to: Repository → Settings → Secrets and variables → Actions
3. Update the `CENSUS_API_KEY` secret with the new key value
4. Re-run the `market_data_build.yml` workflow:
   ```
   gh workflow run market_data_build.yml --repo pggLLC/Housing-Analytics
   ```
5. Verify the workflow passes, then re-run `run-all-workflows.yml` to resolve #409

### Preventing Future Failures

The `market_data_build.yml` workflow already includes a pre-flight key validation step.
To add key expiry alerting, consider adding a scheduled check in `daily-audit-system.yml`
that tests the Census API endpoint and creates an issue if it returns 403.

---

## 4. Testing Phase 3 Modules

All Phase 3 unit tests use the same pattern as existing tests (plain Node.js, no test runner dependency):

```bash
# Run all Phase 3 unit tests
node test/test_lihtc_deal_predictor.js
node test/test_legislative_tracker.js

# Run existing test suite alongside Phase 3 tests
node test/test_chfa_award_predictor.js
node test/test_soft_funding_tracker.js
node test/smoke-market-analysis.js
```

### Test Coverage Summary

| Module | Tests | Status |
|--------|-------|--------|
| `lihtc-deal-predictor.js` | 110 | ✅ All passing |
| `legislative-tracker.js` | 148 | ✅ All passing |
| `chfa-award-predictor.js` | (existing) | ✅ Unchanged |
| `soft-funding-tracker.js` | (existing) | ✅ Unchanged |

---

## 5. Acceptance Criteria Checklist

### Epic #444 — Legislative & CRA Expansion Tracker
- [x] Bill status module created (`js/legislative-tracker.js`)
- [x] Impact scoring for LIHTC demand and CRA investor base
- [x] CRA tract targeting integration
- [x] Legislative timeline data structure
- [x] Unit tests (148 passing)
- [ ] Live data feed integration (planned)
- [ ] Timeline annotation UI (planned)

### Epic #445 — Enhanced LIHTC Deal Prediction Module
- [x] PAB cap analysis (4% vs 9% selection)
- [x] HUD FMR data integration
- [x] Scenario sensitivity analysis
- [x] CHFA historical award context
- [x] QCT/DDA basis boost logic (existing, enhanced)
- [x] Unit tests extended to 110 tests

### Epic #446 — Documentation, Testing, and Implementation Guidance
- [x] `docs/PHASE3_PLAN.md` — Phase 3 breakdown
- [x] `docs/PHASE3_IMPLEMENTATION_GUIDE.md` — this guide
- [x] Unit tests for all new Phase 3 modules
- [ ] Auto-generated API documentation (planned)
- [ ] CI coverage reporting (planned)

### Epic #447 — Data Quality, Monitoring & Infrastructure
- [x] WCAG 2.1 AA accessibility compliance (Stage 3)
- [x] Contrast audit CI workflow
- [ ] ETL validation enhancements (planned)
- [ ] Real-time health UI indicators (planned)
- [ ] Workflow test automation expansion (planned)
