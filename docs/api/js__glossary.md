# `js/glossary.js`

glossary.js — COHO Analytics
Loads acronym definitions from data/glossary.json and provides:
  1. A modal glossary accessible via a header button.
  2. Auto-tooltip wrapping of the first occurrence of each acronym on the page.

Usage: included via <script src="js/glossary.js"></script>
The navigation.js injects a glossary button into the site header automatically.

## Symbols

### `sectionKeyFor(node)`

Which container counts as "the place the reader is looking".

First-occurrence-per-PAGE is the wrong unit on a 17,000-word assessment.
AMI appears 169 times and CDP 218 times; defining each once, at the top,
means every panel below it is unexplained by the time anyone reaches it.
Per section, a reader gets the definition next to the number that made
them ask.

### `walkTextNodes(root, callback)`

Walk text nodes, refusing to descend into tooltips we already made.

Rejecting the whole SUBTREE, not each node. A definition is prose and
contains other acronyms — AMI's definition ends "...as calculated by HUD",
so a later pass wrapped HUD inside the AMI popup and produced
"AMIArea Median IncomeThe midpoint ... as calculated by HUDU.S. Department
of Housing and Urban Development...". 41 of those before this filter.

FILTER_REJECT skips the node and everything under it; FILTER_SKIP would
only skip the node itself and keep descending, which is the bug.
