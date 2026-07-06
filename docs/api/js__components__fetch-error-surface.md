# `js/components/fetch-error-surface.js`

fetch-error-surface.js — F249 (P0-2): Surface fetch failures in the UI.

Why this exists
---------------
When an external data fetch fails, users see a blank chart, an empty
table, or a "—". The error goes to the browser console where a
developer would see it, but a casual user has no idea why a number
went missing. The June 2026 reliability audit flagged this as a top
open risk: "failures are silent at the user layer."

This module gives every renderer a standard way to convert an opaque
blank slot into a transparent "we couldn't reach HUD; here's why and
what to do" message. It's intentionally lightweight — just a renderer
that returns HTML, no fetch wrapping or auto-retry. Callers wire it
into their existing .catch() handlers.

Public API
----------
  FetchErrorSurface.render(target, options)
    target: DOM element to populate with the error message
    options:
      - source: human label for the data source ("HUD Fair Market Rent",
        "Novogradac Equity Pricing", "Census ACS"). REQUIRED.
      - url: optional URL the page tried to load (relative to site root)
      - error: the Error or string that surfaced from the fetch
      - lastKnownValue: optional cached value to show as fallback
      - lastKnownDate: optional date string ("2026-05-22") for the
        cached value
      - retryFn: optional function the user can click to retry
      - severity: 'info' | 'warn' | 'error'. Default 'warn'.

  FetchErrorSurface.wrapFetch(fetchPromise, target, options)
    Convenience: returns a Promise that resolves to the fetched JSON
    on success, or renders the error and rejects on failure.

Usage example
-------------
  var target = document.getElementById('yardiNational');
  fetch('data/market/yardi-matrix-national-multifamily.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(j => renderYardi(j))
    .catch(err => FetchErrorSurface.render(target, {
      source: 'Yardi Matrix National Multifamily Report',
      url:    'data/market/yardi-matrix-national-multifamily.json',
      error:  err,
      lastKnownDate: '2026-06-04',
      retryFn: () => initYardi()
    }));

_No documented symbols — module has a file-header comment only._
