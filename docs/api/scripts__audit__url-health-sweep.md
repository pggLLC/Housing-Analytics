# `scripts/audit/url-health-sweep.mjs`

url-health-sweep.mjs  (F14, 2026-05-26)

Periodic URL health monitor. Distinct from `source-url-sweep.mjs` which
is a PR-time blocking check over changed files; this one runs on a cron,
sweeps ALL external URLs in the repo, and maintains a persistent
`data/url-health.json` cache used both for:

  1. Browser display — OF / Compare / HNA pages can show "verified
     YYYY-MM-DD" next to external resource links so users know the
     data is current.
  2. Weekly issue filing — diff vs. last sweep surfaces newly-broken
     URLs as a single GitHub issue for maintainer triage.

Scans:
  - data/hna/local-resources.json (every URL field)
  - data/policy/*.json
  - All root-level *.html (anchor hrefs)
  - docs/**\/*.md (markdown URL references)

Cache shape (data/url-health.json):
  {
    "lastSweepAt": "2026-05-26T...",
    "urlCount": 234,
    "byUrl": {
      "https://example.com/...": {
        "status": "ok" | "broken" | "auth" | "timeout" | "allow",
        "httpStatus": 200,
        "lastCheckedAt": "2026-05-26T...",
        "lastOkAt":       "2026-05-26T...",   // preserved if status !== ok
        "firstSeenAt":    "2026-05-26T...",   // preserved across sweeps
        "redirectTo":     "https://...",      // when applicable
        "consecutiveFailures": 0
      }
    }
  }

CLI:
  node scripts/audit/url-health-sweep.mjs                 # full sweep + write cache
  node scripts/audit/url-health-sweep.mjs --diff-only     # print newly-broken since last sweep
  node scripts/audit/url-health-sweep.mjs --dry-run       # probe + report, don't write cache

Exit codes:
  0 — sweep completed (regardless of how many URLs failed)
  2 — script-level failure (filesystem error, etc.)

_No documented symbols — module has a file-header comment only._
