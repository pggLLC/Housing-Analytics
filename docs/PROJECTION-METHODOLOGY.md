# Projection Methodology

COHO Analytics projects population with the **cohort-component method**, the one the Colorado State Demography Office (SDO, part of DOLA) uses for its official county forecasts: people are aged forward a year at a time, deaths and births are applied by age, and migration adds or removes people by age.

Two models use it:

1. **The Scenario Builder** (`hna-scenario-builder.html`, `js/projections/cohort-component-model.js`) starts from SDO's own forecast and lets a reader change births, deaths and migration as a percentage of it. It is described first, below.
2. **The pipeline scenario files** (`scripts/hna/demographic_projections.py`, run by `scripts/hna/build_scenarios.py` into `data/hna/scenarios/*.json`) use their own simpler model, described under [Pipeline scenario files](#pipeline-scenario-files). The Scenario Builder does not use it.

---

## Scenario Builder

### Starting point: SDO's forecast

Each county's start is `data/hna/scenario-baseline/<county>.json`, built by `scripts/hna/build_scenario_baseline.py` from SDO's county files (cached in `data/hna/source/` by the HNA data build):

- population by single year of age (0 to 99, and 100 and over) and sex, estimate and forecast (`sya-county.csv`);
- births, deaths and net migration by year (`components-change-county.csv`);
- households by age of householder: 18-24, 25-44, 45-64, 65 and over (`household-county.csv`).

The base year is 2024 and the forecast runs to 2050, the last year of SDO's household forecast.

### One year

For each county and year:

```
deaths(age, sex)   = people(age, sex) × q(age, sex) × kd(year) × deaths%
births             = Σ women(age 10-49) × f(age) × kb(year) × births%
                     (split 1.05 boys per girl)
next(age+1, sex)   = people(age, sex) − deaths(age, sex) + migration(age+1, sex) × migration%
```

- `q` is Colorado's probability of dying within a year at each age, from the NCHS U.S. State Life Tables, 2021 (NVSR vol. 73 no. 7), Tables CO-2 and CO-3. The open group 100 and over uses dx/Lx.
- `f` is Colorado's births per woman by five-year age of mother, 2023, from NCHS Births: Final Data for 2023 (NVSR vol. 74 no. 1), Table 8. Their sum ×5 is the printed total fertility rate, 1,454.0 per 1,000; `scripts/hna/fetch_colorado_vital_rates.py` checks it.
- `kd` and `kb` scale those Colorado rates so each county's deaths and births in each year equal SDO's. Only the age pattern comes from NCHS; every total comes from SDO.
- `migration(age, sex)` is what SDO's forecast population by age leaves after the survivors and births above: the migration SDO's forecast implies, by age.
- Net departures at an age can outnumber the people of that age: SDO's above 100% (at 150% they would in 37 of the 64 counties), or the past's (below) on a smaller cohort. No more than everyone can leave, so a cohort stops at zero, and the departures it could not supply come from everyone else in proportion to their numbers. Each year's net migration is then the one the setting asks for. Stopping departures alone would keep the arrivals at other ages: in Summit County at 200% it turned net departures into net arrivals.

With every slider at 100% the model reproduces SDO's population for every county and year to within rounding (5 people, checked by the build script and by `test/scenario-baseline-reproduces-sdo.test.js`).

### Households

```
households(year) = Σ over the four age groups  rate(group, year) × people(group, year)
rate(group, year) = SDO households headed by that group ÷ SDO people of that age
```

The rates change by year as SDO's forecast does. At 100% this is SDO's household forecast.

### Households per person held at 2024's

Below the sliders, the reader can hold each age group's rate at its 2024 value every year instead of following SDO's forecast: the constant headship rate method, the usual alternative to a forecast's own household assumption (Smith, Tayman and Swanson, 2013).

```
rate(group, year) = rate(group, 2024)   for every year
```

- Households then change only as the number of people in each age group does. Population, births, deaths and migration are unchanged.
- The difference from SDO's forecast is how far SDO moves the rates. In Vintage 2024 it lowers every age group's rate in Douglas County, so holding 2024's adds about 25,000 households by 2044. It raises some rates in Larimer and Mesa counties (Larimer's 45-64 from 0.57 to 0.65, Mesa's 65 and over from 0.67 to 0.74), so holding 2024's gives about 8,800 fewer households in Larimer and 4,600 fewer in Mesa.
- The 2024 rates are SDO's. The Census Bureau's survey gives similar ones: its 2020-2024 rates (ACS 5-year tables B25007 and B01001), held the same way, put household growth to 2044 within 4% of these in every county over 100,000 people. In smaller counties its count of householders under 25 is too uncertain to use (a coefficient of variation above 30% in 37 of the 64 counties).

### Homes needed

The builder uses the HNA page's formula, so with nothing changed it shows the HNA page's 20-year figure exactly:

```
homes needed(year) = households added since 2024 ÷ (1 − county target vacancy)
20-year figure     = homes needed(2044) + homes for a quarter of today's in-commuter households at or below 120% AMI
```

- The target vacancy is each county's, from `data/hna/projections/<county>.json` (`housing_need.target_vacancy`).
- The in-commuter part is the ranking index's `incommuter_need_units` (`data/hna/workforce-need.json`): LODES in-commuters by pay tier, turned into households at or below 120% AMI by the ACS PUMS crosswalk in `data/hna/workforce-ami-crosswalk.json` (`scripts/hna/build_workforce_ami_crosswalk.py`).
- A scenario's change from SDO's forecast is added to the HNA projection's own series (`incremental_units_needed_dola`, or the place ledger's `incremental_units_needed`), so the two pages agree to the home at 100% for all 536 jurisdictions with a figure (`test/scenario-baseline-reproduces-sdo.test.js`).

