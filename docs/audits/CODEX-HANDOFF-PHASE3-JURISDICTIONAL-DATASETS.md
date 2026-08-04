# Codex Handoff — Phase 3: Jurisdictional Ownership Datasets (Providers, Funding, Stewardship)

**For:** Codex (implementer)
**QA:** Claude Code reviews against the acceptance criteria at the bottom (independent schema validation, source-URL probing, guardrail greps, sabotage checks — same discipline as PRs #1390/#1392).
**Date:** 2026-08-04
**Depends on:** Phases 1–2 merged (#1388, #1390, #1392). This phase is **data + schema + tests only** — no computation modules, no UI.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 3 row), §5.1–§5.4 (schemas); reference docs `docs/methodology/HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` (structure types + capacity tiers §5b), `docs/methodology/LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md` (contribution mechanisms + the waived/reduced/**deferred** timing distinction), `docs/methodology/CDOH-RURAL-URBAN-DESIGNATION-AND-COMPETITIVENESS.md` (funding-competitiveness block).

---

## What you are building

The data layer that Tier-1 (jurisdictional ownership strategy) and Phase 4 (Fruita scenario) will read:

1. **`data/policy/buyer-assistance-programs.json`** (new) — buyer-side assistance programs, starting with the HRWC deferred second (Revision-2 §5.3 schema verbatim). **Buyer-side lane — must never be read by the developer decision chain** (the existing consumer/developer separation tests extend to it).
2. **`data/policy/stewardship-providers.json`** (new) — stewardship/administrator providers with `geography_served`, `roles[]`, `programs[]`, `commitment_status`, per Revision-2 §5.4. HRWC is the seed entry (roles: homebuyer education, counseling, credit readiness, DPA origination, loan servicing, owner-occupancy monitoring, resale administration, foreclosure intervention, program stewardship — all `commitment_status: "available"`, none committed to any project).
3. **Extend `data/policy/developer-ownership-funding.json`** — add project-side sources with the §5.2 unified schema fields (`side`, `capital_stack_category`, `commitment_status`, `stacking_constraints`, and for local contributions `contribution_mechanism` + `timing` + `deferral_trigger`): DOLA Prop 123 homeownership/new-construction; FHLBank Topeka AHP (competitive) + Homeownership Set-Aside; CHFA construction financing; USDA RD 502 Direct + Guaranteed (buyer-side first mortgages — mark `side: "buyer"`, they belong in the dataset for stack visibility but must carry the buyer-side flag); employer-assisted/CRA/foundation as `unverified` placeholders; and a Fruita tap-fee-deferral + permit-waiver pair modeled on `docs/audits/phase1-draft-fixtures/fruita-mesa-local-contributions.draft.json`.
4. **Extend `data/hna/local-resources.json`** — three targeted changes, nothing else:
   a. **Fix the Fruita contamination (data bug):** `place:0828745` currently lists *Eagle County* employers ("Eagle County Government", "Vail Health (Edwards campus)", "Eagle County School District") and "Vail Health Eagle" as the hospital — wrong region entirely. Replace with Mesa County/Grand Valley entries (VERIFY each: e.g. Family Health West as the Fruita hospital/health system, City of Fruita, Mesa County School District 51 — confirm names against official sites and cite).
   b. **Enrich the Fruita + Mesa `housingAuthority` records** with the §5b structure fields: `structure_type`, `enabling_framework` (VERIFY-flagged), `taxing_authority`, `bonding_authority`, `powers[]`, `capacity_tier`, `activity_evidence`, `stewardship_capacity`. Fruita HA = `municipal` / `administrative` capacity tier (active-via-partnership — Fruita Mews with Indibuild is the evidence; cite `data/jurisdiction-briefs/0828745.json`). Do **not** mass-edit the other ~113 authorities in this PR — schema + two exemplar records only; statewide backfill is a follow-up.
   c. **Add HRWC as a `stewardship_providers` reference** on `place:0828745` and `county:08077` pointing at the new dataset by id (do not duplicate the full record).
5. **New tests:** `test/buyer-assistance-programs.test.js`, `test/stewardship-providers.test.js`, `test/ownership-funding-schema.test.js` (validates the extended developer dataset) — plus the wiring.

## Hard rules (test-enforced or QA-bounced)

1. **Commitment-status discipline (the load-bearing rule):** every program/source carries `commitment_status ∈ {available, anticipated, application_pending, awarded, committed, expired, unverified}`. Tests assert the enum AND assert a marker the future stack code will rely on: entries with `apply_to_gap: true` (or any "counts toward closing" flag) **must** have status `awarded` or `committed` — *availability is context, never money*. The existing Fruita Prop 123 `"Committed"` status is the precedent; normalize its casing in the new fields, don't break the old one.
2. **VERIFY discipline:** every dollar/percent term is either backed by `source_url` + `last_verified` (a real, dated, official page) or is `null` with `verify: true`. **No invented amounts, no guessed program terms.** If a page cannot be fetched (some sources hard-block bots — CHFA needs a browser UA; JCHS/DOLA may block entirely), leave the amount null + `verify: true` and say so in `source_note` — do not cite unread pages.
3. **Timing discipline (local contributions):** `timing ∈ {waived, reduced, deferred, in_kind}` with `deferral_trigger` required when deferred. A deferral is a carrying-cost benefit, **not** a TDC reduction — the schema note must state this (copy the sentence from `LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md` §3).
4. **Lane separation:** buyer-side data (`buyer-assistance-programs.json`, `homeownership-programs.json`) is never referenced by `js/hna/ownership-decision-chain.js` or `js/deal-calculator.js` — extend the existing byte-identity/no-read assertions (`test/ownership-decision-chain.test.js:110-114` pattern) to the new buyer file **without editing the existing test** (assert it from your new test files).
5. **Geography honesty:** HRWC's `geography_served` is Western Colorado — a test asserts no jurisdiction outside it references HRWC as steward, and that jurisdictions with no steward reference resolve to the flag string `"Permanent ownership stewardship capacity not established"` (put the canonical string in the stewardship dataset's meta so consumers share it).
6. **Structure ≠ capacity:** `capacity_tier ∈ {active_developer, administrative, nominal_paper}` must be accompanied by `activity_evidence` (non-empty for any tier above nominal_paper) and `capacity_last_verified`. No authority gets a tier by structure type alone.
7. **No ranking/recommendation language** in any new dataset (`recommended`, `best`, `preferred`) and the banned forecast/capture set stays out — same grep set as Phase 2b.
8. **No production JS changes.** Data + tests + wiring only. No edits to existing tests, modules, or the consumer `homeownership-programs.json`.

## File allowlist (exact expected diff — note the manifest, lesson from #1392)

- `data/policy/buyer-assistance-programs.json` (new)
- `data/policy/stewardship-providers.json` (new)
- `data/policy/developer-ownership-funding.json` (extended — existing 3 entries byte-preserved except schema-version bump in meta)
- `data/hna/local-resources.json` (the three targeted changes in §4 only — diff must show no other jurisdiction touched)
- `test/buyer-assistance-programs.test.js`, `test/stewardship-providers.test.js`, `test/ownership-funding-schema.test.js` (new)
- `package.json` (three `test:` scripts, inserted into `test:ci` after `test:land-disposition`)
- **`data/_manifest.json`** — regenerate with `npm run audit:file-manifest` (two new data files; #1392's miss, now in the allowlist)
- README inventory line is **unchanged** (it counts `js/` files only — verify with `node scripts/compute-inventory.mjs`, do not bump it)
- Nothing else.

## Tests required (plain Node `assert`, house conventions)

**Schema validation (all three datasets):** every entry has the required fields for its schema; enums validated (`commitment_status`, `timing`, `side`, `capital_stack_category`, `funding_type`, `capacity_tier`, roles); `source_url` is https and non-placeholder; `last_verified` is ISO or null-with-verify; amounts are number-or-null (null ⇒ `verify: true`).
**Commitment gate:** any gap-counting flag ⇒ status awarded|committed; a fixture entry with `available` + `apply_to_gap: true` must fail validation (test the validator, not just the data).
**Lane separation:** decision-chain and deal-calculator sources contain no reference to `buyer-assistance-programs`; consumer `homeownership-programs.json` byte-identical to main.
**Geography/stewardship:** HRWC scoped to Western CO; the canonical no-steward flag string present in meta; Fruita + Mesa reference HRWC by id only (no duplicated record).
**Fruita record:** `place:0828745` contains no `Eagle|Vail` strings (the contamination regression test); its `housingAuthority[0]` carries all §5b structure fields; `capacity_tier === 'administrative'` with non-empty `activity_evidence` citing Fruita Mews.
**Existing-suite protection:** `test:policy-data-currency`, `test:homeownership-programs`, `test:ownership-decision-chain`, `test:deal-calc-for-sale-feasibility`, `validate`, `validate:data`, `test:file-manifest` all green by exit code.

## Delivery

One branch, one PR, squash. PR description: entry-by-entry source table (source, URL, fetch method used, what was verifiable vs left VERIFY), the Fruita contamination before/after, and owner decisions needed (real HRWC terms; which local Fruita fee policies actually exist — expected answer for most amounts: null + VERIFY). Before opening: `npm run test:buyer-assistance-programs && npm run test:stewardship-providers && npm run test:ownership-funding-schema && npm run test:policy-data-currency && npm run test:homeownership-programs && npm run test:ownership-decision-chain && npm run test:file-manifest && npm run validate` — all by exit code. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA judges exactly this)

1. Schema validation passes on QA's independent walk of all three datasets (not just the PR's own tests).
2. **Source audit:** QA probes every `source_url` — a dollar amount whose page doesn't state it (or whose URL doesn't resolve) is a bounce; null+VERIFY entries are fine.
3. Commitment gate enforced by the validator (QA injects an `available`+`apply_to_gap` fixture — must fail).
4. Fruita record: contamination gone (no Eagle/Vail strings), replacements cite official sources, structure/capacity fields complete, no other jurisdiction's record altered (full-file diff check).
5. Lane separation + geography + no-ranking greps clean; existing 3 entries of `developer-ownership-funding.json` semantically unchanged.
6. Manifest regenerated (file-manifest green); README inventory untouched; `test:ci` chain green end-to-end.
7. Sabotage checks QA will run: flip an `available` entry to gap-counting; add an out-of-region HRWC reference; re-introduce an "Eagle County" employer; set an amount without a source; add a `rank` field — each must fail the new suites.
