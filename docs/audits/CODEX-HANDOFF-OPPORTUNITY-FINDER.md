# Codex Handoff — LIHTC Opportunity Finder Analysis

**Date**: 2026-05-25 · **For**: Codex (or fresh human reviewer) · **PR**: #894 · **Branch**: `feat/lihtc-opportunity-finder`

This is the entry-point document for analyzing the LIHTC Opportunity Finder — the jurisdiction-level deal-targeting cockpit that's the strategic spine of the COHO Analytics product. Read this first. It points you at the methodology, the implementation, the verification harness, and the open work.

---

## TL;DR

The user wants to know "where in Colorado should a developer spend scarce time looking for the next LIHTC deal?" The Opportunity Finder is the answer. **This PR ships ~70% of the target product.** It ranks 158 jurisdictions with QCT/DDA designation across 4 score dimensions and re-weights live by 9% / 4% / Any target round. The remaining 30% (5th dimension Civic Readiness in composite, 5 deal types vs 3, ScoreResult shape contract, cross-page funnel, confidence pills) is documented as Sprint 1 work in the repo audit.

**Strategic direction**: jurisdiction-level (not tract-level, not site-level). Tract polygon geometry and parcel data are explicitly out of scope for this product; see Appendix A of `docs/audits/REPO-AUDIT-2026-05-25.md`.

---

## What to read, in order

1. **[`docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`](../methodology/LIHTC-LOCATOR-METHODOLOGY.md)** — the canonical methodology. Every dimension, every weight, every confidence handling rule, every limitation. Read this first; it's the contract.
2. **[`lihtc-opportunity-finder.html`](../../lihtc-opportunity-finder.html)** — the UI. The methodology section (always visible, near bottom of page) embeds an abridged version of the methodology doc.
3. **[`js/lihtc-opportunity-finder.js`](../../js/lihtc-opportunity-finder.js)** — the implementation (~778 lines). Inspect against the methodology doc.
4. **[`scripts/audit/verify-opportunity-finder.mjs`](../../scripts/audit/verify-opportunity-finder.mjs)** — independent re-implementation of the math in pure Node. 28 checks. Run with `npm run audit:opportunity-finder`.
5. **[`docs/audits/REPO-AUDIT-2026-05-25.md`](REPO-AUDIT-2026-05-25.md)** — full repo audit with P0/P1/P2 list reflecting jurisdiction-level direction.

---

## Verification analysis to perform

Your job is to determine whether the implementation faithfully reflects the methodology, surface any drift, and propose specific fixes. Below is a structured analysis checklist organized by methodology section.

### Analysis 1 — Universe definition

**Methodology says** (LIHTC-LOCATOR-METHODOLOGY §2):
- Base universe: 482 CO places (273 incorporated + 210 CDPs) from TIGER 2024
- 9% / 4%-with-basis-boost filter: ≥1 QCT tract OR DDA county → 158 jurisdictions
- Preservation / workforce-resort / prop123-local filters: documented but not yet shipped

**Verification questions**:
- [ ] Does `js/lihtc-opportunity-finder.js` actually iterate over all 482 places in `place-tract-membership.json`, or does it short-circuit somewhere?
- [ ] Is the QCT membership threshold logic (`share_of_place_area > 0.05 OR share_of_tract_area > 0.20`) correct per the methodology, and is it applied uniformly?
- [ ] DDA county-FIPS set: does it correctly identify all 10 CO nonmetro counties as having DDA designation, and does every place in those counties inherit it?
- [ ] What happens to jurisdictions with QCT but no DDA, or DDA but no QCT? Are they included in the universe (they should be — basis-boost is OR-logic, not AND-logic)?
- [ ] Run `node scripts/audit/verify-opportunity-finder.mjs` — does the universe-count check pass? (158 expected total, 6 with both, 92 QCT-only, 60 DDA-only)

### Analysis 2 — Per-dimension scoring

For each of the 4 dimensions currently implemented (Recency, Need, Basis, Population), verify the formula matches the methodology doc:

#### Dimension 1 — Need Score
**Methodology** (§3 Dimension 1):
```
blended_cb30 = (renter_pct_cb30 × renter_HHs + owner_pct_cb30 × owner_HHs)
             ÷ (renter_HHs + owner_HHs)
severe_rent_burden = renter_pct_cb50
need_composite = (blended_cb30 × 0.7) + (severe_rent_burden × 0.3)
need_score = percentile_rank(need_composite, CO peer distribution) × 100
```

