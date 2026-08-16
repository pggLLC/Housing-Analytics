# Codex — Site Audit Phase 0: Guardrails (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **Four separate PRs, one QA gate each. Do not start the next item until the current one is merged.** Same rhythm as the Affordable Ownership Need / Combined Jurisdictions phases.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source**: `docs/qa/site-audit-2026-07/04-plan.md` §Phase 0 (items 0.1–0.4). Findings A-01/A-02/C-01/C-02 in `01-calculations-and-lineage.md` and `03-hygiene-boundary-testing.md` are the underlying evidence — all four have been independently re-verified against the current code before writing this doc (not just relayed from the audit report).

## Order — do item 0.4 first

0.4 is already fully diagnosed with file:line fixes sitting in the PR #1076 review thread — no new investigation needed, just execution. Items 0.1–0.3 come from the audit and need the same read-before-write discipline as everything else in this repo: verify each citation against current code before changing it, since code moves and audit citations can go stale.

---

## 0.4 — Combined Jurisdictions residual fixes (P0, do this first)

**Context**: PR #1076 merged with 5 of 7 QA must-fix findings from gate 2 still open. Full detail, verification steps, and reproduction paths are in the PR #1076 comment thread (two QA review comments, both titled "QA review" / re-review). This item is that fix list, unchanged.

**Files**: `js/hna/combined-geo.js`, `js/hna/hna-controller.js`, `js/hna/hna-renderers.js`, `js/hna/hna-export.js`, `js/hna/hna-ownership-need.js`.

1. **Mode B ("Compare with County" paired view) does not exist.** The spec (`docs/audits/CODEX-HANDOFF-PHASED-IMPLEMENTATION-2026-07.md` §Phase 2) requires a non-aggregating side-by-side place+county view. Currently only an error message references it ("Use the place + containing county paired view instead" in `combined-geo.js`) with no implementation anywhere. Build it, reusing `js/hna/hna-comparison.js`'s side-by-side machinery where practical — or, if descoping, remove the error message's reference and say so explicitly in the PR description as a documented cut, not a silent gap.
2. **AMI-gap masking bug.** `renderCombinedAssessment` in `hna-renderers.js` never reads `result.availability.amiGap.available` (which `combined-geo.js` correctly computes as `false` when a combo member lacks a gap record). It renders the partial sum unconditionally. Gate the `statGap*`/`statTierGap*` block on that flag; show "Not available — one or more members missing AMI-gap data" when false.
3. **Combined-mode exports don't export combined data.** `js/hna/hna-export.js`'s `_rankingEntry`/`_metricsFromHnaState` lookups are keyed by real place/county GEOIDs or read `window.HNAState.state.chasData/lastProfile`, none of which `updateCombined()` populates. A combined-area PDF/Excel download currently shows stale single-geography numbers under a "Combined members: ..." header. Wire the export to read from the combined result object the same way `renderCombinedAssessment` does.
4. **Ownership Need source pill mislabeled for combined areas.** `sourceLabel()` in `js/hna/hna-ownership-need.js` only special-cases `'state'` and `'county'`; `geoLevel: 'combined'` falls through to `'place-CHAS'`. Every other stat on the same combined-mode panel correctly says "Combined · DERIVED" — add a `'combined'` branch to `sourceLabel()`.
5. **`state.current.geoType === 'combined'` leaks unguarded into unrelated subsystems.** No guard exists anywhere for this value outside the combined-geo module itself. Concrete reachable failures: `applyAssumptions()` in `hna-controller.js` treats `'combined'` as a place (its branch condition is `geoType !== 'county' && geoType !== 'state'`) and can silently overwrite the "Not available for combined areas" projection placeholder — reachable via the "Save custom scenario" button and 5 other call sites; the permanently-registered Leaflet `moveend` listener (`updateLihtcInfoPanel`) feeds `state.current.geoid` to several map-mounted widgets (LIHTC recency badge, CapitalPartners, TaxAbatement, ResortWfh, MhiAmiClarifier, RentTriangulation, ChfaAwardHistory) that all silently go blank for `geoid: 'combined'`; `beforeunload` broadcasts `ComplianceChecklist.broadcastChecklistChange({geoType:'combined', geoid:'combined'})`, polluting a real cross-tab storage key. Fix by gating each of these three call sites on `geoType !== 'combined'` up front, rather than trying to make every downstream consumer combined-aware.

