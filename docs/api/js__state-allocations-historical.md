# `js/state-allocations-historical.js`

## Symbols

### `NATIONAL_BY_YEAR`

National LIHTC summary by year (2010–2023).
Each entry: { year, irsPerCapita, nationalTotal, notes }

### `COLORADO_BY_YEAR`

Colorado allocation estimates by year (2010–2023).
CO 2020 Census population: 5,773,714
Earlier populations scaled by Census intercensal estimates.
Figures marked status:'estimated' use national per-capita × CO population.
Figures marked status:'confirmed' are sourced from CHFA/HUD annual reports.

### `STATE_POPULATIONS_2020`

2020 Census population by state abbreviation (50 states + DC).
Source: U.S. Census Bureau 2020 Decennial Census (P1 table).
Used to generate per-state IRS per-capita allocation estimates for
historical years where confirmed state figures are unavailable.

### `STATE_NAMES`

Full name lookup for state abbreviations.
