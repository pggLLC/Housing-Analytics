#!/usr/bin/env node
// test/data-trust-center.test.js
//
// Phase 2.1 (docs/audits/CODEX-HANDOFF-AUDIT-PHASE2-2026-07.md): asserts
// data-review-hub.html is consolidated into a "Data Trust Center" with
// Sources / Quality / QA Coverage tabs, that the QA Coverage tab actually
// carries the 5-layer status + place-coverage panels (not just links out),
// that the nav label matches, and that the pre-existing standalone pages
// still exist (this is a consolidation, not a deletion).
//
// Usage: node test/data-trust-center.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const hubHtml = read('data-review-hub.html');
const hubJs = read('js/data-review-hub.js');
const navJs = read('js/navigation.js');
const bannerJs = read('js/data-section-banner.js');

// ── Page identity ────────────────────────────────────────────────────────

assert.match(hubHtml, /<title>Data Trust Center/, 'page title renamed to Data Trust Center');
assert.match(hubHtml, /<h1>Data Trust Center/, 'H1 renamed to Data Trust Center');
assert.match(
  hubHtml,
  /\(formerly Data Review Hub\)/,
  'old name kept visible as a breadcrumb, matching the Coverage QA / Pipeline Status rename convention'
);

// ── QA Coverage tab exists and is real content, not just a link out ────────

assert.match(hubHtml, /data-tab="coverage"/, 'QA Coverage tab button present');
assert.match(hubHtml, /data-panel="coverage"/, 'QA Coverage tab panel present');
assert.match(hubHtml, /id="drhQaLayerGrid"/, '5-layer QA status grid container present');
assert.match(hubHtml, /id="placeChasCoverage"/, 'place-level coverage panel container present');
assert.match(
  hubHtml,
  /<script defer src="js\/place-chas-coverage-panel\.js">/,
  'place-chas-coverage-panel.js is loaded so the coverage panel actually renders'
);

assert.match(
  hubJs,
  /function initQaCoveragePanel/,
  'initQaCoveragePanel is defined (ported 5-layer QA status renderer)'
);
// A plain substring/regex match on "initQaCoveragePanel();" would also match
// a commented-out call (e.g. "// initQaCoveragePanel();"), which proves
// nothing about wiring. Anchor to the exact non-commented call site right
// after initQualityPanel() in init(), and separately assert it isn't commented out.
assert.match(
  hubJs,
  /^\s*initQualityPanel\(\);\s*\n\s*initQaCoveragePanel\(\);/m,
  'initQaCoveragePanel is called immediately after initQualityPanel() in init()'
);
assert(
  !/\/\/\s*initQaCoveragePanel\(\);/.test(hubJs),
  'the initQaCoveragePanel() call is not commented out'
);
assert.match(
  hubJs,
  /fetcher\('data\/_qa-status\.json'\)/,
  'QA coverage panel reads the same data/_qa-status.json the standalone Coverage QA page reads'
);

// ── Sources and Quality tabs still exist (this is additive, not a rewrite) ─

assert.match(hubHtml, /data-tab="sources"/, 'Sources tab still present');
assert.match(hubHtml, /data-tab="quality"/, 'Quality tab still present');

// ── Nav + cross-link banner renamed consistently ────────────────────────────

assert.match(
  navJs,
  /label: "Data Trust Center",\s*href: "data-review-hub\.html"/,
  'top nav "Data" group label renamed to Data Trust Center'
);
assert(!/label: "Data Hub"/.test(navJs), 'old "Data Hub" nav label fully replaced, not left as a second entry');

assert.match(
  bannerJs,
  /label: 'Data Trust Center'/,
  'shared cross-page Data-section banner (js/data-section-banner.js) also renamed'
);

// ── Consolidation, not deletion: legacy standalone pages still exist ────────

for (const legacyPage of ['data-status.html', 'dashboard-data-quality.html', 'dashboard-data-sources-ui.html']) {
  assert(fs.existsSync(path.join(ROOT, legacyPage)), `${legacyPage} still exists standalone (not deleted)`);
}

// data-status.html and dashboard-data-quality.html should still point at the
// hub under its new name, not the stale "Data Hub" label.
const dataStatusHtml = read('data-status.html');
const dqHtml = read('dashboard-data-quality.html');
assert(
  /Data Trust Center/.test(dataStatusHtml),
  'data-status.html cross-links to the renamed Data Trust Center'
);
assert(
  /Data Trust Center/.test(dqHtml),
  'dashboard-data-quality.html cross-links to the renamed Data Trust Center'
);

console.log('Data Trust Center consolidation (Phase 2.1): PASS');
