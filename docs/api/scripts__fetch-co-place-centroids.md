# `scripts/fetch-co-place-centroids.mjs`

fetch-co-place-centroids.mjs  (F16, 2026-05-27)

One-shot data-refresh script that pulls the Census TIGER Gazetteer
file for Colorado places and produces data/co-place-centroids.json
keyed by 7-digit place GEOID with lat/lng.

Why: tract_centroids_co.json is documented-corrupted (Appendix A.2
of the repo audit — GEOID→coord pairings scrambled). County centroids
are reliable but place a single dot at the county center, which
causes Blue River, Breck, Frisco, etc. all to stack at the Summit
County center. With this file we get per-place INTPTLAT/INTPTLONG
from the Census Gazetteer — accurate population-weighted centroids
for all 482 Colorado incorporated places + CDPs.

Used by:
  - js/lihtc-opportunity-finder.js _computeOpportunities() for
    marker placement on the OF map.

Run:
  node scripts/fetch-co-place-centroids.mjs

The Gazetteer is updated annually by Census (usually February-March).
To refresh: bump GAZETTEER_URL to the latest year and re-run.

_No documented symbols — module has a file-header comment only._
