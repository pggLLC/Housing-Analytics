# `js/data-connectors/cdle-jobs.js`

NO DATA SOURCE — this connector is dormant.

It previously read a synthetic fixture that was never a real Colorado Department of Labor and Employment
extract. That fixture carried part of the PMA workforce composite until
#1562 excluded it, and was deleted on 2026-09-09.

loadMetrics() resolves to the empty shape WITHOUT a network request. Do not
restore a fetch until a real source exists — requesting a file that cannot
exist produces console errors that fail the rendered site-audit gate.

Real source when someone wires it up: CDLE Labor Market Information.

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
