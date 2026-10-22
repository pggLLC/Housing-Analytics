# `js/components/table-header-tips.js`

table-header-tips.js — a visible, accessible definition for every table
column header on the site.

Why: most headers already carried a native `title` attribute, but a
native title is invisible until the pointer rests on it for a second,
never appears on touch, and gives no hint that a definition exists — so
a header like "NEED PCTL" (the global `table th` rule uppercases labels)
read as jargon with no way in. A header with a definition now gets a
dotted underline on its label (the same signal glossary terms use in body
text); hovering the header or focusing it shows the definition in a
popover, linked with aria-describedby for screen readers. On touch, where
there is no hover, a tap on the label opens it and does not sort — the
sort arrow from table-sort.js is the separate touch target. (Until
2026-10-18 the trigger was a separate circled "i" glyph; paul asked for
the header itself to carry the tip because the glyph read as clutter.)

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
alone. Headers with no text (blank corner cells), or that contain a form
control or a link of their own, are skipped.

_No documented symbols — module has a file-header comment only._
