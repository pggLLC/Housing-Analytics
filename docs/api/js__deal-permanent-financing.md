# `js/deal-permanent-financing.js`

Permanent financing in the Division of Housing layout (DOH PR 3).
Pure functions, no DOM. The engine's sources are regrouped the way DOH's
Housing Development Analysis spreadsheet, Permanent Financing Sources tab,
groups them: hard mortgages typed Conventional, Tax-exempt or Federal
financing; tax credit equity; government grants and soft debt; other
(non-governmental) grants; owner equity. Nothing here changes a result:
every dollar is the engine's, and the groups add back to its total sources.
An unknown figure is null with a reason, never 0.

## Symbols

### `trancheGroup(t)`

The DOH group a tranche counts in, with the reason when it has none.

### `maxLoanChecks(opts)`

Maximum loan by value × LVR, as DOH's quick calculation of mortgage
principal does: by NOI over a cap rate, and by an appraised value.

### `summarize(opts)`

DOH's Permanent Financing Sources from an engine result.

### `exportView(s)`

The summary without its helper function, for the JSON export.
