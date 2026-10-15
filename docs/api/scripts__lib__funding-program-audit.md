# `scripts/lib/funding-program-audit.js`

## Symbols

### `datesIn(text)`

Every date in a text, as YYYY-MM-DD: "Month D, YYYY" as written, and "Month YYYY"
(e.g. "the first business day of November 2026") as that month's last day, so a
round named only by month still counts as upcoming until the month ends.

### `fundingProgramFindings({ guide, soft, today })`

@returns {Array<{severity, file, description, expected, actual, recommendation}>}
