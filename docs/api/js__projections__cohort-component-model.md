# `js/projections/cohort-component-model.js`

cohort-component-model.js — COHO Analytics

The Scenario Builder's population projection: single year of age and sex,
one year at a time, the cohort-component method the State Demography Office
(SDO) uses for Colorado's county forecast.

It starts from SDO's forecast. data/hna/scenario-baseline/<county>.json
(scripts/hna/build_scenario_baseline.py) carries SDO's base population, the
scale factors that make Colorado's death and birth rates by age give SDO's
deaths and births each year, and SDO's migration by age, which is what its
forecast leaves after births and deaths. So with births, deaths and migration
all at 100% the model reproduces SDO's population by age, and its household
forecast. A scenario multiplies one or more of those three.

Migration can instead follow the ten years before the forecast
(migration_from: 'past'): the same residual by age from SDO's estimates,
averaged, each year in place of SDO's forecast migration, and the
percentage then multiplies that.

Households: SDO's households by age of householder, as a rate on people of
that age in each year, applied to the scenario's people of that age. With
headship 'held' the base year's rates stay as they are every year in place
of the way SDO's forecast moves them (constant headship rates by age).

Towns: townShares() and townProjection() give a town or CDP its share of
its county's people in each age group, from Hamilton-Perry projections of
the town and the county (data/hna/place-hamilton-perry.json), in place of
one share of the county's growth for every age (town_share:
'hamilton_perry'). project() ignores the setting; it is the builder's.

_step below is build_scenario_baseline.py step(); keep the two the same.

Exposes: window.CohortComponentModel

## Symbols

### `project(baseline, params)`

Project one county from its baseline file.
@param {Object} baseline - data/hna/scenario-baseline/<county>.json
@param {Object} [params] - {births_pct, deaths_pct, migration_pct}; 100 = SDO's forecast;
  migration_from 'past' runs the baseline's past migration by age instead;
  headship 'held' keeps the base year's households per person by age
@returns {Array<{year, population, households, births, deaths, migration,
  groupPeople, groupHouseholds}>} one row per year from baseYear to
  endYear; the base year has no flows. groupPeople and groupHouseholds
  follow baseline.households.groups.

### `changeFromSdo(baseline, params)`

The scenario's change from SDO's forecast, by year: what the scenario adds
to (or takes from) SDO's population and households. Zero at 100% on all
three, so a line drawn as SDO's figures plus this change is SDO's line
exactly when nothing is changed.

### `averageAnnualMigration(baseline, years)`

SDO's net migration a year, averaged over the first `years` years of the
forecast (all of it when omitted): the migration the model carries at
100%, so a slider label and the projection agree.

### `pastMigration(baseline)`

Net migration a year the model carries at 100% with migration_from
'past': SDO's estimates for the years before the forecast, averaged.
Null when the baseline has none.
@returns {{annual: number, from: number, to: number}|null}

### `paramsFromSaved(saved, sdoAnnualMigration)`

Parameters from a saved scenario. Scenarios saved before 2026-10-20 held
multipliers and a flat number of migrants a year, the same for every place.
The multipliers carry over as percentages, and the migrants a year become a
percentage of SDO's average for the place loaded (sdoAnnualMigration),
signed: where SDO expects net departures, a saved 0 is 0% and a saved net
departure is a share of SDO's. A count in the opposite direction from SDO's
forecast cannot be a share of it, so migration is set to 0%, the nearest
setting; where SDO's average is zero or unknown it stays at SDO's forecast.
Every setting is held to RANGES, and `migrationNote` says when a saved
count could not be loaded as saved.

### `townShares(hp, geoid, fipsList)`

A town's share of its counties' people in each age group, by year: its
Hamilton-Perry projection over theirs, from data/hna/place-hamilton-perry.json
(scripts/hna/build_place_hamilton_perry.py). The file has 2020, 2030, 2040
and 2050; a year between two takes the straight line between them, and a
year after the last holds the last.
@param {Object} hp - the file
@param {string} geoid - the town's
@param {string[]} fipsList - its counties, from countiesFor()
@returns {function(number): number[]|null} for a year, the shares of
  people under 18 and then of each household group (hp.groups); null
  when the file has no projection for the town or one of its counties

### `townProjection(baselines, params, shareAt)`

A town's people and households by year with Hamilton-Perry shares. Each
county's scenario is held to SDO's totals as the builder holds a county
(the scenario's change from the model's run of SDO, added to SDO's
figures) and spread over its age groups as the model has them; the town
takes its share of each group.
@param {Object[]} baselines - one per county, in the order of shareAt's counties
@param {Object} params - the scenario, as for project()
@param {function} shareAt - from townShares()
@returns {Array<{year, population, households: number[], migration}>}
  households from each county, in baselines' order; migration is the
  town's share of each county's people that year times the county's
  net migration, null in the base year

### `countiesFor(geo, ledgerRec, crossRec)`

The counties whose SDO forecast a geography's scenario runs on. The
Scenario Builder and the HNA page's saved-scenario line both use this, so
a scenario covers the same counties on both: a county itself; a town or
CDP with a place-ledger share, every county it sits in
(cross-county-places.json); any other place, its containing county.
@param {Object} geo - {type, geoid, containingCounty}
@param {Object} [ledgerRec] - the place ledger row, if any
@param {Object} [crossRec] - cross-county-places.json places[geoid], if any
