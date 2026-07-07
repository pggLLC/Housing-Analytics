# Codex — Affordable Ownership Need module (Phase 1)

> **This is Phase 1 of the phased master script** — see `docs/audits/CODEX-HANDOFF-PHASED-IMPLEMENTATION-2026-07.md` for the full sequence (Phase 2: Combined Jurisdictions; Phase 3: place pages/digests/briefs), the global rules, and the QA gates. The master script adds one forward-compatibility note for this phase (pure-function input shape for `computeOwnershipNeed`) but otherwise this document stands as written.

**For**: Codex (implementer)
**Date**: 2026-07-05
**QA**: Claude Code will review the PR against the acceptance criteria at the bottom. Deviations from the file allowlist or data contract will bounce the PR, so read this whole doc before writing code.
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`

---

## What you are building

A new **screening layer** in the Housing Needs Assessment that distinguishes rental-oriented need from ownership-oriented need, so the HNA stops implying every affordability gap is LIHTC-rental demand. It answers, per jurisdiction:

1. How much need looks rental-oriented (counts of households, then an index).
2. How much need looks ownership-oriented (cost-burdened owner households).
3. Whether a moderate-income renter base exists that *might* support deed-restricted / shared-equity ownership.
4. A plain-English tenure-strategy read: Rental priority / Rental + ownership mix / Ownership-supportive / Deep affordability priority / Verify locally.

**Working name**: Affordable Ownership Need. Public copy stays plain-English; internal names use the repo's existing conventions.

### Framing to preserve (use this intro verbatim in the UI)

> "This section helps identify where affordable homeownership may be part of the housing strategy. It does not replace the rental need analysis. It helps show whether a community may need a mix of LIHTC rental, deed-restricted ownership, shared-equity homes, or other permanently affordable ownership options."

### Hard rules (unchanged from the product brief)

- Additive module. Do not remove, rewrite, or re-weight any existing HNA calculation, score, or section.
- Every output is labeled a **screening estimate**. Never imply buyer qualification, mortgage-readiness, underwriting, market-study conclusions, or CHFA determinations.
- Never call households "qualified buyers", "mortgage-ready", or similar. Banned phrases: "homeownership prediction", "buyer qualification", "mortgage-ready households", "guaranteed ownership demand", "investment opportunity", "for-sale absorption forecast".
- Rental and ownership are complementary strategies, not competitors. Do not imply ownership is better than rental.
- Show the inputs. No black-box conclusion: every card must be traceable to the source fields listed below.

---

## Phase 1 scope — read carefully, this is the biggest change from the original brief

**IN scope (this PR):**
- Shared calculation module: `js/hna/hna-ownership-need.js` (pure functions, testable in Node).
- One new section on `housing-needs-assessment.html`, rendered by the existing HNA controller/renderer flow.
- Methodology doc: `docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md`.
- Tests: `test/hna-ownership-need.test.js` + npm script + wired into the `test:ci` chain in `package.json`.

**OUT of scope (do NOT touch — later phases, owner decision pending):**
- Generated place pages (`places/*.html`, `scripts/hna/build_place_pages.py`). They do not auto-regenerate and a partial edit ships stale pages.
- Opportunity Finder "Ownership Pairing Signal" (`js/lihtc-opportunity-finder.js`).
- Jurisdiction digests, briefs, ranking index/scenarios, any file under `data/`, any builder under `scripts/`, anything under `.github/workflows/`.
- `robots.txt`, `sitemap*.xml`, `CNAME`, `test/pages-availability-check.js` (deploy gate — editing these without updating the pinned test silently breaks deploys).
- Any new Census/HUD fetch. **There is no data work in this PR.** Everything computes client-side from JSON already shipped in the repo (verified 2026-07-05, see next section).

If you believe a file outside the allowlist must change, stop and flag it in the PR description instead of changing it.

---

## Data contract — these files and fields exist today; use them, add nothing

All fields below were verified against the live repo on 2026-07-05. Do not invent parallel fields, do not add ETL, do not rename.

### Place level — `data/hna/place-chas.json`

`places[<7-digit GEOID>]`:

```js
{
  name, source, tract_count, coverage_share, place_area_sqm,
  acs_anchor,        // true → HH counts capped at ACS occupied units (apportionment overcount fix)
  low_confidence,    // true → downgrade dataQuality (see below)
  summary: {
    total_renter_hh, total_owner_hh,
    renter_cb30_count, renter_cb30_share, renter_cb50_count, renter_cb50_share,
    owner_cb30_count,  owner_cb30_share,  owner_cb50_count,  owner_cb50_share
  },
  renter_hh_by_ami: { lte30, 31to50, 51to80, 81to100, 100plus },  // each band:
  owner_hh_by_ami:  { lte30, 31to50, 51to80, 81to100, 100plus }   // { total, cost_burdened_30pct,
                                                                   //   cost_burdened_50pct,
                                                                   //   pct_cost_burdened_30,
                                                                   //   pct_cost_burdened_50 }
}
```

### County level — `data/hna/chas_affordability_gap.json`

Per county: `total_owner_hh`, `pct_owner_cb30`, `pct_owner_cb50`, `owner_cb30_count`, `owner_cb50_count`, `owner_hh_by_ami` (same band shape), plus the renter equivalents already consumed by the HNA.

### Supporting context (optional, already loaded by HNA pages)

- `data/co_ami_gap_by_place.json` / `data/co_ami_gap_by_county.json` — B25118 renter demand + rental supply gap. **Sign conventions are load-bearing; never `Math.abs()` a gap.** Read-only context for the "existing rental gap" row.
- `data/hna/home-value-cascade.json` — `places` map with median home value (has `review_flags`; skip flagged entries rather than displaying them).

### AMI bands — CHAS-native only

The data has exactly five HAMFI bands: `lte30`, `31to50`, `51to80`, `81to100`, `100plus`.

- **Do not** produce 60%, 100–120%, or 120%+ splits. They cannot be derived from these bands. The original brief's 60–120 scheme is superseded.
- "Moderate-income / potential ownership-fit" band = `51to80` + `81to100` (51–100% HAMFI).
- `100plus` is reported as-is and labeled "above 100% HAMFI (cannot be split at 120%)".

---

## Calculation module — `js/hna/hna-ownership-need.js`

Follow the structure of `js/hna/hna-utils.js`: plain browser script attaching to a namespace on `window`. Pure functions; no DOM access; no fetches (callers pass parsed data in). Tests load it the way `test/data-scope.test.js` loads `js/components/data-scope.js` — read the source and eval against a stub `window`; do not convert HNA modules to ESM/CommonJS.

### Output object

```js
computeOwnershipNeed({ placeChasEntry | countyChasEntry, amiGapEntry?, homeValueEntry? }) → {
  geographyId, geographyName, geoLevel,          // 'place' | 'county'
  renterHouseholds, ownerHouseholds,
  renterCostBurdened, ownerCostBurdened,          // counts (30%+)
  severeRenterCostBurdened, severeOwnerCostBurdened,  // counts (50%+)
  moderateIncomeRenterHouseholds,                 // 51to80 + 81to100 renter totals
  moderateIncomeOwnerCostBurdened,                // 51to80 + 81to100 owner CB30 counts
  rentalPressure:    { tier, inputs },            // tier: 'Low'|'Moderate'|'High'|'Very High'
  ownershipPressure: { tier, inputs },
  ownershipFit:      { tier, inputs },
  tenureMixRecommendation,                        // see logic below
  dataQuality,                                    // 'High'|'Medium'|'Low'|'Unavailable'
  caveats: [ ... ]                                // strings, includes screening disclaimer
}
```

Every `inputs` object echoes the raw fields used so the UI can show them — traceability requirement.

### Tier logic

- **Rental Pressure** from `renter_cb30_share`, `renter_cb50_share`, and renter share of households.
- **Ownership Pressure** from `owner_cb30_share`, `owner_cb50_share`, and `moderateIncomeOwnerCostBurdened` share.
- **Ownership Fit** from `moderateIncomeRenterHouseholds` (count and share of renters). This is a *base-exists* screen, not demand: the caveat text must say these households are **not** qualified buyers.

**Thresholds**: compute the statewide distribution of each input across all Colorado counties in `chas_affordability_gap.json`, then set **fixed round-number cutpoints near the quartiles** (e.g. if the owner CB30 quartiles land at 0.148/0.187/0.224, use 0.15/0.19/0.22). Hard-code the chosen cutpoints as named constants in the module and document each one — with the quartile evidence — in the methodology doc. No opaque weights; no runtime-relative tiers (they'd force 25% of places into "Very High" forever).

### Recommendation logic (keep this exact shape, thresholds via the constants above)

```js
if (rentalHigh && ownershipHigh)            → "Rental + ownership mix"
else if (rentalHigh && fitLow)              → "Rental priority"
else if (ownershipHigh && fitModerateOrUp)  → "Ownership-supportive strategy"
else if (deepAffordabilityHigh)             → "Deep affordability priority"   // lte30 renter CB50 share
else                                        → "Verify locally"
```

### Data quality

- `High` — full place-CHAS summary + both `*_hh_by_ami` maps present.
- `Medium` — summary present but AMI bands partial, OR `low_confidence: true`, OR `acs_anchor: true` (note the cap in caveats).
- `Low` — county fallback used for a place, or only partial summary.
- `Unavailable` — no tenure/cost-burden data. Return the object with tiers null and `tenureMixRecommendation: "Insufficient data — verify locally"`.

No `NaN`, no `undefined`, no divide-by-zero anywhere in the output. Zero households in a band is a valid input.

---

## Repo landmines — each of these has caused a real bug here; treat as requirements

1. **Place-vs-county masking is this repo's most recurring bug.** When the user has a *place* selected, the section must use `place-chas.json` fields; county data may only appear as an explicitly labeled fallback. Reuse the existing per-metric provenance-pill pattern — see `_provenancePill()` at `js/hna/hna-comparison.js:531–566` and the `hca-cp-source-pill` class (F223). Every card gets a pill saying place-CHAS vs county-CHAS.
2. **Tenure mixing rules are codified in `docs/CHAS-FIELD-MAP.md` §5.** Renter and owner metrics stay separate; any blended figure must be labeled "blended" in the UI and code. This module should not need any blend — if you add one, justify it in the methodology doc.
3. **Headline numbers are household counts, not indices.** Each card leads with the count (e.g. "1,240 owner households cost-burdened"), with the Low/Mod/High tier and shares as secondary. This is a settled presentation decision.
4. **iCloud cruft**: files with `" 2"` / `" 3"` in the name (e.g. `build_place_pages 2.py`) are sync duplicates. Never read, edit, or commit them.
5. **CI coupling**: digests/briefs regenerate in-place during CI. If your PR fails checks on files you never touched, main broke after you branched — rebase, don't "fix" the untouched files.

---

## UI — one new section on `housing-needs-assessment.html`

Insert after `<section id="housing-type-need-section">` (it extends the same "what kind of housing" question). Follow the existing section markup pattern (`chart-card`, semantic headings, existing CSS variables — no new hex colors, `test:phantom-css-vars` will catch undefined vars).

Section title: **Affordable Ownership Need** (add the verbatim intro paragraph from above, plus a "Screening estimate" label).

Four cards, each: headline **count**, tier, one-sentence plain-English explanation, provenance pill:

1. **Rental Pressure** — cost-burdened renter households; tier.
2. **Ownership Pressure** — cost-burdened owner households; tier.
3. **Potential Shared-Equity Fit** — moderate-income (51–100% HAMFI) renter households; tier; caveat: "These are not qualified buyers — this screens for whether an ownership-oriented base may exist."
4. **Suggested Tenure Strategy** — the recommendation string + one supporting sentence. For "Rental + ownership mix" include: "This may support a mixed strategy: LIHTC rental for lower-income and rent-burdened households, paired with deed-restricted or shared-equity homes for moderate-income households that cannot access market ownership."

Below the cards, a **Tenure Strategy Indicators** table: rows = renter CB30/CB50 counts+shares, owner CB30/CB50 counts+shares, moderate-income renter HHs, moderate-income owner CB HHs, median home value (if available, else "unavailable"), existing rental gap (from ami_gap file, if available); columns = value / source / method label / interpretation. Method labels: `RAW`, `DERIVED`, `MODELED`, `VERIFY`.

Close the section with a "What to verify next" note: "Before using this for a project decision, verify local sales prices, HOA costs, mortgage assumptions, down-payment assistance, household size, employer demand, buyer readiness, and local deed-restriction policy."

**Missing-data states** (never blank/NaN/bare em-dash): "Ownership data unavailable for this geography." / "Select a jurisdiction to load ownership indicators." / "Screening unavailable — verify locally."

**Accessibility**: semantic headings, tiers conveyed by text not color alone, mobile-readable, no hover-only content, no keyboard traps. `test:pill-contrast` / `test:inline-contrast` run in CI — new pills must pass WCAG contrast.

---

## Methodology doc — `docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md`

Cover: purpose; intended use; what the module can and cannot say; data sources with vintages (CHAS 2018–2022, ACS anchor); exact formulas; the CHAS band mapping and why 120% splits are impossible; threshold constants with their statewide-quartile derivation; recommendation logic; `dataQuality` rules; limitations; why this is screening-only; what to verify locally. Plain-English summary at top. Cross-link from the section's methodology pill the same way existing HNA sections do.

---

## Tests — `test/hna-ownership-need.test.js`

Plain Node script (no framework — match `test/data-scope.test.js`, including its stub-`window` eval loader): assert, exit non-zero on failure. Add `"test:hna-ownership-need": "node test/hna-ownership-need.test.js"` and insert it into the `test:ci` chain in `package.json`.

Required cases:

- null/missing entry → `Unavailable`, no `NaN`/`undefined` anywhere in the returned object (walk it).
- zero renter or owner households → no divide-by-zero, valid tiers.
- missing `owner_hh_by_ami` → `Medium`/`Low` quality, fit card degrades gracefully.
- high rental + high ownership pressure fixture → "Rental + ownership mix".
- high rental + low fit fixture → "Rental priority".
- ownership pressure + moderate fit fixture → "Ownership-supportive strategy".
- `low_confidence: true` and `acs_anchor: true` fixtures → quality downgrade + caveat present.
- output copy scan: caveats/labels contain "screening"; banned phrases ("qualified buyer", "mortgage-ready", "forecast") absent from module strings.
- real-data smoke: load `data/hna/place-chas.json`, run every place, assert no throw and no `NaN`.

---

## Delivery

- One branch, one PR against `main`. **Squash-merge convention.** Do not push to main directly.
- No unrelated files. Expected diff: `js/hna/hna-ownership-need.js` (new), `housing-needs-assessment.html`, one renderer/controller wiring change under `js/hna/`, `docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md` (new), `test/hna-ownership-need.test.js` (new), `package.json`.
- PR description: summary, files changed, threshold constants chosen (with quartile evidence), known limitations, owner decisions needed (if any).
- Before opening the PR run: `npm run validate && npm run test:hna && npm run test:hna-ownership-need && npm run test:phantom-css-vars && npm run test:pill-contrast`.

## Acceptance criteria (Claude QA checklist — the PR is judged against exactly this)

1. Section renders for a county AND a place; place view uses place-CHAS values (spot-checked against `place-chas.json`, incl. Erie `0824950` and one `low_confidence` place) — no silent county masking.
2. Cards lead with household counts; tiers secondary; provenance pills present.
3. AMI logic uses only the five CHAS bands; no 60/120% figures anywhere.
4. Recommendation logic matches the specified shape; thresholds are named constants documented with quartile evidence.
5. All missing-data states render as specified; whole-dataset smoke test passes with no `NaN`.
6. No file outside the expected diff changed; no `data/`, `scripts/`, workflow, or deploy-gate files touched.
7. `test:ci` chain green; new test wired in.
8. Copy contains no banned phrases; screening disclaimer present on the section and in export-visible strings.
9. Existing HNA sections, scores, and exports unchanged (visual + `test:hna` regression).