### Towns and CDPs

A town or CDP takes the share of county growth the HNA page gives it: its blended share in `data/hna/projections/places.json`, from its share of the county's households and of its 2020–2024 building permits, applied across every county it sits in (`data/hna/cross-county-places.json`). Ten places with no ledger row use their share of the county's people, as the HNA page does.

### Towns by age: Hamilton-Perry

Below the households choice, a town or CDP can instead take a share of each age group of its county: Hamilton-Perry, the standard method for places too small for a cohort-component forecast of their own (Hamilton and Perry, 1962; Smith, Tayman and Swanson, 2013). It needs only two censuses by age and sex. `scripts/hna/build_place_hamilton_perry.py` takes table P12 of the 2010 and 2020 Census for every Colorado place and county (cached in `data/hna/source/census_age_2010_2020.json`) and writes `data/hna/place-hamilton-perry.json`:

```
cohort-change ratio(a)  = people aged a+10 to a+14 in 2020 ÷ people aged a to a+4 in 2010   (85+ ÷ 75+ for the last group)
people(a+10, t+10)      = people(a, t) × cohort-change ratio(a)
children 0-4 at t+10    = (children 0-4 ÷ women 15-44, in 2020) × women 15-44 at t+10   (5-9: per woman 20-49)
```

- Each sex runs separately, a decade at a time, to 2030, 2040 and 2050. A ratio whose 2010 count is zero takes the county's.
- The same arithmetic runs for every county. A town's share of each age group (under 18, 18-24, 25-44, 45-64, 65 and over) is its projection over its counties'. Between decades the share moves in a straight line.
- The builder applies those shares to the scenario's people in each group of each county, held to SDO's totals as for a county. Households are the county's households per person in each group times the town's people in it; homes use each county's vacancy.
- With the HNA page's share, the town grows by one fixed share of the county's growth. By age, its share also changes: a town that gained young families from 2010 to 2020 keeps gaining them, and an aging one keeps aging.
- Vintage 2024, sliders at 100%, homes by 2044 for resident growth: Fruita 2,435 by age against 1,591 at the HNA page's share, Grand Junction 15,857 against 11,248, Boulder 5,798 against 5,981, Fort Collins 18,030 against 16,482.

It is offered for 431 of the 482 towns and CDPs. The other 51 are left out, and the builder says why:

- 24 were first counted in 2020, so there is no 2010 count to carry forward.
- 27 grew or shrank so much from 2010 to 2020 that repeating it every ten years runs far past any county forecast. Windsor, for one, would pass 100,000 people by 2044. Shares by age are offered only where the 2020 count was between two-thirds and one and a half times the 2010 count. That leaves out Castle Rock, Erie, Windsor, Johnstown, Monument, Timnath and seven other towns of over 5,000 people.
- The Census Bureau gave four places new codes in 2020: Castle Pines, Castle Pines Village, Phippsburg and Watkins. Each takes its 2010 counts from the code it replaced.

The HNA page draws a saved scenario that uses shares by age as the builder's people for the town, starting from the page's own first year, and says so (`test/hna-saved-scenario-matches-builder.test.js`).

### The sliders and presets

Each slider is a percentage of SDO's forecast for the place loaded, so a setting means the same in a small town as in Denver:

| Preset | Births | Deaths | Migration |
|--------|--------|--------|-----------|
| SDO forecast | 100% | 100% | 100% |
| Half the migration | 100% | 100% | 50% |
| 1.5× the migration | 100% | 100% | 150% |

Migration scales SDO's net migration at every age. Where the people SDO has arriving form fewer households than those leaving (a college town's students and graduates), less migration means more homes; the page says so when it happens.

### Migration from the years before the forecast

Above the migration slider, the reader can choose what 100% means: SDO's forecast, or the ten years before it as SDO estimated them. The second carries recent migration forward, the usual alternative to a forecast's own migration assumption (Smith, Tayman and Swanson, 2013).

