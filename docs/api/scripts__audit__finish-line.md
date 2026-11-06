# `scripts/audit/finish-line.mjs`

scripts/audit/finish-line.mjs — measure the repo against the definition of
done in docs/FINISH-LINE.md.

WHY THIS IS A SCRIPT AND NOT A CHECKLIST

A checklist in a doc goes stale silently, and this repo has spent a week
proving what that costs: a GOTCHA comment nobody read (#1695), a derived
chain reconstructed from memory every time (#1696), a glossary that shipped
and reached 17 of 975 terms. Written-down rules do not survive contact with
a working session.

So the finish line is measured. Every item is PASS, OPEN, or UNMEASURED —
and UNMEASURED is a first-class state, never quietly counted as done. That
distinction is the entire subject of this codebase.

  node scripts/audit/finish-line.mjs            human-readable status
  node scripts/audit/finish-line.mjs --json     machine-readable
  node scripts/audit/finish-line.mjs --strict   exit 1 if a PASS regressed

## Symbols

### `DEAL_PACKAGES`

The Deal Calculator packages Phase 2 has to finish (docs/FINISH-LINE.md,
agreed by the owner 2026-10-14), in the order they must merge.

A package is done when its PR names the guard that holds its acceptance
cases and that guard is reachable from test:ci — the standard O2 applies to
the market-study artifacts. A closed issue is not evidence: issues close by
hand, and this audit runs offline.

Each package's PR sets its own `guard` here. Every guard must be distinct;
two packages pointing at one script means one of them is not held.

### `evaluateDealPackages(packages, reachable)`

Decide O3 from the package list and the set of scripts reachable from
test:ci. Separated out, like evaluateGuidedPath, so the failing cases can be
tested with lists the repo does not contain.

An empty list is OPEN, never PASS: a list that names nothing has nothing to
say about whether the work is done.

### `evaluateGuidedPath(route, existsFn)`

Decide G1 from a route and a file-existence oracle.

Separated out so the failing cases can be tested with routes the repo does
not contain. Asserting these against the real route proves nothing: it is
correctly ordered and complete, so removing a check here would change no
observable output and a guard written that way passes over its own removal.

An empty route is OPEN, never PASS. A parse that matches nothing has nothing
to say, and reporting success over an empty list is precisely how the stale
six-step table stayed green through three route changes.
