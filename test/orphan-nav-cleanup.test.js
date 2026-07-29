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
const allocations = read('lihtc-allocations.html');
const sitemap = read('sitemap.html');

assertRedirect(lihtcDashboard, 'lihtc-allocations.html', 'LIHTC-dashboard.html');
assertRedirect(complianceDashboard, 'data-review-hub.html', 'compliance-dashboard.html');
assert(lihtcDashboard.includes('<main id="main-content"'), 'LIHTC redirect stub keeps a main landmark');
assert(lihtcDashboard.includes('aria-live="polite"'), 'LIHTC redirect stub keeps an aria-live status region');
assert(complianceDashboard.includes('<main id="main-content"'), 'compliance redirect stub keeps a main landmark');
assert(complianceDashboard.includes('aria-live="polite"'), 'compliance redirect stub keeps an aria-live status region');
assert(/dashboard has been retired/i.test(complianceDashboard), 'retired dashboard note is present');
assert(!sitemap.includes('href="compliance-dashboard.html"'), 'retired compliance dashboard is absent from sitemap');

assert(!developerBrief.includes('HOUSING-POLICY-SCORECARD.md'), 'developer brief no longer links to missing scorecard methodology doc');
assert(developerBrief.includes('href="developer-where.html"'), 'private developer-where page is reachable from developer brief nav');

const requiredSitemapPages = [
  'compare.html',
  'data-explorer.html',
  'data-map-browser.html',
  'data-review-hub.html',
  'deal-calculator.html',
  'historical-trends.html',
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

const yearSelectMatch = allocations.match(/<select id="year-select"[\s\S]*?<\/select>/);
const stateMapYearSelectMatch = allocations.match(/<select id="sam-year-select"[\s\S]*?<\/select>/);
assert(yearSelectMatch, 'lihtc-allocations year-select exists');
assert(stateMapYearSelectMatch, 'lihtc-allocations sam-year-select exists');
for (const block of [yearSelectMatch[0], stateMapYearSelectMatch[0]]) {
  assert(!/value="2025"/.test(block), 'allocation year selector does not expose 2025 alias');
  assert(!/value="2024"/.test(block), 'allocation year selector does not expose 2024 alias');
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