- `scripts/hna/build_scenario_baseline.py` takes SDO's estimated population by age and sex for each of those years, with its estimated births and deaths. It applies the same residual as for the forecast years: next year's population by age, less survivors and newborns, with Colorado's rates scaled to SDO's totals.
- The residuals are averaged into one year of net migration by age and sex (`pastMigration` in each county's baseline file). It adds up to SDO's estimated net migration for those years, to within a few people a year; the script stops if it does not.
- With this choice, every forecast year gets that same migration by age, times the slider's percentage. Births and deaths still follow SDO's forecast, and so do household rates.
- A town takes its county's past at the same share as its forecast.

This differs from setting the slider to the past's share of SDO's forecast. In many counties SDO's forecast net migration is near zero, or runs the other way from the past, so no percentage of it can reproduce the past. In Vintage 2024 that includes Eagle County and several farm counties.

### The shaded range: how far past forecasts missed

The chart shades where two in three past forecasts for a place of the loaded size landed, around SDO's line. It is the standard empirical way to size a forecast's error (Smith, Tayman and Swanson, *A Practitioner's Guide to State and Local Population Projections*, 2013, ch. 13; Rayer, "Population Forecast Errors: A Primer for Planners," *Journal of Planning Education and Research* 27, 2008). `scripts/hna/build_forecast_error.py` writes `data/hna/forecast-error.json` in four steps:

1. It forecasts every Colorado county from each launch year since 1980, using SDO's population estimates from 1970 on. Each forecast is the average of a linear and an exponential trend over the ten years before launch.
2. It compares each forecast 1 to 20 years out with SDO's later estimate for that year, measuring the miss as a percent of the forecast. The range is drawn around a forecast, so that is the measure it needs.
3. It keeps the smallest miss that at least two in three forecasts stayed within, rounded up to a tenth of a point so the range holds no fewer. This is done separately by population at launch: under 5,000; 5,000 to 20,000; 20,000 to 100,000; and over 100,000. A later year never shows less error than an earlier one.
4. Adams, Boulder, Broomfield, Jefferson and Weld count as one area. Broomfield was formed from the other four in 2001, and SDO's earlier estimates count its people in them.

The values for each size and year out are in `data/hna/forecast-error.json` (`errorPct`), rebuilt with each SDO vintage. The sentence under the chart gives the loaded place's 20-year value.

SDO does not publish its past county forecasts as data, so these trend forecasts stand in for its own. Rayer (2008, Table 5) finds trend and cohort-component county forecasts about equally precise.

On the chart, each year's range is that year's error, taken as a share of the place's projected population and converted to homes. The conversion uses SDO's households per person and the county's target vacancy. A town uses its own population's size group. The record runs 20 years out, so the range stops there.

### Saved scenarios from the earlier model

Scenarios saved before 2026-10-20 held multipliers and a number of people moving in a year. Loading one converts the multipliers to percentages and the people a year to a percentage of SDO's average net migration for the place loaded. The percentage is signed: where SDO expects more people to leave than arrive, a saved 0 loads as 0% and a saved net departure as its share of SDO's. A count in the opposite direction from SDO's forecast cannot be a share of it, so it loads at 0%, the nearest setting, and the page says why. A count more than twice SDO's loads as 200%, the highest the builder models, again with a note, and a record that never set a count keeps SDO's migration.

### Limitations

- The builder changes SDO's forecast; it does not make a new one. Migration is not tied to jobs, wages or home prices.
- Household rates by age are SDO's, as forecast or held at 2024's; no setting ties them to home prices or incomes.
- With the HNA page's share, a town's share of county growth is fixed over the 20 years. By age, each share moves as it did from 2010 to 2020, including any annexation in that decade. The 2020 Census adds noise to small places' counts to protect privacy, so a town of a few hundred people has uncertain shares by age.

---

## Pipeline scenario files

`scripts/hna/demographic_projections.py` builds `data/hna/scenarios/*.json` with the model below. It predates the Scenario Builder's SDO baseline and is kept as it was.

### Base Population

The base population is sourced from **DOLA Single-Year-of-Age (SYA)** county files (2024 vintage), available at:  
→ https://demography.dola.colorado.gov/population/population-totals-colorado-counties/

Each county's base population is organized into **18 five-year age groups** (0–4, 5–9, … 80–84, 85+) for males and females separately.

---

### Survival Rates (Mortality Component)

Survival rates are derived from the **US life table** (CDC/NCHS) and adjusted for each scenario using a mortality multiplier:

```
annual_survival[i] = (5yr_survival[i] × mortality_multiplier)^(1/5)
```

Default 5-year survival rates by cohort:

| Age Group | Survival Rate |
|-----------|--------------|
| 0–4       | 0.9985       |
| 5–9       | 0.9990       |
| …         | …            |
| 80–84     | 0.8900       |
| 85+       | 0.7500       |

---

### Fertility (Birth Component)

Births are computed from **age-specific fertility rates (ASFRs)** applied to female cohorts aged 15–49:

```
births_per_year = Σ (female_cohort[i] × ASFR[i] × fertility_multiplier / 5)
```

for i in {15–19, 20–24, 25–29, 30–34, 35–39, 40–44, 45–49}.

Default ASFRs (per woman per 5-year period):

| Age Group | ASFR   |
|-----------|--------|
| 15–19     | 0.040  |
| 20–24     | 0.160  |
| 25–29     | 0.280  |
| 30–34     | 0.280  |
| 35–39     | 0.160  |
| 40–44     | 0.055  |
| 45–49     | 0.008  |

Sex ratio at birth: 1.05 males per female.

---

### Net Migration

Annual net migration is distributed across age cohorts proportionally:

```
migration_for_cohort[i] = net_migration_annual × age_share[i]
```

Migration is split 48% male / 52% female, reflecting observed Colorado in-migration patterns.

---

### Household Formation

Population is converted to households using a **headship rate**:

```
households = total_population × headship_rate
```

Default headship rate: **0.38** (derived from ACS 5-year estimates for Colorado).

---

### Housing Unit Demand Formula

The pipeline model's formula. (The Scenario Builder uses the HNA page's formula, above.)

```
units_needed = households / (1 − vacancy_target)
```

Where:
- `households` = projected households in the target year
- `vacancy_target` = 0.05 (5% frictional vacancy — the minimum needed for a functional market)

The **cumulative need above base** is:

```
cumulative_need = max(0, units_needed_target_year − base_units_existing)
```

---

### Three Built-In Scenarios

| Scenario       | Fertility Mult | Mortality Mult | Net Migration/yr |
|----------------|---------------|----------------|-----------------|
| Baseline       | 1.00          | 1.00           | 500             |
| Low Growth     | 0.90          | 1.02           | 250             |
| High Growth    | 1.05          | 0.98           | 1,000           |

#### Data Sources for Scenarios

- **Baseline**: DOLA Components of Change (2018–2023 average net migration)
- **Low Growth**: Reduced migration reflecting FRED CPI shelter index affordability headwinds (`CUUR0000SAH1`)
- **High Growth**: Doubled migration reflecting FRED labor market expansion (`UNRATE`)

---

## Transparency and Reproducibility

The Scenario Builder's arithmetic is implemented twice, and the two must stay the same:

1. **Python** — `step()` in `scripts/hna/build_scenario_baseline.py`, which builds the baselines and checks the default path against SDO
2. **JavaScript** — `_step()` in `js/projections/cohort-component-model.js`, which runs in the browser

`test/scenario-baseline-reproduces-sdo.test.js` runs the browser model on every county's baseline and checks it against SDO's population and households. To rebuild:

- `python3 scripts/hna/fetch_colorado_vital_rates.py` when NCHS publishes newer tables (the output is committed)
- `python3 scripts/hna/build_scenario_baseline.py` after the SDO files change (the weekly HNA data build runs it)
- `python3 scripts/hna/build_forecast_error.py` after the SDO files change, for the shaded range (the weekly HNA data build runs it; `test/forecast-error-band.test.js` fails if the file and the script disagree)

The pipeline scenario files are rebuilt with `python3 scripts/hna/build_scenarios.py`.

---

## Limitations of the pipeline model

- The model uses **county-level** net migration; sub-county migration patterns are not modeled
- Headship rates are **static**; actual household formation rates vary with age structure and housing costs
- The model does **not** account for zoning constraints, development pipeline, or demolition rates
- Projections beyond 10–15 years carry increasing uncertainty; ranges (low/high) should be presented alongside baseline

---

## References

- Colorado State Demography Office (DOLA): https://demography.dola.colorado.gov/
- US CDC Life Tables: https://www.cdc.gov/nchs/products/life_tables.htm
- NCHS U.S. State Life Tables, 2021 (NVSR vol. 73 no. 7): https://www.cdc.gov/nchs/data/nvsr/nvsr73/nvsr73-07.pdf
- NCHS Births: Final Data for 2023 (NVSR vol. 74 no. 1): https://www.cdc.gov/nchs/data/nvsr/nvsr74/nvsr74-1.pdf
- ACS 5-Year Estimates (headship rates): https://data.census.gov/
- 2010 Census Summary File 1 and 2020 Census Demographic and Housing Characteristics File, table P12 (sex by age): https://data.census.gov/table/DECENNIALDHC2020.P12
- Hamilton, C. H., and J. Perry, "A Short Method for Projecting Population by Age from One Decennial Census to Another," *Social Forces* 41(2), 1962.
- FRED Economic Data: https://fred.stlouisfed.org/
