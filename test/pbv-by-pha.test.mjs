/**
 * Project-based vouchers: HUD counts them by housing authority but names no
 * buildings, so the hand-checked map layer is partial. Until 2026-10-23 the
 * layer was labelled "PBV (local Housing Authority)" with 1 point and no word
 * that ~6,000 PBV homes exist statewide.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DATA = JSON.parse(read('data/affordable-housing/pbv-by-pha-co.json'));

test('the file is dated and sourced to HUD Picture of Subsidized Households', () => {
  assert.match(DATA.metadata.as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(DATA.metadata.source_url, /^https:\/\/www\.huduser\.gov\//);
  assert.ok(DATA.metadata.source_quote.length > 20);
});

test('totals add up from the authority rows', () => {
  const sum = DATA.authorities.reduce((s, a) => s + (a.pbv_units || 0), 0);
  assert.equal(DATA.totals.pbv_units, sum);
  assert.equal(DATA.totals.authorities_with_pbv, DATA.authorities.length);
  DATA.authorities.forEach((a) => {
    assert.match(a.code, /^CO\d{3}$/);
    if (a.all_voucher_units != null) assert.ok(a.pbv_units <= a.all_voucher_units, a.code);
  });
});

test('the map legend text quotes the same statewide count and date', () => {
  const src = read('js/components/affordable-housing-layer.js');
  const n = DATA.totals.pbv_units.toLocaleString('en-US');
  assert.ok(src.includes(n + ' at ' + DATA.totals.authorities_with_pbv + ' Colorado authorities'), 'legend count');
  const d = new Date(DATA.metadata.as_of + 'T00:00:00Z');
  const label = d.getUTCDate() + ' ' + d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
  assert.ok(src.includes(label), 'legend date ' + label);
});

test('no page calls the hand-checked layer a full PBV inventory', () => {
  ['data-map-browser.html', 'hna-what-housing-exists.html', 'housing-needs-assessment.html',
   'js/components/affordable-housing-layer.js'].forEach((f) => {
    const s = read(f);
    assert.ok(!s.includes('PBV (local'), f);
    assert.ok(/partial/i.test(s), f + ' says partial');
  });
  assert.ok(read('data-map-browser.html').includes("fetch('data/affordable-housing/pbv-by-pha-co.json'"));
});
