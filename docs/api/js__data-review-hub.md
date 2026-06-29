# `js/data-review-hub.js`

## Symbols

### `_esc(str)`

HTML-escape a string for safe insertion into innerHTML.

### `revealSourcesTab()`

F147 — Switch to the Sources tab whenever a sidebar filter is touched,
UNLESS the user is already viewing it. Sidebar filters only affect the
Sources grid; if the user clicks "Stale" while on Overview they see no
change, which made the filters look broken. Auto-revealing the grid
makes the click ↔ outcome relationship obvious. The Sources grid then
scrolls into view so the result is on-screen even when the user
scrolled down to read the Overview KPIs first.
