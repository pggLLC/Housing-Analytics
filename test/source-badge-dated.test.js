'use strict';
// Source lines from js/components/source-badge.js must carry a link and a date.
//
//   - data-vintage is printed as given
//   - without data-vintage, data-source-id takes the inventory's date
//   - with neither, the line says "date unconfirmed" rather than nothing
//   - data-source-ids builds the line from js/data-source-inventory.js, linking
//     the publisher, or the site's /data copy for a source derived here
//   - a badge on a <canvas> is placed outside it (a canvas renders no children)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="v" data-source="ACS DP04" data-source-url="https://data.census.gov/" data-vintage="ACS 2024"></div>
    <div id="none" data-source="Unknown series"></div>
    <div id="byId" data-source="CHFA feed" data-source-url="data/chfa-lihtc.json" data-source-id="chfa-lihtc"></div>
    <div id="ids" data-source-ids="fred-data,hna-ranking-index,not-a-source"></div>
    <section><div class="chart-container"><canvas id="c" data-source="FRED WPU0811" data-source-url="https://fred.stlouisfed.org/series/WPU0811" data-vintage="2010–current"></canvas></div></section>
  </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(read('js/data-source-inventory.js'));
  w.eval(read('js/components/source-badge.js'));
  await new Promise((r) => setTimeout(r, 20));
  const d = w.document;
  const inv = w.DataSourceInventory.getSources();
  const byId = (id) => inv.find((s) => s.id === id);

  const line = (el) => el.querySelector(':scope > .chart-source');
  assert.match(line(d.getElementById('v')).textContent, /ACS 2024/);
  assert.match(line(d.getElementById('none')).textContent, /date unconfirmed/);
  assert.match(line(d.getElementById('byId')).textContent, new RegExp('updated ' + byId('chfa-lihtc').lastUpdated));

  const ids = line(d.getElementById('ids'));
  assert.ok(ids, 'data-source-ids gets a line');
  const links = [...ids.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.ok(links.includes(byId('fred-data').url), 'a source with a publisher URL links it');
  assert.ok(links.some((h) => h.endsWith(byId('hna-ranking-index').localFile)), 'a source derived here links its /data copy');
  assert.match(ids.textContent, new RegExp('updated ' + byId('fred-data').lastUpdated));
  assert.match(ids.textContent, /not-a-source \(date unconfirmed\)/);

  const canvas = d.getElementById('c');
  assert.equal(canvas.children.length, 0, 'no badge inside the canvas');
  assert.ok(d.querySelector('section > .chart-source'), 'badge sits past the fixed-height chart container');

  console.log('source-badge-dated: PASS');
  w.SourceBadge._disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
