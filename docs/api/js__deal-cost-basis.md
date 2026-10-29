# `js/deal-cost-basis.js`

Itemized development costs, eligible basis, fee tests and credit limits (#2160).
Pure functions, no DOM. Rules come from data/policy/lihtc-underwriting-rules.json;
a rule is applied only when it is adopted and cites a source in that file.
An unknown figure is null with a reason, never 0.

## Symbols

### `summarizeCosts(lines, tdc)`

Totals for itemized lines. tdc is the entered total development cost.

### `grantBasisReduction(tranches, rules)`

Grant reduction by source type (26 U.S.C. 42(d)(5)(A)).

### `contractorFeeTest(args)`

CHFA builder's profit and overhead limit, QAP 3.M.3.

### `developerFeeBase(summary, contractorTest, specialPopulations)`

CHFA's base for the developer fee limit, QAP 3.M.3.

### `developerFeeTest(args)`

Aggregate developer plus consultant fee, tested before deferral.

### `feeExcessInBasis(summary, contractorTest, developerTest)`

The part of an over-limit fee that sits in basis. CHFA limits the fees in
calculating credit, and a reduction in fees reduces eligible basis (QAP 3.M.3).

### `dohDeveloperFeeShare(summary)`

DOH's developer fee measure: the fee subtotal as a share of total cost less
that fee, reserves and acquisition. Shown beside CHFA's limit; it limits nothing.

### `legacyCostFields(read)`

Saved fields from before the DOH layout, as the DOH lines they now belong to.
read(key) gives a saved value ("cost-overhead", "cost-overhead-basis", ...) or
null. Old lines that now share a line add together; if their basis choices
differ, the shared line becomes partly in basis with the sum of their parts.
A line already saved under its new name wins.

### `gapCredit(args)`

CHFA Method Two: the credit the funding gap needs, QAP 3.M.1.

### `BEDROOM_ROWS`

CHFA Method Three (QAP 3.M.1), from the limits in CHFA's 2027 Common
Application workbook (data/policy/chfa-common-app-tables.json; the tables
exist nowhere else). As the workbook calculates it (Calculations rows
497-516): limit per unit = TRUNC(zone factor x base limit for the bedroom
count and building type); adjusted eligible basis = the sum over units;
x 1.3 for a QCT or DDA, x applicable fraction, x the credit rate.
The workbook follows a draft QAP, so the result is a check shown beside
the capacity, never a change to it.

### `basisAndCredit(args)`

Eligible basis to annual credit, with the boost, applicable fraction and CHFA limits.

### `underwritingCheck(args)`

CHFA's minimum and high debt-coverage tests over the rule's forecast years.

### `stateCredit(args)`

State credit equity, kept apart from federal equity, with CHFA's annual limits.
Each stream is an annual amount over the six-year allocation (QAP 3.P.1).

### `addedCredit(args)`

A credit added to the stack: its gross equity, and the net new equity it brings
after the credit it displaces, any cut to the federal award, and its investor fees.
Substituting for a credit creates no new cash, so only the net changes the stack.

### `payIn(total, pcts)`

One source's equity pay-in schedule: closing, construction completion, stabilization.

### `costPerSf(args)`

Cost per SF for the contractor contract and the total, each with its scope.
