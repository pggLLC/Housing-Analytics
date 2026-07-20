# `scripts/hna/build_home_value_cascade.mjs`

Build current-market median home value display fields for HNA places and
county HNA ownership-affordability screens.

Tier 1: Zillow city ZHVI, matched once into a GEOID -> RegionID crosswalk.
Tier 2: raw ACS DP04_0089E, labeled as a stale floor when no ZHVI row exists.

The rank/score model continues to ignore this display field.

_No documented symbols — module has a file-header comment only._
