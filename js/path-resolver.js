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
// A written guide opens in the new format (2026-11-13): policy-hub.html draws it
// from the words on the guide's own page, which stay in that file and are still
// edited there. This is the first script each of those pages loads, so a
// visitor is sent on before the page paints. A section link (#id) goes with
// it. The hub reads a guide page inside a frame, and ?classic=1 shows the page
// as written (audits use it); neither is forwarded.
// test/guides-open-in-hub.test.mjs holds this list and the hub's in agreement.
(function () {
  'use strict';
  var GUIDE_PAGES = {
    'lihtc-guide-for-stakeholders.html': 'lihtc-basics',
    'affordable-deal-team.html': 'deal-team',
    'green-building-guide.html': 'green-building',
    'resident-services.html': 'resident-services',
    'cra-expansion-analysis.html': 'cra-pricing',
    'lihtc-enhancement-ahcia.html': 'ahcia',
    'article-fair-housing-rollback.html': 'fair-housing',
    'article-federal-rule-changes.html': 'federal-rules',
    'housing-authority-guide.html': 'housing-authority',
    'apa-white-paper.html': 'white-paper',
    'working-paper.html': 'working-paper',
    'methods.html': 'methods',
    'about.html': 'about'
  };
  try {
    var loc = window.location;
    var file = String(loc.pathname || '').split('/').pop();
    if (!Object.prototype.hasOwnProperty.call(GUIDE_PAGES, file)) return;
    var slug = GUIDE_PAGES[file];
    if (window.top !== window.self || /[?&]classic(=|&|$)/.test(loc.search || '')) return;
    var at = String(loc.hash || '').slice(1);
    loc.replace('policy-hub.html#/guide/' + slug + (/^[A-Za-z0-9_-]{1,80}$/.test(at) ? '?at=' + at : ''));
  } catch (e) { /* the page stays as written */ }
})();

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
