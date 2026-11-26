# `js/components/ma-site-link.js`

js/components/ma-site-link.js
deal-market-analysis.html only (written in by scripts/build-market-analysis-hub.mjs).

Opens the page on a site that Market check (deal-hub.html#/market, hub/market.js) already placed:
  deal-market-analysis.html?geoid=<place or county>&site=<lat>,<lon>&sl=<the address as typed or found>
    [&tr=<tract numbers without the leading 08, dot-separated>&tl=<the market area's name on Market check>]

Nothing here places a site or runs anything itself. Once the page's data has loaded, it types the point
into the page's own "Find a Colorado address" box as "lat, lon" and presses Find, which is what a person
pasting coordinates there does (js/market-analysis.js, _wireAddressSearch): the page checks the point is in
Colorado, places the marker and starts the analysis the way it does for a map click, in the method the page
has selected (the tract picker by default). So the site is a chosen site, never a town centre: QCT and DDA are
checked for it, unlike the ?auto=1 links, which place a jurisdiction centroid.

It waits until after the page has moved the map to the place in ?geoid= (market-analysis.html moves it at
0.8 s and 2.5 s), so the map ends on the site, then scrolls to the map, as the page's "Start here" link does.
Market check never sends ?auto=1 with a site.

Then it runs the market area analysis (paul, 17 Nov 2026: the site "should [transfer] and run the pma"). With tr=,
the tract picker takes Market check's own tracts in place of its 4-mile auto-pick, the rationale box says where
they came from, and Run Analysis is pressed, as a person would after drawing the area. The page's own steps still
apply: its once-a-month "screening tool, not a market study" notice asks to be accepted first. Without tr= (an
older link), the site is placed and Run Analysis is pressed on the auto-pick, where the page's own warning about
an unedited 4-mile ring asks first.

_No documented symbols — module has a file-header comment only._
