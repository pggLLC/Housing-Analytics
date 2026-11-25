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

const TOOLS = ['deal-market-analysis.html', 'market-analysis.html', 'for-sale-market-study.html', 'lihtc-opportunity-finder.html'];
const LONG = ['methods.html', 'working-paper.html', 'apa-white-paper.html'];
ok([...SHORT_PAGES].sort().join() === [...TOOLS, ...LONG].sort().join(), 'the short pages are the seven moved in batch A: ' + [...SHORT_PAGES].join(', '));
ok(!SHORT_PAGES.has('deal-calculator.html'), 'the Deal Calculator stays free');

const build = read('scripts/build-public-site.mjs');
ok(/SHORT_PAGES\.has\(name\)/.test(build) && /shortPage\(name,/.test(build), 'the public build writes the short page at each address');

const hubs = read('hub/lab-config.js');
for (const f of [...TOOLS, ...LONG]) {
  ok(existsSync(path.join(ROOT, f)), `${f}: the full page stays in this checkout, for the member site`);
  const html = shortPage(f, read(f));
  ok(html.includes(`href="${MEMBER_SITE}${f}"`), `${f}: member sign in opens the same page on the member site`);
  ok(html.includes('index.html#/request-access'), `${f}: links the member access request`);
  ok(/<footer id="site-footer"><\/footer>/.test(html), `${f}: has the site footer`);
  ok(/<a class="skip-link" href="#main-content">/.test(html) && /id="main-content"/.test(html), `${f}: skip link lands on the page`);
  ok((html.match(/<h1\b/g) || []).length === 1, `${f}: one h1`);
}

for (const f of TOOLS) {
  const html = shortPage(f, read(f));
  const free = /<a class="button-link" data-carry-place href="([a-z-]+\.html)#(\/[a-z-]+)"/.exec(html);
  ok(free, `${f}: a free version first`);
  ok(new RegExp('"' + free[1].replace('.', '\\\\.') + '":\\[[^\\]]*' + free[2].slice(1).replace('-', '\\-')).test(hubs) || hubs.includes(free[2].slice(1)), `${f}: ${free[1]}#${free[2]} is a route the hubs draw`);
  ok(!/js\/(market-analysis|lihtc-opportunity-finder|project-market-study)/.test(html), `${f}: loads none of the full tool's scripts`);
  ok(html.indexOf('data-carry-place') < html.indexOf('What members get'), `${f}: the free version comes before the member pitch`);
}

{
  const html = shortPage('methods.html', read('methods.html'));
  for (const id of ['m-footprint', 'm-conventions', 'm-capture']) ok(new RegExp(`<section aria-labelledby="${id}"`).test(html), `methods: section ${id} stays public`);
  ok(/AI/.test(html.slice(html.indexOf('m-footprint'))), 'methods: the AI disclosure stays public (section 11)');
  ok(!/<h2 id="m-score">/.test(html) && /<li id="m-score">The scoring chain<\/li>/.test(html), 'methods: the scoring chain leaves; a link to #m-score lands on its line in the member card');
  ok(!/<section aria-labelledby="m-affordability"/.test(html) && !/Reviewers are asked/.test(html), 'methods: section 05 and the line sending reviewers to it leave');
  ok(!/<li><a href="#m-notation">/.test(html) && /<li><a href="#m-capture">/.test(html), 'methods: contents list only what stayed');
  ok(/<meta name="description" content="This is the short version of Methods/.test(html), 'methods: the description says it is the short version');
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
