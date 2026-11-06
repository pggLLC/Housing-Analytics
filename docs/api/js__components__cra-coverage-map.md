# `js/components/cra-coverage-map.js`

js/components/cra-coverage-map.js

The bank and CRA coverage map on affordable-deal-team.html.

Two readings, matching the page's two cards:
  - Conservative: counties shaded by how many banks have a branch there
    (FDIC Summary of Deposits). A branch county is a screen for the bank's
    assessment area, not the area itself; the panel says so.
  - Expansive: every bank with a Colorado branch has a Colorado assessment
    area. A large bank may count an investment anywhere in the state under
    the "broader statewide or regional area" text of 12 CFR 228.23(a); an
    intermediate small bank may too, under the agencies' Q&A 12(h)-6 (its
    own test's rule text names no area). Both only if the bank has served
    its own areas first. The map is one shade and
    the panel lists those banks for the chosen county.

Pick a county by clicking it or from the list under the map (the list is
the keyboard and screen-reader route). Data: data/cra/co-bank-branches.json,
built by scripts/cra/fetch_fdic_branches_co.py.

_No documented symbols — module has a file-header comment only._
