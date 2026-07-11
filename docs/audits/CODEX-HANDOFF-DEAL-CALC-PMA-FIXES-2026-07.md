# Codex — Deal Calculator + Market Analysis Audit Fixes (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **One PR per item unless noted, do not bundle unrelated items.**
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source**: Issues #1146, #1147, #1148, #1149, #1152 — a methodology audit of Deal Calculator and Market Analysis (PMA), giving both the same scrutiny HNA got earlier this session (where stale Census variable codes and null-coercion formula bugs were found and fixed). None of the 5 items below are active data-integrity bugs on that scale — this audit found the two modules in noticeably better shape. They're test-coverage gaps, a documentation/live-formula mismatch, and one live UI labeling conflict. All 5 findings were independently verified (formulas checked by hand against known-correct math, staleness confirmed against real file metadata, test gaps proven by running the actual test suite) before filing — see each issue for the verification detail; this doc doesn't repeat it, it specs the fix.

**Already closed, no action needed**: #1150 (PMA test enum typo) was small enough to fix directly, already merged (PR #1151) — the fixture pattern it establishes (`{units: 1200}` sized to land in a specific risk tier) is a useful reference for item 3 below. #1101 (deal predictor scope-boundary) is closed — both the Deal Calculator page and the concept-card widget were checked and have adequate disclaimers; no work needed there.

## Order

1. **#1146** (Deal Calculator regression test) — smallest, most isolated, no owner decision needed.
2. **#1152** (PMA test coverage gap) — same shape as #1146, do it next while the "add module.exports, test the real function" pattern is fresh.
3. **#1147** (benchmark staleness check) — new, small, standalone script. No dependency on 1/2.
4. **#1148** (rename conflicting "capture rate" labels) — needs one small owner call (exact label wording), otherwise straightforward.
5. **#1149** (vacancy threshold documentation mismatch) — do last. The full reconciliation needs an owner decision (which threshold is right); this doc specs a documentation-only stopgap that ships without waiting for that decision, and flags the full fix as a follow-up.

---

## 1. Deal Calculator: add regression test for DSCR/mortgage-sizing math (#1146)

**Verified correct, but untested**: `mortgageConstant(annualRate, termYears)` (`js/deal-calculator.js:99-105`) and the mortgage-sizing call site (`recalculate()`, ~line 2367-2378: `mortgage = (noi / dcr) / mortgageConstant(interestRate/100, term)`) were independently checked against the standard annuity mortgage-constant formula and confirmed correct — e.g. NOI=$500,000, DCR=1.20, rate=6.5%, term=35yr → mortgage constant ≈ 0.07250, supportable mortgage ≈ $5,747,244, and backing out debt service on that mortgage reproduces DCR=1.20 exactly. No test in the repo checks this.

**Blocker to fix first**: `js/deal-calculator.js` has no `module.exports`, and it is not currently Node-safe to `require()` directly because browser bootstrap code dereferences `window` at top level. Same gap #1152 has for `market-analysis.js`. Do not assume a guarded export block alone is enough — first isolate the pure helper(s) or guard browser-only bootstrap/top-level `window` access so the file can load in Node without changing browser behavior.

**Implementation**:
1. Make `js/deal-calculator.js` safe to import from Node while preserving its normal `<script>` behavior in `deal-calculator.html`. Acceptable approaches: guard browser-only top-level bootstrap with `typeof window !== 'undefined'`, or move `mortgageConstant` to a tiny shared helper module and have both browser code and tests use that helper. Keep the scope narrow; do not refactor the calculator UI.
2. Add a `module.exports` block (or export from the new helper, if you choose that route) exposing at minimum `mortgageConstant` (the pure, dependency-free function most worth testing directly). Follow the existing pattern already used in `js/pma-competitive-set.js` (which the current `test/pma-competitive-set.test.js` already `require()`s successfully) — check how that file structures its exports section and mirror it, rather than inventing a new convention.
3. Add a new test file (e.g. `test/deal-calc-mortgage-math.test.js`) asserting `mortgageConstant()` and the full NOI/DCR → mortgage calculation against 2-3 hand-computed fixtures. Suggested fixtures (all independently verified, safe to use as-is):
   - rate=6.5%, term=35yr → mortgage constant ≈ 0.072499 (assert within a small tolerance, e.g. ±0.000001)
   - NOI=$500,000, DCR=1.20, rate=6.5%, term=35yr → mortgage ≈ $5,747,244 (assert within ±$1 for rounding)
   - A second rate/term pair of your choice, computed the same way, to prove the test isn't just checking one magic number.
