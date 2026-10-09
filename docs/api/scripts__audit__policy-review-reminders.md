# `scripts/audit/policy-review-reminders.mjs`

## Symbols

### `dueReviews(docs, todayDenver, existingMarkers = new Set()`

Pure: which review issues are due today. No clock, filesystem or network.

### `readDocs(root)`

Read the committed files (HEAD), ignoring local edits.
