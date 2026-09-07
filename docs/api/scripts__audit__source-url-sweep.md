# `scripts/audit/source-url-sweep.mjs`

source-url-sweep.mjs

Verify external source-citation URLs are still reachable.

Scans:
  - DATA-MANIFEST.json
  - js/citations.js
  - root-level *.html href attributes

Exit codes:
  0 => all URLs are OK (or allow-listed / timeout-only outcomes)
  1 => at least one hard failure (404/5xx/network)
  2 => script-level failure

## Symbols

### `RETRY_DELAY_MS`

A single transient outage must not fail an unrelated PR.

The sweep probes ~180 live external URLs. Across that many hosts a
momentary 502 or a dropped connection is routine, and until now one of
them turned the whole run red on a PR that never touched the URL —
#1544 failed on two govinfo.gov 502s and one govtrack.us network error
for a bill its diff does not mention, while the same URLs returned 200
two hours earlier.

So we retry the two outcomes that are genuinely ambiguous — a 5XX and a
network-level failure — once each. A URL that is actually gone fails
both attempts and still blocks CI; a URL that blinked passes on the
second. 404 is not retried (a missing page does not un-miss itself),
and WAF/TIMEOUT already have their own non-blocking buckets.

Allow-listing the flapping hosts would be the wrong fix: they work most
of the time, so suppressing them would hide the day they break for real.
