# `js/jurisdiction-selector.js`

jurisdiction-selector.js
Handles all interaction logic for select-jurisdiction.html (Step 1 of the
COHO Analytics LIHTC workflow).

ES5 IIFE — no build step required.
Depends on: workflow-state.js (optional), site-state.js (optional).

## Symbols

### `persistSelection()`

Save the current pick as the project's jurisdiction.

Runs on every pick, not only on Continue. Step 1 has other ways out — the
"Step 1 of 7 · Go on to Opportunity Finder" box, the step rail, the site
nav — and until 2026-09-25 each of them left with nothing saved: the
header still read "+ Choose jurisdiction" after a pick, and steps 3-7
showed the State of Colorado. Following the numbered steps, 1 then 2,
was the likeliest way to lose the choice (G3 dry run).

### `syncContinueLabel()`

Relabel the continue button when the reader is being sent back somewhere.

The button reads "Begin Housing Needs Assessment", which is true for the
normal route and false for a reader returned to the deal calculator. A
control that names a destination it does not go to is the same defect as
a number that means something other than it says.
