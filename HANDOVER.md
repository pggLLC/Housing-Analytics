# Codex Handover — May 2026 Session

**Generated**: 2026-05-25 · **Last session merges**: PRs #881-#890

This document is the entry point for a fresh reviewer (Codex or human) picking up the repository. It indexes the recent session's changes, points to audit documents for the two biggest analytical surfaces, and explains how to verify everything still works.

---

## TL;DR — what just landed

Ten PRs merged in May 2026, organized as four threads:

### Thread A — empty/broken Snapshot panels populated

| PR | What |
|---|---|
| **#881** | Populate empty AMI Gap panel · fix BLS county lookup (was always showing "statewide median") · clarify Affordability calc (was rent-based with mortgage label) · refactor Action Plan checklist handler (one-item update vs full-state replay) · hyperlink all source labels |
| **#888** | Wire OsmAmenities into PMA Site Summary (was always showing "—") |
| **#889** | Roll up severe_cost_burden_rate / poverty_rate / unemployment_rate that aggregateAcs() was dropping; strengthen demand-score blend |

### Thread B — AMI Gap panel rebuild (7-band view)

| PR | What |
|---|---|
| **#882** | Expand AMI Gap from 3 → 7 bands (30/40/50/60/70/80/100) with high-contrast heatmap; show both cumulative AND per-tier views |
| **#883** | Document HUD CHAS Cost Burden chart's 4-tier limit (can't synthesise 7 tiers); link to AMI Gap panel for finer view |
| **#890** | LIHTC concept recommender — output AMI × bedroom matrix (replaces two flat distributions) with CHFA-preference skew |

### Thread C — Methodology corrections

| PR | What |
|---|---|
| **#884** | Owner Housing Cost Burden — ETL fix to populate SMOCAPI bins in cache · CHAS 3-bin fallback renderer (works today before next ETL run) |
| **#885** | Housing Needs Scorecard v2 — percentile-normalised 4-component composite (replaces 45/30/25 thresholded blend) — includes owner cost burden, resort-aware, HUD-WCN-aligned |
| **#887** | Target Vacancy fix — use ACS active-market subset (DP04_0004 + 0005) bounded 5-7% instead of inheriting observed total vacancy (which pinned 40 counties to the 12% cap) |

### Thread D — Repo hygiene + tooling

| PR | What |
|---|---|
| (this branch) | Repo cleanup — removed 4 IDE backup duplicates · added .gitignore rule · added Esri satellite tile layer · wrote audit docs · built QA/QC script |

---

## How to verify (TL;DR)

```bash
# Schema + unit tests (~5 seconds, no network)
npm run test:qa-recent -- --only schema
npm run test:qa-recent -- --only units

# Full sweep including external URL liveness + headless browser smoke test
npm run test:qa-recent
```

The script ([`test/qa-recent-changes.js`](test/qa-recent-changes.js)) covers all four QA categories the user requested:

