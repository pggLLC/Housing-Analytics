# `js/deal-lender-schedules.js`

Lender schedules built on a finished Deal Engine result: the construction
draw schedule and conversion test, the line-by-line 15-year budget with its
stress tests and reserve accounts, and the exit paths after the compliance
period. Pure: no fetching, no page state. Every figure that cannot be measured
is null with a reason in the same object, never $0.

compute({ result, fields, rules, rerun }) — result is the cleaned engine
result; rerun(fields) returns a fresh engine result for changed fields, used
only for the stress cases so every case runs the same engine.

## Symbols

### `constructionDraw(result, fields)`

Month-by-month construction draws, equity pay-in, a construction loan that
funds only what the sources in hand do not (interest on the opening balance,
capitalized), and the loan payoff at conversion to the permanent loan.

### `conversionTest(result, fields, draw, rerun)`

What happens to conversion when the permanent rate moves, operating income
comes in lower, or fewer credits are delivered than were priced.

### `coverageWindow(rows)`

The 15-year coverage test needs every year. A year with no must-pay debt
(a loan paid off) needs no coverage; a year whose payments are unknown, such
as a loan past maturity with no refinancing, makes the whole test unknown
rather than a shorter test that looks like a pass.

### `fifteenYearStress(result, fields)`

Each stress case changes one input over 15 years with the closed loan held,
so the coverage shows the year it would first fall below CHFA's 1.15x.

### `reserveAccounts(result, fields, budget)`

The replacement reserve account (deposits, interest, capital needs) and the
operating reserve covering any year the property runs short.

### `softLoanBalances(result)`

What each soft loan owes year by year, so the exit can see it.

### `exitPaths(result, fields, rules)`

After year 15: the value at a range of cap rates, the minimum purchase price
under 26 U.S.C. 42(i)(7)(B), a refinance, a resyndication and holding on.
