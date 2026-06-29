# `js/components/report-stale-link.js`

report-stale-link.js  (F14, 2026-05-26)

Renders a small "⚠ report stale" inline link next to any external URL
the user might encounter (housing-lead contact, housing-plan PDF,
advocacy org website, etc.). Clicking it opens a pre-filled GitHub
issue so users help maintain freshness without leaving the site.

Companion to scripts/audit/url-health-sweep.mjs (the machine-driven
weekly monitor) — together they form the "machines monitor + users
report" freshness loop.

Usage:
  ReportStaleLink.build({
    url: 'https://bouldercolorado.gov/planning/...',
    label: 'Boulder Valley Comprehensive Plan',
    context: 'place:0807850 housingPlans[0]'   // optional, included in issue body
  })
  // → returns HTML string for an inline span. Insert via .innerHTML +=.

  ReportStaleLink.verifiedBadge({
    url: 'https://...',
    healthCache: window.__urlHealth   // optional, see _loadHealthCache
  })
  // → "verified 2026-05-26" span when the cache says the URL is OK,
    null otherwise. Pulls from data/url-health.json fetched on demand.

_No documented symbols — module has a file-header comment only._
