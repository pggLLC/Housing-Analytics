# `scripts/audit/inline-heading-typography.mjs`

F124 — inline-heading-typography

Forbid typography overrides (font-size, font-weight, font-family,
line-height, letter-spacing, color, text-wrap) on inline styles of
h1-h4 tags. The global headings live in css/site-theme.css with the
`!important` flag, so any inline override either (a) was always
silently overridden visually (noise), or (b) created cross-page
drift that the design system should own.

Standard pattern:
  <h2>Heading</h2>                        ← ✓ uses global token
  <h2 style="margin-top:var(--sp4);">…</h2>  ← ✓ non-typography props OK
  <h2 style="font-size:1.2rem;">…</h2>    ← ✗ fails — drift risk

Escape hatches in css/site-theme.css if you genuinely need a
different size: `.h-as-h2`, `.h-as-h3`. Use a class, not inline.

Sister gate to scripts/audit/inline-contrast-check.mjs (F122).

_No documented symbols — module has a file-header comment only._
