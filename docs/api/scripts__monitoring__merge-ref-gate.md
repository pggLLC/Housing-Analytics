# `scripts/monitoring/merge-ref-gate.mjs`

## Symbols

### `classifyMergeability(pr)`

Classify a PR's mergeability.

`mergeable: null` is the case that matters. GitHub computes mergeability
asynchronously and returns null until it has finished, so null means
"not yet known" — it is neither mergeable nor conflicting. Collapsing it
into either direction is how a guard starts lying: treat it as mergeable
and a genuinely conflicting PR gets a green status; treat it as
conflicting and every freshly-opened PR fails for a few seconds.

### `decideStatus(classification)`

Decide the commit status to post, or null to post nothing.

Returning null for UNKNOWN is deliberate: posting a success there would
be the unearned green this gate exists to prevent, and posting a failure
would punish PRs GitHub simply has not finished evaluating. The next
scheduled pass re-checks them.

### `planStatuses(prs)`

Pair each PR with the status to post. PRs needing no status are omitted,
so the caller never has to re-derive the skip rule.

### `summarize(prs)`

Human-readable one-line summary for the job log.
