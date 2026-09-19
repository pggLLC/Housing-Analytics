# `scripts/audit/absence-confident-value-guard.mjs`

Dependency-free source guard for two mechanically decidable ways that
missing data becomes a confident number:

A. global isFinite() applied directly to a property/index read. The global
   function coerces null and the empty string to zero. A narrow companion
   check covers the historical one-line currency-formatter form.
B. global isFinite(Number(...)), where Number() performs the same coercion.
C. a data-keyed map lookup that falls back to a non-zero numeric literal.

This is intentionally not a JavaScript linter. It follows the repository's
readFileSync/source-scan convention and excludes vendor bundles and common
configuration-option identifiers. Every safe match requires an exact,
reasoned allowlist entry below; stale entries fail the check.

_No documented symbols — module has a file-header comment only._
