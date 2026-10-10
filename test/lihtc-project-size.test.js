'use strict';

/**
 * The Project Size panel of the Deep Dive's Historical Trends tab must agree
 * with data/chfa-lihtc.json, and its copy with the figures it describes.
 *
 *   1. every dated project with a unit count is counted once, in one period,
 *      one size band and one county;
 *   2. the per-period medians equal an independent recomputation;
 *   3. a missing unit count is excluded and disclosed, never counted as 0;
 *   4. the intro's "9% deals stay small, 4% deals are larger" agrees with the
 *      medians, and "Four lenses" with the number of panels in the tab;
 *   5. the rendered tables and chart carry those values.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LihtcByYear = require('../js/components/lihtc-by-year.js');
const Size = require('../js/lihtc-project-size.js');

const feed = JSON.parse(read('data/chfa-lihtc.json')).features;
const r = Size.compute(feed, LihtcByYear);

// Independent recomputation, straight from the feed's fields.
const year = (p) => Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC);
const rows = feed.map((f) => f.properties)
  .filter((p) => year(p) >= 1986 && year(p) <= new Date().getFullYear() && Number(p.N_UNITS || p.TOTAL_UNITS) > 0);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : null; };
const credit = (p) => { const c = String(p.CREDIT || p.TypeOfCredits || ''); return c.includes('9%') && !c.includes('4%') ? 'nine' : c.includes('4%') && !c.includes('9%') ? 'four' : 'other'; };

// 1. Coverage: nothing dropped, nothing double-counted.
assert(rows.length > 500, `scan found only ${rows.length} projects`);
assert.strictEqual(r.projects, rows.length);
assert.strictEqual(r.projects + r.excluded, feed.length);
assert.strictEqual(r.periods.reduce((n, p) => n + p.projects, 0), rows.length, 'periods cover every project once');
assert.strictEqual(r.bands.reduce((n, b) => n + b.projects, 0), rows.length, 'bands cover every project once');
assert.strictEqual(r.counties.reduce((n, c) => n + c.projects, 0), rows.length, 'counties cover every project once');
r.bands.forEach((b) => assert.strictEqual(b.nine + b.four + b.other, b.projects, b.label));
assert.strictEqual(r.periods[r.periods.length - 1].end, Math.max(...rows.map(year)), 'last period ends at the newest award year');

// 2. Medians.
assert.strictEqual(r.median, med(rows.map((p) => Number(p.N_UNITS))));
for (const p of r.periods) {
  const inP = rows.filter((x) => year(x) >= p.start && year(x) <= p.end);
  assert.strictEqual(p.median, med(inP.map((x) => Number(x.N_UNITS))), p.label);
  for (const k of ['nine', 'four']) {
    const u = inP.filter((x) => credit(x) === k).map((x) => Number(x.N_UNITS));
    assert.strictEqual(p[k].projects, u.length, p.label + ' ' + k);
    assert.strictEqual(p[k].median, med(u), p.label + ' ' + k);
  }
}
const denver = rows.filter((p) => p.CNTY_NAME.replace(/ County$/i, '') === 'Denver').map((p) => Number(p.N_UNITS));
const denverRow = r.counties.find((c) => c.county === 'Denver');
assert.deepStrictEqual([denverRow.projects, denverRow.median, denverRow.largest], [denver.length, med(denver), Math.max(...denver)]);

// 3. A missing unit count is excluded, not a 0-unit project.
const withGap = feed.concat([{ properties: { AwardYear: 2020, N_UNITS: null, CREDIT: '9% Competitive', CNTY_NAME: 'Denver' } }]);
const g = Size.compute(withGap, LihtcByYear);
assert.strictEqual(g.excluded, r.excluded + 1);
assert.strictEqual(g.projects, r.projects);
assert.strictEqual(g.bands[0].projects, r.bands[0].projects, 'no project lands in the smallest band for lack of a count');
assert.strictEqual(Size.compute([], LihtcByYear).unavailableReason.length > 0, true);

// 4. Copy agrees with the data.
const html = read('colorado-deep-dive.html');
const panel = html.slice(html.indexOf('aria-labelledby="htSizeHeading"'), html.indexOf('<!-- Panel 3: Peer Benchmark -->'));
assert(panel.length > 0, 'project size panel found');
const all = (k) => med(rows.filter((p) => credit(p) === k).map((p) => Number(p.N_UNITS)));
if (/9% deals[^.]*stay small[^.]*4% bond deals/.test(panel)) {
  assert(all('nine') < all('four'), `intro says 9% deals are smaller, but medians are 9% ${all('nine')} / 4% ${all('four')}`);
}
const tab = html.slice(html.indexOf('id="tab-history"'), html.indexOf('<!-- /tab-history -->'));
const words = { Three: 3, Four: 4, Five: 5 };
const lenses = tab.match(/\b(Three|Four|Five) lenses\b/);
assert(lenses, 'tab intro names its number of lenses');
assert.strictEqual((tab.match(/class="ht-panel"/g) || []).length, words[lenses[1]], 'tab intro lens count matches its panels');

// 5. Rendered output.
(async () => {
  const dom = new JSDOM('<h2 id="htSizeHeading"></h2><p id="htSizeStatus" hidden></p><div id="sizeStats"></div><canvas id="sizeByPeriodChart"></canvas><div id="sizePeriodTable"></div><div id="sizeBandTable"></div><div id="sizeCountyTable"></div>',
    { runScripts: 'outside-only', url: 'https://cohoanalytics.com/colorado-deep-dive.html' });
  const w = dom.window;
  const charts = [];
  w.Chart = function (ctx, cfg) { charts.push(cfg); this.destroy = () => {}; this.data = cfg.data; };
  w.fetch = async () => ({ ok: true, json: async () => ({ features: feed }) });
  w.eval(read('js/components/lihtc-by-year.js'));
  w.eval(read('js/lihtc-project-size.js'));
  await w.LihtcProjectSize.render();
  const doc = w.document;
  assert.strictEqual(charts.length, 1);
  assert.deepStrictEqual(Array.from(charts[0].data.labels), r.periods.map((p) => p.label));
  assert.deepStrictEqual(Array.from(charts[0].data.datasets[1].data), r.periods.map((p) => p.four.median));
  assert(doc.getElementById('htSizeHeading').textContent.includes(r.range));
  assert(doc.getElementById('sizeStats').textContent.includes(r.median + ' units'));
  const bandCells = [...doc.querySelectorAll('#sizeBandTable tbody tr')].map((tr) => tr.children[1].textContent);
  assert.deepStrictEqual(bandCells, r.bands.map((b) => b.projects.toLocaleString()));
  assert.strictEqual(doc.querySelectorAll('#sizeCountyTable tbody tr').length, r.counties.length);

  // Failed feed: an unavailable note, no chart.
  charts.length = 0;
  w.fetch = async () => ({ ok: false, status: 503 });
  await w.LihtcProjectSize.render();
  assert.strictEqual(charts.length, 0);
  assert.strictEqual(doc.getElementById('htSizeStatus').hidden, false);
  assert.match(doc.getElementById('htSizeStatus').textContent, /unavailable/);

  console.log(`lihtc-project-size: PASS (${r.projects} projects ${r.range}, median ${r.median}; 9% ${all('nine')} / 4% ${all('four')}; ${r.counties.length} counties)`);
})().catch((e) => { console.error(e); process.exit(1); });
