# `scripts/audit/lib/audit-budget.mjs`

Budgets for the browser audits. Pure functions, so they are unit-tested
without a browser (test/audit-budgets.test.mjs).

## Symbols

### `checkA11yBudget(results, budget)`

Compare serious and critical findings with the committed budget, page by
page and rule by rule. Returns { over: [...], under: [...] }. Moderate and
minor findings are reported but not budgeted.

Budgeted per page, not per rule across the site: a site-wide allowance lets
a fix on one page pay for a new failure on another, and the debt stays
hidden. A page or rule absent from the budget is allowed nothing.

Without this the audit was a reporter nobody read: it could find 926
serious failures and still finish green.

### `checkUxBudget(results, budget)`

Compare the usability pass with its budget. Returns a list of breaches,
each { page, measure, found, allowed }.

Budgeted (hard): DOM size and main-thread blocking per page, because those
are what froze step 3 for ~18 s on a phone; and exactly one <h1>, because a
page without one has no stated purpose for a screen reader or a newcomer.

Reading grade and first-screen abbreviations are never budgeted. They are
rough signals for a professional audience, not measures of comprehension;
only people reading the site can say whether they understood it.

### `fleschKincaidGrade(text)`

Flesch-Kincaid grade of a block of prose, or null when there is none.
