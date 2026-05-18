# `js/rent-vs-buy-breakeven.js`

rent-vs-buy-breakeven.js

Renders the "Rent vs Buy Breakeven" mini-calculator on the Deal
Calculator page. Given a home price, monthly rent, mortgage rate,
property tax rate, maintenance %, and rent escalation rate, it
computes the year at which cumulative ownership costs (mortgage
payments + tax + maintenance - principal paydown - equity
appreciation) drop below cumulative rent paid.

Why this matters for LIHTC analysts (per Phase 3 / C2)
------------------------------------------------------
Helps frame the alternative: if a market's breakeven is <5 years,
LIHTC demand is stronger (renters can't afford to buy fast enough).
If breakeven is >15 years, the rent-vs-buy gap is so wide that
the LIHTC pipeline competes mainly with luxury-rental product, not
starter-home product.

Adapted from flamingo_project's rent/buy comparison logic.

## Symbols

### `compute(params)`

Compute the breakeven year + cumulative cost series.
@param {object} params
@returns {object} { breakevenYear, rentSeries, buySeries, ... }
