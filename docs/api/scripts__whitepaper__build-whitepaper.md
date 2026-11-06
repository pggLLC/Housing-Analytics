# `scripts/whitepaper/build-whitepaper.mjs`

build-whitepaper.mjs — write the white paper for one jurisdiction.

  node scripts/whitepaper/build-whitepaper.mjs <geoid|name> [--out dir] [--pdf] [--today YYYY-MM-DD]
  node scripts/whitepaper/build-whitepaper.mjs --all [--out dir]

--all writes every jurisdiction in the ranking index (546) plus index.html, a list
of them with the date built, so the gated site can carry a ready-made report for
every town and county. It is rebuilt from the current data on each deploy.

Reads the same files the gated page (developer-whitepaper.html) fetches, through
js/whitepaper/jurisdiction-whitepaper.js, and writes <geoid>-<slug>.html (and .pdf
with --pdf, which needs Playwright). Output defaults to dist-whitepapers/, which is
gitignored: the white papers are for sharing, not for the repo or the public site.

_No documented symbols — module has a file-header comment only._
