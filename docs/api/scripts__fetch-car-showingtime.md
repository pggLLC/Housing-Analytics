# `scripts/fetch-car-showingtime.mjs`

Fetch Colorado Association of REALTORS county market stats from ShowingTime.

The ShowingTime host occasionally blocks non-browser fetches. This script is
deliberately best-effort: it logs and exits 0 on WAF/network/parse failure so
the monthly placeholder generator can keep the build green.

_No documented symbols — module has a file-header comment only._
