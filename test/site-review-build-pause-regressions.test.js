#!/usr/bin/env node
// Guards for the 2026-07-20 build-pause M2/M4/M3 review findings.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function assertIncludes(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message);
}

const census = read('census-dashboard.html');
assertIncludes(census, '.mf-stat__label {\n        font-size: 0.78rem;\n        color: var(--faint);', 'census multifamily stat labels use an explicit accessible text token');
assertIncludes(census, '.mf-stat__value {\n        font-size: 1.45rem;\n        font-weight: 700;\n        margin-top: 2px;\n        color: var(--text-strong);', 'census multifamily stat values use text-strong');
assert.doesNotMatch(census, /\.mf-stat__(?:label|sub)\s*\{[^}]*opacity\s*:/s, 'census multifamily stat text no longer relies on opacity-thinned inherited color');

const economic = read('economic-dashboard.html');
assert.doesNotMatch(economic, /id="yardiNational"[^>]*color:var\(--muted\)/, 'Yardi national callout is not muted in light mode');
assertIncludes(economic, "m.asking_rent_yoy_pct < 1 ? '#92400e'", 'Yardi low-growth warning color is the accessible light-mode brown');

const insights = read('insights.html');
assert.doesNotMatch(insights, /id="jchsCoNarrative"[^>]*color:var\(--muted\)/, 'JCHS narrative block is not muted in light mode');

const complianceCss = read('css/pages/compliance-dashboard.css');
assertIncludes(complianceCss, '.cd-kpi-yellow .cd-kpi-value { color: #92400e; }', 'compliance KPI warning values use accessible light-mode color');
assertIncludes(complianceCss, '.cd-kpi-red    .cd-kpi-value { color: #b91c1c; }', 'compliance KPI red values use accessible light-mode color');
assertIncludes(complianceCss, '.cd-kpi-green  .cd-kpi-value { color: #047857; }', 'compliance KPI green values use accessible light-mode color');

const pagesCss = read('css/pages.css');
assertIncludes(pagesCss, 'background: #e6f3f1;', 'shared kicker uses a solid light-mode background axe can resolve');
assertIncludes(pagesCss, '.tag-green  { background: #e6f4ee;            color: #065f46       !important; }', 'shared tag-green uses solid accessible light-mode colors');

const hnaRenderers = read('js/hna/hna-renderers.js');
assertIncludes(hnaRenderers, 'background:rgba(var(--bg-rgb,255,255,255),0.92)', 'HNA chart loading overlay uses a high-opacity backdrop');
assertIncludes(hnaRenderers, 'color:var(--text-strong);font-weight:600', 'HNA chart loading overlay text is high contrast');

const siteTheme = read('css/site-theme.css');
assertIncludes(siteTheme, '.leaflet-control-zoom a, .leaflet-control-zoom a:hover { background: var(--card) !important; color: var(--text-strong) !important;', 'Leaflet zoom controls use text-strong on card');
assert.match(siteTheme, /\.leaflet-tooltip,[\s\S]*?\.leaflet-bar a\s*\{[\s\S]*?color: var\(--text-strong\) !important;/, 'Leaflet generic controls use text-strong on card');
assertIncludes(siteTheme, '.tag.tag-green { background: #e6f4ee; color: #065f46 !important; }', 'shared green tags use an accessible light-mode color');
assertIncludes(siteTheme, 'html.dark-mode .kicker { color: var(--accent) !important; }', 'kickers retain an explicit dark-mode color');

const fetchErrorSurface = read('js/components/fetch-error-surface.js');
assertIncludes(fetchErrorSurface, "warn:  { bg: 'var(--warn-dim,#3f2a1a)',  fg: 'var(--warn,#fbbf24)'", 'fetch-error raw links use theme-aware warning foreground');

const hca = read('hna-comparative-analysis.html');
assertIncludes(hca, '.hca-explore-banner__link{font-size:.82rem;font-weight:700;color:var(--text-strong) !important;', 'HCA explore banner link uses text-strong on tinted banner');

const contrastGuard = read('js/contrast-guard.js');
assertIncludes(contrastGuard, '.kicker, .tag, .chart-source, .chart-source *, .fes-error, .fes-error *', 'contrast guard leaves explicitly theme-styled kicker/tag/source/error badges alone');

const legislationDom = new JSDOM(read('housing-legislation-2026.html'));
const watchlist = legislationDom.window.document.getElementById('bill-status-cards');
assert.equal(watchlist.getAttribute('role'), 'list', 'watchlist container remains a role=list');
assert.ok(Array.from(watchlist.children).every((child) => child.getAttribute('role') === 'listitem'), 'watchlist placeholder satisfies aria-required-children before hydration');

const privateRuntimePaths = [
  'DATA-MANIFEST.json',
  'data/audit/quarantine-candidates.json',
  'config/data-discovery-config.json'
];
for (const rel of ['js/discovery-ui-handler.js', 'js/data-source-discovery.js', 'js/data-freshness-monitor.js']) {
  const src = read(rel);
  for (const privatePath of privateRuntimePaths) {
    assert.ok(!src.includes(privatePath), `${rel} does not request maintainer-only ${privatePath}`);
  }
}

const hub = read('data-review-hub.html');
assert.ok(!/href="(?:DATA-MANIFEST\.json|config\/data-discovery-config\.json)"/.test(hub), 'Data Trust Center public HTML does not link stripped maintainer-only artifacts');

const buildScript = read('scripts/build-public-site.mjs');
assert.ok(!/SERVED_LINK_GUARD_EXEMPT_PATHS[\s\S]*?DATA-MANIFEST\.json/.test(buildScript), 'public build served-link guard does not exempt DATA-MANIFEST.json');
assert.ok(!/SERVED_LINK_GUARD_EXEMPT_PATHS[\s\S]*?data-discovery-config\.json/.test(buildScript), 'public build served-link guard does not exempt discovery config');

console.log('Build-pause M2/M4/M3 regression guards: PASS');
