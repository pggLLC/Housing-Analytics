const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function assertRedirect(html, target, label) {
  const meta = new RegExp(`<meta[^>]+http-equiv=["']refresh["'][^>]+url=${target}`, 'i');
  const script = new RegExp(`window\\.location\\.replace\\(["']${target}["']\\)`);
  assert(meta.test(html) || script.test(html), `${label} redirects to ${target}`);
  assert(html.includes(`<link rel="canonical" href="${target}">`), `${label} canonical points to ${target}`);
}

const lihtcDashboard = read('LIHTC-dashboard.html');
const complianceDashboard = read('compliance-dashboard.html');
const developerBrief = read('developer-brief.html');
const sitemap = read('sitemap.html');

// The national allocation pages came off the public site on 10-22; their old
// URLs open the Deep Dive's Colorado Snapshot, which carries Colorado's ceiling.
for (const file of ['LIHTC-dashboard.html', 'lihtc-allocations.html', 'state-allocation-map.html', 'dashboard.html', 'regional.html']) {
  const html = read(file);
  assert(/<meta[^>]+http-equiv=["']refresh["'][^>]+url=colorado-deep-dive\.html#tab-state-comparison/i.test(html), `${file} redirects to the Colorado Snapshot`);
  assert(html.includes('<link rel="canonical" href="colorado-deep-dive.html">'), `${file} canonical points to the Deep Dive`);
  assert(!sitemap.includes(`href="${file}"`), `${file} is off the sitemap page`);
}
assertRedirect(complianceDashboard, 'data-review-hub.html', 'compliance-dashboard.html');
assert(lihtcDashboard.includes('<main id="main-content"'), 'LIHTC redirect stub keeps a main landmark');
assert(lihtcDashboard.includes('aria-live="polite"'), 'LIHTC redirect stub keeps an aria-live status region');
assert(complianceDashboard.includes('<main id="main-content"'), 'compliance redirect stub keeps a main landmark');
assert(complianceDashboard.includes('aria-live="polite"'), 'compliance redirect stub keeps an aria-live status region');
assert(/dashboard has been retired/i.test(complianceDashboard), 'retired dashboard note is present');
// This looked for `href="compliance-dashboard.html"`. sitemap.xml contains zero
// href attributes -- entries are absolute <loc> elements -- so the
// assertion could never fail and the retired stub sat in the sitemap regardless.
// Match the URL itself, in any syntax.
assert(!sitemap.includes('compliance-dashboard.html'),
  'retired compliance dashboard is absent from sitemap');

assert(!developerBrief.includes('HOUSING-POLICY-SCORECARD.md'), 'developer brief no longer links to missing scorecard methodology doc');
// The gated pages draw one shared menu (js/whitepaper/developer-nav.js).
const developerNav = read('js/whitepaper/developer-nav.js');
assert(developerBrief.includes('js/whitepaper/developer-nav.js') && developerNav.includes("href: 'developer-where.html'"), 'private developer-where page is reachable from the developer menu on the report page');

const requiredSitemapPages = [
  'compare.html',
  'data-explorer.html',
  'data-map-browser.html',
  'data-review-hub.html',
  'deal-calculator.html',
  'hna-scenario-builder.html',
  'land-value.html',
  'lihtc-opportunity-finder.html',
  'pipeline.html',
  'select-jurisdiction.html',
  'colorado-elections.html',
];

for (const page of requiredSitemapPages) {
  assert(sitemap.includes(`href="${page}"`), `sitemap includes ${page}`);
}

assert(!exists('js/state-allocations-2024.js'), '2024 allocation alias file is deleted');
assert(!exists('js/state-allocations-2025.js'), '2025 allocation alias file is deleted');

const htmlFiles = fs.readdirSync(ROOT).filter((name) => name.endsWith('.html'));
for (const file of htmlFiles) {
  const html = read(file);
  assert(!html.includes('js/state-allocations-2024.js'), `${file} does not import deleted 2024 allocation alias`);
  assert(!html.includes('js/state-allocations-2025.js'), `${file} does not import deleted 2025 allocation alias`);
}

console.log('orphan-nav-cleanup: PASS');
