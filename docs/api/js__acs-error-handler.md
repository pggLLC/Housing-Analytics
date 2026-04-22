# `js/acs-error-handler.js`

js/acs-error-handler.js

User-facing error messages and data freshness UI indicators for ACS data.

Provides:
  ACSErrorHandler.handleError(context, error, fallback)
    Show an inline warning in a container element and return fallback.

  ACSErrorHandler.showFreshnessIndicator(containerId, freshnessInfo)
    Render a data-timestamp badge inside the specified container.

  ACSErrorHandler.formatFreshnessText(freshnessInfo)
    Return a human-readable freshness string without touching the DOM.

  ACSErrorHandler.clearError(containerId)
    Remove any error/warning element previously injected.

Usage (browser)
---------------
  <script src="js/acs-error-handler.js"></script>

  // On load failure:
  ACSErrorHandler.handleError('hnaACSContainer', err, { DP04_0001E: null });

  // After successful load:
  ACSErrorHandler.showFreshnessIndicator('hnaACSContainer', data._freshness);

_No documented symbols — module has a file-header comment only._
