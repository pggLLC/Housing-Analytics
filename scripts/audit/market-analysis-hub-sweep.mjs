#!/usr/bin/env node
// Control by control: market-analysis.html against deal-market-analysis.html.
//
// scripts/audit/market-analysis-hub-parity.mjs compares the two pages after one analysis. This goes through the
// page one control at a time. On each page it runs the same analysis for the same invented site, then changes
// every field in turn (ticks or unticks a box, picks the next option, raises a number, types into a text box)
// and then presses every button in turn. After each step it records what the page shows: every word and number
// in <main>, the value of every field and the result the engine holds. The two pages must record the same thing
// at every step.
//
//   node scripts/audit/market-analysis-hub-sweep.mjs [--base http://127.0.0.1:8080] [--out report.json] [--only fields|buttons]
// Exits 1 on any difference. Not part of ci-checks (it needs a browser).
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = (arg('--base') || 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUT = arg('--out'), ONLY = arg('--only');
const OLD = 'market-analysis.html', NEW = process.argv.includes('--control') ? OLD : 'deal-market-analysis.html';
const SITE = { lat: 40.4233, lon: -104.7091 }; // a point in Greeley; not a project

const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?|\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)/g;
const clean = s => String(s).replace(STAMP, '<time>').replace(/\(\d+ ?ms\)/g, '(<ms>)').replace(/\s+/g, ' ').trim();
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// Runs inside the page: wait until the words in <main> stop changing.
const settle = () => new Promise(resolve => {
  const main = document.getElementById('main-content');
  let last = main.textContent, still = 0, n = 0;
  const t = setInterval(() => { const now = main.textContent; n++; if (now === last) { if (++still >= 3) { clearInterval(t); resolve(); } } else { still = 0; last = now; } if (n > 40) { clearInterval(t); resolve(); } }, 120);
});
// Runs inside the page: what a visitor can read, and what the engine holds.
const snapshot = () => {
  const live = document.getElementById('main-content'), main = live.cloneNode(true);
  main.querySelectorAll('nav.crumbs, .gl-tooltip-popup, script, style, noscript, template').forEach(n => n.remove());
  const fields = [...live.querySelectorAll('input, select, textarea')].map(e => (e.id || e.name || e.type) + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)).join('\n');
  const shown = [...live.querySelectorAll('section, details, [role="tabpanel"], .pma-card')].map(e => (e.id || '') + ':' + (e.offsetParent !== null ? 1 : 0) + (e.open ? 'o' : '')).join(',');
  const s = window.PMAEngine && window.PMAEngine._state;
  return { text: main.textContent.replace(/\s+/g, ' ').trim(), fields, shown, engine: s ? JSON.stringify([s.getLastResult(), s.getLastScenarios(), s.getLastBenchmark()]) : '', dialogs: document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden])').length, at: location.pathname.split('/').pop() + location.hash };
};

// The tool keeps more memory with every recalculation, so the page is opened afresh for each batch of controls:
// same site, same first analysis, then the next batch. Both pages get the same batches.
const BATCH = 40;
const FIELDS = '#main-content input, #main-content select, #main-content textarea', BUTTONS = '#main-content button';

async function openPage(browser, file) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.route('**/*', route => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; window.open = () => null; });
  await page.goto(BASE + '/' + file, { waitUntil: 'load' });
  await page.waitForFunction(() => window.PMAEngine && window.PMAEngine.whenDataReady, null, { timeout: 60000 });
  await page.evaluate(() => window.PMAEngine.whenDataReady());
  await page.evaluate(({ lat, lon }) => { window.PMAEngine.placeSiteMarker(lat, lon); return window.PMAEngine.runAnalysis(lat, lon); }, SITE);
  await page.waitForFunction(() => window.PMAEngine._state.getLastResult(), null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll('#main-content details').forEach(d => { d.open = true; }));
  await page.waitForTimeout(3000);
  await page.evaluate(settle);
  return { ctx, page, errors };
}

async function runPage(browser, file) {
  const steps = [], errors = [];
  let printed = 0;
  for (const kind of ['field', 'button']) {
    if (ONLY && ONLY !== kind + 's') continue;
    const sel = kind === 'field' ? FIELDS : BUTTONS;
    let total = null;
    for (let from = 0; total === null || from < total; from += BATCH) {
      const { ctx, page, errors: errs } = await openPage(browser, file);
      const record = async (k, name, note) => {
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.evaluate(settle);
        const s = await page.evaluate(snapshot);
        steps.push({ kind: k, name, note: note || '', text: hash(clean(s.text)), fields: hash(s.fields), shown: hash(s.shown), engine: hash(clean(s.engine)), dialogs: s.dialogs, at: s.at.replace(file, '<page>'), words: clean(s.text) });
      };
      if (total === null) total = await page.evaluate(sel => document.querySelectorAll(sel).length, sel);
      await record('start', kind + 's ' + from + ' to ' + Math.min(from + BATCH, total) + ', after the first analysis');
      for (let i = from; i < Math.min(from + BATCH, total); i++) {
        const did = await page.evaluate(kind === 'field' ? changeField : pressButton, { sel, i }).catch(e => ({ name: '#' + i, note: 'page moved: ' + String(e.message).slice(0, 60) }));
        await record(kind, did.name, did.note).catch(async e => { steps.push({ kind, name: did.name, note: did.note + ' (then the page could not be read: ' + String(e.message).slice(0, 50) + ')', text: '', fields: '', shown: '', engine: '', dialogs: 0, at: '', words: '' }); });
        if (page.isClosed() || !(await page.evaluate(() => !!document.getElementById('main-content')).catch(() => false))) break;
      }
      printed += await page.evaluate(() => window.__printed || 0).catch(() => 0);
      errors.push(...errs);
      await ctx.close();
      process.stderr.write(file + ' ' + kind + 's ' + Math.min(from + BATCH, total) + '/' + total + '\n');
    }
  }
  return { steps, errors, printed };
}

