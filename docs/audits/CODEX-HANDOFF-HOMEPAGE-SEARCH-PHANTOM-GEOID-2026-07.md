# Codex Handoff: complete homepage inline search (#1097) + phantom GEOID fix (#1173)

**For: Codex.** Two items, one PR each, do them **in order** (item 2's search results will show a duplicate "Lamar (city)" until item 1's phantom is removed — landing item 1 first avoids shipping that visibly).

**QA**: Claude reviews each PR against its gate before the owner merges. **Owner**: paulglasow (merges; squash convention).

**Not yours**: PRs #1172 (STR-distortion flag) and #1174 (C-04 annotations) are Claude-authored and awaiting owner merge — leave them alone.

---

## 1. Remove phantom place GEOID 0831400 from the geography registry (#1173)

**What's wrong (verified 2026-07-11, evidence in the issue)**: `data/hna/geography-registry.json` contains a second "Lamar (city)" entry — GEOID `0831400`, containingCounty `08071` (Las Animas) — that does not exist as a Census place: the TIGERweb places layer returns NO MATCH for it, and it's absent from `data/co-place-centroids.json`. Real Lamar is `0843110` (Prowers, `08099`), confirmed by TIGERweb. The phantom is propagated into `data/hna/derived/place_county_lookup.json` and caused the 2026-07-06 local-resources weekly (#1067) to re-suggest a place that's already fully covered.

**Implementation**:
1. Re-verify both GEOIDs yourself against TIGERweb before deleting anything (keyless):
   `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query?where=GEOID%3D%270831400%27&outFields=GEOID,NAME,BASENAME&f=json` (expect empty `features`), and the same query for `0843110` (expect `Lamar city`).
2. Remove the `0831400` entry from `data/hna/geography-registry.json` and the `"0831400": "08071"` row from `data/hna/derived/place_county_lookup.json`.
3. `grep -rn 0831400 data/ scripts/ js/` — clean up any other references (none are known, but verify; the registry has THREE mapping files that can disagree per the 2026-07 place-county audit: registry, lookup cache, summaries).
4. **Phantom sweep**: validate every `place`/`cdp` GEOID in the registry for existence, in one pass. Preferred offline authority: `data/hna/place-tract-membership.json` or `data/co-place-centroids.json` — but FIRST verify the chosen file's coverage is a superset of real registry places (spot-check ~5 known-good entries; if neither file covers all 512 real entries, do a one-time TIGERweb sweep — batch the `where=GEOID IN (...)` queries — and record results in the PR). Fix any additional phantoms found in the same PR.
5. **CI guard**: add a test asserting every registry place/cdp GEOID exists in whichever offline authority step 4 validated (so a future regeneration can't reintroduce phantoms). Wire it into `test:ci` — the chain is explicit in `package.json`, new test files do not auto-run.

**Coupling warnings** (from repo history — these have burned CI before):
- If anything regenerates `ranking-index.json`, rebuild ranking-scenarios in the same PR or `ci-checks` fails (scenarios pin the index's `generatedAt`).
- The phantom has `hasHnaSummary: false, hasRanking: false`, so no summary/page regeneration should trigger — but run the full `test:ci` locally to be sure, and `test:place-pages-fresh` specifically.

**QA gate**: TIGERweb evidence for every deleted GEOID in the PR description; `grep -rn 0831400` returns nothing; new guard test passes AND is proven non-vacuous (temporarily re-add the phantom entry, guard fails, remove it, passes); full `test:ci` green.

---

## 2. Complete the homepage inline jurisdiction search (#1097)

**Status: ~80% implemented — do NOT start from scratch.** Branch `feat/1097-homepage-inline-search` (pushed, one WIP commit) contains:
- `js/home-jurisdiction-search.js` — dual-context module (UMD guard, same pattern as `js/deal-calculator-math.js`): pure `searchJurisdictions(entries, query, limit)` (case-insensitive substring; prefix matches rank first, then shorter names, then alphabetical; default cap 8) and `jurisdictionUrl(entry)` (→ `housing-needs-assessment.html?geoid=…&geoType=…&auto=1`), plus a browser bootstrap wiring an ARIA-combobox (lazy registry fetch on first focus, ArrowUp/Down/Enter/Escape, `aria-expanded`/`aria-activedescendant`, mousedown-before-blur selection).
- `index.html` — labeled combobox markup in the hero (`#homeJurisdictionSearch` + `#homeJurisdictionSearchResults`) between the Start-Here CTA and the explore links, and the `<script defer>` tag after `js/index.js`.

**Design decisions already made — keep them** (rationale in the module header): all matches route to the interactive HNA profile, NOT `places/<geoid>.html` (static pages exist for only 482 of 513 place/CDP entries with no registry field predicting which — uniform routing avoids client-side 404 guessing); registry loads lazily so homepage initial load is unaffected; no new CSS files (inline styles with theme vars, matching the hero's existing convention).

**Remaining work**:
1. `test/home-jurisdiction-search.test.js` — `require('../js/home-jurisdiction-search.js')` and test the REAL functions:
   - matching: case-insensitivity; prefix-before-substring ranking (e.g. `"la"` ranks "La Junta" above "Salida"-style mid-word hits); result cap at `MAX_RESULTS`; empty/whitespace query → `[]`; null entries → `[]`.
   - routing: county entry → `…geoid=08045&geoType=county&auto=1`; place entry → `geoType=place`; missing fields → `null`.
   - **real-registry integration**: load `data/hna/geography-registry.json`, assert `searchJurisdictions(entries, 'aspen')[0]` is Aspen (`0803620`, place) and `'garfield'` surfaces Garfield County (`08045`), and that the routed URLs point at `housing-needs-assessment.html`.
   - HTML contract (static grep, scoped): `index.html` contains `id="homeJurisdictionSearch"` with `role="combobox"` + `aria-controls`, the listbox id, and the `home-jurisdiction-search.js` script tag.
2. Add `test:home-jurisdiction-search` npm script AND append it to the explicit `test:ci` chain.
3. `npm run validate` (asset-reference check must see the new script) and full `test:ci`.
4. Rebase the branch on main after item 1 merges (so the Lamar duplicate is gone from results).

**QA gate**:
- Non-vacuous: break the prefix-ranking comparator (e.g. invert `a.prefix - b.prefix`), the ranking test fails; restore. Remove `role="combobox"` from the markup, the contract test fails; restore.
- Browser (Claude re-runs this at QA — make sure it passes first): type "asp" → listbox renders with Aspen; ArrowDown highlights (visually AND `aria-activedescendant` set); Enter navigates to `housing-needs-assessment.html?geoid=0803620&geoType=place&auto=1`; Escape and blur both close the list; `aria-expanded` toggles correctly.
- Lazy-load proof: on fresh homepage load, `geography-registry.json` is NOT in the network log until the input gains focus.
- Mobile 375px: no horizontal overflow, list usable. Dark mode: input/list legible (theme vars, not hardcoded light colors).
- Zero console errors throughout.

---

## Deliverables per PR
1. What changed, which issue it closes, and — for item 2 — confirmation you built on the WIP branch rather than rewriting it (if you had to change something already there, say what and why).
2. Verification: what you independently confirmed against current code/data, not just what this doc said. Line numbers drift — recheck them.
3. Tests added, results, and the non-vacuousness proofs specified above.
