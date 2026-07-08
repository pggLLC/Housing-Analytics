# Codex — Site Audit Phase 1: QA Harness Reliability (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **Three separate PRs, one QA gate each. Do not start the next item until the current one is merged.** Same rhythm as Phase 0.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source**: `docs/qa/site-audit-2026-07/04-plan.md` §Phase 1 (items 1.1–1.3). Findings C-03/C-04/C-05/C-06 in `03-hygiene-boundary-testing.md` are the underlying evidence — all three items independently re-verified against current code before writing this doc.

## Order

No dependency between the three items — do them in numeric order (1.1, 1.2, 1.3) for no reason other than that's how the plan lists them.

---

## 1.1 — Opportunity Finder verifier source-of-truth (P1)

**Verified**: `js/lihtc-opportunity-finder.js:297-311` (`SCORE_WEIGHTS`) and `scripts/audit/verify-opportunity-finder.mjs:54-66` (also `SCORE_WEIGHTS`, commented "Must match SCORE_WEIGHTS in js/lihtc-opportunity-finder.js exactly") have drifted on exactly one target: `4pct`. Production was rebalanced by F254b to `{ need: 0.30, recency: 0.17, basis: 0.15, pop: 0.20, civic: 0.18 }`; the verifier still has the pre-F254b values `{ need: 0.25, recency: 0.12, basis: 0.15, pop: 0.30, civic: 0.18 }`. All five other targets (`9pct`, `preservation`, `workforce_resort`, `prop123_local`, `any`) currently match exactly between the two files — this is not a systemic drift problem yet, just one silent miss that proves the copy-paste pattern is unsafe.

**Fix**: remove the duplicated `SCORE_WEIGHTS` (and `CDP_PENALTY`/`CDP_PENALTY_TARGETS`, which have the same "must match" comment and duplication risk) from `scripts/audit/verify-opportunity-finder.mjs`. Since the verifier is a `.mjs` script and the production file is a browser `(function(){...})()` IIFE assigning to `window`, direct `import` won't work without changes to the production file's export surface. Two acceptable approaches — pick whichever fits with less disruption:
  (a) Extract `SCORE_WEIGHTS` and `CDP_PENALTY`/`CDP_PENALTY_TARGETS` into a small shared JSON or `.mjs` module both files import/require, with `js/lihtc-opportunity-finder.js` reading it at runtime instead of hard-coding the object literal; or
  (b) Have the verifier deterministically extract the object literal from `js/lihtc-opportunity-finder.js`'s source at run time (regex or a small parse step) rather than maintaining a second copy, with a test asserting the extraction actually finds all 6 targets (not silently extracting zero and passing vacuously).