// Runs inside the page: change one field the way a visitor would.
const changeField = ({ sel, i }) => {
  const e = document.querySelectorAll(sel)[i];
  if (!e) return { name: '#' + i, note: 'gone' };
  const name = (e.id || e.name || e.getAttribute('aria-label') || e.type) + ' [' + (e.tagName === 'SELECT' ? 'select' : e.type) + ']';
  if (e.disabled || e.readOnly || e.type === 'hidden' || e.type === 'file') return { name, note: 'not changeable (' + (e.disabled ? 'disabled' : e.readOnly ? 'read-only' : e.type) + ')' };
  const fire = () => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  let note;
  if (e.tagName === 'SELECT') { if (e.options.length < 2) return { name, note: 'one option' }; e.selectedIndex = (e.selectedIndex + 1) % e.options.length; note = 'picked "' + e.options[e.selectedIndex].textContent.trim().slice(0, 40) + '"'; fire(); }
  else if (e.type === 'checkbox') { e.click(); note = e.checked ? 'ticked' : 'unticked'; }
  else if (e.type === 'radio') { if (e.checked) return { name, note: 'already chosen' }; e.click(); note = 'chosen'; }
  else if (e.type === 'number' || e.type === 'range') {
    const step = Number(e.step) > 0 ? Number(e.step) : 1, cur = Number(e.value) || 0, max = e.max === '' ? Infinity : Number(e.max), min = e.min === '' ? -Infinity : Number(e.min);
    let v = cur + step; if (v > max) v = cur - step; if (v < min) v = cur;
    e.value = String(Math.round(v * 1e6) / 1e6); note = 'set to ' + e.value; fire();
  } else if (e.type === 'date') { e.value = '2027-03-01'; note = 'set to 2027-03-01'; fire(); }
  else { e.value = e.value ? e.value + ' 2' : 'Test 12'; note = 'typed "' + e.value.slice(0, 30) + '"'; fire(); }
  return { name, note };
};
// Runs inside the page: press one button.
const pressButton = ({ sel, i }) => {
  const e = document.querySelectorAll(sel)[i];
  if (!e) return { name: '#' + i, note: 'gone' };
  const name = (e.id || e.getAttribute('aria-label') || e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) || 'button') + ' [button]';
  if (e.disabled) return { name, note: 'disabled' };
  if (e.offsetParent === null) return { name, note: 'not shown' };
  e.click();
  return { name, note: 'pressed' };
};

const browser = await chromium.launch();
// One page at a time: two copies of the tool recomputing at once need more memory than a small machine has.
const o = await runPage(browser, OLD), n = await runPage(browser, NEW);
await browser.close();
const diffs = [];
if (o.steps.length !== n.steps.length) diffs.push({ step: -1, what: 'steps: ' + o.steps.length + ' on the old page, ' + n.steps.length + ' on the new' });
for (let i = 0; i < Math.min(o.steps.length, n.steps.length); i++) {
  const a = o.steps[i], b = n.steps[i];
  const bad = ['name', 'note', 'text', 'fields', 'shown', 'engine', 'dialogs', 'at'].filter(k => a[k] !== b[k]);
  if (!bad.length) continue;
  let where = '';
  if (bad.includes('text')) { let j = 0; while (j < a.words.length && a.words[j] === b.words[j]) j++; where = ' | old "' + a.words.slice(Math.max(0, j - 50), j + 70) + '" new "' + b.words.slice(Math.max(0, j - 50), j + 70) + '"'; }
  diffs.push({ step: i, control: a.name, did: a.note, differs: bad, what: a.kind + ' ' + a.name + ' (' + a.note + '): ' + bad.join(', ') + where });
}
const tally = l => l.reduce((m, s) => { const k = s.kind + (/^(pressed|ticked|unticked|chosen|picked|set|typed)/.test(s.note) ? ' changed' : s.kind === 'start' ? '' : ' skipped'); m[k] = (m[k] || 0) + 1; return m; }, {});
const moved = l => l.filter((s, i) => i > 0 && (s.text !== l[i - 1].text || s.fields !== l[i - 1].fields || s.engine !== l[i - 1].engine || s.shown !== l[i - 1].shown)).length;
const report = { base: BASE, ran: new Date().toISOString(), steps: o.steps.length, tally: tally(o.steps), stepsThatChangedThePage: moved(o.steps), printedOld: o.printed, printedNew: n.printed, errorsOld: o.errors, errorsNew: n.errors, diffs,
  log: o.steps.map((s, i) => ({ i, kind: s.kind, control: s.name, did: s.note, same: !diffs.some(d => d.step === i) })) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(o.steps.length + ' steps: ' + JSON.stringify(report.tally) + '; ' + report.stepsThatChangedThePage + ' steps changed what the page shows');
console.log('page errors: old ' + o.errors.length + ', new ' + n.errors.length + (n.errors.length ? ' (' + [...new Set(n.errors)].slice(0, 3).join(' ; ') + ')' : ''));
diffs.slice(0, 25).forEach(d => console.log('DIFFERS step ' + d.step + ': ' + d.what.slice(0, 420)));
console.log(diffs.length ? diffs.length + ' steps differ' : 'every step matches');
process.exit(diffs.length ? 1 : 0);
