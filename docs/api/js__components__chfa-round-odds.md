# `js/components/chfa-round-odds.js`

chfa-round-odds.js — how many of CHFA's competitive 9% applications were
funded, year by year, for the LIHTC guide's 4% or 9% decision tree and the
comparison table below it.

Applications are the rows of each year's Round One applicant report
(data/policy/funding-awards/applicant-report-counts.json, the public copy of
the report counts that scripts/funding/build_lihtc_applications.py writes;
a report counts only when its rows add up to the totals it prints). The
full applications file is blocked from the public build, so reading it
left the guide's line frozen at its printed text. Awards are that year's 9%
award report rows (data/policy/funding-awards/ledger.json). A year missing
either report is left out, never shown as 0 awarded.

_No documented symbols — module has a file-header comment only._
