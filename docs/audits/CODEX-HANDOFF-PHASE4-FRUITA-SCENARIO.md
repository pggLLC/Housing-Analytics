# Codex Handoff — Phase 4: Fruita Commons Project Scenario (Schema + Fixtures)

**For:** Codex (implementer) · **QA:** Claude Code (schema walk, classification audit, reconciliation, leak tests, sabotage).
**Date:** 2026-08-05
**Depends on:** Phases 1–3.1 + 5 merged (#1388/#1390/#1392/#1394/#1396/#1397).
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 4 row), §5.5–§5.6 (capital-stack + needs-based assistance schemas); refinement §4 (baseline), **§5 (the preliminary scenario — encode it verbatim as the test case)**, §10 (assistance ranges), §13 (HOA); `docs/audits/phase1-draft-fixtures/fruita-mesa-local-contributions.draft.json` (authoritative local baseline block).
**Scope:** **schema + fixtures + a loader/validator module + tests. No UI, no report, no demand/capture.** This phase makes the Fruita Commons scenario a first-class, validated data object that Phases 6–9 consume. Real developer numbers (TDC build-up, land value, phasing dates, HRWC terms) are **not yet available** — those fields ship `null` + `verify: true` + `classification: "user_entered"|"not_available"`; the schema must make that state first-class, not an error.

---

## What you are building

1. **`data/fixtures/fruita-commons.scenario.json`** (new) — the Fruita Commons baseline scenario, per the schema below, encoding the refinement-§5 preliminary program:
   - Units: **4× 1BR/accessible-flex (750–850 sqft), 22× 2BR (950–1,100 sqft), 22× 3BR (1,200–1,350 sqft), 2× 4BR/3BR+flex (1,400–1,550 sqft)** = 50 total.
   - AMI mix: **10 @ 70–80%, 15 @ 80–90%, 15 @ 90–100%, 10 @ 100–120%** (band objects, not point values).
   - HOA target **$175–225/mo** (range object + `higher_cost_scenario: 300` per refinement §13).
   - Land: Fruita Housing Authority parcel, land-disposition hypothesis `model_a_public_land_retention` — stored as `hypothesis_to_test: true` (never "selected").
   - Needs-based assistance planning ranges (§10): 70–80% ≈ $75–110k; 80–90% ≈ $50–85k; 90–100% ≈ $25–60k; 100–120% ≈ $0–35k — each `classification: "user_entered"`, `is_commitment: false`.
   - Authoritative local baseline (copy from the Phase-1 draft fixture, values re-verified against repo data): Mesa AMI 4-person **$97,600**; Fruita place ZHVI **$486,295** (2026-05-31); Redfin median sale **$489,439**. The script-era figures ($94,100 / $536–594k / 87.3% / 82.2%) must **not** appear anywhere.
   - TDC, land value, hard/soft/fee/contingency, phasing, HRWC terms: `null` + `verify: true` with `owner_input_required: true`.
2. **Three comparison-scenario fixtures** (refinement §5): `fruita-commons-compact.scenario.json` (lower-cost compact: shift mix toward 1–2BR, smaller sqft), `fruita-commons-family.scenario.json` (family-weighted: shift toward 3–4BR), `fruita-commons-broad-income.scenario.json` (add 60–70% and 120% bands). Same schema; only program fields differ; every changed value `classification: "modeled"` with a `variant_note`.
3. **`js/project-market-study/project-scenario.js`** (new) — pure loader/validator/derivation module:
   - `validate(doc)` — schema validation (shape, enums, classifications, unit-count integrity: bedroom-mix counts sum to `total_units`; AMI-mix counts sum to `total_units`; every dollar is number-or-null; null ⇒ `verify: true`).
   - `derive(doc, engine)` — the *computable* screening outputs only: per-AMI-band max affordable price (via `OwnershipFinance`, model + household-size **derived from bedroom count** — 1BR→2-person, 2BR→3-person, 3BR→4-person, 4BR→5-person, stated as a named convention), per-band gap vs the scenario's `local_baseline` price, per-band assistance-range check (is the §10 range ≥ the computed gap? report `sufficient | insufficient | unknown` — never silently clamp), and totals. **No TDC-dependent math when TDC is null** — those outputs return `not_available`, never 0.
   - `toSubjectProject(doc)` — adapter mapping the scenario into the existing `window.SubjectProject` shape (`unit_mix` rows {bedrooms, ami_tier, count, sqft}, `county_fips`) so existing scenario infrastructure can consume it. Read `js/components/subject-project.js` first; do not modify it.
