# `js/deal-calculator.js`

## Symbols

### `updateAmiLimitsFromFmr(fips)`

Update _amiLimits from HudFmr for the given county FIPS.

LIHTC rent ceiling formula:
  monthly_rent_limit = (AMI_4person × tier_pct × rent_burden_pct) / 12

The rent_burden_pct is a tunable constant (`_constants.rentBurdenPct`,
default 0.30). When the user changes it via the Methodology &
Formulas panel, the ceilings recompute and propagate to the deal.

Computed locally rather than calling HudFmr.getGrossRentLimit so the
burden % is honored — that helper has 0.30 hardcoded.

@param {string} fips  5-digit county FIPS, or null/'' for default.

### `populateCountySelector(sel)`

Populate the county selector dropdown from HudFmr data.
@param {HTMLSelectElement} sel

### `_findAmiGapCounty(fips)`

Find the county record in the AMI gap data by FIPS.

### `_renderAmiGapInfo(fips)`

Render AMI gap info panel when a county is selected.

### `_renderCrossCountyDisclosure(fips)`

Call the deal predictor (enhanced or base) when county changes,
passing AMI gap data from the calculator inputs.
/
  /**
Render the cross-county jurisdiction disclosure for the chosen county.
Surfaces an info banner when the chosen county contains CO places that
span multiple counties — a parcel on the wrong side of the line uses a
different county's HUD AMI tier.

Idempotent: calling with no fips hides the banner.

### `_renderHmdaContext(fips)`

Render the HMDA mortgage-credit-access context for the chosen county.
Surfaces 1-line callout: origination count, denial rate, mean loan size,
multifamily originations, with state benchmarks. Sourced from CFPB HMDA
Data Browser data (PR #786, refreshed monthly).

Why this matters: tightening credit (rising denial rate, falling
originations) precedes slowdown in multifamily starts and reduced LIHTC
bond demand. Per-county denial-rate variance also exposes underserved
markets that LIHTC deals can target.

Idempotent: calling with no fips hides the banner.

### `_wireCountyDetect(countySel)`

Hook up the lat/lon → county auto-detection UI controls.
@param {HTMLSelectElement} countySel - the dc-county-select element

### `setDesignationContext(basisBoostEligible)`

Update the QCT/DDA indicator in the deal calculator UI.
Called by the market-analysis controller once checkDesignation() resolves.

When basis_boost_eligible is true the checkbox is pre-checked and the
note is shown so the user is aware of the designation.  The basis %
slider is intentionally NOT auto-adjusted — the user retains full
manual control per the principle that the designation does not
automatically apply the 130% boost (IRC §42(d)(5)(B) requires election).

@param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
