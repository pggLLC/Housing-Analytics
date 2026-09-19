# `scripts/lib/freshness-guard.mjs`

scripts/lib/freshness-guard.mjs

Node counterpart of scripts/lib/freshness_guard.py. Same rule, same reason:
a freshness checker restores its targets with `git checkout --` (and, for the
jurisdiction digests, `git clean -fd`, which also deletes untracked files),
so running one between regenerating and committing throws the regeneration
away without saying anything.

See the Python module for the incident this came from.

## Symbols

### `refuseIfDirty(targets, { checker, npmScript } = {})`

Exit with REFUSED if any target holds uncommitted work. Returns normally
when it is safe to proceed.
