#!/usr/bin/env node
// Builds the Market analysis page's peer set (data/market/reference-projects.json) from real
// Colorado tax-credit properties: every property in CHFA's Housing Tax Credit Properties feed
// (data/chfa-lihtc.json) with an award year from 2015 through 2025. Name, address, homes, award
// year, credit, project type, CHFA's urban/rural/mountain label and AMI mix are copied from that
// feed as printed. The only computed figure is the Market analysis page's own score at each
// property's mapped point, run with today's data at every buffer the page offers, so a site is
// always compared at the same buffer it was scored at. It is "our score today", not a score the
// property had when it was funded, and the property's own homes count in its existing supply.
//
//   node scripts/market/build_reference_projects.mjs      (needs Playwright's Chromium)
//
// Rerun when chfa-lihtc.json, the market data files or js/market-analysis.js change.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SRC = path.join(ROOT, 'data/chfa-lihtc.json');
const OUT = path.join(ROOT, 'data/market/reference-projects.json');
const FIRST_YEAR = 2015;
const LAST_YEAR = 2025;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml' };

const feed = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const picked = feed.features.filter((f) => {
  const p = f.properties || {};
  const c = f.geometry && f.geometry.coordinates;
  return p.YR_ALLOC >= FIRST_YEAR && p.YR_ALLOC <= LAST_YEAR && Array.isArray(c) &&
    Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number(p.N_UNITS) > 0;
});

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const exe = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
await page.route((url) => !url.href.startsWith('http://127.0.0.1'), (route) => route.abort());
await page.goto(`http://127.0.0.1:${server.address().port}/market-analysis.html`);
await page.waitForFunction(() => window.PMAEngine && window.PMAEngine.whenDataReady, null, { timeout: 120000 });
await page.evaluate(() => window.PMAEngine.whenDataReady());
const buffers = await page.evaluate(() => Array.from(document.querySelectorAll('#pmaBufferSelect option')).map((o) => o.value));

const projects = [];
let unscored = 0;
for (const f of picked) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const scores = await page.evaluate(({ lat, lon, buffers }) => {
    const E = window.PMAEngine;
    const sel = document.getElementById('pmaBufferSelect');
    const out = {};
    for (const b of buffers) {
      const before = E._state.getLastResult();
      sel.value = b;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      E.runAnalysis(lat, lon);
      const r = E._state.getLastResult();
      out[b] = (!r || r === before || r.lat !== lat || r.lon !== lon || typeof r.overall !== 'number') ? null : r.overall;
    }
    return out;
  }, { lat, lon, buffers });
  if (Object.values(scores).every((v) => v == null)) unscored++;
  projects.push({
    id: p.CHFA_RecordID != null ? `CHFA-${p.CHFA_RecordID}` : null,
    name: p.PROJECT,
    address: p.PROJ_ADD || null,
    city: p.PROJ_CTY || null,
    county: p.CNTY_NAME || null,
    county_fips: p.CNTY_FIPS || null,
    lat, lon,
    total_units: Number(p.N_UNITS),
    li_units: p.LI_UNITS == null ? null : Number(p.LI_UNITS),
    year_alloc: p.YR_ALLOC,
    credit: p.CREDIT || null,
    project_type: p.ProjectType || null,
    market_type: p.UrbanRural || null,
    ami_mix: p.AMIUnits || null,
    pma_score_by_buffer: scores,
  });
}
await browser.close();
server.close();

const revision = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim();
const meta = {
  title: 'Colorado tax-credit properties awarded 2015-2025, scored by the Market analysis page today',
  source: 'CHFA Housing Tax Credit Properties feed (data/chfa-lihtc.json)',
  source_url: feed.source || null,
  source_fetched: feed.fetchedAt || null,
  selection: `Every property in the feed with an award year from ${FIRST_YEAR} through ${LAST_YEAR}, a mapped point and at least one home.`,
  copied_as_printed: ['name', 'address', 'city', 'county', 'total_units', 'li_units', 'year_alloc', 'credit', 'project_type', 'market_type (CHFA UrbanRural)', 'ami_mix (CHFA AMIUnits)'],
  score_method: 'Market analysis engine (js/market-analysis.js) run at the property\'s mapped point with today\'s data, once for each buffer the page offers. This is our score today, not a score the property had when it was funded. The property\'s own homes count in its area\'s existing tax-credit supply.',
  not_included: 'No capture rate or lease-up figures: CHFA does not publish them for these properties.',
  buffers,
  built_from: revision,
  generated: new Date().toISOString().slice(0, 10),
  projects: projects.length,
  projects_without_score: unscored,
};
fs.writeFileSync(OUT, JSON.stringify({ meta, projects }, null, 0) + '\n');
console.log(`reference projects: ${projects.length} real properties, ${unscored} without a score -> ${path.relative(ROOT, OUT)}`);
