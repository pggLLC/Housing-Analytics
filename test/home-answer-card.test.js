#!/usr/bin/env node
// test/home-answer-card.test.js
//
// The homepage front door (2026-10-14 persona walk): a visitor picks why
// they came, types a town, and gets a short answer card instead of a report
// 100+ phone screens long. This guards what the card has to agree with,
// not its wording:
//   1. every number on the card is the value in that town's metrics digest,
//      the file the full report's numbers come from;
//      a top-coded ACS median reads "or more", and the card names the
//      source the digest records;
//   2. a value the digest cannot support (null, 0 dollars, a rate whose
//      denominator floor applied) is left off, never shown as a number;
//   3. every next-step link opens a page that exists, and the report link is
//      the same URL the search used to navigate to;
//   4. the doors Home offers are the doors the code knows, the search comes
//      before everything but the headline and a short opening, and the card
//      Home draws for a picked town shows exactly these facts.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  DOORS, answerFacts, doorLinks, jurisdictionUrl, digestUrl
} = require('../js/home-jurisdiction-search.js');

const registry = require('../data/hna/geography-registry.json').geographies;
const digestDir = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');

// ── 1 and 2. Facts agree with the digest, absences stay absent ─────────────
const money = new Set(['gross_rent_median', 'median_hh_income', 'median_home_value']);
const rate = new Set(['pct_cost_burdened']);
const digits = (s) => Number(String(s).replace(/[^0-9]/g, ''));

// ACS publishes a top-coded median as the cap plus one dollar.
const TOP_CODES = { gross_rent_median: 3501, median_hh_income: 250001, median_home_value: 2000001 };
const SOURCE_NAMES = {
  'acs-profile': /^Census ACS/,
  'acs-profile-dp04': /^Census ACS/,
  'acs-profile-dp04-grapi': /^Census ACS/,
  'zillow-zhvi-city-index': /^Zillow home value index/,
  'zillow-zhvi-county-adjusted': /^county-adjusted Zillow\/ACS estimate/
};

let shown = 0;
let withheld = 0;
let topCodes = 0;
for (const entry of registry) {
  const file = path.join(digestDir, entry.geoid + '.json');
  assert(fs.existsSync(file), `no digest for ${entry.name} (${entry.geoid}); the card would show nothing`);
  assert.equal(digestUrl(entry.geoid), 'data/hna/jurisdiction-metrics-digest/' + entry.geoid + '.json');
  const digest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const facts = answerFacts(digest);
  const byKey = new Map(facts.map((f) => [f.key, f]));
  for (const key of [...money, ...rate]) {
    const m = digest.metrics[key];
    const fact = byKey.get(key);
    const supported = m && m.value !== null && m.value !== undefined && !m.denominator_floor_applied &&
      Number.isFinite(Number(m.value)) && (money.has(key) ? Number(m.value) > 0 : Number(m.value) >= 0);
    if (!supported) {
      assert(!fact, `${entry.name}: ${key} is ${m ? JSON.stringify(m.value) : 'absent'} in the digest but the card shows "${fact && fact.value}"`);
      withheld++;
      continue;
    }
    assert(fact, `${entry.name}: digest has ${key} = ${m.value} but the card leaves it out`);
    const topCoded = /^acs/.test(m.source_id) && TOP_CODES[key] === Number(m.value);
    if (topCoded) {
      topCodes++;
      assert(/or more/.test(fact.value) && digits(fact.value) === Number(m.value) - 1,
        `${entry.name}: ${key} ${m.value} is an ACS top code ("${Number(m.value) - 1} or more") but the card shows "${fact.value}"`);
    } else {
      assert.equal(digits(fact.value), Math.round(Number(m.value)),
        `${entry.name}: card shows ${key} as "${fact.value}", digest says ${m.value}`);
      assert(!/or more/.test(fact.value), `${entry.name}: ${key} is not top-coded but reads "${fact.value}"`);
    }
    // The source named on the card is the one the digest records.
    const want = SOURCE_NAMES[m.source_id];
    assert(want, `${entry.name}: ${key} has source_id ${m.source_id}, which the card has no name for`);
    assert(want.test(fact.source), `${entry.name}: ${key} comes from ${m.source_id} but the card says "${fact.source}"`);
    if (m.confidence === 'low') assert(/rough/.test(fact.note), `${entry.name}: low-confidence ${key} is not flagged`);
    shown++;
  }
}
assert(shown > 1000, `the card scan showed only ${shown} facts across ${registry.length} places; the scan has stopped matching`);
assert(topCodes > 0, 'the scan met no ACS top-coded median, so the top-code rule was never exercised');
assert(withheld > 0, 'the scan never met a missing value, so the absence rule above was never exercised');

