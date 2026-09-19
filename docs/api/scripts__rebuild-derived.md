# `scripts/rebuild-derived.mjs`

scripts/rebuild-derived.mjs — rebuild everything that derives from the
HNA ranking index, in dependency order.

WHY THIS EXISTS

Changing data/hna/ranking-index.json invalidates at least eight other
artifacts. Until now nothing recorded which, or in what order, so the list
was discovered by pushing and reading CI failures — one artifact per round.

PR #1692 took seven CI rounds; only two were code fixes. Rounds 3-6 were four
different generated artifacts going stale, surfaced one at a time. On
2026-09-16, restoring the LIHTC recency data cost three more rounds, all of
them `rebuild_manifest.py` — a step whose ordering constraint was written
down, in the issue, by the person who then forgot it three times in one
session.

That is the case for this file. A chain that has to be remembered is not
documentation, it is a trap with a comment next to it.

ORDER IS LOAD-BEARING IN THREE PLACES

  1. The index has THREE producers. build_ranking_index.py writes it and the
     two augmenters add fields and write it back. Running only the first
     DELETES their contribution — that is what happened in June 2026 and
     stood for three months (#1698).
  2. ranking-scenarios pins the index's `generatedAt`. Rebuild the index
     without them and ci-checks fails on a timestamp.
  3. rebuild_manifest.py records BYTE COUNTS, so it must follow everything
     that writes a data file. Including itself-adjacent steps: the home
     snapshot changes a byte count, so the manifest runs after it.

USAGE
  npm run rebuild:derived           run the chain
  npm run rebuild:derived -- --dry  print it without running anything

AFTERWARDS: commit, and only THEN run the freshness checkers. They restore
their targets with `git checkout --`, so running one on an uncommitted
rebuild throws it away. scripts/lib/freshness_guard.py now refuses rather
than letting that happen (#1695), but the ordering is still yours to keep.

## Symbols

### `CHAIN`

The chain. This array is the single source of the ordering —
test/rebuild-derived-chain.test.js asserts against it, so adding a step here
is how a new derived artifact becomes known to the repo.

### `NOT_DERIVED`

Consumers of the ranking index that are deliberately NOT in the chain.

Curated once, then guarded: the test requires every file touching
ranking-index.json to be either a step above or an entry here, so a new
consumer forces a decision instead of being discovered by a CI failure
months later.

### `INVOKED_DIRECTLY`

Run only when invoked directly.

test/rebuild-derived-chain.test.mjs imports CHAIN and NOT_DERIVED to assert
against them. Without this guard that import ran the entire 80-second
rebuild as a side effect of reading a constant — a test that silently
regenerates 579 files is worse than no test.

### `VOLATILE_LINE`

Anything whose whole diff is a wall-clock stamp or a source-commit SHA.

A full rebuild dirties ~579 files and essentially all of it is this: every
digest carries `ranking_index_generated_at`, every brief embeds that same
timestamp inside its metric LABELS, scenarios pin `based_on` plus the commit
they were built from. Reporting "579 files changed" without saying so is the
difference between a maintainer thinking "expected" and "what did I just do".

### `substantiveChanges()`

Files whose diff survives ignoring every volatile line — i.e. real change.
