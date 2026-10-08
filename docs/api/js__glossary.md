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
