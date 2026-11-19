# `js/components/ma-calc-handoff.js`

js/components/ma-calc-handoff.js
deal-market-analysis.html only (written in by scripts/build-market-analysis-hub.mjs).

Puts "Continue in Financials" under the built-in Deal Calculator. The link opens the
Deal hub's #/open-calc route with the calculator's own share-link parameters, which the hub shows
first and then opens as a new project on Financials. Nothing is saved before that click.

The parameters come from js/deal-calculator-share.js, loaded unchanged after this file:
window.__DealCalcShare.buildSnapshot().url carries exactly what "Copy link" on
deal-calculator.html carries (every dc- and pf- control, the tranche string, input sources,
utility allowance and rent schedule). Nothing here reads a calculator control itself. One setting is
added: subject, the page's subject project (window.SubjectProject.get()), which the hub needs to price homes
that come from the rent schedule.

On this page the address belongs to Market Analysis (?fips=, ?geoType=, ?auto=, ?lat=, ?lon=),
never to a calculator share link. js/deal-calculator-share.js opens a share link from the page
address through window.DealCalcLinkParams as soon as the address has any query at all, which
here would reset the built-in calculator's rent schedule and utility allowance. So, before that
file runs, this file points window.DealCalcLinkParams at an empty set for this page. Only
js/deal-calculator-share.js reads that global on this page; js/deal-calculator.js keeps its own
copy.

_No documented symbols — module has a file-header comment only._
