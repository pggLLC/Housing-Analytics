# `js/components/calc-financials-link.js`

js/components/calc-financials-link.js
deal-calculator.html.

Puts "Continue in Financials" under the Deal Calculator. The link opens the Deal hub's #/open-calc route with the
calculator's own share-link parameters, which the hub shows first and then opens as a new project on Financials.
Nothing is saved before that click.

In the for-sale mode the link says "Continue in Homes for sale" and opens the Deal hub's #/sale-deal screen with the
same parameters (mode-rental=ownership): that screen fills its county, cost, homes, buyer income, floor area and
resale boxes from them, makes the place the working place, and names every other box, which stays here. Financials
works rental deals only, so before 24 Nov 2026 a for-sale deal sent there stopped at a refusal.

Moved here from deal-market-analysis.html (it was js/components/ma-calc-handoff.js, under the copy of the calculator
that page drew) in the duplicate cleanup of 24 Nov 2026: the Market Analysis pages now link to this page, so the
path to Financials lives with the one calculator.

The parameters come from js/deal-calculator-share.js, loaded before this file:
window.__DealCalcShare.buildSnapshot().url carries exactly what "Copy link" carries (every dc- and pf- control,
the tranche string, input sources, utility allowance and rent schedule). Nothing here reads a calculator control
itself. One setting is added: subject, the page's subject project (window.SubjectProject.get()), which the hub needs
to price homes that come from the rent schedule.

_No documented symbols — module has a file-header comment only._
