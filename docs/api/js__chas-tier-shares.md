# `js/chas-tier-shares.js`

chas-tier-shares.js

Browser-side helper that produces RENTER-side AMI tier shares for a
given county or place GEOID. Used by chartHouseholdDemand on the
Housing Needs Assessment page to apportion projected household growth
across AMI tiers using real CHAS Table 7 distributions instead of
the statewide heuristics shipped in PR #798.

Data sources (in priority order)
--------------------------------
  1. data/hna/place-chas.json       (TIGER place-level CHAS, PR-C3)
     — used when the selection is a place/CDP and TIGER coverage exists
  2. data/market/chas_co.json       (county-level CHAS Table 7)
     — used when selection is a county OR for places falling back

Output shape
------------
  {
    source: 'place-chas' | 'county-chas' | 'statewide-heuristic',
    geoid: '0824950',
    name: 'Erie',
    totalRenter: 2156,
    tiers: [
      { key: 'lte30',   label: '≤30% AMI',   share: 0.183, count: 395 },
      { key: '31to50',  label: '31-50% AMI', share: 0.142, count: 306 },
      { key: '51to80',  label: '51-80% AMI', share: 0.205, count: 442 },
      { key: '81to100', label: '81-100% AMI',share: 0.108, count: 233 },
      { key: '100plus', label: '>100% AMI',  share: 0.362, count: 780 }
    ]
  }

Public API
----------
  window.ChasTierShares.init()
  window.ChasTierShares.getRenterShares(geoid, geoType)
    — geoType: 'county' | 'place' | 'cdp' | 'state'
    — returns the shape above; uses statewide fallback if nothing
      else resolves

## Symbols

### `getRenterShares(geoid, geoType)`

Return renter-side AMI tier shares for a geography.
 Tries place CHAS first, falls back to county CHAS, then statewide.

### `getRenterSharesWithFallback(geoid, geoType, containingCountyFips5)`

Variant that accepts an explicit containing-county FIPS to use as
 fallback when the primary geoid resolution fails (useful for places
 whose TIGER aggregate is missing).
