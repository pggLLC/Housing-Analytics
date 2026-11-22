#!/usr/bin/env node
'use strict';
// The Recommendation's "Who is priced out?" sentence must not join two burden
// shares from different surveys and years as if one were part of the other.
// Codex content QA C05 (22 Nov 2026): Fruita read "43.6% ... more than 30% ...
// and 24.6% ... more than half", the first ACS 2020-2024, the second HUD CHAS
// 2018-2022 built from tracts. Each share now carries its own period.
const assert = require('node:assert/strict');
const C = require('../js/workflow/recommendation-contract.js');

const metric = (value, source_id, as_of) => ({ value, source_id, as_of, geography_level: 'place', confidence: 'high' });
const plainFor = (m) => {
  const cs = C.buildConclusions(m, 'place');
  return (Array.isArray(cs) ? cs.find((c) => c.id === 'affordability') : cs.affordability).plain;
};

// Different surveys and years: two statements, each with its own period.
let p = plainFor({
  pct_cost_burdened: metric(41.2, 'test-survey-a', 'Survey A 2030-2034'),
  pct_renter_severe_burdened: metric(19.9, 'test-survey-b-apportioned', 'Survey B 2027-2031'),
});
assert.match(p, /41\.2% [^.]*\(Survey A 2030-2034\)\./, 'the over-30% share carries its own period');
assert.match(p, /19\.9% [^.]*\(Survey B 2027-2031, estimated from census tracts\)/, 'the over-half share carries its own period and construction');
assert.match(p, /different surveys and years/, 'the sentence says the two are not nested');
assert.doesNotMatch(p, /, and 19\.9%/, 'the two shares are not joined as one count');

// Same survey and year: one sentence is fine, with its period once.
p = plainFor({
  pct_cost_burdened: metric(41.2, 'test-survey-a', 'Survey A 2030-2034'),
  pct_renter_severe_burdened: metric(19.9, 'test-survey-a', 'Survey A 2030-2034'),
});
assert.match(p, /41\.2% [^.]*, and 19\.9% pay more than half \(Survey A 2030-2034\)\./, 'one survey reads as one sentence');
assert.doesNotMatch(p, /different surveys/, 'no caveat when they share a survey');

console.log('recommendation-burden-vintages: 6 checks passed');
