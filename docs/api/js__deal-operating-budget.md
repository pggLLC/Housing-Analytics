# `js/deal-operating-budget.js`

Operating budget and other income in the Division of Housing layout (DOH PR 2).
Pure functions, no DOM. Every line is a dollar amount per unit per year, the
figure DOH's sheet reports as P.U.P.A. ("per unit per annum") expenses.
Real estate taxes and the replacement reserve stay on their own inputs
(dc-prop-tax, dc-rep-reserve), because the tax exemption applies to taxes
alone and the reserve is required separately; the page shows both inside
DOH's "Other expenses" group. An unknown figure is null with a reason, never 0.

## Symbols

### `fillFromTotal(totalPerHome, typed)`

Fill the lines you have not typed from a per-home total (before the replacement reserve, taxes included),
split by WORKBOOK_SHARES. Typed lines are kept and come off the total first; the rest is shared out among the
other lines in proportion to their shares, so the lines add to the total. Whole dollars; the rounding goes to
the largest filled line. `typed` lists the line ids to keep with their amounts ({ id: amount }).
Returns { fills: { id: amount }, kept, keptTotal, total, reason } and never fills when it cannot add up.

### `summarizeOperating(lines, income)`

Totals per unit per year. A blank line is nothing budgeted on that line;
an all-blank budget is unknown, never $0 of expenses.

### `pupaExpenses(summary, propTaxPerUnit, repReservePerUnit)`

DOH's P.U.P.A. expenses: every expense line plus taxes and the reserve.

### `legacyOperatingFields(read)`

Old share links carried one figure, dc-opex, in dollars per unit per MONTH.
A link with it and no DOH line loads it, times 12, into "Other expenses,
Other" and empties every other line and income source, so the example's
lines are not added on top and every result is unchanged.

### `legacyOperatingProvenance(map, legacyFields)`

The provenance record an old link carried for dc-opex moves with its value.
A figure the sender entered stays the sender's on every line the old figure
now fills or empties; an untouched old default is left to the lines' own
labels, because it was the old invented figure. Returns a new map.

### `expenseTargetCheck(args)`

An expense target someone hands you, set beside the expenses the calculator uses.
The target never replaces the expenses: a target below them is reported as its own
line, with the year-1 coverage it would show, so a plug cannot hide in the total.
args: targetPerUnitYear, usedAnnual (operating expenses used, a year), units, noi,
mustPayDebtService (year 1).
