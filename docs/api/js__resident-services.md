# `js/resident-services.js`

js/resident-services.js
Renders the data-driven parts of resident-services.html from
data/policy/resident-services.json: the evidence cards, the CHFA QAP
requirements, who pays, what services cost, and which 2026 Round One
awards describe services. Every figure on those cards comes from the file,
and each record shows its source and, once it falls due, a re-check warning.
The narrative around them is static HTML in the page.

## Symbols

### `joinAwards(doc, awardsDoc)`

Pure: join the curated award notes to the award file, by name. A note
whose award is missing from the file is dropped and counted, never drawn
from the note alone.
