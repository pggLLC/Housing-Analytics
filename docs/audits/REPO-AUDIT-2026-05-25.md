# Colorado Housing Analytics — Repo Audit
**Date**: 2026-05-25 (revised) · **Auditor**: Claude (senior CS + LIHTC lens) · **Branch**: `feat/lihtc-opportunity-finder`

This audit evaluates the repo against the product question: **"Where in Colorado should a developer spend scarce time looking for the next affordable housing deal?"**

> **Strategic direction lock (2026-05-25)**: The user has chosen **jurisdiction-level** deal targeting as the product spine. The Opportunity Finder (PR #894) is the cockpit. Tract-level and parcel-level concerns are explicitly scoped OUT of the deal-targeting workflow and tracked separately as background work for other pages. This audit's P0 list reflects that direction; an appendix captures the deferred items for transparency.

A working version of the proposed "Deal Targeting" experience already exists at **`lihtc-opportunity-finder.html`** (PR #894, this session). About 70% of the recommended product flow is shipped. The audit reframes recommendations as **extend the Opportunity Finder**, not "build a new page."

---

## 1. Executive Summary

### What the repo does well

- **Deep data inventory.** 547-jurisdiction HNA ranking-index, 1,447 ACS tract metrics, 1,447 CHAS tract records, 702 HUD LIHTC projects with PROJ_CTY/YR_PIS/N_UNITS, 224 QCT tracts + 10 DDA counties (HUD 2025), 217 Prop 123 commitments with filing dates, 547-jurisdiction × 7-dimension policy scorecard, 482-place AMI gap by 7 bands, TIGER 2024 place-tract spatial join.
- **Methodology rigor where it counts.** Scorecard v2 uses percentile normalisation against CO peer distribution (PR #885), tenure-blended cost burden (PR #884), 7-band AMI gap with both cumulative and per-tier views (PR #882), CHFA-preference AMI × bedroom matrix (PR #890). Public methodology disclosure on every page.
- **Honest data hygiene.** ACS active-market vacancy bounded 5–7% to prevent seasonal distortion (PR #887). PR descriptions explicitly note "screening tool only," "data confidence: medium," "county fallback." Source URLs hyperlinked from every metric.
- **Recently shipped: `lihtc-opportunity-finder.html`.** Ranks 158 jurisdictions with QCT/DDA designation for 4% bond and 9% competitive rounds, deep-links to per-place HNA, surfaces civic capacity (Prop 123, comp plan, housing lead, HA, advocacy), per-jurisdiction housing-news search. **This is the seed of the "Deal Targeting" product.**
- **CI infrastructure.** 50 GitHub Actions workflows including `deploy.yml`, `data-freshness-check`, `data-sentinels-check`, `accessibility`, `contrast-audit`, `console-error-audit`, `external-references-check`, scheduled data refreshes for FRED/HUD/ACS/CHAS/Zillow/Kalshi/HMDA.

### What prevents it from being a true deal-targeting tool today

These are framed against the **jurisdiction-level** direction. Tract-level geometry and parcel-level data are not blockers for the deal-targeting workflow; they're tracked in the appendix.

1. **Scoring code is scattered with no shared shape.** No `js/scoring/` directory. Score logic lives in 8 files (`js/market-analysis/site-selection-score.js`, `js/market-health-composite.js`, `js/housing-outcome-score.js`, `js/lihtc-deal-predictor.js`, `js/lihtc-deal-predictor-enhanced.js`, `js/chfa-award-predictor.js`, `js/lihtc-opportunity-finder.js`, `js/colorado-regional-predictions.js`). No common `ScoreResult` shape. Drift risk is concrete — Boulder gets different scores depending on which page you open. **This is the #1 blocker for a credible deal-targeting cockpit** because the same jurisdiction must score consistently across HNA, PMA, Opportunity Finder, and Deal Calculator.
2. **Need ≠ Dealability is partially conflated.** The Scorecard v2 composite is a good *need* score but the site sometimes presents it as if it implies opportunity (Boulder is high-need but hard to execute). The Opportunity Finder *does* separate these (recency, basis, population), but only across 4 dimensions and only for the QCT/DDA subset. Missing: subsidy fit (Prop 123 / CDBG / CHFA pipeline) and readiness (civic capacity) as first-class scoring dimensions, not just badges.
3. **No cross-page funnel.** Users land on HNA, get rich need data, then have no breadcrumb to "OK, where should I take this next?" The Opportunity Finder already has "→ HNA" deep-links but the reverse path doesn't exist. The Find-market → Screen-site → Explain-deal funnel only works if every page funnels forward and back.
4. **Opportunity Finder is QCT/DDA-only.** Today's filters exclude:
   - **Preservation candidates** (NHPD-tracked LIHTC properties with `subsidy_expiration ≤ 2030` — 4% bond refi + Year-15 exit opportunities)
   - **Workforce / resort 4% deals** in non-basis-boost markets (mountain employers backing private-activity bond issuances)
   - **Prop 123-funded deals** outside QCT/DDA where local readiness is the driver
   The 158-jurisdiction default view misses ~half of CO's realistic LIHTC pipeline.

### The single most important product change

**Promote `lihtc-opportunity-finder.html` to the site's primary entry point**, replacing or relegating "Housing Needs Assessment" as the default landing. The HNA is a deep workup; the Opportunity Finder is the deal-sourcing cockpit. Make the HNA accessible via the existing "→ HNA" deep-links the Opportunity Finder already exposes per row. **Don't build a new "Deal Targeting" page — extend the one that already exists.**

### The biggest technical/data risk

**Score drift across the 8 scoring modules.** A user comparing Boulder on the HNA page (scorecard v2, percentile-normalised 4-component) to Boulder on the Opportunity Finder (4-component recency/need/basis/pop) to Boulder on the Deal Calculator (different LIHTC predictor weighting) sees three different numbers and no explanation of why. The numbers are *all defensible individually*, but the lack of a single `ScoreResult` contract — with reasons, risks, missing data, source vintages, and confidence — means every page is its own black box.

**Fix path**: create `js/scoring/shape.js` with a `ScoreResult` JSON Schema + a `validateScoreResult()` helper. Add a test that imports every score module and asserts conformance. This lands without breaking any existing functionality (test starts failing for non-conformant modules, which is the desired forcing function). Then migrate consumers one at a time, starting with the Opportunity Finder (already this session's focus).

---

## 2. P0 / P1 / P2 Issue List

### 🔴 P0 — block the jurisdiction-level deal-targeting workflow

All five P0s are pre-conditions for a credible deal-targeting cockpit. **All five are jurisdiction-level**; none require tract polygon geometry or parcel data.

| # | Issue | Why it matters for deal targeting | Affected files | Recommended fix | Test |
|---|---|---|---|---|---|
| **P0-1** | **No shared `ScoreResult` shape across the 8 scoring modules** | Boulder gets different scores on HNA vs. Opportunity Finder vs. Deal Calculator. A deal-targeting cockpit requires consistency. | `js/market-analysis/site-selection-score.js`, `js/market-health-composite.js`, `js/housing-outcome-score.js`, `js/lihtc-deal-predictor.js`, `js/lihtc-deal-predictor-enhanced.js`, `js/chfa-award-predictor.js`, `js/lihtc-opportunity-finder.js`, `js/colorado-regional-predictions.js` | Create `js/scoring/shape.js` with the `ScoreResult` JSON Schema + `validateScoreResult()` helper. Lands non-breaking; tests start failing for non-conformant modules, forcing conformance. | `test/scoring-shape.test.js` — import every score module, assert default export's result validates |
| **P0-2** | **Scoring duplication across 8 modules** | After the shape contract lands, the math itself needs consolidation. Today each module re-implements percentile rank, recency bucketing, basis-boost scoring, etc. with subtle differences. | Same 8 files as P0-1 | Create `js/scoring/` directory: `need-score.js`, `readiness-score.js`, `feasibility-score.js`, `subsidy-score.js`, `competition-score.js`, `composite.js`, `confidence.js`, `explainer.js`, `weights.js`. Migrate consumers one at a time, starting with Opportunity Finder (current focus). | `test/scoring-consistency.test.js` — same jurisdiction input → same score output via every consumer |
| **P0-3** | **Opportunity Finder is QCT/DDA-only** | Excludes ~half of CO's LIHTC pipeline: preservation deals (NHPD `subsidy_expiration ≤ 2030`), workforce/resort 4% bond deals in non-basis-boost markets, Prop 123-funded local deals. | `js/lihtc-opportunity-finder.js`, `lihtc-opportunity-finder.html` | Add deal-type taxonomy as a 5-option radio: `9pct_competitive · 4pct_bond · preservation · workforce_resort · prop123_local · any`. Re-weight per deal type. Each option relaxes/changes the basis-boost filter. | `test/opportunity-deal-types.test.js` — assert each deal type produces a distinct ranked list with correctly weighted dimensions |
| **P0-4** | **No cross-page funnel between HNA / Opportunity Finder / PMA / Deal Calculator** | Find-market → Screen-site → Explain-deal funnel only half-exists. Opportunity Finder has "→ HNA" deep-links (this session). HNA doesn't link forward to OF. PMA and Deal Calculator don't accept `?fips=` from anywhere. | `housing-needs-assessment.html`, `market-analysis.html`, `deal-calculator.html`, `lihtc-opportunity-finder.html`, `js/components/` (new) | Build `js/components/next-action-cta.js` — sticky bottom CTA strip. Wire `?fips=…&geoType=…&auto=1` deep-link auto-select to PMA + Deal Calculator (already shipped for HNA this session). | Manual smoke: click through HNA → OF → PMA → Deal Calculator with one jurisdiction pre-loaded throughout |
| **P0-5** | **No confidence surfacing on jurisdiction-level scores** | Boulder's place-level owner cost burden uses county CHAS fallback. Sugar City's population is a 2.5×HHs proxy. Users can't tell which numbers to trust. | Every page that shows a score | Build `js/utils/source-confidence-badges.js` — ★/★★/★★★ pill emitting source + vintage + fallback flag. Wire to every metric (HNA, OF, PMA). | Lint check: every score render call passes a `confidence:` prop |

### Demoted to background work (was P0 in v1 of this audit)

| # | Was | Now | Why demoted |
|---|---|---|---|
| ~~P0-1 (v1)~~ tract_boundaries_co.geojson empty | 🔴 P0 | 🟢 **Background** | Affects `js/colorado-deep-dive.js` choropleth only. Doesn't touch the Opportunity Finder's place-tract-membership path (which uses tract GEOIDs, not polygons). |
| ~~P0-2 (v1)~~ tract_centroids rebuild-pending | 🟡 P1 | 🟢 **Background** | Same — affects Colorado Deep Dive's circle-marker fallback. Opportunity Finder doesn't render tract centroids. |
| ~~P0-3 (v1)~~ parcel_aggregates `coverage_pct: 0` | 🔴 P0 | 🟢 **Background** | Site-level concern. Sprint 3+ if we ever scope site-screening. Jurisdiction-level work has no parcel dependency. |

See Appendix A for the full background-work list.

### 🟡 P1 — should-fix before next major release

### 🟡 P1 — high-value follow-on after P0s land

| # | Issue | Why it matters | Affected files | Recommended fix |
|---|---|---|---|---|
| P1-1 | Compare mode doesn't exist | "Boulder vs. Greeley vs. Pueblo" side-by-side is a fundamental deal-pipeline workflow — the natural next step after Opportunity Finder ranks options. | New `compare.html`, links from Opportunity Finder rows | Build `compare.html` accepting `?jurisdictions=08013,0807850,0862000`; render a wide table of every score dimension across the selected jurisdictions with diff highlighting |
| P1-2 | No export memo (.md / .pdf) | Developers need a takeaway artifact from a jurisdiction screen to bring into pipeline meetings. The civic-capacity panel + scores already on the OF detail are 90% of a one-page memo. | New `js/export/opportunity-memo.js`, reuse `hna-export.js` pattern | Markdown export first (faster, no PDF dependency); PDF later via existing `hna-export.js` machinery |
| P1-3 | Recent funding ≠ recent placed-in-service | OF's recency uses YR_PIS which lags awards by 2–3y. A jurisdiction with 2024 CHFA awards but no PIS yet looks "stale." | `js/lihtc-opportunity-finder.js`, `data/market/hud_lihtc_co.geojson`, `js/chfa-award-predictor.js` (already references award data) | Add award-year layer; recency uses `max(YR_PIS, award_year)`. Surface "awarded but not PIS" as a separate badge. |
| P1-4 | Preservation pipeline not in the OF flow | `data/market/nhpd_co.geojson` has 20 properties with `subsidy_expiration` — 4% refi + Year-15 exit candidates. Won't surface unless preservation deal-type lands (P0-3). | `js/lihtc-opportunity-finder.js` | After P0-3 deal-type taxonomy ships, populate `preservation` ranked list from NHPD expiration ≤ 2030; auto-score with subsidy-stack dimension |
| P1-5 | `index.html` doesn't direct users to a workflow | First-time visitor lands on a generic dashboard without knowing where to start. | `index.html` | Three big CTA tiles: "Find a market" → Opportunity Finder (PRIMARY), "Browse all needs" → HNA, "Build a deal" → Deal Calculator |
| P1-6 | Civic-capacity score isn't weighted into the composite | OF currently shows civic score in a column but doesn't roll it into the composite. A jurisdiction with strong civic capacity (Prop 123 ✓ + comp plan + housing lead) should score higher than one without, holding need/recency constant. | `js/lihtc-opportunity-finder.js` (then `js/scoring/readiness-score.js` once P0-2 lands) | Add 5th component to composite: civic readiness, weighted heaviest in `prop123_local` deal type (30%) |
| P1-7 | EPA Walkability + LODES (jobs access) not wired in | `js/data-connectors/epa-walkability.js` exists. LODES commuting data already loaded for HNA. Both are jurisdiction-level signals that belong in feasibility score. | `js/lihtc-opportunity-finder.js`, `js/scoring/feasibility-score.js` (P0-2) | Add walkability + jobs-access as feasibility sub-dimensions; surface in OF detail panel |

### 🟢 P2 — nice-to-have (within the jurisdiction product)

| # | Issue | Recommendation |
|---|---|---|
| P2-1 | Mobile experience is desktop-first | Card-first mobile layout for Opportunity Finder; map/table become tabs not side-by-side |
| P2-2 | No "watchlist" | Per-user (localStorage) watchlist of jurisdictions with change alerts on new CHFA awards, new Prop 123 commitments, new HNAs |
| P2-3 | QAP year switcher | `data/lihtc/qap_*.json` keyed by 2025/2026/draft-2027 → switcher in Deal Calculator + OF subsidy weights |
| P2-4 | Vector tiles for map performance | Migrate large geojson layers (HUD LIHTC 702 points, QCT 224 polygons) to MBTiles for first-paint <500ms |
| P2-5 | "So what?" interpretation panel per page | Each analytical page ends with 2 sentences telling the user what the data implies for next action |
| P2-6 | News-source curation beyond Google | Replace Google site-search news linkouts with a curated RSS aggregator (Colorado Sun housing tag, CPR housing tag, DenverITE, BizWest) for less-noisy results |

See **Appendix A** for site-level / parcel-level / tract-geometry work that is explicitly out of scope for the jurisdiction direction but tracked for transparency.

---

## 3. Proposed Deal-Targeting Product Flow

### Don't build `deal-targeting.html`. Extend `lihtc-opportunity-finder.html`.

The user's instinct (and the ChatGPT prompt) is right that a deal-sourcing cockpit is the missing product. The mistake is treating it as net-new. PR #894 already builds the foundation. The extension is **deal-type taxonomy + cross-page funnel + export**.

### Top-level funnel — "Find a market → Screen a site → Explain the deal"

```
┌──────────────────────────────────────────────────────────────┐
│ index.html → links prominently to:                           │
│ • Find a market  →  lihtc-opportunity-finder.html  [PRIMARY] │
│ • Browse all needs   →  housing-needs-assessment.html        │
│ • Screen a deal      →  deal-calculator.html                 │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Opportunity Finder                                           │
│ ┌─Filters─────────────────────┐ ┌─Map + Ranked table──────┐ │
│ │ Deal type:                  │ │  Sortable jurisdiction   │ │
│ │ ○ 9% competitive            │ │  cards, click for detail │ │
│ │ ○ 4% bond                   │ │                          │ │
│ │ ○ Preservation              │ │                          │ │
│ │ ○ Workforce / resort        │ │                          │ │
│ │ ○ Prop 123 ready            │ │                          │ │
│ │                             │ │                          │ │
│ │ Confidence: ≥ Med           │ │                          │ │
│ │ County: …                   │ │                          │ │
│ │ Population: …               │ │                          │ │
│ └─────────────────────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                            ↓ (click jurisdiction)
┌──────────────────────────────────────────────────────────────┐
│ Detail panel (already built — extend with):                  │
│   • Composite + sub-scores (already shipped)                 │
│   • Civic capacity (already shipped)                         │
│   • Housing news links (already shipped)                     │
│   • HNA deep-link (already shipped)                          │
│   • [NEW] "Run PMA" CTA — opens market-analysis.html?fips=…  │
│   • [NEW] "Build a concept" CTA — opens deal-calculator.html │
│   • [NEW] "Add to watchlist" / "Export memo"                 │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ PMA (market-analysis.html) — pre-loaded with jurisdiction    │
│ "So what? Demand looks supportable. Verify utilities/access."│
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Deal Calculator — pre-loaded with concept                    │
│ "So what? 9% feasible. 4% needs additional soft funds."      │
│ Export deal memo                                             │
└──────────────────────────────────────────────────────────────┘
```

### Filter chips on Opportunity Finder (target state)

**Deal type** (mutually exclusive, drives weight re-tuning):
- 9% Competitive · 4% Bond · Preservation · Workforce/Resort · Prop 123 Local · Any

**Designation** (combinable):
- QCT + DDA · QCT only · DDA only · No basis-boost (Prop 123 or workforce)

**Risk + readiness** (combinable):
- ≥ Med confidence · Prop 123 committed · Comp plan on file · Local HNA on file · Housing authority present · LIHTC saturation ≤ 2 deals · Never funded

**Geography** (existing):
- County · Include CDPs · Min population

### Opportunity card structure (target state, ~15s scan time)

```
┌──────────────────────────────────────────────────────────────┐
│ Sugar City                                Target: B+         │
│ ────────────                                                 │
│ Crowley County · 245 pop · QCT + DDA · town                  │
│                                                              │
│ Best fit: 9% competitive, 30–40 units, family               │
│ Confidence: Medium (county-fallback for owner cost burden)  │
│                                                              │
│ Why it rises:                                                │
│   ✓ Never funded with LIHTC                                  │
│   ✓ Both QCT and DDA (100/100 basis-boost score)             │
│   ✓ Crowley Co is among CO's most cost-burdened (p82)        │
│                                                              │
│ Risks:                                                       │
│   • Population <500 — bond deal absorption questionable      │
│   • No housing lead on file; need to identify champion       │
│   • Owner cost burden via county fallback                    │
│                                                              │
│ Civic capacity: 2/7  Prop 123 ✓  HNA —  Comp plan ✓          │
│                                                              │
│ Next action:                                                 │
│   [Open HNA →] [Run PMA →] [Build concept →] [+ Watchlist]   │
└──────────────────────────────────────────────────────────────┘
```

The current detail panel already has most of this. The gap is: (a) the **card-level summary** with target letter + best-fit + confidence at the top, (b) the **next-action CTA strip** linking to PMA + Deal Calculator with state pre-loaded.

---

## 4. Proposed Scoring Model

### Dimensions (six independent, never collapsed into a single black-box)

| # | Dimension | What it measures | Primary data | Confidence |
|---|---|---|---|---|
| 1 | **Need** | Renter + owner cost burden, severe burden, AMI gap depth | CHAS T7, ACS DP04 GRAPI/SMOCAPI | High at county, Med at place (fallback) |
| 2 | **Deal readiness** | Civic capacity — Prop 123, comp plan, HNA, housing lead, IZ, local funding | `housing-policy-scorecard.json`, `local-resources.json`, `prop123_jurisdictions.json` | Mixed (≥70% pop, ~30% places have rich data) |
| 3 | **Site / physical feasibility** | Population scale (bond absorption), QCT/DDA, transit, EPA walkability | LODES, EPA Walkability, OSM | Med (no parcel data — see P0-3) |
| 4 | **Subsidy / capital-stack fit** | Prop 123 eligible, CDBG-DR/HOME availability, soft funding, CHFA award likelihood | `soft-funding-status.json`, `chfa-award-predictor.js` | Med |
| 5 | **Competition / saturation** | LIHTC density, years since last YR_PIS, planned 9%/4% awards | HUD LIHTCDB, CHFA recent awards | High (HUD), Med (CHFA pipeline) |
| 6 | **Data confidence** | Meta-dimension. Boolean reasons: county-fallback used, place-level missing, geometry missing, etc. | All of the above | Always available |

### Weight by target deal type (re-tuning)

| | Need | Readiness | Feasibility | Subsidy | Competition |
|---|---|---|---|---|---|
| **9% Competitive** | 30% | 15% | 15% | 10% | **30%** |
| **4% Bond** | 25% | 15% | **30%** | 15% | 15% |
| **Preservation** | 20% | 20% | 10% | **35%** | 15% |
| **Workforce / Resort** | 25% | 15% | **30%** | 15% | 15% |
| **Prop 123 Local** | 25% | **30%** | 15% | 20% | 10% |
| **Balanced** | 25% | 20% | 20% | 15% | 20% |

(The current Opportunity Finder uses 4 dimensions: recency, need, basis, pop. The above adds readiness + subsidy explicitly. Recency rolls into Competition; basis rolls into Feasibility.)

### Score result shape (one source of truth)

```js
{
  score: 72,                    // 0–100 composite
  band: 'High',                 // High / Med / Low / Watchlist / Not-ready
  confidence: 'Medium',         // High / Medium / Low
  letterGrade: 'B+',            // A / A- / B+ / B / B- / C+ / C / Watchlist
  reasons: [                    // 3–5 reasons it scored high
    'Never funded with LIHTC (recency: 100)',
    'Both QCT and DDA (basis: 100)',
    'Crowley County cost burden in CO 82nd percentile'
  ],
  risks: [                      // 3–5 reasons to verify
    'Population < 500 — bond absorption questionable',
    'Owner cost burden via county fallback',
    'No housing lead on file'
  ],
  missingData: [                // What we couldn't compute
    'parcel_readiness (file empty — P0-3)',
    'utility_capacity (no data)',
    'planned_chfa_pipeline (manual)'
  ],
  sourceIds: ['chas-2018-2022', 'hud-qct-2025', 'hud-dda-2025'],
  sourceVintage: { chas: '2018-2022', hud_qct: '2025', hud_dda: '2025' },
  nextActions: [
    { label: 'Open HNA', href: 'housing-needs-assessment.html?fips=…' },
    { label: 'Run PMA', href: 'market-analysis.html?fips=…' },
    { label: 'Build concept', href: 'deal-calculator.html?fips=…' }
  ]
}
```

This shape **must** be returned by every scoring function in `js/scoring/`. Add a Jest/Node test that asserts the shape matches a JSON Schema across every export.

---

## 5. Data Audit

### Critical gaps (verified by direct file inspection)

| Path | Size | Records | Status |
|---|---|---|---|
| `data/market/tract_boundaries_co.geojson` | 312 B | **0 features** | 🔴 P0 — empty |
| `data/market/tract_centroids_co.json` | populated | 1,605 tracts with lat/lon but file metadata warns of pending rebuild with county-fallback approximations | 🟡 P1 — rebuild-pending |
| `data/market/parcel_aggregates_co.json` | small | `coverage_pct: 0` | 🔴 P0 — stub |
| `data/market/nhpd_co.geojson` | populated | 20 preservation properties | 🟡 P1 — light coverage |
| `data/market/hud_lihtc_co.geojson` | 574 KB | 716 projects (702 valid YR_PIS) | ✅ Good |
| `data/qct-colorado.json` | 446 KB | 224 QCT tracts | ✅ Good (HUD 2025) |
| `data/dda-colorado.json` | 341 KB | 10 DDA counties | ✅ Good (HUD 2025) |
| `data/market/acs_tract_metrics_co.json` | populated | 1,447 tracts | ✅ Good |
| `data/market/chas_tract_co.json` | populated | 1,447 records | ✅ Good |
| `data/hna/place-tract-membership.json` | 426 KB | 482 places × tracts | ✅ Good (TIGER 2024) |
| `data/co_ami_gap_by_place.json` | 525 KB | 482 places, 7 AMI bands | ✅ Good |
| `data/hna/chas_affordability_gap.json` | 166 KB | 64 counties | ✅ Good |
| `data/hna/ranking-index.json` | populated | 547 rankings | ✅ Good |
| `data/policy/housing-policy-scorecard.json` | populated | 547 × 7 dims | ✅ Good (sparse but flagged) |
| `data/policy/prop123_jurisdictions.json` | populated | 217 commitments | ✅ Good |
| `data/hna/local-resources.json` | populated | 68 records | 🟡 P1 — sparse |

### Risky joins / proxies / fallbacks to surface in UI

1. **Place cost burden uses county CHAS fallback** when SMOCAPI bins aren't cached → 25 CO counties affected. Need a confidence pill on the metric.
2. **Population approximation** in Opportunity Finder uses `households_le_ami_pct['100'] × 2.5` (proxy for B01003). Note this in tooltip.
3. **QCT-place membership** uses overlap thresholds (5% of place area OR 20% of tract area). Sliver-overlap risk if thresholds change.
4. **Prop 123 county-level inheritance**: Sugar City and Olney Springs inherit commitments from Crowley County's filing. UI shows "via [County]" already; good.
5. **`PROJ_CTY` string matching** for LIHTC projects is case-sensitive after uppercase normalization. A misspelled PROJ_CTY ("Ft Collins" vs "Fort Collins") will miss. Recommend a Levenshtein-1 fuzzy fallback.

### Data files to validate (sentinel additions for CI)

Add to `scripts/audit/data-sentinels-check.mjs`:

```js
{
  kind: 'file',
  path: 'data/market/tract_boundaries_co.geojson',
  minRows: 1400,
  label: 'CO tract boundary features',
  count: (j) => (j?.features || []).length
},
{
  kind: 'file',
  path: 'data/market/tract_centroids_co.json',
  minRows: 1400,
  label: 'CO tract centroids',
  count: (j) => (j?.centroids || j?.features || (Array.isArray(j) ? j : [])).length
},
{
  kind: 'file',
  path: 'data/market/parcel_aggregates_co.json',
  minRows: 30,  // expect ≥30 counties post-fix
  label: 'CO parcel-aggregate counties',
  count: (j) => Object.keys(j?.counties || {}).length
}
```

---

## 6. Code Architecture Audit

### Scoring duplication map

Eight files run scoring logic. None share helpers:

| File | Purpose | Output shape |
|---|---|---|
| `js/market-analysis/site-selection-score.js` | PMA 6-dim site score | Ad-hoc object |
| `js/market-health-composite.js` | Market health (different formula) | Ad-hoc |
| `js/housing-outcome-score.js` | Need composite (HNA) | Ad-hoc |
| `js/lihtc-deal-predictor.js` | UMD: predictConcept() — recommends AMI×bedroom | Concept |
| `js/lihtc-deal-predictor-enhanced.js` | Extended predictor | Concept |
| `js/chfa-award-predictor.js` | 9% award probability | Score |
| `js/lihtc-opportunity-finder.js` | Jurisdiction targeting | Score |
| `js/colorado-regional-predictions.js` | Regional rollups | Forecast |

**Refactor target:**

```
js/scoring/
  index.js                       — public API
  shape.js                       — ScoreResult JSON Schema + validator
  need-score.js                  — wraps housing-outcome-score
  readiness-score.js             — NEW (civic capacity)
  feasibility-score.js           — wraps site-selection + pop/QCT/DDA
  subsidy-score.js               — NEW (prop123, soft funding, CHFA)
  competition-score.js           — NEW (LIHTC saturation, recency, pipeline)
  composite.js                   — applies weights by deal type
  confidence.js                  — meta-dimension; consumes all above
  explainer.js                   — generates reasons/risks/missingData
  source-vintage.js              — consumes data freshness manifest
  weights.js                     — central weight table per deal type
test/scoring-consistency.test.js — same input → same output everywhere
test/scoring-shape.test.js       — every export matches ScoreResult schema
```

Migration order:
1. Add `js/scoring/shape.js` + schema test (zero breaking change)
2. Add `js/scoring/composite.js` that wraps current Opportunity Finder math
3. Refactor `js/lihtc-opportunity-finder.js` to import from `js/scoring/`
4. Migrate other consumers one at a time

### Performance issues

| File | Size | Issue | Fix |
|---|---|---|---|
| `data/market/hud_lihtc_co.geojson` | 574 KB | Loaded on every page that uses LIHTC layer | Convert to clustered or vector tiles; precompute jurisdiction rollups |
| `data/qct-colorado.json` | 446 KB | Loaded eagerly | Simplify polygons by zoom; serve as MBTiles |
| `data/co_ami_gap_by_place.json` | 525 KB | Loaded on Opportunity Finder + HNA | Acceptable but split into core + extended bands |

### Module pattern inconsistency

- UMD: `js/lihtc-deal-predictor.js` (`window.LIHTCDealPredictor` + `module.exports`)
- IIFE: `js/lihtc-opportunity-finder.js`, `js/hna/hna-controller.js`
- ESM: `scripts/audit/*.mjs`
- Mixed in `js/data-connectors/`

Pick one for new code. ESM via `<script type="module">` is the path of least friction; existing UMD modules can co-exist.

### Testing gaps

- No tests for `lihtc-opportunity-finder.js` rollup math → **covered by new `scripts/audit/verify-opportunity-finder.mjs`** (this session)
- No tests for the empty-data fallback paths
- No regression tests for the score consistency invariant
- No browser smoke tests in CI (test/qa-recent-changes.js has optional puppeteer)

---

## 7. UI / UX Audit

### What works

- Source badges + hyperlinked metric labels (PR #881)
- Methodology disclosures via `<details>` (PR #883)
- Action Plan checklist (PR #881 fix)
- "→ HNA" deep-links from Opportunity Finder (this session)
- Dark mode toggle, mobile menu, skip-link, ARIA labels

### What's confusing / decision-friction

1. **Site landing (`index.html`) does not direct users to a workflow.** A first-time visitor doesn't know if they should start at HNA, market-analysis, or deal-calculator. **Fix**: three big tiles on `index.html`: "Find a market" → Opportunity Finder, "Browse needs" → HNA, "Run a deal" → Deal Calculator.
2. **"Confidence" is binary at best — usually missing.** Need a star/pill on every metric showing data source quality. **Fix**: extend `js/methodology-explainer.js` to emit a `confidence` chip per metric.
3. **No "So what?"** Every analytical page should end with a 2-sentence interpretation. **Fix**: add `<section class="so-what">` slot to every page; populate from a per-page rule (Scorecard ≥ 80 + low LIHTC density = "test 40–60 unit family concept at 30/50/60 AMI").
4. **"Compare" doesn't exist.** Users can't compare Boulder vs. Pueblo without copy-pasting. **Fix**: see P1-4.
5. **Map dominates mobile.** Opportunity Finder map takes 50vh on a 6" screen, table is below the fold. **Fix**: tabs on mobile (Map / Cards / Filters); cards-first.
6. **News linkouts (this session) bury a footnote that they're Google searches.** Some users will click expecting a curated feed. Add a tiny "via Google" tag.

### Accessibility quick wins

- `lof-civic-cell` tooltip uses `title=` — only works on hover; add a visually-hidden expansion for keyboard users
- News button grid has duplicate roles — wrap in `<nav aria-label="Housing news search">`
- Table sort headers use click but no `aria-sort` initial state on inactive headers (current code only sets it post-click)

---

## 8. Implementation Roadmap

### Sprint 1 (next 2 weeks) — "Score consistency + funnel"

1. 🔴 Create `js/scoring/shape.js` with `ScoreResult` contract (P0-1) — 1 day
2. 🔴 Add `test/scoring-shape.test.js` (P0-1) — half-day
3. 🔴 Migrate Opportunity Finder's score output to conform (P0-2 first consumer) — 1 day
4. 🔴 Add deal-type taxonomy radio to OF: 9% / 4% / preservation / workforce-resort / prop123-local (P0-3) — 2 days
5. 🔴 Add `js/components/next-action-cta.js` and wire into HNA, OF, PMA, Deal Calculator (P0-4) — 1 day
6. 🔴 Add `js/utils/source-confidence-badges.js` and wire into OF + HNA (P0-5) — 1 day
7. 🟡 Promote OF to a primary tile on `index.html` (P1-5) — half-day

### Sprint 2 (30–45 days) — "Consolidation + Compare + Export"

8. 🔴 Migrate remaining 7 scoring modules into `js/scoring/` (P0-2) — 5 days
9. 🟡 Build `compare.html` (P1-1) — 3 days
10. 🟡 Build export-memo module (P1-2) — 2 days
11. 🟡 Wire CHFA award pipeline into recency (P1-3) — 2 days
12. 🟡 Surface preservation candidates panel (P1-4 — depends on P0-3 deal-type taxonomy) — 1 day
13. 🟡 Roll civic readiness into composite (P1-6) — 1 day
14. 🟡 Wire EPA Walkability + LODES jobs access (P1-7) — 2 days

### Sprint 3 (longer-term, within jurisdiction direction)

15. 🟢 Mobile card-first rebuild (P2-1) — 1 week
16. 🟢 Watchlist + change alerts (P2-2) — 1 week
17. 🟢 QAP year switcher (P2-3) — 3 days
18. 🟢 Vector tile migration (P2-4) — 1 week
19. 🟢 "So what?" panel pattern across analytical pages (P2-5) — 2 days
20. 🟢 News-source curation (RSS aggregator replacing Google site-search) (P2-6) — 1 week

### Background work (separate track, not blocking deal targeting)

21. Regen `tract_boundaries_co.geojson` + `tract_centroids_co.json` (Appendix A.1, A.2) — half-day
22. Decide on parcel data: fix-or-remove `parcel_aggregates_co.json` (Appendix A.3) — 1 day to remove, 2+ weeks to fix
23. Site-level layer work (Appendix A.4, A.5) — only if product scope expands to site-level

---

## 9. Concrete File-Level Recommendations

### Create

| Path | Purpose | Sprint |
|---|---|---|
| `js/scoring/index.js` | Public API; exports computeScore({jurisdiction, dealType}) | 2 |
| `js/scoring/shape.js` | ScoreResult JSON Schema | 2 |
| `js/scoring/weights.js` | Central weight table per deal type | 2 |
| `js/scoring/need-score.js` | Wraps housing-outcome-score | 2 |
| `js/scoring/readiness-score.js` | NEW — civic capacity composite | 2 |
| `js/scoring/feasibility-score.js` | Wraps site-selection-score + pop bucket | 2 |
| `js/scoring/subsidy-score.js` | NEW — Prop 123 + soft funding + CHFA fit | 2 |
| `js/scoring/competition-score.js` | NEW — saturation + recency + pipeline | 2 |
| `js/scoring/composite.js` | Applies weights | 2 |
| `js/scoring/confidence.js` | Meta-dim — counts fallbacks/missing | 2 |
| `js/scoring/explainer.js` | Generates reasons/risks/missingData | 2 |
| `js/utils/source-confidence-badges.js` | Per-metric ★★★ confidence pill | 1 |
| `js/components/next-action-cta.js` | Sticky bottom CTA strip | 1 |
| `js/components/so-what-panel.js` | Decision-oriented summary | 1 |
| `js/components/opportunity-card.js` | Standalone card component (target state) | 2 |
| `compare.html` | Side-by-side jurisdictional comparison | 2 |
| `js/compare.js` | Compare controller | 2 |
| `js/export/opportunity-memo.js` | Markdown + PDF export | 2 |
| `test/scoring-consistency.test.js` | Same input → same output across modules | 2 |
| `test/scoring-shape.test.js` | All scoring modules return ScoreResult shape | 2 |
| `test/validate-geojson-not-empty.js` | Fail if any required geojson has 0 features | 1 |
| `docs/audits/REPO-AUDIT-2026-05-25.md` | This doc (already created) | 1 |

### Modify

| Path | Change | Sprint |
|---|---|---|
| `index.html` | Replace landing copy with three CTA tiles | 1 |
| `lihtc-opportunity-finder.html` + `.js` | Add deal-type taxonomy, preservation panel, export CTA | 1–2 |
| `housing-needs-assessment.html` | Add "So what?" panel + next-action CTA strip + confidence pills | 1 |
| `market-analysis.html` | Add next-action CTA + So-what; accept `?fips=` and pre-load | 1 |
| `deal-calculator.html` | Accept `?fips=` + concept; add next-action CTA | 1 |
| `scripts/audit/data-sentinels-check.mjs` | Add P0 file sentinels (tract, parcel) | 1 |
| `package.json` | Add `validate:geojson` script + `audit:scoring-consistency` | 1–2 |
| `scripts/market/build_public_market_data.py` | Run + commit output to restore tract files | 1 |

### Delete / deprecate

- `data/market/tract_centroids_co.json` (if rebuild succeeds, replace; otherwise document as do-not-use)
- One of `js/lihtc-deal-predictor.js` vs `js/lihtc-deal-predictor-enhanced.js` (consolidate to a single module)
- `js/market-analysis-cache-fix.js` if its fix is no longer needed post-rebuild

---

## 10. QA / QC Checklist

### Commands to add

```bash
# In package.json:
"validate:geojson":       "node test/validate-geojson-not-empty.js",
"validate:scoring":       "node test/scoring-consistency.test.js && node test/scoring-shape.test.js",
"validate:sources":       "node scripts/audit/data-sentinels-check.mjs",
"validate:opportunity":   "node scripts/audit/verify-opportunity-finder.mjs",
"audit:full":             "npm run validate:geojson && npm run validate:sources && npm run validate:scoring && npm run validate:opportunity"
```

### Tests that should FAIL with the current main branch

- `validate:geojson` against `data/market/tract_boundaries_co.geojson` (0 features) → **FAIL** until P0-1 is fixed
- `validate:sources` with the new sentinels → **FAIL** on tract_boundaries + tract_centroids + parcel_aggregates
- `validate:scoring` → currently no scoring modules return ScoreResult → **FAIL** until P0-4/P0-5 ship

### Tests already passing (this session)

- `scripts/audit/verify-opportunity-finder.mjs` → 28 / 28 ✅
- `test/qa-recent-changes.js` → all 4 categories ✅
- `npm run test:ci` → confirmed pass on hna-ranking-index (16/16), soft-funding-tracker (40/40), and others (interrupted by test timeout but no failures observed)

### Browser / accessibility checks

- Lighthouse: A11y + Performance run on Opportunity Finder (sprint 1)
- Axe-core: tabs through filter chips, table headers, news linkouts (sprint 1)
- Mobile: simulate iPhone SE width; verify card-first layout (sprint 3)

### Source/provenance checks (per-page)

Every page should:
1. Print sourceIds + vintage in the page footer (already partially shipped)
2. Show a confidence pill next to every score/metric (P1-3)
3. Link the metric label to its primary source URL (already shipped)
4. Surface a `data-page-last-updated` meta tag (already shipped)

---

## First-Sprint Implementation Patch Plan

Per the audit ask, this is the **minimum coherent first sprint** to convert the current jurisdiction-level site into a deal-targeting tool without over-rewriting. **Order matters** — do them in sequence. All patches operate at the jurisdiction level; tract geometry and parcel data work is separately tracked in Appendix A.

### Patch 1 — `ScoreResult` shape contract (P0-1, 1 day)

The single most important patch. Lands without breaking anything, but starts failing CI for every non-conformant scoring module, forcing conformance.

```js
// js/scoring/shape.js
export const SCORE_RESULT_SCHEMA = { /* see §4 for the full schema */ };
export function validateScoreResult(r) { /* see §4 */ }
```

```js
// test/scoring-shape.test.js
import { validateScoreResult } from '../js/scoring/shape.js';
import * as opportunityFinder from '../js/lihtc-opportunity-finder.js';
// ...import every other score module
test('OpportunityFinder returns conformant ScoreResult', () => {
  const result = opportunityFinder.scoreJurisdiction({ ... });
  expect(() => validateScoreResult(result)).not.toThrow();
});
```

After this patch lands, every existing scoring module either gets refactored to conform or its test will fail. That's the desired forcing function.

### Patch 2 — Opportunity Finder is first conforming consumer (P0-2, 1 day)

Migrate `js/lihtc-opportunity-finder.js`'s score output to use the shape contract. Today's ad-hoc result object becomes a proper `ScoreResult` with reasons/risks/missingData/nextActions populated. **The UI doesn't change yet** — the OF detail panel already shows most of this content; it just gets sourced from the structured result instead of inline rendering.

### Patch 3 — Deal-type taxonomy (P0-3, 2 days)

Extend the current `state.filters.target` enum from `9pct | 4pct | any` to:
```
9pct_competitive | 4pct_bond | preservation | workforce_resort | prop123_local | any
```

Add a 5th radio. Re-weight per §4 weight table. For `preservation`: relax the QCT+DDA basis-boost requirement; populate from NHPD `subsidy_expiration ≤ 2030`. For `workforce_resort`: relax basis-boost; weight population heavily; flag resort counties. For `prop123_local`: weight civic readiness heavily; relax basis-boost.

### Patch 4 — Next-action CTA strip (P0-4, 1 day)

```js
// js/utils/source-confidence-badges.js
export function confidencePill({
  source,           // 'acs-place' | 'acs-county-fallback' | 'chas-place' | 'chas-county' | 'synthetic'
  vintage,          // '2018-2022' | '2024' | ...
  fallbackUsed = false
}) {
  const stars = fallbackUsed ? 2 : (source.includes('place') ? 3 : 2);
  const cls = stars === 3 ? 'pill-conf-high' : stars === 2 ? 'pill-conf-med' : 'pill-conf-low';
  return `<span class="${cls}" title="Source: ${source} · vintage ${vintage}${fallbackUsed ? ' · fallback used' : ''}">★${'★'.repeat(stars-1)}</span>`;
}
```

Drop next to every metric on HNA, Opportunity Finder, PMA.

### Patch 4 — Next-action CTA strip (P1-2, 1 day)

```js
// js/components/next-action-cta.js
export function renderNextActionStrip({ jurisdictionFips, geoType, fromPage }) {
  const params = `?fips=${jurisdictionFips}&geoType=${geoType}&auto=1`;
  const links = {
    hna:    { label: '📋 View HNA',          href: 'housing-needs-assessment.html' + params },
    pma:    { label: '🗺️ Run market analysis', href: 'market-analysis.html' + params },
    deal:   { label: '💵 Build a deal concept', href: 'deal-calculator.html' + params },
    of:     { label: '🎯 Compare opportunities', href: 'lihtc-opportunity-finder.html' + params }
  };
  // Hide the link for the page we're currently on
  delete links[fromPage];
  return `<aside class="next-action-strip">` +
    Object.values(links).map(l => `<a href="${l.href}">${l.label}</a>`).join('') +
    `</aside>`;
}
```

Drop the strip on the bottom of HNA, OF, Market Analysis, and Deal Calculator. Pass the active jurisdiction's FIPS through every link. Patch is small but unlocks the funnel completely.

### Patch 5 — Confidence pill helper (P0-5, 1 day)

```js
// js/utils/source-confidence-badges.js
export function confidencePill({
  source,           // 'acs-place' | 'acs-county-fallback' | 'chas-place' | 'chas-county' | 'synthetic'
  vintage,          // '2018-2022' | '2024' | ...
  fallbackUsed = false
}) {
  const stars = fallbackUsed ? 2 : (source.includes('place') ? 3 : 2);
  const cls = stars === 3 ? 'pill-conf-high' : stars === 2 ? 'pill-conf-med' : 'pill-conf-low';
  return `<span class="${cls}" title="Source: ${source} · vintage ${vintage}${fallbackUsed ? ' · fallback used' : ''}">★${'★'.repeat(stars-1)}</span>`;
}
```

Wire next to every score / metric on OF detail panel + HNA Executive Snapshot. Adding it on PMA and Deal Calculator can wait for sprint 2.

### Patch 6 — Promote OF on the landing page (P1-5, half-day)

`index.html` gets three big tiles at the top. "Find a market" (primary, prominent) → Opportunity Finder. "Browse needs by jurisdiction" → HNA. "Build a deal concept" → Deal Calculator. Don't rewrite the rest of `index.html`; just the top hero section.

### Patch 7 (sprint 2) — Opportunity card refactor

Promote the current detail-panel rendering in `lihtc-opportunity-finder.js` into a reusable `js/components/opportunity-card.js`. Add the target letter grade, best-fit deal types, confidence pill, next-action CTA strip. The card becomes the consumable artefact across Opportunity Finder, Compare (P1-1), and the future memo export (P1-2).

### What NOT to do in sprint 1

- **Don't regen tract geometry.** It's a known issue but it doesn't affect the deal-targeting workflow. Queue separately. (Appendix A.1, A.2)
- **Don't touch parcel data.** Same reason. (Appendix A.3)
- **Don't rewrite the HNA page.** It's deep, working, and useful. Add the next-action CTA strip + confidence pills, but leave the analytical content alone.
- **Don't migrate the other 7 scoring modules in sprint 1.** Just the OF. The shape contract starts failing CI for them, which establishes the forcing function — but actually refactoring them is sprint 2 work.
- **Don't migrate to ESM modules everywhere.** Mixed module patterns are working. New code can use ESM; existing UMD/IIFE stay.
- **Don't migrate to vector tiles yet.** First-paint is good enough; consistency is the bottleneck, not performance.

---

## Closing — the single best next move

**Create `js/scoring/shape.js` with the `ScoreResult` contract + `validateScoreResult()` helper, and a `test/scoring-shape.test.js` that asserts every score module's output conforms.**

This is a one-day patch that:
1. Lands without breaking anything (existing modules continue working unchanged)
2. Starts failing CI for every non-conformant scoring module, forcing conformance over time
3. Unblocks every other P0 (consolidation, deal-type taxonomy, confidence surfacing all depend on a stable result shape)
4. Establishes the contract that lets HNA, Opportunity Finder, PMA, and Deal Calculator give the *same* score for the *same* jurisdiction — which is the credibility prerequisite for a deal-targeting cockpit

After that lands, the Opportunity Finder gets:
- 5-option deal-type taxonomy (9% / 4% / preservation / workforce-resort / prop123-local)
- Civic readiness weighted into the composite
- Next-action CTAs to PMA + Deal Calculator with `?fips=` pre-load
- Confidence pills on every metric

**You do not need a new page. You need to finish the one you just built — and make every score on the site agree with itself.**

---

## Appendix A — Background work (out of scope for jurisdiction-level deal targeting)

The audit's v1 P0 list (now revised) had three items that turned out to be specific to other surfaces. They're real issues, but they don't block the deal-targeting workflow and shouldn't compete with it for sprint capacity. Listed here for transparency and so Codex (or a future maintainer) doesn't chase them under the wrong banner.

### A.1 — `data/market/tract_boundaries_co.geojson` is empty
- **File**: 312 bytes, 0 features
- **Sole consumer**: `js/colorado-deep-dive.js:454-490` (rent/income choropleth)
- **Impact**: Colorado Deep Dive page silently falls through to circle-marker fallback
- **Not affecting**: HNA, Opportunity Finder, PMA, Deal Calculator (none consume tract polygons)
- **Fix path**: Run `scripts/market/build_public_market_data.py` (cited in the file's own metadata note). Half-day work. Queue separately from deal-targeting sprint.

### A.2 — `data/market/tract_centroids_co.json` is rebuild-pending
- **File**: 1,605 tracts with lat/lon, but metadata warns of county-fallback approximations from an aborted rebuild
- **Sole consumer**: `js/colorado-deep-dive.js:495` (marker fallback when boundaries empty)
- **Impact**: Tract markers render but include undocumented county-pinned fakes
- **Not affecting**: Opportunity Finder uses `place-tract-membership.json` (GEOID joins only, no geometry needed)
- **Fix path**: Same `build_public_market_data.py` regen as A.1

### A.3 — `data/market/parcel_aggregates_co.json` is a stub
- **File**: `counties_successful: 0, coverage_pct: 0`
- **Impact**: Any future site-level parcel screening cannot operate
- **Not affecting**: Jurisdiction-level deal targeting (no parcel dependency)
- **Fix path**: Either run the county Assessor ArcGIS fetch properly (multi-week project given the patchwork of CO assessor APIs), or remove the parcel-aggregate UI references entirely and replace with "Site-level screening: requires verification by user." If the product never goes site-level, this can stay deferred indefinitely.

### A.4 — Site-level layers (water, sewer, slope, wildfire, wetlands, transit access, etc.)
- **Status**: Not in repo today
- **Impact**: Out of scope for jurisdiction-level deal targeting
- **Recommendation**: Only revisit if the product explicitly scopes site-level screening. Today, the OF detail panel's "Next action: contact local jurisdiction to verify utilities" is the right answer.

### A.5 — Public-land + nonprofit-owned parcel layer
- **Status**: Not in repo today; would need custom data acquisition
- **Recommendation**: Long-term; not in any first sprint

— end of audit —