Whichever you choose, fix the immediate `4pct` drift as part of this PR (update the verifier's copy to match production, or better, make it structurally incapable of drifting).

**Tests**: `npm run test:lihtc-opportunity-finder-zori` must stay green. Add a test asserting the verifier's weights (how ever it now obtains them) equal `js/lihtc-opportunity-finder.js`'s `SCORE_WEIGHTS` for all 6 targets — this test should fail today before your fix (prove it's not vacuous the same way the Phase 0 guards did) and pass after.

**QA gate 1.1**: re-verify the `4pct` values are now correct in whatever mechanism replaced the duplicate, and deliberately edit one weight in `js/lihtc-opportunity-finder.js` locally to confirm the new test catches the drift (then revert the edit) — same non-vacuousness proof standard as Phase 0.3.

---

## 1.2 — HNA stub-era test retirement (P1, tests only)

**Verified**: `js/housing-needs-assessment.js` is a genuine compatibility stub (its own header says so explicitly — "This file has been split into focused browser-script modules under js/hna/... This stub remains for any legacy references and fails gracefully"). 11 test files currently reference it: `test/prop123-historical.test.js`, `test/hna-functionality-check.js`, `test/smoke.test.js`, `test/prop123.test.js`, `test/pages-availability-check.js`, `test/tigerweb-timeout.test.js`, `test/integration/projections.test.js`, `test/integration/economic-indicators.test.js`, `test/integration/compliance-dashboard.test.js`, `test/integration/housing-needs-assessment.test.js`, `test/audit-modules/logic-validation.js`.

**Scope, deliberately limited**: this is NOT "rewrite 11 test files." Per the plan: inventory what each of these actually asserts, then for each file decide one of three outcomes:
  1. **Migrate** — if the test is checking real HNA behavior (a calculation, a render, a data contract) that's better verified against `js/hna/*` modules or rendered DOM, move the assertion there.
  2. **Mark compatibility-only** — if the test exists purely to confirm the stub still loads without throwing (i.e., it's testing the stub's own contract, not HNA behavior), leave it, but add a one-line comment noting it's a stub-load check, not a behavior check, so a future reader doesn't mistake it for coverage of the real HNA modules.
  3. **Retire** — if a test duplicates coverage that already exists against `js/hna/*` modules elsewhere (check `test/hna-functionality-check.js`'s 730 checks and the various `test/hna-*.test.js` files before assuming any duplication — most real HNA coverage likely already lives there), remove the redundant stub-era assertion.

Do not delete `js/housing-needs-assessment.js` itself in this PR — the plan explicitly says "keep the stub until external links stabilize." This item is test-inventory triage, not a stub-removal project.

**Tests**: `npm run test:hna` (730+ checks) must stay green throughout. Any migrated assertion should land as a new or extended test in the relevant `test/hna-*.test.js` file, not invented from scratch — check whether the behavior is already covered there before writing a duplicate.

**QA gate 1.2**: for each of the 11 files, confirm the PR description states which outcome (migrate/mark/retire) was chosen and why. Spot-check 2-3 of the "retired" claims by confirming the coverage genuinely exists elsewhere (grep the target `test/hna-*.test.js` file for the equivalent assertion) before accepting a retirement — a retirement with no equivalent replacement is a coverage loss, not cleanup.

---

## 1.3 — Soft-funding freshness guard (P1, data QA scripts/tests only)

**Verified**: `data/policy/soft-funding-status.json`'s `lastUpdated` field is `2026-04-07` — over 3 months old as of this writing. 17 of 18 programs carry a non-null `contactUrl`. The existing weekly URL-health sweep (`.github/workflows/url-health-weekly.yml`) already covers `data/policy/*.json` for link-liveness — **do not duplicate that**, it's a separate concern (dead link vs. stale content). What's actually missing: nothing asserts `lastUpdated` is within any SLA window at all — `test/test_soft_funding_tracker.js` only checks the tracker loads gracefully when `lastUpdated` is `null`, never that staleness triggers a warning.

**Fix**: add a data-QA check — plain Node test or a small script wired into `validate:data` — that:
  1. Reads `data/policy/soft-funding-status.json`'s top-level `lastUpdated`.
  2. Fails (or warns, owner's call — pick one and document it) if `lastUpdated` is more than an owner-defined SLA window old (suggest 90 days as a starting default, since this is calendar-sensitive funding-program data; state your chosen window explicitly in the PR and in a comment next to the check).
  3. Separately confirms every program with a non-null `contactUrl` is a URL the weekly sweep would actually see (i.e., don't re-implement URL fetching here — just confirm the field is present and non-empty for every program that should have one, since a missing field silently opts a program out of the sweep's coverage).
  4. Add a documented owner-waiver mechanism (e.g., a `staleness_waived: true` + `waiver_reason` field per-program or file-level) so a deliberately-stale entry doesn't have to fail the build forever — but the waiver itself should be visible/loud in test output, not silent.

**Do not** refresh any dollar amounts, deadlines, capacities, or program descriptions in this PR — that's explicitly out of scope per the plan ("no program amount/deadline refresh"). This is a guardrail-only PR, same spirit as PR #1078 which fixed only URLs.

**Tests**: the new SLA check itself. `npm run validate:data` should incorporate it (or add a new `npm run test:soft-funding-freshness` script and wire it into `test:ci`, whichever fits the existing `validate:data` structure better — check how `validate:data` is composed before choosing).

**QA gate 1.3**: confirm the check actually fires today given the real `2026-04-07` `lastUpdated` (prove it's not vacuous — either it should currently fail/warn, or if the PR also updates `lastUpdated` as part of a legitimate content refresh that's happening anyway, that must be called out explicitly and separately from the guardrail addition itself, not silently bundled in). Confirm no dollar/deadline/description fields changed in the diff.

---

## Deliverables per item (PR description template)

1. Summary of what changed and why
2. Which audit finding (C-03/C-04/C-05/C-06) this closes
3. Verification: what you independently confirmed against current code, not just what the audit said
4. Non-vacuousness proof for any new guard/test (show it fails against the bug it's meant to catch)
5. Tests added and their results
6. Known limitations
