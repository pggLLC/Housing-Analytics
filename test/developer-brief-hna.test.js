#!/usr/bin/env node
'use strict';

// developer-brief.html is the Jurisdiction Report: it renders the document built by
// js/whitepaper/jurisdiction-whitepaper.js and adds the working tools beside it.
// The need, score and bond-allocation content it used to carry inline now lives in
// that module, where test/jurisdiction-whitepaper.test.mjs checks each figure
// against its file. This test pins the page to the module, so the two cannot split
// into separate documents again.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('developer-brief.html', 'utf8');
const WP = require('../js/whitepaper/jurisdiction-whitepaper.js');

assert.equal(WP.sourcePath('rankingIndex'), 'data/hna/ranking-index.json', 'the report reads the statewide HNA ranking');
assert(html.includes('<script src="js/whitepaper/jurisdiction-whitepaper.js"></script>'), 'the page loads the report module');
assert(/WP\.sourcePath\(k\)/.test(html) && /Object\.keys\(WP\.SOURCE_FILES\)/.test(html), 'the page loads every file the module lists');
assert(/WP\.renderHtml\(model\)/.test(html) && /frame\.srcdoc = html/.test(html), 'the page shows the module\'s document, not its own copy');
assert(/WP\.summaryPath\(geoid\)/.test(html), 'the page loads the ACS profile for the community section');
// The page draws no need, rent or demographic figures of its own.
for (const gone of ['demographicsSection', 'hnaAnalysisSection', 'marketRentsSection', 'captureSection', 'civicSection', 'fundingSection(']) {
  assert(!html.includes(gone), `the page no longer renders ${gone} itself`);
}
assert(!html.includes('cdola.colorado.gov/private-activity-bonds'), 'the report must not link the retired DOLA PAB page');
// Working tools stay on screen only.
assert(/@media print \{[^}]*\.ib-tools/.test(html), 'working tools never print');
assert(html.indexOf("let page = '<iframe id=\"reportFrame\"") > -1 && html.indexOf("let page = '<iframe id=\"reportFrame\"") < html.indexOf('headerSection(name, geoid, pipe) +'), 'the report comes before the working tools');

console.log('Developer brief (Jurisdiction Report) wiring: PASS');
