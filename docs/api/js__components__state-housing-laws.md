# `js/components/state-housing-laws.js`

js/components/state-housing-laws.js
====================================
"State housing laws that apply here" for the Housing Needs Assessment pages.

Reads data/policy/state-housing-laws.json, a copy of DOLA's Multilaw
Applicability sheet keyed by GEOID (scripts/policy/build_state_housing_laws.py),
and fills every [data-state-laws] mount. It leads with SB24-174, the law that
makes counties and towns send DOLA a housing needs assessment by
December 31, 2026, then lists every law in DOLA's own words.

Which geography: the one the report shows (HNAState.state.current, announced
as `hna:geography-changed`), as in place-deals-limits.js. A CDP is
unincorporated, so its county's obligations apply. Statewide and combined
views get a one-line pointer instead of a list.

COHO doesn't decide compliance. The card says so and links DOLA.

_No documented symbols — module has a file-header comment only._
