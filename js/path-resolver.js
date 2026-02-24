/**
 * js/path-resolver.js
 * Detects the deployment base path reliably for GitHub Pages and custom domains.
 * Sets window.APP_BASE_PATH and window.APP_BASE_URL for use by other scripts.
 *
 * Priority:
 *  1. If the pathname contains "/housing-analytics/", use that prefix.
 *  2. Otherwise infer the first path segment dynamically (GitHub Pages repo-name sub-path).
 *  3. Otherwise fall back to "/" (custom domain or root deployment).
 */
(function () {
  'use strict';

  var pathname = window.location.pathname || '/';

  function detectBasePath() {
    // Explicit known sub-path (case-insensitive check)
    if (/\/housing-analytics\//i.test(pathname)) {
      return '/housing-analytics/';
    }

    // GitHub Pages pattern: /<repo-name>/<page>.html  →  /<repo-name>/
    // Detect by checking if the first path segment looks like a repo sub-path
    // (i.e. not "/" and the pathname has at least 2 segments).
    var parts = pathname.replace(/^\//, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[0] !== '') {
      // Heuristic: if the first segment contains no dot (not a file), treat as base
      if (parts[0].indexOf('.') === -1) {
        return '/' + parts[0] + '/';
      }
    }

    // Root deployment (custom domain or Pages root)
    return '/';
  }

  var basePath = detectBasePath();
  var baseUrl  = window.location.protocol + '//' + window.location.host + basePath;

  window.APP_BASE_PATH = basePath;
  window.APP_BASE_URL  = baseUrl;
})();
