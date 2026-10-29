# `scripts/lib/funding-program-audit.js`

## Symbols

### `datesIn(text)`

Every date in a text, as YYYY-MM-DD: "Month D, YYYY" as written, and "Month YYYY"
(e.g. "the first business day of November 2026") as that month's last day, so a
round named only by month still counts as upcoming until the month ends.

### `fundingProgramFindings({ guide, soft, today })`

@returns {Array<{severity, file, description, expected, actual, recommendation}>}

### `fundingWatchFindings({ watch })`

What the funding watch (scripts/audit/funding_watch.py, data/audit/funding-watch.json)
saw on the agencies' own pages, against what the catalogs say:
  - a program whose page changed after the program was last checked, and
  - a program whose page has been unreachable or blocked for days, and
  - a federal notice search that has failed for days.
The watch never edits a status, so these stay open until a person rechecks the
program on its page and updates last_checked. A missing watch file (before its
first run) yields nothing.

@returns {Array<{severity, file, description, expected, actual, recommendation}>}
