# `js/data-connectors/cdle-jobs.js`

js/data-connectors/cdle-jobs.js
Colorado Department of Labor and Employment (CDLE) job vacancy accessor.

Data source: data/market/cdle_job_postings_co.json
Real data: https://www.colmigateway.com/

Exposed as window.CdleJobs.

## Symbols

### `scoreVacancyRate(agg)`

Score vacancy rate 0–100 for PMA workforce dimension.
CDLE interpretation: low vacancy = tight labour market → harder to fill
affordable-housing-eligible jobs → moderate workforce risk.
Moderate vacancy (2–5%) = sweet spot.  Very high vacancy = weak demand.

Scoring: vacancy_rate as a ratio (e.g. 0.03 = 3%).
  <1%  → 40  (extremely tight — risk of no workers)
  1–2% → 70
  2–4% → 100  (ideal moderate vacancy)
  4–6% → 80
  6–9% → 60
  >9%  → 30  (slack market / economic weakness)
