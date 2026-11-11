// "Working on: <place>" on member pages (js/whitepaper/member-place.js). Run: node test/member-place.test.mjs
// The pure parts are checked directly; the line itself is drawn in Chromium on real member pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MP = require(path.join(ROOT, 'js/whitepaper/member-place.js'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// The address wins, and only the parameter that page reads counts.
ok(MP.fromAddress('/developer-brief.html', '?geoid=0867280') === '0867280', 'a report link carries its place');
ok(MP.fromAddress('/developer-commuters.html', '?geoid=08015') === '08015', 'a county counts where the page takes one');
ok(MP.fromAddress('/developer-market-screen.html', '?place=0867280') === '0867280' && MP.fromAddress('/developer-market-screen.html', '?place=08015') === null, 'Market screen takes towns only');
ok(MP.fromAddress('/developer-brief.html', '?geoid=9999999') === null && MP.fromAddress('/developer-brief.html', '?geoid=<b>') === null && MP.fromAddress('/developer-brief.html', '') === null, 'anything that is not a Colorado place is ignored');
ok(MP.fromAddress('/developer-pipeline.html', '?geoid=0867280') === null && MP.fromAddress('/developer-brief.html', '?place=0867280') === null, 'a page that takes no place, or another parameter, sets nothing');

// "Open it here" exists only where the page opens on a place.
ok(MP.hrefFor('/developer-brief.html', '0867280') === 'developer-brief.html?geoid=0867280' && MP.hrefFor('/developer-market-screen.html', '0867280') === 'developer-market-screen.html?place=0867280', 'each page gets its own parameter');
ok(MP.hrefFor('/developer-market-screen.html', '08015') === '' && MP.hrefFor('/developer-pipeline.html', '0867280') === '' && MP.hrefFor('/developer-brief.html', 'x') === '', 'no link where the page cannot take the place');
ok(Object.keys(MP.TAKES).every((f) => fs.existsSync(path.join(ROOT, f)) || /hna-input|hap-survey|commuters|market-screen/.test(f)), 'every page listed is a member page (four live in coho-backend)');

// The kept place: read and written inside a try, and never trusted.
{
  const mem = new Map();
  const store = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) });
  ok(MP.read(store) === null, 'nothing kept to start');
  ok(MP.write(store, { geoid: '0867280', name: 'Salida' }) && MP.read(store).name === 'Salida' && MP.read(store).geoid === '0867280', 'a place is kept and read back');
  mem.set(MP.KEY, JSON.stringify({ geoid: '<script>', name: 'x' }));
  ok(MP.read(store) === null, 'a kept value that is not a place is ignored');
  mem.set(MP.KEY, '{bad');
  ok(MP.read(store) === null, 'a broken value is ignored');
  ok(MP.write(store, null) && !mem.has(MP.KEY), 'clearing removes it');
  const blocked = () => { throw new Error('storage blocked'); };
  ok(MP.read(blocked) === null && MP.write(blocked, { geoid: '0867280', name: 'Salida' }) === false, 'blocked storage is reported, not thrown');
}

// Names: towns from the centroids file, counties from DOLA's list, each once, by name.
{
  const list = MP.placeList({ byGeoid: { '0867280': { name: 'Salida city' }, '0803455': { name: 'Aspen city' }, '0800320': { name: 'Acres Green CDP' }, '0811111': { name: 'Twin Peaks town' }, '0822222': { name: 'Twin Peaks city' }, 'bad': { name: 'x' } } },
    { jurisdictions: { '08015': { name: 'Chaffee County' }, '0867280': { name: 'Salida (dup)' } } });
  ok(list.map((p) => p.name).join('|') === 'Acres Green CDP|Aspen|Chaffee County|Salida|Twin Peaks city|Twin Peaks town', 'towns and counties, each once, sorted, "city" and "town" dropped unless two places would share a name');
  ok(MP.nameOf(list, '08015') === 'Chaffee County' && MP.nameOf(list, '0899999') === '', 'a name by its code');
  ok(MP.findByName(list, '  salida ').geoid === '0867280' && MP.findByName(list, 'Sal') === null && MP.findByName(list, '') === null, 'only a full name from the list picks a place');
}

const src = fs.readFileSync(path.join(ROOT, 'js/whitepaper/member-place.js'), 'utf8');
ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), 'names are never written as HTML');
ok(!/location\.replace|location\.assign/.test(src), 'the line never redirects a page on its own');
ok(/member-place\.js/.test(fs.readFileSync(path.join(ROOT, 'js/whitepaper/developer-nav.js'), 'utf8')), 'the member menu loads it');

