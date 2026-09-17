# `scripts/audit/text-wrap-audit.mjs`

text-wrap-audit.mjs — find text that wraps when it did not need to.

ADVISORY. Always exits 0. It reports; it does not gate.

That is deliberate and it is a risk. A check nobody can fail is a check
people stop reading — this repo spent a day proving that, when a flaky axe
gate trained everyone (me included) to merge past a red check. So this
prints a short, ranked, specific report rather than a wall, and records a
baseline count so the number moving is visible.

WHAT IT LOOKS FOR

  mid-word breaks   a single word split across two line boxes. Always a
                    defect: `overflow-wrap: anywhere` is meant for long
                    unbreakable strings in narrow containers, and applied
                    to a data table it converts a column-sizing problem
                    into a silent height problem.

  gratuitous wraps  short text on 2+ lines while its own box has room to
                    spare. The text is not too long; the box is wrong.

The real example this was built from, on housing-needs-assessment.html:

  Mechanism                716px wide   5 lines
  Downturn (-2% annually)   67px wide   5 lines
  Moderate (3% annually)    67px wide   5 lines
  High (6% annually)        67px wide   5 lines

A one-word header took 716px; three long ones got 67px each and shattered
mid-word. One row, 123px tall instead of ~40px, entirely from column sizing.

Usage:
  AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/text-wrap-audit.mjs
  ... --json    machine-readable

## Symbols

### `PAGES`

Pages and widths. Kept small: this is a smoke check, not a full sweep.

### `PROBE`

Runs in the page. Uses Range rects per word: a word whose own range spans
two client rects was broken across lines, which no correct layout does.
