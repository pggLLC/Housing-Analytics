# `js/land-banking-awards.js`

js/land-banking-awards.js
Renders land-banking-awards.html from data/policy/prop123-land-banking-awards.json
(built by scripts/funding/build_land_banking_awards.py from CHFA's award lists).

Every number on the page is computed here from the awards in that file, so the
headline, the table and the CSV cannot disagree with each other or with the file.
The map is js/land-banking-map.js (shared with the gated Where to build page); its
search box (#lbmSearch) and filters also filter this table (it listens for the map's
"lbm:change" event). The table sorts the whole filtered list, not only the rows on
screen, from its headers or, on a phone where the headers fold away, the "Sort by"
menu; its headers carry data-sort-key so the shared sorter leaves them to this file.
This page names no contact person:
named contacts stay in the gated contacts file, which this page never requests.

_No documented symbols — module has a file-header comment only._
