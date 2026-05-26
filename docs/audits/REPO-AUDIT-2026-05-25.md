# Colorado Housing Analytics — Repo Audit
**Date**: 2026-05-25 · **Auditor**: Claude (senior CS + LIHTC lens) · **Branch**: `feat/lihtc-opportunity-finder`

This audit was commissioned to evaluate the repo against the product question: **"Where in Colorado should a developer spend scarce time looking for the next affordable housing deal?"** It verifies findings claimed in a prior LLM audit, documents what was wrong about those claims, and produces a P0-to-P2 punch list grounded in actual file inspection.

A material framing note at the top: a working version of the proposed "Deal Targeting" experience already exists at **`lihtc-opportunity-finder.html`** (PR #894, merged-pending this session). About 70% of the recommended product flow is shipped. The audit reframes recommendations as **extend the Opportunity Finder**, not "build a new page."

---

## 1. Executive Summary

### What the repo does well

- **Deep data inventory.** 547-jurisdiction HNA ranking-index, 1,447 ACS tract metrics, 1,447 CHAS tract records, 702 HUD LIHTC projects with PROJ_CTY/YR_PIS/N_UNITS, 224 QCT tracts + 10 DDA counties (HUD 2025), 217 Prop 123 commitments with filing dates, 547-jurisdiction × 7-dimension policy scorecard, 482-place AMI gap by 7 bands, TIGER 2024 place-tract spatial join.
- **Methodology rigor where it counts.** Scorecard v2 uses percentile normalisation against CO peer distribution (PR #885), tenure-blended cost burden (PR #884), 7-band AMI gap with both cumulative and per-tier views (PR #882), CHFA-preference AMI × bedroom matrix (PR #890). Public methodology disclosure on every page.
- **Honest data hygiene.** ACS active-market vacancy bounded 5–7% to prevent seasonal distortion (PR #887). PR descriptions explicitly note "screening tool only," "data confidence: medium," "county fallback." Source URLs hyperlinked from every metric.
- **Recently shipped: `lihtc-opportunity-finder.html`.** Ranks 158 jurisdictions with QCT/DDA designation for 4% bond and 9% competitive rounds, deep-links to per-place HNA, surfaces civic capacity (Prop 123, comp plan, housing lead, HA, advocacy), per-jurisdiction housing-news search. **This is the seed of the "Deal Targeting" product.**
- **CI infrastructure.** 50 GitHub Actions workflows including `deploy.yml`, `data-freshness-check`, `data-sentinels-check`, `accessibility`, `contrast-audit`, `console-error-audit`, `external-references-check`, scheduled data refreshes for FRED/HUD/ACS/CHAS/Zillow/Kalshi/HMDA.

### What prevents it from being a true deal-targeting tool today

1. **Critical geometry gap.** `data/market/tract_boundaries_co.geojson` is 312 bytes and contains zero features. The fallback path uses `data/market/tract_centroids_co.json` (1,605 tracts with lat/lon) but **the file's own metadata warns**: "Centroids for tracts without TIGERweb data estimated from county centroid. Rebuild via scripts/market/build_public_market_data.py for precise coordinates." So tract-level maps degrade to circle markers (no choropleth) and an unknown subset of centroids are county-pinned approximations. Yet 1,447 tract-level ACS/CHAS records exist that should have proper polygon geometry.
2. **Parcel data is a stub.** `data/market/parcel_aggregates_co.json` reports `counties_successful: 0, coverage_pct: 0`. The site cannot answer "is there a public parcel here?" — which is the fastest LIHTC site-screening triage.
3. **Need ≠ Dealability.** ChatGPT's framing is correct on this point. The Scorecard v2 composite is a good *need* score but the site sometimes presents it as if it implies opportunity (it doesn't — Boulder is high-need but hard to execute). The Opportunity Finder *does* separate these (recency, basis, population), but only for the QCT/DDA subset.
4. **Scoring code is scattered.** No `js/scoring/` directory. Score logic lives in `js/market-analysis/site-selection-score.js`, `js/market-health-composite.js`, `js/housing-outcome-score.js`, `js/lihtc-deal-predictor.js`, `js/lihtc-deal-predictor-enhanced.js`, `js/chfa-award-predictor.js`, `js/lihtc-opportunity-finder.js`, etc. Drift risk is real — Boulder gets different scores depending on which page you open.

### The single most important product change

**Promote `lihtc-opportunity-finder.html` to the site's primary entry point**, replacing or relegating "Housing Needs Assessment" as the default landing. The HNA is a deep workup; the Opportunity Finder is the deal-sourcing cockpit. Make the HNA accessible via the existing "→ HNA" deep-links the Opportunity Finder already exposes per row. **Don't build a new "Deal Targeting" page — extend the one that already exists.**

### The biggest technical/data risk

The empty `tract_boundaries_co.geojson` (0 features) + the soft-rebuild status of `tract_centroids_co.json` (1,605 tracts but file metadata warns some are county-centroid approximations of unknown precision). Every consumer (`colorado-deep-dive.js`, possibly others) falls back to circle markers — *not* the choropleth UI shows in the methodology disclosure. The map renders, the status string says "X tracts rendered," but:
- the choropleth promised in the methodology never appears, and
- the centroids in the marker fallback include an undocumented number of county-centered fakes.

This creates **false confidence**: page renders fine, status says success, but the underlying spatial truth is degraded. **P0 fix**: regenerate `tract_boundaries_co.geojson` via TIGERweb (script exists at `scripts/market/build_public_market_data.py`, cited in the file's own metadata note) and add a data sentinel that fails CI if features < 1,400. While you're there, regen the centroids file to eliminate the county-fallback approximations.

---

## 2. P0 / P1 / P2 Issue List

### 🔴 P0 — block any further methodology work until resolved

| # | Issue | Why it matters | Affected files | Recommended fix | Test |
|---|---|---|---|---|---|
| P0-1 | `data/market/tract_boundaries_co.geojson` has 0 features | Tract-level maps silently degrade; ratio choropleth on Colorado Deep Dive shows gray | `js/colorado-deep-dive.js:454-490`, possibly `js/market-analysis*.js` | Run `scripts/market/build_public_market_data.py` (cited in file's own metadata note) to rebuild from TIGERweb 2024 | Add sentinel: `data/market/tract_boundaries_co.geojson` must have ≥1,400 features |
| P0-2 | `data/market/tract_centroids_co.json` is rebuild-pending (1,605 tracts with lat/lon but file metadata warns some are county-centroid approximations from an aborted rebuild) | Centroid markers visually render but include undocumented county-fallback fakes; tract-precise spatial joins (which the methodology disclosure implies) aren't actually happening for unknown subset | All tract-centroid consumers — at least `js/colorado-deep-dive.js:495`; audit with grep for other consumers | Same `build_public_market_data.py` regen — centroids derive directly from tract polygons | Sentinel: ≥1,400 centroid records all with valid `lat`/`lon` and `county_centered != true` flag (or remove the metadata warning entirely once rebuilt) |
| P0-3 | `data/market/parcel_aggregates_co.json` has `coverage_pct: 0, counties_successful: 0` | Repo advertises parcel screening but file is a stub. Users seeing "parcel data" in UI assume it exists | `scripts/market/fetch_parcel_data*.py` failed silently | Either (a) actually run county Assessor ArcGIS fetch + add per-county fallback, (b) remove parcel-aggregate UI references and replace with "verification needed" badge | Sentinel: if `coverage_pct < 0.5`, fail build of any page that references parcel data |
| P0-4 | Scoring drift across 7+ modules | Same jurisdiction gets different scores on HNA vs. PMA vs. Opportunity Finder. Erodes trust. | `js/market-analysis/site-selection-score.js`, `js/market-health-composite.js`, `js/housing-outcome-score.js`, `js/lihtc-deal-predictor.js`, `js/lihtc-deal-predictor-enhanced.js`, `js/chfa-award-predictor.js`, `js/lihtc-opportunity-finder.js` | Create `js/scoring/` with one source of truth per dimension (need, recency, basis, pop, civic); refactor consumers to call it | Add `test/scoring-consistency.test.js` that asserts the same input produces the same score across all consumers |
| P0-5 | No central "score result" shape — every consumer invents its own | Hard to add confidence/sources/missing-data uniformly | Same as P0-4 | Define `ScoreResult = { score, band, confidence, reasons[], risks[], missingData[], sourceIds[], sourceVintage[], nextActions[] }` and require every scoring fn to return it | Lint rule + test that every score module's default export matches the shape |

### 🟡 P1 — should-fix before next major release

| # | Issue | Why it matters | Affected files | Recommended fix |
|---|---|---|---|---|
| P1-1 | Opportunity Finder filtered to QCT+DDA jurisdictions only | Excludes preservation deals (NHPD-tracked LIHTC expirations), workforce/resort 4% deals, non-basis-boost opportunities | `js/lihtc-opportunity-finder.js` | Add deal-type taxonomy: `9pct_competitive`, `4pct_bond`, `preservation`, `workforce_resort`, `prop123_local`. Each becomes a target-round option. |
| P1-2 | "Find a market → Screen a site → Explain the deal" funnel is not connected | Users land on HNA, get great need data, but no link to "OK, now what?" | `housing-needs-assessment.html`, `lihtc-opportunity-finder.html`, `deal-calculator.html`, `market-analysis.html` | Add a persistent "next action" CTA strip at the bottom of each analytical page. HNA → Opportunity Finder; Opportunity Finder → PMA (with place pre-loaded); PMA → Deal Calculator (with concept pre-loaded). |
| P1-3 | No "Confidence" surfacing on Scorecard or AMI gap | Boulder's owner cost burden is from CHAS Table 7 (county-level), not place-level SMOCAPI. User can't tell. | `js/hna/hna-controller.js`, `js/hna/hna-utils.js` | Add a small "★★★" confidence pill next to every metric: 3 = direct ACS/CHAS place, 2 = county fallback, 1 = synthetic/derived |
| P1-4 | Compare mode does not exist | "Compare Boulder vs. Greeley vs. Pueblo" is a fundamental developer workflow | All analytical pages | Build `compare.html` that accepts `?jurisdictions=08013,0807850,0862000` and shows a side-by-side score table with all dimensions |
| P1-5 | No export memo (.pdf or .md) | Developers need to bring opportunity findings into their pipeline meeting | All analytical pages | Build `js/export/opportunity-memo.js` that produces a downloadable .md (or .pdf via existing `hna-export.js` pattern) from the current Opportunity Finder selection |
| P1-6 | Recent funding ≠ recent placed-in-service | Opportunity Finder's recency uses YR_PIS (placed in service) which lags awards by 2–3y. A jurisdiction that won 2024 awards but hasn't broken ground still looks "stale." | `js/lihtc-opportunity-finder.js`, `data/market/hud_lihtc_co.geojson` | Add award-year layer: fetch CHFA award announcements (which `js/chfa-award-predictor.js` already references) → join by jurisdiction → use max(YR_PIS, award_year) for recency |
| P1-7 | Preservation pipeline not surfaced | `data/market/nhpd_co.geojson` has 20 properties with `subsidy_expiration` — these are preservation candidates ripe for 4% bond refi + Year-15 exit | Not consumed by Opportunity Finder | Add "Preservation candidates" panel: any LIHTC in jurisdiction with expiration ≤ 2030 → flag prominently |

### 🟢 P2 — nice-to-have / longer-term

| # | Issue | Recommendation |
|---|---|---|
| P2-1 | Mobile experience is desktop-first | Card-first mobile layout for Opportunity Finder; map/table become tabs not side-by-side |
| P2-2 | No "watchlist" | Per-user (localStorage) watchlist of jurisdictions with change alerts |
| P2-3 | QAP year switcher | `data/lihtc/qap_*.json` keyed by 2025/2026/draft-2027 → switcher in Deal Calculator |
| P2-4 | Public-land / nonprofit-owned parcel layer | Custom data acquisition (CO State Land Board API, Colorado Trust Lands, faith-based nonprofit research) — long-term |
| P2-5 | Water/sewer/utility readiness | Out of scope without parcel data; queue behind P0-3 |
| P2-6 | EPA Walkability + transit access | `js/data-connectors/epa-walkability.js` exists — wire into Opportunity Finder detail panel |
| P2-7 | Vector tiles for map performance | Migrate large geojson layers (HUD LIHTC 702 points, QCT 224 polygons) to MBTiles for first-paint <500ms |

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

### Sprint 1 (next 2 weeks) — "Make the data honest + stand up the funnel"

1. 🔴 Regen `tract_boundaries_co.geojson` + `tract_centroids_co.json` (P0-1, P0-2) — half-day
2. 🔴 Decide on parcel data: fix or remove (P0-3) — 1 day
3. 🔴 Add data sentinels (P0 above) — 2 hours
4. 🟡 Add "next action" CTA strip on HNA, Market Analysis, Deal Calculator linking to Opportunity Finder + each other (P1-2) — 1 day
5. 🟡 Add confidence pill helper (`js/utils/source-confidence-badges.js`) — 1 day
6. 🟡 Extend Opportunity Finder with deal-type taxonomy (P1-1) — 2 days

### Sprint 2 (30–45 days) — "Scoring consolidation + Compare + Export"

7. 🔴 Create `js/scoring/` with shape contract + central weights table (P0-4, P0-5) — 3 days
8. 🟡 Build `compare.html` (P1-4) — 3 days
9. 🟡 Build export-memo module (P1-5) — 2 days
10. 🟡 Wire CHFA award pipeline into recency (P1-6) — 2 days
11. 🟡 Surface preservation candidates panel (P1-7) — 1 day

### Sprint 3 (longer-term) — "Site-level layer"

12. 🟢 Parcel data acquisition (P0-3 deep fix or alternative) — 2 weeks
13. 🟢 Mobile card-first rebuild — 1 week
14. 🟢 QAP year switcher — 3 days
15. 🟢 Vector tile migration — 1 week
16. 🟢 Watchlist + change alerts — 1 week
17. 🟢 Public-land + nonprofit-owned parcels — open-ended

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

Per the audit ask, this is the **minimum coherent first sprint** to convert the current site into a deal-targeting tool without over-rewriting. **Order matters** — do them in sequence.

### Patch 1 — Regen tract geometry (P0-1, P0-2, half-day)

```bash
# Run the existing rebuild script that the file's own metadata cites
python3 scripts/market/build_public_market_data.py

# Verify outputs
node -e "console.log(JSON.parse(require('fs').readFileSync('data/market/tract_boundaries_co.geojson')).features.length)"
# Expected: ≥ 1,400
```

If the script doesn't exist or fails, fetch directly from TIGERweb 2024:
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County_Sub_State_TractsBlocks/MapServer/2/query?where=STATE='08'&outFields=*&f=geojson&resultRecordCount=2000
```

### Patch 2 — Data sentinels (P0 detection, 2 hours)

Add the three entries to `scripts/audit/data-sentinels-check.mjs` shown in §5 above. Wire to CI via existing `data-sentinels-check.yml` workflow.

### Patch 3 — Confidence pill helper (P1-3, 1 day)

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

### Patch 5 — Deal-type taxonomy in Opportunity Finder (P1-1, 2 days)

Extend the current `state.filters.target` enum from `9pct | 4pct | any` to:
```
9pct_competitive | 4pct_bond | preservation | workforce_resort | prop123_local | any
```

Add a 6th radio. Re-weight per §4 weight table. Add a preservation-candidate flag (any LIHTC in jurisdiction with `subsidy_expiration ≤ 2030` → boost score).

### Patch 6 — Scoring shape contract (P0-5, 1 day, can land independently)

Create `js/scoring/shape.js`:
```js
export const SCORE_RESULT_SCHEMA = {
  type: 'object',
  required: ['score', 'band', 'confidence', 'reasons', 'risks', 'missingData', 'sourceIds', 'nextActions'],
  properties: {
    score:        { type: 'number', minimum: 0, maximum: 100 },
    band:         { enum: ['High', 'Medium', 'Low', 'Watchlist', 'Not-ready'] },
    confidence:   { enum: ['High', 'Medium', 'Low'] },
    letterGrade:  { type: 'string', pattern: '^[ABCDF][+-]?$|^Watchlist$' },
    reasons:      { type: 'array', items: { type: 'string' }, minItems: 1 },
    risks:        { type: 'array', items: { type: 'string' } },
    missingData:  { type: 'array', items: { type: 'string' } },
    sourceIds:    { type: 'array', items: { type: 'string' }, minItems: 1 },
    sourceVintage: { type: 'object' },
    nextActions:  { type: 'array', items: { type: 'object', required: ['label', 'href'] } }
  }
};

export function validateScoreResult(r) {
  // Minimal AJV-free validator; throws on shape violation
  const required = SCORE_RESULT_SCHEMA.required;
  for (const k of required) if (!(k in r)) throw new Error(`ScoreResult missing field: ${k}`);
  if (r.score < 0 || r.score > 100) throw new Error(`score out of range: ${r.score}`);
  if (!['High','Medium','Low','Watchlist','Not-ready'].includes(r.band)) throw new Error(`bad band: ${r.band}`);
  if (!['High','Medium','Low'].includes(r.confidence)) throw new Error(`bad confidence: ${r.confidence}`);
  return r;
}
```

Add `test/scoring-shape.test.js` that imports every score function and asserts the result validates. This **lands without breaking anything** — the test starts failing for non-conformant modules, which is the desired forcing function.

### Patch 7 — Opportunity card refactor (P1, 2 days, sprint 2)

Promote the current detail-panel rendering in `lihtc-opportunity-finder.js` into a reusable `js/components/opportunity-card.js`. Add the target letter grade, best-fit deal types, confidence pill, next-action CTA strip. The card becomes the consumable artefact across Opportunity Finder, Compare, and the (future) memo export.

### What NOT to do in sprint 1

- **Don't rewrite the HNA page.** It's deep, working, and useful. Add a "So what?" footer and confidence pills, but leave the analytical content alone.
- **Don't migrate to ESM modules everywhere.** Mixed module patterns are working. New code can use ESM; existing UMD/IIFE stay.
- **Don't try to acquire parcel data in sprint 1.** Either remove the parcel-aggregate UI references or label them clearly as "data not available — verification needed."
- **Don't migrate to vector tiles yet.** First-paint is good enough; performance is not the bottleneck. Data quality is.

---

## Closing — the single best next move

**Run `scripts/market/build_public_market_data.py` and commit the regenerated `tract_boundaries_co.geojson` + `tract_centroids_co.json`.** Everything downstream (tract-level need maps, site-screening UI, the 1,447 ACS/CHAS records that currently have no geometry) is gated on this. Until it's fixed, every tract-level analysis the site ships is either silently degraded or rendering "data unavailable" gray polygons.

After that: extend the **already-shipped** Opportunity Finder with deal-type taxonomy + next-action CTAs + confidence pills. You do not need a new page. You need to finish the one you just built.

— end of audit —
