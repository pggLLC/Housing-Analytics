# `scripts/audit/policy-review-reminders.mjs`

## Symbols

### `checkedOf`

The date a record was last checked, and its official source, for any listed file.

### `dueReviews(docs, todayDenver, existingMarkers = new Set()`

Pure: which review issues are due today. No clock, filesystem or network.

### `readDocs(root)`

Read the committed files (HEAD), ignoring local edits.
