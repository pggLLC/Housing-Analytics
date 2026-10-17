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

test('every field the card shows as CONFIRMED is quoted from the PDF with its number', () => {
  const reads = [...card.matchAll(/nb\.(\w+)/g)].map((m) => m[1]);
  assert.ok(reads.length >= 4, 'scan found the fields the card reads');
  const confirmedTags = (card.match(/>CONFIRMED</g) || []).length;
  const quoted = DATA.meta.confirmed_fields;
  let checked = 0;
  reads.forEach((field) => {
    const v = DATA.national_benchmarks[field];
    const quote = quoted[field];
    if (!quote) return;
    const nums = Array.isArray(v) ? v : [v];
    nums.forEach((n) => {
      const shown = Number.isInteger(n) ? n.toLocaleString('en-US') : String(n);
      assert.ok(quote.includes(shown), `${field}: the quoted sentence carries ${shown}`);
    });
    checked += 1;
  });
  // Each CONFIRMED tag on the card is backed by a quoted field.
  assert.ok(checked >= confirmedTags && confirmedTags >= 3, `${checked} quoted fields for ${confirmedTags} CONFIRMED tags`);
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
