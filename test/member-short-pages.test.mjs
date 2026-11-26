// The full tools moved behind sign-in (paul, 25 Nov 2026, "approve the member moves") keep their public addresses
// as short free pages (scripts/lib/member-short-pages.mjs). Run: node test/member-short-pages.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMBER_SITE, SHORT_PAGES, shortPage } from '../scripts/lib/member-short-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const HNA = ['hna-who-lives-here.html', 'hna-what-housing-exists.html', 'hna-what-households-can-afford.html',
  'hna-where-its-heading.html', 'hna-what-to-do.html', 'hna-scenario-builder.html', 'hna-comparative-analysis.html'];
const TOOLS = ['deal-market-analysis.html', 'market-analysis.html', 'for-sale-market-study.html', 'lihtc-opportunity-finder.html', ...HNA];
const LONG = ['methods.html', 'working-paper.html', 'apa-white-paper.html'];
ok([...SHORT_PAGES].sort().join() === [...TOOLS, ...LONG].sort().join(), 'the short pages are the seven of batch A and the seven needs assessment pages of batch B: ' + [...SHORT_PAGES].join(', '));
ok(!SHORT_PAGES.has('deal-calculator.html'), 'the Deal Calculator stays free');
// The place page's free report is built from the whole assessment in a hidden frame (hub/hna.js; Codex P1 on #3015).
ok(!SHORT_PAGES.has('housing-needs-assessment.html') && /housing-needs-assessment\.html\?geoid=/.test(read('hub/hna.js')), 'the assessment the free report is built from stays whole');

