# `js/deal-engine.js`

Pure rental calculation extracted for #2118, with explicit L1 loan obligations.
inputs.fields contains raw control values (including blank strings); the other
keys contain already-loaded source records. No fetching or mutable deal state.
Numeric absence is null at the result boundary, with a dotted-path reason in
unavailable. Internal NaN propagation preserves the existing blocking behavior.

## Symbols

### `loanObligations(inputs, annualNoi, deductions)`

Annual operating payments, in priority order; balloon cash is NOT assumed.
Must-pay loans use monthly interest/amortization. Deferred and contingent
interest compounds annually. Forgiveness occurs at stated maturity.
After an unpaid maturity, subsequent years need a refinancing assumption.
