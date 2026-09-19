# `scripts/audit/url-health-policy.mjs`

## Symbols

### `HEALTHY_STATUSES`

'auth' and 'ratelimit' are recorded, surfaced on the dashboard and kept in
the cache — they are simply not treated as link rot, because in both cases
the server answered. A 401/403 is a live host declining an anonymous
datacenter client, and a 429 is a live host asking us to slow down; neither
means the page is gone.

This also aligns the weekly sweep with repo-link-audit.mjs, which has always
excluded 'auth' from its failure set (see its `failures` filter). The two
audits previously disagreed about whether a 403 was a broken link, and the
weekly one filed issues for URLs the other considered fine — every one of
the five URLs in #1591 was verified live while being reported broken.

### `RETRY_DELAY_MS`

The weekly sweep probes ~1,080 live external URLs from a GitHub Actions
runner and, unlike its sibling source-url-sweep.mjs, had no retry at all:
a single dropped connection or slow response was recorded as a failure.

Retry exactly the outcomes that cannot distinguish "gone" from "blinked" —
a timeout, a 5XX, a network-level error with no HTTP response, and a 429.
A 404 is never retried: a missing page does not un-miss itself.

### `decodeHtmlEntities(value)`

Decode the HTML entities that survive attribute extraction.

### `sanitizeExtractedUrl(raw)`

Turn a raw extraction into the URL it was meant to be, or null when
nothing probe-worthy survives.

### `looksLikeCspValue(line)`

True when a line of documentation is a Content-Security-Policy *value*.
Every URL on such a line is a source-expression, not a fetchable document.
