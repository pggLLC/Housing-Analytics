#!/usr/bin/env node
/**
 * HNA phone speed (Codex whole-site audit, 31 Oct 2026, finding F9).
 *
 * On a phone the Fruita full report took about 16 s and its layout shifted by
 * about 0.4 (CLS). Four causes were found and fixed; this guards each one.
 *
 *   1. Repeat downloads. Independent loaders asked for the same data file up
 *      to five times (ranking-index.json, qct-colorado.json, ...), about 3 MB
 *      of an 8 MB page. An inline script (id="data-request-memo") in the HNA
 *      head keeps one copy per page view.
 *   2. A second full load. The page's own deep-link helper re-fires the
 *      place select's change event after the controller has already loaded
 *      that place, so every figure was blanked and drawn again. The
 *      controller now skips that one echo (the syncs still run).
 *   3. The site header was an empty 1px placeholder until navigation.js ran,
 *      then its two stylesheets arrived even later; each step moved the page.
 *   4. The decision tiles appeared one at a time above the hero (see
 *      test/decision-tiles-never-rest-on-loading.test.mjs for that part).
 *
 * Measured locally on a 4x CPU / slow-network phone profile, Fruita full
 * report: CLS 0.66 before, 0.01 after; page text identical before and after.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failures += 1; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
}

// ── 1. One download per data file ───────────────────────────────────────────

function loadMemo() {
  const calls = [];
  let nextStatus = 200;
  let nextBodyFails = false;
  function makeResponse(url, status, bodyFails) {
    let used = false;
    const res = {
      url, status, ok: status >= 200 && status < 300,
      clone() { if (used) throw new Error('clone of a used body'); return makeResponse(url, status, bodyFails); },
      json() { used = true; return bodyFails ? Promise.reject(new TypeError('network error')) : Promise.resolve({ url }); },
      arrayBuffer() { used = true; return bodyFails ? Promise.reject(new TypeError('network error')) : Promise.resolve(new ArrayBuffer(1)); },
    };
    return res;
  }
  const window = {
    location: { href: 'https://cohoanalytics.com/housing-needs-assessment.html?geoid=0828745', origin: 'https://cohoanalytics.com' },
    fetch(input, init) {
      calls.push({ input: String(input), init });
      return Promise.resolve(makeResponse(String(input), nextStatus, nextBodyFails));
    },
  };
  const ctx = { window, URL, Object, Promise, Error, setTimeout };
  vm.createContext(ctx);
  const html = read('housing-needs-assessment.html');
  const m = /<script id="data-request-memo">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'the data request memo script is gone from the HNA head; this guard is checking nothing');
  vm.runInContext(m[1], ctx);
  return { window, calls, setStatus(s) { nextStatus = s; }, setBodyFails(b) { nextBodyFails = b; } };
}

(async () => {
  await check('the same data file is downloaded once, with or without ?v=', async () => {
    const m = loadMemo();
    const a = await m.window.fetch('data/hna/ranking-index.json?v=2026-10-31', { cache: 'no-store' });
    const b = await m.window.fetch('/data/hna/ranking-index.json');
    const c = await m.window.fetch('https://cohoanalytics.com/data/hna/ranking-index.json?v=2026-10-31');
    assert.equal(m.calls.length, 1, 'three callers, one download');
    assert.equal(m.calls[0].init.cache, 'no-store', 'the first request keeps its caller\'s cache mode');
    // Each caller gets its own unread body to parse.
    assert.notEqual(a, b);
    await a.json(); await b.json(); await c.json();
  });

  await check('a different file, a query, another host or a POST is not shared', async () => {
    const m = loadMemo();
    await m.window.fetch('data/qct-colorado.json');
    await m.window.fetch('data/dda-colorado.json');
    await m.window.fetch('data/hna/projections/08077.json?horizon=20');
    await m.window.fetch('data/hna/projections/08077.json?horizon=10');
    await m.window.fetch('https://tigerweb.geo.census.gov/arcgis/rest/services/x/query?f=json');
    await m.window.fetch('https://tigerweb.geo.census.gov/arcgis/rest/services/x/query?f=json');
    await m.window.fetch('data/qct-colorado.json', { method: 'POST', body: '{}' });
    await m.window.fetch('js/config.js');
    await m.window.fetch('js/config.js');
    assert.equal(m.calls.length, 9);
  });

  await check('a failed or non-OK response is not kept, so a retry reaches the network', async () => {
    const m = loadMemo();
    m.setStatus(503);
    const first = await m.window.fetch('data/chfa-lihtc.json');
    assert.equal(first.ok, false, 'the caller still sees the real status');
    m.setStatus(200);
    const second = await m.window.fetch('data/chfa-lihtc.json');
    assert.equal(second.ok, true);
    assert.equal(m.calls.length, 2);
  });

  await check('a body that fails mid-download is not kept (Codex review on #2609)', async () => {
    const m = loadMemo();
    m.setBodyFails(true);
    const first = await m.window.fetch('data/hna/place-chas.json');
    await assert.rejects(first.json());
    await new Promise((r) => setTimeout(r, 0));
    m.setBodyFails(false);
    const second = await m.window.fetch('data/hna/place-chas.json');
    assert.deepEqual(await second.json(), { url: 'data/hna/place-chas.json' });
    assert.equal(m.calls.length, 2, 'the retry after a dropped body must reach the network');
  });

  await check('a caller that aborts is rejected, and its retry starts a new request', async () => {
    const m = loadMemo();
    const ctrl = new AbortController();
    const pending = m.window.fetch('data/place-chas.json', { signal: ctrl.signal });
    ctrl.abort(); // before the shared request has settled
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.equal(m.calls[0].init.signal, undefined, 'one caller\'s signal never cancels the shared request');
    await m.window.fetch('data/place-chas.json');
    assert.equal(m.calls.length, 2, 'the retry must not join a request its caller gave up on');
  });

  // ── 2. One load per place ─────────────────────────────────────────────────

  await check('the deep-link echo of the place init loaded does not run the load again', () => {
    const src = read('js/hna/hna-controller.js');
    // The listener still syncs the project and address, then skips only the
    // first change that names the place init already loaded.
    const i = src.indexOf("window.HNAState.els.geoSelect.addEventListener('change', () => {");
    assert.ok(i > 0, 'the controller\'s geoSelect change listener is gone; this guard is checking nothing');
    const body = src.slice(i, src.indexOf('});', i));
    assert.ok(body.indexOf('_syncJurisdictionToWorkflowState();') < body.indexOf('if (echo) return;'),
      'the project jurisdiction must still sync on the echo (the header pill reads it)');
    assert.match(body, /const echo = _initialLoadKey !== null && _currentSelectKey\(\) === _initialLoadKey;\s*_initialLoadKey = null;\s*if \(echo\) return;\s*update\(\);/,
      'only one echo is skipped, and the key is cleared either way');
    assert.match(src, /_initialLoadKey = _currentSelectKey\(\);\s*ensureMap\(\);\s*(?:\/\/[^\n]*\n\s*)*if \(!unknownGeoid && !nothingChosen\) update\(\);/,
      'init records the place it loads just before loading it');
    assert.match(src, /geoType\.addEventListener\('change', \(\)=>\{\s*_initialLoadKey = null;/,
      'a type change ends the echo window');
    // The page helper still announces the place, so its other listeners
    // (SiteState county, projection pill) keep running.
    const html = read('housing-needs-assessment.html');
    assert.match(html, /geoSelectEl\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);/);
  });

  // ── 3. The header holds its height ───────────────────────────────────────

  await check('the header placeholder holds the finished header height', () => {
    const css = read('css/site-theme.css');
    assert.match(css, /header\.site-header:not\(:has\(\.nav-wrap\)\)\s*\{\s*min-height:\s*75px/);
    assert.match(css, /@media \(min-width: 769px\)\s*\{\s*header\.site-header:not\(:has\(\.nav-wrap\)\)\s*\{\s*min-height:\s*61px/);
  });

  await check('HNA pages load the nav stylesheets up front under the ids navigation.js checks', () => {
    const nav = read('js/navigation.js');
    assert.match(nav, /getElementById\('nav-injected-styles'\)/);
    assert.match(nav, /getElementById\('mobile-nav-styles-link'\)/);
    const pages = ['housing-needs-assessment.html', 'hna-who-lives-here.html', 'hna-what-housing-exists.html',
      'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html'];
    pages.forEach((p) => {
      const html = read(p);
      assert.match(html, /<link rel="stylesheet" id="nav-injected-styles" href="css\/navigation\.css">/, p);
      assert.match(html, /<link rel="stylesheet" id="mobile-nav-styles-link" href="css\/mobile-nav\.css">/, p);
      const memo = html.indexOf('<script id="data-request-memo">');
      assert.ok(memo > 0, p + ' must load the data request memo');
      assert.ok(memo < html.indexOf('js/fetch-helper.js'), p + ': the memo must load before the data loaders');
    });
  });

  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
