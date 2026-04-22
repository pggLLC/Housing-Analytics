# `js/deal-calculator.js`

## Symbols

### `updateAmiLimitsFromFmr(fips)`

Update _amiLimits from HudFmr for the given county FIPS.
Falls back to the default Denver MSA values if data is unavailable.
@param {string} fips  5-digit county FIPS, or null/'' for default.

### `populateCountySelector(sel)`

Populate the county selector dropdown from HudFmr data.
@param {HTMLSelectElement} sel

### `_findAmiGapCounty(fips)`

Find the county record in the AMI gap data by FIPS.

### `_renderAmiGapInfo(fips)`

Render AMI gap info panel when a county is selected.

### `_runDealPredictor(fips)`

Call the deal predictor (enhanced or base) when county changes,
passing AMI gap data from the calculator inputs.

### `setDesignationContext(basisBoostEligible)`

Update the QCT/DDA indicator in the deal calculator UI.
Called by the market-analysis controller once checkDesignation() resolves.

When basis_boost_eligible is true the checkbox is pre-checked and the
note is shown so the user is aware of the designation.  The basis %
slider is intentionally NOT auto-adjusted — the user retains full
manual control per the principle that the designation does not
automatically apply the 130% boost (IRC §42(d)(5)(B) requires election).

@param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
