'use strict';
/**
 * Draws Home (index.html, the hub/home.js view) the way the page does, without a browser, so a test can read
 * the words and figures a visitor gets. It runs the hub's own files and this repo's own engines and data files;
 * only the page chrome (menu, search box widget, link list widget) is stood in for.
 *
 *   const { renderHome, text } = require('./helpers/render-home');
 *   const html = await renderHome();                 // Home with nothing picked
 *   const town = await renderHome('town=0828745');   // Home after a town is picked
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const at = (f) => path.join(ROOT, f);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let ready = null;
function boot() {
  if (!ready) ready = start({});
  return ready;
}
// One page load. `files` stands in for data files by path ('data/home-snapshot.json': {...}); every other file
// is read from this repo. `fetched` lists every file the page asked for.
function start(files) {
  const fetched = [];
  const catalog = JSON.parse(fs.readFileSync(at('hub/route-catalog.json'), 'utf8'));
  const Shell = {
    views: {}, esc, render() {}, catalog: () => catalog, recent: () => [], hubHead: () => '', list: () => '',
    inHub: (hub, keep) => catalog.entries.filter((e) => e.hub === hub && (!keep || keep(e))),
    choice: (href, title, body) => '<li><a href="' + esc(href) + '">' + esc(title) + '</a> ' + esc(body || '') + '</li>',
  };
  // The search box and the matcher are the shell's own (hub/shell.js), lifted out as written: the rest of that
  // file drives the page and needs a browser.
  const shellSrc = fs.readFileSync(at('hub/shell.js'), 'utf8');
  const lift = (name) => { const m = new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n').exec(shellSrc); if (!m) throw new Error('hub/shell.js no longer defines ' + name + ' the way this helper reads it'); return m[0]; };
  const lifted = vm.runInNewContext('(function (esc) {' + lift('matches') + lift('searchBox') + '; return { matches: matches, searchBox: searchBox }; })')(esc);
  Shell.matches = lifted.matches; Shell.searchBox = lifted.searchBox;
  const fetchFile = (f) => {
    const rel = String(f).replace(/^\.\//, '').replace(/[?#].*$/, '');
    fetched.push(rel);
    if (Object.prototype.hasOwnProperty.call(files, rel)) { const body = files[rel]; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))), text: () => Promise.resolve(JSON.stringify(body)) }); }
    const p = at(rel);
    return Promise.resolve(fs.existsSync(p)
      ? { ok: true, status: 200, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf8'))), text: () => Promise.resolve(fs.readFileSync(p, 'utf8')) }
      : { ok: false, status: 404 });
  };
  const win = { LabShell: Shell, LAB_VENDOR: './', LAB_LIVE: '', LAB_PORT: true };
  const ctx = { window: win, self: win, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], readyState: 'loading' }, history: { replaceState() {} }, location: { hash: '' },
    URLSearchParams, Math, JSON, Object, Array, String, Number, Promise, Date, Map, Set, RegExp, Error, Intl, fetch: fetchFile, setTimeout, console };
  win.window = win;
  vm.createContext(ctx);
  const page = fs.readFileSync(at('index.html'), 'utf8');
  const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const SKIP = /^hub\/(lab-config|shell)\.js$/;
  // Chart, map and page files that need a real document are not needed to read Home's words; a file that
  // cannot start without one is left out and named, so a silent gap cannot hide a missing figure.
  const left = [];
  scripts.filter((s) => !SKIP.test(s)).forEach((s) => {
    const src = fs.readFileSync(at(s), 'utf8');
    try {
      vm.runInContext(src, ctx, { filename: s });
    } catch (e) { left.push(s + ': ' + e.message); }
  });
  // The town answer card reads its facts from the site's own homepage engine; it must be the one loaded.
  if (!win.HomeJurisdictionSearch) win.HomeJurisdictionSearch = require(at('js/home-jurisdiction-search.js'));
  if (!Shell.views.home) throw new Error('hub/home.js did not register the Home view (' + left.join('; ') + ')');
  const settle = () => new Promise((r) => setTimeout(r, 25));
  return (async () => { for (let i = 0; i < 40; i++) { Shell.views.home(new URLSearchParams('')); await settle(); } return { Shell, settle, left, win, fetched }; })();
}
// Home drawn from stand-in data files, on a page load of its own.
async function renderHomeWith(files, query) {
  const { Shell, settle } = await start(files || {});
  let html = '';
  for (let i = 0; i < 6; i++) { html = Shell.views.home(new URLSearchParams(query || '')); await settle(); }
  return html;
}

async function renderHome(query) {
  const { Shell, settle } = await boot();
  const q = query || '';
  let html = '';
  for (let i = 0; i < 12; i++) { html = Shell.views.home(new URLSearchParams(q)); await settle(); }
  return html;
}
// Home as a returning visitor sees it: this browser last worked on `place` ({ geoid, label }).
async function renderHomeReturning(place, query) {
  const { win } = await boot();
  const key = (/var WORK_KEY = '([^']+)'/.exec(fs.readFileSync(at('hub/hna.js'), 'utf8')) || [])[1];
  if (!key) throw new Error('hub/hna.js no longer names the key it keeps the working place under');
  win.localStorage = { getItem: (k) => (k === key ? JSON.stringify(place) : null), setItem() {} };
  try { return await renderHome(query); } finally { delete win.localStorage; }
}
// Tags out, then entities; `&amp;` last, so an escaped entity ("&amp;lt;") comes out as the text it stands for.
const text = (html) => String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();


// Where each link on Home goes once the page has pointed it (hub/lab-config.js does this in the browser):
// a route Home draws itself stays, a route another hub page draws opens that page, any other route opens the
// public page it rebuilds, and a route with nowhere to go is dropped (href null).
let port = null;
function portConfig() {
  if (port) return port;
  const win = {};
  const ctx = { window: win, location: { pathname: '/index.html', hash: '#/' }, document: { querySelector: () => null }, URLSearchParams, RegExp, Object, String, Array };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(at('hub/lab-config.js'), 'utf8'), ctx, { filename: 'hub/lab-config.js' });
  port = win.LAB_PORT;
  return port;
}
function links(html) {
  const P = portConfig();
  return [...String(html).matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => {
    const raw = m[1].replace(/&amp;/g, '&');
    return { raw, href: /^#\//.test(raw) ? P.href(raw) : raw, text: text(m[2]) };
  });
}
// The file a link opens, without its route, query or anchor ('places-hub.html#/places' -> 'places-hub.html').
const pageOf = (href) => String(href || '').replace(/[#?].*$/, '');


// The seven numbered steps Home lists, in order: the numeral shown, the heading, and where the step's link goes.
function steps(html) {
  const list = (/<ol class="hs-list">([\s\S]*?)<\/ol>/.exec(String(html)) || [])[1] || '';
  return [...list.matchAll(/<li><span class="hs-n"[^>]*>(\d+)<\/span><div><h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/li>/g)].map((m) => {
    const l = links(m[3])[0] || {};
    return { num: m[1], heading: text(m[2]), body: text(m[3]), raw: l.raw || '', href: l.href || '', page: pageOf(l.href) };
  });
}
// The public page a hub route rebuilds, which stays live beside it: the page the route forwards to where no hub
// page draws it, and for the Places routes (built first, so never forwarded) the page each one took the place of.
const PLACES_REBUILDS = [[/^#\/places\/?$/, 'select-jurisdiction.html'], [/^#\/place\/\d{5,7}/, 'housing-needs-assessment.html'],
  [/^#\/places\/scenario/, 'hna-scenario-builder.html'], [/^#\/places\/ranking/, 'hna-comparative-analysis.html']];
function rebuilds(route) {
  const r = String(route || '').replace(/\?.*$/, '');
  const hit = PLACES_REBUILDS.find((x) => x[0].test(r));
  return hit ? hit[1] : (portConfig().FORWARD[r] || null);
}


// The same page for a test written as a plain top-to-bottom script: drawn in a child process, so the caller
// does not have to become asynchronous.
function renderHomeSync(query) {
  const out = require('node:child_process').execFileSync(process.execPath, ['-e',
    'require(' + JSON.stringify(__filename) + ').renderHome(' + JSON.stringify(query || '') + ').then((h) => process.stdout.write(h), (e) => { console.error(e); process.exit(1); })'],
  { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  if (!/<h1/.test(out)) throw new Error('Home did not draw');
  return out;
}

module.exports = { renderHome, renderHomeWith, renderHomeReturning, renderHomeSync, text, links, steps, rebuilds, pageOf, portConfig, boot, ROOT };
