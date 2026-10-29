# `scripts/sync-site-figures.mjs`

Keep every hard-coded copy of a tracked figure on the site equal to the
data file it comes from.

Figures such as the Novogradac equity price, the federal credit ceiling,
the Prop 123 fund estimate and the 2027 Round One dates are written into
page prose, callout text and script fallbacks. Each copy is listed in RULES
with the source figure it must show; a data refresh then rewrites them all:

  node scripts/sync-site-figures.mjs           # rewrite copies from the data
  node scripts/sync-site-figures.mjs --check   # exit 1 on any mismatch

test/site-figures-sync.test.mjs runs the check, and also fails when one of
these figures is typed into a page or script outside a rule, so a new copy
has to be added here (or read from the data at runtime) to land.

Same approach as scripts/sync-hud-vintage-labels.mjs. Dossiers and the
working paper are dated documents and are not covered.

## Symbols

### `readFigures(root = ROOT)`

The value each copy must show, read from the data it comes from.

### `formatFigure(key, F)`

The text a figure is written as on the page.

### `plan(F, read = (rel)`

Every copy that disagrees with its figure, each file's corrected text, and
the character spans the rules cover (for the stray-copy scan).

### `longDate(iso)`

2026-12-01 → "December 1, 2026".
