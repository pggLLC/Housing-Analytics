#!/usr/bin/env node
// test/home-jurisdiction-search.test.js
//
// B-06 / #1097: guard the homepage jurisdiction search's pure
// search/routing helpers, and that Home still loads them and offers a labelled search.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  MAX_RESULTS,
  DOORS,
  searchJurisdictions,
  jurisdictionUrl
} = require('../js/home-jurisdiction-search.js');

const registry = require('../data/hna/geography-registry.json');
const entries = registry.geographies || [];
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const homeHelper = require('./helpers/render-home');

assert.equal(entries.length, 546, 'cleaned geography registry should expose 546 rows');

const fixtureEntries = [
  { geoid: '0812910', name: 'La Junta (city)', type: 'place' },
  { geoid: '0870310', name: 'Salida (city)', type: 'place' },
  { geoid: '08045', name: 'Garfield County', type: 'county' },
  { geoid: '0803620', name: 'Aspen (city)', type: 'place' },
  { geoid: '0812345', name: 'Alamosa (city)', type: 'place' },
  { geoid: '0899999', name: 'Aspen Park CDP', type: 'cdp' },
  { geoid: '0800001', name: 'Lakewood (city)', type: 'place' },
  { geoid: '0800002', name: 'Lafayette (city)', type: 'place' },
  { geoid: '0800003', name: 'Las Animas (city)', type: 'place' },
  { geoid: '0800004', name: 'Larkspur (town)', type: 'place' },
  { geoid: '0800005', name: 'Laporte CDP', type: 'cdp' },
  { geoid: '0800006', name: 'La Veta (town)', type: 'place' }
];
const prefixFixtureEntries = [
  { geoid: '0812910', name: 'La Junta (city)', type: 'place' },
  { geoid: '0899998', name: 'Mala Vista (city)', type: 'place' }
];

assert.deepEqual(searchJurisdictions(null, 'aspen'), [], 'null entries should return no matches');
assert.deepEqual(searchJurisdictions(fixtureEntries, '   '), [], 'blank queries should return no matches');

assert.equal(
  searchJurisdictions(fixtureEntries, 'ASPEN')[0].geoid,
  '0803620',
  'matching should be case-insensitive'
);

const laResults = searchJurisdictions(prefixFixtureEntries, 'la').map((entry) => entry.name);
assert.equal(laResults[0], 'La Junta (city)', 'prefix matches should rank before mid-word matches');
assert(laResults.indexOf('Mala Vista (city)') > 0, 'mid-word hits should rank after prefix hits');

assert.equal(
  searchJurisdictions(fixtureEntries, 'a').length,
  MAX_RESULTS,
  'default result cap should use MAX_RESULTS'
);
assert.equal(
  searchJurisdictions(fixtureEntries, 'a', 3).length,
  3,
  'explicit result cap should be honored'
);

assert.equal(
  jurisdictionUrl({ geoid: '08045', type: 'county' }),
  'housing-needs-assessment.html?geoid=08045&geoType=county&auto=1',
  'county routes should use HNA profile URL with county geoType'
);
assert.equal(
  jurisdictionUrl({ geoid: '0803620', type: 'place' }),
  'housing-needs-assessment.html?geoid=0803620&geoType=place&auto=1',
  'place routes should use HNA profile URL with place geoType'
);
assert.equal(jurisdictionUrl({ geoid: '0803620' }), null, 'missing type should not route');
assert.equal(jurisdictionUrl({ type: 'place' }), null, 'missing geoid should not route');

const aspen = searchJurisdictions(entries, 'aspen')[0];
assert(aspen, 'real registry search should find Aspen');
assert.equal(aspen.geoid, '0803620', 'Aspen fixture should use the cleaned registry GEOID');
assert.equal(aspen.type, 'place', 'Aspen fixture should be a place');
assert(
  jurisdictionUrl(aspen).startsWith('housing-needs-assessment.html?'),
  'Aspen routed URL should point at the HNA profile'
);

const garfieldResults = searchJurisdictions(entries, 'garfield');
const garfield = garfieldResults.find((entry) => entry.geoid === '08045');
assert(garfield, 'real registry search should find Garfield County');
assert.equal(garfield.geoid, '08045', 'Garfield County fixture should use county GEOID 08045');
assert.equal(garfield.type, 'county', 'Garfield fixture should be a county');
assert(
  jurisdictionUrl(garfield).startsWith('housing-needs-assessment.html?'),
  'Garfield routed URL should point at the HNA profile'
);

