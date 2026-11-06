# `js/components/jurisdiction-brief.js`

js/components/jurisdiction-brief.js

Renders a curated jurisdictional housing-history brief from
data/jurisdiction-briefs/<geoid>.json. Falls back to the containing
county's brief when no place-level brief exists. When no brief is on
file at all, the mount stays hidden (caller can hide its parent card).

Usage:
  JurisdictionBrief.attach(container, {
    placeGeoid: '0812045',         // optional 7-digit
    countyFips: '08097',           // optional 5-digit (fallback)
    onMissing: () => mount.hide()  // optional: called when no brief found
  });

Curation/QA rules (see data/jurisdiction-briefs/README.md):
  - Single-jurisdiction scope per brief
  - Every paragraph either carries `cites` or `needs_source: true`
  - Sources start with `s` ids and resolve to durable URLs
  - Coalition / regional sections (id startsWith 'coalition-' or
    'regional-') get a visual distinction so users understand the
    scope shift.

## Symbols

### `_loadBrief(placeGeoid, countyFips)`

Load the brief for the placeGeoid, falling back to countyFips when
the place has no brief on file. Returns the brief object or null.

### `_renderNews(brief, queue, now)`

The news panel for one brief, from the queue file. `queue` null means the
file could not be loaded; that is said, not shown as "no news".

### `_renderActivity(geoid, label, data)`

Who has applied for Housing Tax Credits in this jurisdiction, from
CHFA's applicant reports, and what became of each application. `data`
null means the file could not be loaded; that is said, not shown as
"no applications". A 7-digit geoid matches by place, a 5-digit one by
county; a scattered-site application shows in every place it builds in.
