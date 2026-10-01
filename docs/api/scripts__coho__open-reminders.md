# `scripts/coho/open-reminders.mjs`

## Symbols

### `due(schedule, todayDenver, existingMarkers, repoState)`

Pure decision/rendering core: no clock, filesystem, network, or mutations.

### `readRepoState(root, schedule)`

Read HEAD blobs, ignoring local edits/untracked duplicates in the data checkout.
