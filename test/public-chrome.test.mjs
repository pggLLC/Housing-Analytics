// Every free page a visitor can land on wears the new pages' header, menu and footer (paul, 28 Nov 2026: "looks like
// somehow we're getting the old site pulled in?"). A root page that still loads the old header script
// (js/navigation.js) must be one js/path-resolver.js forwards to its new home before it paints; the rest carry the
// header and footer of deal-hub.html, written by scripts/build-member-chrome.mjs. Run: node test/public-chrome.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGES, rootFor, blocks, build } from '../scripts/build-member-chrome.mjs';
import { SHORT_PAGES, shortPage } from '../scripts/lib/member-short-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const OLD = /src="\/?js\/navigation\.js"/;

// Where js/path-resolver.js sends a visitor who opens <file> with no query or hash (null: the page stays).
const resolver = read('js/path-resolver.js');
function forwardsTo(file) {
  let to = null;
  const loc = { pathname: '/' + file, search: '', hash: '', protocol: 'https:', host: 'cohoanalytics.com', href: 'https://cohoanalytics.com/' + file, replace(u) { to = u; } };
  const store = { getItem() { return null; }, setItem() {} };
  const doc = { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; }, currentScript: { src: 'https://cohoanalytics.com/js/path-resolver.js' }, documentElement: {} };
  const win = { location: loc, localStorage: store, document: doc, addEventListener() {} };
  win.top = win; win.self = win; win.window = win;
  vm.runInNewContext(resolver, { window: win, document: doc, location: loc, localStorage: store, URLSearchParams, URL, console, setTimeout() {}, MutationObserver: function () { return { observe() {} }; }, navigator: {} });
  return to;
}
ok(forwardsTo('about.html') === 'policy-hub.html#/guide/about' && forwardsTo('member-sign-in.html') === null, 'the resolver, run here, forwards an old page and leaves a current one');

// 1. No page a visitor stays on loads the old header. The public build serves its short page at a SHORT_PAGES address.
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
for (const f of pages) {
  const html = SHORT_PAGES.has(f) ? shortPage(f, read(f)) : read(f);
  if (!OLD.test(html)) continue;
  ok(forwardsTo(f), `${f}: loads the old header (js/navigation.js) and is not forwarded to a new page, so visitors see the old menu. Run node scripts/build-member-chrome.mjs --public on it (add it to PUBLIC_PAGES)`);
}

// 2. The free pages in the new chrome carry deal-hub.html's header and footer, as built now, with Member sign in.
const hub = read('deal-hub.html'), palette = read('hub/palette.css');
const hubHeader = /<header class="site-header">[\s\S]*?<\/header>/.exec(hub)[0];
for (const f of PUBLIC_PAGES) {
  const html = read(f), b = blocks(hub, palette, { public: true, root: rootFor(f) });
  ok(!OLD.test(html) && !/src="\/?js\/(dark-mode-toggle|mobile-menu)\.js"/.test(html), `${f}: none of the old header's scripts`);
  ok(html === build(html, b, f), `${f}: matches a fresh build (node scripts/build-member-chrome.mjs --public)`);
  ok(html.split('<header class="site-header">').length === 2 && html.split('<footer class="site-footer">').length === 2, `${f}: one header, one footer`);
  ok(rootFor(f) ? html.includes('<a class="brand" href="/index.html">') : html.includes(hubHeader), `${f}: deal-hub.html's header`);
  ok(/<a class="footer-link" href="\/?privacy-policy\.html">Privacy<\/a>/.test(html) && /href="https:\/\/coho-backend\.communityplanner\.workers\.dev\/">Member sign in<\/a>/.test(html), `${f}: the free footer, with Member sign in`);
  ok(/<body[^>]*class="[^"]*\bchrome-page\b/.test(html) && !/\bmember-page\b/.test(html), `${f}: a chrome page, not a member page`);
}
// 3. The full member tools the member site serves from here wear the member chrome, with one theme button: the new
// header's (Codex P2 on #3058).
for (const f of ['for-sale-market-study.html', 'lihtc-opportunity-finder.html']) {
  const html = read(f), b = blocks(hub, palette);
  ok(html === build(html, b, f) && /\bmember-page\b/.test(html), `${f}: matches a fresh member-chrome build`);
  ok(!/src="\/?js\/(navigation|dark-mode-toggle|mobile-menu)\.js"/.test(html) && html.split('class="theme-toggle"').length === 2, `${f}: one theme button, the new header's`);
}
// 404.html is served at any depth, so every address it adds starts at the root.
{
  const html = read('404.html');
  const chrome = html.split('<!-- member-chrome:').slice(1).join('');
  ok(!/\s(?:href|src)="(?![a-z][a-z0-9+.-]*:|\/|#)/i.test(chrome) && /window\.LAB_ROOT = "\/"/.test(html) && /src="\/hub\/nav\.js"/.test(html), '404.html: its header, footer and sheets load from the site root');
}
console.log(`public chrome: ${checks} checks passed`);
