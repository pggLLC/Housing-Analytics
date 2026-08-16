# Codex — Regional (Multi-Jurisdiction) HNA Comparison (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **One PR per phase item below. Do not start the next item until the current one is merged.**
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Priority**: P2 enhancement, not a bug fix. No urgency, but well-scoped and independently valuable regardless of when it lands.

## Why this exists

Benchmarking the HNA against a June 2026 EPS "Regional Housing Needs Assessment" report (Roaring Fork/Colorado River valleys — Pitkin County, Garfield County, and 9 municipalities) surfaced that this site has no equivalent of what that report calls "regional": a single table showing several jurisdictions' HNA metrics **side by side as separate columns**, for direct comparison. That's a different thing from the existing **Combined Jurisdictions** feature (`js/hna/combined-geo.js`), which mathematically merges a user-selected set of jurisdictions into one blended pseudo-geography (summed households, one weighted-average home value). The EPS report never blends jurisdictions together — every table presents each place/county as its own row, with the only aggregation being the natural Census nesting of a county already including its own municipalities.

This doc specs a **new "Regional comparison" mode**, not a fix to Combined Jurisdictions' aggregation logic. It reuses the *existing* jurisdiction-picker UI (the same `combinedMembers` chip list, add/remove, and 6-member cap already built and QA'd for Combined Jurisdictions in #1092/#1127) but renders a side-by-side table instead of a blended stat card, for users who select it.

## What already exists and is reusable — confirmed by direct code read, not assumed

- **`compare.html` / `js/compare.js`** already builds an N-jurisdiction side-by-side table (`.cmp-table` CSS, `ROWS` config array, add/remove chips, `MAX_COMPARE = 6`) — but its rows are LIHTC deal-scoring metrics, not HNA demographics. The table shell (markup, CSS, column-add/remove interaction) is directly reusable; the row config is not.
- **`buildPairedCountyView`** (`combined-geo.js:295-335`) is a smaller-scale, non-aggregating precedent: exactly one place + its containing county, cost-burden rows only, explicit `aggregation:'none'` flag and a "Side-by-side paired view only" note. Confirms the "don't blend, just place side by side" pattern already has a foothold in this codebase — this new feature generalizes it to N jurisdictions and more metrics.
- **`data/hna/jurisdiction-metrics-digest/<geoid>.json`** (built by `scripts/hna/build_jurisdiction_metrics_digest.mjs`) is the right data source: a flat `metrics` object, one scalar per key, already covering `pct_cost_burdened`, `overcrowding_rate`, `pct_renters`, `median_home_value`. It does **not** yet have AMI-tier household shares, housing age, education, single-parent %, or age 65+ — those need adding (Phase 1 below).

## Scope

