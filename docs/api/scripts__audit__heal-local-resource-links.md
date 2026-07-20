# `scripts/audit/heal-local-resource-links.mjs`

heal-local-resource-links.mjs — replace broken local-resources URLs with
durable jurisdiction-name Google searches.

Why: data/hna/local-resources.json carries housing-authority / lead /
advocacy / plan / contact URLs per jurisdiction. Many were hand-typed
CivicPlus page IDs that get reassigned over time, so links rot to the
wrong page or a 404. A `google.com/search?q="<name>" Colorado` link
always lands on the current correct page and never rots. F35 healed 185
broken links to searches; this script makes that a re-runnable maintenance
task — run it after a new local-resources entry batch, or quarterly.

Detection (a URL is "broken" only when high-confidence wrong):
  - HTTP 404 / 410 / 5xx after one retry, OR
  - 2xx that redirects to the site homepage when the original wasn't root, OR
  - 2xx CivicPlus-style URL (/digits/Slug) whose final path differs from the
    requested path (CMS page-ID reassigned), OR
  - fetch failure twice AND DNS lookup of the hostname fails (true dead
    domain — guards against transient TLS / bot-block false positives).

401/403/405/406/429/436 are KEPT (bot-block; live for humans).
Timeouts (AbortError) are KEPT (uncertain; don't destroy a maybe-good link).

Usage:
  node scripts/audit/heal-local-resource-links.mjs            # apply heal in place
  node scripts/audit/heal-local-resource-links.mjs --dry-run  # report only, no write

Exit codes:
  0  always (informational tool)

_No documented symbols — module has a file-header comment only._
