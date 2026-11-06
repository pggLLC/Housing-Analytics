# `js/county-measures.js`

js/county-measures.js

County measures shared by the home page map (js/components/home-need-map.js)
and the data map (data-map-browser.html), so both draw the same figures and
grey out the same counties.

  CountyMeasures.loadField(field, fetchJson) → Promise<{ values, unreliable, names, boundaries }>
    values[field][geoid]     number
    unreliable[field][geoid] true when the figure is too uncertain to rank
    names[geoid]             county name ("Adams County")
    detail[geoid]            { renters_lte50, affordable_lte50, renters_lte80, subsidized } for popups

Sources:
  ACS 5-year figures: data/co-county-demographics.json (scripts/build_co_demographics.py)
  Permits: Census Building Permits Survey counts in data/hna/permits.json
  Ratios: the same ACS five-year medians (rent and value against income)
  Lowest-income shortfall: HUD CHAS 2018–2022 (data/hna/chas_affordable_available.json)
  Projections: State Demography Office county forecast (data/hna/projections/<fips>.json)
  Margins: data/hna/acs-reliability.json

_No documented symbols — module has a file-header comment only._
