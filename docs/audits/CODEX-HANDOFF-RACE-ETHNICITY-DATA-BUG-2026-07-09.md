# Codex — Fix Race & Ethnicity Data Bug (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews the PR against the gate below before the owner merges.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Severity**: P0. This is not a methodology disagreement or a stale-vintage issue like the DOLA/benchmarks work — it is a live, public-facing data-accuracy bug. Every jurisdiction page on the site currently displays factually wrong Hispanic/Latino and race-composition figures.

## What's broken, and how this was found

While benchmarking the HNA against a June 2026 EPS Regional Housing Needs Assessment (Attachment B, covering Pitkin County, Garfield County, Aspen, Snowmass Village, Basalt, Carbondale, Glenwood Springs, New Castle, Silt, Rifle, Parachute), several derived metrics (age 65+, single-parent household share) matched the consultant report exactly across all 11 jurisdictions. But the race/ethnicity breakdown was wildly off — e.g. Garfield County's live HNA page currently shows:

- "Not Hispanic, White alone": **100.0%**
- "Hispanic or Latino": **0.5%**
- Race shares summing to **over 100%** (internally impossible)

Real data says otherwise. Verified three independent ways:
1. The EPS report itself states Garfield County is **28.3% BIPOC** (2024).
2. Census Reporter's B03002 table gives Garfield County as **32.6% Hispanic/Latino, 61.5% White alone Not Hispanic**.
3. Direct lookup of the Census Bureau's own 2024 ACS 5-year variable definitions (`api.census.gov/data/2024/acs/acs5/profile/variables/<code>.json`) shows the codes this repo fetches under race/ethnicity labels **do not mean what the code says they mean** in the current ACS vintage.

## Root cause

The Census Bureau's DP05 ("ACS Demographic and Housing Estimates") profile table inserts detailed ancestry/nationality sub-breakdown rows (English, Egyptian, Ethiopian, etc.) after each major "race alone" category. This repo's ETL was written against an older ACS vintage's DP05 numbering, before those extra rows existed. In the **current 2024 vintage**, the numbering has shifted — the codes below now point to completely different variables than this repo assumes:

| Field the repo claims | Code repo fetches | What that code **actually** is in the 2024 vintage (verified via Census API) | Correct code for what the repo wants |
|---|---|---|---|
| Total population | `DP05_0033E` | Confirmed still correct (matches `DP05_0001E`) — **no change needed** | `DP05_0033E` (unchanged) |
| White alone | `DP05_0037E` | Confirmed still correct — **no change needed** | `DP05_0037E` (unchanged) |
| Black or African American alone | `DP05_0038E` | "White: Egyptian" | `DP05_0045E` |
| American Indian / Alaska Native alone | `DP05_0039E` | "White: English" | `DP05_0053E` |
| Asian alone | `DP05_0047E` | "Black or African American: Ethiopian" | `DP05_0061E` |
| Native Hawaiian / Pacific Islander alone | `DP05_0055E` | "American Indian and Alaska Native: Blackfeet Tribe of the Blackfeet Indian Reservation of Montana" | `DP05_0069E` |
| Some Other Race alone | `DP05_0060E` | Not independently verified, same shift pattern implied — verify before use | `DP05_0074E` |
| Two or More Races | `DP05_0061E` | "Race alone: Asian" (i.e. this is now the correct **Asian alone** code, not two-or-more) | `DP05_0035E` |
| Hispanic or Latino (of any race) | `DP05_0076E` | "Two or More Races: White and Black or African American" | `DP05_0090E` |
| Not Hispanic, White alone | `DP05_0082E` | "Race alone or in combination with one or more other races: Total population" (i.e. always ≈ total population by definition — this is exactly why the site shows "100.0% white") | `DP05_0096E` |

**Important trap for whoever fixes this**: the *old* code for "Two or More Races" (`DP05_0061E`) is the *correct* code for "Asian alone" in the new mapping. Don't just search-and-replace blindly — the fetch list needs `DP05_0061E` **kept** (relabeled to Asian) and a **new** `DP05_0035E` **added** (for the real two-or-more-races figure). Every other row is a straight code swap.

Before starting, re-verify `DP05_0055E`→`DP05_0069E` and `DP05_0060E`→`DP05_0074E` yourself against `https://api.census.gov/data/2024/acs/acs5/profile/variables/<code>.json` (needs a Census API key — see `js/config.local.js` / GitHub Secrets, same key already used by the existing pipeline).

## Files to change

