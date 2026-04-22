# `js/components/data-vintage-badge.js`

js/components/data-vintage-badge.js

Auto-renders a "Data as of …" vintage badge on any element marked with
  data-vintage-source="relative/path/to/file.json"
  [data-vintage-sla-days="16"]   (optional; default 30)
  [data-vintage-label="custom prefix"]  (optional; default "Data as of")

Pulls the in-file timestamp field the freshness-check script uses
(updated / generated / generatedAt / metadata.generated / meta.generated)
so the UI signal and the CI signal agree on what "fresh" means.

Switches to a stale-data warning banner appearance when the file's age
exceeds the declared SLA — mirrors the condition under which
data-freshness-check.yml would open a tracking issue. Complements #663
(detector) + #664 (alert issue) with a user-facing signal.

Closes a slice of #659.

Exposes window.DataVintageBadge for imperative use.

## Symbols

### `renderBadge(target, info)`

Render the badge into `target`. If `target` already has one, replace it.
@param {HTMLElement} target
@param {{ updated: string, sla: number, source: string, label: string }} info

### `scan()`

Scan the document for [data-vintage-source] and attach a badge to each.
Safe to call multiple times; each call replaces the existing badge.
