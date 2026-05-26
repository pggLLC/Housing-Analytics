# LIHTC Locator Methodology

**Version**: 1.1 (2026-05-25) · **Status**: Live in `lihtc-opportunity-finder.html` · **Maintainer**: Open

This document is the canonical methodology behind the COHO Analytics LIHTC Opportunity Finder. It describes — at the level of detail a developer, a CHFA reviewer, or a county housing director would expect — exactly how the locator ranks Colorado jurisdictions for affordable-housing deal targeting, what data backs each score, and what it explicitly does NOT do.

A condensed version of this methodology is embedded in the Opportunity Finder UI under "How is this calculated?" Users who want the full math come here.

---

## 1. The product question

**"Which Colorado jurisdictions deserve scarce developer attention as candidates for the next LIHTC deal?"**

This question has three sub-questions that the locator answers separately so the user can distinguish them:

1. **Where is the housing need acute?** — high cost burden, deep AMI gap, severe rent burden
2. **Where is a deal *executable*?** — basis-boost eligibility, civic readiness, population scale, subsidy stack feasibility
3. **Where is competition light?** — funding-recency headroom, LIHTC saturation gap

The locator never collapses these into a single black-box score. Each dimension is reported separately so a user can see *why* a jurisdiction rises (or doesn't) and can re-weight them for their own deal strategy.

A locator is **not** a site-screen. It can tell you Sugar City scores well for a 9% deal. It cannot tell you whether the south side of Sugar City has a usable parcel, water capacity, or a zoning path. Those questions require parcel-level work that is out of scope; see §9 for the boundary.

---

## 2. The universe — which jurisdictions get scored

### 2a. Base universe

The locator starts with **Colorado's full place inventory** from TIGER 2024:
- 273 incorporated places (cities + towns)
- 210 census-designated places (CDPs)
- 64 counties (used as fallback geography for some signals)

Total: 547 jurisdictions in `data/policy/housing-policy-scorecard.json`. The Opportunity Finder works against the 482 places with tract-membership data (`data/hna/place-tract-membership.json`).

### 2b. Per-deal-type universe filtering

Different deal types have different eligibility universes. The locator filters the base universe per the user's selected target round:

| Target deal type | Universe filter | CO count (today) |
|---|---|---|
| **9% Competitive** | ≥1 QCT tract OR DDA county | 158 jurisdictions |
| **4% Bond + basis boost** | ≥1 QCT tract OR DDA county | 158 |
| **4% Bond (no basis boost)** | Population ≥5,000 HHs (~12,500 people) | TBD when shipped |
| **Preservation** | ≥1 LIHTC or HUD-assisted property with `subsidy_expiration ≤ horizon` (today: 2030) | ~20 from NHPD, expanded as data improves |
| **Workforce / Resort** | Resort county subset (Pitkin, San Miguel, Summit, Eagle, Routt, Garfield, La Plata, Grand) AND population ≥1,000 | ~15 |
| **Prop 123 Local** | Prop 123 commitment filed AND (comp plan ✓ OR HNA ✓ OR housing lead ✓) | ~80 |
| **Any (balanced)** | Union of all above | ~200 |

The 9% / 4%-with-basis filter is the most restrictive because IRC §42(d)(5)(B) basis boost is a real underwriting differentiator. The locator does not pretend that a market without QCT/DDA designation is automatically out — Prop 123 + local-funding stacks work — but those need different filters.

### 2c. Why incorporated-places-first

LIHTC awards typically require a jurisdiction with permitting authority for entitlement, consent letters, and impact-fee waivers. CDPs are unincorporated communities; deals sited in CDPs use county permitting. The locator's default `includeCdps = false` reflects this; users can toggle CDPs on to see all candidates.

---

## 3. The five scoring dimensions

Every jurisdiction in the universe receives five independent 0–100 scores. These are then composited with weights that depend on the target deal type (§4).

### Dimension 1 — Housing Need Score

**What it measures**: How acute is the housing affordability problem? Blends renter cost burden, owner cost burden, and severe rent burden. Normalized to a Colorado-wide percentile.

**Formula**:

```
blended_cb30 = (renter_pct_cb30 × renter_HHs + owner_pct_cb30 × owner_HHs)
             ÷ (renter_HHs + owner_HHs)

severe_rent_burden = renter_pct_cb50    [% of renters paying ≥50% of income on rent]

need_composite = (blended_cb30 × 0.7) + (severe_rent_burden × 0.3)

need_score = percentile_rank(need_composite, CO peer distribution) × 100
```

**Why this shape**: Tenure-blended cost burden is the HUD Worst Case Housing Needs (WCN) framework's anchor metric. Severe rent burden (pct_cb50) gets a 30% weight because households at 50%+ are in immediate stress, while 30%+ is the broader-burden frame. Percentile-normalization against CO peers prevents resort-area distortion (Aspen has 70%+ rent burden but the percentile clips its influence).

**Data sources**:
- HUD CHAS 2018–2022 Table 7 (cost burden by tenure and AMI band) — `data/hna/chas_affordability_gap.json` (county-level) or `data/market/chas_tract_co.json` (tract-level, 1,447 records)
- ACS DP04 GRAPI (renter cost burden) and DP04 SMOCAPI (owner cost burden, 2018–2022 5-year)

**Confidence handling**:
- **High**: Place-level CHAS Table 7 directly available (rare — only large places)
- **Medium**: County CHAS used for place (most common case — note that `data/co_ami_gap_by_place.json` aggregates this)
- **Low**: Owner cost burden via 3-bin CHAS fallback (used when SMOCAPI cache miss — see PR #884)

**Edge cases**:
- Tiny jurisdictions (<200 HHs total) return a "data-thin" flag — percentile rank is unreliable
- Jurisdictions in counties with CHAS suppression: composite uses ACS GRAPI/SMOCAPI direct (lower precision)

---

### Dimension 2 — Recency / Competition Score

**What it measures**: How long since this jurisdiction last got LIHTC funding? Longer = more "saturation headroom" → more competitive for CHFA's geographic-gap scoring on 9% rounds.

**Formula**:

```
last_yr_pis = max(YR_PIS for all LIHTC projects with PROJ_CTY matching jurisdiction
                  AND YR_PIS valid AND YR_PIS != 8888)

years_since = current_year - last_yr_pis
            = ∞ if never funded

recency_score = min(100, round(years_since / 25 × 100))
              = 100 if never funded
              =  60 if 15 years ago
              =  20 if 5 years ago
              =   0 if last year
```

**Why this shape**: CHFA's 9% Qualified Allocation Plan rewards geographic distribution; jurisdictions with no recent activity are explicitly preferred. The 25-year cap matches the LIHTC compliance period — beyond that, a deal can no longer be considered "saturated." Future enhancement (P1): add CHFA award year (typically 2–3y ahead of PIS) for fresher signal.

**Data sources**:
- **CHFA's live Housing Tax Credit Properties feature service** — `data/chfa-lihtc.json` (refreshed from <https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer/0>; 926 CO projects through 2025).
- Recency uses **AwardYear** (when CHFA reserved the credits), not HUD's lagged YR_PIS. AwardYear is the saturation signal CHFA's QAP scoring itself uses.
- Field aliasing: the fetch script (`scripts/fetch-chfa-lihtc.js`) maps CHFA's schema (ReportedName, CityDW, AwardYear, TotalUnits, LowIncomeUnits, TypeOfCredits) to HUD-compatible field names (PROJECT, PROJ_CTY, YR_PIS, N_UNITS, LI_UNITS, CREDIT) so existing site consumers (Colorado Deep Dive, Market Analysis, CHFA Portfolio, LIHTC Dashboard) work without code changes. CHFA-rich fields are preserved alongside (ComplianceStatus, ProjectType, AMI unit breakdowns, population targeting).
- Match rule: `PROJ_CTY.toUpperCase().trim() === jurisdiction_name.toUpperCase().trim()`

**Confidence handling**:
- **High**: Jurisdiction has ≥3 LIHTC projects on record (high-confidence saturation signal)
- **Medium**: 1–2 projects on record
- **Low**: Zero projects — could indicate undeveloped market OR could indicate PROJ_CTY mismatch (e.g., "Ft. Collins" vs "Fort Collins")

**Edge cases**:
- YR_PIS = 8888 (HUD placeholder for in-pipeline projects) excluded
- Misspelled PROJ_CTY misses match (P1 fuzzy-match enhancement on backlog)
- Two-jurisdiction projects (e.g., subdivision crosses city/CDP line): counted toward the listed PROJ_CTY

---

### Dimension 3 — Basis-Boost / Subsidy Fit Score

**What it measures**: How much of the IRC §42(d)(5)(B) basis-boost stack does this jurisdiction qualify for? Stronger basis = better economics on both 9% and 4% deals.

**Formula**:

```
basis_score = 100 if (in QCT and in DDA)
              60 if (in QCT XOR in DDA)
               0 otherwise
```

**Why this shape**: IRC §42(d)(5)(B) basis boost is a single 30% election. A jurisdiction has the option whether it's in a QCT, a DDA, or both. The locator scores BOTH higher than EITHER because a deal in a jurisdiction with both designations has a stronger underwriting narrative (basis-boost election + matching geographic-distribution scoring), even though the federal boost itself is the same 30%. Future enhancement: layer in soft-funding stack (Prop 123, CDBG-HOME, state HDF) for non-basis-boost markets.

**Data sources**:
- HUD QCT 2025 designations — `data/qct-colorado.json` (224 CO tracts)
- HUD DDA 2025 designations — `data/dda-colorado.json` (10 CO nonmetro counties, county-based for nonmetro CO)

**Place-to-QCT membership**: A place "contains" a QCT tract if the tract appears in `place-tract-membership.json` with overlap thresholds:
- Tract's share of place area > 5%, OR
- Place's share of tract area > 20%

This filters out sliver overlaps where a tiny corner of a tract touches a place boundary.

**Place-to-DDA membership**: DDA designation in Colorado is county-based (all 10 CO DDAs are nonmetro counties). Every jurisdiction in a DDA county inherits the designation.

**Confidence**: Always **High** for this dimension. QCT/DDA designations are HUD-published, annual, and unambiguous.

---

### Dimension 4 — Population / Market Feasibility Score

**What it measures**: Does this jurisdiction have enough renter households to lease up a typical LIHTC project? Critical for 4% bond deals (need 100–200 units of absorption), less critical for 9% deals (often 30–60 units).

**Formula**:

```
population_proxy = households_le_ami_pct['100']    [# HHs ≤100% AMI from CHAS]
                 × 2.5                              [avg CO HH size]

population_score = 0   if proxy < 500              (cannot absorb 50-unit project)
                  30   if proxy < 2,000            (small rural, 9% candidate, 30–40 units)
                  60   if proxy < 5,000            (mid-size, 4% bond viability questionable)
                  85   if proxy < 15,000           (sweet spot for 4% bond)
                 100   if proxy ≥ 15,000           (large 4% bond market)
```

**Why this shape**: Bond deals (4%) need scale because their fixed transaction costs (issuance fees, trustees, legal) only pencil at 100+ units. A 60-unit 9% deal in a 1,500-person town is doable; the same project on bonds rarely is. The thresholds match Colorado LIHTC pipeline empirically — most CHFA-awarded 9% rural deals are in towns of 2,000–15,000 people; most bond deals are in places ≥15,000.

**Data sources**:
- CHAS households ≤100% AMI by place — `data/co_ami_gap_by_place.json`, field `households_le_ami_pct['100']`
- Multiplied by 2.5 (CO avg HH size, ACS DP02)

**Confidence handling**:
- **Medium**: This is a proxy; the locator uses HHs × 2.5 instead of B01003 because ACS B01003 isn't yet wired in. Replacement is P2 backlog.
- **Low** for jurisdictions with <100 HHs at any AMI tier (CHAS suppression risk).

**Edge cases**:
- Resort areas with high second-home stock: B01003 would over-count seasonal population; HH-based proxy is actually closer to "renter base" truth in resort markets
- Border-of-bracket jurisdictions (2,000 vs 2,001 HHs): the bucketing creates a step function — sort ties get broken by other dimensions

---

### Dimension 5 — Civic Readiness Score

**What it measures**: Is the local government ready to actually deliver a deal? Has it filed Prop 123, written a comp plan, hired a housing lead, passed inclusionary zoning, established local funding?

**Formula**:

```
civic_score = (count of dimensions where flag === true)
            / (count of dimensions with non-null values)
            × 100

dimensions = [
  prop123_committed,           // filed under HB22-1304 / Prop 123 by Nov 2022+annual
  has_hna,                     // published a Housing Needs Assessment (own, not COHO's)
  has_comp_plan,               // comp plan with housing element
  has_iz_ordinance,            // inclusionary zoning
  has_local_funding,           // local housing fund / fee waiver / dedicated revenue
  has_housing_authority,       // PHA presence (county or local)
  has_housing_nonprofits       // 501(c)(3) housing developers / advocates
]
```

**Why this shape**: A deal is harder in a jurisdiction that hasn't articulated affordable-housing intent. The 7 dimensions are the standard civic-capacity indicators used by Prop 123 administrators (DOLA) when reviewing eligibility. The score is bounded by **knownDimensions** because not every flag is publicly available for every jurisdiction — and the locator should not penalize a place for missing data the same way it penalizes a place for an actual "no."

**Data sources**:
- `data/policy/housing-policy-scorecard.json` — central scorecard with 547 jurisdictions × 7 dimensions
- `data/policy/prop123_jurisdictions.json` — 217 commitments with filing dates + fast-track flags (joins by name to surface filing detail in UI)
- `data/hna/local-resources.json` — actual URLs for housing lead, housing authorities, advocacy orgs, plans on file (sparse but rich where present)

**Confidence handling**:
- **High**: All 7 dimensions have explicit true/false in scorecard
- **Medium**: 5–6 dimensions filled
- **Low**: <5 dimensions filled (~half of CDPs land here)

**Current status in the implementation**: The civic score is shown in the table column and the detail panel, BUT it is not yet rolled into the composite (P1-6 in the audit). Today's composite weights only Need + Recency + Basis + Population. Adding civic readiness to the composite is sprint-2 work; today's locator surfaces civic-capacity for the user to weight manually.

---

## 4. Composite scoring — per-deal-type weight table

Once the five dimension scores are computed, they get composited into one 0–100 number using weights that depend on the user's target deal type.

| Dimension | 9% Competitive | 4% Bond | Preservation | Workforce-Resort | Prop 123 Local | Balanced |
|---|---|---|---|---|---|---|
| **Need** | 30% | 25% | 20% | 25% | 25% | 25% |
| **Recency / Competition** | **30%** | 15% | 15% | 15% | 10% | 20% |
| **Basis-Boost / Subsidy** | 15% | 15% | **35%** | 15% | 20% | 15% |
| **Population / Feasibility** | 15% | **30%** | 10% | **30%** | 15% | 20% |
| **Civic Readiness** | 10% | 15% | 20% | 15% | **30%** | 20% |

**Why these weights:**

- **9% Competitive**: Recency dominates because CHFA's 9% QAP explicitly scores geographic distribution. Need is heavily weighted because 9% deals run on stronger income-targeting (30%/50% AMI deep). Civic readiness is less critical because CHFA's 9% review is the most rigorous gate — they evaluate readiness during application.
- **4% Bond**: Population is heaviest because bond deals need 100–200 units of absorption. Civic readiness matters more than for 9% because the local jurisdiction has to *issue* private-activity bonds.
- **Preservation**: Basis/subsidy is the defining variable — preservation deals run on 4% refi + expiring LIHTC + Year-15 exit. Need still matters (you want to preserve where the need is acute) but population matters less (existing units have existing residents).
- **Workforce-Resort**: Population (for absorption) + civic readiness (resort communities typically have housing strategies). Need is bounded because resort areas always have severe need; the differentiator is execution.
- **Prop 123 Local**: Civic readiness IS the gate. Without comp plan + commitment + lead, the Prop 123 stack doesn't unlock. Basis matters less because state money doesn't require federal basis boost.
- **Balanced**: Roughly equal distribution for exploratory mode when the user hasn't picked a deal type.

**Today's implementation** (per `js/lihtc-opportunity-finder.js`):
- Only 4 dimensions implemented: Recency · Need · Basis · Population (no civic readiness in composite yet, no preservation/workforce/prop123-local deal types)
- 3 target rounds: 9% (40/30/20/10) · 4% (25/25/15/35) · Any (35/30/20/15)
- Weight invariant: each set sums to exactly 1.0 (asserted in `scripts/audit/verify-opportunity-finder.mjs`)

Migrating to the 5-dimension + 5-deal-type model is P0-3 + P1-6 in the audit's first sprint.

---

## 5. Confidence framework — surface uncertainty, don't hide it

Every score result carries a confidence rating that reflects the quality of its inputs. This is a meta-dimension; it doesn't change the composite score, but it changes how the result is presented.

### Confidence inputs

For each jurisdiction, the locator counts:

| Signal | High contribution | Medium | Low |
|---|---|---|---|
| Cost-burden source | Place SMOCAPI direct | County CHAS fallback | 3-bin CHAS approximation |
| Population source | ACS B01003 direct (when wired) | CHAS HH proxy ×2.5 (today) | Unknown |
| Civic data coverage | 7 of 7 scorecard dimensions populated | 5–6 of 7 | <5 of 7 |
| LIHTC project record | ≥3 PROJ_CTY matches | 1–2 matches | 0 matches (genuine gap or mismatch) |
| QCT/DDA membership | Direct overlap > 20% | Threshold 5–20% | Sliver (excluded but worth noting) |

### Confidence levels

- **High**: All five score dimensions sourced from direct data; civic ≥ 5 dimensions filled; no major fallback used
- **Medium**: At least one dimension uses a fallback OR civic 3–4 of 7 OR population is a proxy
- **Low**: Multiple fallbacks OR civic <3 of 7 OR major dimension missing entirely

### How confidence shows up

Today (current implementation): not surfaced as a separate pill. Wiring it is P0-5 in the audit's first sprint.

Target state: every score number gets a ★/★★/★★★ pill next to it on the table and detail panel, with hover tooltip showing the actual source + vintage + fallback flags. Example:

> Need score: **82** ★★ (Crowley County CHAS 2018–2022, place-level CHAS suppressed)

---

## 6. Decision-support metadata — what each score result includes

The locator does not just output a number. Each jurisdiction's score result is a structured object:

```js
{
  score: 72,                    // composite 0–100
  band: 'High',                 // High / Medium / Low / Watchlist / Not-ready
  letterGrade: 'B+',            // A / A- / B+ / B / B- / C+ / C / Watchlist
  confidence: 'Medium',         // High / Medium / Low (§5)
  bestFit: ['9pct_competitive', 'prop123_local'],

  reasons: [                    // why this jurisdiction rose (top 3)
    'Never funded with LIHTC (recency: 100)',
    'Both QCT and DDA designation (basis: 100)',
    'Crowley County cost burden in CO 82nd percentile'
  ],

  risks: [                      // execution risks to verify
    'Population < 500 — bond deal absorption questionable',
    'Owner cost burden via county fallback',
    'No housing lead on file — identify champion'
  ],

  missingData: [                // what we couldn't compute
    'parcel_readiness (not in scope — site work required)',
    'utility_capacity (not in scope)',
    'planned_chfa_pipeline (manual — see CHFA award announcements)'
  ],

  sourceIds: [                  // dataset IDs cited
    'chas-2018-2022', 'hud-qct-2025', 'hud-dda-2025',
    'hud-lihtcdb', 'dola-prop123'
  ],

  sourceVintage: {
    chas: '2018-2022',
    hud_qct: '2025',
    hud_dda: '2025',
    lihtcdb: '1987-2020',
    prop123: '2024-12-09'
  },

  nextActions: [                // funnel forward
    { label: '📋 Open HNA',          href: 'housing-needs-assessment.html?fips=…' },
    { label: '🗺️ Run market analysis', href: 'market-analysis.html?fips=…' },
    { label: '💵 Build deal concept',  href: 'deal-calculator.html?fips=…' }
  ]
}
```

This shape is the same across every scoring module (target state per §4 of the audit). It enables:
- **Compare mode** — side-by-side jurisdiction tables
- **Export memos** — markdown / PDF developer takeaways
- **Watchlist alerts** — diff against historical scores
- **Audit replay** — a single result fully reproduces the methodology

Today's implementation returns a partial version of this shape (no `reasons`, `risks`, `missingData`, `nextActions`). Completing it is P0-1 in the audit.

---

## 7. Decision framework — how to use the score

The locator output is the *start* of a deal-screening conversation, not the end. The recommended decision flow:

### Step 1 — Filter
Pick a target deal type (9% / 4% / preservation / workforce-resort / prop123-local). The locator re-weights and re-filters to the relevant universe.

### Step 2 — Read top 10
Sort by composite score. Look at the top 10. For each: skim the `reasons` (does the rise make sense?) and the `risks` (does any flag disqualify?).

### Step 3 — Cross-check civic capacity
For top candidates, open the detail panel and scan civic readiness. A jurisdiction with **strong scores but Prop 123 not committed + no housing lead + no comp plan** is harder to execute. Bring it forward to the next step but flag the readiness gap as an early conversation with local officials.

### Step 4 — Funnel forward to HNA
For each shortlist candidate, click "📋 Open HNA" to see the full Housing Needs Assessment — owner cost burden, AMI gap by tier, action-plan checklist. This validates whether the locator's signal lines up with the deeper needs picture.

### Step 5 — Funnel forward to PMA
Click "🗺️ Run market analysis" (Patch 4 of sprint 1 once shipped) to open the Primary Market Area workup. Verify:
- Rental demand is real (vacancy, absorption)
- Comparable rents support the AMI mix you'd target
- Site amenities are within reach
- No major infrastructure or environmental risk surfaces

### Step 6 — Build a concept
Click "💵 Build deal concept" to open the Deal Calculator with the jurisdiction pre-loaded. Test a 9% concept (30–60 units, 30/50/60 AMI mix) vs. a 4% concept (100–200 units, 50/60/80 AMI mix). See which pencils.

### Step 7 — Export memo
Ship the result to your pipeline meeting. (Patch 9 in audit sprint 2.)

### Step 8 — Watchlist
Add the jurisdiction to your watchlist. The site notifies you when CHFA announces new awards, NHPD records new subsidy expirations, or Prop 123 filings change. (P2 backlog.)

---

## 8. Output bands and letter grades

### Score bands

| Composite score | Band | Letter | Interpretation |
|---|---|---|---|
| 85–100 | **High** | A / A- | Strong candidate; move to PMA |
| 70–84 | **High** | B+ / B | Solid; verify civic readiness |
| 55–69 | **Medium** | B- / C+ | Worth a deeper look; deal type matters |
| 40–54 | **Medium** | C / C- | Watchlist; need a clear theme to pursue |
| 25–39 | **Low** | D | Hard sell; usually a saturation or population problem |
| 0–24 | **Not-ready** | F | Skip unless very specific local angle |

### Letter grade modifiers (target state, not yet implemented)

- **+ modifier**: high confidence (★★★) and ≥3 reasons → bumps grade up half-step
- **– modifier**: low confidence (★) or critical missing data → bumps grade down half-step
- **Watchlist override**: if all dimensions are medium but one is exceptional (e.g., Prop 123 ✓ + comp plan ✓ + housing lead ✓ in a low-need / low-recency market) → flag as Watchlist regardless of composite

---

## 9. Known limitations — what the locator does NOT do

Be honest about scope. The locator is a **jurisdiction-level screen**, not a site-screening or underwriting tool. It explicitly does not provide:

| Out of scope | Why | Where to go instead |
|---|---|---|
| Parcel readiness | No parcel data layer (see Appendix A of repo audit) | Local county Assessor + zoning lookup |
| Utility / water / sewer capacity | No data layer | District-by-district inquiry |
| Floodplain / wildfire / wetlands / slope | No env layer | FEMA, USFS, USACE, CGS slope analysis |
| Public land / nonprofit-owned parcels | No layer (custom acquisition required) | CO State Land Board API, county Assessor |
| Zoning compatibility | No layer | Local planning department |
| Walkability / transit / grocery access | Layer exists but not wired in (P1-7) | Use HNA Site Selection Score page meanwhile |
| Detailed AMI / unit-mix recommendation | Out of scope | Use LIHTC Concept Recommender (already on PMA page) |
| Capital stack sizing | Out of scope | Use Deal Calculator |
| CHFA award probability | Approximate (no real 9% scoring engine) | Use `js/chfa-award-predictor.js` page |
| Live CHFA pipeline / NOFA timing | Manual | CHFA QAP + CHFA award announcements page |
| Site comparison | Out of scope | (Compare mode P1-1 forthcoming) |

The locator's job is to **narrow 482 jurisdictions to a credible shortlist of 5–15**. Everything below the jurisdiction level requires either: (a) wired-in data layers the repo doesn't have, (b) site-specific work a tool can't substitute for.

---

## 10. Methodology change log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-25 (PR #894) | Initial jurisdiction-level rebuild (was tract-level). 4 dimensions: recency / need / basis / pop. 3 target rounds: 9% / 4% / any. Civic capacity surfaced but not in composite. |
| 1.1 | 2026-05-25 (revised) | Methodology doc published. 5-dimension target state documented (added Civic Readiness). 5 deal types target state documented (added preservation, workforce-resort, prop123-local). Today's implementation gap from target state called out explicitly. |

Next planned: v2.0 after Sprint 1 patches ship (ScoreResult contract, deal-type taxonomy, confidence pills, next-action CTAs, civic readiness rolled into composite).

---

## 11. References

### Federal programs / regulations
- IRC §42 (Low-Income Housing Tax Credit) and §42(d)(5)(B) (basis boost)
- HUD CHAS (Comprehensive Housing Affordability Strategy) — Tables 7, 8, 9
- CHFA public LIHTC cache / HUD LIHTC Database (LIHTCDB)
- HUD QCT designations (annual, IRC §42(d)(5)(B)(ii))
- HUD DDA designations (annual, IRC §42(d)(5)(B)(iii))
- HUD Worst Case Housing Needs (WCN) framework

### Colorado-specific
- HB22-1304 / Proposition 123 (Affordable Housing Financing Fund, Affordable Housing Support Fund)
- DOLA Prop 123 commitment filings — <https://cdola.colorado.gov/commitment-filings>
- CHFA Qualified Allocation Plan (annual) — <https://www.chfainfo.com/multifamily/QAP>
- Colorado Demography Office (CDO) population projections

### Data sources cited
- `data/qct-colorado.json` — HUD QCT 2025 (224 CO tracts)
- `data/dda-colorado.json` — HUD DDA 2025 (10 CO nonmetro counties)
- `data/chfa-lihtc.json` — CHFA public LIHTC cache, 716 projects
- `data/market/hud_lihtc_co.geojson` — HUD LIHTCDB fallback, 716 projects
- `data/hna/chas_affordability_gap.json` — HUD CHAS 2018–2022 (64 counties)
- `data/market/chas_tract_co.json` — HUD CHAS 2018–2022 (1,447 tracts)
- `data/hna/place-tract-membership.json` — TIGER 2024 (482 places × tracts)
- `data/co_ami_gap_by_place.json` — ACS + CHAS derived (482 places × 7 AMI bands)
- `data/policy/housing-policy-scorecard.json` — composite (547 jurisdictions × 7 dimensions)
- `data/policy/prop123_jurisdictions.json` — DOLA Prop 123 filings (217 commitments)
- `data/hna/local-resources.json` — housing lead / authority / advocacy URLs (68 records)
- `data/market/nhpd_co.geojson` — National Housing Preservation Database (20 properties)

### Related repo documentation
- [`docs/audits/REPO-AUDIT-2026-05-25.md`](../audits/REPO-AUDIT-2026-05-25.md) — full repo audit with P0/P1 roadmap
- [`docs/audits/PMA-METHODOLOGY-AUDIT.md`](../audits/PMA-METHODOLOGY-AUDIT.md) — PMA methodology audit
- [`docs/audits/DEAL-CALCULATOR-AUDIT.md`](../audits/DEAL-CALCULATOR-AUDIT.md) — Deal Calculator audit
- [`HANDOVER.md`](../../HANDOVER.md) — codex session handover summary
- [`scripts/audit/verify-opportunity-finder.mjs`](../../scripts/audit/verify-opportunity-finder.mjs) — verification harness (28 checks)