// Home is drawn by hub/home.js since the 13 Nov 2026 rebuild. The old page's combobox and listbox are gone: the
// search is a labelled box with the matches listed under it as ordinary links, so the ARIA wiring this used to
// pin has nothing to describe. What must still hold: the page loads this file (the answer card's facts come from
// it), the box is there and labelled, typing lists matches that each pick a place, and a pick is a real place.
assert(indexHtml.includes('src="js/home-jurisdiction-search.js"'), 'index.html must include src="js/home-jurisdiction-search.js"');
{
  const blank = homeHelper.renderHomeSync();
  assert(/<input[^>]*id="home-place"/.test(blank), 'Home must draw the town and county search box (#home-place)');
  assert(/<label for="home-place">[^<]*\S[^<]*<\/label>/.test(blank), 'the search box must have a visible label');
  const typed = homeHelper.renderHomeSync('q=aspen');
  const found = (/<div class="hh-found">[\s\S]*?<\/ul><\/div>/.exec(typed) || [''])[0];
  const picks = homeHelper.links(found);
  assert(picks.length >= 1 && picks.length <= MAX_RESULTS, `typing "aspen" lists ${picks.length} matches; expected 1 to ${MAX_RESULTS}`);
  const aspenPick = picks.find((l) => /^Aspen\b/.test(l.text));
  assert(aspenPick, 'typing "aspen" must list Aspen');
  assert.equal(aspenPick.raw, '#/?town=' + aspen.geoid, 'the Aspen match must pick the registry\'s Aspen');
  for (const l of picks) {
    const g = (/^#\/\?town=(\d{5,7})$/.exec(l.raw) || [])[1];
    assert(g && entries.some((e) => e.geoid === g), `match "${l.text}" picks ${l.raw}, which is not a place in the registry`);
  }
  assert(!/class="hh-found"/.test(blank), 'no matches are listed before anything is typed');
  const nothing = homeHelper.renderHomeSync('q=zzzzqq');
  const none = (/<div class="hh-found">[\s\S]*?<\/ul><\/div>/.exec(nothing) || [''])[0];
  assert(/role="status">[^<]*\bNo\b/.test(none) && homeHelper.links(none).length === 0,
    'a search with no match must say so and list nothing');
}

// A link shared from the old homepage (index.html?town=<geoid>&door=<role>) still opens that place's answer and
// that role's next steps (Codex review, PR 2804). The old page read both from the address before the #; the
// rebuilt page reads after it, so the page's own opening script carries them across. Run here as the browser
// runs it: the page's inline script, against a stand-in address bar.
{
  const vm = require('node:vm');
  const inline = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((t) => t.includes('history.replaceState'));
  assert(inline, 'index.html no longer has the opening script that sets the route');
  const open = (search, hash) => {
    const location = { pathname: '/index.html', search, hash };
    const history = { replaceState(_s, _t, url) {
      const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
      if (m[1]) { location.pathname = m[1]; location.search = m[2] || ''; }
      location.hash = m[3] || '';
    } };
    vm.runInNewContext(inline, { location, history, URLSearchParams, localStorage: { getItem: () => null }, document: { documentElement: { classList: { add() {} } } } });
    return location;
  };
  const shared = open('?town=' + aspen.geoid + '&door=build', '');
  const route = new URLSearchParams(shared.hash.replace(/^#\/\??/, ''));
  assert.equal(route.get('town'), aspen.geoid, 'an old shared link lost its town: the page opened on ' + shared.hash);
  assert.equal(route.get('door'), 'build', 'an old shared link lost its role: the page opened on ' + shared.hash);
  assert.equal(shared.search, '', 'the town and role must move, not be left in both places');
  // Home then draws what the link was shared for.
  const drawn = homeHelper.renderHomeSync(shared.hash.replace(/^#\/\??/, ''));
  assert(/class="ha-facts"/.test(drawn) && homeHelper.text(drawn).includes('Aspen'), 'the carried link draws no answer card for Aspen');
  assert(homeHelper.text(drawn).includes(DOORS.build), 'the carried link does not show the role it was shared with');
  // Other settings in the address stay where they were, and a link that names its own view is left alone.
  assert.equal(open('?utm_source=x&town=' + aspen.geoid, '').search, '?utm_source=x', 'another setting in the address was dropped');
  assert.equal(open('', '').hash, '#/', 'a plain visit must open Home');
  const deep = open('?town=' + aspen.geoid, '#/sitemap');
  assert.equal(deep.hash, '#/sitemap', 'a link to another view must not be rewritten');
  assert.equal(open('?town=<script>', '').hash, '#/', 'a town that is not a plain code must not be carried');
}

console.log('Homepage jurisdiction search (#1097): PASS');
