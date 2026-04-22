# `js/path-resolver.js`

js/path-resolver.js
Detects the deployment base path reliably for GitHub Pages and custom domains.
Sets window.APP_BASE_PATH and window.APP_BASE_URL for use by other scripts.

Algorithm (portable, case-preserving):
 - On github.io domains: detect the repo sub-path prefix from the first pathname segment.
 - On custom domains: always return "/" (no repo prefix applies).
 - If the first segment looks like a file (contains a recognised extension), treat as root "/".

Works on:
 - https://user.github.io/RepoName/page.html  →  /RepoName/
 - https://user.github.io/page.html           →  /
 - https://custom-domain.com/page.html        →  /
 - https://custom-domain.com/admin/page.html  →  /  (NOT /admin/)

_No documented symbols — module has a file-header comment only._
