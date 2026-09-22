// Regression test for the "duplicate developer-context callout" bug: two
// different h2 sections on the SAME generated HNA view resolving to the same
// EXPLAIN key in js/hna/hna-dev-context.js and rendering identical prose.
//
// hna-dev-context.js's _matchKey() does a loose case-insensitive substring
// match (h2 text .includes(key)), so a longer heading whose text happens to
// contain a shorter, unrelated key (e.g. "Age of Housing Stock" containing
// "Housing stock", or "Demographic projections: age pyramid & senior
// pressure" containing "Age pyramid") silently collides with that other
// section's own callout. This test replicates that exact matching logic
// against the real section titles for every generated HNA view and fails if
// two sections on the same page would ever resolve to the same key.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const devContextSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'hna', 'hna-dev-context.js'),
  'utf8'
);
const viewsMapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'hna', 'hna-views.json'), 'utf8')
);

// Extract EXPLAIN keys in declaration order — order matters because
// _matchKey returns the FIRST key whose lowercased text is found.
const keyRe = /^\s*'((?:[^'\\]|\\.)*)':\s*\{/gm;
const keys = [];
let m;
while ((m = keyRe.exec(devContextSrc))) {
  keys.push(m[1].replace(/\\'/g, "'"));
}
assert(keys.length > 10, 'expected to find EXPLAIN keys in hna-dev-context.js, found ' + keys.length);
assert(
  new Set(keys).size === keys.length,
  'duplicate EXPLAIN key names in hna-dev-context.js: ' +
    keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')
);

// Mirrors _matchKey(h2) in js/hna/hna-dev-context.js, operating on a plain
// heading string instead of a DOM node.
function matchKey(headingText) {
  const text = headingText.toLowerCase();
  for (const key of keys) {
    const kl = key.toLowerCase();
    if (text.includes(kl)) return key;
  }
  return null;
}

const sharedTitles = viewsMapping.shared.sections.map((s) => s.title);

let collisions = [];
for (const view of viewsMapping.views) {
  const titles = view.sections.map((s) => s.title).concat(sharedTitles);
  const byKey = new Map();
  for (const title of titles) {
    const key = matchKey(title);
    if (key == null) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(title);
  }
  for (const [key, matchedTitles] of byKey) {
    if (matchedTitles.length > 1) {
      collisions.push(view.slug + ': "' + matchedTitles.join('" and "') + '" both resolve to EXPLAIN["' + key + '"]');
    }
  }
}

assert(
  collisions.length === 0,
  'hna-dev-context.js EXPLAIN key collisions would render duplicate callouts:\n  ' +
    collisions.join('\n  ')
);

console.log('hna-dev-context-collision: PASS — no two sections on any HNA view resolve to the same developer-context callout');
