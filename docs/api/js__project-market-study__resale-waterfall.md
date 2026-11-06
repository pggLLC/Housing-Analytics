# `js/project-market-study/resale-waterfall.js`

Shared-equity closing snapshot and limited-pool resale distribution.
Consumes a SharedEquityLifecycle year result without recalculating it.

## Symbols

### `isFixedFormula(yearResult, config)`

True when the resale price came from a fixed-appreciation formula. The
formula type is read from config.formulaType or yearResult.formulaType;
a SharedEquityLifecycle year result carries neither, so it is recognised
by its price equalling the fixed leg while that leg grew above the
original price (an AMI- or CPI-indexed formula leaves the fixed leg flat).