const build = read('scripts/build-public-site.mjs');
ok(/SHORT_PAGES\.has\(name\)/.test(build) && /shortPage\(name,/.test(build), 'the public build writes the short page at each address');

const hubs = read('hub/lab-config.js');
for (const f of [...TOOLS, ...LONG]) {
  ok(existsSync(path.join(ROOT, f)), `${f}: the full page stays in this checkout, for the member site`);
  const html = shortPage(f, read(f));
  ok(html.includes(`href="${MEMBER_SITE}${f}"`), `${f}: member sign in opens the same page on the member site`);
  ok(html.includes('mailto:info@cohoanalytics.com?subject=Member%20access'), `${f}: links the member access request`);
  ok(/<footer id="site-footer"><\/footer>/.test(html), `${f}: has the site footer`);
  ok(/<a class="skip-link" href="#main-content">/.test(html) && /id="main-content"/.test(html), `${f}: skip link lands on the page`);
  ok((html.match(/<h1\b/g) || []).length === 1, `${f}: one h1`);
}

for (const f of TOOLS) {
  const html = shortPage(f, read(f));
  const free = /<a class="button-link" data-carry-place(?: data-place-route)? href="([a-z-]+\.html)#(\/[a-z-]+)"/.exec(html);
  ok(free, `${f}: a free version first`);
  ok(new RegExp('"' + free[1].replace('.', '\\\\.') + '":\\[[^\\]]*' + free[2].slice(1).replace('-', '\\-')).test(hubs) || hubs.includes(free[2].slice(1)), `${f}: ${free[1]}#${free[2]} is a route the hubs draw`);
  ok(!/js\/(market-analysis|lihtc-opportunity-finder|project-market-study)/.test(html), `${f}: loads none of the full tool's scripts`);
  ok(html.indexOf('data-carry-place') < html.indexOf('What members get'), `${f}: the free version comes before the member pitch`);
}

for (const f of HNA) {
  const html = shortPage(f, read(f));
  ok(/data-carry-place data-place-route href="places-hub\.html#\/places"/.test(html), `${f}: the free place summary, opened at the old page's place`);
  ok(!/js\/hna\//.test(html), `${f}: loads none of the needs assessment's scripts`);
}
// The carry script sends ?geoid=08031 to places-hub.html#/place/08031 and leaves the statewide ?geoid=08 on the list.
{
  const html = shortPage('hna-who-lives-here.html', read('hna-who-lives-here.html'));
  const at = html.indexOf('<script>\n(function () {') + '<script>'.length;
  const script = html.slice(at, html.indexOf('</' + 'script>', at));
  const run = (search) => {
    const a = { attrs: { href: 'places-hub.html#/places', 'data-place-route': '' }, getAttribute(k) { return this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; }, href: '' };
    const m = { attrs: { href: MEMBER_SITE + 'hna-who-lives-here.html' }, getAttribute(k) { return this.attrs[k]; }, href: '' };
    new Function('location', 'document', 'URLSearchParams', script)({ search, hash: '' }, { querySelectorAll: (q) => (q === '[data-carry-place]' ? [a] : [m]) }, URLSearchParams);
    return a.href;
  };
  ok(run('?geoid=08031&geoType=county') === 'places-hub.html#/place/08031', 'a county in the old query opens its place page');
  ok(run('?geoid=0812415') === 'places-hub.html#/place/0812415', 'a town in the old query opens its place page');
  ok(run('?geoid=08') === '', 'the statewide page keeps the list of places');
}
{
  const html = shortPage('methods.html', read('methods.html'));
  for (const id of ['m-footprint', 'm-conventions', 'm-capture']) ok(new RegExp(`<section aria-labelledby="${id}"`).test(html), `methods: section ${id} stays public`);
  ok(/AI/.test(html.slice(html.indexOf('m-footprint'))), 'methods: the AI disclosure stays public (section 11)');
  // Every heading that left is listed in the member card under its own id, in the source's words.
  const src = read('methods.html');
  const left = [...src.matchAll(/<h2 id="(m-[a-z-]+)">([\s\S]*?)<\/h2>/g)].filter(([, id]) => !['m-footprint', 'm-conventions', 'm-capture'].includes(id));
  ok(left.length > 0, 'methods: some sections leave');
  for (const [, id, h] of left) {
    const words = h.replace(/<span class="num">[^<]*<\/span>/, '').trim();
    ok(!new RegExp(`<h2 id="${id}">`).test(html) && html.includes(`<li id="${id}">`) && html.includes(words), `methods: ${id} leaves; its line in the member card keeps its id and heading`);
  }
  // Any id inside a section that left still lands (HNA chapters link methods.html#m-sampling-error).
  for (const [, id] of src.matchAll(/\bid="(m-[a-z0-9-]+)"/g)) ok(html.includes(`id="${id}"`), `methods: #${id} still lands`);
  ok(!/<section aria-labelledby="m-affordability"/.test(html) && !/Reviewers are asked/.test(html), 'methods: section 05 and the line sending reviewers to it leave');
  ok(!/<li><a href="#m-notation">/.test(html) && /<li><a href="#m-capture">/.test(html), 'methods: contents list only what stayed');
  ok(/<meta name="description" content="([^"]*)">/.exec(html)[1] !== /<meta name="description" content="([^"]*)">/.exec(src)[1], 'methods: the description is not the full page\'s');
  ok(/member-short-banner/.test(html), 'methods: a short-version line under the title');
}
{
  const html = shortPage('working-paper.html', read('working-paper.html'));
  ok(/<section class="wp-exec" aria-labelledby="s-exec"/.test(html) && !/<h2 id="s-emergence">/.test(html), 'working paper: the executive summary stays, the chapters leave');
}
{
  const html = shortPage('apa-white-paper.html', read('apa-white-paper.html'));
  ok(/<h2 id="summary-h">Summary<\/h2>/.test(html) && !/<h2 id="what-the-site-is-for-h">/.test(html), 'white paper: the summary stays, the chapters leave');
  ok(/<li id="a-worked-example-fruita-mesa-county-h"><span id="a-worked-example-fruita-mesa-county"><\/span>/.test(html), 'white paper: both ids of a section that left still land');
}

console.log(`member short pages: ${checks} checks passed`);
