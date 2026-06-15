# `js/lihtc-opportunity-finder.js`

js/lihtc-opportunity-finder.js

JURISDICTION-LEVEL LIHTC opportunity analyzer.

Per user feedback (2026-05-25): the original tract-level rollup
answered "which polygon" when the actual workflow needs "which
jurisdiction to target." This rebuild rolls every signal up to the
place (city / town / CDP) level so a developer can scan a sortable
table of CO jurisdictions and target candidates for 4% bond rounds
or 9% competitive rounds.

Per jurisdiction we compute:
  - # of QCTs intersecting the place (via place-tract-membership)
  - DDA designation (containing county is one of CO's 10 nonmetro DDAs)
  - All LIHTC projects in the jurisdiction (matched by PROJ_CTY)
  - Last YR_PIS + years-since
  - HNA Scorecard composite for the containing county
  - Population (from co_ami_gap_by_place's implied HH counts)
  - Opportunity score, weighted differently for 4% vs 9% targets

Score weights by target:
  9% Competitive:  40% recency · 30% need · 20% basis-boost · 10% pop
  4% Bond:         25% recency · 25% need · 15% basis-boost · 35% pop
  Any (balanced):  35% recency · 30% need · 20% basis-boost · 15% pop

Rationale: 9% awards reward geographic-gap + housing-need scoring;
QCT/DDA basis boost is competitive. 4% bond deals are scale-driven —
need a population base for 100-200 unit absorption. Both benefit from
basis boost but it's less of the differentiator in 4%.

Sources: HUD QCT + DDA designations, CHFA/HUD LIHTC project data,
data/hna/place-tract-membership.json (TIGER 2024 spatial join),
data/co_ami_gap_by_place.json (per-place HHs from ACS), CHAS county
cost-burden composite, geo-config place labels.

## Symbols

### `recencyScore(lastYear)`

F146 — Recency score: 0 = funded right now (no opportunity), 100 = not
funded in 4+ years OR never funded (maximum opportunity).

Linear ramp years 0–4, then saturates at 100. The 4-year cap reflects
the typical LIHTC cycle: a project funded in 2023 is still "recent"
through ~2027; older than that, the jurisdiction has had a full cycle
to re-enter the pipeline so it's "not recent" regardless of exact age.

`lastYear` should be the MAX of all known award/PIS years, including
recent CHFA award rounds (e.g. 2026 R1 from the bridge file) that
haven't propagated to the HUD LIHTC database yet. See
`mostRecentAwardYearFor` for the resolver.

@param {number|null} lastYear  Calendar year of most-recent LIHTC activity
@returns {number}              0–100

### `bridgeAwardYear(meta)`

F146 — Pull the award year out of a CHFA bridge metadata block.
Bridge files (currently `data/affordable-housing/chfa-awards/
2026-round-one.json`) carry the round label in
`metadata.round` (e.g. "2026 Round One"); parse out the leading
4-digit year. Falls back to parsing `metadata.announcement_date`
if the round string is missing. Returns null when neither is
present (caller should treat as "no signal").

### `needCompositeFor(countyFips, placeGeoid)`

F223 — Need composite. Previously took only countyFips → every place in
a county got identical "need" scores (Garfield County's score applied
uniformly to New Castle, Silt, Glenwood Springs, Carbondale). Now
accepts a placeGeoid (optional); when present, looks up place-level
CHAS (renter+owner cb30/cb50 shares, population-apportioned from
tract-level data). Falls back to county when place data missing or
low_confidence.

Returns { composite, source } where source ∈ 'place' | 'county' | null.

### `_scenarioScore(op, scenario)`

F236 — Compute a one-off composite using user-chosen weights +
recency source. Mirrors compositeScore() but uses scenario.weights
instead of SCORE_WEIGHTS[target] and routes recency through
scenario.recencySource.

recencySource values:
  'smart'        — use the preset's built-in routing (matches the
                   F234/F235 per-target recency mapping)
  'generic'      — op.recencyScore (any LIHTC)
  '9pct'         — op.recencyScore_9pct
  '4pct'         — op.recencyScore_4pct
  'state_credit' — op.recencyScore_state_credit
  'competitive'  — op.recencyScore_competitive
