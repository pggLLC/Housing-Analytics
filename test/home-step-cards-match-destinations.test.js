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
 * Agreement, not copy: (1) a card's heading must name its destination, as the
 * destination's <title> or <h1> does; (2) a card that promises unit-mix or
 * rent-setting work must open a page that loads the Subject Project.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { renderHome, steps, rebuilds } = require('./helpers/render-home');
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Small joining words are not part of a page's name ("Select your jurisdiction" names "Select Jurisdiction").
const norm = (t) => strip(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(a|an|the|your)\b/g, ' ').replace(/\b(\w+?)s\b/g, '$1').replace(/\s+/g, ' ').trim();

// Home is drawn by hub/home.js since the 13 Nov 2026 rebuild, so the cards are read from the page as drawn.
// Each step opens a route on a hub page; the page that route rebuilds (still live beside it) is the one whose
// own title the card has to agree with, and whose scripts say what the step can do.
(async () => {
const cards = steps(await renderHome()).map((c) => ({
  // ", new" is the card's badge, not part of the tool's name.
  heading: c.heading.replace(/,\s*new$/i, ''), text: c.heading + ' ' + c.body, route: c.raw, opens: c.href, href: rebuilds(c.raw) || '',
}));

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); } };

console.log('home-step-cards-match-destinations');

check('the scan found the step cards', () => {
  assert.ok(cards.length >= 5, `found ${cards.length} step cards on Home`);
  for (const c of cards) assert.ok(c.heading && c.href, `a card is missing its heading or link: ${JSON.stringify(c)}`);
  // The link itself goes somewhere real: the hub page that draws the route.
  for (const c of cards) assert.ok(c.opens && fs.existsSync(path.join(ROOT, c.opens.replace(/[#?].*$/, ''))), `step "${c.heading}" opens ${c.opens}, which is not a page here`);
});

for (const c of cards) {
  const dest = fs.readFileSync(path.join(ROOT, c.href), 'utf8');
  const title = (dest.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const h1 = (dest.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
  // The card's main noun phrase: the part before "&" or "and" (e.g. "Market Analysis").
  const phrase = norm(c.heading.split(/&| and /)[0]);
  check(`"${c.heading}" names its destination ${c.href}`, () => {
    assert.ok(norm(title).includes(phrase) || norm(h1).includes(phrase),
      `the card heading "${c.heading}" appears in neither the <title> "${strip(title)}" nor the <h1> "${strip(h1)}" of ${c.href}`);
  });
  if (/unit mix|set rents/i.test(c.text)) {
    check(`"${c.heading}" promises unit mix or rents, so its page must have the Subject Project`, () => {
      const promisesHere = /(design|set|choose|build)[^.]{0,30}(unit mix|rents)/i.test(c.text) && !/set in the subject project/i.test(c.text);
      if (!promisesHere) return;
      assert.ok(dest.includes('js/components/subject-project.js'),
        `${c.href} does not load js/components/subject-project.js, so it cannot do what the card promises`);
    });
  }
}

if (failures) { console.log(`home-step-cards-match-destinations: FAIL (${failures})`); process.exit(1); }
console.log('home-step-cards-match-destinations: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
