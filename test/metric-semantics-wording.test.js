#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const hnaHtml = read('housing-needs-assessment.html');
const indexHtml = read('index.html');
const hnaRenderers = read('js/hna/hna-renderers.js');

function assertIncludes(src, needle, label) {
  assert(src.includes(needle), label + ' missing: ' + needle);
}

function assertNotIncludes(src, needle, label) {
  assert(!src.includes(needle), label + ' should not contain: ' + needle);
}

console.log('Metric semantics wording — SEM-1');

assertIncludes(hnaHtml, '20-yr production need', 'decision-strip production tile uses projection qualifier');
assertNotIncludes(hnaHtml, 'Production gap</span>', 'decision-strip no longer conflates production and current gap');

assertIncludes(hnaHtml, 'Current rental gap &amp; affordability', 'current rental gap section title is explicit');
assertIncludes(hnaHtml, 'Today\'s renter-household shortfall by income tier and cost burden', 'current rental gap section copy names present-day renter shortfall');
assertIncludes(hnaHtml, 'distinct from the 20-year production outlook in the projections section below', 'current rental gap copy cross-references projection outlook');
assertNotIncludes(hnaHtml, 'Housing Gap &amp; Affordability Analysis', 'old generic housing-gap heading is removed');
assertNotIncludes(hnaHtml, 'gap between affordable units needed and those available', 'old generic gap description is removed');

assertIncludes(hnaHtml, 'Projected housing demand (20-yr) by AMI tier view', 'AMI demand view aria label carries projection horizon');
assertNotIncludes(hnaHtml, 'aria-label="Housing demand by AMI tier view"', 'old AMI demand aria label is removed');

assertIncludes(indexHtml, 'CO rental deficit ≤30% AMI', 'homepage <=30 AMI card names current rental deficit');
assertIncludes(indexHtml, 'CO rental deficit ≤60% AMI', 'homepage <=60 AMI card names current rental deficit');
assertIncludes(indexHtml, 'current renter households vs affordable units', 'homepage rental deficit cards explain current renter-vs-unit basis');
assertNotIncludes(indexHtml, 'CO Housing Deficit ≤30% AMI', 'homepage old <=30 generic deficit label is removed');
assertNotIncludes(indexHtml, 'CO Housing Deficit ≤60% AMI', 'homepage old <=60 generic deficit label is removed');

assertIncludes(hnaRenderers, '1,000-unit current rental gap', 'renderer permitting note names current rental gap');
assertNotIncludes(hnaRenderers, '1,000-unit housing gap', 'renderer old generic housing-gap phrase is removed');

assertIncludes(hnaHtml, 'id="statOwnGap"', 'ownership summary has namespaced current ownership need node');
assertIncludes(hnaHtml, 'id="statOwnGapModerateRenters"', 'ownership summary has namespaced moderate-renter node');
assertIncludes(hnaHtml, 'id="statOwnGapOwnerBurden"', 'ownership summary has namespaced owner-burden node');
assertIncludes(hnaRenderers, "_combinedSetText('statOwnGap'", 'ownership renderer writes namespaced ownership node');
assertIncludes(hnaRenderers, "_combinedSetText('statOwnGapModerateRenters'", 'ownership renderer writes namespaced moderate-renter node');
assertIncludes(hnaRenderers, "_combinedSetText('statOwnGapOwnerBurden'", 'ownership renderer writes namespaced owner-burden node');
assertIncludes(hnaRenderers, "document.getElementById('statGap' + b)", 'current rental gap reader keeps rental statGap nodes');

const ownershipBlock = hnaRenderers.slice(
  hnaRenderers.indexOf('function renderAffordableOwnershipNeed'),
  hnaRenderers.indexOf('function tryRenderAffordableOwnershipNeedFromState'),
);
assert(!/_combinedSetText\('statGap/.test(ownershipBlock), 'ownership renderer must never write rental statGap nodes');

console.log('metric-semantics-wording: ok');
