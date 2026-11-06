# `js/components/hud-contract-expiry.js`

js/components/hud-contract-expiry.js
====================================
"Federal rent subsidy contracts ending soon" on the Preservation page.

Reads data/market/hud_s8_contracts_co.json, Colorado's rows from HUD's
Multifamily Assistance & Section 8 Contracts database
(scripts/hud/build_hud_s8_contracts.py), and fills #hudContracts with a
one-line count, a county and year filter, and a table that table-sort.js
sorts and table-header-tips.js explains.

"Term ends" is the end of HUD's overall contract term. Owners can renew,
so the section calls it a date to watch, never a loss.

_No documented symbols — module has a file-header comment only._
