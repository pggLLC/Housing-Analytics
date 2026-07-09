# Codex — Combined Jurisdictions Residual Fixes (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **Three separate PRs, one QA gate each. Do not start the next item until the current one is merged.**
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source**: Issues #1091, #1092, #1093 — all three are residual "Combined Jurisdictions" findings from the PR #1076/#1080 QA thread (`js/hna/combined-geo.js`, `js/hna/hna-controller.js`, `js/hna/hna-renderers.js`). PR #1080 closed 5 of 7 must-fix items from that thread; #1091 and #1092 are the two remaining must-fix items, #1093 bundles six lower-priority cleanup items. **All citations below were independently re-verified against current `main` on 2026-07-09 while writing this doc** (not just relayed from the issue text) — line numbers and code snippets are current as of that date.

## Order

Do **#1092 first** — smallest, single-function, no cross-file dependency, and it's a user-facing correctness bug (false success announcement). Then **#1091** — touches two files but is self-contained and has a clear before/after test. Do **#1093 last**, and split it into as many sub-PRs as make sense — it's six unrelated cleanup items bundled into one issue for triage convenience only; don't let unrelated items block each other.

**Important context you must not re-litigate**: PR #1080 already closed 5 of the original 7 must-fix findings from the #1076 QA thread (Mode B paired-view implementation, `amiGap.available` guard, export data-source fix, ownership-need source-pill label, and the `geoType === 'combined'` leak guard). Do not re-touch those — verify your diff doesn't overlap `js/hna/hna-export.js` or `js/hna/hna-ownership-need.js` unless a specific item below calls for it.

---

## #1092 — 7th combo member silently dropped after success announcement (P0, do first)

**Verified** — `js/hna/hna-controller.js:308-320`, byte-for-byte the same as the issue reported:

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

Push happens first, `.slice(0, 6)` truncates second, the aria-live announcement fires third — unconditionally. Add a 7th member and the screen reader announces "Combined member added: X" while X was already truncated out of both the chip list and the aggregation. The user is told something succeeded that didn't.

