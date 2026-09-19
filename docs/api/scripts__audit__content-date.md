# `scripts/audit/content-date.mjs`

content-date.mjs — when did a tracked file's CONTENT last change?

The freshness stamps on the site (`lastUpdated` in js/data-source-inventory.js,
`last_update` in DATA-MANIFEST.json) were derived from filesystem mtime. Git
does not record or restore mtimes, and actions/checkout writes every tracked
file fresh, so on a runner every data file's mtime is the checkout time. The
sync scripts bump whenever mtime is newer than the declared stamp, so on each
scheduled run *everything* bumped and the dashboard's "Stale" signal became
vacuous — no source could ever go stale because the bot re-certified all of
them each morning (#1597).

The evidence was stark: 47 of 47 inventory sources with a localFile carried
one identical date, and 31 of 31 manifest sources carried one identical
timestamp — the exact second CI checked out the repo.

Git history is the honest source. `git log -1 --format=%cs -- <path>` is the
commit that last changed that file's content: checkout-independent, and it
differentiates. data/co-county-boundaries.json last genuinely changed
2026-03-06; its mtime claimed 2026-07-15 locally and today's date in CI.

Correctness depends on real history being present, so every failure mode
reports itself rather than guessing:
  - a shallow clone cannot see the true commit, so we decline to stamp
  - a path git has never seen has no content date
  - a path with uncommitted changes genuinely differs from HEAD, so the
    working copy's mtime is the truthful answer for a local run

## Symbols

### `isShallow(repo)`

True when the clone lacks full history, so `git log` cannot be trusted.

### `isTracked(repo, relPath)`

True when git tracks the path at HEAD.

### `isDirty(repo, relPath)`

True when the path has staged or unstaged modifications.

### `contentDate(repo, relPath, opts)`

contentDate — resolve when a file's content last changed.

@param {string} repo     repository root
@param {string} relPath  path relative to the repo root
@param {{shallow?:boolean}} [opts] pass a cached isShallow() to avoid
       re-shelling once per file across a few hundred sources
@returns {{date: (string|null), iso: (string|null), source: string, reason: string}}
         `date` is YYYY-MM-DD and `iso` a full timestamp, or null when no
         trustworthy answer exists. `source` is one of
         'git' | 'worktree' | 'shallow' | 'untracked' | 'missing' | 'error'.
