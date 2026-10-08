# `js/components/equity-pricing.js`

js/components/equity-pricing.js
One reading of LIHTC equity pricing for every page that shows it (#2010).

Until 2026-10 Insights, the CRA scenario page and the Colorado Deep Dive
each typed their own prices, and none agreed with the data the Tax Credit
Equity Markets page reads (Insights showed 4% at $0.89, above 9%; the file
had $0.84). Every current price now comes from
data/market/novogradac-equity-pricing.json with its as_of, and every
quarter-on-quarter figure from data/market/lihtc-equity-pricing-history.json.

A price that is missing or not positive is unknown and comes back as null,
never 0: a $0.00 credit price is not a price.

## Symbols

### `current(benchmark)`

Current national prices, with the date the file says they are as of.

### `quarters(history)`

Quarterly rows, oldest first, with null for any price that is not one.

### `change(history, key, lag)`

Fractional change in `key` ('nine' | 'four') over `lag` quarters, ending
at the latest quarter. null when either end is unknown.

### `agrees(benchmark, history)`

The history's latest quarter must be the benchmark's vintage, at the same
prices; otherwise a QoQ figure would describe a different price from the
one printed beside it.

### `scenarioRange(base, lowPct, highPct)`

A scenario's price range: the base moved by the stated % assumptions.

### `weightedRange(base, scenarios)`

Probability-weighted range across scenarios {probability, lowPct, highPct}.

### `quarterAfter(quarter, n)`

'YYYY-Qn' moved n quarters on; null if the label is not a quarter.
