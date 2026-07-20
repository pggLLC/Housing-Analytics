# `scripts/discover_agenda_urls.mjs`

discover_agenda_urls.mjs  (F169a, 2026-06-04)

Probes likely council-agenda URL patterns (Civic Plus / Granicus /
custom) for every curated jurisdiction in data/hna/local-resources.json
that still lacks a `council_agenda_url`. For each candidate URL it
issues a HEAD request (with GET fallback), follows redirects, and
accepts 200 / 301 / 302 as a "match".

Output:
  - data/agenda-url-discovery-report.json   (machine-readable)
  - Markdown summary table written to stdout / step summary

Companion to:
  - scripts/discover-local-resources.mjs   (probes top-level city sites)
  - .github/workflows/discover-agenda-urls.yml

The OUTPUT is candidate URLs for human review — never auto-merged into
local-resources.json. Maintainer reviews + PRs.

CLI:
  node scripts/discover_agenda_urls.mjs           # write report
  node scripts/discover_agenda_urls.mjs --dry     # don't write report file
  node scripts/discover_agenda_urls.mjs --limit 20

Exit codes:
  0 — completed (regardless of how many matches found)
  2 — script-level failure

_No documented symbols — module has a file-header comment only._
