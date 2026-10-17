/**
 * Typed facts in the papers must agree with the data files they restate.
 *
 * apa-white-paper.html and the prose of working-paper.html are hand-written,
 * so nothing regenerates them when the data moves. On 2026-10-17 they carried
 * a Fruita Proposition 123 filing year of 2024 (the filing record says
 * 2023-07-18), a Palisade filing date of 2024-08-29 (record: 2025-10-29), a
 * May 2026 home value that the August 2026 index had replaced, and a research
 * brief citing a transit-zone map check three weeks older than the record.
 * Each assertion names the record the sentence must agree with, so updating
 * the data without the sentence (or the sentence without the data) fails.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const P123 = json('data/policy/prop123_jurisdictions.json');
const p123Rows = P123.jurisdictions;
const filing = (name) => {
  const row = p123Rows.find((r) => r.name === name);
  assert.ok(row && row.filing_date, `prop123_jurisdictions.json has a filing date for ${name}`);
  return row.filing_date;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

test('white paper: Prop 123 filing years agree with the filing record', () => {
  const html = read('apa-white-paper.html');
  const m = html.match(/Fruita, Mesa County and Grand Junction all filed Proposition 123 commitments in (\d{4})\./);
  assert.ok(m, 'white paper states the three filing years');
  const years = new Set(['City of Fruita', 'Mesa County', 'City of Grand Junction'].map((n) => filing(n).slice(0, 4)));
  assert.equal(years.size, 1, 'the sentence names one year, so the record must have one');
  assert.equal(m[1], [...years][0]);
});

test('white paper: Fruita home value and month agree with the place summary', () => {
  const html = read('apa-white-paper.html');
  const hv = json('data/hna/summary/0828745.json');
  let mhv = null;
  (function find(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'median_home_value' && v && typeof v === 'object') mhv = v; else find(v); } })(hv);
  assert.ok(mhv && mhv.value > 0 && mhv.as_of, 'summary carries a dated median home value');
  const month = MONTHS[Number(mhv.as_of.slice(5, 7)) - 1] + ' ' + mhv.as_of.slice(0, 4);
  const shown = `$${mhv.value.toLocaleString('en-US')} (Zillow's home value index for ${month})`;
  assert.ok(html.includes(shown), `white paper shows ${shown}`);
  assert.ok(html.includes(`Zillow Home Value Index, ${month}.`), 'source list names the same month');
});

test('working paper: Palisade and Mesa County filing dates agree with the filing record', () => {
  const html = read('working-paper.html');
  const pal = filing('Town of Palisade');
  const mesa = filing('Mesa County');
  assert.ok(html.includes(`Proposition&nbsp;123 commitment on <strong>${pal}</strong>`), `case study says ${pal}`);
  assert.ok(html.includes(`Town of Palisade filed ${pal}; Mesa County ${mesa}.`), 'source note agrees');
});

test('research brief: transit-zone map check date agrees with the status record', () => {
  const status = json('data/policy/thiz-map-status.json');
  const [y, mo, d] = status.last_checked.split('-').map(Number);
  const when = `${MONTHS[mo - 1]} ${d}, ${y}`;
  const feed = read('data/policy_briefs_curated.json');
  const m = feed.match(/tracked source was last checked ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  assert.ok(m, 'THIZ brief states when the map status was checked');
  assert.equal(m[1], when);
});

test('housing-costs article: snapshot and statewide rent agree with the data files', () => {
  const html = read('article-co-housing-costs.html');
  // The snapshot quotes two COSTHPI index values; each must be the FRED value
  // for the quarter it names, and the stated change must follow from them.
  const m = html.match(/\+?(-?\d+\.\d)% year over year<\/strong> in Q(\d) (\d{4}) \((\d+\.\d+) against (\d+\.\d+) in Q\2 (\d{4})\)/);
  assert.ok(m, 'snapshot states the COSTHPI change with both index values');
  const [, pct, q, y, now, prev, yPrev] = m;
  const obs = json('data/fred-data.json').series.COSTHPI.observations;
  const at = (year, quarter) => obs.find((o) => o.date === `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`);
  assert.equal(Number(at(y, q)?.value), Number(now), `COSTHPI Q${q} ${y} = ${now}`);
  assert.equal(Number(at(yPrev, q)?.value), Number(prev), `COSTHPI Q${q} ${yPrev} = ${prev}`);
  assert.equal(((now / prev - 1) * 100).toFixed(1), pct, 'stated change follows from the two values');

  const co = json('data/census-acs-state.json').data.find((r) => r.state_fips === '08');
  assert.ok(html.includes(`Statewide median of $${co.median_gross_rent.toLocaleString('en-US')}/month`),
    `statewide median rent equals census-acs-state.json ($${co.median_gross_rent}, ACS ${co.year})`);
  assert.ok(html.includes(`ACS ${co.year - 4}–${co.year} 5-year`), 'rent vintage label agrees with the data year');

  // Nothing on the page computes a coefficient of variation, so the page
  // must not claim to flag figures by one.
  assert.ok(!/figures are flagged as unreliable/.test(html), 'no claim of CV flagging that the page does not do');
});

test('fair-housing article: no surface still calls the closed comment period open', () => {
  const html = read('article-fair-housing-rollback.html');
  // The comment deadline the page names must be in the past tense once it has
  // passed; the og/meta descriptions and lede are what link previews show.
  const m = html.match(/comment period[^.]{0,40}?(\d{1,2}) October (\d{4})/);
  assert.ok(m, 'page names the Title VI comment deadline');
  const deadline = new Date(`${m[2]}-10-${m[1].padStart(2, '0')}T23:59:59Z`);
  if (Date.now() > deadline.getTime()) {
    assert.ok(!/still open for comment|comments close \d|Comment before \d/.test(html),
      'after the deadline no surface invites comments or calls the period open');
  }
});
