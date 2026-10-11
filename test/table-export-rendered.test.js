'use strict';
// Rendered check for table downloads: the real pages, the real data files on
// disk, a real browser. For every table the registry names on a page:
//   - it renders rows and gets its download buttons
//   - every exported column has the definition the page shows for it
//   - every source resolves in the inventory
//   - the CSV download is a zip with the data, indicators, sources and README
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
  'lihtc-allocations.html': Object.keys(registry).filter((id) => id.startsWith('la-')),
  'insights.html': Object.keys(registry).filter((id) => id.startsWith('in-'))
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
    await tab.evaluate((q) => { const el = document.querySelector(q); if (el) el.scrollIntoView(); }, s);
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
  let checked = 0;
  try {
    for (const [page, ids] of Object.entries(PAGES)) {
      const { tab, errors } = await open(browser, page);
      for (const id of ids) {
        const t0 = Date.now();
        await reveal(tab, id);
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
              undefinedColumns: x.model.columns.filter((c) => !c.definition).map((c) => c.label),
              blankLabels: x.model.columns.filter((c) => !c.label || /^Column \d+$/.test(c.label)).length,
              missingSources: x.model.sources.filter((s) => s.missing).map((s) => s.id),
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
        if (r.rows < 1) problems.push(`${page} ${r.id}: no rows`);
        if (r.undefinedColumns.length) problems.push(`${page} ${r.id}: columns with no on-page definition: ${r.undefinedColumns.join(', ')}`);
        if (r.blankLabels) problems.push(`${page} ${r.id}: ${r.blankLabels} column(s) with no header label`);
        if (r.missingSources.length) problems.push(`${page} ${r.id}: sources not in the inventory: ${r.missingSources.join(', ')}`);
        if (!(r.format === 'csv' && r.fellBack)) problems.push(`${page} ${r.id}: with Excel blocked, expected the CSV zip fallback, got ${r.format}`);
        if (r.zipBytes.join(',') !== '80,75,3,4') problems.push(`${page} ${r.id}: download is not a zip`);
        if (!/^coho-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip$/.test(r.name)) problems.push(`${page} ${r.id}: unexpected file name ${r.name}`);
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
  console.log(`table-export-rendered: ${checked}/${expected} tables render, define every column and download`);
}

run().catch((e) => { console.error(e); process.exit(1); });
