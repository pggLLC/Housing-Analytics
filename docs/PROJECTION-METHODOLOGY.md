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

### Homes needed

The builder uses the HNA page's formula, so with nothing changed it shows the HNA page's 20-year figure exactly:

```
homes needed(year) = households added since 2024 ÷ (1 − county target vacancy)
20-year figure     = homes needed(2044) + homes for a quarter of today's lower- and middle-wage in-commuters
```

- The target vacancy is each county's, from `data/hna/projections/<county>.json` (`housing_need.target_vacancy`).
- The in-commuter part is the ranking index's `incommuter_need_units` (`data/hna/workforce-need.json`).
- A scenario's change from SDO's forecast is added to the HNA projection's own series (`incremental_units_needed_dola`, or the place ledger's `incremental_units_needed`), so the two pages agree to the home at 100% for all 536 jurisdictions with a figure (`test/scenario-baseline-reproduces-sdo.test.js`).

### Towns and CDPs

A town or CDP takes the share of county growth the HNA page gives it: its blended share in `data/hna/projections/places.json`, from its share of the county's households and of its 2020–2024 building permits, applied across every county it sits in (`data/hna/cross-county-places.json`). Ten places with no ledger row use their share of the county's people, as the HNA page does.

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
- Household rates by age are SDO's; a scenario changes the number of people of each age, not how likely they are to head a household.
- A town's share of county growth is fixed over the 20 years.

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
- FRED Economic Data: https://fred.stlouisfed.org/
