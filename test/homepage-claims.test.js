#!/usr/bin/env node
// test/homepage-claims.test.js
//
// Metric-trust Package D: homepage public-claim accuracy guard.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const indexJs = fs.readFileSync(path.join(ROOT, 'js', 'index.js'), 'utf8');

function htmlBlock(startNeedle, endNeedle) {
  const start = index.indexOf(startNeedle);
  assert.notEqual(start, -1, `index.html must include ${startNeedle}`);
  const end = index.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `index.html must include ${endNeedle} after ${startNeedle}`);
  return index.slice(start, end);
}

assert(!index.includes('Educational Guide'), 'homepage must not describe itself as an Educational Guide');

for (const banned of [
  'quarter-million',
  'quarter\u2011million',
  'quarter&#8209;million',
  '250,000'
]) {
  assert(!index.includes(banned), `homepage must not contain unsupported shortage claim: ${banned}`);
}

assert(index.includes('id="snapHouseholds"'), 'statewide household-count card must include #snapHouseholds');
assert(
  index.includes('CO Households (total)') && index.includes('data/hna/summary/08.json') && index.includes('ACS DP02_0001E'),
  'statewide household-count card must disclose the statewide ACS summary source'
);
assert(
  indexJs.includes("DS.baseData('hna/summary/08.json')") &&
  indexJs.includes('DP02_0001E') &&
  indexJs.includes("setText('snapHouseholds'"),
  'js/index.js must fetch statewide households from data/hna/summary/08.json acsProfile.DP02_0001E'
);

const lead = htmlBlock('<p class="home-opening__lead">', '</p>');
assert(
  lead.includes('roughly half of renters now spend more than 30%') &&
  /ACS B25070|HUD CHAS/.test(lead),
  'hero renter cost-burden sentence must carry an ACS/CHAS source reference'
);
assert(
  lead.includes('146,000') && lead.includes('at or below 40% AMI') && lead.includes('data/co_ami_gap_by_county.json'),
  'hero shortage claim must use the verified owner-supplied 146,000 <=40% AMI rental framing'
);

const routes = htmlBlock('<nav class="home-job-routes"', '</nav>');
assert(
  routes.includes('Plan ownership') &&
  routes.includes('Screen affordable for-sale options') &&
  routes.includes('housing-needs-assessment.html#affordable-ownership-need-section') &&
  routes.includes('deal-calculator.html'),
  'Find Opportunity routing must include an affordable ownership path'
);

console.log('homepage-claims: PASS');
