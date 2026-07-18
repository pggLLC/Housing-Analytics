# RFC — Barrier-Aware PMA and Commute-Shed Delineation

**Issue:** #1232 (final phase) · **Handoff honored:** CODEX-HANDOFF-PMA-BARRIER-COMMUTE-SHED-RFC-2026-07.md
**Author:** Claude QA · **Date:** 2026-07-18 · **Status:** decision-ready, awaiting owner sign-off
**Scope:** methodology decision record only — no production code was written for this RFC.

## 0. Decision summary (what the owner is approving)

1. **Complete the barrier dataset before any method ships** (C1): the committed
   barriers file is materially narrower than documented — see §2. Method work
   on incomplete data would bake in blind spots.
2. **Adopt friction-downweighting (M3), reject exclusion-by-crossing (M2), defer
   graph connectivity (M1)**: cross-barrier tracts get a disclosed, bounded
   downweight — never silent exclusion — until crossing data exists (§3).
3. **Commute-shed ships first as a context overlay (D-lite), not an analytic
   extension**: the committed LODES surface cannot support per-site capture
   math (§5). D-full requires a new build artifact and separate approval.
4. **Calibration is a hard gate**: C3 (enabling barrier-aware mode by default)
   is blocked until at least one professional site-level PMA benchmark is in
   hand (§6). Application market studies are not publicly published; the
   likeliest source is owner-provided studies.
5. Staged PRs C1 → C2 (flag off) → C3 (enable, disclosed) → D-lite → D-full (§9).

Everything below is evidence for those five calls.

## 1. Prior-art audit (js/pma-barriers.js, js/pma-commuting.js)

**pma-barriers.js** — heuristic *area-percentage* subtraction, not tract logic:
`WATER_EXCLUSION_FACTOR = 0.02` ("each water body covers ~2% of PMA area"),
`HIGHWAY_EXCLUSION_FACTOR = 0.01`, land-cover factors, capped sums; plus
`MIN_BARRIER_AADT = 10000` (line 193) and a straight-line site→centroid
crossing helper. **Verdict: none of it survives.** The area-percentage factors
are exactly the fabricated-calibration class the handoff bans; the AADT floor
is a weak discriminator on the current data (§2); the straight-line crossing
helper is the M2 shape rejected in §3. Salvage value: the fetch wrappers'
bbox plumbing only.

**pma-commuting.js** — contains `buildConvexHullPolygon` (the geometry we just
eliminated from the PMA display) and `_buildSyntheticWorkplaces` fallback with
`lastDataCoverage = 'fallback'`. **Verdict: the synthetic path and hull path
must never reach shipped analysis** (test-guarded in §8). Salvage value: the
`lastDataCoverage` flag is the right *shape* for a data-coverage gate — invert
it into a hard precondition (`!== 'fallback'`) rather than a fallback marker.

## 2. Barrier dataset audit (data/market/natural_barriers_co.geojson)

11,175 features. Audited 2026-07-18:

| Slice | Count | Notes |
|---|---:|---|
| highway (LineString, CDOT) | 10,084 | **All `route_sign: "I"` — interstates only**: I-70 (4,773 segs), I-25 (3,627), I-76 (1,341), I-225, I-270 |
| water (Polygon, TIGERweb) | 1,091 | `lake` 1,016 / `water` 75 — **areal water only; zero linear rivers** |

Findings that gate method work:

- **F-DATA-1 — the `sub_type` field is degenerate**: every highway segment is
  labeled `interstate`. The fetch script requests CDOT `ROUTESIGN` "I" *and*
  "U", but the committed file contains no US routes — the "U" fetch failed
  silently at generation (the script warns and continues). US-285/US-160/US-50
  and all state highways are absent.
- **F-DATA-2 — no rivers**: TIGERweb areal water gives lakes/reservoirs, but
  the Colorado, Arkansas, and canyon rivers — the classic Western-slope market
  separators — are not in the file as linear features.
- **F-DATA-3 — AADT is present on 100% of highway segments** (min 8,200 · p25
  19,000 · median 33,000 · p95 197,000). The prior `MIN_BARRIER_AADT = 10000`
  keeps 96% of segments — a near-no-op on interstates-only data. AADT tiering
  is only meaningful after US/state routes are added, and thresholds may then
  come **only** from calibration (§6), not from this distribution.
- Useful fields that DO exist: `route`, `route_sign`, `county_fips`,
  `speed_limit`, `name`, `source`.

**C1 therefore includes a data-completion task**: re-run
`scripts/market/fetch_natural_barriers.py` with the "U" fetch fixed and add
TIGER linear hydrography (rivers/streams above a named-feature floor), with a
non-vacuousness test on route-sign diversity and river presence so a silent
partial fetch can never be committed again (the same failure class the
file-manifest shrink guard covers).