4. Add a dedicated npm script for the new test and append it to `test:ci`. This repo's CI test chain is explicit in `package.json`; a new `test/*.test.js` file will not run automatically unless wired into the script chain.

**Tests**: the new test file plus its `package.json`/`test:ci` wiring are the deliverable. Also run the full `test:ci` suite to confirm the import/export changes don't break anything that currently relies on `js/deal-calculator.js` being a browser script (check how it's loaded in `deal-calculator.html` — a `<script>` tag expects browser-global behavior; `module.exports` must be guarded by `typeof module !== 'undefined'` or avoided via a shared helper).

**QA gate**: run the new test, confirm it passes. Prove non-vacuous by temporarily changing `mortgageConstant`'s formula (e.g. drop the `* 12` annualization) and confirming the test now fails, then revert. Load `deal-calculator.html` in a browser, confirm the Supportable First Mortgage panel still renders a value (proves the `module.exports` addition didn't break browser loading).

---

## 2. PMA: rewrite test/pma-scoring.test.js to test the real functions (#1152)

**What's wrong**: `js/market-analysis.js` has no `module.exports`, so `test/pma-scoring.test.js` and `test/pma-confidence.test.js` re-type simplified copies of the scoring formulas inline and test those copies instead of the real code. Confirmed the reimplementation is materially incomplete for `scoreCaptureRisk`: the test's copy (`pma-scoring.test.js:66-71`) takes only `(acs, existingUnits, proposedUnits)` and always divides by `acs.renter_hh`; the real function (`js/market-analysis.js:726-746`) takes a 4th `chasEligible` argument and *prefers* CHAS LIHTC-eligible renters (≤80% AMI) as the denominator when available — the methodologically important part — with zero test coverage of that branch today.

**Implementation**:
1. Make the scoring helpers importable from Node without running browser-only page bootstrap. `js/market-analysis.js` currently touches `window` at top level, so simply appending `module.exports` will still make `require('../js/market-analysis.js')` fail. Either guard top-level browser access with `typeof window !== 'undefined'` or move the pure scoring helpers into a small shared helper module consumed by both `market-analysis.js` and tests. Keep the change narrowly scoped to importability and tests.
2. Add a `module.exports` block (or export from the new helper, if you choose that route) for the pure-function scoring helpers: at minimum `scoreCaptureRisk`, `scoreMarketTightness`, `scoreRentPressure`, and any other `score*` function `pma-scoring.test.js`/`pma-confidence.test.js` currently reimplements. Same dual-context guard pattern as item 1 when exporting from a browser-loaded file.
3. Rewrite `test/pma-scoring.test.js` (and `pma-confidence.test.js` if it has the same issue — check) to `require()` and call the real shared functions instead of the inline copies. Delete the inline reimplementations once the real ones are wired in — don't leave both.
4. Add a dedicated test for `scoreCaptureRisk`'s CHAS-branch behavior: (a) with `chasEligible = {value: N, ...}` populated, confirm the function uses `N` as the denominator, not `acs.renter_hh`; (b) with `chasEligible` absent/null, confirm it falls back to `acs.renter_hh`, matching current documented behavior.
5. Add/adjust npm scripts so the rewritten PMA scoring tests run in `test:ci`. `test:ci` does not glob all test files, so explicit wiring is required for the regression guard to matter in CI.

**Tests**: the rewritten test file is the deliverable, plus the new CHAS-branch test in item 4 above, and explicit `package.json`/`test:ci` wiring.

**QA gate**: run the rewritten test suite, confirm it passes against real `market-analysis.js` functions (not copies). Prove non-vacuous on the CHAS-branch test specifically: temporarily comment out the `chasEligible` preference in the real `scoreCaptureRisk` (force it to always use `acs.renter_hh`), confirm the new test fails, then revert. Run full `test:ci`.

---

