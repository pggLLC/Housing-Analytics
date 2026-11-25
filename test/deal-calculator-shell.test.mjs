#!/usr/bin/env node
// The Deal Calculator in the site's own shell (paul, 25 Nov 2026, build plan item 10; fresh-eyes fix 1: "Give the Deal
// Calculator the site's own header, menu and fonts, with one place picker. Put the tool and its result first, and
// move the long reference sections to their own pages.").
//
// 1. The page wears the same header and footer as Market Analysis (both from hub/page-chrome.js and hub/nav.js) and
//    no longer loads js/navigation.js, js/dark-mode-toggle.js or js/mobile-menu.js.
// 2. The old seven-step rail is gone; the new pages' bar takes its place (js/components/dc-step-bar.js).
// 3. The reading that sat below the tool is on deal-reference.html, which the calculator links to; nothing is lost.
// 4. In a browser, with a county picked in the quick start: the bar says step 6, "You are here", and names the county;
//    the "Choose a jurisdiction first" notice and the duplicate "Analyzing" banner are down; no sideways scroll.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const calc = read('deal-calculator.html');
const ref = read('deal-reference.html');
const ma = read('deal-market-analysis.html');
const part = (src, re) => (re.exec(src) || [''])[0];

// 1. Shell.
for (const [name, src] of [['deal-calculator.html', calc], ['deal-reference.html', ref]]) {
  ok(part(src, /<header class="site-header">[\s\S]*?<\/header>/) === part(ma, /<header class="site-header">[\s\S]*?<\/header>/), name + ': header differs from Market Analysis');
  ok(part(src, /<footer class="site-footer">[\s\S]*?<\/footer>/) === part(ma, /<footer class="site-footer">[\s\S]*?<\/footer>/), name + ': footer differs from Market Analysis');
  ['js/navigation.js', 'js/dark-mode-toggle.js', 'js/mobile-menu.js'].forEach((f) => ok(!src.includes('src="' + f + '"'), name + ' still loads ' + f));
  ['hub/lab-config.js', 'hub/page-chrome.js', 'hub/nav.js'].forEach((f) => ok(src.includes('<script src="' + f + '"></script>'), name + ' does not load ' + f));
  ok(/<body[^>]*data-menu="deal"[^>]*class="tool-page"/.test(src), name + ': body is not a Money and deals tool page');
  ok(src.includes('css/pages/market-analysis-hub.css'), name + ': missing the tool-page bridge sheet');
  ok(src.includes("gs.src = 'js/glossary.js'"), name + ': the glossary is no longer loaded as navigation.js did');
}

// 2. Step bar and heading.
const doc = new JSDOM(calc).window.document;
ok(!doc.getElementById('dcWorkflowProgress') && !doc.querySelector('.wf-progress-wrap'), 'the old seven-step rail is still on the page');
ok(doc.getElementById('dcStepBar'), 'no block for the new step bar');
ok(calc.includes('<script src="hub/step-bar.js"></script>\n<script src="js/components/dc-step-bar.js"></script>'), 'the step bar scripts are missing or out of order');
const h1 = doc.querySelectorAll('h1');
ok(h1.length === 1 && h1[0].textContent.includes('Deal Calculator'), 'one heading, "Deal Calculator"');
ok(!/Step 6 of 7/.test(doc.querySelector('.dc-hero').textContent), 'the hero still says "Step 6 of 7"; the bar says it');
ok(doc.querySelector('.dc-hero details.dc-about-fold [role="note"]').textContent.includes('not a substitute for lender underwriting'), 'the screening note is gone');
ok(doc.querySelector('.dc-hero a[href="#dcAboutAndContext"]') && doc.getElementById('dcAboutAndContext'), 'the link to what the calculator does not model is gone');
ok(doc.querySelector('nav.crumbs a[href="deal-hub.html#/projects"]'), 'no trail back to Build a deal');

// 3. Reference reading: moved, linked, whole.
const rdoc = new JSDOM(ref).window.document;
const card = [...doc.querySelectorAll('.dc-ref-card a[href^="deal-reference.html#"]')].map((a) => a.getAttribute('href').split('#')[1]);
ok(card.join() === 'hard,cra,checklists', 'the calculator card links: ' + card.join());
card.forEach((id) => ok(rdoc.getElementById(id), 'deal-reference.html has no #' + id));
['dcEduHeading', 'dcCraHeading', 'dcCraGrid', 'dealPPP', 'dealColorado', 'dealProjectTypes'].forEach((id) => {
  ok(!doc.getElementById(id), id + ' is still on the calculator');
  ok(rdoc.getElementById(id), id + ' is missing from deal-reference.html');
});
ok(rdoc.querySelectorAll('.dc-edu-item').length === 8, 'the eight "what makes deals hard" parts did not all move');
ok(doc.getElementById('dcSoftFundingHeading'), 'the soft-funding pointer, which describes the calculator’s own breakdown, left the calculator');
ok(!calc.includes('CRA_LENDERS') && read('js/components/cra-lenders.js').includes('CRA_LENDERS'), 'the lender list is not in one place');
ok(ref.includes('<script src="js/components/cra-lenders.js"></script>') && ref.includes('src="js/components/development-realism.js"'), 'deal-reference.html does not load its renderers');

