# `scripts/audit/lib/serve-root.mjs`

A minimal static server over a directory, like GitHub Pages serves this
repository. Used by the browser audits so pages load their data the way a
visitor's browser does.

Opening pages as file:// URLs looks equivalent and is not: every fetch() of
a data file fails, so maps, tables and charts never render and an audit
inspects an empty shell. The axe audit reported 0 violations on
hna-what-housing-exists.html from April to October 2026 that way, while the
live page drew 926 map markers with no accessible name.

Port 0 lets the OS choose a free port, so an audit never collides with a
preview server already listening on 8765.

## Symbols

### `serveRoot(root)`

Resolves to { origin, close() }.