4. **`test/project-scenario.test.js`** (new).

## Scenario schema (v1 — the contract Phases 6–9 build on)

```jsonc
{
  "schema": "project-scenario/v1",
  "meta": { "name": "Fruita Commons — baseline", "status": "hypothesis_to_test",
            "as_of": "…", "classification_note": "every value carries classification",
            "owner_inputs_pending": ["tdc_build_up","land_value","phasing","hrwc_terms"] },
  "jurisdiction": { "place_geoid": "0828745", "county_fips": "08077", "name": "Fruita" },
  "local_baseline": { "ami_4person": {"value": 97600, "classification": "observed", "source": "…"},
                       "home_value": {"value": 486295, "classification": "observed", "source": "…", "as_of": "2026-05-31"},
                       "median_sale_price": {"value": 489439, "classification": "observed", "source": "…"} },
  "program": {
    "total_units": {"value": 50, "classification": "user_entered"},
    "unit_mix": [ {"bedrooms": 1, "count": 4, "sqft_range": [750, 850], "flex_accessible": true,
                    "classification": "user_entered"}, … ],
    "ami_mix": [ {"band": [0.70, 0.80], "count": 10, "classification": "user_entered"}, … ],
    "tenure_form": {"value": "townhome", "classification": "user_entered"}
  },
  "land": { "owner": "Fruita Housing Authority", "disposition_model": "model_a_public_land_retention",
             "hypothesis_to_test": true, "land_value_per_unit": {"value": null, "verify": true,
             "owner_input_required": true, "classification": "not_available"} },
  "costs": { "tdc": {"value": null, "verify": true, "owner_input_required": true, "classification": "not_available"},
              /* hard, soft, fee, contingency, sales, financing — same null+verify shape */ },
  "carrying": { "hoa_monthly": {"range": [175, 225], "higher_cost_scenario": 300, "classification": "user_entered"},
                 "property_tax": {"treatment": "from_land_disposition_model", "classification": "derived"} },
  "assistance_ranges": [ {"band": [0.70, 0.80], "range": [75000, 110000], "is_commitment": false,
                           "classification": "user_entered"}, … ],
  "stewardship": { "candidate_provider_id": "hrwc", "is_commitment": false,
                    "terms": {"value": null, "verify": true, "classification": "not_available"} },
  "phasing": { "value": null, "verify": true, "owner_input_required": true, "classification": "not_available" }
}
```

## Hard rules (test-enforced or QA-bounced)

