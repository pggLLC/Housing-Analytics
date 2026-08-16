# QA Brief — PR #1388 (Multi-Model Ownership Finance Engine, Phase 1)

**For:** Codex (independent QA reviewer)
**Author of the PR under review:** Claude Code — **role-inverted for this PR**: Claude implemented, so Codex QAs. Do not trust the PR description or code comments; verify against the spec and by execution.
**Spec of record (predates the implementation):** `internal/docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §1 (multi-model directive + guardrails) and §10 (the exact Phase 1 prompt). The PR is judged against the spec, not against itself.
**Branch:** `feat/ownership-finance-engine` · PR: https://github.com/pggLLC/Housing-Analytics/pull/1388
**Verdict required:** end with exactly one of **PASS**, **PASS WITH FIXES REQUIRED** (list them), or **FAIL** (with evidence).

---

## 0. Ground rules

- Execute everything yourself; do not accept green-checkmark claims.
- Read the diff (`git diff origin/main...feat/ownership-finance-engine`) — flag anything outside the expected surface: `js/hna/ownership-finance.js` (new), `data/policy/affordability-models.json` (new), `js/hna/hna-ownership-need.js` (delegation block only), `deal-calculator.html` + `housing-needs-assessment.html` (one script tag each), `test/ownership-finance.test.js` (new), `package.json` (two lines), `data/_manifest.json` (regenerated), plus docs. **Any other production-file change is a finding.**
- The PR must NOT touch: `data/policy/homeownership-programs.json` (consumer lane), any `scripts/`, workflows, robots/sitemap/CNAME, or weaken any existing test.

## 1. Backward-compatibility (the hard contract)

```bash
npm run test:ownership-finance
npm run test:hna-ownership-need && npm run test:ownership-resale && npm run test:ownership-decision-chain
npm run test:deal-calc-for-sale-feasibility && npm run test:deal-calc-mortgage-math && npm run test:deal-calc-ami-bands && npm run test:deal-calc-correctness
npm run test:homeownership-programs && npm run test:file-manifest && npm run validate
```
- [ ] All green **by exit code** (jsdom suites print benign "AMI gap data unavailable" noise — check `$?`).
- [ ] Golden fixture: `node -e "console.log(require('./js/hna/ownership-finance.js').maxAffordablePrice(100000,0.80))"` → **289983**.
- [ ] **Diff check on existing tests:** `git diff origin/main...HEAD -- test/ | grep -v ownership-finance` must show **no modifications** to any pre-existing test file.
- [ ] Parity claim: vm-load `hna-ownership-need.js` with and without `window.OwnershipFinance` and compare `maxAffordablePrice` over your OWN grid (don't reuse the PR's grid — pick different AMIs/pcts, include odd values like `amiPct: 0.735`, custom assumptions). Any divergence = FAIL.

## 2. Sabotage tests (prove the tests actually bite)

Temporarily break things; the suite must fail loudly each time (revert after):
- [ ] Change `DEFAULTS.rateAnnual` to 0.066 → golden + parity tests must fail.
- [ ] Set `default: true` on a second registry model → registry test must fail.
- [ ] Delete `implications.buyer_risk` from `conventional_dti` → implications test must fail.
- [ ] Swap the two script tags in `deal-calculator.html` (kernel before engine) → ordering test must fail.
- [ ] In `modelParams`, delete the `downPaymentPct → downPaymentRate` mapping → the pinned canonicalization regression must fail (this was a real bug caught in dev; confirm the pin works).

## 3. Spec-conformance spot checks (from Revision-2 §1/§10)

- [ ] `recommendedModel()` returns the registry default and **cannot** return the most permissive model under any registry ordering (reorder `models[]` and re-check).
- [ ] Every `compareModels` result more permissive than the default has `riskDisclosureRequired: true` and non-empty `riskDisclosure`.
- [ ] Percent/decimal guard: `maxAffordablePrice(100000, 0.8, {rateAnnual: 6.5})` throws with a clear message; same for a ratio ≥ 1.
- [ ] Household size: `householdSize: 4` is a no-op vs the two-arg call; 1–3 lower, 5+ raise; factors match HUD's standard 10%-down/8%-up derivation.
- [ ] Zero-interest (`rateAnnual: 0`) → finite positive price; fixed costs > budget → price **0** (not negative/NaN); bad income → **null**.
- [ ] No banned language: `grep -in "forecast\|capture rate\|time.phasing" js/hna/ownership-finance.js` → nothing (screening-layer file).
- [ ] Registry data quality: every model has `params`, full `implications` (5 fields), `classification`, and unverified rates carry `verify: true` (FHA MIP, USDA fees must be `verify: true` — they are not dated).

## 4. Semantic / design review (judgment, not checkboxes)

- Is the **alias-shadowing** behavior in `resolveAssumptions` (mirroring the legacy kernel: canonical defaults shadow alias inputs) correctly contained — i.e., does the NEW registry path (`modelParams`) fully canonicalize, so no registry model silently inherits a default? Look for other registry keys that could shadow (e.g. `insuranceRate` vs `insurancePctAnnual`).
- Is dropping `frontEndRatioCap` / upfront fees (USDA/FHA) from the price computation an acceptable Phase-1 simplification given the `verify` flags, or does it overstate USDA/FHA capacity enough to mislead? Recommend a follow-up if so.
- Does the soft-delegation block in `hna-ownership-need.js` create any behavior difference when BOTH scripts load in a browser but the registry is NOT set? (It shouldn't — delegation passes explicit assumptions.)
- Any drift risk between `DEFAULTS` here and `CONSTANTS.affordabilityAssumptions` in the kernel / `HNAUtils.AFFORD`? Is it test-guarded? If not, recommend a parity assertion.

## 5. Out-of-scope confirmation

- [ ] No UI, funnel, capture, lifecycle, scenario, or report code in the PR.
- [ ] `affordability-metrics-panel.js` and `hna-utils.js` are untouched (their delegation was explicitly deferred — confirm the PR description says so and the diff agrees).
- [ ] No Fruita value is hard-coded anywhere in production files (grep `486295\|489439\|97600` in `js/` — memo/docs are fine).

## 6. Report format

Findings ranked by severity, each with file:line + a reproducible command. Then the single verdict line. If PASS WITH FIXES REQUIRED, list the exact fixes; the author (Claude) will apply them and you re-verify only the affected checks.
