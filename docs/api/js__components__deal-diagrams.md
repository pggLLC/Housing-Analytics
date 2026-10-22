# `js/components/deal-diagrams.js`

deal-diagrams.js — two drawn diagrams on the Deal Calculator's Deal step.

Capital stack bar: total development cost as one bar, split into the
sources the Sources & Uses table counts (first mortgage, federal, state and
added credit equity, soft funding, deferred developer fee) and the gap left
over, drawn as a hole. A figure the deal calculation could not work out is
shown as unavailable with its reason, never as $0.

Waterfall ladder: the Capital Event Waterfall's tiers as steps. Each step
starts where the one above it ended, so the bar shows how far down the
ladder the sale proceeds reach.

Both read the deal-engine result that js/deal-calculator.js publishes on
every recalculation ('deal-calc:updated'); neither changes a figure.

_No documented symbols — module has a file-header comment only._
