/**
 * js/path-resolver.js
 * Detects the deployment base path reliably for GitHub Pages and custom domains.
 * Sets window.APP_BASE_PATH and window.APP_BASE_URL for use by other scripts.
 *
 * Algorithm (portable, case-preserving):
 *  - Take the actual pathname as-is (no case normalisation, no hardcoded repo names).
 *  - Strip the leading slash and split on "/".
 *  - If the first segment looks like a file (contains ".") or is absent, treat as root "/".
 *  - Otherwise the first segment is the GitHub Pages repo sub-path prefix.
 *
 * Works on:
 *  - https://user.github.io/RepoName/page.html  →  /RepoName/
 *  - https://user.github.io/page.html           →  /
 *  - https://custom-domain.com/page.html        →  /
 */
(function () {
  'use strict';

  function computeBasePath() {
    var pathname = (window.location && window.location.pathname) ? window.location.pathname : '/';
    var parts = pathname.replace(/^\/+/, '').split('/').filter(Boolean);

    // If first segment looks like a file (contains '.'), treat as root
    if (!parts.length || parts[0].indexOf('.') !== -1) return '/';

    // GitHub Pages project site: /RepoName/...  (preserve original casing)
    return '/' + parts[0] + '/';
  }

  var basePath = computeBasePath();
  var baseUrl  = window.location.protocol + '//' + window.location.host + basePath;

  window.APP_BASE_PATH = basePath;
  window.APP_BASE_URL  = baseUrl;
  window.__PATH_DEBUG__ = { pathname: window.location.pathname, base: basePath };
})();