Two known-fixed items from the prior QA round that do NOT need re-fixing (verify they're still fixed, don't touch): stale LIHTC map markers now clear on combine transition (`_clearCombinedMapOverlays()`); member-type validation now rejects unknown/state geoTypes instead of silently coercing them.

**Tests**: extend `test/combined-geo.test.js` with one case per item above (Mode B UI presence if implemented; AMI-gap availability gating; export sourcing from combined result; source-pill label; each of the three `geoType==='combined'` guards).

**QA gate 0.4**: re-verify all 5 items with concrete repro (not just reading the diff) — the same rigor as the two prior QA rounds on this PR. Priority checks: build a combo where one member lacks an AMI-gap record and confirm the UI discloses partial data instead of showing a number; download a combined-area export and confirm the numbers match the on-screen combined result, not a prior single-geography view; toggle combine mode, then click "Save custom scenario" and confirm the projection panel still says "Not available" afterward.

---

## 0.1 — Home-value single source (P0)

**Verified**: the stat card (`js/hna/hna-renderers.js:14-40` `homeValueInfo()`, called at `~line 384-397`) uses a display cascade — prefers a `profile.median_home_value` object (ZHVI current-market, county-adjusted estimate, or an explicit `acs_raw` floor) with its own `source`/`as_of`/`confidence`/`suppress_income_to_own` fields, falling back to raw `DP04_0089E` only when that object is absent. The narrative (`js/hna/hna-narratives.js:60-72` builds `ctx.medianHomeVal`, rendered `~line 407-426`) reads raw `DP04_0089E` directly — bypassing the cascade entirely — and hardcodes the literal string `'(ACS 2020–2024)'` regardless of what vintage or source the stat card actually used. On the same page, for the same jurisdiction, these can disagree on both the number and the vintage claim.

**Fix**: extract `homeValueInfo(profile)` (or equivalent) into a shared helper both the stat-card renderer and the narrative builder call, and have the narrative's `ctx.medianHomeVal` / vintage string come from that shared object's `value`/`source`/`as_of`/`suppress_income_to_own`, not a second independent read of `DP04_0089E`. Preserve the narrative's existing sentence structure and mortgage-affordability framing — this is a data-source fix, not a copy rewrite. Handle the `suppress_income_to_own` case (the narrative currently has no equivalent to the stat card's suppression logic) by omitting the affordability sentence, matching the pattern used elsewhere in this repo for suppressed values.

**Note, not in scope for this item**: the narrative's income-needed-to-afford math (`medianHomeVal * 0.20`, a rule-of-thumb) is a third, cruder mortgage-affordability formula on this site, distinct from `HNAUtils.AFFORD` (used by the "income to buy" stat) and from `js/hna/hna-ownership-need.js`'s PITI+PMI assumptions (used by the Ownership Need module). Do not touch that formula in this PR — flag it as a follow-up if it seems worth unifying, but 0.1 is about display value/source/vintage agreement only.

**Tests**: new cross-surface test asserting stat and narrative render the identical value/source/vintage for the same profile, across at least: raw ACS, ZHVI, county-adjusted, and suppressed cases. Existing `npm run test:hna`, `node test/hna-home-value-cascade.test.js` must stay green.

**QA gate 0.1**: pick 2-3 real jurisdictions covering different cascade sources (check `profile.median_home_value.source` values in the live data to find examples of each) and confirm the stat card number/vintage and the narrative sentence's number/vintage now match exactly.

---

## 0.2 — Preservation label split (P0)

