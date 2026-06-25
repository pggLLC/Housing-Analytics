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

console.log('Developer brief HNA scoring and summary: PASS');
