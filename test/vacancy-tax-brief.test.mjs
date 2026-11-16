/**
 * The vacancy tax brief (co-vacancy-tax-2026) is pinned to what it must agree
 * with, not to its wording:
 *   - every law and measure record in data/policy/vacancy-tax.json carries a
 *     source with a quote, a check date and a later review date, and is watched
 *     by the source watch and the review reminders;
 *   - the brief's tables, picture and limits are what the builder makes from the
 *     committed data (so a data change cannot leave them stale);
 *   - the revenue arithmetic is recomputed here from ACS B25004, independently
 *     of scripts/policy/vacancy-tax.mjs;
 *   - every dollar, percent or count in the prose sits in a recorded quote from a
 *     cited source; estimates live only in the computed tables;
 *   - every figure says who pays (owners) and that renters do not;
 *   - the reader renders every section, table and the picture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build, BRIEF_ID, FEED, SVG } from '../scripts/policy/build_vacancy_tax_brief.mjs';
import { FILES } from '../scripts/audit/policy-review-reminders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const TAX = json('data/policy/vacancy-tax.json');
const VAC = json('data/hna/vacancy-status.json');
const HU = json('data/hna/housing-units-b25001.json');
const FEEDDATA = json(FEED);
const brief = FEEDDATA.briefs.find((b) => b.id === BRIEF_ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('the brief is curated, dated and names its data file', () => {
  assert.ok(brief, `curated feed has no ${BRIEF_ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/policy/vacancy-tax.json');
  assert.equal(brief.verified, TAX.meta.as_of);
  assert.equal(FEEDDATA.meta.brief_count, FEEDDATA.briefs.length);
});

test('every law and measure record has a quoted, dated source and a later review date', () => {
  const STATUS = new Set(['adopted', 'failing_unofficial', 'failed', 'not_referred', 'in_force', 'no_authority']);
  const records = [...TAX.authority, ...TAX.measures];
  assert.ok(TAX.measures.length >= 4 && TAX.authority.length >= 4, 'too few records');
  for (const r of records) {
    assert.ok(STATUS.has(r.status), `${r.id}: status ${r.status}`);
    for (const s of [r.source, ...(r.more_sources || [])]) {
      assert.match(s.url, /^https:\/\//, `${r.id}: source url`);
      assert.ok(s.quote && s.quote.length > 15, `${r.id}: source has no quote`);
      assert.ok(s.title && s.publisher, `${r.id}: source is not named`);
    }
    assert.match(r.verification.checked, DAY, `${r.id}: check date`);
    assert.ok(['primary', 'reported'].includes(r.verification.level), `${r.id}: verification level`);
    assert.match(r.review_by, DAY, `${r.id}: review date`);
    assert.ok(r.review_by > r.verification.checked, `${r.id}: review_by must come after the check`);
  }
  // A measure's dollar figure must be the one its source states, or come with a note saying where it is from.
  for (const m of TAX.measures) {
    if (m.expected_revenue_usd == null) { assert.ok(m.expected_revenue_note, `${m.id}: say why no revenue`); continue; }
    assert.ok(m.expected_revenue_note, `${m.id}: revenue needs its basis`);
  }
});

test('the source watch and the review reminders watch every record', () => {
  for (const key of ['authority', 'measures']) {
    assert.ok(FILES.some((f) => f.file === 'data/policy/vacancy-tax.json' && f.key === key), `${key} is not watched`);
  }
});

test('the tables, picture and limits are what the builder makes from the committed data', () => {
  const out = build();
  assert.equal(read(FEED), out[FEED], `${FEED} is stale: run node scripts/policy/build_vacancy_tax_brief.mjs`);
  assert.equal(read(SVG), out[SVG], `${SVG} is stale: run node scripts/policy/build_vacancy_tax_brief.mjs`);
  assert.deepEqual(section('limits').items, TAX.meta.known_gaps);
  assert.equal(section('tried').table.rows.length, TAX.measures.length);
});

test('the revenue arithmetic, recomputed here from ACS B25004', () => {
  const est = TAX.meta.estimate;
  const types = new Map(TAX.municipal_types.places.map((p) => [p.name, p]));
  const fmt = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3).toLocaleString('en-US')}K`);
  const rows = section('estimates').table.rows;
  assert.ok(rows.length >= 15, `only ${rows.length} rows`);
  let prev = Infinity;
  for (const row of rows) {
    const p = types.get(row[0]);
    assert.ok(p, `${row[0]} is not in the municipal type list`);
    assert.ok(/^Home rule|^Consolidated/.test(p.type), `${row[0]} cannot levy a vacancy tax (${p.type})`);
    const g = VAC.geographies[p.geoid].values;
    const units = HU.geographies[p.geoid].housing_units;
    const at = (c) => (g.seasonal_recreational_occasional * c.seasonal_share + g.other_vacant * c.other_share) * c.collected * est.rate_usd;
    const mid = at(est.cases.middle);
    assert.ok(mid <= prev, 'rows are not in descending order of the middle case');
    prev = mid;
    assert.equal(row[1], `${fmt(mid)} (${fmt(at(est.cases.low))} to ${fmt(at(est.cases.high))})`, `${row[0]}: revenue`);
    assert.ok(row[3].startsWith(g.seasonal_recreational_occasional.toLocaleString('en-US')), `${row[0]}: seasonal count`);
    assert.equal(row[2], `${Math.round(((g.seasonal_recreational_occasional + g.other_vacant) / units) * 100)}%`, `${row[0]}: base share`);
  }
  // Boulder, by hand: (432 x 0.6 + 810 x 0.35) x 0.75 x $4,000 = $1,627,800.
  const boulder = rows.find((r) => r[0] === 'Boulder');
  assert.ok(boulder && boulder[1].startsWith('$1.6M'), 'Boulder middle case');
  for (const row of section('statutory').table.rows) {
    const name = row[0].replace(/ \((statutory|home rule) (town|city)\)$/, '');
    assert.ok(/^Statutory/.test(types.get(name).type), `${row[0]} is not statutory`);
  }
});

const FIGURE = /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;
function prose() {
  const parts = [brief.title, brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    if (s.id === 'limits') continue; // the data file's own gaps, pinned above
    parts.push(...(s.paragraphs || []), ...(s.items || []));
  }
  return squash(parts.join(' '));
}

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  for (const r of [...TAX.authority, ...TAX.measures]) {
    for (const s of [r.source, ...(r.more_sources || [])]) assert.ok(cited.has(s.url), `${r.id}: ${s.url} is not cited`);
  }
  const quoted = squash(brief.source_quotes.map((q) => q.quote).join(' ')).replace(/–/g, '-');
  const figures = prose().replace(/\b[A-Z]{2}\d{2}-\d+\b/g, '').match(FIGURE) || [];
  assert.ok(figures.length >= 10, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(quoted.includes(f), `${f} is in the brief but in no source quote`);
});

test('every figure says owners pay and renters do not', () => {
  assert.match(brief.takeaway, /owners of empty homes pay it; renters do not/i);
  assert.match(section('estimates').table.caption, /paid by owners/);
  assert.match(section('estimates').figure.alt, /paid by owners of vacant homes/);
  assert.match(read(SVG), /renters pay nothing/);
  assert.match(section('tried').table.columns.join(' '), /paid by owners/);
});

test('the reader renders every section, table and the picture', async (t) => {
  const dom = new JSDOM(read('research-brief.html'), {
    url: 'https://pggllc.github.io/Housing-Analytics/research-brief.html?id=' + BRIEF_ID,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => structuredClone(FEEDDATA) });
      window.print = () => {};
    },
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const host = doc.getElementById('brief-content');
  for (let i = 0; i < 100 && host.hidden; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(host.hidden, false, 'the reader never rendered');
  for (const item of brief.sections) {
    const node = doc.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length, `${item.id}: list`);
    if (item.table) assert.equal(node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`).length, item.table.rows.length, `${item.id}: table`);
  }
  const img = doc.querySelector('[data-figure="estimates"] img');
  assert.ok(img, 'the picture is not rendered');
  assert.equal(img.getAttribute('src'), SVG);
  assert.equal(doc.querySelectorAll('#brief-sources li').length, brief.articles.length);
});
