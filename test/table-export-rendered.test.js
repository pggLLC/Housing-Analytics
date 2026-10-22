'use strict';
// Rendered check for table downloads: the real pages, the real data files on
// disk, a real browser. For every table the registry names on a page:
//   - it renders rows and gets its download buttons
//   - every exported column has the definition the page shows for it
//   - every source resolves in the inventory
//   - the CSV download is a zip with the data, indicators, sources and README
//   - a source line under it names the same sources and offers each one's
//     full dataset, which downloads every record the inventory counts
// Excel is fetched from a CDN, which this test blocks, so it also proves a
// click on "Download Excel" still downloads (the CSV zip) when Excel is
// unreachable. The Excel sheets themselves are checked in table-export.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const ORIGIN = 'http://example.org';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json', '.csv': 'text/csv' };

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/config/table-export-registry.js'), 'utf8'), sandbox);
const registry = sandbox.window.TableExportRegistry.tables;

const PAGES = {
  'colorado-deep-dive.html': Object.keys(registry).filter((id) => id.startsWith('dd-')),
  'insights.html': Object.keys(registry).filter((id) => id.startsWith('in-')),
  'chfa-portfolio.html': Object.keys(registry).filter((id) => id.startsWith('cp-'))
};
assert.equal(Object.values(PAGES).flat().length, Object.keys(registry).length, 'every registry entry is assigned to a page this test opens');

async function open(browser, page) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const file = path.resolve(root, decodeURIComponent(u.pathname.slice(1)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await tab.goto(`${ORIGIN}/${page}`, { waitUntil: 'load', timeout: 90000 });
  return { tab, errors };
}

// Bring every exported table into a rendered state, one at a time: show the
// tab panel it sits in, scroll it in (lazy sections start on view), pick the
// first option in its county picker, open any <details> around it.
async function reveal(tab, id) {
  await tab.evaluate(async (x) => {
    const t = document.querySelector(`table[data-export="${x}"]`);
    const panel = t && t.closest('[role=tabpanel]');
    if (panel && panel.id) {
      const btn = document.querySelector(`[role=tab][aria-controls="${panel.id}"]`);
      if (btn) btn.click();
    }
    await new Promise((r) => setTimeout(r, 300));
  }, id);
  // A table rendered by script exists only once its tab has been opened:
  // open each tab in turn until it appears.
  await tab.evaluate(async (x) => {
    if (document.querySelector(`table[data-export="${x}"]`)) return;
    for (const btn of document.querySelectorAll('[role=tab]')) {
      btn.click();
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100));
        document.querySelectorAll('details').forEach((d) => { d.open = true; });
        if (document.querySelector(`table[data-export="${x}"]`)) return;
      }
    }
  }, id);
  // Lazy sections render on view; scroll until the table exists.
  for (let i = 0; i < 40; i++) {
    const found = await tab.evaluate((x) => {
      const t = document.querySelector(`table[data-export="${x}"]`);
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
      if (t) { t.scrollIntoView(); return true; }
      return false;
    }, id);
    if (found) break;
    await tab.mouse.wheel(0, 1200);
    await tab.waitForTimeout(250);
  }
  for (const s of Object.values(registry[id].selection || {})) {
    const isSelect = await tab.evaluate((q) => { const el = document.querySelector(q); if (el) el.scrollIntoView(); return !!el && el.tagName === 'SELECT'; }, s);
    if (!isSelect) continue;
    await tab.waitForFunction((q) => { const el = document.querySelector(q); return el && el.options && el.options.length > 1; }, s, { timeout: 30000 })
      .catch(() => { throw new Error(`${id}: picker ${s} never filled`); });
    await tab.evaluate((q) => { const el = document.querySelector(q); el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); }, s);
  }
  await tab.waitForFunction((x) => {
    const t = document.querySelector(`table[data-export="${x}"]`);
    if (!t || !t.__txBar || !t.__txBar.isConnected) return false;
    const heads = t.tHead ? t.tHead.rows[t.tHead.rows.length - 1].cells.length : 0;
    return [...t.tBodies].some((b) => [...b.rows].some((r) => r.cells.length > 1 || (heads <= 1 && r.cells.length)));
  }, id, { timeout: 30000 }).catch(() => {});
}

