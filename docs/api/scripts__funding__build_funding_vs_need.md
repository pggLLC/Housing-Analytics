# `scripts/funding/build_funding_vs_need.mjs`

scripts/funding/build_funding_vs_need.mjs — where public housing subsidy has
gone, county by county, against the need and market the site measures.

Reads the award ledger (scripts/funding/build_funding_awards.py), the county
rows of the ranking index, building permits against projected need, and
CHFA's 2026 rent limits. Writes data/derived/funding-vs-need.json, which the
Funding vs Need tab of colorado-deep-dive.html renders.

It is a step of the derived chain (scripts/rebuild-derived.mjs) because it
reads the ranking index. Every measure that cannot be computed is null with
the reason beside it; nothing is defaulted to zero.

Usage: node scripts/funding/build_funding_vs_need.mjs [--check]
  --check  exit 1 if the committed output differs from a fresh build

_No documented symbols — module has a file-header comment only._
