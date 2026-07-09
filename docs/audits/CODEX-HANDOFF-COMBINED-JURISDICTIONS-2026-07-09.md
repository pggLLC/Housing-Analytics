# Codex — Combined Jurisdictions residuals + HNA decision strip + test-pattern note (2026-07-09)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. One PR per item — do not bundle. Same rhythm as prior phase handoffs.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source issues**: #1091, #1092, #1093, #1096, #1099 — all independently re-verified against current `main` (commit `e98b59aac`) before writing this doc, not just relayed from issue text. Line numbers below are current as of that commit.

---

## Order

Do #1091 and #1092 first (small, isolated, highest-value bug fixes). #1093 next (six independent cleanup items — feel free to split into separate PRs, one per checklist item, if that's easier to review). #1096 and #1099 are lower priority and can come last.

---

## 1. #1091 — Combined-area home value never populates (P1)

**Files**: `js/hna/hna-controller.js`, `js/hna/hna-renderers.js`

**Verified root cause**: `_loadCombinedDatasets()` (`hna-controller.js:392-405`) builds a `datasets` object with 7 keys — `placeChas`, `countyChas`, `amiGapPlace`, `amiGapCounty`, `placeCountyLookup`, `crossCountyPlaces`, `aliases` — but no `homeValues` key. Meanwhile `combined-geo.js:358-360` already has the aggregation code written and waiting:

```js
medianMetrics: {
  homeValue: weightedMetricRange(validation.members, datasets, function (member, _rec) {
    var home = datasets.homeValues && datasets.homeValues[member.geoid];
    return home && (home.value != null ? home.value : home.median_home_value);
  }, ...)
}
```

Since `datasets.homeValues` is always `undefined`, `home` is always `undefined` for every member, `weightedMetricRange` (`combined-geo.js:270-291`) filters out every row (`value == null` check), and `available: rows.length > 0` is always `false`.

On top of that, `renderCombinedAssessment` (`hna-renderers.js:7893`) never reads this result at all — it unconditionally hardcodes `_combinedSetText('statHomeValue', 'Range / modeled average')` regardless of what `result.medianMetrics.homeValue` contains.

**Data source to wire in**: `data/hna/home-value-cascade.json`. Schema (from its own `meta.schema`): `{ places: { <7-digit place GEOID>: { value, source, as_of, confidence, ... } } }`. This is place/CDP-level only — it has no county entries, so county members in a combo will naturally have no match and get filtered out by `weightedMetricRange`'s existing `value == null` skip (that's correct, expected behavior, not a bug to fix).

**Fix**:
1. In `_loadCombinedDatasets()`, add `homeValues: await loadJson('data/hna/home-value-cascade.json').then(function(d){ return d && d.places; })` (or equivalent — match the existing `loadJson` call style in that function) as an 8th key.
2. In `renderCombinedAssessment`, replace the hardcoded `_combinedSetText('statHomeValue', 'Range / modeled average')` with a read of `result.medianMetrics.homeValue`: if `available`, format `min.value`–`max.value` range plus the `weightedAverage` (the shape already includes `min`, `max`, `weightedAverage`, `method: 'MODELED'`, and a `caveat` string — reuse the existing `caveat` text for `statHomeValueSrc` rather than the current hardcoded string). If not available (e.g. an all-county combo), keep a "Not available" message, not the old always-on placeholder.

**Tests**: extend `test/combined-geo.test.js` with a case asserting a combo of 2+ places (not counties) produces a populated `medianMetrics.homeValue` (`available: true`, non-null `weightedAverage`) instead of the current always-`false` result, and a DOM-level or renderer-level check that `renderCombinedAssessment` displays that value instead of the static placeholder string.

