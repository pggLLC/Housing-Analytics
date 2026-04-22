# `js/hna/hna-comparison.js`

js/hna/hna-comparison.js
Comparison workspace for hna-comparative-analysis.html
County context filtering + searchable dropdown jurisdiction selection

Depends on: js/hna/hna-ranking-index.js (window.HNARanking)
            js/site-state.js (window.SiteState) — optional

Strategy: Rather than duplicating row rendering from hna-ranking-index.js,
this module injects HNA link cells into existing rows via MutationObserver.
Jurisdiction A/B selection is done via searchable dropdown selectors in the
setup bar. County filtering hides/shows rows via CSS rather than rebuilding.

## Symbols

### `_calcPurchaseAmi(homeValue, ami, isOwner)`

Compute the annual household income required to purchase a home at a
given price, then express that as a percentage of Area Median Income.

For current homeowners, we estimate a reduced purchase price reflecting
existing equity (median equity ≈ 40% of home value per Fed data).

@param {number} homeValue  Median home value ($)
@param {number} ami        Area Median Income ($), approximated from median HH income
@param {boolean} isOwner   true = current homeowner (has equity)
@returns {{ amiPct: number, requiredIncome: number, monthlyPayment: number,
            downPayment: number, loanAmount: number }}
