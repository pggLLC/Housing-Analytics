# `js/components/input-provenance.js`

input-provenance.js — tell the user which numbers are theirs.

The Deal Calculator ships 133 visible fields and 109 of them arrive
pre-filled: Total Development Cost reads $20,000,000 and Total Units reads
60 before anyone types anything. Those are starting assumptions, but they
render identically to a figure the user entered and to a figure derived from
their jurisdiction's data. A novice cannot tell the three apart, and an
assumption mistaken for a finding is the same defect class as a null
rendered as $0 (see AGENTS.md, "An unmeasurable quantity is null, never 0").

This marks each field with one of three states:

  assumption — pre-filled by the tool; the user should review it
  yours      — the user has edited it
  data       — supplied from the selected jurisdiction (opt-in via markup)

Deliberately additive: it reads the DOM after the form renders and never
changes a value, so it cannot alter a calculation. If it fails to load, the
form behaves exactly as before.

## Symbols

### `candidateFields(scope)`

Fields the user actually fills in. Radios/checkboxes carry their own labels.

### `initialState(el)`

Initial state for a field. Markup may declare `data-provenance="data"` to
mark a jurisdiction-derived value; everything else pre-filled is an
assumption until the user touches it.

### `apply(scope)`

Apply provenance to every candidate field under `scope`.
Safe to call repeatedly — re-running after a re-render re-marks new fields
and leaves fields the user already edited as "yours".

@param {Element|Document} [scope]
@returns {{assumption:number, yours:number, data:number, total:number}}
