# `js/jurisdiction-selector.js`

jurisdiction-selector.js
Handles all interaction logic for select-jurisdiction.html (Step 1 of the
COHO Analytics LIHTC workflow).

ES5 IIFE — no build step required.
Depends on: workflow-state.js (optional), site-state.js (optional).

## Symbols

### `syncContinueLabel()`

Relabel the continue button when the reader is being sent back somewhere.

The button reads "Begin Housing Needs Assessment", which is true for the
normal route and false for a reader returned to the deal calculator. A
control that names a destination it does not go to is the same defect as
a number that means something other than it says.