## 3. Deal Calculator: freshness check for Novogradac/Freddie Mac benchmark files (#1147)

**What's wrong**: `data/market/novogradac-equity-pricing.json` and `data/market/freddie-mac-multifamily-outlook.json` were each added in a single one-time commit, have no refresh workflow, and no test checks their `as_of`/`vintage`/`next_expected_update` fields against a staleness threshold. Novogradac's own metadata states `"next_expected_update": "2026-07-01"`, which has already passed as of this audit (2026-07-10) with no update. **This is lower severity than a live bug** — the UI discloses the vintage honestly (shows `as_of` inline, links the source, tells the user to verify before quoting) — this is about making staleness visible in CI, not fixing a misleading display.

**Do not confuse this with `scripts/check-data-source-health.py`** — that script live-fetches external URLs from `data/source-registry.json` to confirm they're still reachable/parseable. These two files are static local snapshots with a stated *update cadence*, not live URLs being re-checked; the concern here is "has this local file gone stale past its own claimed refresh schedule," a different check.

**Implementation**: add a small, standalone script (e.g. `scripts/audit/benchmark-freshness-check.mjs` or `.py`, match whichever language convention feels more consistent with similar small scripts in `scripts/audit/`) that:
1. Reads `data/market/novogradac-equity-pricing.json` and `data/market/freddie-mac-multifamily-outlook.json`.
2. For each, parses `meta.as_of` (or `meta.vintage` if `as_of` is absent) and compares against today's date.
3. Warns (non-fatal exit code, matching this repo's "warn, don't block" convention for advisory checks — check `scripts/audit/duplicate-artifact-scan.mjs` from earlier this session for the exact style of a warn-only, always-exits-0 script) if the file is more than ~45-60 days past its `as_of` date, or if `next_expected_update` (when present) has passed.
4. Wire it into `npm run` as a new script (e.g. `audit:benchmark-freshness`) — **do not add it to the blocking `test:ci` chain**, since staleness here is advisory (the UI already discloses it honestly), not a hard failure the way missing summary-cache fields would be.

**Tests**: none required beyond the script itself running cleanly against current data (which will currently print a warning for Novogradac, given its passed `next_expected_update` — that's expected and correct, not a bug in the new script).

**QA gate**: run the new script, confirm it correctly flags Novogradac's already-passed `next_expected_update` and does *not* flag Freddie Mac's still-current `2026-Q2` vintage (next expected `2026-Q3`, not yet due as of this writing). Confirm the script exits 0 (warn-only) even when it prints a staleness warning.

---

## 4. PMA: rename conflicting "capture rate" labels (#1148)

**What's wrong**: two different, differently-defined formulas are both labeled "capture rate" in the live UI. `scoreCaptureRisk()` (`js/market-analysis.js:726-746`) computes a demand-pool ratio (units ÷ CHAS-eligible-or-ACS renter households) rendered into the permanent stat tile `#pmaCaptureRate` (`market-analysis.html:744`). `calculateAbsorptionRisk()` (`js/pma-competitive-set.js:276-297`) computes a competitive-supply-share ratio (`proposedUnits / (totalCompetitiveUnits + proposedUnits)`), rendered as narrative text at `js/pma-ui-controller.js:544`, also labeled "capture rate." A user can see both, differently defined, on the same page.

**Owner decision needed (small, low-stakes)**: exact replacement label for the `calculateAbsorptionRisk()` value. Suggested options: "Competitive Supply Share" or "Market Saturation" (matches the existing internal `SATURATION_LIMIT` constant name). Keep "Capture Rate" for `scoreCaptureRisk()`'s demand-pool value — it already matches CHFA/industry convention and is the one documented in `docs/PMA_SCORING.md`.

**Implementation** (once label is chosen):
1. `js/pma-ui-controller.js:544` (and any other rendering of `calculateAbsorptionRisk()`'s `captureRate` field under the "capture rate" label — grep for other usages before assuming line 544 is the only one) — change the displayed label text to the chosen replacement. Do not rename the underlying `captureRate` object field/variable name in `js/pma-competitive-set.js` unless you want to (that's an internal name, not user-facing — renaming it is optional cleanup, not required for this fix).
2. `docs/PMA_SCORING.md` — currently documents `scoreCaptureRisk`'s formula and `RISK.captureHigh = 0.25` threshold but says nothing about `calculateAbsorptionRisk()`'s `SATURATION_LIMIT = 0.10`. Add a short section documenting the competitive-supply-share formula exactly as implemented (`proposedUnits / (totalCompetitiveUnits + proposedUnits)`) and its threshold, using whatever label was chosen in step 1.

**Tests**: add a source-grep test (or extend `test/pma-competitive-set.test.js`) asserting the UI-facing label string used for `calculateAbsorptionRisk()`'s output is the new label, not "capture rate" — guards against this drifting back.

**QA gate**: run an enhanced PMA analysis (Commuting or Hybrid mode) on a real jurisdiction in a live browser, confirm both the stat tile and the narrative text now show distinctly-labeled values (not both saying "capture rate"). Confirm `docs/PMA_SCORING.md` renders the new section correctly (no broken formatting).

---

## 5. PMA: document the Land/Supply vacancy-threshold divergence (#1149) — stopgap only, full fix needs an owner decision

**What's wrong**: `docs/PMA_SCORING.md:90` documents the Land/Supply dimension with a 0.12 vacancy ceiling, matching `scoreMarketTightness()` (`js/market-analysis.js:796`). But `scoreLandSupply()` (`js/market-analysis/site-selection-score.js:594-624`) implements the same conceptual dimension with a different, deliberately-chosen 0.10 ceiling (its own comment justifies the number independently). `market-analysis.js:1003-1015` prefers the 0.10-threshold path (`scoreLandSupplyWithBridge`) whenever Bridge/MLS context is available, falling back to the documented 0.12 path otherwise.

**Currently dormant, not urgent**: `scoreLandSupplyWithBridge` only activates when `window.BridgeMarketSummary.isAvailable()` is true, which requires `BRIDGE_BROWSER_TOKEN` to be configured — confirmed empty by default in `js/config.js:24`. Every current deployment without real Bridge/MLS credentials uses the documented 0.12 path today. This is incidental, not by design — nothing prevents the silent switch once Bridge access is configured (which the repo's own comments frame as a "when," not "if").

**Do NOT reconcile the two thresholds to one value in this pass** — that's a real methodology call (is 0.10 or 0.12 the right vacancy ceiling for this scoring dimension?) that needs the owner's input, not Codex's. Ship the stopgap below now; file a follow-up issue for the owner-decision reconciliation rather than guessing.

**Implementation (stopgap, no owner decision needed)**:
1. Add a code comment at the preference point (`market-analysis.js:1008`, where `scoreLandSupplyWithBridge` is chosen over `scoreMarketTightness`) explicitly noting: "NOTE: this Bridge-gated path uses a 0.10 vacancy ceiling, different from `scoreMarketTightness`'s documented 0.12 (`docs/PMA_SCORING.md`). Currently dormant since Bridge isn't configured by default — flag to whoever enables real Bridge/MLS access that this divergence exists and needs an owner decision (see issue history for #1149)."
2. Update `docs/PMA_SCORING.md`'s Land/Supply section to describe *both* thresholds and *both* code paths (which one fires when), rather than only documenting the 0.12 path as if it were the only one. Make clear which is the current default (0.12, absent Bridge) and which is dormant (0.10, Bridge-gated).
3. File a new, separate issue (title suggestion: "PMA: reconcile Land/Supply vacancy thresholds (0.10 vs 0.12) before enabling Bridge/MLS access") capturing the open owner decision, referencing this doc and #1149, so the reconciliation isn't lost once this stopgap ships.

**Tests**: none required — this is a documentation/comment-only change.

**QA gate**: read the updated `docs/PMA_SCORING.md` section and confirm it accurately describes both code paths without asserting one is "correct." Confirm the new issue was filed and cross-references #1149.

---

## Deliverables per item (PR description template)

1. Summary of what changed and why, and which issue it closes.
2. Verification: what you independently confirmed against current code (line numbers drift — recheck them), not just what this doc said.
3. Tests added and their results, including non-vacuousness proof where specified.
4. For item 4: which label was chosen and why (if the owner picked something other than the two suggestions).
5. For item 5: confirmation the new follow-up issue was filed, with its number.
