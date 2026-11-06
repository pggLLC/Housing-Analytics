# `scripts/generate-brief-local-support-sections.mjs`

Add or refresh the "Local support for affordable housing" section in the
curated jurisdiction briefs.

The section is written from data/policy/local-support.json (adopted plans,
council and planning-commission votes) plus the incentive records in
data/policy/fee-reductions.json and data/policy/local-housing-funds.json,
scored by js/local-support-data.js — the same module the Opportunity Finder
uses, so the bonus a brief states is the bonus the Finder adds.

Every claim cites a kind='data' source naming the record it comes from;
scripts/validate-jurisdiction-briefs.py checks each one against that record
and its quoted evidence. Hand-written sections are never touched. A brief
whose jurisdiction has no local-support row gets no section (it has not been
checked); test/local-support.test.mjs lists every brief that lacks one.

The evaluation date is local-support.json's meta.as_of, not the clock, so
the output only changes when the data does.

## Symbols

### `fmtDate(date)`

'2025-03-11' → 'March 11, 2025'; '2025-03' → 'March 2025'; '2025' → '2025'.

### `dateLead(date)`

"On March 11, 2025" / "In March 2025" / "In 2025".

### `civicFor(brief, docs)`

The Civic Readiness dimensions the Finder uses for this place: its own scorecard row, else its county's.

### `sectionFor(brief, docs)`

The section and the sources it cites, or null when the jurisdiction has not
been checked. `brief` needs geoid, jurisdiction and scope.

### `applyTo(brief, docs)`

Replace this section and its ls* sources in one brief object; returns it.
