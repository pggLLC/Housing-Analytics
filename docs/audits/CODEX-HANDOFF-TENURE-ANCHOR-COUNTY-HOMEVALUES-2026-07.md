# Codex Handoff: tenure-aware place-CHAS anchoring (#1186) + county home values (#1187)

**For: Codex.** Two items, one PR each, in this order — item 1 is the gate for
the ownership roadmap's next phase (#1167 Tier 1); item 2 is small and
independent. Both originate from the EPS Phase II benchmark
(`docs/audits/OWNERSHIP-BENCHMARK-EPS-PHASE2-2026-07.md`, findings F1/F2/F4).

**QA**: Claude re-verifies each PR against its gate before the owner merges.
Mark PRs "Do not merge until external QA completes."

---

## 1. Tenure-aware ACS anchoring for place-CHAS (#1186)

**What's wrong (root-caused, verified)**: `data/hna/place-chas.json` is built
by tract apportionment, so a small town inherits its host tracts' tenure mix —
owner-heavy rural surroundings — instead of the town's own. Parachute:
place-chas reads 149.1 renter / 368.1 owner households (28.8% renter), while
the place's own summary cache (`data/hna/summary/0857400.json`) carries direct
ACS place-level tenure `DP04_0046E = 262` owner / `DP04_0047E = 255` renter
(49.3% renter) — matching the EPS report's 49% exactly, in both 2019 and 2024
vintages (structural, not vintage). Also affected: Snowmass Village (27.3%
place-chas vs 39% ACS), Basalt (24.8 vs 41), Rifle (22.7 vs 34). This biases
`renterShare`, `ownershipFit`, and `rentalPressure` inputs in
`js/hna/hna-ownership-need.js` for exactly the towns the ownership roadmap
targets.

**The fix — extend the existing acs_anchor mechanism to be tenure-aware**:

