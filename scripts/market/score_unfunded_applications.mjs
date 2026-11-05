#!/usr/bin/env node
// Scores the mapped applications CHFA did not fund (data/market/unfunded-application-points.json,
// from geocode_unfunded_applications.py) with the Market analysis page's own engine, at every
// buffer the page offers, exactly as build_reference_projects.mjs scores the funded properties.
// The score is "our score today" at the printed address. Unlike a funded property, an unfunded
// application's homes were never built, so they are not in its area's existing supply.
//
//   node scripts/market/score_unfunded_applications.mjs      (needs Playwright's Chromium)
//
// Rerun after the geocoder, or when the market data files or js/market-analysis.js change.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FILE = path.join(ROOT, 'data/market/unfunded-application-points.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml' };

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));

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

let unscored = 0;
for (const p of doc.points) {
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
  }, { lat: p.lat, lon: p.lon, buffers });
  if (Object.values(scores).every((v) => v == null)) unscored++;
  p.pma_score_by_buffer = scores;
}
await browser.close();
server.close();

doc.meta.score_method = 'Market analysis engine (js/market-analysis.js) run at the geocoded address with today\'s data, once for each buffer the page offers, as for the funded reference properties. Our score today. The application\'s own homes were never built, so they are not in its area\'s existing supply, while a funded property\'s homes are.';
doc.meta.buffers = buffers;
doc.meta.scored_from = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim();
doc.meta.points_without_score = unscored;
fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
console.log(`unfunded applications: ${doc.points.length} scored, ${unscored} without a score -> ${path.relative(ROOT, FILE)}`);