**Verification questions**:
- [ ] Find `buildNeedDistribution()` and `needCompositeFor()` in the JS. Do they match this formula?
- [ ] Specifically check: is the blended formula using the 0.7 / 0.3 mix? Where is the 0.3 weight applied (it's `pct_renter_cb50` × 0.3 + blended × 0.7)?
- [ ] Verify the percentile rank uses CO peer distribution (not national) — check `needScoreFor()` against `needDist` sorted array
- [ ] Edge case: tiny jurisdictions (<200 HHs) — does the formula return a `dataThin: true` flag or silently degrade?
- [ ] Edge case: county CHAS suppression — is there a fallback to ACS DP04 direct? Where?

#### Dimension 2 — Recency Score
**Methodology** (§3 Dimension 2):
```
last_yr_pis = max(YR_PIS for LIHTC projects with PROJ_CTY match,
                  filtered to valid YR_PIS != 8888)
years_since = current_year - last_yr_pis
recency_score = min(100, round(years_since / 25 × 100))
              = 100 if never funded
```

**Verification questions**:
- [ ] Find `recencyScore(lastYear)` in the JS. Does it cap at 25 years (not 20, not 30)?
- [ ] Are YR_PIS = 8888 (HUD placeholder) explicitly excluded from the lastYear calc?
- [ ] Is `current_year` hardcoded or derived from `new Date().getFullYear()`? (It should be derived.)
- [ ] PROJ_CTY matching: case-insensitive uppercase trim — confirm this is the only normalization. Are there any fuzzy-match attempts? (There shouldn't be — that's a P1.)
- [ ] Edge: does a jurisdiction with 0 PROJ_CTY matches get score 100 (never funded) or something else?

#### Dimension 3 — Basis-Boost Score
**Methodology** (§3 Dimension 3): QCT only: 60, DDA only: 60, both: 100, neither: 0.

**Verification questions**:
- [ ] Find `basisBoostScore(hasQct, hasDda)` in the JS. Does it return these exact values?
- [ ] Is the QCT detection using the membership thresholds (5% / 20%)?
- [ ] Is the DDA detection correctly using county-FIPS inheritance for all jurisdictions in DDA counties?

#### Dimension 4 — Population Score
**Methodology** (§3 Dimension 4): bucketed: <500: 0, 500–2k: 30, 2k–5k: 60, 5k–15k: 85, ≥15k: 100. Source: CHAS HHs ≤100% AMI × 2.5.

**Verification questions**:
- [ ] Find `populationScore(pop)` in the JS. Are the bucket boundaries exactly 500 / 2000 / 5000 / 15000?
- [ ] Is the multiplier 2.5 (CO avg HH size)?
- [ ] Edge: what happens if `households_le_ami_pct['100']` is null or undefined? Does the score return 0 (correct) or NaN (bug)?

#### Dimension 5 — Civic Readiness Score
**Methodology** (§3 Dimension 5): 7 binary dimensions, score = true / known × 100.

**Verification questions**:
- [ ] Civic score is **surfaced** but not **rolled into composite** in today's implementation. Confirm this matches what `_renderCivicPanel()` does (shows it as a separate badge).
- [ ] Does the per-row "Civic" column correctly read `civic.totalScore` / `civic.maxPossible` from `policyScores[geoid]`?
- [ ] When a place doesn't have a scorecard record, does it fall back to the containing county's record (correct) or default to 0 (would penalize unfairly)?

### Analysis 3 — Composite scoring + weight invariants

**Methodology** (§4): Today's implementation uses 4-dimension weights. 9% = 40·30·20·10, 4% = 25·25·15·35, Any = 35·30·20·15. Each set sums to 1.0.

**Verification questions**:
- [ ] Find `SCORE_WEIGHTS` in the JS. Do all three targets sum to exactly 1.0? Run `npm run audit:opportunity-finder` — the weight-invariant check should pass.
- [ ] Verify `compositeScore(rec, need, basis, pop, target)` uses the active target's weights and rounds the final result.
- [ ] Is the composite output guaranteed to be in [0, 100]? (Yes if all four component scores are bounded and weights sum to 1.) The range invariant check in the verification harness asserts this.

### Analysis 4 — Filtering behavior

**Methodology** + UI: default filter is `requireBoth = true`, `includeCdps = false`, target = `9pct`. Should produce 5 named jurisdictions: Montezuma, Sugar City, Crowley, Olney Springs, Ordway.

**Verification questions**:
- [ ] Run `npm run audit:opportunity-finder` — the default-filter check should output exactly these 5 names.
- [ ] What happens when user toggles `requireBoth` off + leaves `requireQct` and `requireDda` off? The result should be all 158 jurisdictions (no designation filter).
- [ ] What happens when user toggles `requireQct` on AND `requireDda` on (both individual)? Should it be equivalent to `requireBoth`? Trace `_applyFilters()` to confirm.

### Analysis 5 — Civic-capacity joins

**Methodology** (§3 Dim 5, §5): three data sources joined — `housing-policy-scorecard.json` (547 records), `local-resources.json` (68 records), `prop123_jurisdictions.json` (217 commitments).

**Verification questions**:
- [ ] For Sugar City (geoid 0875210, county 08025): does the locator surface "Prop 123 ✓ via Crowley County" since Sugar City didn't file individually but the county did? Trace the prop123 extra text construction in `_renderCivicPanel()`.
- [ ] For Montezuma (geoid 0850105, county 08117 = Summit): does it find Montezuma's own scorecard record + Summit County's local-resources record? It should — the scorecard is keyed by place GEOID, and local-resources by `place:GEOID` → `cdp:GEOID` → `county:FIPS`.
- [ ] Does `prop123ForName()` correctly strip the "City of " / "Town of " / "City and County of " / "County" suffix from the canonical prop123 name to match the place's bare name?

### Analysis 6 — HNA deep-link integrity

**Methodology**: every jurisdiction row gets a "→ HNA" link and the detail panel has two CTAs (place-level + county-level). The HNA page (`housing-needs-assessment.html`) accepts `?fips=…&geoType=place|county&auto=1`.

**Verification questions**:
- [ ] Open `lihtc-opportunity-finder.html` in a browser. Click "→ HNA" on Sugar City. Does the URL include `fips=0875210` and `geoType=place`? Does the HNA page actually auto-select Sugar City?
- [ ] Click the county-level CTA in the detail panel. Does it correctly navigate to `?fips=08025&geoType=county`?
- [ ] Read `housing-needs-assessment.html`'s `_resolveAutoTarget()` function. Does it handle both 5-digit (county) and 7-digit (place) FIPS? Does the URL param override prior WorkflowState?

### Analysis 7 — Verification harness honesty

**Verification questions**:
- [ ] The harness `scripts/audit/verify-opportunity-finder.mjs` independently re-implements the rollup math. Spot-check 3 known cases (Sugar City, Crowley, Cortez) — does it compute the same scores as the JS implementation? It should; they're both deterministic from the same data.
- [ ] Does the harness use the same data files as the live JS module? List them. (Should be the same 10.)
- [ ] If the JS module is modified (e.g., a weight changes), does the harness fail until the harness is also updated? It should — the harness has a hardcoded `SCORE_WEIGHTS` table that's separately maintained.

### Analysis 8 — Methodology-vs-implementation drift

This is the highest-leverage analysis. Look for places where the methodology doc says X and the code does Y.

**Specific drift points to check**:
- [ ] Methodology §3 Dim 5 says Civic Readiness is surfaced but **not** in composite. Confirm by reading `_computeOpportunities()` — there should be NO civic component in the `compositeScore()` call.
- [ ] Methodology §4 says today is 4 dimensions; target state is 5. Confirm by counting weight-table rows in the live code (should be 4).
- [ ] Methodology §3 Dim 4 says "CO avg HH size ≈ 2.5" — is the multiplier exactly 2.5 or is it 2.4 or 2.6 in the code?
- [ ] Methodology §3 Dim 2 says "Capped at 25+ years" — is the constant `MAX_RECENCY_YEARS = 25` in the code? (Yes — verified.)
- [ ] Methodology §3 Dim 3 says basis-boost is QCT-only OR DDA-only = 60 (not 50, not 70). Confirm in code.
- [ ] Methodology §6 describes the target-state ScoreResult shape with reasons / risks / missingData / nextActions. Confirm today's implementation does NOT yet return this shape — that's P0-1 in the audit.

### Analysis 9 — Honest gaps in current implementation

These are NOT bugs — they are intentional gaps documented in the methodology. Confirm Codex understands they're not regressions:

- [ ] **No `ScoreResult` shape contract.** Today's output is an ad-hoc object. Methodology §6 describes the target shape. P0-1 in audit.
- [ ] **Civic Readiness not in composite.** Surfaced as a column, but the composite still uses only 4 dimensions. Methodology §4 footnote acknowledges this.
- [ ] **3 target rounds (9% / 4% / Any), not 5.** Preservation, workforce-resort, prop123-local are documented but not shipped. P0-3 in audit.
- [ ] **No confidence pills.** Confidence is described in methodology §5 but not yet visible per-metric. P0-5 in audit.
- [ ] **No "next action" CTA strip on HNA / PMA / Deal Calculator.** Only the Opportunity Finder has the CTAs (this PR). P0-4 in audit.
- [ ] **Recency uses YR_PIS, not CHFA award year.** Lags awards 2–3y. P1-3 backlog.
- [ ] **No preservation candidates panel.** NHPD data exists in repo but not consumed. P1-4 backlog.
- [ ] **Population is a proxy.** HHs × 2.5, not ACS B01003. Methodology §3 Dim 4 acknowledges. P2 backlog.

---

## Quick-start verification commands

```bash
# 1. Run the verification harness — 28 independent checks against the live implementation
npm run audit:opportunity-finder
npm run audit:opportunity-finder:json    # machine-readable for CI

# 2. Sanity-check the JS module compiles
node --check js/lihtc-opportunity-finder.js

# 3. Run the broader recent-changes QA
npm run test:qa-recent

# 4. Run the full CI test suite to ensure no regressions
npm run test:ci

# 5. Open the page locally to inspect the UI
npx http-server -p 8080 .   # or any static server
open http://localhost:8080/lihtc-opportunity-finder.html
```

---

## Specific files to inspect

| File | Lines | What to read |
|---|---|---|
| `lihtc-opportunity-finder.html` | full | UI structure + always-visible methodology section near the bottom |
| `js/lihtc-opportunity-finder.js` | 1–100 | State + SCORE_WEIGHTS + helpers |
| `js/lihtc-opportunity-finder.js` | 100–250 | Score component functions (`recencyScore`, `needCompositeFor`, `basisBoostScore`, `populationScore`, `compositeScore`) |
| `js/lihtc-opportunity-finder.js` | 250–400 | Data loaders + opportunity rollup (`_computeOpportunities`) |
| `js/lihtc-opportunity-finder.js` | 400–650 | Rendering (table, detail panel, civic panel, news panel) |
| `js/lihtc-opportunity-finder.js` | 650–778 | UI wiring (filters, sorting, map) |
| `housing-needs-assessment.html` | 2255–2370 | `_resolveAutoTarget` + `_tryAutoSelect` — extended this session for place deep-links |
| `scripts/audit/verify-opportunity-finder.mjs` | full | Independent verification harness |
| `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md` | full | Canonical methodology |
| `docs/audits/REPO-AUDIT-2026-05-25.md` | full | Full repo audit; P0–P2 roadmap (jurisdiction-direction) |

---

## What success looks like

When you're done, you should be able to answer:

1. **Does the implementation faithfully reflect the methodology?** Pass/fail per dimension, with specific code references for any drift.
2. **Are the documented limitations honest?** Are there any silent fallbacks or hidden assumptions not noted in the methodology?
3. **Is the verification harness sufficient?** What edge cases or invariants is it missing?
4. **What's the highest-leverage next change?** Per the audit it's P0-1 (`js/scoring/shape.js`). Confirm or challenge that recommendation.
5. **What in the methodology doc is over-claimed?** Are there any aspirational statements that the implementation doesn't yet support? (Honestly: yes — civic readiness in composite, 5 deal types, ScoreResult shape, confidence pills. The methodology is clear these are "target state, not shipped." Verify Codex agrees the framing is honest.)

---

## Expected output from your analysis

A short structured report (~500–1,000 words) with:

1. **Verification matrix** — table of methodology claims × pass/fail/notes
2. **Drift findings** — specific code-vs-doc inconsistencies (file:line + what each says)
3. **Honest-gap confirmations** — list of "this is documented as a gap, not a bug" items
4. **Test coverage gaps** — what the harness should test but doesn't
5. **Highest-leverage next change** — your independent recommendation

If you find genuine bugs (not gaps), file them as GitHub issues against the `feat/lihtc-opportunity-finder` branch / PR #894.

---

## Out of scope for this analysis

- Tract-level concerns (`tract_boundaries_co.geojson` empty, `tract_centroids_co.json` rebuild-pending) — these affect `colorado-deep-dive.js` only, NOT this locator. See Appendix A of the repo audit.
- Parcel-level concerns (`parcel_aggregates_co.json` stub) — site-level work, out of scope for jurisdiction targeting.
- Rewriting the locator from scratch — this is incremental work, not a redesign.
- Auditing the HNA page, PMA page, or Deal Calculator — separate audit docs exist for those at `docs/audits/PMA-METHODOLOGY-AUDIT.md` and `docs/audits/DEAL-CALCULATOR-AUDIT.md`.

---

## Contact / open questions

If anything in the methodology is ambiguous, the canonical answer is in `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`. If the methodology itself is wrong, file an issue and we'll iterate — the methodology is versioned (currently v1.1) and intentionally evolves.

The repo's overall strategic direction (jurisdiction-level, not site-level; build-on the Opportunity Finder, don't build a new page) is locked per the audit's "Strategic direction lock" callout. Any proposal that contradicts that direction should explicitly call out the reversal.

Good luck. The product is in pretty good shape — most of the work is consolidation, not invention.
