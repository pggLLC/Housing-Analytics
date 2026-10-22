# `scripts/audit/local-incentives-watch.mjs`

## Symbols

### `queue(docs, size = BATCH_SIZE)`

Pure: the queue, in priority order. Counties and municipalities only.

### `monthlyIssue(docs, todayDenver, existingBodies = [])`

Pure: the month's issue, or null if this month's already exists.
