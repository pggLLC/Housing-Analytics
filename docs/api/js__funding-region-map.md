# `js/funding-region-map.js`

funding-region-map.js — region and town map on where-housing-money-goes.html.

Reads data/derived/funding-map.json (scripts/funding/build_funding_map.py),
which places every CHFA, OEDIT, Division of Housing and DOLA award from the
page's own award files on a site, town and state planning region. Draws a
region and town picker, town cards, a pin map beside the award list, capital
stacks from the deal summaries, and region or town downloads that carry the
data's limits. Loads its data only when the section nears the screen.

_No documented symbols — module has a file-header comment only._