| Report table | Repo status | This doc's scope |
|---|---|---|
| Table 2, Cost burden % | Already in digest (`pct_cost_burdened`) | Reuse as-is |
| Table 3, AMI-tier household share | **Not in digest**, but the raw data exists in `data/hna/place-chas.json` (`owner_hh_by_ami`/`renter_hh_by_ami`, keyed `lte30`/`31to50`/`51to80`/`81to100`/`100plus`, each with a `total`) and the equivalent county CHAS file | **Phase 1**: new digest metric |
| Table 4, Housing built before 1970 % | **No fetch at all currently** — verified via direct Census API lookup, current 2024 vintage codes are `DP04_0023PE` (1960-69) + `DP04_0024PE` (1950-59) + `DP04_0025PE` (1940-49) + `DP04_0026PE` (1939 or earlier); confirmed none of these are in any `data/hna/summary/*.json` today | **Phase 1**: new ETL fetch + new digest metric |
| Table 5, Overcrowding % | Already in digest (`overcrowding_rate`) | Reuse as-is |
| Table 6, No-HS-degree % | Repo already fetches `DP02_0059E`-`DP02_0068E` for the single-geography education panel (`hna-renderers.js:1140-1151`), just not stored in the digest. Note: report uses population 18+ as denominator, repo's existing fetch uses population 25+ (`DP02_0059E`) — cross-checked against the EPS report earlier and the gap is consistently under 0.5pp except one outlier at 1.1pp; keep the 25+ denominator (matches existing single-geo panel) and document the difference in the digest metric's `measure_type`/description, don't try to re-derive an 18+ denominator that doesn't exist anywhere else in this codebase | **Phase 1**: new digest metric only (data already fetched) |
| Table 7, Limited English proficiency | **No fetch at all** — would need a new Census table group (B16004 or S1601), never pulled anywhere in this repo | **Out of scope this doc.** File as a separate future issue if wanted. |
| Table 8, Single-parent household % | Already computed at render time from `DP02_0007E + DP02_0011E` (`hna-renderers.js:868`) for one geography; not stored in the digest | **Phase 1**: new digest metric only (data already fetched) |
| Table 9, BIPOC households | Repo's DP05 race codes were broken (issue #1129, fix not yet merged as of this writing — #1128 merged the spec doc, the code fix is still open) — **do not build this metric until #1129's actual code fix merges**, and even then note the report's "BIPOC Households" is **household-head race** (a different Census concept, ~B25006, not fetched anywhere in this repo), while this repo can only produce **population-level** race share via DP05. Don't conflate the two numbers in the UI — label it accurately as population share, not household share. | **Phase 1b, blocked on #1129, and permanently narrower in scope than the report's exact metric** |
| Table 10, Age 65+ % | Already computed at render time from `DP05_0024E / DP05_0033E` (confirmed exact match against the EPS report across all 11 benchmarked jurisdictions); not stored in the digest | **Phase 1**: new digest metric only (data already fetched) |
| Table 11, Disability | **No fetch at all** — would need B18101 or S1810, never pulled anywhere in this repo | **Out of scope this doc.** File as a separate future issue if wanted. |
| Table 1 (partial), Overcrowding | Same ACS overcrowding data as Table 5 | Covered above |
| Table 1 (partial), Temporary housing / homelessness counts | **Not ACS-derivable at all** — the report's figures come from "SHG Advisors and Pitkin County" local point-in-time counts, a third-party dataset this repo has no pipeline for | **Permanently out of scope.** Not a gap to fill, a different kind of data source entirely. |
| Table 12, Housing resources/programs inventory | Qualitative policy catalog, not a statistic | **Out of scope.** Would be a manually-curated content page, unrelated effort. |

## Phase 1 — Extend the jurisdiction-metrics digest

**File**: `scripts/hna/build_jurisdiction_metrics_digest.mjs`. Add these metrics to whatever internal map/list feeds `buildDigest()` (`build_jurisdiction_metrics_digest.mjs:459-473` is the existing per-metric loop pattern to extend):

1. `pct_ami_lte30`, `pct_ami_31to50`, `pct_ami_51to80`, `pct_ami_gt80` — sum `owner_hh_by_ami[tier].total + renter_hh_by_ami[tier].total` from `data/hna/place-chas.json` (places) or the equivalent county CHAS source (counties) per tier, divide by the sum across all tiers. `gt80` combines the `81to100` and `100plus` buckets to match the report's `>80% AMI` bucket.
2. `pct_housing_built_pre1970` — sum `DP04_0023PE + DP04_0024PE + DP04_0025PE + DP04_0026PE` from a **new** ETL fetch (these 4 codes are not currently pulled anywhere — add them to whichever fetch list in `scripts/hna/build_hna_data.py` already pulls DP04 percent codes, alongside the existing GRAPI rent-burden codes at `build_hna_data.py:867-870`, and store them in `data/hna/summary/*.json`'s `acsProfile` the same way).
3. `pct_no_hs_degree_25plus` — `(DP02_0060E + DP02_0061E) / DP02_0059E`, already-fetched fields, no new ETL.
4. `pct_single_parent_households` — `(DP02_0007E + DP02_0011E) / DP02_0001E`, already-fetched fields, no new ETL.
5. `pct_age_65_plus` — `DP05_0024E / DP05_0033E`, already-fetched fields, no new ETL.

Do **not** add a BIPOC/race metric in this phase — that's Phase 1b, gated on #1129.

**Tests**: extend whatever test currently covers `build_jurisdiction_metrics_digest.mjs`'s metric list (or add one if none exists) asserting the 5 new keys are present, numeric, and in a sane 0-100 range for a real fixture geography. Add a fixture-based test with a known-correct value for at least one real geography, citing the EPS report as the independent source (e.g. Garfield County 2024: cost-burden 34.8%, age 65+ 14.8%, single-parent 5.9% — all independently confirmed exact matches earlier in this project's history).

