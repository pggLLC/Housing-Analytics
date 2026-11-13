#!/usr/bin/env node
// test/homepage-job-routing.test.js
//
// Phase 2.3: homepage source-order and link guard for jurisdiction-first
// entry, job routing, and Data Trust Center transparency.
// 13 Nov 2026: Home was rebuilt (index.html draws hub/home.js). Each guard below keeps what it was for and reads
// the page as drawn; the comments say where the shape of the page changed.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const navigation = fs.readFileSync(path.join(ROOT, 'js', 'navigation.js'), 'utf8');

// Home is drawn by hub/home.js since the 13 Nov 2026 rebuild (index.html), so everything about the page is read
// from it as drawn. A link there is a route on a hub page; `rebuilds` names the public page that route took the
// place of, which is how "Home still routes to X" is asked below.
const home = require('./helpers/render-home');
const index = home.renderHomeSync();
const homeText = home.text(index);
const homeLinks = home.links(index);
const linksTo = (page) => homeLinks.filter((l) => l.href && (home.rebuilds(l.raw) === page || home.pageOf(l.href) === page));

function pos(needle) {
  const idx = index.indexOf(needle);
  assert(idx >= 0, `Home must include ${needle}`);
  return idx;
}

function assertLinkExists(href) {
  const target = path.join(ROOT, href);
  assert(fs.existsSync(target), `homepage route target must exist: ${href}`);
}

// Source order: find a place, then the start cards (the first is the jurisdiction entry), then "what brings you
// here" (job routing), then the detailed seven-step workflow.
const search = pos('id="home-place"');
const startCards = pos('class="hh-paths"');
const jobRoutes = pos('class="home-doors"');
const workflow = pos('class="hs-list"');

assert(search < startCards, 'the place search must come before the start cards');
assert(startCards < jobRoutes, 'jurisdiction CTA must remain before job routing');
assert(jobRoutes < workflow, 'job routing must appear before the detailed seven-step workflow');
assert(linksTo('places/index.html').length >= 1, 'the place-profile directory must stay linked from Home');