**Fix**: check the cap *before* pushing/announcing. Match the existing warning-banner pattern in this same file — see `window.HNARenderers.setBanner('Combined areas can include only places, CDPs, or counties. Select County or Incorporated Place (+ CDP) first.', 'warn');` two lines above `_addCurrentCombinedMember` (that's the `!member` branch of the same function) for the exact call shape to reuse. Something like:

```js
function _addCurrentCombinedMember() {
  const member = _memberFromCurrentSelect();
  if (!member) {
    window.HNARenderers.setBanner('Combined areas can include only places, CDPs, or counties. Select County or Incorporated Place (+ CDP) first.', 'warn');
    return;
  }
  const key = member.geoType + ':' + member.geoid;
  const list = window.HNAState.state.combinedMembers || [];
  if (list.length >= 6 && !list.some(m => (m.geoType + ':' + m.geoid) === key)) {
    window.HNARenderers.setBanner('Combined areas support up to 6 members.', 'warn');
    return;
  }
  if (!list.some(m => (m.geoType + ':' + m.geoid) === key)) list.push(member);
  window.HNAState.state.combinedMembers = list;
  _renderCombinedChips();
  if (typeof window.__announceUpdate === 'function') window.__announceUpdate('Combined member added: ' + _labelForMember(member));
}
```

Note the `list.length >= 6 && !list.some(...)` guard — a duplicate re-add of an existing member at 6/6 should stay a no-op (current behavior), not trip the cap warning. Confirm `window.HNARenderers.setBanner` is the right call signature (check its definition) before using it verbatim.

**Tests**: extend `test/combined-geo.test.js` (or add a controller-level test if that file doesn't cover controller functions) asserting: (a) adding a 7th distinct member does NOT call `window.__announceUpdate` with a success message, (b) the member list stays at exactly 6 after the attempt, (c) re-adding an already-present member at 6/6 is still a harmless no-op, not a spurious cap warning.

**QA gate**: manually add 7 distinct members via the UI (or the equivalent test harness) and confirm the 7th shows the cap warning banner, not a success announcement, and the chip list never shows more than 6.

---

## #1091 — Home-value dead code: `medianMetrics.homeValue` never wired (P1)

**Verified across three files** — this is two separate-but-related gaps, not one:

**Gap A** — `js/hna/hna-controller.js:392-405`, `_loadCombinedDatasets()` never fetches a home-value dataset:

```js
async function _loadCombinedDatasets() {
  if (window.HNAState.state.combinedDatasets) return window.HNAState.state.combinedDatasets;
  const datasets = {
    placeChas: await loadJson('data/hna/place-chas.json'),
    countyChas: await loadJson(window.HNAUtils.PATHS.chasCostBurden),
    amiGapPlace: await loadJson('data/co_ami_gap_by_place.json'),
    amiGapCounty: await loadJson(window.HNAUtils.PATHS.acsAmiGap),
    placeCountyLookup: await loadJson('data/hna/derived/place_county_lookup.json'),
    crossCountyPlaces: await loadJson('data/hna/cross-county-places.json'),
    aliases: await loadJson('data/hna/place-phantom-aliases.json'),
  };
  window.HNAState.state.combinedDatasets = datasets;
  return datasets;
```

No `homeValues` key. Meanwhile `js/hna/combined-geo.js:357-364` already has aggregation code written and waiting for exactly this key:

```js
medianMetrics: {
  homeValue: weightedMetricRange(validation.members, datasets, function (member, _rec) {
    var home = datasets.homeValues && datasets.homeValues[member.geoid];
    return home && (home.value != null ? home.value : home.median_home_value);
  }, function (_member, rec) {
    return rec.summary && (num(rec.summary.total_renter_hh) + num(rec.summary.total_owner_hh));
  }),
},
```

`datasets.homeValues` is always `undefined`, so `datasets.homeValues && ...` short-circuits to `undefined` for every member, `weightedMetricRange` (defined at `combined-geo.js:270-291`) filters out every row (`value == null` check), and `available: rows.length > 0` is always `false`.

**Gap B** — `js/hna/hna-renderers.js:7893`, `renderCombinedAssessment` doesn't even read that result — it hardcodes the placeholder unconditionally:

```js
_combinedSetText('statHomeValue', 'Range / modeled average');
_combinedSetText('statHomeValueSrc', 'Combined areas do not have a true median; use member range and modeled average only.');
```

So even after Gap A is fixed, this line still needs to change or the fix won't be visible anywhere.

**The dataset to wire in**: `data/hna/home-value-cascade.json`, schema `{ meta, places: { <7-digit place GEOID>: { value, source, as_of, confidence, ... } }, review_flags }` — confirmed 482/482 place entries have `.value` populated (`meta.counts.total`), so the `home.median_home_value` fallback in the `combined-geo.js` snippet above is currently dead code (no cascade entry has ever used that field name) — leave it as a harmless defensive fallback, don't remove it as part of this fix, it's out of scope.

**Known, pre-existing limitation to preserve, not "fix"**: `home-value-cascade.json` is place/CDP-only (keyed by 7-digit GEOIDs). County members in a combo (`recordForMember` routes counties to `datasets.countyChas`, not `datasets.placeChas`) have no matching entry in the cascade file and will always be skipped by `weightedMetricRange`'s `value == null` filter — this is correct, not a bug, since no county-level home-value estimate exists anywhere in this codebase today (confirmed: no `median_home_value` field on any `data/hna/summary/<countyfips>.json`). If a combo is all-county, `medianMetrics.homeValue.available` will legitimately stay `false` after this fix — that's expected. Don't try to backfill county home values as part of this issue; if you think it's needed, flag it as a new issue instead of expanding scope here.

**Fix**:
1. In `_loadCombinedDatasets()`, add: `homeValues: (await loadJson('data/hna/home-value-cascade.json') || {}).places || {},` — note the `.places` unwrap, since the top-level file has a `meta`/`review_flags` wrapper and `combined-geo.js` already expects to index `datasets.homeValues[geoid]` directly (no code change needed on the `combined-geo.js` side for this part).
2. In `renderCombinedAssessment` (`hna-renderers.js`, ~line 7893), replace the hardcoded `_combinedSetText('statHomeValue', 'Range / modeled average')` with logic that reads `result.medianMetrics.homeValue` and, when `available`, renders the member range + weighted average (e.g. `$X – $Y (household-weighted avg $Z)` using the existing `fmtMoney` helper already imported in this file at line 335) with the `MODELED` method tag; when `!available` (e.g. an all-county combo), keep a "not available" message but make it accurate to *why* (no place/CDP members with home-value data), not the current always-shown text. There's no existing range-formatting helper in this file for a min/max/weightedAverage triple — you'll need to write one; keep it local to this function unless a second caller appears.

**Tests**: extend `test/combined-geo.test.js` with a case asserting a combo with at least one place/CDP member gets a populated `medianMetrics.homeValue` (non-null `min`, `max`, `weightedAverage`, `available: true`) rather than `available: false` by default, and a second case confirming an all-county combo still correctly reports `available: false` (don't let the fix accidentally start throwing on that path). Add a renderer-level assertion (or extend an existing rendered-DOM test if `test/combined-geo.test.js` doesn't cover renderers) that `statHomeValue` reflects the computed range/average for a mixed combo, not the static placeholder string.

**QA gate**: manually build a combo with at least one place member (e.g. two Boulder-area places) and confirm the home-value stat shows real numbers, not "Range / modeled average" verbatim. Build a second, all-county combo and confirm it degrades gracefully (accurate "not available" message, no console error).

---

## #1093 — Six smaller cleanup items (P2, bundle — split into sub-PRs as convenient)

These were listed as "smaller items" alongside the 7 numbered must-fix findings from the original #1076 QA thread — lower priority, never picked up. **Two of the six were spot-checked against current `main` while writing this doc (marked ✅ below); the other four were not re-verified line-by-line — confirm each is still present and get current line numbers before fixing, per the issue's own caveat.**

1. **✅ Confirmed — duplicated alias-resolution logic.** `combined-geo.js:27-35` defines its own `resolveAlias(geoid, datasets)` instead of calling the canonical shared version. The canonical version is `window.PlaceChas.resolveAlias` — confirmed it exists and is exported at `js/place-chas-lookup.js:92` (definition) and `:166-169` (`window.PlaceChas = { ..., resolveAlias: resolveAlias, ... }`). Check whether `combined-geo.js`'s local version and the canonical one are still behaviorally identical before swapping — if they've diverged, that divergence is itself worth flagging in the PR description rather than silently picking one. Also check the issue's second claim in this item — reimplemented per-band gap clamping instead of sharing `renderGapCoverageStats` (F30/F33 fix) — this was **not** independently re-verified; find current line numbers first.

2. **Not re-verified — unbatched sequential fetches.** Issue claims `_loadCombinedDatasets()` re-fetches ~2MB of data with `no-store` even when `window.HNAState.state` already has it cached from a prior single-geography view, and that the 7 (now 8, after #1091's fix adds `homeValues`) fetches run sequentially via `await` in series rather than `Promise.all`'d. The sequential-vs-parallel claim is directly checkable by reading the function (see the `#1091` snippet above — yes, still sequential `await` calls as of this doc). The "re-fetches even when already cached from single-geography view" claim needs verification against `window.HNAState.state`'s actual shape — check whether a prior single-geography fetch actually populates the same keys this function looks for, or whether that's a different cache namespace entirely (in which case this specific claim may not hold and should be dropped from the fix, not force-fixed).

3. **✅ Confirmed — hardcoded DOM-ID blanking.** `hna-renderers.js:7889-7898` (and continuing beyond), `renderCombinedAssessment` hardcodes which DOM IDs to blank per panel via repeated `_combinedSetText('statPop', 'Not available')` / `_combinedSetText('statMhi', 'Not available')` / etc. calls rather than iterating `result.availability`. Works today but every future panel requires manually remembering to add it here instead of the availability map enforcing it centrally. Low priority — a refactor-for-maintainability item, not a live bug. Don't let it block the other items in this issue.

4. **Not re-verified — chart-unavailable sweep too broad.** Issue claims the code blankets every `canvas[id^="chart"]` indiscriminately when in combined mode, including charts that could show real aggregated data for a combo. Find the actual sweep code first (search `hna-renderers.js` for `canvas[id^` or similar) before deciding what "too broad" means concretely — i.e., which specific chart(s) currently get incorrectly blanked despite having aggregatable data.

5. **Not re-verified — `?geos=` URL restore imprecision.** Issue claims member `geoType` is inferred from GEOID string length alone on link-restore (5 digits = county), which can't distinguish CDPs from places. Find the URL-restore code first (likely near `_memberFromCurrentSelect` or a URL-param parser in `hna-controller.js`) and confirm whether this is a real ambiguity (i.e., can a 5-digit non-county GEOID actually occur in this dataset?) before fixing — Colorado place/CDP GEOIDs in this codebase are consistently 7 digits per the home-value-cascade keys seen in #1091 above, so verify the actual collision risk, not just the code shape.

6. **Not re-verified — combine-off doesn't resync workflow state.** Issue claims toggling "Combine jurisdictions" off doesn't resync `WorkflowState.setJurisdiction`, so other workflow pages can show a stale jurisdiction relative to what HNA displays. Find the toggle-off handler (likely near `_syncCombinedPanel` in `hna-controller.js`) and check whether `WorkflowState.setJurisdiction` is called anywhere in the combined-mode toggle path at all before deciding what "resync" should look like.

**Tests**: whatever's appropriate per sub-item — a refactor-only item (1, 3) needs a regression test proving behavior is unchanged; a real-bug item (2, 4, 5, 6, once confirmed) needs a test proving the bug and then the fix.

**QA gate**: for each item you actually fix, state in the PR which of the six you addressed and which you left (with a reason — "not reproducible" is a valid reason if re-verification shows the claim doesn't hold against current code). Don't feel obligated to fix all six in one pass.

---

## Deliverables per item (PR description template)

1. Summary of what changed and why
2. Which issue (#1091 / #1092 / #1093, and for #1093 which sub-item number(s)) this closes
3. Verification: what you independently confirmed against current code, not just what this doc said — line numbers drift, re-check them
4. Tests added and their results
5. Known limitations (e.g. #1091's all-county-combo home-value gap is expected, not a bug — restate it if relevant so a future reader doesn't re-flag it)
