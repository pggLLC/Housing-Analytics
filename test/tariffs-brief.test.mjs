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
 *   - the reader renders every section, table and the picture;
 *   - the construction cost pages show the brief's conclusions from a note file the
 *     builder makes, and the brief links back to the construction costs page.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build, BRIEF_ID, FEED, DATA, SVG, NOTE } from '../scripts/policy/build_tariffs_brief.mjs';
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
  assert.equal(read(NOTE), out[NOTE], `${NOTE} is stale: run node scripts/policy/build_tariffs_brief.mjs`);
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
  // The link back to the construction costs page is drawn as the feed gives it.
  const back = doc.querySelector('[data-section="up"] .brief-note a');
  assert.ok(back, 'the link to the construction costs page is not rendered');
  assert.equal(back.textContent, section('up').see_also.text);
  assert.equal(back.href, new URL(section('up').see_also.href, dom.window.location.href).href);
  const img = doc.querySelector('[data-figure="up"] img');
  assert.ok(img, 'the picture is not rendered');
  assert.equal(img.getAttribute('src'), SVG);
  assert.equal(doc.querySelectorAll('#brief-sources li').length, brief.articles.length);
});

test('the cost pages show the brief\'s conclusions, and the brief links back', async (t) => {
  const note = json(NOTE);
  const { year_ago: yearAgo, latest } = D.meta.months;
  // The three largest rises, recomputed here, in order, each with its figure.
  const ranked = D.prices.map((p) => ({ p, v: p.index[latest] / p.index[yearAgo] - 1 })).sort((a, b) => b.v - a.v);
  let at = -1;
  for (const { p, v } of ranked.slice(0, 3)) {
    const name = p.label.replace(/\s*\([^)]*\)/g, '');
    const want = `${name[0].toLowerCase()}${name.slice(1)} (+${(Math.round(v * 1000) / 10).toFixed(1)}%)`;
    const i = note.lines[0].indexOf(want);
    assert.ok(i > at, `the first line does not carry "${want}" in order`);
    at = i;
  }
  // The ranking says it covers the materials tracked, and names fuel, which rose more.
  assert.ok(note.lines[0].startsWith(`Among the ${D.prices.length} building materials the brief tracks,`));
  const fuel = D.context_series.find((x) => x.id === D.meta.cost_note.fuel_series);
  assert.match(fuel.label, /diesel/i);
  const fuelRise = fuel.index[latest] / fuel.index[yearAgo] - 1;
  assert.ok(fuelRise > ranked[0].v, 'fuel no longer rose more than the top material');
  assert.ok(note.lines[0].endsWith(`Fuel rose more: diesel is up ${(Math.round(fuelRise * 1000) / 10).toFixed(1)}%.`));
  for (const p of D.prices.filter((x) => x.group === 'flat')) assert.ok(note.lines[1].toLowerCase().includes(p.label.toLowerCase()), `${p.label} is not in the flat line`);
  // The hand-written caution claims no cause, and its rate is one a tariff record states.
  assert.ok(note.lines.includes(D.meta.cost_note.caution));
  assert.match(D.meta.cost_note.caution, /does not show how much of the rise is tariffs/);
  for (const rate of D.meta.cost_note.caution.match(/\d+%/g)) assert.ok(D.tariffs.some((x) => x.rate.includes(rate)), `${rate} is in no tariff record`);
  for (const id of D.meta.cost_note.production_ids) {
    const p = D.production.find((x) => x.id === id);
    assert.ok(note.lines.some((l) => l.startsWith(`${p.title}: `) && p.result.toLowerCase().startsWith(l.slice(p.title.length + 2).toLowerCase())), `${id} is not in the note as recorded`);
  }
  assert.ok(note.lines.includes(D.meta.renter_owner), 'the note does not say who pays, renters and owners');
  assert.equal(note.brief.href, `research-brief.html?id=${BRIEF_ID}`);
  assert.equal(note.brief.title, brief.title);
  assert.equal(note.meta.as_of, D.meta.as_of);

  // The classic construction costs page draws the note; both cost pages link to the brief.
  const page = read('construction-commodities.html');
  assert.match(page, /<div class="chart-section" data-tariff-cost-note hidden><\/div>/);
  assert.match(page, /<script defer src="js\/tariff-cost-note\.js"><\/script>/);
  for (const f of ['construction-commodities.html', 'article-co-housing-costs.html']) assert.ok(read(f).includes(`research-brief.html?id=${BRIEF_ID}`), `${f} does not link to the brief`);
  const dom = new JSDOM('<main><div data-tariff-cost-note hidden></div></main>', { url: 'https://pggllc.github.io/Housing-Analytics/construction-commodities.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = async (f) => ({ ok: f === 'data/policy/tariffs-cost-note.json', status: 404, json: async () => structuredClone(note) });
  dom.window.eval(read('js/tariff-cost-note.js'));
  assert.equal(await dom.window.TariffCostNote.init(dom.window.document), 1);
  const host = dom.window.document.querySelector('[data-tariff-cost-note]');
  assert.equal(host.hidden, false);
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), note.lines);
  assert.equal(host.querySelector('p a').getAttribute('href'), note.brief.href);
  // A file that does not load leaves the box hidden and empty.
  const off = new JSDOM('<div data-tariff-cost-note hidden></div>', { url: 'https://pggllc.github.io/Housing-Analytics/construction-commodities.html', runScripts: 'outside-only' });
  t.after(() => off.window.close());
  off.window.fetch = async () => ({ ok: false, status: 404 });
  off.window.eval(read('js/tariff-cost-note.js'));
  assert.equal(await off.window.TariffCostNote.init(off.window.document), 0);
  assert.equal(off.window.document.querySelector('[data-tariff-cost-note]').hidden, true);

  // The brief points back to the construction costs page, which exists in the hub.
  assert.equal(section('up').see_also.href, 'places-hub.html#/places/costs');
  assert.ok(section('up').see_also.text.trim().length > 10, 'the back link has no label');
  assert.ok(fs.existsSync(path.join(ROOT, 'places-hub.html')));
  assert.match(read('hub/places-more.js'), /#\/places\/costs/);
});

test('the material cards name each series as the Bureau of Labor Statistics does', () => {
  // WPU0812 is hardwood lumber; plywood is WPU083. The card must not call it plywood.
  const src = read('js/fred-commodities.js');
  const name = src.match(/id: 'WPU0812',\s*name: '([^']+)'/)[1];
  assert.equal(name, 'Hardwood Lumber');
  assert.match(read('scripts/fetch_fred_data.py'), /"WPU0812": \("PPI: Hardwood Lumber"/);
  assert.ok(!/WPU0812[^<]*Plywood/.test(read('construction-commodities.html')));
});