**QA gate**: build a combo of 2 real places with known ZHVI entries (check `data/hna/home-value-cascade.json`'s `places` object for two GEOIDs with `source: "zhvi"` to pick real examples), confirm the rendered home-value stat shows an actual range/average instead of the literal text `"Range / modeled average"`, and confirm an all-county combo still shows "Not available" rather than throwing or showing a bogus value.

---

## 2. #1092 — 7th combined member silently dropped after success announcement (P1)

**File**: `js/hna/hna-controller.js`

**Verified root cause**: `_addCurrentCombinedMember()` (lines 308-320):

```js
function _addCurrentCombinedMember() {
  const member = _memberFromCurrentSelect();
  if (!member) { ... return; }
  const key = member.geoType + ':' + member.geoid;
  const list = window.HNAState.state.combinedMembers || [];
  if (!list.some(m => (m.geoType + ':' + m.geoid) === key)) list.push(member);
  window.HNAState.state.combinedMembers = list.slice(0, 6);
  _renderCombinedChips();
  if (typeof window.__announceUpdate === 'function') window.__announceUpdate('Combined member added: ' + _labelForMember(member));
}
```

Push happens unconditionally, then `.slice(0, 6)` truncates to the cap, then the aria-live announcement fires unconditionally — even when the just-pushed member was the one truncated out. A user adding a 7th member hears "Combined member added: X" but X never appears in the chip list or the aggregation.

**Fix**: check the cap *before* pushing/announcing. Existing precedent in the same file: `_memberFromCurrentSelect()` returning `null` triggers `window.HNARenderers.setBanner(..., 'warn')` (line 311) instead of a silent no-op — reuse that same warning-banner pattern for the cap case. Example shape (adjust to match existing helper signatures exactly):

```js
function _addCurrentCombinedMember() {
  const member = _memberFromCurrentSelect();
  if (!member) {
    window.HNARenderers.setBanner('Combined areas can include only places, CDPs, or counties. Select County or Incorporated Place (+ CDP) first.', 'warn');
    return;
  }
  const key = member.geoType + ':' + member.geoid;
  const list = window.HNAState.state.combinedMembers || [];
  if (list.some(m => (m.geoType + ':' + m.geoid) === key)) return; // already present, no-op
  if (list.length >= 6) {
    window.HNARenderers.setBanner('Combined areas support up to 6 members.', 'warn');
    return;
  }
  list.push(member);
  window.HNAState.state.combinedMembers = list;
  _renderCombinedChips();
  if (typeof window.__announceUpdate === 'function') window.__announceUpdate('Combined member added: ' + _labelForMember(member));
}
```

(The exact wording/banner type is your call — match whatever's most consistent with other cap/limit messages already in this file, if any exist.)

**Tests**: add a case to `test/combined-geo.test.js` (or wherever controller-level logic is already tested) asserting: adding a 7th member does NOT trigger `__announceUpdate`, the member list stays at exactly 6, and the 7th candidate never appears in the list at any point (not "added then removed").

**QA gate**: manually add 7 members in the browser; confirm the 7th shows the cap warning instead of a false success announcement, and the chip list never shows more than 6.

---

## 3. #1093 — Six smaller cleanup items (P2, each independently verified still present)

**Files**: `js/hna/combined-geo.js`, `js/hna/hna-controller.js`, `js/hna/hna-renderers.js`. Split into separate small PRs if that's easier — these are unrelated to each other.

1. **Duplicated alias-resolution logic.** `combined-geo.js:27-35` reimplements phantom-alias resolution (`function resolveAlias(geoid, datasets) {...}`) instead of calling the canonical `window.PlaceChas.resolveAlias(geoid)`, which already exists and is used elsewhere (`hna-renderers.js:4610-4611`). A future fix to alias resolution in the canonical helper won't propagate here. Fix: call `window.PlaceChas.resolveAlias` from `combined-geo.js`'s `resolveAlias`, falling back to the current inline logic only if `window.PlaceChas` isn't available (matching the defensive pattern already used at `hna-renderers.js:4610`).

2. **Unbatched sequential fetches.** `_loadCombinedDatasets()` (`hna-controller.js:392-405`, soon to be 8 keys after #1091) does 7 (8) sequential `await loadJson(...)` calls rather than `Promise.all`. Each goes through `loadJson()` (line 474+), which always sets `cache:'no-store'` — by design (see the comment at line 480-484), don't change that part. Fix only the sequencing: fire all `loadJson()` calls concurrently and `await Promise.all(...)`, then assemble the `datasets` object from the resolved array/object. Do not add caching against `HNAState.state` in this pass — that's a larger behavior change than this cleanup item calls for; scope it to parallelizing the fetches that already happen.

3. **Hardcoded DOM-ID blanking in `renderCombinedAssessment`.** `hna-renderers.js:7870-7900+` calls `_combinedSetText('statXxx', ...)` individually, by name, for each panel — meaning every future panel needs a hand-added line here. Lower priority than 1/2 above since it's a maintainability concern, not a bug: only take this on if it can be done without changing any currently-correct rendered output. If `result.availability` already has a key per panel (confirm the shape before starting — it's used elsewhere in this file for the AMI-gap panel), consider iterating over it instead of one-off calls, but if the mapping between panel names and `availability` keys isn't 1:1, don't force it — leave a comment explaining why and skip this specific sub-item rather than introducing a regression.

4. **Chart-unavailable sweep too broad.** `hna-renderers.js:7939` (and similarly at `:7841`, `:250` — check whether those two are the same code path or genuinely separate call sites before touching all three) does `document.querySelectorAll('canvas[id^="chart"]').forEach(...)` to blank every chart canvas on entering combined mode, including charts that could show real aggregated data for a combo. Fix: scope the sweep to only the specific chart IDs known to be single-geography-only, rather than every `canvas[id^="chart"]` on the page. Verify against the actual chart-populate logic which charts genuinely can't be aggregated (tract-level maps, etc.) vs. which could show combined data but are currently blanked unnecessarily.

5. **`?geos=` URL-restore geoType imprecision.** `hna-controller.js:3398`: `geoType: String(g).length === 5 ? 'county' : 'place'`. Counties are 5-digit FIPS, but CDPs are also sometimes 5-digit place codes depending on source — this can't distinguish CDP from county on link restore. Fix: if the URL restore logic has access to a lookup (e.g. `placeCountyLookup` or similar, already loaded elsewhere in this file) that can disambiguate by checking membership in a known-counties set vs. known-places set, use that instead of string length. If no such lookup is conveniently available at that call site, this may not be cheaply fixable in this pass — document why and leave as a known limitation rather than guessing.

6. **Combine-off doesn't resync `WorkflowState`.** `_syncJurisdictionToWorkflowState()` (`hna-controller.js:3490-3528`) is only ever called from `geoType`'s and `geoSelect`'s own `change` listeners (lines 3533, 3537) — never from `combineGeosToggle`'s `change` listener (lines 3541-3545) and never from `update()` itself. So toggling combine mode back OFF leaves `WorkflowState`'s jurisdiction stale at whatever it was before combine mode was turned on (or unset, if combine was toggled on immediately). Fix: in the `combineGeosToggle` `change` listener, when transitioning to unchecked (off), call `_syncJurisdictionToWorkflowState()` after `_syncCombinedPanel()` so the current single-geography selection propagates to `WorkflowState` again, matching what happens on every other selector change.

**Tests**: one test-suite case per sub-item you actually fix (skip cases for sub-items you document as descoped, per the guidance above — don't force a test for something you didn't change).

**QA gate**: for whichever sub-items you take on, confirm via the existing `test/combined-geo.test.js` suite plus a manual walkthrough (build a combo, toggle combine off, confirm `WorkflowState`/Select Jurisdiction page reflects the single geography again; if you touched the alias/chart-sweep items, spot-check that previously-correct behavior for single-geography views is unchanged).

---

## 4. #1096 — HNA executive decision strip (P2)

**File**: `housing-needs-assessment.html` (and whichever `js/hna/*.js` module renders it)

**Context**: audit finding B-05 — the HNA page is dense; recommendation is "an executive 'decision strip' near the top: Need severity, affordability pressure, production gap, ownership feasibility, data confidence. Let details remain below."

**Anchor point**: the hero section (`<h1>Housing Needs Assessment</h1>` at line 209) is followed by the geography controls, then the `developer-pipeline-teaser` aside (lines 258-267), then `#pageContext` (the What/Why/Not/Next panel, line 256) and the existing stat grid further down (`#statPop` etc. starting ~line 411). Insert the decision strip after the geography controls and before (or after — your call on visual flow) the developer-pipeline-teaser, so it's visible without scrolling for a freshly-loaded geography.

**Scope guidance — this is the one item in this doc that's a design/build task, not a mechanical fix.** Before inventing new computations: check whether each of the 5 dimensions the audit named already has a computed value sitting in `HNAState`/existing renderers that can be reused directly, rather than adding new calculation logic:
- **Need severity** — likely already exists as some form of composite/ranking score (check `data/hna/ranking-index.json` / whatever backs the ranking page).
- **Affordability pressure** — likely derivable from existing cost-burden stats already rendered elsewhere on this page.
- **Production gap** — likely the existing `housing_need.incremental_units_needed_dola` field (used elsewhere, e.g. the benchmarks fixture) or similar.
- **Ownership feasibility** — likely from the Affordable Ownership Need module (`js/hna/hna-ownership-need.js`), which already renders on this page.
- **Data confidence** — likely derivable from the existing per-metric `confidence`/`quality` fields already used throughout this page's source-badge system.

If any of these 5 doesn't have a clean existing source without new modeling work, flag that specific dimension in the PR description and either omit it or pick a lighter-weight proxy — do not invent a new scoring formula as part of this UI task.

**Fix**: a compact, 5-tile (or fewer, per the note above) strip, each tile showing a short label + value + a one-word/short-phrase qualitative read (e.g. "High" / "Moderate" / "Low"), each linking or scrolling down to the fuller section below it. Keep it in the existing site's card/pill visual language — don't introduce new components/styles beyond what the page already uses.

**Tests**: a render/DOM test confirming the strip renders with real data for a sample geography (not blank/placeholder), and that its values match the fuller sections lower on the page (avoid creating a second instance of the A-01/C-01 "same metric, different path" bug class this audit already flagged and fixed once — reuse the same source objects the detailed sections use, don't recompute independently).

**QA gate**: load 2-3 real jurisdictions, confirm the strip's 5 values are populated (not "—"/placeholder) and match the corresponding detailed sections elsewhere on the page. Confirm mobile layout doesn't overflow (screenshot both breakpoints).

---

## 5. #1099 — Cross-surface value-equality: convention note, not new tooling (P3)

**Context**: audit finding C-01, residual after #1081 fixed the one known instance (HNA home value, stat vs. narrative). The issue itself recommends discussing scope with the owner before building generalized scanning tooling for a pattern seen only once.

**Decision** (made here rather than punting further): do not build a generalized lint/scanner for this — one confirmed instance doesn't justify new test infrastructure, and #1091 above is about to become a second real instance of "a metric needs a single shared source object across two render paths" (home value, now in both single-geography and combined-mode code). Two instances in the same metric family still doesn't justify a generic scanner.

**Fix (small, doc-only)**: add a short convention note — a few sentences, not a new document — to `docs/CONTRIBUTING.md`'s QA/QC layers section (referenced elsewhere in this repo, e.g. `dashboard-data-quality.html`'s "Data Quality Layers" heading links here) describing the pattern: *any metric displayed in more than one place on the same page (or across pages) must be read from a single shared source object/helper (see `HNAUtils.homeValueInfo()` from PR #1081 as the reference implementation), not recomputed independently at each render site.* This makes the convention discoverable for the next contributor (human or Codex) without building tooling to enforce it mechanically.

**Tests**: none — this is a docs-only change.

**QA gate**: confirm the note is added, reads clearly, and references the actual `HNAUtils.homeValueInfo()` pattern accurately (re-verify it still lives at the same location before citing a line number in the doc).

---

## Deliverables per item (PR description template)

1. Summary of what changed and why
2. Which issue (#1091 / #1092 / #1093 sub-item / #1096 / #1099) this closes
3. Verification: what you independently confirmed against current code, not just what this doc said (line numbers here were accurate as of `e98b59aac` — re-check before relying on them)
4. Tests added and their results
5. Known limitations / descoped sub-items, if any