// The line on real pages, in Chromium at phone and desktop width.
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json', '.csv': 'text/csv' };
const ORIGIN = 'http://example.org';
// The same browser lookup as test/member-phone-header.test.mjs: Playwright's own, else Puppeteer's (CI).
const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('ib-auth-v1', JSON.stringify({ ts: Date.now() })); } catch (e) { /* blocked */ } });
    const tab = await ctx.newPage();
    const errors = [];
    tab.on('pageerror', (e) => errors.push(String(e)));
    await tab.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      const f = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: mime[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
    const line = () => tab.locator('#mpLine');

    // A page that takes no place: nothing picked yet.
    await tab.goto(ORIGIN + '/developer-pipeline.html');
    await line().waitFor();
    ok((await line().innerText()).startsWith('No place picked.'), `${width}: says when no place is picked`);
    ok(await tab.locator('#mpLine a').count() === 0, `${width}: no "Open it here" without a place`);

    // A link with a place sets it, and the name is looked up.
    await tab.goto(ORIGIN + '/developer-brief.html?geoid=0867280');
    await tab.waitForFunction(() => /Working on: Salida/.test((document.getElementById('mpLine') || {}).innerText || ''));
    ok(await tab.locator('#mpLine a').count() === 0, `${width}: no "Open it here" on the page already showing the place`);

    // The next page knows it, and offers to open on it only where it can.
    await tab.goto(ORIGIN + '/developer-pipeline.html');
    await line().waitFor();
    ok(/Working on: Salida/.test(await line().innerText()) && await tab.locator('#mpLine a').count() === 0, `${width}: the place carries to a page that takes none`);
    await tab.goto(ORIGIN + '/developer-brief.html');
    await line().waitFor();
    ok(await tab.locator('#mpLine a').getAttribute('href') === 'developer-brief.html?geoid=0867280', `${width}: a page that takes a place offers to open on it`);
    ok(new URL(tab.url()).search === '', `${width}: and does not move there by itself`);

    // Layout: under the menu, inside the page, tappable.
    const box = await tab.evaluate(() => {
      const l = document.getElementById('mpLine').getBoundingClientRect(), n = (document.getElementById('devSubNav') || document.getElementById('devNav')).getBoundingClientRect();
      const btn = [...document.querySelectorAll('#mpLine a, #mpLine button')].map((b) => b.getBoundingClientRect().height);
      return { below: l.top >= n.bottom - 1, wide: document.documentElement.scrollWidth, vw: window.innerWidth, minTap: Math.min(...btn), height: l.height };
    });
    ok(box.below && box.wide <= box.vw, `${width}: the line sits under the menu and nothing scrolls sideways`);
    ok(box.minTap >= 44, `${width}: every action is at least 44px tall`);
    ok(box.height <= (width < 500 ? 104 : 56), `${width}: the line stays compact (${box.height}px)`);

    // Change: a name from the list replaces the place; a partial name does not.
    await tab.getByRole('button', { name: 'Change' }).click();
    await tab.waitForFunction(() => document.querySelectorAll('#mpPlaces option').length > 100);
    await tab.fill('#mpInput', 'Gunn');
    await tab.getByRole('button', { name: 'Use this place' }).click();
    ok(/from the list/.test(await line().innerText()), `${width}: a partial name is not accepted`);
    await tab.fill('#mpInput', 'Gunnison');
    await tab.getByRole('button', { name: 'Use this place' }).click();
    await tab.waitForFunction(() => /Working on: Gunnison/.test(document.getElementById('mpLine').innerText));
    ok(await tab.evaluate((k) => JSON.parse(localStorage.getItem(k)).geoid, MP.KEY) === '0833640', `${width}: the new place is kept`);

    // Clear.
    await tab.getByRole('button', { name: 'Clear' }).click();
    ok((await line().innerText()).startsWith('No place picked.') && await tab.evaluate((k) => localStorage.getItem(k), MP.KEY) === null, `${width}: Clear forgets the place`);

    // Clear while the name is still loading: the late answer must not bring the place back (Codex, #2774).
    {
      let release; const held = new Promise((r) => { release = r; });
      await tab.route('**/data/co-place-centroids.json', async (route) => { await held; route.fallback(); });
      await tab.goto(ORIGIN + '/developer-brief.html?geoid=0803455');
      await tab.waitForFunction(() => /Working on: 0803455/.test((document.getElementById('mpLine') || {}).innerText || ''));
      await tab.getByRole('button', { name: 'Clear' }).click();
      release();
      await tab.waitForTimeout(1200);
      ok((await line().innerText()).startsWith('No place picked.') && await tab.evaluate((k) => localStorage.getItem(k), MP.KEY) === null, `${width}: a place cleared while its name loads stays cleared`);
      await tab.unroute('**/data/co-place-centroids.json');
    }

    // The report's own picker switches place: the line and the kept place follow it (Codex, #2774).
    await tab.goto(ORIGIN + '/developer-brief.html?geoid=0867280');
    await tab.waitForFunction(() => /Working on: Salida/.test((document.getElementById('mpLine') || {}).innerText || ''));
    await tab.waitForFunction(() => document.querySelectorAll('#briefPickerList option').length > 100);
    const gunnison = await tab.evaluate(() => [...document.querySelectorAll('#briefPickerList option')].map((o) => o.value).find((v) => /^Gunnison[^—]* — /.test(v)));
    ok(!!gunnison, `${width}: the report's picker lists Gunnison`);
    await tab.fill('#briefPicker', gunnison);
    await tab.dispatchEvent('#briefPicker', 'change');
    await tab.waitForFunction(() => new URLSearchParams(location.search).get('geoid') === '0833640');
    await tab.waitForFunction(() => /Working on: Gunnison/.test(document.getElementById('mpLine').innerText));
    ok(await tab.evaluate((k) => JSON.parse(localStorage.getItem(k)).geoid, MP.KEY) === '0833640', `${width}: the report's own pick is kept`);
    ok(await tab.locator('#mpLine a').count() === 0, `${width}: no "Open it here" for the place already shown`);

    // Print: the line stays off the page.
    await tab.emulateMedia({ media: 'print' });
    ok(await line().isHidden(), `${width}: hidden in print`);
    ok(errors.length === 0, `${width}: no script errors (${errors.join('; ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`member-place: ${checks} checks passed`);
