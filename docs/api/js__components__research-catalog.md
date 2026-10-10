# `js/components/research-catalog.js`

js/components/research-catalog.js
One list of research and analysis, for two places.

insights.html (Research & Analysis) and the "Latest research" panel on
policy-briefs.html (Housing News) used to keep separate lists that did not
overlap: the page listed articles, the panel listed curated briefs, and
neither showed the other's. Both now read:
  - data/insights/catalog.json: every page the hub lists, with how it is
    kept current (its `maintenance`);
  - data/policy_briefs_curated.json: the curated research briefs.
test/research-catalog.test.mjs renders both pages and checks they agree.

A "reviewed" item does not carry its own dates. Its review_from names the
data file that does (the tax-credit watchlist, the homebuyer program list,
the pricing benchmarks), so a check date lives in one place.

_No documented symbols — module has a file-header comment only._
