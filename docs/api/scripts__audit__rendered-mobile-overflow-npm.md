# `scripts/audit/rendered-mobile-overflow-npm.mjs`

Local convenience wrapper for the rendered mobile overflow smoke.

CI enforcement lives in .github/workflows/site-audit.yml, where Chromium is
installed explicitly before running core-rendered-smoke.mjs. The default
ci-checks chain intentionally avoids browser installation, so this npm
wrapper skips loudly when a local Playwright browser binary is missing.

_No documented symbols — module has a file-header comment only._
