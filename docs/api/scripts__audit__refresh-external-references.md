# `scripts/audit/refresh-external-references.mjs`

scripts/audit/refresh-external-references.mjs

Refresh the external reference docs mirrored in docs/_external-references/.
Two responsibilities:

  1. **Fetch from upstream directly** with a browser-grade User-Agent so
     we don't depend on Wayback Machine. Several federal data publishers
     (HUD's CDN especially) gate downloads behind a WAF challenge for
     bot User-Agents but accept browser ones. The 2026-05-08 audit found
     the HUD CHAS data dictionary was effectively only fetchable via
     Wayback because the original urllib-based fetch returned HTTP 202
     with empty body. With `Mozilla/5.0 (...) Chrome/...` HUD ships the
     file directly.

  2. **Integrity check** — for each tracked reference, compute SHA-256
     of the upstream copy and compare against the pinned hash in
     `provenance.json`. When upstream ships a corrected version (rare
     but happens), this detects drift within 24 hours of the next cron run.

Behavior modes
--------------
  --check       (default)  fetch upstream, compare SHA-256 to pinned, exit 1 on drift
  --refresh                fetch upstream, replace local copy + provenance.json
  --pin                    fetch upstream, write provenance.json (initial setup)

Output: `docs/_external-references/<file>.provenance.json` per tracked file:
  {
    "source_url":   "...",
    "retrieved_at": "ISO timestamp",
    "sha256":       "...",
    "size_bytes":   N,
    "fetch_method": "https + browser User-Agent",
    "notes":        "..."
  }

Exit codes
----------
  0 — all checks pass (or refresh succeeded)
  1 — at least one reference drifted from pinned hash
  2 — internal error (network, file write)

Usage
-----
  node scripts/audit/refresh-external-references.mjs --check
  node scripts/audit/refresh-external-references.mjs --refresh
  node scripts/audit/refresh-external-references.mjs --pin

## Symbols

### `fetchUpstream(url)`

Fetch a URL with a browser User-Agent. Returns { status, bytes, sha256 }.
Throws on non-2xx response.
