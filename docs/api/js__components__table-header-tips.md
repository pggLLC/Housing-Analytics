# `js/components/table-header-tips.js`

table-header-tips.js — a visible, accessible definition for every table
column header on the site.

Why: most headers already carried a native `title` attribute, but a
native title is invisible until the pointer rests on it for a second,
never appears on touch, and gives no hint that a definition exists — so
a header like "NEED PCTL" (the global `table th` rule uppercases labels)
read as jargon with no way in. Every <th> now gets a small "?" control;
hover, focus or tap shows the definition in a popover, and the popover
is linked to the header with aria-describedby for screen readers.

Where the text comes from, in order:
  1. the header's own `title` attribute (moved to data-tip so the native
     tooltip does not double up with the popover)
  2. a `data-tip` attribute set by the page or renderer
  3. data/table-header-tips.json — definitions keyed by the header's
     normalized text, for static headers nobody hand-annotated

Runs once on load and again whenever a table is inserted or re-rendered
(MutationObserver), so JS-built tables (ranking index, county comparison,
projections, deal calculator) are covered without each renderer knowing
this exists. Idempotent: a header that already has its control is left
alone. Headers with no text (blank corner cells) or that contain a form
control are skipped.

_No documented symbols — module has a file-header comment only._
