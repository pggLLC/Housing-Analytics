# `js/market-analysis-scoring.js`

## Symbols

### `chasLihtcEligibleRenters(chasCounties, bufTracts, acsIdx)`

Estimate LIHTC-eligible renter households (<=80% AMI) inside a PMA buffer.

CHAS income tiers are county-wide, while the PMA buffer is tract-scoped.
For each county touched by the buffer, scale that county's CHAS tiers by
buffer renter HH / county CHAS renter HH. This keeps the income-qualified
denominator narrowed to <=80% AMI without accidentally using a whole
county's renter pool for a small urban buffer.

@param {Object<string,Object>} chasCounties - chasData.counties
@param {Array<Object>} bufTracts - buffer tracts with geoid/_bufferShare
@param {Object<string,Object>} acsIdx - tract metrics keyed by geoid
@returns {{
  value: number|null,
  tier_breakdown: Object|null,
  source: 'chas'|'unavailable',
  counties: Array<{fips:string, share:number, lihtc_eligible:number}>
}}