1. Read the current anchor implementation in `scripts/hna/build_place_chas.py`
   (it currently caps TOTAL household counts to ACS occupied; see the
   `acs_anchor` flags in the output and the 2026-06 "place-chas HH counts
   capped at ACS occupied" convention). Understand it before changing it.
2. After apportionment, rescale **per tenure**: `renter_scale =
   DP04_0047E / apportioned_total_renter_hh` and `owner_scale =
   DP04_0046E / apportioned_total_owner_hh`, from the place's own summary
   cache. Apply each scale uniformly across that tenure's AMI bands and
   cost-burden counts — this preserves the within-tenure AMI distribution and
   burden RATES (the apportionment's genuinely useful signal) while fixing the
   tenure LEVELS and mix. Recompute `summary.*` fields from the rescaled bands.
3. Fallbacks, explicitly handled and flagged in the record: summary cache
   missing, or DP04 tenure fields null/zero → keep current behavior for that
   place and set a flag (e.g. `tenure_anchor: "unavailable"`); tiny places
   where DP04 tenure has margin-of-error zeros → same. Never divide by zero;
   never rescale a tenure whose apportioned total is 0.
4. Record metadata per place (e.g. `tenure_anchor: {applied: true,
   renter_scale: …, owner_scale: …, source: "DP04_0046E/0047E place-level"}`)
   and bump the file-level meta. `js/hna/hna-ownership-need.js`'s
   `dataQuality()` already reads `acs_anchor` — decide (and document in the PR)
   whether `tenure_anchor` should also demote quality; recommendation: no
   demotion when applied cleanly (it makes data BETTER), demote to Medium when
   `unavailable`.
5. **Regeneration order + coupling (this chain has burned CI before — see
   `docs/audits/` incident notes)**: summary caches are INPUTS here (do not
   regenerate them); regenerate in this order: `place-chas.json` (this fix) →
   place pages (`scripts/hna/build_place_pages.py`; `test:place-pages-fresh`
   FAILS CI on drift) → jurisdiction digests
   (`npm run build:jurisdiction-metrics-digest`) → ranking index
   (`scripts/hna/build_ranking_index.py` consumes place-chas owner-burden
   fields) → ranking scenarios (pinned to the index's `generatedAt`;
   `test:ranking-scenarios` fails if you regenerate the index without them).
   Commit all regenerated artifacts in the same PR.
6. **Basalt / cross-county (F2)**: Basalt (`0804935`) is 74% Eagle County
   (`cross-county-places.json`, `primary_county: "08037"`) and is ABSENT from
   `data/hna/derived/place_county_lookup.json` (verified — the flat map has no
   `0804935` key). Trace how the HNA controller resolves Basalt's
   `contextCounty` today (cross-county handling exists — find it before
   changing anything). Required outcome: the ownership panel's county-context
   inputs (AMI fallback, county CHAS fallback) for cross-county places use
   `primary_county`. If tracing shows this already works, document the
   evidence in the PR instead of changing code.

**Tests** (extend `test/hna-ownership-need.test.js` or a new file wired into
the explicit `test:ci` chain — new test files do NOT auto-run):
- Data-level guard: for every place in `place-chas.json` where
  `tenure_anchor.applied`, `summary.total_renter_hh / (renter+owner)` matches
  the place's `DP04_0047PE / 100` within ±1pt. Non-vacuous proof: temporarily
  zero one town's `renter_scale` application and show the guard fails.
- Fixture spot-checks with the EPS/ACS anchors: Parachute renter share ≈ 49.3%
  (±1), Snowmass ≈ 39 (±2), Rifle ≈ 34 (±2), Basalt ≈ 41 (±2, using its
  blended two-county ACS place record).
- Within-tenure rates preserved: pick one town, assert renter
  `pct_cost_burdened_30` per band is unchanged from the pre-fix value (rates
  must survive rescaling; only levels move).

**QA gate**: full `test:ci` green locally (including place-pages-fresh and
ranking-scenarios); the four benchmark towns' renter shares close to the EPS
anchors as above; a county view and a non-affected large place (e.g. Aspen,
Glenwood Springs) show materially unchanged numbers (their apportionment was
already sound — large deltas there mean the rescale is misapplied); zero
console errors on the HNA ownership panel for Parachute
(`?geoid=0857400&geoType=place&auto=1`) and Basalt.

---

## 2. County home values for the affordability test (#1187)

**What's wrong**: `affordabilityTest` in `js/hna/hna-ownership-need.js`
returns null for county selections because `data/hna/home-value-cascade.json`
(built by `scripts/hna/build_home_value_cascade.mjs`) covers places only — so
the county HNA view (the default landing) never shows
market-attainable/stretch/priced-out.

**Implementation**:
1. Check whether a county-level ZHVI CSV exists under `data/zillow/` (the
   place build uses the city file). If yes, mirror the existing tier-1
   (ZHVI) → tier-2 (ACS floor) cascade for the 64 counties. If no, ship
   counties on ACS DP04_0089E (median home value) from the county summary
   caches (`data/hna/summary/<fips>.json`), labeled exactly the way the place
   tier-2 fallback labels its "stale floor" — do NOT add a new external fetch
   for this item.
2. Extend the cascade file's schema additively (e.g. a `counties` block
   parallel to places) and update `_ownHomeValueForSelection()` in
   `js/hna/hna-renderers.js` to look up counties. Keep the display-only
   convention: the rank/score model must continue ignoring these fields
   (stated in the builder's header — preserve that contract).
3. The renderer/test conventions from `test/hna-home-values.test.js` apply —
   extend it for the county block and wire any new npm script into `test:ci`.

**QA gate**: Pitkin and Garfield county views render an affordability
classification (both should classify priced-out or stretch given resort-area
values — sanity-check against the EPS narrative); place behavior byte-
unchanged for a sample (Aspen, Lamar); `npm run test:hna-home-values` and full
`test:ci` green; non-vacuous proof on the new county lookup (remove the
counties block → county test fails).

---

## Deliverables per PR
1. What changed, which issue it closes, evidence for every claim you relied
   on (line numbers drift — recheck), and for item 1: before/after renter
   shares for the four benchmark towns plus one unaffected control.
2. Non-vacuousness proofs as specified.
3. For item 1: explicit confirmation of the regeneration order used and that
   ranking scenarios were rebuilt with the index.
