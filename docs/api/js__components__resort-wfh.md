# `js/components/resort-wfh.js`

js/components/resort-wfh.js — F145
===================================
Renders resort workforce-housing program detail when the selected
jurisdiction is in a known resort housing authority's service area
(APCHA, Vail InDEED, Eagle County, SCHA, Telluride, YVHA).

For non-resort jurisdictions the component renders nothing — no
"no data" placeholder. The HNA + IC packet already explain general
tax abatement + capital partners; this is specifically the
negotiated resort-market mitigation + buy-down + linkage detail.

Usage:
  ResortWfh.attach(container, {
    placeGeoid: '0803620',   // or
    countyFips: '097',
    jurisName:  'Aspen'
  });

_No documented symbols — module has a file-header comment only._