// The five jobs the old page routed by name. The rebuilt page routes by start card, role and tool instead; what
// must hold is that each job still has a way in from Home, to the page that does that job.
const JOBS = {
  'Understand need': ['select-jurisdiction.html', 'housing-needs-assessment.html'],
  'Find opportunity': ['lihtc-opportunity-finder.html'],
  'Plan ownership': ['for-sale-market-study.html'],
  'Test feasibility': ['deal-calculator.html'],
  'Verify data': ['data-review-hub.html'],
};
for (const [job, pages] of Object.entries(JOBS)) {
  assert(pages.some((p) => linksTo(p).length >= 1), `Home must still route "${job}" (a link to ${pages.join(' or ')})`);
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
  const found = linksTo(href);
  assert(found.length >= 1, `homepage must link to ${href} (or the hub route that rebuilds it)`);
  assertLinkExists(href);
  for (const l of found) assertLinkExists(home.pageOf(l.href));
}
// No link on Home is left with nowhere to go once the page has pointed its routes, and every page it opens exists.
for (const l of homeLinks) {
  assert(l.href, `Home link "${l.text}" (${l.raw}) has no page to open`);
  if (!/^(https?:|mailto:|data:|#)/.test(l.href)) assertLinkExists(home.pageOf(l.href));
}

// Trust language stays narrow: Home says where freshness, coverage and limits are shown, and links there. It
// does not claim every figure is sourced.
{
  const trust = linksTo('data-review-hub.html');
  assert(trust.length >= 1, 'homepage must link the Data Trust Center');
  const sentences = homeText.split(/(?<=[.!?])\s+/).filter((t) => /data trust/i.test(t));
  assert(sentences.some((t) => /freshness/i.test(t) && /limit/i.test(t)),
    'homepage data snapshot must say the trust page shows freshness and limits, and link Data Trust Center');
}
assert(!/every (stat|number|figure) is sourced/i.test(homeText), 'homepage must not overclaim that every stat is sourced');
assert(!index.includes('docs/demo-mode-audit.csv'), 'homepage trust claim must not point public readers to the old demo-mode audit');

// The menu description promises what the Data Trust Center covers. Each topic
// it names must also be named in the page's visible text, so the two agree
// whatever words either one uses. A topic is matched by any of its phrasings.
{
  const TOPICS = {
    sources: /\bsources?\b|where (?:the |every )?(?:data|number)s? comes? from/i,
    freshness: /freshness|how current|update timing|last updated/i,
    checks: /\bchecks?\b|\bcheck the data\b|validation|\bQA\b/i,
  };
  const visibleText = (html) => html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<[^>]+>/g, ' ');
  const agreement = (desc, hubHtml) => {
    const promised = Object.keys(TOPICS).filter((t) => TOPICS[t].test(desc));
    const text = visibleText(hubHtml);
    return { promised, missing: promised.filter((t) => !TOPICS[t].test(text)) };
  };

  const entry = navigation.match(/label:\s*"Data Trust Center",[^}]*desc:\s*"([^"]+)"/);
  assert(entry, 'navigation has no Data Trust Center entry with a description');
  const hub = fs.readFileSync(path.join(ROOT, 'data-review-hub.html'), 'utf8');
  const real = agreement(entry[1], hub);
  // Non-vacuity on the scan: the description must promise something checkable.
  assert(real.promised.length > 0, 'Data Trust Center menu description names no topic this guard can check');
  assert.deepEqual(real.missing, [],
    `Data Trust Center menu promises ${real.missing.join(', ')} but data-review-hub.html no longer shows it`);

  // Sabotage, both ways, each mutation proved to have applied.
  const reworded = 'Where the data comes from, how current it is, and validation';
  assert.notEqual(reworded, entry[1]);
  assert.equal(agreement(reworded, hub).missing.length, 0, 'a synonymous menu rewording must stay green');
  const promisedReworded = agreement(reworded, hub).promised;
  assert.deepEqual(promisedReworded.sort(), Object.keys(TOPICS).sort(), 'reworded menu text must still promise every topic');
  const strippedHub = visibleText(hub).replace(new RegExp(TOPICS.freshness.source, 'gi'), '');
  assert.notEqual(strippedHub, visibleText(hub), 'freshness-removal mutation did not change the page');
  assert(agreement(entry[1], strippedHub).missing.includes('freshness'),
    'a page that stops showing freshness must fail the guard');
}
assert(
  navigation.includes('Browse every dataset with previews'),
  'navigation File Browser description must use public dataset-browsing language'
);
// The Housing News description must agree with the page it opens, not pin a
// sentence. It keeps the caution to open the source, and it may only promise
// machine summaries while policy-briefs.html actually shows machine-written
// text (the 2026-09-24 rebuild removed the per-topic summaries).
{
  const newsPage = fs.readFileSync(path.join(ROOT, 'policy-briefs.html'), 'utf8');
  const entry = navigation.match(/label:\s*"Housing News",[^}]*desc:\s*"([^"]+)"/);
  assert(entry, 'navigation has no Housing News entry with a description');
  const desc = entry[1];
  assert(/check the linked source/i.test(desc), 'navigation Housing News description must keep the caution to check the source');
  const pageSummarizes = /machine-summari[sz]ed|auto-generated summar/i.test(newsPage);
  assert.equal(/auto-generated|machine-summari/i.test(desc), pageSummarizes,
    pageSummarizes
      ? 'Housing News shows machine summaries but the navigation does not say so'
      : 'navigation promises auto-generated summaries that policy-briefs.html no longer shows');
}
for (const oldPhrase of [
  'QA coverage',
  'Inspect every JSON / GeoJSON / CSV in data/ with schema previews',
  'Machine-summarized headlines (not editorially reviewed)'
]) {
  assert(!homeText.includes(oldPhrase), `homepage must not include old maintainer wording: ${oldPhrase}`);
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
// On the rebuilt Home the ownership way in is any link that names for-sale or ownership work.
const ownershipRoutes = homeLinks.filter((l) => /for-sale|ownership|homebuy/i.test(l.text) && /^#\//.test(l.raw));
assert(ownershipRoutes.length >= 1, 'homepage must offer an ownership route');
for (const l of ownershipRoutes) {
  assert.equal(home.rebuilds(l.raw), 'for-sale-market-study.html',
    `"${l.text}" must route to the for-sale market study, not a rental tool (it opens ${l.href})`);
  assert.notEqual(home.rebuilds(l.raw), 'deal-calculator.html',
    `"${l.text}" must not route to deal-calculator.html: it opens in LIHTC rental mode, and its for-sale mode is hidden behind a toggle`);
}

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
// Rebuilt Home: the one "Start here" card. It names what the reader starts ("pick a town or county") and the
// page it opens (the Places hub's own start, hub/places.js) asks for the same thing in the same words.
const heroCta = (() => {
  const starts = homeLinks.filter((l) => /\bstart here\b/i.test(l.text));
  assert.equal(starts.length, 1, 'the homepage must have exactly one "Start here"');
  assert.equal(home.rebuilds(starts[0].raw), 'select-jurisdiction.html', 'the homepage start must open the place picker');
  return starts[0];
})();

const heroPhrase = (() => {
  // "Start here: pick a town or county" -> "town or county"
  const m = heroCta.text.match(/start here:\s*(?:pick|choose|select|find)\s+(?:a|an|your)\s+([^→]+?)\s*(?:→|$)/i);
  assert(m, `the hero CTA does not name what it starts: ${heroCta.text}`);
  return m[1].trim();
})();

const destination = fs.readFileSync(path.join(ROOT, 'hub', 'places.js'), 'utf8');
const pickerLabel = destination.match(/Shell\.searchBox\('place-q',\s*'([^']+)'/);
assert(pickerLabel, 'hub/places.js no longer draws the Places hub\'s place search (place-q); update this guard to the new picker');
assert(
  pickerLabel[1].toLowerCase().includes(heroPhrase.toLowerCase()),
  `the hero starts "${heroPhrase}" but the Places hub asks to "${pickerLabel[1]}" — `
  + 'the button and the page it opens are describing different things'
);
assert.equal(heroCta.href, 'places-hub.html#/places', 'the homepage start must open the Places hub at its start');
assert(/"places-hub\.html":\s*"#\/places"|places-hub\.html[^\n]{0,40}#\/places/.test(fs.readFileSync(path.join(ROOT, 'hub', 'lab-config.js'), 'utf8')),
  'the Places hub no longer starts at #/places, where the place search is');

// The opening makes no numeric claim of its own, so it cannot drift from the figures drawn below it; and where
// the page says "roughly half of renters", the figure it draws from data/home-snapshot.json is roughly half.
const leadMatch = index.match(/<p class="lede">([\s\S]*?)<\/p>/);
assert(leadMatch, 'homepage hero lead copy must exist');
const heroLead = home.text(leadMatch[1]);
assert(
  !/\b\d+(?:\.\d+)?%/.test(heroLead) && !/\b\d{1,3}(,\d{3})+\b/.test(heroLead),
  'homepage hero must not hard-code a figure that can drift from the cards below it'
);
{
  const burden = require('../data/home-snapshot.json').values.renter_cost_burden_pct;
  assert(Number.isFinite(burden), 'fixture: the snapshot carries the renter cost-burden share');
  assert(homeText.includes(burden.toFixed(1) + '%'), 'homepage must show the renter cost-burden share from data/home-snapshot.json');
  if (/roughly half of renters/i.test(homeText)) {
    assert(burden >= 45 && burden <= 55, `the homepage says "roughly half of renters" but the snapshot says ${burden}%; reword it`);
  }
  assert(/roughly half of renters/i.test(homeText) || !/half of renters/i.test(homeText), 'fixture: the "roughly half" sentence is the one checked');
}

console.log('Homepage job routing (Phase 2.3): PASS');
