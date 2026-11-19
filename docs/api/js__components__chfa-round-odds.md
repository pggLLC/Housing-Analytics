# `js/components/chfa-round-odds.js`

chfa-round-odds.js — how many of CHFA's competitive 9% (Round One) and
4% + state credit (Round Two) applications were
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

Round Two (federal 4% credit paired with state credit, the competitive 4%
round) is counted the same way: rows of each year's Round Two applicant
report against that year's Round Two award report rows (ledger rows with
round 2 and a 4% federal credit). A year with an applicant report but no
award report yet is named as pending, never shown as 0 awarded.

_No documented symbols — module has a file-header comment only._
