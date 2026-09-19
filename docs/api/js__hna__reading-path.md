# `js/hna/reading-path.js`

The guided reading path.

The assessment runs 54 sections and changes subject 33 times; affordability
alone is split across 8 non-contiguous runs between screens 6 and 42. The
contents rail made that navigable, but navigable is not the same as
coherent — a reader still has to work out for themselves which sections
constitute the argument and in what order.

This is the argument, stated as a route: eight stops running "what exists →
who is priced out → what households earn → is it getting worse → how much is
needed → what to do". It reorders nothing. The sections stay exactly where
they are; the path just says which ones matter and in which order to read
them — the narrative benefit without the regression risk of moving 54
sections past freshness checks, anchors and the PDF export.

The route follows DOCUMENT order. An earlier draft ordered it purely by
argument and sent the reader from screen 20 back to screen 7 between two
consecutive steps; a numbered path that jumps backwards reads as broken, and
a reader may scroll rather than click between stops. followsDocumentOrder()
below caught that, and is kept so a future edit cannot reintroduce it.
Ordering by the page cost nothing in the end — burden following stock
directly is, if anything, tighter than the draft.

Every anchor is one that already exists in the page — 13 headings carry
stable ids and 14 sections do. Nothing here invents an anchor, because an
invented one silently stops matching the first time the markup moves.

Steps whose target is absent or hidden are dropped rather than rendered as
dead links: the county-comparison stop only exists when a place is selected,
and a path that offers a destination the reader cannot reach is worse than a
shorter path.

## Symbols

### `STEPS`

The route. `question` is what the reader is actually asking at that point —
the labels are deliberately questions rather than section titles, because
the section titles are what failed to convey the argument in the first
place.

### `resolve(doc, opts)`

resolve — the steps a reader can actually follow right now.
@param {Document} doc
@param {{steps?: Array}} [opts]
@returns {{steps: Array, dropped: Array}}

### `followsDocumentOrder(doc, steps)`

Reading order must match document order, or the path sends readers
backwards up a page they are scrolling down. The route above was written
to follow the page; this proves it against the real DOM instead of
trusting the author — including future authors.
