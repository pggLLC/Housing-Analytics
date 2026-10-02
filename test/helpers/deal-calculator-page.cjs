const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '../..');
const PAGE = 'deal-calculator.html';
const ORIGIN = 'http://127.0.0.1/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, what, ms, errors) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for ' + what + (errors && errors.length ? '; page errors: ' + errors.slice(0, 3).join(' | ') : ''));
}

/* ── The whole page, its scripts run in page order ─────────────────────── */

function fileFetch(url) {
  const u = new URL(String(url), ORIGIN + PAGE);
  let body = null;
  if (u.origin + '/' === ORIGIN) {
    try { body = fs.readFileSync(path.join(root, decodeURIComponent(u.pathname)), 'utf8'); } catch (_) { /* 404 */ }
  }
  return Promise.resolve({
    ok: body != null, status: body != null ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(body)), text: () => Promise.resolve(body)
  });
}

const pageSrc = fs.readFileSync(path.join(root, PAGE), 'utf8');
const openPages = [];

async function openPage(search, savedSubject, options = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  // jsdom's "Not implemented" notices (canvas, scrolling) are not page errors.
  vc.on('jsdomError', (e) => { if (!/^Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(pageSrc, {
    url: ORIGIN + PAGE + (search || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  openPages.push(dom);
  const w = dom.window;
  w.fetch = url => options.missing && options.missing.some(p => String(url).includes(p)) ? Promise.resolve({ok:false, status:404}) : fileFetch(url);
  // Every page is a first visit: jsdom shares storage across instances of the
  // same origin, and the recipient of a share link has none of the sender's.
  try { w.localStorage.clear(); w.sessionStorage.clear(); } catch (_) { /* storage unavailable */ }
  if (savedSubject) w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(savedSubject));
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  // Classic scripts (head and inline) run as parsed; deferred ones after the
  // parse, in order; then DOMContentLoaded. CDN libraries (PDF export) skipped.
  const deferred = [];
  Array.from(w.document.querySelectorAll('script')).forEach((s) => {
    if (s.type && !/javascript/.test(s.type)) return;
    const src = s.getAttribute('src');
    if (src && /^https?:/.test(src)) return;
    // jsdom has no canvas; Chart.js would throw inside the renderers that
    // draw charts and cut their recalculation short. Without it the page
    // takes its no-chart path, on sender and recipient alike.
    if (src === 'js/vendor/chart.umd.min.js') return;
    const code = src ? fs.readFileSync(path.join(root, src), 'utf8') : s.textContent;
    const run = () => {
      try { w.eval(code + '\n//# sourceURL=' + (src || 'inline'));
        if (src === 'js/workflow-state-api.js' && options.jurisdiction) w.WorkflowState.setJurisdiction(options.jurisdiction);
      }
      catch (e) { errors.push((src || 'inline script') + ': ' + e.message); }
    };
    if (src && s.hasAttribute('defer')) deferred.push(run); else run();
  });
  deferred.forEach((run) => run());
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.dispatchEvent(new w.Event('load'));
  const d = w.document;
  await waitFor(() => {
    const c = d.getElementById('dc-county-select');
    return c && (c.options.length > 60 || options.missing && options.missing.includes('hud-fmr-income-limits.json'));
  }, 'the county list to load', 20000, errors.concat(['HudFmr loaded=' + (w.HudFmr && w.HudFmr.isLoaded())]));
  // Hydration fires at 350 ms and may wait on async options; let it settle.
  await sleep(search ? 2500 : 600);
  return { w, d, errors };
}

function setField(page, id, value) {
  const el = page.d.getElementById(id);
  assert(el, id + ' does not render');
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = value;
  else el.value = String(value);
  el.dispatchEvent(new page.w.Event('input', { bubbles: true }));
  el.dispatchEvent(new page.w.Event('change', { bubbles: true }));
}
module.exports = { openPage, setField, sleep, close: () => openPages.splice(0).forEach(p => p.window.close()) };