1. **Fixture-leak rule (the big one):** no value from any scenario fixture may reach a statewide default, constant, or non-scenario code path. A test greps production `js/` (excluding the new module's test) for `486295|489439|97600` and the scenario file names; the loader must take the doc as an argument, never fetch a hard-coded path from shared modules.
2. **Classification completeness:** every leaf value carries `classification ∈ {observed, derived, modeled, user_entered, not_available}`; `null` values must carry `verify: true`; `observed` values must carry `source`. The validator enforces all three (sabotage-tested).
3. **No stale script figures:** `94100`, `536000`–`594000`, `87.3`, `82.2` must not appear in any fixture (regex test) — repo-verified figures only.
4. **Hypothesis discipline:** `land.hypothesis_to_test === true` required when a `disposition_model` is named; `is_commitment: false` required on assistance ranges and stewardship candidate; validator rejects `is_commitment: true` anywhere in this phase (no commitments exist).
5. **Counts reconcile:** bedroom-mix Σcount = AMI-mix Σcount = `total_units` (validator + sabotage).
6. **`not_available` is never 0:** TDC-dependent derivations return the string state, not zero (test asserts subsidy-per-unit is `not_available`, not 0, on the baseline fixture).
7. **Banned language** (strict set — this feeds Tier-2 but fixtures travel): `forecast`, `capture rate`, `absorption`, `sellout`, `time-phasing`, plus `committed`/`guaranteed` may not describe any assistance/stewardship value.
8. Existing modules untouched (`subject-project.js` read-only; adapter lives in the new module).

## File allowlist
- `data/fixtures/fruita-commons.scenario.json` + the three variant fixtures (new)
- `js/project-market-study/project-scenario.js` (new)
- `test/project-scenario.test.js` (new)
- `package.json` (`test:project-scenario` after `test:land-disposition` in `test:ci`)
- `README.md` inventory (+1 js file)
- **`data/_manifest.json`** — regenerate (`npm run audit:file-manifest`; four new data files)
- Nothing else.

## Tests required (house conventions; hand derivations for pinned numbers)
- Schema validation passes on all four fixtures; each hard rule above has a negative test (invalid doc rejected) — QA sabotages the validator.
- **Pinned derivation, baseline fixture:** for the 90–100% band at the band midpoint (0.95), 3BR→4-person, conservative model: `maxAffordablePrice(97600, 0.95)` and gap vs 486,295 — pin both numbers with the derivation comment (QA recomputes cold).
- Assistance-range check: a band whose computed gap exceeds its range top reports `insufficient` (construct via the higher-cost HOA scenario); `unknown` when price/AMI inputs missing.
- Variant fixtures: counts reconcile; only program fields differ from baseline (deep-diff test); variants marked `modeled`.
- `toSubjectProject` produces rows the real `SubjectProject.set()` accepts (shape assertion against `js/components/subject-project.js` DEFAULT_SUBJECT keys — read, don't import mutate).
- Fixture-leak grep + stale-figure grep + banned-language grep.
- Regression: `test:ownership-finance`, `test:shared-equity-lifecycle`, `test:land-disposition`, `test:file-manifest`, `validate` — exit 0.

## Delivery
One branch, one PR, squash. PR description: schema decisions made, the pinned derivation, which fields await owner inputs (the `owner_inputs_pending` list), and any spec ambiguities resolved. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. All four fixtures validate; QA's independent schema walk agrees; classification/source/verify completeness holds on every leaf.
2. Pinned derivations match QA's cold recompute (engine calls, band midpoint convention, household-size-by-bedroom convention as documented).
3. Fixture-leak, stale-figure, and hypothesis-discipline rules hold under QA's sabotage (inject a leak, a stale figure, an `is_commitment: true`, a count mismatch, a null-without-verify — each must fail).
4. `not_available` semantics verified (no zeros from missing TDC).
5. Allowlist + manifest + README + regression green; full `test:ci` green.

---

## AMENDMENT v1.1 (2026-08-05) — generic `partners` block

**Status: part of the spec.** If implementation is already in flight, incorporate before opening the PR; Claude QA judges against the amended spec. Rationale: the schema must serve **any** housing authority / development partner / steward combination (refinement §17 names developer, lender, steward, administrator roles in the recommendation output) — partner identities are data, never code. Fruita HA / HRWC are seed values; **Indibuild is NOT assumed** — no development agreement exists.

### Schema addition (top-level, optional array)
```jsonc
"partners": [
  { "role": "land_owner",  "name": "Fruita Housing Authority", "provider_id": null,
    "is_commitment": false, "classification": "user_entered" },
  { "role": "steward",     "name": null, "provider_id": "hrwc",
    "is_commitment": false, "classification": "user_entered",
    "note": "candidate only — general availability, no project commitment" },
  { "role": "developer",   "name": null, "provider_id": null, "is_commitment": false,
    "verify": true, "owner_input_required": true, "classification": "not_available",
    "note": "no development agreement exists; Fruita Mews partnership is capacity evidence, not a commitment" },
  { "role": "lender",      "name": null, "provider_id": null, "is_commitment": false,
    "verify": true, "owner_input_required": true, "classification": "not_available" }
]
```

### Validator rules (add to `validate`)
- `role ∈ {developer, steward, lender, counselor, administrator, land_owner, broker}`; unknown role rejected.
- **`is_commitment` must be `false` on every partner** (same hypothesis discipline as assistance/stewardship — no commitments exist in this phase); `true` rejected.
- At most one `land_owner`.
- When `provider_id` is non-null AND the caller passes a `registries` argument (`{ stewardshipProviders }`), the id must resolve — unresolvable id rejected; without `registries` the check is skipped (module stays pure).
- Each partner entry carries `classification`; `null` name+provider_id requires `verify: true`.
- `partners` may be absent or empty (valid — roles unknown is a first-class state).

### Fixture + test additions
- Baseline fixture: the four entries above verbatim (developer/lender null — **owner inputs**, now part of `meta.owner_inputs_pending` as `development_partner` and `lender`). Variants inherit unchanged.
- Tests: unknown role rejected; `is_commitment: true` rejected; two land_owners rejected; `provider_id: "hrwc"` resolves against the real `stewardship-providers.json`; a bogus id fails when registries passed; null-name-without-verify rejected.
- QA sabotage will additionally inject `{"role":"developer","name":"Indibuild","is_commitment":true}` — must fail (the named-partner-as-commitment trap).

### Acceptance criteria — append
6. `partners` block present in the baseline fixture per the amendment; validator enforces all five rules; the Indibuild-as-commitment sabotage fails.
