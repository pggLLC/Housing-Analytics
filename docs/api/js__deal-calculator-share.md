# `js/deal-calculator-share.js`

## Symbols

### `shareKeys()`

Every shareable id on the page, in DOM order, one per radio group.

### `auditInputs()`

Account for every form control in <main>: shared by id, shared by data
attribute, or excluded with a reason. `unaccounted` must be empty — a
control in it is one a share link would silently drop.