1. **Schema** — JSON file integrity (6 files: CHAS, ACS AMI gap, econ indicators, ACS tracts, LIHTC assumptions, OSM amenities)
2. **Units** — pure-function tests for the LIHTC recommender (AMI matrix shape, row-sum invariant), Site Selection Score (6/6 vs 5/6 dimensions, opportunity-band thresholds), and HNA utils (rentBurden30Plus fallback chain)
3. **URLs** — re-runs `scripts/audit/source-url-sweep.mjs` against the full data-source inventory (uses the allow-list updates from PR #881)
4. **Smoke** — headless browser via Puppeteer (optional; install with `npm i --save-dev puppeteer` or skip with `--skip-puppeteer`): loads HNA page, selects Delta County, verifies rent burden + AMI gap + scorecard composite all populate

The script outputs a colored pass/fail report and exits non-zero on any failure.

---

## Two methodology deep-dives

Both audits document what's working, what's broken/stubbed, and a prioritised fix list:

| Document | Covers |
|---|---|
| [`docs/audits/PMA-METHODOLOGY-AUDIT.md`](docs/audits/PMA-METHODOLOGY-AUDIT.md) | PMA scoring (both the 5-dimension PMA Score and the 6-dimension Site Selection Score), buffer-radius design choices, loaded-but-unused data, satellite tile layer, infrastructure feasibility stub |
| [`docs/audits/DEAL-CALCULATOR-AUDIT.md`](docs/audits/DEAL-CALCULATOR-AUDIT.md) | LIHTC deal predictor — default assumptions vintage, geographic cost multipliers, capital stack model gaps (perm-debt sizing), confidence badge opacity, soft-funding gaps |

Both audits surface fixes prioritised as 🔴 must-fix / 🟡 should-fix / 🟢 nice-to-have so a reviewer can triage quickly.

---

## Map of recent code touches

```
js/
├── hna/
│   ├── hna-renderers.js          ← Economic Indicators, BLS row, Affordability, AMI Gap, Scorecard v2,
│   │                                Owner Cost Burden, Action Plan, Action Plan handler refactor
│   ├── hna-controller.js         ← ACS AMI Gap load, Owner Cost Burden re-render, live-fetch trigger
│   ├── hna-utils.js              ← rentBurden30Plus 3-tier fallback chain, AFFORD constants
│   ├── hna-comparison.js         ← Owner burden source switch (CHAS owner_cb30 vs ACS SMOCAPI)
│   └── housing-need-projector.js ← Recommended AMI Distribution — 7-band presets + heatmap colors
├── lihtc-deal-predictor.js       ← AMI × bedroom matrix + CHFA-preference skew tables
├── pma-ui-controller.js          ← Renders AMI × bedroom matrix table
├── market-analysis.js            ← PMA scoring + aggregateAcs() new fields + satellite tile layer
├── market-analysis/
│   └── site-selection-score.js   ← 6-dimension Site Selection Score (no changes this session)
└── data-source-inventory.js      ← bls-qcew → bls-laus rename
scripts/
└── hna/build_hna_data.py         ← SMOCAPI bin fetch (PR #884) + target-vacancy ACS active-market (PR #887)
data/
├── hna/chas_affordability_gap.json     ← 100% county coverage of pct_renter_cb30 + pct_owner_cb30
├── co_ami_gap_by_county.json           ← ACS-derived 7-band gap (already existed, now wired)
└── co-county-economic-indicators.json  ← BLS LAUS source (replaces deprecated QCEW)
docs/audits/
├── PMA-METHODOLOGY-AUDIT.md            ← NEW
└── DEAL-CALCULATOR-AUDIT.md            ← NEW
test/
└── qa-recent-changes.js                ← NEW — QA/QC verification script
```

---

## Known open issues (for Codex follow-up)

Highest-priority follow-ups identified by the audits:

### 🔴 Must-fix

1. **Infrastructure Feasibility utility-capacity stub** ([pma-infrastructure.js:100](js/pma-infrastructure.js)). Every site currently scores 50% sewer/water headroom — `utility_capacity_co.geojson` exists as a map layer but `DataService.fetchUtilityCapacity()` was never connected. Either wire it or remove the section from the composite.
2. **Capital stack perm-debt sizing** (deal predictor). "First Mortgage" appears as a line item but is computed as `totalCost - equity - softFunding` (the gap), not a DSCR-sized loan against projected NOI. Silently produces unfundable deals when the gap exceeds rent-supportable debt.
3. **CHAS Table 9 ETL axis-misread** (scripts/fetch_chas.py). 25 of 64 rural CO counties currently produce "0 cost-burdened renters at ≤30% AMI" because the ETL reads CHAS Table 9 as burden-first when HUD documents it as income-first. The HNA renderer has a defensive ACS-derived fallback (PR #881), but the ETL fix is the real solution. Already spawned as a separate task.

### 🟡 Should-fix

4. Lower 4% deal min-units threshold from 100 → 75, or make it county-dependent
5. Add OpEx-by-concept-type matrix (currently flat $8,500/unit statewide)
6. Default PMA delineation to Hybrid instead of Buffer (Buffer is acknowledged as "screening only")
7. Connect EPA Smart Location Database to Site Selection Access dimension (data loaded, not used)
8. Surface concept-selection rationale with real signals instead of the "Family is the default" fallback string
9. Soft funding by county — fill in remaining counties in `lihtc-assumptions.json`

### 🟢 Nice-to-have

10. Back-test scoring weights against CHFA awarded LIHTC projects
11. Quarterly refresh process for `data/policy/lihtc-assumptions.json`
12. Cap-rate-by-county model (currently no cap rate concept anywhere)
13. Barriers-aware buffer mode (subtract `natural_barriers_co.geojson` polygons)

---

## Things deliberately NOT touched this session

- Persona toggle in header (was removed by PR #814 before this session)
- The Glossary, Insights, Explore, Scoping nav surfaces
- The compliance dashboards (Prop 123, CHFA PMA Checklist)
- The Colorado Deep Dive map (separate page from market-analysis)
- The HNA Comparative Analysis page
- Any data ETL beyond the build_hna_data.py SMOCAPI + target-vacancy fixes

---

## Honesty notes baked into the codebase

The repo has unusually candid disclaimers — worth preserving:

- **PMA buffer method**: explicitly labelled "screening only — NOT a professionally delineated PMA" in [market-analysis.html:154](market-analysis.html)
- **Site Score feasibility**: doc-block at [site-selection-score.js:225](js/market-analysis/site-selection-score.js) says *"These scores are directional flags from public data. They do NOT replace Phase I ESA, geotechnical survey, or FEMA LOMA determination."*
- **"Soil score"**: actually CDC EJI environmental burden, NOT geotechnical bearing capacity — disclosed in doc-block
- **LIHTC predictor**: top-of-file disclaimer says *"does not constitute underwriting, legal, or investment advice"*
- **HNA Scorecard v2**: inline `<details open>` disclosure exposes every formula + source citation
- **Owner Cost Burden chart**: orange disclosure when fallback to CHAS 3-bin (vs ACS 5-bin), with explicit "will switch after next ETL refresh" note

If you tighten any methodology, keep the proportionate disclosure intact.

---

## Branch + worktree state

At handover:
- `main` is at the merge commit for PR #890
- Active worktree: `.claude/worktrees/magical-payne-a80fc5` still references `main` — safe to remove if not needed
- All session branches squash-merged and auto-deleted

Run `git branch -a` to see current state.

---

## Open questions for the next reviewer

1. **Calibration**: are the scoring weights (PMA 30/25/15/15/15, Site Score 25/20/15/15/15/10, Scorecard v2 equal-quartered) calibrated against any historical outcomes? See audits for the back-test proposal.
2. **Methodology versioning**: should the in-page disclosures include a methodology version number so users seeing different scores over time know what changed? Some panels already do (e.g. "v2 methodology" in Scorecard).
3. **Refresh cadence**: `lihtc-assumptions.json` is on a quarterly target. Is that automated? Where does it get pulled from?

---

*Generated as part of the May 2026 session handover. For questions about specific changes, see the individual PR descriptions on GitHub — they were written verbosely so they could function as standalone references.*