async function run() {
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const problems = [];
  const buttonSize = {};
  const datasetIds = new Set();
  const datasetsChecked = new Set();
  let checked = 0;
  try {
    for (const [page, ids] of Object.entries(PAGES)) {
      const { tab, errors } = await open(browser, page);
      for (const id of ids) {
        const t0 = Date.now();
        await reveal(tab, id);
        buttonSize[id] = await tab.evaluate((x) => {
          const t = document.querySelector(`table[data-export="${x}"]`);
          const btns = t && t.__txBar ? [...t.__txBar.querySelectorAll('button')] : [];
          return btns.length ? Math.min(...btns.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })) : 0;
        }, id);
        if (process.env.TX_TIMING) console.log(`  ${id}: ${Date.now() - t0} ms`);
      }
      const results = await tab.evaluate(async (list) => {
        const out = [];
        for (const id of list) {
          const t = document.querySelector(`table[data-export="${id}"]`);
          if (!t) { out.push({ id, error: 'table not on the page' }); continue; }
          try {
            const x = await window.TableExport.build(t, 'xlsx');
            const bytes = new Uint8Array(await x.blob.arrayBuffer());
            out.push({
              id,
              format: x.format,
              fellBack: !!x.fellBack,
              bar: !!(t.__txBar && t.__txBar.isConnected),
              rows: x.model.rows.length,
              onScreenRows: [...t.tBodies].reduce((n, b) => n + b.rows.length, 0),
              statusShown: (() => { const m = /^([\d,]+) of [\d,]+ properties shown/.exec((document.getElementById('statusBar') || {}).textContent || ''); return m ? Number(m[1].replace(/,/g, '')) : null; })(),
              undefinedColumns: x.model.columns.filter((c) => !c.definition).map((c) => c.label),
              blankLabels: x.model.columns.filter((c) => !c.label || /^Column \d+$/.test(c.label)).length,
              markedLabels: x.model.columns.filter((c) => /[†‡§*▲▼↑↓]\s*$/.test(c.label)).map((c) => c.label),
              missingSources: x.model.sources.filter((s) => s.missing).map((s) => s.id),
              sourceIds: x.model.sources.map((s) => s.id),
              control: (() => { const by = x.model.entry && x.model.entry.sourcesBySelection; const el = by && document.querySelector(by.control); return el ? el.value : null; })(),
              selection: x.model.selection.map((p) => p[0]),
              textControls: Object.entries((x.model.entry && x.model.entry.selection) || {}).filter(([, q]) => { const el = document.querySelector(q); return el && el.tagName !== 'SELECT'; }).map(([label]) => label),
              // The source line under the table: the same sources the file
              // cites, the table's download, and each source's full dataset.
              line: (() => {
                const box = t.__txSource;
                if (!box || !box.isConnected) return null;
                const names = box.querySelector('.tx-source__names');
                const btns = [...box.querySelectorAll('button')];
                return {
                  text: names ? names.textContent : '',
                  datasets: [...box.querySelectorAll('[data-download=dataset]')].map((g) => g.getAttribute('data-source-id')),
                  minButton: btns.length ? Math.min(...btns.map((b) => { const r = b.getBoundingClientRect(); return r.width && r.height ? Math.min(r.width, r.height) : 44; })) : 0
                };
              })(),
              expectDatasets: x.model.sources.filter((s) => !s.missing && s.localFile).map((s) => s.id),
              sourceNames: x.model.sources.map((s) => s.name),
              zipBytes: Array.from(bytes.slice(0, 4)),
              name: x.name
            });
          } catch (e) { out.push({ id, error: e.message }); }
        }
        return out;
      }, ids);
      for (const r of results) {
        if (r.error) { problems.push(`${page} ${r.id}: ${r.error}`); continue; }
        checked++;
        if (!r.bar) problems.push(`${page} ${r.id}: no download buttons`);
        if (!(buttonSize[r.id] >= 44)) problems.push(`${page} ${r.id}: download button touch target ${buttonSize[r.id]}px, under 44px (Rule 14)`);
        if (r.rows < 1) problems.push(`${page} ${r.id}: no rows`);
        // The portfolio shows 50 properties a page; its download is every
        // property the filters match, the count the page's status line states.
        if (r.id === 'cp-portfolio' && r.rows !== r.statusShown) problems.push(`${page} ${r.id}: downloads ${r.rows} rows, the page says ${r.statusShown} properties match (${r.onScreenRows} on screen)`);
        if (r.undefinedColumns.length) problems.push(`${page} ${r.id}: columns with no on-page definition: ${r.undefinedColumns.join(', ')}`);
        if (r.markedLabels.length) problems.push(`${page} ${r.id}: header labels carry page marks: ${r.markedLabels.join(', ')}`);
        if (r.blankLabels) problems.push(`${page} ${r.id}: ${r.blankLabels} column(s) with no header label`);
        if (r.missingSources.length) problems.push(`${page} ${r.id}: sources not in the inventory: ${r.missingSources.join(', ')}`);
        const by = registry[r.id].sourcesBySelection;
        if (by) {
          const want = (by.values && by.values[r.control]) || by.otherwise;
          if (r.sourceIds.join() !== want.join()) problems.push(`${page} ${r.id}: with ${by.control} at ${r.control}, cites ${r.sourceIds.join()} instead of ${want.join()}`);
        }
        for (const label of Object.keys(registry[r.id].selection || {})) {
          // A select always has a value; a text box is recorded only when filled.
          if (!r.textControls.includes(label) && !r.selection.includes(label)) problems.push(`${page} ${r.id}: About does not record ${label}`);
        }
        if (!r.line) problems.push(`${page} ${r.id}: no source line under the table`);
        else {
          for (const n of r.sourceNames) if (!r.line.text.includes(n)) problems.push(`${page} ${r.id}: the source line does not name ${n}, which the download cites`);
          if (r.line.datasets.join() !== r.expectDatasets.join()) problems.push(`${page} ${r.id}: source line offers full datasets ${r.line.datasets.join() || 'none'}, expected ${r.expectDatasets.join()}`);
          if (!(r.line.minButton >= 44)) problems.push(`${page} ${r.id}: source-line button touch target ${r.line.minButton}px, under 44px (Rule 14)`);
          r.expectDatasets.forEach((sid) => datasetIds.add(sid));
        }
        if (!(r.format === 'csv' && r.fellBack)) problems.push(`${page} ${r.id}: with Excel blocked, expected the CSV zip fallback, got ${r.format}`);
        if (r.zipBytes.join(',') !== '80,75,3,4') problems.push(`${page} ${r.id}: download is not a zip`);
        if (!/^coho-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip$/.test(r.name)) problems.push(`${page} ${r.id}: unexpected file name ${r.name}`);
      }
      // Each full dataset the page offers downloads every record the
      // inventory counts for it, fetched from the file the page serves.
      const dsResults = await tab.evaluate(async (list) => {
        const all = window.DataSourceInventory.getSources();
        const out = [];
        for (const sid of list) {
          const src = all.find((x) => x.id === sid);
          try {
            const d = await window.TableExport.buildDataset(src, 'csv');
            const bytes = new Uint8Array(await d.blob.arrayBuffer());
            out.push({ sid, records: d.recordCount, features: src.features, zip: Array.from(bytes.slice(0, 4)).join(','), name: d.name });
          } catch (e) { out.push({ sid, error: e.message }); }
        }
        return out;
      }, [...datasetIds].filter((sid) => !datasetsChecked.has(sid)));
      for (const d of dsResults) {
        datasetsChecked.add(d.sid);
        if (d.error) { problems.push(`${page} full dataset ${d.sid}: ${d.error}`); continue; }
        if (typeof d.features === 'number' && d.records !== d.features) problems.push(`${page} full dataset ${d.sid}: ${d.records} records, the inventory counts ${d.features}`);
        if (!(d.records > 0)) problems.push(`${page} full dataset ${d.sid}: no records`);
        if (d.zip !== '80,75,3,4') problems.push(`${page} full dataset ${d.sid}: CSV download is not a zip`);
        if (!/^coho-dataset-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip$/.test(d.name)) problems.push(`${page} full dataset ${d.sid}: unexpected file name ${d.name}`);
      }
      // With every filter cleared the portfolio matches all its properties,
      // more than one page of 50; the download must carry all of them.
      if (ids.includes('cp-portfolio')) {
        const all = await tab.evaluate(async () => {
          document.querySelectorAll('.filters select, select[id^="filter"]').forEach((el) => { el.selectedIndex = 0; el.dispatchEvent(new Event('change', { bubbles: true })); });
          document.querySelectorAll('input[id^="filter"]').forEach((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
          await new Promise((r) => setTimeout(r, 500));
          const t = document.querySelector('table[data-export="cp-portfolio"]');
          const x = await window.TableExport.build(t, 'csv');
          const m = /^([\d,]+) of/.exec(document.getElementById('statusBar').textContent);
          return { rows: x.model.rows.length, shown: m ? Number(m[1].replace(/,/g, '')) : null, onScreen: t.tBodies[0].rows.length };
        });
        if (!(all.shown > all.onScreen)) problems.push(`${page} cp-portfolio: fixture did not clear the filters (${all.shown} match, ${all.onScreen} on screen)`);
        if (all.rows !== all.shown) problems.push(`${page} cp-portfolio: with no filter, downloads ${all.rows} rows of the ${all.shown} the page says match`);
      }
      const ownErrors = errors.filter((e) => /table-export|TableExport/.test(e));
      if (ownErrors.length) problems.push(`${page}: ${ownErrors.join('; ')}`);
      await tab.close();
    }
  } finally {
    await browser.close();
  }
  const expected = Object.keys(registry).length;
  if (problems.length) {
    console.error(`table-export-rendered: ${problems.length} problem(s)\n  - ` + problems.join('\n  - '));
    process.exit(1);
  }
  assert.equal(checked, expected, `checked ${checked} of ${expected} registered tables`);
  assert.ok(datasetsChecked.size >= 10, `expected the source lines to offer the full datasets, checked ${datasetsChecked.size}`);
  console.log(`table-export-rendered: ${checked}/${expected} tables render, define every column and download; ${datasetsChecked.size} full datasets download every record`);
}

run().catch((e) => { console.error(e); process.exit(1); });
