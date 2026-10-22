# `js/land-banking-map.js`

js/land-banking-map.js
The Prop 123 land banking map, on two pages:
  - land-banking-awards.html (public): grantee organisations and CHFA's program
    contact only, and each town links to its public needs assessment.
  - the developer-gated Where to build page, whose section names its own contacts
    file (data-lbm-contacts) and report link (data-lbm-report). This file names no
    gated path, so the public build can ship it; only a page that names a contacts
    file ever requests one.

Reads data/policy/prop123-land-banking-awards.json (built by
scripts/funding/build_land_banking_awards.py from CHFA's award lists). One pin
per town; an award listing several towns has a pin in each. Pins sit at the town's
Census centre because CHFA lists towns, not addresses.

Each award's status (other state funding for the same project, a partner chosen, or
nothing found) comes from data/policy/prop123-land-banking-status.json
(scripts/funding/build_land_banking_status.py), loaded alongside the awards.

Every count on the section is computed here from the awards file, so the summary
line and the pins cannot disagree with it. A contact the award list did not print
is labelled "to confirm" until someone confirms it.

_No documented symbols — module has a file-header comment only._
