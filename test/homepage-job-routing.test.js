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

for (const label of ['Understand need', 'Find opportunity', 'Plan ownership', 'Test feasibility', 'Verify data']) {
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

// A job route is a promise about where the link goes. "Plan ownership" pointed
// at deal-calculator.html for months, whose own <h1> is "LIHTC Pro Forma &
// Capital Stack" — a rental tax-credit tool. The page does carry an ownership
// mode, but it is hidden by default, so a reader who accepted the promise
// landed on rental financing.
//
// The reason it survived: the label list above skipped 'Plan ownership', and
// the href list below only asserts each page is linked SOMEWHERE on the
// homepage — deal-calculator.html is also linked from "Test feasibility", so
// the wrong destination satisfied every existing assertion.
//
// So this checks two things a string pin cannot: that the ownership route
// links to the for-sale study, and that the for-sale study is still a page
// about for-sale housing. Repointing it at a renamed or repurposed target
// fails here instead of silently recreating the bug.
const ownershipRoute = (() => {
  const start = index.indexOf('Plan ownership');
  assert(start >= 0, 'homepage must offer a "Plan ownership" job route');
  const end = index.indexOf('</div>', start);
  assert(end > start, '"Plan ownership" route must be a closed block');
  return index.slice(start, end);
})();

assert(
  ownershipRoute.includes('href="for-sale-market-study.html"'),
  '"Plan ownership" must route to the for-sale market study, not a rental tool'
);
assert(
  !ownershipRoute.includes('href="deal-calculator.html"'),
  '"Plan ownership" must not route to deal-calculator.html: it opens in LIHTC ' +
  'rental mode, and its for-sale mode is hidden behind a toggle'
);

const forSaleStudy = fs.readFileSync(path.join(ROOT, 'for-sale-market-study.html'), 'utf8');
const forSaleH1 = (forSaleStudy.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
assert(
  /for-sale/i.test(forSaleH1.replace(/<[^>]+>/g, ' ')),
  'the ownership route target must still be a for-sale page by its own headline'
);

// The hero button names the thing it starts, and the page it opens names that
// thing too. They disagreed for a week: the button said "Start a Housing
// Market Study" while select-jurisdiction.html said, seven times, "begin your
// Housing Needs Assessment". One click apart, in opposite words.
//
// Nothing noticed because each file was self-consistent. So this compares the
// two rather than pinning either one: the noun phrase in the hero has to be a
// phrase the destination page actually uses. Rewording both together is fine;
// rewording one is what broke it.
const heroCta = (() => {
  const m = index.match(/<a href="select-jurisdiction\.html" class="btn"[\s\S]*?<\/a>/);
  assert(m, 'the homepage hero must link to select-jurisdiction.html');
  return m[0];
})();

const heroPhrase = (() => {
  // "Start a Housing Needs Assessment" -> "Housing Needs Assessment"
  const m = heroCta.match(/<span>\s*(?:Start|Begin|Open)\s+(?:a|an|your)\s+([^<]+?)\s*</i);
  assert(m, `the hero CTA does not name what it starts: ${heroCta.replace(/\s+/g, ' ').slice(0, 120)}`);
  return m[1].trim();
})();

const destination = fs.readFileSync(path.join(ROOT, 'select-jurisdiction.html'), 'utf8');
assert(
  destination.toLowerCase().includes(heroPhrase.toLowerCase()),
  `the hero starts "${heroPhrase}" but select-jurisdiction.html never uses that phrase — `
  + 'the button and the page it opens are describing different things'
);

// And the destination's own promise has to survive: if that sentence is
// reworded away, the check above would pass against some other stray match.
assert(
  /begin your Housing Needs Assessment/i.test(destination),
  'select-jurisdiction.html no longer tells the reader what they are beginning'
);

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
