# `scripts/audit/source-watch.mjs`

## Symbols

### `mainHtml(html)`

The page's main content when it marks one (<main>, else <article>), so rotating
 sidebars, related-story lists and menus outside it never read as a change.

### `pageText(html)`

Readable text of an HTML page, one block per line.

### `hashedText(text)`

The text that is hashed: page text without stamp lines that change on their own.

### `keyLines(text)`

Lines carrying a date, an amount, a status word or an edition, deduplicated.

### `urgentDates(record)`

Dates within a record that mean "check it sooner": review_by and any deadline, hearing or vote.

### `buildTargets(docs, { skipUrls = new Set()`

Every source to watch, one per URL, naming the records it stands for.

### `intervalDays(target, today)`

Days between checks for a target on a given Denver date.

### `checkSource(target, prev = {}, fetcher, now)`

Check one source. Returns { entry, outcome, detail }. Outcomes: baseline,
 unchanged-headers, unchanged-text, cosmetic, changed, failed.
