# `js/funding-fit.js`

funding-fit.js — which programs in the developer funding guide fit a project.

Reads the `fit` tags on each program in data/policy/co-developer-funding-guide.json
(deal type, project type, geography, role). Every tag rests on words quoted in the
program's own record (fit.basis; test/funding-fit.test.js holds that), so this
screens for eligibility and never ranks programs as better or worse.

Used by the Developer Funding tab (colorado-deep-dive.html#tab-funding), the
Opportunity Finder's jurisdiction panel and Compare, so all three agree on what
"fits" means. Exposed as window.FundingFit and module.exports.

## Symbols

### `match(program, q)`

Does one program fit a query?
@param {Object} program  a guide program with a `fit` object
@param {Object} q        { execution (one deal type, or a list meaning "any of these"), projectType,
                           county (5-digit FIPS), place (7-digit GEOID, optional), openOnly, includeSupport }
@returns {{ fits: boolean, notes: string[] }}

### `select(guide, q)`

Programs that fit: open or scheduled first, then the rest; ties keep guide order.

### `guideUrl(q, base)`

The guide link for a query, so another page can open the tab already filtered.
 The tab's finder picks one deal type, so a list ("either credit") is left out of the link.

### `parseQuery(search)`

Read a query back from a URL search string (the inverse of guideUrl).
