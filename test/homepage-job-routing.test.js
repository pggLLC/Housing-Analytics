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
  index.includes('href="data-review-hub.html"'),
  'homepage data snapshot must use narrowed trust language and link Data Trust Center'
);
assert(!index.includes('every stat is sourced'), 'homepage must not overclaim that every stat is sourced');
assert(!index.includes('docs/demo-mode-audit.csv'), 'homepage trust claim must not point public readers to the old demo-mode audit');

console.log('Homepage job routing (Phase 2.3): PASS');
