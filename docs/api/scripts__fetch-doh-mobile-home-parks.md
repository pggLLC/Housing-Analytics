# `scripts/fetch-doh-mobile-home-parks.js`

fetch-doh-mobile-home-parks.js

Fetches the Colorado Division of Housing's registered mobile home parks and writes
  data/affordable-housing/preservation/doh-mobile-home-parks.json

Sources (DOH Mobile Home Park Oversight, https://doh.colorado.gov/mobile-home-parks):
  - Lot counts by park: one row per registered park, with its address, county and lots by type.
  - Parks owned by residents, nonprofits or local governments: marks those parks and their year of purchase.

Left out on purpose: owner and manager names, and DOH's list of parks with sale notices.
The sale-notice list is a dated acquisition lead and belongs on the member site (paul, 2026-10-26).

Addresses are placed with the US Census Geocoder (batch, public, no key). A park the
geocoder cannot match keeps its row with geometry null, and is counted in meta.

DOH says it does not guarantee the lists' accuracy; meta.caveat carries that.

Run:  node scripts/fetch-doh-mobile-home-parks.js

_No documented symbols — module has a file-header comment only._
