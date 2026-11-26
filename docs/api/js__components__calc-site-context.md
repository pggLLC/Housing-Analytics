# `js/components/calc-site-context.js`

js/components/calc-site-context.js
deal-calculator.html only.

The two site notes the Market Analysis page used to pass into the calculator it carried on the page
(duplicate cleanup, 24 Nov 2026: the PMA pages now link here instead of drawing a second calculator):
  1. HUD QCT/DDA: "HUD data place this site in a QCT or DDA ..." (js/deal-calculator.js setDesignationContext)
  2. The HB26-1065 transit-zone (THIZ) state credit line, and the eligibility of a Transit Zone added credit
     (js/deal-calculator.js setTransitZoneContext)

They need a chosen site, so they run only when the address carries one: ?site-lat=&site-lon= (the form the
Market Analysis link and Compare Sites already use; js/deal-calculator.js linkedSitePoint reads the same
parameters). The answers come from the same code and files the Market Analysis page uses, so the two pages
cannot disagree: HudEgis.checkDesignation (data/qct-colorado.json, data/dda-colorado.json) and
TransitZone.create(...).status (data/policy/thiz-map-status.json, OEDIT's zones once published, the statewide
stop file through DataService). Nothing here works out a figure.

As on the Market Analysis page: an unknown designation leaves the calculator as the user set it, and nothing
applies a basis boost or a credit by itself (#2160, #1937).

_No documented symbols — module has a file-header comment only._
