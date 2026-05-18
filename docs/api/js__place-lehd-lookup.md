# `js/place-lehd-lookup.js`

place-lehd-lookup.js

Browser-side helper for the place-level LEHD WAC blob produced by
scripts/hna/build_place_lehd.py:

  PR-C2 — TIGER place→tract spatial membership
  (this) — place-level LEHD WAC via population-weighted
           apportionment of each containing county's blob

Why
---
LEHD LODES8 WAC publishes employment data at COUNTY granularity in
the cached pipeline. Without place-level apportionment, every place
selection on HNA silently inherits the parent county's wage /
industry numbers — fine for a city that dominates its county
(Denver, Colorado Springs) but very misleading for small towns
(Paonia, Manitou Springs) and cross-county jurisdictions (Aurora,
Erie, Longmont).

Public API
----------
  window.PlaceLehd.init()       — fetch + cache data/hna/place-lehd.json
  window.PlaceLehd.lookup(geoid)— returns place LEHD blob or null
  window.PlaceLehd.confidence(geoid) — 'high' | 'medium' | 'low' | null

The lookup return shape matches the county LEHD cache files so
callers can drop a place blob into renderers that previously read
`__HNA_LEHD_CACHE[county]` (same C000, CE01–03, CNS01–20,
within/inflow/outflow, annualEmployment {year:n}, annualWages
{year:{low,medium,high}}, industries[]).

_No documented symbols — module has a file-header comment only._
