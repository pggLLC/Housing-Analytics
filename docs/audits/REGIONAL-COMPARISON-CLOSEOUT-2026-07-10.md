# Regional Comparison — Closeout (2026-07-10)

**Status: Complete.** Both phases of `docs/audits/CODEX-HANDOFF-REGIONAL-COMPARISON-2026-07-10.md` are merged to `main`.

## What shipped

- **PR #1141** (Phase 1) — extended `data/hna/jurisdiction-metrics-digest/<geoid>.json` with the fields the EPS Regional HNA report needed and this repo didn't have: AMI-tier household shares (`pct_ami_lte30/31to50/51to80/gt80`), housing built before 1970 (`pct_housing_built_pre1970`, new DP04 percent codes `0023PE`-`0026PE`), no-HS-degree share (`pct_no_hs_degree_25plus`), single-parent household share (`pct_single_parent_households`), and age 65+ share (`pct_age_65_plus`). Regenerated all 337 county/place/CDP summary caches and digests via `build-hna-data.yml`.
- **PR #1142** (Phase 2) — added the "Side-by-side comparison" mode to the existing Combined Jurisdictions picker in `housing-needs-assessment.html`. Reuses the same jurisdiction chips/add/remove/6-member-cap UI; renders a `compare.js`-style table (`renderRegionalComparison` in `js/hna/hna-renderers.js`) reading each selected member's digest independently — no aggregation, no blending. "Blended total" (the pre-existing combined-aggregation path) is preserved as the default mode alongside it.

## Why this shape

The EPS report never blends jurisdictions into one number — every table is a side-by-side comparison per jurisdiction, with county-level rows being the natural Census nesting, not a user-selected merge. The existing Combined Jurisdictions feature does the opposite (mathematically merges an arbitrary selection into one pseudo-geography). Regional Comparison fills the gap the report actually needs without duplicating or repurposing the aggregation engine.

## Post-merge verification (independently re-run against `main` on 2026-07-10, not just trusted from PR descriptions)

- `npm run test:combined-geo` — 30/30 pass
- `npm run test:jurisdiction-metrics-digest` — all pass
- `npm run test:hna` — 730/0
- `npm run validate` — 52/52 HTML files pass

Rendered smoke check, live browser, `main` HEAD:
- Loaded `?geos=08045+0803620+0812045&combinedMode=regional` (Garfield County + Aspen + Carbondale) — mode and member selection restored correctly from the URL.
- Table rendered all 15 metric rows across all 3 columns with genuinely distinct values per jurisdiction (e.g. housing built pre-1970: 14.1% / 18.2% / 7.9%; single-parent households: 5.9% / 4.1% / 3.7%; age 65+: 14.8% / 17.4% / 19.9%).
- Page copy explicitly reads "Side-by-side view only; not an aggregate" and "no households, rates, or medians are blended" — the no-blending claim is stated on the page, not just true internally.
- Switched to "Blended total" on a valid (non-overlapping) combo — the pre-existing aggregation path still renders correctly, no regression.

## Known, accepted limitations (by design, not gaps)

- **6-member cap** carried over from the shared picker. The report compares 11 jurisdictions; this repo currently caps at 6. Flagged in the UI copy as an open product question, not silently limited.
- **Race/ethnicity is not included.** Deferred — see the Phase 1b handoff request below for the population-level DP05 option, and `docs/audits/SCOPING-HOUSEHOLD-RACE-B25006-2026-07.md` / PR #1144 for the separately scoped household-level EPS-equivalent path (`B25003`/`B25003H`). This was a deliberate scope decision, not an oversight: the DP05 race-code vintage-shift bug (#1129, fixed in #1140) needed to land first.
- **Overlapping-geography validation is pre-existing, not new, and remains specific to blended aggregation.** Selecting a place alongside its containing county (e.g. Garfield County + Carbondale) correctly rejects blended-mode aggregation as a double-counting risk. Regional side-by-side mode is different: it reads each member independently and can display overlapping county/place jurisdictions next to each other because it is not aggregating them.

## Backlog state

No open issues remain for Regional Comparison Phase 1/2. The only follow-on is the optional Phase 1b (race/ethnicity) spec, filed separately pending owner review of the metric definition.
