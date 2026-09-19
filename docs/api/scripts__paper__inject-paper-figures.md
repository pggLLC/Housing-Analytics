# `scripts/paper/inject-paper-figures.mjs`

Write the figures from data/paper/figures.json into working-paper.html.

working-paper.html is a GENERATED file in the same sense as the place pages
and the jurisdiction digests: its prose is authored, its numbers are not.
Editing a number by hand is undone by the next run, and
test/paper-figures-fresh.test.js fails CI when the page and the data disagree.

Two mechanisms:

  data-figure="path.to.value"   replaces that element's text content.
    data-figure-format="comma"   1622  -> "1,622"
    data-figure-format="percent" 0.2   -> "20%"
    data-figure-add="other.path" renders the sum of the two figures

  data-figure-block="name"      replaces that element's inner HTML with a
                                generated block (tables, the commit chart)

A figure that is null in figures.json renders as its stated reason in a
.wp-unknown span — never as 0, never as a blank that reads as nothing to
report. That is the paper obeying the rule it is about.

  node scripts/paper/inject-paper-figures.mjs          # rewrite the page
  node scripts/paper/inject-paper-figures.mjs --check  # exit 1 if it would change

## Symbols

### `at(objPath)`

Resolve "a.b.0.c" against the figures object. Missing path -> undefined.

### `reasonFor(objPath)`

Why a figure is null, as the generator recorded it.

### `closeIndex(source, tag, openEnd)`

Find the index just past the element opened at `openEnd`, counting nesting.

A non-greedy /([\s\S]*?)<\/tag>/ stops at the FIRST closing tag, which for
`<div data-figure-block>` wrapping `<div class="wp-bar-row">` is the inner
one. That made the injector non-idempotent: it produced valid output on a
clean page and mangled it on the second run, so the --check gate reported
STALE immediately after a successful build. Depth counting is the fix.

### `replaceInner(source, attr, produce)`

Replace the inner HTML of every element carrying `attr`, innermost-safe.

Walks left to right and re-scans from just after each replacement's opening
tag, so a marker nested inside another marker is still visited.
