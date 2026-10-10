# `scripts/build-car-report-index.mjs`

scripts/build-car-report-index.mjs — write data/car-market-reports.json, the
list of monthly CAR reports that actually exist (#2053).

The HNA pages used to find the newest report by asking for the current
calendar month and stepping back. On the 1st of every month that file does
not exist until car-data-update.yml lands (~3h after its cron), so every page
load logged a 404 and the rendered smoke failed six flows on every PR for a
third of a day. The pages now read this index and request only files in it.

Deterministic: no timestamp, so a run that finds the same files writes the
same bytes. test/car-report-index.test.js fails if it disagrees with data/.

Usage: node scripts/build-car-report-index.mjs [--check]

_No documented symbols — module has a file-header comment only._
