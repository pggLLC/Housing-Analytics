# Scoping — Household-Level Race/Ethnicity Metric (B25006 and related tables, 2026-07)

**For**: whoever picks this up next (Codex or Claude) — this is a **research/scoping document, not an implementation handoff**. It exists to answer "how big is this, actually?" before anyone commits to building it. Do not implement from this doc directly; it should produce a real implementation handoff (or a decision to drop the idea) as its output.
**Owner**: paulglasow
**Repo**: `pggLLC/Housing-Analytics`
**Triggered by**: Regional Comparison Phase 1b (`docs/audits/CODEX-HANDOFF-REGIONAL-COMPARISON-PHASE1B-RACE-ETHNICITY-2026-07.md`) specced a population-level BIPOC metric and explicitly deferred the EPS report's household-level "BIPOC Households" equivalent as out of scope, citing a new Census table fetch. This doc is that deferred question, actually investigated rather than left as a placeholder.

## Bottom line up front

**This is not "add one more table fetch."** The mechanics of fetching a new B-series table are cheap — this repo already has a proven, working pattern for it. The hard part is that **no single Census table appears to cross-tabulate race AND Hispanic origin of the householder together**, which is exactly the information needed to compute a BIPOC household share without double-counting. Confirming whether such a table genuinely doesn't exist (vs. this investigation missing it) is real, unfinished work — not something to guess at. Recommendation at the bottom.

## What's already proven to work (the easy part)

This repo already fetches three other B-series detail tables at both county and place level, via a working, tested pattern in `scripts/hna/build_hna_data.py` (~line 630-720): `B25024` (units in structure), `B25070` (GRAPI rent burden), `B25091` (SMOCAPI owner cost burden). The fetch mechanics — county vs. place geography params, year-fallback chain, Census API batching — are all solved problems here; a new B-series table is a small, mechanical addition to that existing function, not new infrastructure.

**One relevant caution already on record in this exact code**: the `B25091` fetch has a comment documenting a past mistake — an earlier pass assumed that table's layout without checking, got the bin boundaries wrong, and had to be corrected by verifying against `https://api.census.gov/data/{year}/acs/acs5/groups/B25091.json` directly. That's the standard this doc followed, and any implementation of this scoping's findings should follow too — verify against the live Census API, never assume a B-table's layout from memory or a prior ACS vintage.

## What I verified directly against the Census API (2024 5-year vintage)

**`B25006` (Race of Householder, occupied housing units)** — confirmed structure, 9 estimate variables:
| Code | Label |
|---|---|
| `B25006_001E` | Total |
| `B25006_002E` | White alone |
| `B25006_003E` | Black or African American alone |
| `B25006_004E` | American Indian and Alaska Native alone |
| `B25006_005E` | Asian alone |
| `B25006_006E` | Native Hawaiian and Other Pacific Islander alone |
| `B25006_007E` | Some other race alone |
| `B25006_008E` | Two races excluding Some other race, and three or more races |
| `B25006_009E` | Two or more races |

**Critical gap: `B25006` has no Hispanic/Latino ethnicity dimension at all.** It classifies households by householder *race* only. Unlike DP05's "HISPANIC OR LATINO AND RACE" section (which is what makes the population-level metric in Phase 1b clean — a single mutually-exclusive "Not Hispanic White alone" cell), there is no equivalent cell here. A household with a Hispanic White householder is indistinguishable from a non-Hispanic White householder in this table.

**Data availability spot-check**: fetched `B25006` for Silt, CO (a small town, ~1,300 households) via Census Reporter. Fully populated, all 9 categories sum exactly to the total (1,314). Four categories read zero (Black, AIAN, Asian, NHPI) — plausible for a town this size and racial composition (consistent with what this repo's own corrected DP05 population data shows for Silt), not obviously a suppression artifact. Small-place reliability looks workable, but should be re-checked for a few more places before committing to build on it.

**Candidate companion table for the missing ethnicity dimension: `B11001I`** — "Household Type (Including Living Alone) (Hispanic or Latino)," universe explicitly stated as "Households with a householder who is Hispanic or Latino." This looks like the right concept (total Hispanic-householder households), but I could not fully confirm `B11001I_001E` is the clean total variable in this pass — the API response was incomplete. **This needs direct confirmation before anyone relies on it**, same as every DP05/DP04 code this session got independently verified rather than assumed.

## Why two separate tables isn't enough on its own

Even with both `B25006` (race) and `B11001I` (Hispanic-or-Latino householder households) fetched, computing "BIPOC households" (matching the population-level definition's logic — total minus non-Hispanic-White-alone) needs **non-Hispanic-White-alone household count** as an input. Neither table gives that directly:
- `B25006` gives White-alone households (Hispanic + non-Hispanic White combined).
- `B11001I` gives Hispanic-householder households (all races combined).
- Subtracting the overlap requires knowing how many White-alone households are *also* Hispanic-householder households — which isn't derivable from these two tables' marginal totals alone.

The clean solution is a table that cross-tabulates *both* dimensions on the same households (the household-level equivalent of DP05's population cross-tab). I did not find one in this pass. It may exist under a table ID I haven't checked (Census publishes many race-iteration suffixes — A through I — across dozens of base tables; I only spot-checked household-type and housing-cost iterations), or it may genuinely not exist at the household level the way it does for population. **This is the open question the next pass needs to resolve before any implementation starts.**

## What "next pass" should actually do

1. Systematically search Census's table shell for a household-level cross-tab of race AND Hispanic origin of householder (check the `B25006` group's own metadata for a Hispanic-origin variant suffix; check whether ACS Subject Tables — `S` prefix — publish this differently than Detail Tables; check `B11001I_001E` directly once a Census API key is available).
2. If found: this becomes a real implementation handoff — small addition to the existing B-series fetch pattern, one new digest metric, mirroring the population-level Phase 1b spec exactly.
3. If not found: report that plainly. Options at that point are (a) accept an imperfect proxy — e.g. `1 − (White-alone households / total households)`, disclosed clearly as "not adjusted for Hispanic ethnicity, will understate BIPOC share for any Hispanic householder who selected White alone" — or (b) drop household-level entirely and treat the population-level metric (Phase 1b) as the permanent answer, with the gap documented rather than silently worked around.
4. Either way, re-run the same small-place data-availability spot-check (§ above) across a handful of the state's smallest tracked places before committing — a table that's clean for Silt (1,300 households) may not hold up for a town with 200.

## Recommendation

Don't greenlight implementation yet. The next step is answering the cross-tab question in §"Why two separate tables isn't enough," which is a bounded, half-day-scale research task, not a build task. Once that's answered, the actual implementation (whichever path it points to) is small — comparable in size to Phase 1b, not a major undertaking. This doc's job was to stop that from being discovered mid-implementation; it's cheaper to find out now.
