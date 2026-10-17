/**
 * The Insights JCHS card labels a figure CONFIRMED only when the data file
 * quotes the JCHS 2026 sentence it comes from, and that sentence carries the
 * number shown. Until 2026-10-17 the card printed 49.7%, 26.4% and a "4.0M
 * supply gap" tagged DATA from a file that called its own values directional
 * estimates; the PDF says 49 percent, 26 percent, and publishes no shortage
 * estimate of its own.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DATA = JSON.parse(read('data/policy/jchs-state-of-nations-housing.json'));
const HTML = read('insights.html');
const card = HTML.slice(HTML.indexOf('id="jchsContextCard"'), HTML.indexOf('</section>', HTML.indexOf('id="jchsContextCard"')));

// Whole numeric tokens in a quote ("22.7", "771,480", "2024"), so 4 never
// matches inside 49 or 2024.
const tokens = (q) => new Set([...q.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]));
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

test('each CONFIRMED tile renders a quoted field whose number the quote carries', () => {
  const tiles = card.split('<div class="stat-card"').slice(1);
  const confirmed = tiles.filter((t) => />CONFIRMED</.test(t));
  assert.ok(confirmed.length >= 3, `scan found ${confirmed.length} CONFIRMED tiles`);
  confirmed.forEach((tile) => {
    const id = (tile.match(/class="stat-value" id="(\w+)"/) || [])[1];
    assert.ok(id, 'CONFIRMED tile has a value element');
    // The value element is filled from exactly one field, with nothing typed.
    const set = card.match(new RegExp(`setText\\('${id}',\\s*([^;]+)\\);`));
    assert.ok(set, `${id} is filled by the card script`);
    const fields = [...set[1].matchAll(/\bnb\.(\w+)/g)].map((m) => m[1]);
    assert.equal(new Set(fields).size, 1, `${id} reads one field`);
    assert.doesNotMatch(set[1].replace(/\bnb\.\w+/g, ''), /['"][^'"]*\d[^'"]*['"]/, `${id} prints no typed number`);
    const field = fields[0];
    const quote = DATA.meta.confirmed_fields[field];
    assert.ok(quote, `${field} (shown in ${id}) has a quote from the PDF`);
    const v = DATA.national_benchmarks[field];
    assert.ok(typeof v === 'number', `${field} is a number`);
    assert.ok(tokens(quote).has(fmt(v)), `${field}: the quote carries ${fmt(v)} as a whole number`);
  });
});

test('every quoted field carries its own number', () => {
  Object.entries(DATA.meta.confirmed_fields).forEach(([field, quote]) => {
    const v = DATA.national_benchmarks[field];
    (Array.isArray(v) ? v : [v]).forEach((n) => assert.ok(tokens(quote).has(fmt(n)), `${field}: quote carries ${fmt(n)}`));
  });
});

test('the card links the PDF the quotes come from', () => {
  assert.match(DATA.meta.pdf_url, /^https:\/\/www\.jchs\.harvard\.edu\/.+\.pdf$/);
  assert.ok(card.includes(DATA.meta.pdf_url), 'card links data meta.pdf_url');
});

test('no JCHS shortage estimate is shown while JCHS publishes none', () => {
  assert.equal(DATA.national_benchmarks.supply_gap_estimate_millions, null);
  assert.ok(DATA.national_benchmarks.supply_gap_unavailable_reason);
  assert.doesNotMatch(card, /supply_gap_estimate_millions/);
});
