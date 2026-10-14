/**
 * "Who has applied for housing tax credits here" — the panel under each
 * jurisdiction brief on developer-brief.html, from
 * data/jurisdiction-briefs/_lihtc-applications.json
 * (scripts/funding/build_lihtc_applications.py; Python side is
 * tests/test_lihtc_applications.py).
 *
 * What a reader relies on, asserted against the data file rather than copy:
 *  - the panel lists exactly the applications the file places in that
 *    jurisdiction, and its awarded / not-funded counts are those rows' counts;
 *  - a file that could not be loaded is said, never shown as "no applications";
 *  - a scattered-site application shows in each place it builds in;
 *  - text from the PDFs is escaped;
 *  - the file stays off the public site, with the rest of the briefs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('../js/components/jurisdiction-brief.js');
const { _renderActivity } = globalThis.JurisdictionBrief;
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_lihtc-applications.json'), 'utf8'));

function render(geoid, label, data) {
  const dom = new JSDOM(`<div id="m">${_renderActivity(geoid, label, data)}</div>`);
  return dom.window.document.getElementById('m');
}

const inPlace = (g) => DATA.applications.filter((a) => (g.length === 5 ? a.county_fips_all : a.place_geoids).includes(g));

test('the panel lists exactly the applications the file places here, with agreeing counts', () => {
  const checked = [];
  for (const geoid of ['0820000', '0816000', '08045', '0828745']) {
    const rows = inPlace(geoid);
    assert.ok(rows.length > 0, `no applications for ${geoid}: the scan found nothing to check`);
    const el = render(geoid, 'Somewhere', DATA);
    const items = el.querySelectorAll('ul li .jbrief-lihtc__round');
    assert.equal(items.length, rows.length, geoid);
    const names = [...el.querySelectorAll('li .jbrief-lihtc__name')].map((n) => n.textContent);
    for (const r of rows) assert.ok(names.includes(r.name), `${r.name} missing for ${geoid}`);
    const won = rows.filter((r) => r.outcome === 'awarded').length;
    const lost = rows.filter((r) => r.outcome === 'not_awarded').length;
    assert.match(el.textContent, new RegExp(`${won} awarded, ${lost} not funded`));
    assert.match(el.querySelector('.jbrief-lihtc__title').textContent, new RegExp(`\\(${rows.length}\\)`));
    checked.push(geoid);
  }
  assert.equal(checked.length, 4);
});

test('every listed application links its CHFA report and quotes its row', () => {
  const el = render('0820000', 'City of Denver', DATA);
  const links = [...el.querySelectorAll('details a')].map((a) => a.getAttribute('href'));
  assert.ok(links.length >= inPlace('0820000').length);
  for (const href of links) assert.match(href, /^https:\/\/www\.chfainfo\.com\//);
  assert.equal(el.querySelectorAll('q').length, inPlace('0820000').length);
});

test('a missing file says so instead of showing no applications', () => {
  const el = render('0820000', 'City of Denver', null);
  assert.match(el.textContent, /could not be loaded/);
  assert.doesNotMatch(el.textContent, /No applications here/);
});

test('no applications is said plainly, with the window', () => {
  const el = render('0899999', 'Nowhere', { meta: { first_year: 2023 }, applications: [] });
  assert.match(el.textContent, /No applications here since 2023/);
});

test('a scattered-site application shows in every place it builds in, and text is escaped', () => {
  const app = {
    name: 'Two Towns <b>Homes</b>', sponsor: 'A & B', round_label: 'Rolling federal 4% list', credit_type: '4%',
    outcome: 'in_review', place_geoids: ['0800001', '0800002'], county_fips_all: ['08037', '08117'],
    quote: 'Name: Two Towns <b>Homes</b>', source_url: 'https://www.chfainfo.com/x.pdf', source_file: 'x.pdf'
  };
  const data = { meta: { first_year: 2023 }, applications: [app] };
  for (const g of ['0800001', '0800002', '08037', '08117']) {
    const el = render(g, 'X', data);
    assert.equal(el.querySelectorAll('.jbrief-lihtc__name').length >= 1, true, g);
    assert.equal(el.querySelector('b'), null, 'PDF text must not render as markup');
  }
  assert.equal(render('0800003', 'X', data).querySelectorAll('li').length, 0);
});

test('the applications file stays off the public site with the briefs', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build-public-site.mjs'), 'utf8');
  assert.match(build, /'data\/jurisdiction-briefs',/);
  assert.match(build, /'js\/components\/jurisdiction-brief\.js',/);
  assert.doesNotMatch(JSON.stringify(DATA.applications), /@/);
});
