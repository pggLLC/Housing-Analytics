# `js/market-direction.js`

market-direction.js — Market Direction tab on colorado-deep-dive.html.

Reads data/market/market-direction.json (scripts/market/build_market_direction.py,
a step of the derived chain): a call for every county and town, with the
readings behind it. A county's projects come from
data/market/development-activity.json, loaded the first time one is picked.
The page computes nothing the files do not hold except sums and counts of
their own rows; the call names, their definitions and the thresholds are
read from the file's meta, so the page cannot disagree with the rule.

A missing reading renders as "No reading" with its reason, never as 0.

_No documented symbols — module has a file-header comment only._