**QA gate**: regenerate the digest for at least 2 real counties + 2 real places, spot-check the 5 new fields against the EPS report's published 2024 figures for Pitkin County, Garfield County, and at least one municipality (Aspen, Carbondale, or Rifle) — these are independently verified reference numbers, not just internal consistency checks.

## Phase 2 — Regional comparison UI mode

**Files**: `js/hna/hna-controller.js` (the Combined Jurisdictions toggle/panel wiring, `~lines 301-320` and the click handlers around `~3546-3561`), `js/hna/hna-renderers.js` (new render function), plus new CSS reusing `compare.html`'s `.cmp-table` class (don't reinvent the table styling).

1. Add a mode selector next to the existing "Combine jurisdictions" toggle: **"Blended total"** (today's behavior, unchanged) vs. **"Side-by-side comparison"** (new). Both modes share the exact same `combinedMembers` state, chip list, add/remove UI, and 6-member cap already built — don't duplicate that machinery.
2. In "Side-by-side comparison" mode, instead of calling `Combined.aggregate()` and rendering blended stat cards, fetch each selected member's `jurisdiction-metrics-digest/<geoid>.json` directly and render a table: columns = selected jurisdictions, rows = the metrics from Phase 1 (cost burden, AMI-tier shares ×4, housing built pre-1970, overcrowding, no-HS-degree, single-parent, age 65+, renter share), grouped into logical sections (Affordability / Demographics / Housing Stock) matching the report's own chapter structure.
3. This mode does **not** need `combined-geo.js`'s aggregation machinery at all (no CHAS record merging, no weighted averages) — it's strictly "look up each member's precomputed digest values and place them in adjacent columns," which is simpler than the aggregation path, not an extension of it.
4. **Open product question, not yet decided — flag in the PR, don't just pick one silently**: should the 6-member cap apply to this mode too? The blended-total mode's cap exists to keep an aggregate meaningful; a pure side-by-side table has no such constraint (the EPS report itself compares 11 jurisdictions in one table). Recommend keeping 6 for UI-consistency with the existing picker unless told otherwise, but call it out explicitly in the PR description so the owner can weigh in.

**Tests**: a real DOM-render test (not just source-grep, per the standard set by #1130's `loadRenderersDom()` pattern in `test/combined-geo.test.js`) asserting the comparison table renders the correct per-jurisdiction values from a fixture digest, and that switching modes doesn't corrupt the blended-total mode's existing behavior (regression-test the existing Combined Jurisdictions tests still pass unchanged).

**QA gate**: live browser walkthrough selecting 3-4 real jurisdictions (mix of places and at least one county), confirm the table shows genuinely distinct values per column (not the same jurisdiction's data repeated), confirm switching back to "Blended total" mode still works exactly as before, confirm the 6-member cap (or whatever the owner decides) is enforced consistently with the existing picker's warning-banner behavior from #1127.

## Deliverables per phase (PR description template)

1. Summary of what changed and why (link this doc).
2. Which phase item this closes.
3. Verification: what you independently confirmed against current code/data, not just what this doc said.
4. Tests added and their results.
5. For Phase 1: before/after digest values for at least 2 real geographies, cross-checked against the EPS report's published figures.
6. For Phase 2: the open cap-question above — state your recommendation, don't silently decide.
