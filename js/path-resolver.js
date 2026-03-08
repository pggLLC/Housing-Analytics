/**
 * js/path-resolver.js
 * Detects the deployment base path reliably for GitHub Pages and custom domains.
 * Sets window.APP_BASE_PATH and window.APP_BASE_URL for use by other scripts.
 *
 * Algorithm (portable, case-preserving):
 *  - On github.io domains: detect the repo sub-path prefix from the first pathname segment.
 *  - On custom domains: always return "/" (no repo prefix applies).
 *  - If the first segment looks like a file (contains a recognised extension), treat as root "/".
 *
 * Works on:
 *  - https://user.github.io/RepoName/page.html  →  /RepoName/
 *  - https://user.github.io/page.html           →  /
 *  - https://custom-domain.com/page.html        →  /
 *  - https://custom-domain.com/admin/page.html  →  /  (NOT /admin/)
 */
(function () {
  'use strict';

  function computeBasePath() {
    var hostname = (window.location && window.location.hostname) ? window.location.hostname : '';
    var pathname = (window.location && window.location.pathname) ? window.location.pathname : '/';

    // Only attempt GitHub Pages repo detection on *.github.io hosts.
    // Custom domains always serve from the root — no repo sub-path prefix applies.
    var isGitHubPages = /\.github\.io$/i.test(hostname);
    if (!isGitHubPages) return '/';

    var parts = pathname.replace(/^\/+/, '').split('/').filter(Boolean);

    // If first segment looks like a file (has a recognised extension), treat as root
    if (!parts.length || /\.\w+$/.test(parts[0])) return '/';

    // GitHub Pages project site: /RepoName/...  (preserve original casing)
    return '/' + parts[0] + '/';
  }

  var basePath = computeBasePath();
  var baseUrl  = window.location.protocol + '//' + window.location.host + basePath;

  window.APP_BASE_PATH = basePath;
  window.APP_BASE_URL  = baseUrl;
  window.__PATH_DEBUG__ = { pathname: window.location.pathname, base: basePath };
})();
