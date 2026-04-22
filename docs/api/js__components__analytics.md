# `js/components/analytics.js`

analytics.js
ES5 IIFE module — window.CohoAnalytics

Two-tier analytics layer:

  Tier 1 — LOCAL (always on)
    localStorage rolling buffer of 200 events + aggregate counts.
    Useful for debugging a single session: CohoAnalytics.getSummary().
    Cannot answer cross-session questions on its own.

  Tier 2 — REMOTE (opt-in, zero external dependency by default)
    When APP_CONFIG.ANALYTICS_ENDPOINT is set, every event is sent via
    navigator.sendBeacon() as a JSON payload. This enables server-side
    aggregation without blocking page navigation.

    Supported back-ends (configure in js/config.js):
      A) Plausible Analytics (recommended for GitHub Pages — privacy-first,
         no cookies, GDPR-compliant):
           APP_CONFIG.ANALYTICS_PROVIDER  = 'plausible'
           APP_CONFIG.ANALYTICS_DOMAIN    = 'yoursite.github.io'
         → loads Plausible's lightweight script dynamically.

      B) Custom beacon endpoint (any server / Cloudflare Worker / Lambda):
           APP_CONFIG.ANALYTICS_ENDPOINT  = 'https://your-endpoint/collect'
         → sends { event, step, label, url, sid, t } via sendBeacon().

      Neither: module works as a local-only debug helper (original behaviour).

Public API:
  track(eventName, properties)   → void   — record a named event
  trackPageview(stepNum, label)  → void   — record a workflow step visit
  getSummary()                   → object — local debug data for this device
  clearAll()                     → void   — wipe all local analytics data

## Symbols

### `_sendBeacon(endpoint, payload)`

Send event to a custom HTTP endpoint via navigator.sendBeacon().
Fire-and-forget: does not block navigation and does not throw.

### `_plausibleEvent(domain, eventName, props)`

Track a pageview via Plausible's event API (if provider = 'plausible').
Uses Plausible's standard /api/event endpoint.
https://plausible.io/docs/events-api

### `_plausibleLoaded`

Load Plausible's tracking script once (idempotent).

### `_remoteTrack(eventName, payload)`

Route an event to whichever remote back-end (if any) is configured.

### `track(eventName, props)`

Record a named event locally and optionally forward to remote backend.

@param {string} eventName  Short event name, e.g. 'workflow_step_visit'
@param {object} [props]    Key→value properties merged into the event record

### `trackPageview(stepNum, label)`

Record a workflow page visit.

@param {number} stepNum  1–5 workflow step number
@param {string} label    Human-readable step name, e.g. 'market_analysis'

### `getSummary()`

Return a local debug summary (this device/session only).
To see population-level data, configure APP_CONFIG.ANALYTICS_PROVIDER.

@returns {{ counts: object, recent: Array, session: string, note: string }}

### `clearAll()`

Erase all locally stored analytics data.
