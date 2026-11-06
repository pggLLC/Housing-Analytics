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

### `chfaQualifiedRenters(demand, limitsByFips, bufTracts, tiers, bedrooms)`

Renter households in a market area who could rent a tax-credit unit at
one or more AMI tiers, by CHFA's rules.

For each tract, each CHAS income tier count is multiplied by the share
of that tier's renters (ACS PUMS, the tract's PUMA) whose size fits an
offered unit (1-3 bedroom by default) and whose income falls between the
40%-of-income rent floor and the tier's limit. A household is matched to the smallest
bedroom size that fits it, since that unit has the lowest rent.

@param {Object} demand - data/market/chfa_renter_demand_co.json
@param {Object<string,Object>} limitsByFips - CHFA current-year county records (regular_tiers)
@param {Array<Object>} bufTracts - buffer tracts with geoid/_bufferShare
@param {Array<number>} tiers - AMI percents of the proposed units, e.g. [30, 60]
@param {Array<string>} [bedrooms] - unit sizes offered ('0br'..'3br');
  default 1-3BR. Household sizes no offered unit fits are left out, as
  CHFA's guide says (no one-bedroom units: no one-person households).
@returns {{value:number|null, byTier:Object<string,number>, source:string,
  tractsUsed:number, tractsMissing:number, reason:string|null}}
