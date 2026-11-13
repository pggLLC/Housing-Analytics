#!/usr/bin/env node
/**
 * Each homepage step card must describe the page it opens.
 *
 * Until 2026-10-15 the step-5 card said "Design your unit mix and income
 * targeting. Set rents by AMI tier" and opened hna-scenario-builder.html, a
 * 20-year demographic projection tool with no unit mix or rents on it. Unit
 * mix lives in the Subject Project (js/components/subject-project.js), on
 * Market Analysis and the Deal Calculator. Codex's site review flagged it as
 * the homepage's worst promise/destination mismatch.
 *
 * Agreement, not copy: (1) a card's heading must name the view its link
 * opens, as that view's own headings do (every word of the
 * card's name is one the view's headings use); (2) a card that promises unit-mix or
 * rent-setting work must open a page that loads the Subject Project.
 *
 * Since the 13 Nov 2026 rebuild Home is drawn by hub/home.js and each step
 * opens a view on a hub page, so the card is checked against that view as
 * drawn, never against the older public page the view replaces (Codex review,
 * PR 2804: the older page's title can agree while the page a visitor reaches
 * does not).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { renderHome, renderRoute, steps, text } = require('./helpers/render-home');
// Small joining words are not part of a page's name ("Select your jurisdiction" names "Select a county").
const words = (t) => text(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(a|an|the|your)\b/g, ' ').replace(/\b(\w+?)s\b/g, '$1').split(/\s+/).filter(Boolean);

(async () => {
const cards = [];
for (const c of steps(await renderHome())) {
  const view = await renderRoute(c.raw);
  cards.push({
    // ", new" is the card's badge, not part of the tool's name.
    heading: c.heading.replace(/,\s*new$/i, ''), text: c.heading + ' ' + c.body, route: c.raw, opens: c.href, page: c.page, view,
    h1: text((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(view) || [])[1] || ''),
    // What the view calls itself: its headings, and the line under the <h1> that says what kind of page it is
    // (a place page is headed with the place's name, and that line reads "Housing Needs Assessment · Mesa County").
    headings: [...view.matchAll(/<(h[1-3]|p class="page-answer")[^>]*>([\s\S]*?)<\/(?:h[1-3]|p)>/g)].map((m) => text(m[2])),
  });
}

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); } };

console.log('home-step-cards-match-destinations');

check('the scan found the step cards', () => {
  assert.ok(cards.length >= 5, `found ${cards.length} step cards on Home`);
  for (const c of cards) assert.ok(c.heading && c.opens, `a card is missing its heading or link: ${JSON.stringify({ heading: c.heading, opens: c.opens })}`);
  // The link itself goes somewhere real: the hub page that draws the route.
  for (const c of cards) assert.ok(fs.existsSync(path.join(ROOT, c.opens.replace(/[#?].*$/, ''))), `step "${c.heading}" opens ${c.opens}, which is not a page here`);
  for (const c of cards) assert.ok(c.h1, `step "${c.heading}" opens ${c.opens}, and the view drawn there has no <h1>`);
});

for (const c of cards) {
  // The card's main noun phrase: the part before "&" or "and" (e.g. "Deal calculator").
  const phrase = words(c.heading.split(/&| and /)[0]);
  const named = new Set(c.headings.flatMap(words));
  check(`"${c.heading}" names the view it opens, ${c.opens} ("${c.h1}")`, () => {
    const missing = phrase.filter((w) => !named.has(w));
    assert.ok(phrase.length && !missing.length,
      `the card heading "${c.heading}" uses ${missing.map((w) => `"${w}"`).join(', ')}, which no heading on ${c.opens} uses (its headings: ${c.headings.slice(0, 8).join(' | ')})`);
  });
  if (/unit mix|set rents/i.test(c.text)) {
    check(`"${c.heading}" promises unit mix or rents, so its page must have the Subject Project`, () => {
      const promisesHere = /(design|set|choose|build)[^.]{0,30}(unit mix|rents)/i.test(c.text) && !/set in the subject project/i.test(c.text);
      if (!promisesHere) return;
      const page = fs.readFileSync(path.join(ROOT, c.page), 'utf8');
      assert.ok(page.includes('js/components/subject-project.js'),
        `${c.page} does not load js/components/subject-project.js, so it cannot do what the card promises`);
    });
  }
}

// The check has to be able to fail: a name the destination does not use must be caught.
check('a card named for a page its link does not open is caught', () => {
  const market = cards.find((c) => /^#\/market\b/.test(c.route));
  assert.ok(market, 'no step opens the Market check');
  const named = new Set(market.headings.flatMap(words));
  assert.ok(words('Market analysis').some((w) => !named.has(w)), 'the Market check view now uses "analysis" in a heading; pick another name the view does not use for this self-check');
});

if (failures) { console.log(`home-step-cards-match-destinations: FAIL (${failures})`); process.exit(1); }
console.log('home-step-cards-match-destinations: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
