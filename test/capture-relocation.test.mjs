#!/usr/bin/env node
// Second capture line: relocation share only from comparables measured at the
// county line, capped by lower-paid 20-60 mile in-commuters; otherwise no number.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => fs.readFileSync(p, 'utf8');
const comps = JSON.parse(read('data/market/relocation-comparables.json'));
const commute = JSON.parse(read('data/market/commute-strength.json'));
const gap = JSON.parse(read('data/co_ami_gap_by_county.json'));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  PASS ' + name); };
const settle = () => new Promise((r) => setTimeout(r, 30));

check('every comparable is sourced, dated by round, and measured', () => {
  assert.ok(comps.comparables.length >= 4);
  for (const c of comps.comparables) {
    assert.match(c.county_fips, /^08\d{3}$/);
    assert.ok(commute.counties[c.county_fips], c.id + ' county in commute data');
    assert.ok(['outside_county', 'outside_pma'].includes(c.measure), c.id);
    assert.match(c.source_url, /^https:\/\/(www\.chfainfo\.com|assets\.bouldercounty\.gov)\//);
    assert.ok(Number.isInteger(c.pdf_page) && c.pdf_page > 0);
    assert.ok(c.quote.length > 40 && c.round && c.property);
    assert.ok(c.share_low > 0 && c.share_low <= c.share_high && c.share_high < 100);
    assert.ok(c.quote.includes(String(c.share_low)), c.id + ' quote carries its share');
  }
});

function boot(subject) {
  const w = new JSDOM('<div id="capture"></div>', { url: 'https://example.org/market-analysis.html', runScripts: 'outside-only' }).window;
  const files = { 'co_ami_gap_by_county': gap, 'relocation-comparables': comps, 'commute-strength': commute };
  w.fetch = (url) => {
    const key = Object.keys(files).find((k) => String(url).includes(k));
    return Promise.resolve({ ok: !!key, json: () => Promise.resolve(files[key]) });
  };
  w.SubjectProject = { get: () => subject, subscribe: () => {} };
  w.eval(read('js/components/subject-capture-stack.js'));
  return w;
}

const W = boot({});
const line = W.SubjectCaptureStack.relocationLine;
const hh = (f, t) => gap.counties.find((c) => c.fips === f).households_le_ami_pct[t];

check('Summit uses the low end (10%) of Smith Ranch and stays under the commuter cap', () => {
  const base = hh('08117', '60');
  const r = line('08117', 40, base, comps, commute);
  assert.equal(r.used.id, 'smith-ranch-summit');
  assert.equal(r.share, 10);
  assert.equal(r.added, Math.round(base * 0.1 / 0.9));
  assert.equal(r.capped, false);
  assert.equal(r.cap, commute.counties['08117'].far_low);
  assert.ok(Math.abs(r.rate - 40 / (base + r.added) * 100) < 1e-9);
  assert.ok(r.rate < r.baseRate);
});

check('the added pool never exceeds lower-paid far in-commuters', () => {
  const tight = { counties: { '08013': { far_low: 50 } } };
  const r = line('08013', 40, 10000, comps, tight);
  assert.equal(r.share, 19);
  assert.equal(r.added, 50);
  assert.equal(r.capped, true);
});

check('no comparable on file gives no number', () => {
  const r = line('08077', 40, hh('08077', '60'), comps, commute);
  assert.equal(r.rate, null);
  assert.equal(r.used, null);
  assert.equal(r.evidence.length, 0);
  assert.equal(r.cap, commute.counties['08077'].far_low);
});

check('market-area shares are shown as evidence but never applied to the county pool', () => {
  for (const f of ['08031', '08001']) {
    const r = line(f, 40, 50000, comps, commute);
    assert.equal(r.rate, null, f);
    assert.ok(r.evidence.length >= 1 && r.evidence.every((c) => c.measure === 'outside_pma'));
  }
});

check('a comparable without the commuter cap gives no number', () => {
  for (const c of [null, { counties: {} }, { counties: { '08013': { far_low: null } } }]) {
    const r = line('08013', 40, 10000, comps, c);
    assert.equal(r.rate, null);
    assert.equal(r.added, null);
    assert.equal(r.noCap, true);
  }
});

check('missing files degrade to no number', () => {
  const r = line('08117', 40, 2000, null, null);
  assert.equal(r.rate, null);
  assert.equal(r.cap, null);
});

const unit = (n) => ({ ami_tier: 60, bedrooms: '2BR', count: n });

const w1 = boot({ county_fips: '08117', unit_mix: [unit(40)], in_migration_pct: 20 });
w1.SubjectCaptureStack.render(w1.document.getElementById('capture'));
await settle();
check('Summit card shows both lines, the quote and the page link; manual in-migration does not stack', () => {
  const box = w1.document.querySelector('[data-relocation-line]');
  assert.ok(box);
  const base = hh('08117', '60');
  const expect = (40 / (base + Math.round(base / 9)) * 100).toFixed(1);
  assert.equal(box.querySelector('[data-relocation-rate]').getAttribute('data-relocation-rate'), expect);
  assert.match(box.textContent, new RegExp('without relocation ' + (40 / base * 100).toFixed(1).replace('.', '\\.') + '%'));
  assert.match(box.textContent, /low end \(10%\)/);
  assert.match(box.textContent, /20 to 60 miles/);
  const a = box.querySelector('[data-relocation-comp="smith-ranch-summit"] a');
  assert.ok(a.getAttribute('href').endsWith('#page=78'));
  assert.match(a.getAttribute('href'), /^https:\/\/www\.chfainfo\.com\//);
});

const w2 = boot({ county_fips: '08077', unit_mix: [unit(40)] });
w2.SubjectCaptureStack.render(w2.document.getElementById('capture'));
await settle();
check('Mesa card says no comparable evidence and prints no relocation rate', () => {
  const box = w2.document.querySelector('[data-relocation-line]');
  assert.equal(box.querySelector('[data-relocation-rate]').getAttribute('data-relocation-rate'), 'none');
  assert.match(box.textContent, /No comparable evidence of tenants relocating/);
  assert.equal(box.querySelectorAll('[data-relocation-comp]').length, 0);
});

const w4 = boot({ county_fips: '08117', unit_mix: [unit(40)] });
w4.fetch = ((f) => (url) => String(url).includes('commute-strength') ? Promise.resolve({ ok: false, json: () => Promise.resolve(null) }) : f(url))(w4.fetch);
w4.SubjectCaptureStack.render(w4.document.getElementById('capture'));
await settle();
check('commuter file failure withholds the Summit relocation rate', () => {
  const box = w4.document.querySelector('[data-relocation-line]');
  assert.equal(box.querySelector('[data-relocation-rate]').getAttribute('data-relocation-rate'), 'none');
  assert.match(box.textContent, /could not be loaded/);
  assert.doesNotMatch(box.textContent, /The cap is/);
});

const w3 = boot({ county_fips: '08031', unit_mix: [unit(40)] });
w3.SubjectCaptureStack.render(w3.document.getElementById('capture'));
await settle();
check('Denver card lists A Line Flats for context only', () => {
  const box = w3.document.querySelector('[data-relocation-line]');
  assert.equal(box.querySelector('[data-relocation-rate]').getAttribute('data-relocation-rate'), 'none');
  assert.match(box.querySelector('[data-relocation-comp="a-line-flats-denver"]').textContent, /shown for context only/);
});

check('suite runs in CI', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:capture-relocation'], 'node test/capture-relocation.test.mjs');
  assert.match(pkg.scripts['ci:part-8'], /test:capture-relocation/);
});

console.log('Capture relocation: ' + passed + ' passed');
