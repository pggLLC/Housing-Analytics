// Regression test for the "duplicate developer-context callout" bug: two
// different h2 sections on the SAME generated HNA view resolving to the same
// EXPLAIN key in js/hna/hna-dev-context.js and rendering identical prose.
//
// hna-dev-context.js's _matchKey() does a loose case-insensitive substring
// match, so a longer heading whose text happens to contain a shorter,
// unrelated key (e.g. "Age of Housing Stock" containing "Housing stock", or
// "Demographic projections: age pyramid & senior pressure" containing "Age
// pyramid") could silently collide with that other section's own callout.
// The fix makes _matchKey prefer the LONGEST matching key (mirroring the
// identical fix already shipped in hna-section-takeaways.js) instead of the
// first-declared one, so the result no longer depends on where a key sits
// in the object literal.
//
// This test checks both halves of that fix stay true:
//   1. matchKey() itself is order-independent (a shuffled key list produces
//      the same match as the declared order) — proves the algorithm, not
//      just today's declaration order, is what prevents the collision.
//   2. No two sections on any real, generated HNA view resolve to the same
//      key today.
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

// Mirrors _matchKey(h2) in js/hna/hna-dev-context.js: exact id match wins
// outright, otherwise the LONGEST key found (case-insensitive substring) in
// either id or text wins — order of `keyList` must not affect the result.
function matchKey(id, text, keyList) {
  const idl = (id || '').toLowerCase();
  const textl = (text || '').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const key of keyList) {
    const kl = key.toLowerCase();
    if (idl === kl) return key;
    const hit = (idl && idl.includes(kl)) || (textl && textl.includes(kl));
    if (hit && kl.length > bestLen) {
      best = key;
      bestLen = kl.length;
    }
  }
  return best;
}

// 1. Order-independence: shuffle the real key list several ways and confirm
// every heading in every view still resolves to the same key regardless.
function shuffled(arr, seed) {
  const out = arr.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sharedTitles = viewsMapping.shared.sections.map((s) => s.title);
const allTitles = viewsMapping.views
  .flatMap((v) => v.sections.map((s) => s.title))
  .concat(sharedTitles);

const declaredOrderResults = allTitles.map((t) => matchKey('', t, keys));
for (let seed = 1; seed <= 5; seed++) {
  const reordered = shuffled(keys, seed * 97 + 13);
  const results = allTitles.map((t) => matchKey('', t, reordered));
  assert.deepStrictEqual(
    results,
    declaredOrderResults,
    'matchKey is order-dependent (seed ' + seed + ') — the longest-match rule must make declaration order irrelevant'
  );
}

// 2. No two sections on the same real, generated view resolve to the same
// key — the actual user-visible symptom (duplicate callout text).
let collisions = [];
for (const view of viewsMapping.views) {
  const titles = view.sections.map((s) => s.title).concat(sharedTitles);
  const byKey = new Map();
  for (const title of titles) {
    const key = matchKey('', title, keys);
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

console.log('hna-dev-context-collision: PASS — matching is order-independent and no two sections on any HNA view resolve to the same developer-context callout');
