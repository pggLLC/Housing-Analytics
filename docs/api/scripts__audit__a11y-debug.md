# `scripts/audit/a11y-debug.mjs`

One-off detail dumper for color-contrast violations — writes axe's computed
fgColor/bgColor/contrastRatio/expectedContrastRatio per node. Use this when
axe flags something the naive token math says should pass (e.g., an
inherited background from a parent overrides the token).

Not wired into CI — run ad-hoc when investigating a remaining violation.
  node scripts/audit/a11y-debug.mjs

_No documented symbols — module has a file-header comment only._
