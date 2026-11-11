// Economic dashboard accuracy guards (2026-11-01).
// 1. Inflation is computed once, by the page's own date-matched year-ago
//    lookup. js/fred-cards.js counted 13 rows back, which lands on August
//    2025 because October 2025 CPI was never published, and could overwrite
//    the correct figure depending on load order.
// 2. The headline tiles read a daily saved copy of FRED, so they must not
//    call themselves "LIVE".
// 3. The Yardi Matrix panel showed COHO estimates as Yardi figures and had
//    not been updated since June 2026; it stays removed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'economic-dashboard.html'), 'utf8');

assert.ok(!html.includes('js/fred-cards.js'), 'economic dashboard must not load the duplicate CPI script');
assert.ok(!fs.existsSync(path.join(root, 'js/fred-cards.js')), 'js/fred-cards.js stays deleted');
assert.match(html, /function yearAgoIndex\(/, 'headline CPI uses the date-matched year-ago lookup');
assert.match(html, /els\.statCpi\.textContent = isFinite\(yoy\)/, 'headline CPI is written by the page script');

assert.doesNotMatch(html, />LIVE</, 'no tile calls a daily saved copy "LIVE"');

// Run the page's own badge updater against data/fred-data.json and check that
// every headline tile ends up dated with its own series' latest observation.
const { JSDOM } = require('jsdom');
const fred = JSON.parse(fs.readFileSync(path.join(root, 'data/fred-data.json'), 'utf8'));
const stripStart = html.lastIndexOf('<div', html.indexOf('aria-label="Key economic indicators"'));
const stripEnd = html.indexOf('Indicator source:');
const fetchSrc = html.slice(html.indexOf('async function fetchFRED('), html.indexOf('return sliced;', html.indexOf('async function fetchFRED(')) + 'return sliced;'.length) + '\n}';
const updStart = html.indexOf("document.querySelectorAll('.kpi-strip-item .kpi-source a[href*=\"fred.stlouisfed.org/series/\"]')");
assert.ok(updStart > 0, 'badge updater found');
const updEnd = html.indexOf('});\n    });', updStart) + '});\n    });'.length;
const updaterSrc = html.slice(updStart, updEnd);

(async () => {
  const dom = new JSDOM('<!doctype html><body>' + html.slice(stripStart, stripEnd) + '</div></body>');
  const doc = dom.window.document;
  const tiles = [...doc.querySelectorAll('.kpi-strip-item')];
  assert.equal(tiles.length, 8, 'eight headline tiles');
  const pending = [];
  const make = new Function('document', '_loadFredData', 'apiKey', 'pending',
    fetchSrc + '\nconst _orig = fetchFRED; fetchFRED = function(){ const p = _orig.apply(null, arguments); pending.push(p.catch(()=>{})); return p; };\n' + updaterSrc);
  make(doc, async () => fred, true, pending);
  await Promise.all(pending);
  await new Promise(r => setTimeout(r, 0));
  for (const tile of tiles) {
    const a = tile.querySelector('.kpi-source a');
    const id = a.getAttribute('href').split('/series/')[1];
    const obs = fred.series[id].observations.filter(o => o && o.value !== '.' && o.value !== null && o.date && isFinite(Number(o.value)));
    const want = 'Latest ' + obs[obs.length - 1].date;
    assert.equal(tile.querySelector('.kpi-source span').textContent, want, id + ' tile shows its own latest date');
  }

assert.ok(!html.includes('yardi-matrix-national-multifamily.json'), 'Yardi estimates are not shown');
assert.ok(!/id="yardi/.test(html), 'Yardi panel stays removed');
assert.match(html, /href="colorado-deep-dive\.html#tab-need"/, 'rent pointer opens the Deep Dive tab with the county rent chart');

// The page's year-ago lookup must never pair a month with a different
// calendar month. October 2025 CPI was never published, so October 2026 has
// no year-ago figure and must show no YoY rather than a 13-month change.
const yaSrc = html.slice(html.indexOf('function yearAgoIndex('), html.indexOf('function pickChange('));
const yearAgoIndex = new Function(yaSrc + '\nreturn yearAgoIndex;')();
const cpi = fred.series.CPIAUCSL.observations.filter(o => o.value !== '.' && o.value != null);
let matched = 0;
for (let end = 12; end < cpi.length; end++) {
  const i = yearAgoIndex(cpi, end);
  if (i < 0) continue;
  matched++;
  assert.equal(cpi[i].date.slice(5, 7), cpi[end].date.slice(5, 7), 'year-ago CPI for ' + cpi[end].date + ' is the same calendar month');
  assert.equal(Number(cpi[i].date.slice(0, 4)), Number(cpi[end].date.slice(0, 4)) - 1, 'year-ago CPI for ' + cpi[end].date + ' is one year earlier');
}
assert.ok(matched > 12, 'most CPI months find their year-ago month');
const gap = [{date: '2025-09-01', value: 1}, {date: '2025-11-01', value: 1}, {date: '2026-09-01', value: 1}, {date: '2026-10-01', value: 1}];
assert.equal(yearAgoIndex(gap), -1, 'a missing year-ago month gives no YoY');
assert.equal(yearAgoIndex(gap, 2), 0, 'a present year-ago month is used');
const weekly = [{date: '2025-11-06'}, {date: '2025-11-13'}, {date: '2026-11-05'}, {date: '2026-11-12'}];
assert.equal(yearAgoIndex(weekly), 0, 'weekly series still match the nearest earlier week');
const daily = [{date: '2025-11-07'}, {date: '2025-11-10'}, {date: '2026-11-09'}, {date: '2026-11-10'}];
assert.equal(yearAgoIndex(daily, 2), 0, 'a daily date whose year-ago day is a weekend uses the Friday before');

console.log('Economic dashboard accuracy guards passed.');
})().catch(e => { console.error(e); process.exit(1); });