**Verified**: `scripts/build-affordable-housing-properties.js`'s `normalizePreservation()` (~line 137) hard-assigns `program_type: ['preservation-candidate']` to every CHFA Preservation database record, with `years_to_expiration: null` — i.e., the tag means "sourced from this feed," not "assessed as at-risk." Confirmed against live data: of 1,920 total records in `data/affordable-housing/properties.json`, only 109 carry a non-null `years_to_expiration`. But the map legend (`js/components/affordable-housing-layer.js:124-128`) describes the tag as: *"Property at risk of losing affordability restrictions — use restriction expiring, FHA loan maturing, or LIHTC compliance period ending."* A user reading the legend has no way to know ~94% of tagged properties carry no actual risk signal.

**Fix**: split source-membership from risk assessment. Add a `risk_status` (or similar) field distinct from `program_type` — populate it only where a real risk signal exists (`years_to_expiration` present and within a reasonable horizon, or another owner-defined risk criterion), leaving it `null`/`unknown` otherwise. Update the legend text to describe `preservation-candidate` accurately as source-feed membership (e.g. "Tracked in CHFA/HUD/USDA preservation-source inventory") and add a separate, honest legend entry or badge for the true risk flag where it exists. Keep the existing inventory counts and `program_type` array shape — this is a labeling/schema-addition fix, not a data removal.

**Downstream copy** (per audit finding A-04, same root cause): `js/compare.js:720-722` and `js/market-analysis/market-report-renderers.js:244-264` present preservation-candidate counts in market-opportunity/at-risk framing. Update this copy to say "tracked subsidized/preservation-source inventory" and reserve "at risk" language for records with the new true risk flag. Verify these two citations against current line numbers before editing — the audit report is one day old but line numbers drift fast in active files.

**Tests**: property schema test asserting `risk_status` (or your chosen field name) is `null` unless a real risk criterion is met; targeted render test confirming the legend text no longer claims universal risk for `preservation-candidate` membership.

**QA gate 0.2**: re-run the 1,920/109 count after the fix and confirm the new risk field's count matches (or is a deliberate, documented subset of) the 109 with real expiration data. Spot-check the legend and at least one compare/market-report render for corrected language.

---

## 0.3 — Semantic label guard (P0, tests/schema only)

**Purpose**: 0.1 and 0.2 are two instances of the same failure mode — a label or displayed value implies more analytical weight than the underlying data supports, and nothing in the test suite catches it. This item adds a guard so a *third* instance doesn't ship silently.

**Scope**: tests/schema only, no application code changes beyond what's needed to make labels declare their own evidence type.

**Build**: a semantic-label convention (e.g., a small schema/lint check) that requires any field or displayed string containing `candidate`, `risk`, `recommendation`, or `classification` to declare, adjacent to it, whether the value is: computed (derived from a formula over real inputs), curated (owner-reviewed), source-membership (present because a record came from a specific feed), or modeled (screening estimate, not measured). Wire this as a new test that scans the relevant schemas/builders (`scripts/build-affordable-housing-properties.js`, `js/hna/hna-ownership-need.js`'s `tenureMixRecommendation`, any ranking/scoring label) and fails if a matching field lacks a declared evidence type.

**Tests**: the guard test itself. Should catch the pre-fix state of 0.2's `preservation-candidate` tag (source-membership, undeclared) as a regression check — i.e., write the test against a fixture that reproduces the old bug, confirm it fails, then confirm 0.2's fix makes it pass.

**QA gate 0.3**: confirm the new test actually fails against a deliberately-reintroduced instance of the 0.2 bug (prove it's not a vacuous check), and passes clean on current main after 0.1/0.2 land.

---

## Deliverables per item (PR description template)

1. Summary of what changed and why
2. Which audit finding (A-01/A-02/C-01/C-02, or the PR #1076 QA thread) this closes
3. Verification: what you independently confirmed against current code, not just what the audit/prior review said
4. Tests added and their results
5. Known limitations
