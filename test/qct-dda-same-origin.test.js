'use strict';

/**
 * Regression: the QCT / DDA statewide backups must be fetched same-origin.
 *
 * The site serves from cohoanalytics.com. Fetching the GitHub Pages copy
 * (the pggllc.github.io Pages origin) is cross-origin, and
 * GitHub Pages sends no Access-Control-Allow-Origin header, so the browser
 * blocks it. Observed live on 2026-09-05:
 *
 *   Access to fetch at '<pages-origin>/Housing-Analytics/data/dda-colorado.json'
 *   from origin 'https://cohoanalytics.com' has been blocked by CORS policy
 *
 * That made the tier unreachable, so the HNA map fell through to the embedded
 * fallback (~42 QCT features) while the full statewide file (224 features) was
 * sitting same-origin at data/qct-colorado.json. QCT status drives LIHTC
 * basis-boost eligibility, so under-reporting it is a correctness problem, not
 * cosmetic.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');

// ── No data fetch may target the GitHub Pages origin ────────────────────────
const crossOriginFetches = [];
const re = /loadJson\(\s*[`'"]([^`'"]+)[`'"]/g;
let m;
while ((m = re.exec(controller)) !== null) {
  if (/^https?:\/\//i.test(m[1])) crossOriginFetches.push(m[1]);
}
const templated = controller.match(/loadJson\(\s*`\$\{[^}]*GITHUB_PAGES_BASE[^}]*\}[^`]*`/g) || [];

assert.deepStrictEqual(
  crossOriginFetches, [],
  `data fetches must be same-origin; absolute URLs found: ${crossOriginFetches.join(', ')}`
);
assert.deepStrictEqual(
  templated, [],
  'no loadJson() call may build its URL from GITHUB_PAGES_BASE — it is cross-origin and CORS-blocked in production'
);

// ── The same-origin files the fallback now depends on must exist ────────────
for (const rel of ['data/qct-colorado.json', 'data/dda-colorado.json']) {
  const p = path.join(ROOT, rel);
  assert(fs.existsSync(p), `${rel} must exist — the tier-3a fallback now reads it same-origin`);
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert(Array.isArray(doc.features), `${rel} must be a FeatureCollection`);
  assert(doc.features.length > 0, `${rel} must not be empty`);
  assert(
    controller.includes(`loadJson('${rel}')`),
    `hna-controller must load ${rel} by relative path`
  );
}

// ── The statewide file must beat the embedded fallback it replaced ──────────
const qct = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/qct-colorado.json'), 'utf8'));
const embeddedQct = (controller.match(/QCT_FALLBACK_CO/g) || []).length;
assert(embeddedQct > 0, 'the embedded fallback is still the last resort and should remain');
assert(
  qct.features.length >= 100,
  `the statewide QCT file should carry the full set, got ${qct.features.length}`
);

console.log(
  `qct-dda-same-origin: PASS (QCT ${qct.features.length} features reachable same-origin; no cross-origin data fetches)`
);
