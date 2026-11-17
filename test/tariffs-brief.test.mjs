/**
 * The tariffs brief (tariffs-construction-costs-2026) is pinned to what it must
 * agree with, not to its wording:
 *   - every tariff and production record in data/policy/tariffs-construction-costs.json
 *     carries a source with a quote, a check date and a later review date, and the
 *     tariff records are watched by the source watch and the review reminders;
 *   - the brief's tables, picture and limits are what the builder makes from the
 *     committed data (so a data change cannot leave them stale);
 *   - the price changes are recomputed here from the stored index values,
 *     independently of the builder;
 *   - every dollar, percent or count in the prose sits in a recorded quote from a
 *     cited source or in a table the builder computed;
 *   - the brief says who the cost reaches, renters and owners;
 *   - the reader renders every section, table and the picture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build, BRIEF_ID, FEED, DATA, SVG } from '../scripts/policy/build_tariffs_brief.mjs';
import { FILES } from '../scripts/audit/policy-review-reminders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const D = json(DATA);
const FEEDDATA = json(FEED);
const brief = FEEDDATA.briefs.find((b) => b.id === BRIEF_ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('the brief is curated, dated and names its data file', () => {
  assert.ok(brief, `curated feed has no ${BRIEF_ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, DATA);
  assert.equal(brief.verified, D.meta.as_of);
  assert.equal(FEEDDATA.meta.brief_count, FEEDDATA.briefs.length);
});

test('every tariff and production record has a quoted, dated source and a later review date', () => {
  assert.ok(D.tariffs.length >= 5 && D.production.length >= 4, 'too few records');
  for (const r of [...D.tariffs, ...D.production]) {
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
  for (const t of D.tariffs) assert.equal(t.status, 'in_force', `${t.id}: status`);
  // A production result states only figures its own source quote prints.
  for (const p of D.production) {
    const quoted = squash(p.source.quote).replace(/ percent/g, '%');
    for (const f of p.result.match(/\d[\d,.]*%|\b\d{1,3}(?:,\d{3})+\b/g) || []) assert.ok(quoted.includes(f), `${p.id}: ${f} is not in its quote`);
  }
});

test('the source watch and the review reminders watch the tariff and production records', () => {
  for (const key of ['tariffs', 'production']) assert.ok(FILES.some((f) => f.file === DATA && f.key === key), `${key} is not watched`);
});

test('the tables, picture and limits are what the builder makes from the committed data', () => {
  const out = build();
  assert.equal(read(FEED), out[FEED], `${FEED} is stale: run node scripts/policy/build_tariffs_brief.mjs`);
  assert.equal(read(SVG), out[SVG], `${SVG} is stale: run node scripts/policy/build_tariffs_brief.mjs`);
  assert.deepEqual(section('limits').items, D.meta.known_gaps);
  assert.equal(section('tariffs').table.rows.length, D.tariffs.length);
  assert.equal(section('up').table.rows.length + section('flat').table.rows.length, D.prices.length);
});

test('the price changes, recomputed here from the stored index values', () => {
  const { baseline, year_ago: yearAgo, latest } = D.meta.months;
  const fmt = (from, to) => {
    const v = (to / from - 1) * 100;
    const r = Math.round(v * 10) / 10;
    return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(1)}%`;
  };
  const byLabel = new Map(D.prices.map((p) => [p.label, p]));
  for (const id of ['up', 'flat']) {
    let prev = Infinity;
    for (const row of section(id).table.rows) {
      const p = byLabel.get(row[0]);
      assert.ok(p, `${row[0]} is not a price series`);
      assert.equal(p.group, id, `${row[0]}: wrong table`);
      assert.match(p.source.url, /^https:\/\/fred\.stlouisfed\.org\/series\//);
      for (const m of [baseline, yearAgo, latest]) assert.ok(p.index[m] > 0, `${p.id}: no value for ${m}`);
      assert.equal(row[1], `${fmt(p.index[yearAgo], p.index[latest])} in one year. ${fmt(p.index[baseline], p.index[latest])} since ${D.meta.month_labels[baseline]}.`, `${row[0]}: price change`);
      const year = p.index[latest] / p.index[yearAgo];
      assert.ok(year <= prev, `${id}: rows are not in descending order`);
      prev = year;
    }
  }
  // Steel mill products, by hand: 399.645 / 300.665 = 1.3292, so +32.9%.
  assert.ok(section('up').table.rows.find((r) => r[0] === 'Steel mill products')[1].startsWith('+32.9% in one year.'));
  // A material in the "held flat" table moved less than 3% in the year; one in the "rose" table moved more.
  for (const p of D.prices) {
    const year = Math.abs(p.index[latest] / p.index[yearAgo] - 1) * 100;
    assert.ok(p.group === 'flat' ? year < 3 : year >= 3, `${p.label}: ${year.toFixed(1)}% is in the wrong table`);
  }
  // The illustration: share of contract times the rise, per $100.
  const il = D.meta.illustration;
  const high = D.context_series.find((s) => s.id === il.rise_high_series);
  const riseHigh = Math.round((high.index[latest] / high.index[yearAgo] - 1) * 1000) / 10;
  const last = section('colorado').table.rows.at(-1);
  assert.equal(last[1], `$${(Math.round(il.materials_share_low * il.rise_low_pct * 10) / 10).toFixed(2)}`);
  assert.equal(last[2], `$${(Math.round(il.materials_share_high * riseHigh * 10 + 1e-9) / 10).toFixed(2)}`);
  assert.ok(il.rise_low_source.quote.includes(`${il.rise_low_pct}%`), 'the low-case rise is not in its quote');
  // Colorado permits: the totals are the sum of the stored months.
  for (const y of ['2025', '2026']) assert.equal(D.colorado_permits.units[y], D.colorado_permits.monthly[y].reduce((a, b) => a + b, 0), `permits ${y}`);
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

test('every figure in the prose sits in a recorded quote or a computed table', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  for (const r of [...D.tariffs, ...D.production]) {
    for (const s of [r.source, ...(r.more_sources || [])]) {
      assert.ok(cited.has(s.url), `${r.id}: ${s.url} is not cited`);
      assert.ok(brief.source_quotes.some((q) => q.link === s.url && q.quote === s.quote), `${r.id}: its quote is not in the brief`);
    }
  }
  for (const p of [...D.prices, ...D.context_series, D.colorado_permits]) assert.ok(cited.has(p.source.url), `${p.id || 'permits'}: series is not cited`);
  const cells = brief.sections.flatMap((s) => (s.table ? [...s.table.columns, ...s.table.rows.flat()] : []));
  const known = squash([...brief.source_quotes.map((q) => q.quote), ...cells].join(' ')).replace(/–/g, '-');
  const figures = prose().match(FIGURE) || [];
  assert.ok(figures.length >= 20, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(known.includes(f), `${f} is in the brief but in no source quote or computed table`);
});

test('the brief says who the cost reaches, renters and owners', () => {
  assert.match(brief.takeaway, /rental and for-sale homes alike/);
  const who = section('renters-owners').items.join(' ');
  assert.match(who, /Renters in income-restricted homes do not pay/);
  assert.match(who, /Buyers of new for-sale homes/);
  assert.ok(D.meta.renter_owner.length > 40);
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
  const img = doc.querySelector('[data-figure="up"] img');
  assert.ok(img, 'the picture is not rendered');
  assert.equal(img.getAttribute('src'), SVG);
  assert.equal(doc.querySelectorAll('#brief-sources li').length, brief.articles.length);
});
