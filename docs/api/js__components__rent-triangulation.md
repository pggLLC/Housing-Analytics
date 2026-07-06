# `js/components/rent-triangulation.js`

js/components/rent-triangulation.js — F158
===============================================================
Renders a per-jurisdiction rent panel showing three measurements
side-by-side so a council member, investor, or developer can see
which rent figure applies to which question:

  • HUD FMR (2BR) — conservative voucher payment standard
  • ACS B25064 median gross rent — all occupied renter units, 5-yr smoothed
  • Zillow ZORI — asking rents on new leases (35-65th pct)

Headline delta surfaces the gap between ACS (existing tenants) and
ZORI (new-lease asking) — the gap is the "lease-up premium," the
single most-misunderstood number in resort-adjacent CO markets.

Usage:
  RentTriangulation.attach(container, {
    placeGeoid: '0853395',          // optional
    placeName:  'New Castle',       // for ZORI city-name fallback
    countyFips: '08045',            // required for ZORI county + HUD FMR
    countyName: 'Garfield County'
  });

Returns silently with an explainer if no data is available for the
jurisdiction. Never shows "0" or a county figure under a place
header without a label change (avoids place-vs-county masking).

_No documented symbols — module has a file-header comment only._
