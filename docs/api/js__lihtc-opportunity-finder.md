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

_No documented symbols — module has a file-header comment only._
