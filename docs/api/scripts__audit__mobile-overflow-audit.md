# `scripts/audit/mobile-overflow-audit.mjs`

Does the page scroll sideways on a phone?

── Why this exists (#1745) ──

test/mobile-overflow-containment.test.js had 25 assertions, read two
stylesheets, and contained zero references to playwright, getBoundingClientRect,
scrollWidth or offsetWidth. Every assertion was of this shape:

    assert(themeCss.includes('min-width: 0;'), 'badge can shrink ...');

It asserted that CSS SOURCE TEXT contains rules whose purpose is to prevent
overflow. It never measured whether anything overflowed. So it could not see
a rule overridden later in the cascade, an element not on the page at all,
overflow caused by some other rule or container, or overflow on any page it
did not name. Its name — "mobile-overflow-containment" — read as "mobile
overflow is contained" while it meant "four declarations are present in two
files". That file is now named for what it checks; this is the part with eyes.

── What it measures ──

One question, in the user's terms: at phone width, can you scroll the page
sideways? `document.documentElement.scrollWidth > clientWidth` is exactly
that, and it is deterministic — unlike a line-wrap heuristic, there is no
judgement in it, so this gates rather than advises.

A wide table or code block is NOT a defect when it scrolls inside its own
container; that is the intended pattern. It becomes a defect only when it
pushes the document itself. So the page-level question is the assertion, and
the per-element list exists to make a failure actionable rather than to be
asserted on directly.

## Symbols

### `PAGES`

The guided path plus the entry points — the same list text-wrap-audit.mjs
walks, for the same reason recorded there: an earlier list held five pages
and none of them was the homepage, the page every visitor sees.

### `TOLERANCE_PX`

A 1px allowance absorbs sub-pixel rounding at fractional device ratios,
which is not overflow anyone can see or scroll to. Anything above it is a
real sideways scroll.
