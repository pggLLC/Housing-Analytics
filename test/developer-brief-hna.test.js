#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('developer-brief.html', 'utf8');

assert(html.includes("softJson('data/hna/ranking-index.json')"), 'brief must load the statewide HNA ranking');
assert(html.includes('html += hnaAnalysisSection(hnaRank);'), 'every rendered brief must include HNA analysis');
assert(html.includes('50% deeply affordable unit gap near 30% AMI'), 'brief must explain the score weighting');
assert(html.includes('30% renter cost-burden rate'), 'brief must explain the cost-burden weighting');
assert(html.includes('20% in-commuter pressure'), 'brief must explain the commuter weighting');
assert(html.includes('<strong>Summary analysis:</strong>'), 'brief must include a jurisdiction-specific HNA summary');
assert(html.includes('not a funding award score'), 'brief must distinguish screening from award scoring');
assert(!html.includes('cdola.colorado.gov/private-activity-bonds'),
  'brief must not link the retired DOLA PAB page');
// The PAB link is the data file's own sourceUrl (the page the annual fetch read);
// with no verified DOLA URL the source is marked inactive instead of linked.
const pabMeta = JSON.parse(fs.readFileSync('data/policy/pab-allocations.json', 'utf8')).metadata;
assert.match(pabMeta.sourceUrl, /^https:\/\/doh\.colorado\.gov\//, 'PAB data names its DOLA source page');
assert(html.includes('href="${esc(pabMeta.sourceUrl)}"'), 'brief must link the PAB source the data file was read from');
assert(html.includes('data-source-status="inactive">DOLA PAB direct allocations (source unavailable)'),
  'brief must mark the PAB source inactive when the data names no DOLA page');

console.log('Developer brief HNA scoring and summary: PASS');
