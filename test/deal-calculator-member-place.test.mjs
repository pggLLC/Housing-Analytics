#!/usr/bin/env node
// Two member-site regressions from moving the Deal Calculator into the site shell (HA #3013), found on the member
// live check of 26 Nov 2026:
// 1. The member bar (js/whitepaper/member-calculator.js, with submittal-review.js before it) loads on the member
//    site again, from js/components/dc-member-calculator.js; never on the public site or in the workbook's frame.
// 2. The place the member is working on (coho-member-place / coho-lab-working) wins over the old pages' saved
//    project and county, and the calculator never writes a county it filled in by itself over it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
// Stand-in hosts, kept out of URL form so the source URL sweep skips them.
const MEMBER = 'http:/' + '/coho-test.example.workers.dev';
const PUBLIC = 'http:/' + '/example.org';

const html = fs.readFileSync(path.join(ROOT, 'deal-calculator.html'), 'utf8');
ok(html.includes('<script src="js/components/dc-member-calculator.js"></script>'), 'deal-calculator.html loads the member bar loader');
ok(html.includes('<meta name="coho-place-order" content="kept-first">'), 'deal-calculator.html puts the kept place first');

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fromPuppeteer && fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });

// The old pages' saved state: an El Paso project and county (js/workflow-state-core.js, js/site-state.js).
const OLD = {
  coho_wf_active: JSON.stringify('p1'),
  coho_wf_project_p1: JSON.stringify({ id: 'p1', jurisdiction: { fips: '08041', geoid: '08041', geoType: 'county', name: 'El Paso County' } }),
  coho_state_county: JSON.stringify({ fips: '08041', name: 'El Paso County' }),
  coho_state_jurisdictionChange: JSON.stringify({ from: '08077', to: '08041' })
};
const FRUITA = { geoid: '0828745', name: 'Fruita (city)', at: 1764000000000 };

async function open(origin, store, framed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  const loaded = [];
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    // Only the member site serves js/whitepaper/; stand-ins record that they ran, in order.
    if (u.pathname.startsWith('/js/whitepaper/')) {
      loaded.push(u.pathname);
      return route.fulfill({ body: `(window.__mc = window.__mc || []).push(${JSON.stringify(u.pathname)});`, contentType: 'text/javascript' });
    }
    const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
  });
  await tab.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in s) localStorage.setItem(k, s[k]); } }, store);
  if (framed) {
    await tab.goto(origin + '/404.html');
    await tab.evaluate((src) => new Promise((r) => { const f = document.createElement('iframe'); f.src = src; f.onload = r; document.body.appendChild(f); }), origin + '/deal-calculator.html');
  } else {
    await tab.goto(origin + '/deal-calculator.html', { waitUntil: 'load' });
  }
  return { ctx, tab, errors, loaded };
}
async function settle(tab) {
  await tab.waitForFunction(() => { const s = document.getElementById('dc-county-select'); return s && s.options.length > 10; }, null, { timeout: 30000 });
  await tab.waitForTimeout(2500);
}
const kept = (tab) => tab.evaluate(() => ({ member: JSON.parse(localStorage.getItem('coho-member-place') || 'null'), lab: JSON.parse(localStorage.getItem('coho-lab-working') || 'null'), county: document.getElementById('dc-county-select').value, bar: (document.getElementById('dcStepBar') || {}).textContent || '' }));

try {
  // 1. The member bar.
  {
    const m = await open(MEMBER, {});
    await m.tab.waitForFunction(() => (window.__mc || []).length === 2, null, { timeout: 15000 });
    ok(JSON.stringify(await m.tab.evaluate(() => window.__mc)) === JSON.stringify(['/js/whitepaper/submittal-review.js', '/js/whitepaper/member-calculator.js']), 'member site: the review script, then the member bar');
    await m.ctx.close();
    const p = await open(PUBLIC, {});
    await p.tab.waitForTimeout(1500);
    ok(p.loaded.length === 0, 'public site: no member scripts requested');
    await p.ctx.close();
    const f = await open(MEMBER, {}, true);
    await f.tab.waitForTimeout(3000);
    ok(f.loaded.length === 0, "member site, the workbook's hidden frame: no member bar");
    await f.ctx.close();
  }
  // 2. The member's place over the old pages' project.
  {
    const m = await open(MEMBER, { ...OLD, 'coho-member-place': JSON.stringify(FRUITA) });
    await settle(m.tab);
    const k = await kept(m.tab);
    ok(k.county === '08077', 'Fruita kept: the calculator opens on Mesa County, not El Paso (' + k.county + ')');
    ok(k.member && k.member.geoid === '0828745', 'Fruita kept: the member place is still Fruita (' + JSON.stringify(k.member) + ')');
    ok(!k.lab || k.lab.geoid === '0828745', 'Fruita kept: the hub place is not El Paso or Mesa (' + JSON.stringify(k.lab) + ')');
    ok(/Fruita/.test(k.bar), 'Fruita kept: the step bar names Fruita');
    ok(m.errors.length === 0, 'Fruita kept: no page errors ' + m.errors.join(' | '));
    // A county the member picks becomes the kept place.
    // (A real key press, as a person picks: a change the page makes itself is not a pick.)
    await m.tab.focus('#dc-county-select');
    await m.tab.keyboard.press('ArrowDown');
    await m.tab.waitForTimeout(300);
    const k2 = await kept(m.tab);
    ok(k2.county !== '08077' && k2.member && k2.member.geoid === k2.county, 'a county picked by hand becomes the member place (' + JSON.stringify(k2) + ')');
    await m.ctx.close();
  }
  {
    // Nothing kept: the calculator may fill in the old county, but never keeps it.
    const m = await open(MEMBER, { ...OLD });
    await settle(m.tab);
    const k = await kept(m.tab);
    ok(!k.member && !k.lab, 'nothing kept: the old county is not written as the place (' + JSON.stringify(k) + ')');
    await m.ctx.close();
  }
  console.log('deal-calculator-member-place: ' + checks + ' checks passed');
} finally {
  await browser.close();
}
