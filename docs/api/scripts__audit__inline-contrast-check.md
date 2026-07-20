# `scripts/audit/inline-contrast-check.mjs`

F122 + F127 — accent-contrast check

Forbids any rule (CSS class OR inline HTML style OR JS template string)
that pairs `background:var(--accent…)` with a text color OTHER than the
paired `var(--on-accent…)` token. The dark-mode `--accent` is bright cyan
#0fd4cf, and white/#fff/card text on it scores 1.7:1 — a hard WCAG fail.
F127 expanded the gate to also catch the CSS-class variant where
`color: var(--card)` is used (which works in light mode but breaks dark
mode because dark `--card` is similar to dark `--accent`).

Static gates this complements:
  - test:pill-contrast (predefined badge classes, light + dark)
  - test:inline-heading-typography (h1-h4 inline overrides)
  - js/contrast-guard.js (runtime safety net, theme-aware)

Pattern (any of these in same style attr / CSS rule body / JS string):
  background: var(--accent[…])
  color:      #fff | #ffffff | white | rgb(255,255,255)
              | var(--card[…]) | var(--text[…]) | var(--text-strong[…])

Acceptable colors on var(--accent) background:
  var(--on-accent[, fallback])  ← THE canonical paired token
  var(--bg) or var(--bg2)       ← (rare; explicit dark background)
  var(--text-d) | var(--text-l) ← (contrast-guard-style explicit pairs)

Fix: replace bad color with `color: var(--on-accent, #fff)` (CSS / inline)
or `color: var(--on-accent, #fff) !important` (CSS classes overriding the
global `a` link color via !important).

_No documented symbols — module has a file-header comment only._
