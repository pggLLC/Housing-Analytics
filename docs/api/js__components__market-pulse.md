# `js/components/market-pulse.js`

js/components/market-pulse.js
==============================
The Insights page's Risk Indicators and Rates & Deadlines cards, read from
the data files that workflows (or a tracked hand capture) keep current:

  data/fred-data.json                              daily (fetch-fred-data.yml)
  data/market/aamd-denver-vacancy.json             quarterly, by hand; the
                                                   market-rents workflow opens
                                                   an issue when AAMD publishes
  data/market/colorado-foreclosure-performance.json quarterly (FHFA NMDB)
  data/chfa-qap-calendar.json                      weekly (chfa-qap-watch.yml)

The pure helpers are exported so tests can check the page against the files.
A value that is missing stays null and renders as "Value unavailable"; it is
never coerced to 0 (AGENTS.md, "An unmeasurable quantity is null").

## Symbols

### `latest(series)`

Latest observation of a FRED series with a numeric value, or null.

### `before(series, at, days)`

The observation on or before `days` days before `at`, or null when the
series does not reach back that far.

### `rates(fred)`

Rows for the rates table: latest value, its date, and the 1-year change in basis points.

### `nextDeadlines(calendar, today, n)`

The next `n` CHFA deadlines on or after `today` (YYYY-MM-DD). Decided by
date, not by the file's hand-set status, so a date that has passed drops
off even if nobody flipped it to "past".

### `risk(fred, vacancy, foreclosure)`

The three Risk Indicators rows. Each value is null when its file lacks it.
