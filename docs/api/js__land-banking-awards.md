# `js/land-banking-awards.js`

js/land-banking-awards.js
Renders land-banking-awards.html from data/policy/prop123-land-banking-awards.json
(built by scripts/funding/build_land_banking_awards.py from CHFA's award lists).

Every number on the page is computed here from the awards in that file, so the
headline, the table and the CSV cannot disagree with each other or with the file.
The map is js/land-banking-map.js (shared with the gated Where to build page); its
search box (#lbmSearch) also filters this table. This page names no contact person:
named contacts stay in the gated contacts file, which this page never requests.

_No documented symbols — module has a file-header comment only._