// The absence rule on its own, independent of what today's data holds.
assert.deepEqual(answerFacts({ metrics: {
  pct_cost_burdened: { value: 61, denominator_floor_applied: true },
  gross_rent_median: { value: 0 },
  median_hh_income: { value: null },
  median_home_value: { value: '' }
} }), [], 'zero dollars, null, blank and floored rates must all be left off the card');
assert.deepEqual(answerFacts(null), [], 'a missing digest yields no facts');
assert.equal(answerFacts({ metrics: { pct_cost_burdened: { value: 0, as_of: 'ACS 2020-2024 5-year' } } }).length, 1,
  'a measured 0% is a real rate and stays on the card');

// ── 3. Next-step links open real pages ─────────────────────────────────────
const place = registry.find((e) => e.geoid === '0832155');
const county = registry.find((e) => e.geoid === '08113');
assert(place && county, 'fixture: Greeley and San Miguel County are in the registry');
let checked = 0;
for (const entry of [place, county]) {
  for (const door of [...Object.keys(DOORS), null]) {
    const links = doorLinks(door, entry);
    assert(links.length >= 1, `door ${door} gives ${entry.name} no next step`);
    for (const l of links) {
      checked++;
      if (/^https?:/.test(l.href)) {
        assert.equal(new URL(l.href).protocol, 'https:', `${l.href} must be https`);
        assert.equal(l.external, true, `${l.href} must open as an external link`);
        continue;
      }
      const file = l.href.split('#')[0].split('?')[0];
      assert(fs.existsSync(path.join(ROOT, file)), `door ${door} links ${entry.name} to ${l.href}, which does not exist`);
    }
    if (door !== 'rent') {
      assert(links.some((l) => l.href === jurisdictionUrl(entry)),
        `door ${door} must still offer the full report the search used to open`);
    }
  }
}
assert(checked > 20, 'link scan checked almost nothing');
// The Deal Calculator takes the place or county from ?geoid= through the
// shared resolver (js/components/jurisdiction-url-context.js), which maps a
// 7-digit place to its county and takes a 5-digit county as is. Found
// 2026-10-26: a county's link dropped the geoid, so Saguache County opened
// the calculator on "+ Choose jurisdiction" with every rent row unavailable.
const dealFor = (e) => doorLinks('build', e).find((l) => l.href.startsWith('deal-calculator.html')).href;
const ctxSrc = fs.readFileSync(path.join(ROOT, 'js/components/jurisdiction-url-context.js'), 'utf8');
assert(/sp\.get\('fips'\) \|\| sp\.get\('geoid'\)/.test(ctxSrc) && /\^\\d\{5,7\}\$/.test(ctxSrc),
  'jurisdiction-url-context.js no longer reads a 5- or 7-digit ?geoid; update doorLinks to match');
assert(/jurisdiction-url-context\.js/.test(fs.readFileSync(path.join(ROOT, 'deal-calculator.html'), 'utf8')),
  'deal-calculator.html no longer loads the URL resolver; update doorLinks to match');
assert.equal(dealFor(place), 'deal-calculator.html?geoid=0832155');
assert.equal(dealFor(county), 'deal-calculator.html?geoid=' + county.geoid);