// 4. In a browser.
const ORIGIN = 'http://example.org';
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
const bundled = chromium.executablePath();
// As test/workflow-rail-circles.test.mjs: Playwright's own browser, else Puppeteer's (CI), else this machine's.
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fromPuppeteer && fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await ctx.newPage();
    const errors = [];
    tab.on('pageerror', (e) => errors.push(String(e)));
    await tab.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
      if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
    });
    await tab.goto(`${ORIGIN}/deal-calculator.html`, { waitUntil: 'load', timeout: 90000 });
    await tab.waitForSelector('#dq-county option[value="08077"]', { state: 'attached', timeout: 60000 });
    await tab.selectOption('#dq-county', '08077');
    await tab.waitForTimeout(1500);
    const m = await tab.evaluate(() => ({
      here: (document.querySelector('#dcStepBar .sp-here') || {}).textContent || '',
      hereStep: ((document.querySelector('#dcStepBar .sp-here') || {}).closest ? document.querySelector('#dcStepBar .sp-here').closest('li, a, div').textContent : ''),
      bar: document.getElementById('dcStepBar').textContent,
      notice: [...document.querySelectorAll('.wf-next-action--skipped')].filter((n) => n.getClientRects().length).length,
      banner: (() => { const b = document.getElementById('dcJurisdictionBanner'); return b && b.getClientRects().length ? 1 : 0; })(),
      sw: document.documentElement.scrollWidth,
      menu: document.querySelectorAll('#site-nav .menu-button').length,
      cols: (() => { const g = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width) }; }; return { i: g('dc-inputs-col'), p: g('dc-pro-forma-col'), c: g('dc-capital-stack-col'), kids: document.getElementById('dc-calc-grid') ? document.getElementById('dc-calc-grid').children.length : 0 }; })(),
    }));
    const where = `deal-calculator.html at ${width}px`;
    ok(/You are here/.test(m.here) && /Deal Calculator/.test(m.hereStep), `${where}: step 6 is not marked "You are here" (${m.hereStep})`);
    ok(/Mesa County/.test(m.bar), `${where}: the bar does not name the county picked in the quick start`);
    ok(m.notice === 0, `${where}: "Choose a jurisdiction first" still shows with a county picked`);
    ok(m.banner === 0, `${where}: the "Analyzing" banner repeats the bar`);
    ok(m.sw <= width, `${where}: the page scrolls sideways (${m.sw})`);
    ok(m.menu >= 4, `${where}: the site's menus did not draw (${m.menu})`);
    // Two columns on a wide screen (paul's pick, 25 Nov): inputs left, pro forma then capital stack on the right.
    const { i, p, c } = m.cols;
    ok(i && p && c, `${where}: the calculator's three blocks did not draw (${JSON.stringify(m.cols)})`);
    if (width >= 1100) {
      ok(p.x > i.x + i.w - 2 && Math.abs(p.y - i.y) < 4, `${where}: the pro forma is not beside the inputs (${JSON.stringify(m.cols)})`);
      ok(Math.abs(c.x - p.x) < 2 && c.y > p.y, `${where}: the capital stack is not under the pro forma (${JSON.stringify(m.cols)})`);
    } else {
      ok(Math.abs(p.x - i.x) < 2 && p.y > i.y, `${where}: the phone layout is not one column (${JSON.stringify(m.cols)})`);
    }

    await tab.goto(`${ORIGIN}/deal-reference.html`, { waitUntil: 'load', timeout: 90000 });
    await tab.waitForTimeout(800);
    const r = await tab.evaluate(() => ({ lenders: document.querySelectorAll('#dcCraGrid .dc-cra-card').length, colorado: (document.getElementById('dealColorado') || {}).textContent || '', sw: document.documentElement.scrollWidth }));
    ok(r.lenders > 5, `deal-reference.html at ${width}px: the lender cards did not draw (${r.lenders})`);
    ok(r.colorado.length > 100, `deal-reference.html at ${width}px: the Colorado checklist did not draw`);
    ok(r.sw <= width, `deal-reference.html at ${width}px: scrolls sideways (${r.sw})`);
    ok(!errors.length, `${width}px: page errors: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`deal-calculator-shell: ${checks} checks passed`);
