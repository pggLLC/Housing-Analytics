# `js/compare.js`

js/compare.js — Compare Jurisdictions page controller.

Loads the same data as the Opportunity Finder (CHFA LIHTC, QCT, DDA,
CHAS, policy scorecard, affordable-housing properties), computes the
SAME 5-dimension scoring math (need / recency / basis / pop / civic),
and renders a side-by-side comparison table for 2–6 user-picked
jurisdictions.

URL params:
  ?jurisdictions=0851690,0874815,0818750   (comma-separated 7-digit place GEOIDs)
  ?target=9pct|4pct|preservation|workforce_resort|prop123_local|any

Re-uses the public scoring helpers from lihtc-opportunity-finder.js
where possible; falls back to local copies of the formulas otherwise
(the OF module is an IIFE without a clean export surface — that's
audit P0-1 backlog).

_No documented symbols — module has a file-header comment only._
