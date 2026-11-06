# `js/components/equity-pricing-drivers.js`

js/components/equity-pricing-drivers.js
"What moves LIHTC pricing" on article-pricing.html.

Compares Novogradac's monthly national 9%/4% equity pricing
(data/market/lihtc-equity-pricing-history.json) with the rate series in
data/fred-data.json, and shows the Polymarket odds the economic dashboard
already caches (data/polymarket-data.json) as forward-looking context.

Every number on the section is computed here from those files when the
page loads, so the prose cannot drift from the data: a new pricing capture
or a rate refresh changes the sentences with it. The pure statistics are
exported on window.EquityPricingDrivers.stats and tested in
test/equity-pricing-drivers.test.js against an independent statsmodels run.

Absent values stay null: a month without both 9% and 4% prices, a FRED
observation of "." and a market with no price are skipped, never zero.

_No documented symbols — module has a file-header comment only._
