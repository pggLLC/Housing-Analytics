# Codex Handoff — Phase 3.1 (micro): `screening_apply` Flag for the Deal Calculator Ownership Stack

**For:** Codex (implementer) · **QA:** Claude Code (independent recompute + sabotage, as PRs #1390/#1392/#1394)
**Date:** 2026-08-04 · **Size:** deliberately small — one flag, one gate change, labels, tests.
**Depends on:** #1394 merged.
**Why:** #1394's commitment gate correctly flipped `apply_to_gap` to false on WMRHC/CHFA-DPA (availability ≠ money), but that left the Deal Calculator's **screening** stack vacuous — it now applies $0 and answers nothing. The owner has approved restoring screening-level display via a **separate flag with a distinct meaning**: `screening_apply` marks a source that may be *shown as potential* in the screening stack, explicitly labeled **"potential — not committed"**, while the hard commitment gate (`apply_to_gap` ⇒ `awarded|committed`) remains untouched for anything counted as real funding.

## Exact changes

### 1. Data — `data/policy/developer-ownership-funding.json`
- Add `"screening_apply": true` to **exactly two** entries — `wmrhc-good-deeds-buydown` and `chfa-dpa-layering` (restores the pre-#1394 screening behavior, no more). All other entries get `"screening_apply": false` explicitly (schema completeness).
- Add to `meta.methodology`: one sentence distinguishing the two flags — `screening_apply` = may appear as a potential source in screening displays, never counted as committed funding; `apply_to_gap` = counts toward closing a gap and requires `awarded|committed`.
- **Rule:** `screening_apply: true` requires a non-null amount term (`max_amount` or `max_percent` + `amount_type`) AND a dated `source_url`/`last_verified` — you can't screen with an unverified number.

### 2. JS — `js/deal-calculator.js` (minimal, two spots)
- `_developerFundingAmountPerUnit` gate (line ~245): `if (!program || (program.apply_to_gap !== true && program.screening_apply !== true)) return null;`
- Labels: in `computeDeveloperOwnershipFundingStack`, each applied source object gains `screeningOnly: program.apply_to_gap !== true`; in `renderDeveloperOwnershipFundingStack`, screening-only sources render with the suffix **" (potential — not committed)"** and the residual line keeps its existing "no unverified amount is counted" framing. Do not touch any other function; do not touch `ownership-decision-chain.js`.

### 3. Tests
- New `test/deal-calc-screening-apply.test.js` (jsdom, conventions of `deal-calc-for-sale-feasibility.test.js`): with the **real** funding doc, the stack applies **> 0** per unit again; every screening-only applied source carries the "potential — not committed" label in the rendered output; a fixture with `screening_apply: true` but null amounts is NOT applied; a fixture with `apply_to_gap: true` + status `available` still fails the schema validator (gate intact).
- Extend `test/ownership-funding-schema.test.js` **additively** (it's the Phase-3 file — add assertions, change none): `screening_apply` present on every entry as a boolean; true ⇒ amount + dated source; true does NOT satisfy or bypass the commitment gate.
- No pre-Phase-3 test file may change.

### 4. Wiring / hygiene
- `package.json`: `test:deal-calc-screening-apply`, inserted into `test:ci` after `test:deal-calc-for-sale-feasibility`.
- Run `npm run audit:file-manifest`; commit `data/_manifest.json` **if** it diffs (modified data file). README inventory unchanged (no new `js/` file).

## File allowlist
`data/policy/developer-ownership-funding.json` · `js/deal-calculator.js` (the two spots) · `test/deal-calc-screening-apply.test.js` (new) · `test/ownership-funding-schema.test.js` (additive) · `package.json` · `data/_manifest.json` (if diffing) · nothing else.

## Acceptance criteria (Claude QA)
1. With the real doc: WMRHC applies 30% × per-unit cost basis and CHFA DPA applies $25,000 (capped at the gap), matching QA's independent recompute; both labeled "potential — not committed" in rendered output.
2. Commitment gate unbroken: QA re-injects `available`+`apply_to_gap:true` — validator must fail; `screening_apply` cannot be used to count committed funding anywhere.
3. Sabotage: remove the "potential — not committed" label; set `screening_apply: true` on a null-amount entry; flip the gate change to ignore `apply_to_gap` — each must fail the suites.
4. `test:deal-calc-for-sale-feasibility`, `test:ownership-decision-chain`, `test:ownership-funding-schema`, `validate`, `test:file-manifest` all green; no pre-Phase-3 test modified.

Pre-open: `npm run test:deal-calc-screening-apply && npm run test:ownership-funding-schema && npm run test:deal-calc-for-sale-feasibility && npm run test:ownership-decision-chain && npm run test:file-manifest && npm run validate`. **Do not merge — stop after opening the PR for Claude QA.**
