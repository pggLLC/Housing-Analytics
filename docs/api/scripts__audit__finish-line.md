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

### `GUIDED_PATH`

The guided path, READ from the one place a step number is written down.

This used to be a hand-written table of six steps, and it went stale without
a sound. The route changed three times on 2026-09-16 — the entry point moved
from the Opportunity Finder to the jurisdiction, and a seventh step was
added — and this constant still described the old one. G1 kept reporting
PASS the whole time, because all it asks is whether six named files exist,
and they did.

That is the failure this audit exists to catch, sitting inside the audit: a
green that is true about something other than what it claims. Worse, a test
asserted `GUIDED_PATH.length === 6`, so a guard was holding the wrong answer
in place and would have failed anyone who corrected it.

So it is derived. The component's STEPS table is the route; if that table's
shape changes the parse returns nothing and G1 goes OPEN rather than passing
on an empty list. test:entry-path separately holds the component and the
twelve hard-coded rails to each other, so reading the component reads what
the pages actually render.

### `evaluateGuidedPath(route, existsFn)`

Decide G1 from a route and a file-existence oracle.

Separated out so the failing cases can be tested with routes the repo does
not contain. Asserting these against the real route proves nothing: it is
correctly ordered and complete, so removing a check here would change no
observable output and a guard written that way passes over its own removal.

An empty route is OPEN, never PASS. A parse that matches nothing has nothing
to say, and reporting success over an empty list is precisely how the stale
six-step table stayed green through three route changes.
