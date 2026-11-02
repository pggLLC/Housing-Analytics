#!/usr/bin/env node
// Counts, for every Colorado place, the renter households who qualify for a new tax-credit home
// within 15 miles of the place's center, and the tax-credit homes already there, with the Market
// analysis page's own engine (market-analysis.html, CHFA Market Study Guide rules). The Opportunity
// Finder reads the result to flag places with too few qualifying renters for a typical 9% building.
//
//   node scripts/market/build_finder_demand.mjs      (needs Playwright's Chromium)
//
// Writes data/market/finder-place-demand.json. Rerun when chfa_renter_demand_co.json, the CHFA
// limits or chfa-lihtc.json change.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(ROOT, 'data/market/finder-place-demand.json');
const MILES = 15;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml' };

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
// Map tiles and other outside requests are not needed for the counts.
await page.route((url) => !url.href.startsWith('http://127.0.0.1'), (route) => route.abort());
await page.goto(`http://127.0.0.1:${server.address().port}/market-analysis.html`);
await page.waitForFunction(() => window.PMAEngine && window.PMAEngine.whenDataReady, null, { timeout: 120000 });
await page.evaluate(() => window.PMAEngine.whenDataReady());

const places = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co-place-centroids.json'), 'utf8')).byGeoid;
const out = {};
let missing = 0;
for (const [geoid, p] of Object.entries(places)) {
  const got = await page.evaluate(({ lat, lon, miles }) => {
    const E = window.PMAEngine, before = E._state.getLastResult();
    const sel = document.getElementById('pmaBufferSelect');
    sel.value = String(miles);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    E.runAnalysis(lat, lon);
    const r = E._state.getLastResult();
    if (!r || r === before || r.lat !== lat || r.lon !== lon) return null;
    const den = E.projectCaptureDenominator(r);
    // No denominator means the demand data is unavailable, not zero renters.
    const qualified = den && Number.isFinite(Number(den.value)) ? Math.round(Number(den.value)) : null;
    return { qualified, existing: r.lihtcUnits == null ? null : r.lihtcUnits };
  }, { lat: p.lat, lon: p.lng, miles: MILES });
  if (!got) { missing++; continue; }
  out[geoid] = got;
}
await browser.close();
server.close();

const revision = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim();
const meta = {
  title: 'Qualifying renter households and existing tax-credit homes within 15 miles of each Colorado place',
  method: 'Market analysis engine (js/market-analysis.js) run at each place center with a 15-mile market area: qualifying renters are the project capture denominator (60% AMI, 1-3 bedrooms, CHFA Market Study Guide demand rules); existing homes are the tax-credit homes the engine counts in the area.',
  miles: MILES,
  capture_limit: 0.85,
  capture_limit_source: 'CHFA 2027-2028 QAP (adopted), Section 2.B Market Conditions: capture rates above 85 percent are not accepted without additional data to support demand',
  capture_limit_url: 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf',
  sources: ['data/market/chfa_renter_demand_co.json', 'data/chfa-lihtc.json', 'data/co-place-centroids.json'],
  built_from: revision,
  generated: new Date().toISOString().slice(0, 10),
  places: Object.keys(out).length,
  places_without_result: missing,
};
fs.writeFileSync(OUT, JSON.stringify({ meta, places: out }, null, 0) + '\n');
console.log(`finder demand: ${meta.places} places, ${missing} without a result -> ${path.relative(ROOT, OUT)}`);
