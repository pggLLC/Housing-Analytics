# `js/green-building.js`

js/green-building.js
Renders the sourced parts of green-building-guide.html from
data/policy/green-building.json: CHFA's requirements, why efficiency pays,
how it moves a deal, the federal credits and the Colorado programs. Every
figure on those cards comes from the file, each record shows its source and
the words it is quoted from, and a record past its re-check date says so.
The short answer and the "which program for which deal" table are static
HTML in the page; each table row names the records it relies on in
data-gb-ref, and render() turns those into links to the records' cards.

_No documented symbols — module has a file-header comment only._