// ── 4. The page carries the doors the code knows, search first ─────────────
// Home is drawn by hub/home.js since the 13 Nov 2026 rebuild (index.html), so this reads the page as drawn.
const home = require('./helpers/render-home');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(index.includes('src="js/home-jurisdiction-search.js"'), 'index.html must load js/home-jurisdiction-search.js: the card\'s facts come from it');
const blank = home.renderHomeSync();
const doorsShown = home.links((/<div class="home-doors">[\s\S]*?<\/ul>/.exec(blank) || [''])[0])
  .map((l) => [(/[?&]door=([a-z]+)/.exec(l.raw) || [])[1], l.text]).filter((d) => d[0]);
assert.deepEqual(doorsShown, Object.entries(DOORS), 'the doors Home offers must match DOORS in js/home-jurisdiction-search.js');
// On the first phone screen: only the headline and a short opening come before the search. (The old page failed
// this on 14 Oct 2026 with a long paragraph first; the rebuilt one is measured at 390px in the port's persona pass.)
const before = home.text(blank.slice(0, blank.indexOf('id="home-place"')));
assert(blank.indexOf('id="home-place"') > 0 && before.length < 420,
  `the town search must come before everything but the headline and a short opening (${before.length} characters come first)`);
assert(blank.indexOf('id="home-place"') < blank.indexOf('<figure'), 'the town search must come before the first map');
assert(!/class="home-answer"/.test(blank), 'no answer card before a town is picked');

// The card as drawn for a town and for a county: every fact the engine gives is on it with its source, and
// nothing else is shown as a fact. A place with no supported fact says so and shows no number.
for (const entry of [place, county]) {
  const html = home.renderHomeSync('town=' + entry.geoid + '&door=build');
  const card = (/<section class="home-answer"[\s\S]*?<\/section>/.exec(html) || [])[0];
  assert(card, `Home draws no answer card for ${entry.name}`);
  const facts = answerFacts(JSON.parse(fs.readFileSync(path.join(digestDir, entry.geoid + '.json'), 'utf8')));
  assert(facts.length >= 2, `fixture: ${entry.name} has facts to show`);
  const rows = [...card.matchAll(/<div><dt>([\s\S]*?)<\/dt><dd><b>([\s\S]*?)<\/b>([\s\S]*?)<\/dd><\/div>/g)].map((m) => ({ label: home.text(m[1]), value: home.text(m[2]), rest: home.text(m[3]) }));
  assert.deepEqual(rows.map((r) => [r.label, r.value]), facts.map((f) => [f.label, f.value]), `${entry.name}: the card's facts are not the engine's facts, in its order`);
  rows.forEach((r, i) => assert(r.rest.includes(facts[i].source), `${entry.name}: "${r.label}" is shown without its source (${facts[i].source})`));
  // The full report is one link away, on the place the card is about; so is the Deal Calculator for this door.
  const next = home.links(card);
  assert(next.some((l) => l.href === 'places-hub.html#/place/' + entry.geoid), `${entry.name}: the card must link the place's full assessment`);
  const deal = next.find((l) => /deal-calculator/.test(l.raw));
  assert(deal && new URLSearchParams(deal.raw.split('?')[1] || '').get('g') === entry.geoid, `${entry.name}: the build door's Deal Calculator link dropped the place`);
  for (const l of next.filter((x) => x.href && !/^https?:|^#/.test(x.href))) {
    assert(fs.existsSync(path.join(ROOT, home.pageOf(l.href))), `${entry.name}: the card links ${l.href}, which does not exist`);
  }
  assert(next.every((l) => l.href), `${entry.name}: the card has a link with nowhere to go`);
}
{
  // A made-up or malformed place draws no card, and its text is never written into the page.
  for (const bad of ['9912345', '08', '<script>alert(1)</script>', '0832155x']) {
    const html = home.renderHomeSync('town=' + encodeURIComponent(bad));
    assert(!/class="home-answer"/.test(html), `town=${bad} drew an answer card`);
    assert(!html.includes('<script>alert(1)'), 'a typed place id reached the page unescaped');
  }
}

console.log(`Homepage answer card: ${shown} facts agree with the digests (${topCodes} top-coded), ${withheld} unsupported values withheld, ${checked} links checked`);
