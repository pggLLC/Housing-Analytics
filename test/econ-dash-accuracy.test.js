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

// The year-ago lookup must skip the missing October 2025 CPI month.
const cpi = fred.series.CPIAUCSL.observations.filter(o => o.value !== '.' && o.value != null);
const last = cpi[cpi.length - 1];
const target = new Date(last.date); target.setUTCFullYear(target.getUTCFullYear() - 1);
const yearAgo = cpi.filter(o => new Date(o.date) <= target).pop();
assert.equal(yearAgo.date.slice(5, 7), last.date.slice(5, 7), 'year-ago CPI is the same calendar month');

console.log('Economic dashboard accuracy guards passed.');
})().catch(e => { console.error(e); process.exit(1); });
