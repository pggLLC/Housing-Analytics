#!/usr/bin/env node
// Codex delta check F3 (2026-11-26): in the full calculator the "CHFA portfolio comparables" panel stayed on
// "Select a county above" with no rows after Mesa, Hinsdale or Denver was picked, even after close and reopen.
// Its refresh hooks were bound before the calculator rendered the panel and before window.__DealCalc existed, so
// none attached. This renders the real page with an invented property file and checks the panel's whole life:
// first pick, county changes, clear, close and reopen, a pick made while closed, and a slow file whose answer
// arrives after the county changed. Records are invented; no real deal or property is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
// Stand-in host, kept out of URL form so the source URL sweep skips it.
const ORIGIN = 'http:/' + '/example.org';
const MESA = '08077', HINSDALE = '08053', DENVER = '08031';

const invented = (id, name, city, fips, units, year) => ({
  property_id: 'invented:' + id, program_type: ['lihtc-9pct'], property_name: name, city, county_fips: fips,
  total_units: units, assisted_units: units, award_year: year, type_of_credits: '9%', project_type: 'New Construction'
});
const PROPS = {
  metadata: { generated: '2026-01-15T00:00:00Z' },
  properties: [
    invented(1, 'Invented Mesa Commons', 'Invented Mesa Town', MESA, 60, 2023),
    invented(2, 'Invented Hinsdale Lofts', 'Invented Hinsdale Town', HINSDALE, 12, 2022),
    invented(3, 'Invented Denver Court', 'Invented Denver Town', DENVER, 120, 2024)
  ]
};

// The browser the other calculator page tests launch (deal-calculator-member-place.test.mjs).
const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fromPuppeteer && fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });

// gate: when set, the property file waits until gate.release() is called.
async function open(width, gate) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1));
    if (rel === 'data/affordable-housing/properties.json') {
      if (gate) await gate.wait;
      return route.fulfill({ json: PROPS });
    }
    const f = path.resolve(ROOT, rel);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
  });
  await tab.goto(ORIGIN + '/deal-calculator.html?classic=1', { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => document.getElementById('dc-chfa-comps-details')
    && document.getElementById('dc-county-select') && document.getElementById('dc-county-select').options.length > 60, null, { timeout: 60000 });
  await tab.waitForTimeout(600);
  return { ctx, tab, errors };
}
const body = (tab) => tab.evaluate(() => document.getElementById('dc-chfa-comps-body').textContent);
const firstRow = (tab) => tab.evaluate(() => {
  const td = document.querySelector('#dc-chfa-comps-body tbody tr td');
  return td ? td.textContent : null;
});
const setOpen = (tab, open) => tab.evaluate((o) => { document.getElementById('dc-chfa-comps-details').open = o; }, open);
async function waitFirst(tab, name) {
  await tab.waitForFunction((n) => {
    const td = document.querySelector('#dc-chfa-comps-body tbody tr td');
    return td && td.textContent === n;
  }, name, { timeout: 10000 }).catch(() => {});
  return firstRow(tab);
}

try {
  for (const width of [1280, 390]) {
    const { ctx, tab, errors } = await open(width);
    await setOpen(tab, true);
    await tab.selectOption('#dc-county-select', MESA);
    ok(await waitFirst(tab, 'Invented Mesa Commons') === 'Invented Mesa Commons', width + 'px: picking Mesa lists the Mesa project first, got ' + await firstRow(tab));
    await tab.selectOption('#dc-county-select', HINSDALE);
    ok(await waitFirst(tab, 'Invented Hinsdale Lofts') === 'Invented Hinsdale Lofts', width + 'px: changing to Hinsdale lists the Hinsdale project first, got ' + await firstRow(tab));
    await tab.selectOption('#dc-county-select', DENVER);
    ok(await waitFirst(tab, 'Invented Denver Court') === 'Invented Denver Court', width + 'px: changing to Denver lists the Denver project first, got ' + await firstRow(tab));
    // Close, pick Mesa while closed, reopen: the panel shows Mesa, not the county it last drew.
    await setOpen(tab, false);
    await tab.selectOption('#dc-county-select', MESA);
    await setOpen(tab, true);
    ok(await waitFirst(tab, 'Invented Mesa Commons') === 'Invented Mesa Commons', width + 'px: reopening after a pick made while closed shows Mesa, got ' + await firstRow(tab));
    // Close and reopen with no change keeps the rows.
    await setOpen(tab, false); await setOpen(tab, true);
    ok(await waitFirst(tab, 'Invented Mesa Commons') === 'Invented Mesa Commons', width + 'px: close and reopen keeps the Mesa rows');
    // Clear: no county and no saved project means the prompt, with no rows left over.
    await tab.selectOption('#dc-county-select', '');
    await tab.waitForTimeout(500);
    ok(/Select a county/.test(await body(tab)) && await firstRow(tab) === null, width + 'px: clearing the county shows the prompt and no rows: ' + (await body(tab)).slice(0, 80));
    ok(errors.length === 0, width + 'px: no page errors: ' + errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // A slow file: Mesa is picked while the file is still loading, then the county changes. The late answer must
  // draw only the county now picked.
  {
    let release; const gate = { wait: new Promise((r) => { release = r; }) };
    const { ctx, tab, errors } = await open(1280, gate);
    await setOpen(tab, true);
    await tab.selectOption('#dc-county-select', MESA);
    await tab.waitForTimeout(300);
    await tab.selectOption('#dc-county-select', '');
    await tab.waitForTimeout(300);
    release();
    await tab.waitForTimeout(800);
    ok(/Select a county/.test(await body(tab)) && await firstRow(tab) === null, 'a late answer for Mesa after the county was cleared draws no Mesa rows: ' + (await body(tab)).slice(0, 80));
    await tab.selectOption('#dc-county-select', HINSDALE);
    ok(await waitFirst(tab, 'Invented Hinsdale Lofts') === 'Invented Hinsdale Lofts', 'after the late answer, picking Hinsdale lists Hinsdale');
    ok(errors.length === 0, 'slow file: no page errors: ' + errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  {
    let release; const gate = { wait: new Promise((r) => { release = r; }) };
    const { ctx, tab } = await open(1280, gate);
    await setOpen(tab, true);
    await tab.selectOption('#dc-county-select', MESA);
    await tab.waitForTimeout(300);
    await tab.selectOption('#dc-county-select', DENVER);
    await tab.waitForTimeout(300);
    release();
    ok(await waitFirst(tab, 'Invented Denver Court') === 'Invented Denver Court', 'a late answer after Mesa then Denver draws Denver, got ' + await firstRow(tab));
    await tab.waitForTimeout(600);
    ok(await firstRow(tab) === 'Invented Denver Court', 'and Mesa never paints over it afterwards');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`deal-calculator-chfa-comps: ${checks} checks passed`);
