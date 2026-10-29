# `js/deal-doh-schedules.js`

Sources and uses by activity, and the 15-year operating pro forma, in the
Division of Housing layout (DOH PR 4). Pure functions, no DOM.

Sources by activity: DOH's Permanent Sources & Uses Budget lists, for each
of the nine cost categories, its total cost, the state funds requested, the
other funds, each source and whether it is pending or committed. Here each
soft source says what it pays for; tax credit equity, the mortgages, the
deferred fee and any source not tied to one category pay for the project as
a whole and sit in one row. Every dollar is the engine's, through the DOH
permanent financing summary, so the table adds back to its total sources.

15-year pro forma: the engine's projection and loan schedule in DOH's rows.
Cash after the must-pay loans and the bridge loan pays the asset management
fee (any part cash cannot cover accrues to later years), then cash-flow loans, then the deferred developer fee. The engine
allocates all three; the deferred fee is paid from cumulative cash flow, so
its payback year is the exit panel's.
An unknown figure is null with a reason, never 0.

## Symbols

### `sourcesByActivity(opts)`

Sources and uses by activity.
opts.costSummary: the engine's costBasis.summary (groups, notItemized, reason)
opts.financing: DealPermanentFinancing.summarize() output
opts.tranches: the soft sources with activity, status and stateRequest
opts.labels: program id → short name

### `fifteenYear(result)`

The 15-year operating pro forma in DOH's rows, from an engine result.