## 3. Barrier-aware method options

### M1 — Tract-graph connectivity (deferred)
Build tract adjacency (build-step, from the canonical tract geometry — the
simplified display derivative may break shared edges, so adjacency must be
computed from `tract_boundaries_co.geojson` with a buffered-intersection test),
cut/downweight edges crossed by hard barriers, take the site's connected
component. *Strengths:* principled; catches detour-only connectivity and
"near but separated" tracts; the only method that can honor bridges properly.
*Fatal blocker today:* crossing recognition. Urban interstates are crossed by
dozens of streets per mile; without a crossings/interchange inventory (not
committed; CDOT publishes one but it is unaudited here) M1 over-excludes most
of metro Denver. *Cost:* build-step precompute + trivial browser BFS.
**Defer until a crossings dataset is audited into C1 or later.**

### M2 — Site-to-tract straight-line crossing screen (rejected as exclusion)
The prior-art shape: if the straight line from site to tract representative
point crosses a barrier, exclude the tract. *Why rejected:* false positives
everywhere a bridge exists (Denver I-25: practically every east-west pair);
false negatives where practical access detours around the line; especially
fragile for large rural/resort tracts whose representative point is far from
the populated area. Exclusion on this signal would move scores on wrong data.

### M3 — Crossing-informed friction downweight (recommended)
Same crossing signal as M2, but the consequence is a **bounded, disclosed
multiplier on the tract's `_bufferShare`** — never exclusion, never zero. A
cross-barrier tract keeps contributing; its weight drops by a calibrated
factor and the UI badges it ("separated by I-70 · weight reduced"). *Why this
first:* bounded harm under known data gaps (a bridge false-positive costs a
fraction of a weight, not a tract); composes with the existing PR-B
apportionment (multiplies the polygon share); trivially testable; reversible
by flag. The multiplier value (e.g. ×0.5) is **not proposed here** — it is a
calibration output (§6), and C2 ships with the flag off and the multiplier
sourced from a fixture file marked non-production until C3.
*Water polygons:* lakes have no crossings, so for `water` barriers the same
crossing test is meaningful as-is (a line through Dillon Reservoir is a real
separation); interstates carry the bridge caveat above.

**Public disclosure line (M3):** "Barrier-aware weighting reduces — never
removes — the contribution of tracts separated from the site by an interstate
or major water body. Weights and the barrier inventory are disclosed per
tract."

## 4. Crossing and connectivity logic (for M3 now, M1 later)

- Crossing test: segment-intersection between the site→tract-point line and
  barrier LineStrings / polygon boundaries, in the PR-B local-mile projection.
  Multiple crossings of the same route count once per `route`.
- Tract point: use the tract's largest-ring centroid-on-surface (compute at
  build time into the display-geometry derivative; a plain centroid can fall
  outside irregular mountain tracts — the handoff's rural fragility warning).
- Bridges/interchanges: **not representable with committed data** — recorded
  as the reason M3 downweights instead of excludes, and the reason M1 waits.
- Same-route double-count guard and reservoir-vs-river distinction get
  fixtures (§8).

## 5. Commute-shed scoping

Committed LODES surface (audited): `lodes_co.json` — tract-level WAC/RAC,
all 1,447 tracts, 2023 vintage, real data; `lodes_od_arcs_co.geojson` —
**top-500 statewide arcs only**, not a matrix; place-level OD flows exist per
place in `data/hna/lehd/`. Consequence: *per-site* capture math ("tracts
supplying 70–80% of workers to jobs near this site") is **not computable from
committed data** for arbitrary sites.

- **D-lite (recommended first): context overlay, no analytic change.** Job
  density from WAC per included tract + any of the top-500 arcs touching the
  buffer, rendered as a labeled overlay ("LODES 2023 commute context — does
  not change PMA scores"). Ships with committed data; no capture threshold
  claimed, so none must be defended.
- **D-full (separate approval): analytic extension.** Requires a new
  build-step artifact — a tract-to-tract OD matrix for Colorado filtered to a
  materiality floor — plus decisions on capture threshold, home-vs-workplace
  anchoring, and barrier interaction. Not scoped further here; it should get
  its own one-page decision record if the owner wants it after D-lite.
- Hard guard carried from the handoff: the synthetic-workplace and hull paths
  in pma-commuting.js are dead code for analysis; a test asserts shipped
  output cannot change when the synthetic path is force-enabled (§8).

## 6. Calibration evidence plan (hard gate for C3)

Searched for fetchable professional site-level PMA maps: CHFA application
market studies are **not publicly published**; the public normative source is
CHFA's market-feasibility guidance (PMA drawn from commuting patterns, transit
access, natural boundaries, economic linkages — browser-UA fetch). Therefore:

1. **Primary path — owner-provided artifacts**: 1–2 professional market
   studies with PMA maps/descriptions from the owner's files (the EPS Phase II
   regional HNA on hand is region-level, not site-PMA — usable as context,
   not as the benchmark). Per-benchmark comparison table exactly as the
   handoff specifies (professional PMA vs current buffer PMA vs M3 output,
   directional verdict, mismatch notes).
