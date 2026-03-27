# Phase 3 Plan — COHO Analytics

> **Status:** In Progress · Updated 2026-03-27  
> **Epics:** #444 · #445 · #446 · #447

This document provides the breakdown of work for all four Phase 3 epics, links to sub-issues,
and tracks progress toward Phase 3 completion.

---

## Epic Overview

| # | Epic | Status | Sub-Issues |
|---|------|--------|-----------|
| [#444](https://github.com/pggLLC/Housing-Analytics/issues/444) | Legislative & CRA Expansion Tracker | 🟡 In Progress | 6 |
| [#445](https://github.com/pggLLC/Housing-Analytics/issues/445) | Enhanced LIHTC Deal Prediction Module | 🟡 In Progress | 6 |
| [#446](https://github.com/pggLLC/Housing-Analytics/issues/446) | Documentation, Testing, and Implementation Guidance | 🟡 In Progress | 4 |
| [#447](https://github.com/pggLLC/Housing-Analytics/issues/447) | Data Quality, Monitoring & Infrastructure Enhancements | 🟡 In Progress | 5 |

---

## Epic #444 — Legislative & CRA Expansion Tracker

**Objective:** Dynamic module for tracking affordable housing bills and CRA modernization.

**New in this PR:**
- `js/legislative-tracker.js` — bill status engine with LIHTC/CRA impact scoring
- `test/test_legislative_tracker.js` — 148-test suite for bill tracking module

### Sub-Issues

| Sub-Issue | Description | Status |
|-----------|-------------|--------|
| #444-1 | Implement bill status dashboard with real-time legislative updates | 🟡 Module created; UI in progress |
| #444-2 | Integrate legislative database/API sources for live bill tracking | 🔴 Planned |
| #444-3 | Build impact assessment logic for LIHTC demand and investor base | ✅ Done (`js/legislative-tracker.js`) |
| #444-4 | Develop UI for updating and annotating legislative timelines | 🔴 Planned |
| #444-5 | Integrate CRA targeting with census tract data | ✅ Done (`getCraTractTargeting()`) |
| #444-6 | Write tests and integration with market analysis tools | ✅ Done (`test/test_legislative_tracker.js`) |

**Key references:**
- [`housing-legislation-2026.html`](../housing-legislation-2026.html) — bill detail page
- [`js/cra-expansion-forecast.js`](../js/cra-expansion-forecast.js) — CRA scenario forecaster
- [`cra-expansion-analysis.html`](../cra-expansion-analysis.html) — CRA analysis page

---

## Epic #445 — Enhanced LIHTC Deal Prediction Module

**Objective:** Comprehensive LIHTC deal prediction integrating market data, FMR, QCT/DDA, and scenario analysis.

**New in this PR:**
- `js/lihtc-deal-predictor.js` enhanced with:
  - `pabCapAvailable` input — PAB volume cap analysis for 4% vs 9% selection
  - `fmrData` input — HUD FMR-based max rent analysis (`_computeFmrAlignment`)
  - `chfaHistoricalAwards` + `countyAffordabilityGap` inputs — CHFA award context
  - `scenarioSensitivity` output — equity pricing, demand signal, and saturation ranges
  - `fmrAlignment` output — bedroom-level FMR-to-AMI rent mapping
  - `chfaAwardContext` output — county award signal and QAP competitiveness note
- `test/test_lihtc_deal_predictor.js` — extended to 110 tests covering all new Phase 3 features

### Sub-Issues

| Sub-Issue | Description | Status |
|-----------|-------------|--------|
| #445-1 | Integrate demand scores and affordability gap analysis | ✅ Done (existing + enhanced) |
| #445-2 | Connect HUD FMR/AMI data and implement QCT/DDA basis boost logic | ✅ Done (`fmrData`, `_computeFmrAlignment`) |
| #445-3 | Expand 4% vs 9% LIHTC analysis (PAB cap, scenarios) | ✅ Done (`pabCapAvailable`, `_pabCapNote`) |
| #445-4 | Develop risk modeling and scenario sensitivity tools | ✅ Done (`_computeScenarioSensitivity`) |
| #445-5 | Analyze and visualize CHFA historical awards | ✅ Done (`_computeChfaAwardContext`) |
| #445-6 | Build and validate all logic branches with tests | ✅ Done (110 tests passing) |

**Key references:**
- [`js/lihtc-deal-predictor.js`](../js/lihtc-deal-predictor.js) — predictor module
- [`js/hud-fmr.js`](../js/data-connectors/hud-fmr.js) — HUD FMR data connector
- [`docs/LIHTC_DEAL_PREDICTOR.md`](LIHTC_DEAL_PREDICTOR.md) — module documentation
- [`test/test_lihtc_deal_predictor.js`](../test/test_lihtc_deal_predictor.js) — test suite

---

## Epic #446 — Documentation, Testing, and Implementation Guidance

**Objective:** Comprehensive documentation and test expansion for all Phase 3 modules.

**New in this PR:**
- `docs/PHASE3_PLAN.md` — this document
- `docs/PHASE3_IMPLEMENTATION_GUIDE.md` — implementation guide for Phase 3 features
- Extended test suite: 110 tests for LIHTC predictor + 148 tests for legislative tracker

### Sub-Issues

| Sub-Issue | Description | Status |
|-----------|-------------|--------|
| #446-1 | Update and expand implementation guides for Phase 3 features | ✅ Done (this PR) |
| #446-2 | Set up auto-generation for API/code documentation | 🔴 Planned (docs-sync.yml) |
| #446-3 | Expand unit, integration, and smoke tests for all new modules | ✅ Done (258 tests total across Phase 3 modules) |
| #446-4 | Configure CI workflow for docs sync and coverage tracking | 🟡 In Progress |

**Key references:**
- [`docs/PHASE3_IMPLEMENTATION_GUIDE.md`](PHASE3_IMPLEMENTATION_GUIDE.md) — implementation guide
- [`.github/workflows/docs-sync.yml`](../.github/workflows/docs-sync.yml) — docs CI workflow
- [`CHANGELOG.md`](../CHANGELOG.md) — release notes

---

## Epic #447 — Data Quality, Monitoring & Infrastructure Enhancements

**Objective:** Reliability, auditability, and accessibility improvements across all dashboards.

### Sub-Issues

| Sub-Issue | Description | Status |
|-----------|-------------|--------|
| #447-1 | Expand GitHub Actions monitoring and endpoint audits | 🟡 In Progress (existing workflows) |
| #447-2 | Enhance ETL/API data validations and error reporting | 🟡 In Progress |
| #447-3 | Run accessibility audits and implement WCAG 2.1 AA compliance | ✅ Done (Stage 3 audit) |
| #447-4 | Implement real-time health/quality UI indicators | 🟡 In Progress |
| #447-5 | Automated tests for all new and updated workflows | 🟡 In Progress |

**Key references:**
- [`.github/workflows/accessibility.yml`](../.github/workflows/accessibility.yml)
- [`.github/workflows/data-quality-check.yml`](../.github/workflows/data-quality-check.yml)
- [`tests/test_stage3_accessibility.py`](../tests/test_stage3_accessibility.py)

---

## CI / Workflow Issues

| Issue | Status | Resolution |
|-------|--------|-----------|
| [#408](https://github.com/pggLLC/Housing-Analytics/issues/408) Market Data Build failure | ⚠️ Open | Requires `CENSUS_API_KEY` secret renewal in Settings → Secrets |
| [#409](https://github.com/pggLLC/Housing-Analytics/issues/409) Weekly Data Sync failure | ⚠️ Open | Depends on #408 fix; re-run `run-all-workflows.yml` after key renewal |

---

## Acceptance Criteria Summary

- [x] `js/legislative-tracker.js` — bill status engine with LIHTC/CRA impact scoring
- [x] `js/lihtc-deal-predictor.js` — enhanced with PAB cap, FMR alignment, scenario sensitivity, CHFA context
- [x] `test/test_legislative_tracker.js` — 148 tests passing
- [x] `test/test_lihtc_deal_predictor.js` — 110 tests passing (up from 68)
- [x] `docs/PHASE3_PLAN.md` — this breakdown document
- [x] `docs/PHASE3_IMPLEMENTATION_GUIDE.md` — implementation guide
- [ ] GitHub sub-issues created for each epic (see epic sub-issue tables above)
- [ ] `CENSUS_API_KEY` renewed to resolve workflow failures (#408, #409)
