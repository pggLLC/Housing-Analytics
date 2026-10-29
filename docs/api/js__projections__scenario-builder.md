# `js/projections/scenario-builder.js`

scenario-builder.js — COHO Analytics

Interactive UI controller for the projection scenario builder page.
Wires slider inputs → CohortComponentModel → Chart.js results chart.

The projection starts from the State Demography Office's (SDO) forecast for
the county (data/hna/scenario-baseline/<county>.json). Each slider is a
percentage of SDO's births, deaths or migration, so 100% on all three is
SDO's forecast. Homes needed take the same form as the HNA page's 20-year
figure: the rise in homes the projected households need at the county's
target vacancy, plus homes for a quarter of today's in-commuter households
at or below 120% AMI. A town or CDP takes its share of the county's growth, the
share the HNA page uses (data/hna/projections/places.json), so with the
sliders at 100% the builder and the HNA page give the same number. It can
instead take a share of each age group from Hamilton-Perry projections of
the town and its county (data/hna/place-hamilton-perry.json).

Dependencies (must be loaded before this script):
  - js/projections/cohort-component-model.js
  - js/projections/scenario-presets.js
  - js/projections/scenario-storage.js
  - Chart.js (CDN)
  - js/fetch-helper.js

Exposes: window.ScenarioBuilder

## Symbols

### `countiesFor(geo, data)`

The counties whose forecasts a geography draws on: CohortComponentModel's
countiesFor, which the HNA page's saved-scenario line uses too. `data`
needs only { ledger, cross } (see contextFor).

### `describeContext(ctx)`

One sentence on where the loaded figures come from, for the status line.

### `contextFor(geo, data)`

What the builder needs for one geography, from the files the page loads.
  geo:  { geoid, name, type, containingCounty, population, inCommuters, inCommutersHigh }
  data: { baselines: {fips: scenario-baseline file}, projections: {fips: projections file},
          ledger: places.json `places`, cross: cross-county-places.json `places`,
          hamiltonPerry: place-hamilton-perry.json, for a town }
A town or CDP takes the share of county growth the HNA page uses: its
blended share in the place ledger, applied to all the counties it sits in,
or, for the few places the ledger lacks, its share of the county's people.
Returns { unavailableReason } when a part is missing.

### `homesSeries(ctx, params)`

Population, households added and homes needed by year for one scenario.

Each county runs the cohort-component model with the scenario's
percentages. The scenario's change from the model's own run of SDO's
forecast is added to SDO's published figures, so with every slider at
100% the builder shows SDO's households and the HNA page's homes exactly,
not the model's copy of them to within rounding.

Homes needed are the rise from the base year in households ÷ (1 − the
county's target vacancy); no count of today's homes enters, as on the HNA
page. A town takes its share of every county it sits in, or, with
town_share 'hamilton_perry', its share of each age group.

### `twentyYearFigure(series, ctx)`

The 20-year figure: resident growth plus today's in-commuters, as on the HNA page.

### `bandSeries(rows, ctx, fe)`

Where 2 in 3 past forecasts for a place of this size landed, around SDO's
line. data/hna/forecast-error.json (scripts/hna/build_forecast_error.py)
gives the population error by years out for each size of county; here it
is that share of the place's population each year, in homes at SDO's
households per person and the county's target vacancy. The record runs
20 years out, so the range stops there. Empty without the error file, the
place's population or a county's vacancy.

### `init(opts)`

opts: a context from contextFor() (counties, share, ...), or
{ unavailableReason } to clear the page with that explanation.

### `_updateBandNote(band)`

The sentence under the chart: the range at 20 years, in percent and homes.
