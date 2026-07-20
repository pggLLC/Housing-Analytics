# `scripts/augment_lihtc_by_geometry.mjs`

F191 — Augment ranking-index.json with LIHTC counts via point-in-
polygon attribution (closes future-work item 4: CDP coverage).

The existing recency augmentation script (scripts/augment_ranking_
index_recency.mjs) matches LIHTC records to jurisdictions by
normalized city name. This works for cities + towns where the LIHTC
record's PROJ_CTY matches a place's `name` field. It FAILS for CDPs
(Census Designated Places — unincorporated areas) because LIHTC
records list a postal city (e.g. "Aurora"), not the CDP name (e.g.
"Acres Green CDP").

F191 fixes that by doing point-in-polygon against
data/co-place-boundaries.geojson. Each LIHTC record's lat/lng is
tested against every place polygon; the containing place gets +1 to
its lihtc_in_boundary count.

Writes:
  - rankings[*].metrics.lihtc_in_boundary  (geographic count)
  - rankings[*].metrics.lihtc_in_boundary_year (max year of contained projects)
  - metric descriptors added

The original `lihtc_project_count` (city-name-matched) stays in
place; the new field supplements it. Consumers can pick whichever
fits the semantic — city-name matching is more conservative for
cities (counts only properties listing that city as PROJ_CTY); the
geometric count is more accurate for CDPs (counts properties whose
coordinates fall inside the CDP boundary).

Idempotent.

_No documented symbols — module has a file-header comment only._