1. **`scripts/hna/build_hna_data.py`** (~line 917-919) — the `vars_d` fetch list. Replace the six wrong codes with their correct equivalents; add `DP05_0035E`. Recommend **storing under the correct code as the JSON key** (e.g. store Black-alone's value under key `DP05_0045E`, not under the old misleading key `DP05_0038E`) — self-documenting, avoids a JSON field whose name lies about its own content.

2. **`js/hna/hna-controller.js`** (~lines 1991-2000) — the fetch/field list read from the summary cache. Update to the new key names, matching whatever `build_hna_data.py` now stores.

3. **`js/hna/hna-renderers.js`** (~lines 1035-1054) — the render logic (`rawNum('DP05_0076E')` etc. and the `key:` list feeding the race breakdown chart/table). Update to new key names. Also re-derive `notHispWhite`'s meaning: it currently reads `DP05_0082E` expecting "Not Hispanic White alone" — the corrected code is `DP05_0096E`.

4. **`js/hna/hna-export.js`** (~lines 973-977) — PDF/CSV export labels and `sub:` codes. Update to match.

5. **`data/hna/summary/*.json`** (all ~337 county + place summary caches) — these have the **wrong values already baked in** from prior runs. Code fixes alone do nothing until these regenerate. Use the existing `build-hna-data.yml` workflow (statewide + place batches — this is not a statewide-only fix, every place/CDP summary needs it too) rather than hand-editing JSON.

6. **Out of scope, flag but don't fix here**: `js/acs-data-loader.js`'s `ACS_FIELD_MAPPING` and `scripts/hna/acs_field_mapping.json` reference a *different, also-likely-stale* set of PE-suffixed codes (`DP05_0038PE`, `DP05_0044PE`, `DP05_0071PE`) for the same race/ethnicity concepts. Confirmed via grep that **no HTML page loads `acs-data-loader.js`** — it's dead code, not live on the site. `test/acs-etl.test.js` and `test/acs-integration.test.js` assert against this dead mapping's internal self-consistency only (not against real Census data), so they'll keep passing either way. Leave this alone unless you're asked to clean up dead code separately — don't let it block or scope-creep this fix.

## Fix

1. Update the six wrong codes + add the missing one in `build_hna_data.py`, `hna-controller.js`, `hna-renderers.js`, `hna-export.js` per the table above.
2. Regenerate all HNA summary caches (counties + places + CDPs) via the existing `build-hna-data.yml` workflow.
3. Add a regression test (new, since **none currently exists** for this render section — that's exactly how this shipped and stayed live undetected). At minimum:
   - A unit/module test asserting the race breakdown's 7 "alone" shares plus the "two or more" share sum to ~100% (±rounding) for a real fixture geography — this alone would have caught the original bug (it was summing to >100%).
   - A fixture-based test with a known-correct value for at least one real geography (e.g. Garfield County, 08045: Hispanic/Latino ≈ 32.6%, White alone Not Hispanic ≈ 61.5%, per Census Reporter B03002 — cite this source in the test comment so a future reader can re-verify against a live source, not just trust the hardcoded fixture number).
4. Do **not** silently widen scope to "audit every ACS variable in the codebase" — this fix is scoped to the race/ethnicity block specifically. If you notice other DP05/DP02/DP03/DP04 codes that look suspicious while you're in there, flag them as a new issue rather than fixing inline.

## QA gate

- Rebuild the summary cache for Garfield County (08045) specifically and confirm the raw `acsProfile` values now show a plausible Hispanic/Latino share (~32.6%, not ~0.5%) and White-alone-Not-Hispanic share (~61.5%, not 100%).
- Load `housing-needs-assessment.html?geo=county&geoid=08045` live in a browser, confirm the "Race & ethnicity" section renders sane, non-overlapping percentages that sum to ~100%.
- Spot-check a second, different-composition geography (e.g. a mountain-resort place like Aspen, 0803620, which the EPS report says is far less diverse) to confirm the fix isn't overfit to one county.
- Confirm the new regression test fails against the old (wrong) codes and passes against the fix — prove it's not vacuous, same standard as every other test added this session.
- Run `npm run test:hna` and `npm run test:hna-acs-coverage` — both should still pass; the ACS var-coverage test in particular checks that every renderer-referenced variable is actually fetched by the controller, so it should catch a key-name mismatch between controller and renderer if you miss one.

## Deliverables (PR description)

1. Summary of what changed and why (link this doc).
2. The exact old-code → new-code table, confirmed for all 8 (not just the 6 independently verified here).
3. Confirmation the summary-cache regeneration ran and which workflow/command was used.
4. Test added, and proof it's non-vacuous (fails on old codes, passes on new).
5. Before/after numbers for at least Garfield County and one other geography, in the PR body.
