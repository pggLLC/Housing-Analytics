# `js/deal-engine.js`

Pure rental calculation extracted for #2118, with explicit L1 loan obligations.
inputs.fields contains raw control values (including blank strings); the other
keys contain already-loaded source records. No fetching or mutable deal state.
Numeric absence is null at the result boundary, with a dotted-path reason in
unavailable. Internal NaN propagation preserves the existing blocking behavior.

## Symbols

### `loanObligations(inputs, annualNoi, deductions, deferredFee)`

Annual operating payments, in priority order; balloon cash is NOT assumed.
Must-pay loans use monthly interest/amortization. Deferred and contingent
interest compounds annually. Forgiveness occurs at stated maturity.
After an unpaid maturity, subsequent years need a refinancing assumption.

### `sizeChfaBoost(inputs)`

Workbook piece (paul, 25 Nov 2026, "approve the workbook pieces"): the CHFA basis boost that would
close the gap. CHFA may award "up to" 30% to a 9% building that needs it to be feasible (QAP 3.M.2);
the dossier workbooks size it to the gap. This is a readout: it reruns the engine with a CHFA boost
and never changes the deal's own figures.

### `dealChecks(result)`

Workbook piece: every dossier-workbook check that applies to a calculator deal, in one list. Each item is
pass, look (look again) or fail, or na with the reason it could not be checked. The checks themselves are
the engine's (costBasis.*); this only gathers them, so no figure changes.
