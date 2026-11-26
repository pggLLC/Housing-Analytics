# `js/components/ma-calc-link.js`

js/components/ma-calc-link.js
market-analysis.html and deal-market-analysis.html.

Duplicate cleanup (24 Nov 2026): the Market Analysis pages used to draw a second copy of the Deal Calculator
(js/deal-calculator.js into #dealCalcMount). They now link to the one calculator, deal-calculator.html, which has
every input the copy had plus the for-sale mode, all five coverage stress cases, lease-up loss, the exports and the
path to Financials.

Every <a data-ma-calc-link> on the page gets its address from the page's current state when it is shown, hovered,
focused or followed:
  deal-calculator.html[?geoid=<the page's place, from its ?fips= or ?geoid=>][&site-lat=<lat>&site-lon=<lon>]
site-lat/site-lon are the form Compare Sites already uses (js/market-analysis/site-comparison.js). They are sent
only for a site the person chose (a map click, an address, a Market check site), never for a town centre (the
?auto=1 links place one), so the calculator's county and its QCT/DDA and transit-zone notes are for a real site.
The calculator works out those two notes itself from the point (js/components/calc-site-context.js).
The Subject Project (homes, sizes, income targets) is shared through the browser's storage, so it carries over
without being in the address.

Back: before leaving, the page's own address is tidied (history.replaceState, nothing is added to history) so
Back returns to the same site and market area:
  - the site is named in the form the page reads when it opens:
      deal-market-analysis.html  ?site=<lat>,<lon>  (js/components/ma-site-link.js)
      market-analysis.html       ?lat=<lat>&lon=<lon> (js/market-analysis.js)
  - never its tracts: the tract picker keeps its own selection and note for the site and starts from them. A Market
    check link's tracts (?tr=) or a centroid's ?auto=1 are taken off, so they cannot replay over the reader's edits.
  - a site kept out of the address on purpose (Use my location) is left out.
Other parameters and the #section are kept. Nothing here computes a figure.

_No documented symbols — module has a file-header comment only._
