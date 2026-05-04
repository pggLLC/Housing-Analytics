# `scripts/audit/site-audit.mjs`

site-audit.mjs
Playwright-based site audit runner.

Usage:
  AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/site-audit.mjs

Options (env vars):
  AUDIT_BASE_URL   Base URL of the running static server (default: http://127.0.0.1:8080)
  PAGE_TIMEOUT_MS  Per-page navigation timeout in ms (default: 60000)

Outputs JSON + HTML reports to audit-report/{timestamp}/
Exits non-zero only for hard failures:
  - JS runtime errors
  - Missing local data files (4xx on local requests)
  - ArcGIS failures (5xx or network error on map service URLs)

TIGERweb (tigerweb.geo.census.gov) requests are intercepted and mocked
to prevent CI failures caused by external service unavailability.

## Symbols

### `mockTigerwebResponse(url)`

Returns a minimal mock response body for a TIGERweb ArcGIS REST request.
Handles both GeoJSON (f=geojson) and ArcGIS JSON (f=json) formats, as well
as service-info requests (no /query path segment).

### `mockChfaLihtcResponse(url)`

Returns a minimal mock response body for a CHFA LIHTC ArcGIS REST request.
Handles the /layers service-info endpoint as well as /query endpoints in
both GeoJSON (f=geojson) and ArcGIS JSON (f=json) formats.
