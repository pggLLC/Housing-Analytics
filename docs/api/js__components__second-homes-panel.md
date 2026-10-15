# `js/components/second-homes-panel.js`

js/components/second-homes-panel.js
===================================
"Second homes, short-term rentals and lodging taxes" panel for one HNA
geography, read from data/hna/second-homes-str.json (built by
scripts/hna/build_second_homes_str.py).

One panel on purpose: where second homes and short-term rentals take a
large share of the stock, the lodging or short-term rental tax that pays
for local housing and the town's seasonal or workforce housing programs
are the same discussion, so they are read together.

Absence is said as absence. No license count is "not found yet", never 0;
no tax on record is "none on record", never "none".

Usage:
  SecondHomesPanel.attach(container, { geoid: '0880040', geoType: 'place' });

_No documented symbols — module has a file-header comment only._
