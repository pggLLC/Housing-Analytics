#!/usr/bin/env node
// test/homepage-job-routing.test.js
//
// Phase 2.3: homepage source-order and link guard for jurisdiction-first
// entry, job routing, and Data Trust Center transparency.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const navigation = fs.readFileSync(path.join(ROOT, 'js', 'navigation.js'), 'utf8');

function pos(needle) {
  const idx = index.indexOf(needle);
  assert(idx >= 0, `index.html must include ${needle}`);
  return idx;
}

function assertLinkExists(href) {
  const target = path.join(ROOT, href);
  assert(fs.existsSync(target), `homepage route target must exist: ${href}`);
}

const jurisdictionCta = pos('href="select-jurisdiction.html" class="btn"');
const profileLink = pos('href="places/index.html"');
const jobRoutes = pos('class="home-job-routes"');
const workflow = pos('class="home-workflow"');

assert(jurisdictionCta < jobRoutes, 'jurisdiction CTA must remain before job routing');
assert(profileLink < jobRoutes, 'place-profile route must be offered before job routing');
assert(jobRoutes < workflow, 'job routing must appear before the detailed six-step workflow');

for (const label of ['Understand need', 'Find opportunity', 'Test feasibility', 'Verify data']) {
  assert(index.includes(label), `homepage job routing must include "${label}"`);
}

for (const href of [
  'select-jurisdiction.html',
  'places/index.html',
  'housing-needs-assessment.html',
  'lihtc-opportunity-finder.html',
  'market-analysis.html',
  'data-review-hub.html',
  'deal-calculator.html',
  'land-value.html'
]) {
  assert(index.includes(`href="${href}"`), `homepage must link to ${href}`);
  assertLinkExists(href);
}

assert(
  index.includes('Public datasets are sourced and monitored') &&
  index.includes('what each dataset includes') &&
  index.includes('href="data-review-hub.html"'),
  'homepage data snapshot must use narrowed trust language and link Data Trust Center'
);
assert(!index.includes('every stat is sourced'), 'homepage must not overclaim that every stat is sourced');
assert(!index.includes('docs/demo-mode-audit.csv'), 'homepage trust claim must not point public readers to the old demo-mode audit');

assert(
  index.includes('freshness, sources, how we check the data, and limitations'),
  'homepage Data Trust Center route must use public wording for data checks'
);
assert(
  navigation.includes('Start here · sources, freshness, how we check the data, and discovery'),
  'navigation Data Trust Center description must avoid maintainer QA vocabulary'
);
assert(
  navigation.includes('Browse every dataset with previews'),
  'navigation File Browser description must use public dataset-browsing language'
);
assert(
  navigation.includes('Auto-generated summaries — always check the linked source'),
  'navigation Housing News description must use public caution language'
);
for (const oldPhrase of [
  'QA coverage',
  'Inspect every JSON / GeoJSON / CSV in data/ with schema previews',
  'Machine-summarized headlines (not editorially reviewed)'
]) {
  assert(!index.includes(oldPhrase), `homepage must not include old maintainer wording: ${oldPhrase}`);
  assert(!navigation.includes(oldPhrase), `navigation must not include old maintainer wording: ${oldPhrase}`);
}

const leadMatch = index.match(/<p class="home-opening__lead">([\s\S]*?)<\/p>/);
assert(leadMatch, 'homepage hero lead copy must exist');
const heroLead = leadMatch[1].replace(/\s+/g, ' ').trim();
assert(
  heroLead.includes('roughly half of renters now spend more than 30%'),
  'homepage hero should use durable renter cost-burden copy aligned with the live snapshot card'
);
assert(
  !/\b\d+(?:\.\d+)?% of renters\b/.test(heroLead),
  'homepage hero must not hard-code a renter cost-burden percentage that can drift from #snapCostBurden'
);

console.log('Homepage job routing (Phase 2.3): PASS');