2. **Secondary path — council-packet hunting** (C1 task, time-boxed): full
   market studies occasionally appear in municipal agenda packets for projects
   seeking local funds; if found and fetchable they become citable artifacts.
3. **Normative supplement (not sufficient alone)**: conformance review of M3
   output against the CHFA guidance factors on 3–4 owner-picked sites
   (urban / suburban / rural / resort).

**If neither path 1 nor 2 produces at least one site-level benchmark, C3 does
not ship** — C2's flag stays off and the phase pauses. No invented multipliers,
no invented thresholds. (Handoff rule honored verbatim.)

## 7. UX and disclosure contract

- Modes: **Circular buffer (default, unchanged)** · **Barrier-aware (toggle,
  default off until C3; "beta" label until a benchmark round passes)** ·
  **Commute context (overlay toggle, D-lite)**.
- Whole-tract fills with weight opacity remain the only geometry — no clipped
  arcs, no decorative trimming (owner decision, restated).
- Downweighted tracts: badge in the per-tract audit table ("−I-70 separation ·
  weight ×0.5 [calibrated]") and in the PMA export/summary, which also records
  mode, barrier inventory vintage, and multiplier source.
- Missing/partial barrier data: warning chip ("Barrier data unavailable —
  circular-buffer weights in use"), never a silent fallback.
- Score movement at C3: migration table in docs/PMA_SCORING.md (urban /
  suburban / rural / resort fixtures), re-pinned tests — same protocol as
  PR B (#1238).

## 8. Test and QA plan (implementation PRs must land these)

1. Cross-barrier fixture: a known I-70-separated tract pair (Glenwood Canyon
   area) — separated tract downweighted under flag-on, untouched flag-off.
2. Same-side control: adjacent same-side tract keeps weight exactly.
3. Reservoir fixture: Dillon Reservoir separation recognized from water
   polygons; reservoir-vs-lake subtype does not matter to the result.
4. Bridge false-positive bound: a Denver I-25 pair may lose at most the
   calibrated fraction — assert no exclusion path exists (grep + behavior).
5. Barrier file removed → warning surfaced, weights identical to flag-off,
   scores unchanged (the silent-fallback killer).
6. Synthetic-commute guard: force `_buildSyntheticWorkplaces` on → shipped
   analysis output byte-identical; `lastDataCoverage === 'fallback'` blocks
   the overlay with a data warning.
7. Rendered tract set === analytic tract set under every mode (extends the
   #1237 exact-set guard).
8. Data non-vacuousness after C1 refresh: route-sign diversity (I **and** U
   present), river LineStrings present, counts within shrink-guard tolerance
   of the prior vintage.
9. External QA pre-registered sabotage: disable one crossing/downweight
   branch — at least one of tests 1/3/4 must fail.

## 9. Recommended PR split

- **C1 — data completion + audit (no behavior change):** fix the U-route
  fetch, add linear hydrography, regenerate barriers with non-vacuousness
  tests (item 8); compute centroid-on-surface points into the display
  derivative; benchmark acquisition (§6 paths 1–2); commit calibration
  fixtures as clearly-marked non-production artifacts.
- **C2 — M3 behind a default-off flag:** crossing test + downweight wiring,
  multiplier from fixture marked non-production, tests 1–7, zero default
  score movement (CI-asserted).
- **C3 — enable after benchmark sign-off:** calibrated multiplier with cited
  evidence, migration table, re-pinned scores, browser QA evidence, "beta"
  label until one post-ship benchmark validation round.
- **D-lite — commute context overlay:** independent of C2/C3; committed data
  only; test 6.
- **D-full — analytic commute-shed:** separate decision record; not approved
  by this RFC.

## 10. Owner decisions requested

1. Approve M3-first / M2-rejected / M1-deferred (§3).
2. Approve C1 data completion as a prerequisite (§2).
3. Confirm you can provide 1–2 professional market studies as calibration
   artifacts (§6 path 1) — or direct the time-boxed council-packet hunt only.
4. Approve D-lite as the only commute-shed work in this phase (§5).
5. Approve the staged split and the C3 hard gate (§6, §9).
