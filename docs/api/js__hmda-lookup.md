# `js/hmda-lookup.js`

hmda-lookup.js

Browser-side helper for the CFPB HMDA (Home Mortgage Disclosure Act)
data shipped in PR #786. Two source files are bundled:

  data/hmda/co-state-trends.json       — statewide YoY (3.6 KB)
  data/hmda/co-county-aggregates.json  — 64 CO counties × 7 years (~250 KB)

The Deal Calculator and PMA simulator use this helper to surface
mortgage-credit-access context next to a deal: per-county origination
count, denial rate, mean loan amount, multifamily originations
(LIHTC-adjacent subset), plus a state benchmark.

Why mortgage credit access matters for LIHTC analysts
-----------------------------------------------------
  - Rising county denial rate / falling origination count signals
    tightening credit, which precedes slowdown in multifamily starts
    and reduced demand for LIHTC bond execution.
  - Multifamily-only subset (HMDA dwelling_categories=Multifamily:
    Site-Built) is directly LIHTC-adjacent — quick read on the
    county's competitive lending environment.
  - Per-county denial-rate variance (Adams 27.8% vs Denver 20.1% in
    2024) exposes underserved markets that LIHTC deals can target.

Public API
----------
  window.HmdaLookup.init() — fetch + cache both data files
  window.HmdaLookup.getCounty(countyFips) — return latest-year metrics
    for a county, or null if not found
  window.HmdaLookup.getCountyTrend(countyFips)
    — return all years for a county, sorted ascending, or [] if not found
  window.HmdaLookup.getStateLatest() — latest-year statewide metrics
  window.HmdaLookup.getCountyVsState(countyFips)
    — { county, state, delta: { denial_rate_pp, mean_loan_pct,
        originations_pct } } — useful for "this county is X
        relative to the CO statewide picture" callouts.

## Symbols

### `getCounty(countyFips)`

Return latest-year HMDA metrics for a county FIPS (5-digit), or null.

### `getCountyTrend(countyFips)`

Return [{year, originations, denial_rate, ...}] across all years for
 a county, sorted by year ascending.

### `getStateLatest()`

Return latest-year statewide metrics, or null.

### `getCountyVsState(countyFips)`

Return a county-vs-state comparison for the latest year:
   {
     county: {originations, denial_rate, mean_loan_amount_usd, ...},
     state:  {...},
     delta:  {
       denial_rate_pp:    (county - state) * 100,
       mean_loan_pct:     (county - state) / state * 100,
       originations_pct:  per-100K-pop normalized? — for now skip.
     }
   }
 Returns null if either side is unavailable.

### `formatCountyCallout(comparison, countyName)`

Build ready-to-render HTML for a county HMDA context callout.
 Returns '' when data is unavailable.
