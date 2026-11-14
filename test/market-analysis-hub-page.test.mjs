#!/usr/bin/env node
/**
 * The full Market Analysis in the new format carries everything the old page has.
 *
 * deal-market-analysis.html is not written by hand. scripts/build-market-analysis-hub.mjs writes it from
 * market-analysis.html: the same body and the same scripts in the same order, inside the new pages' header,
 * menu, footer and look. So a figure on the new page comes from the same code as on the old page.
 *
 * This holds that together:
 *  1. the page on disk is what the script writes today from market-analysis.html (an edit to the old page
 *     that was not carried over fails here, and so does a hand edit of the new page);
 *  2. everything between <main> and </main> is the old page's, character for character, plus two added lines
 *     (the trail back to Build a deal, and the old step bar's six links as one line);
 *  3. every id on the old page is on the new one, except the step bar the new header replaces;
 *  4. the same scripts load in the same order, less the three the new header replaces, plus the new header's
 *     three; the glossary, which js/navigation.js used to load, is loaded the same way;
 *  5. no link the old step bar offered is lost;
 *  6. the header and footer are the hub pages' own, and the visit is counted once.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build-market-analysis-hub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const oldPage = read('market-analysis.html');
const hubPage = read('deal-hub.html');
const newPage = read('deal-market-analysis.html');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. Fresh.
ok(build(oldPage, hubPage, read("hub/palette.css")) === newPage,
  'deal-market-analysis.html is out of date: run `node scripts/build-market-analysis-hub.mjs` and commit the result');

// 2. The body of the page is the old page's.
const mainOf = html => { const m = /<main id="main-content">\n([\s\S]*?)\n  <\/main>/.exec(html); assert.ok(m, 'a page has no <main id="main-content">'); return m[1]; };
const added = [/^ *<nav class="crumbs" aria-label="Breadcrumb">.*<\/nav>\n/m, /^ *<p class="tool-steps">.*<\/p>\n/m];
let newMain = mainOf(newPage);
added.forEach(re => { ok(re.test(newMain), 'the new page lacks an added line: ' + re); newMain = newMain.replace(re, ''); });
ok(newMain === mainOf(oldPage), 'between <main> and </main> the new page differs from market-analysis.html by more than the two added lines');

// 3. Every id.
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const oldIds = ids(oldPage), newIds = ids(newPage);
const GONE = new Set(['maWorkflowProgress', 'site-footer']);
const missing = [...oldIds].filter(id => !newIds.has(id) && !GONE.has(id));
ok(missing.length === 0, 'ids on market-analysis.html that the new page lacks: ' + missing.join(', '));
ok(oldIds.size > 200, 'market-analysis.html has far fewer ids than expected (' + oldIds.size + '); has the page changed shape?');

// 4. The same scripts, in order.
const scripts = html => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
const DROPPED = ['js/navigation.js', 'js/dark-mode-toggle.js', 'js/mobile-menu.js'];
const ADDED = ['hub/lab-config.js', 'hub/page-chrome.js', 'hub/nav.js'];
const oldScripts = scripts(oldPage), newScripts = scripts(newPage);
DROPPED.forEach(f => { ok(oldScripts.includes(f), 'market-analysis.html no longer loads ' + f + '; update the build script'); ok(!newScripts.includes(f), 'the new page still loads ' + f); });
ADDED.forEach(f => ok(newScripts.includes(f), 'the new page does not load ' + f));
assert.deepEqual(newScripts.filter(f => !ADDED.includes(f)), oldScripts.filter(f => !DROPPED.includes(f)), 'the new page loads different scripts, or in a different order');
checks++;
ok(newScripts.slice(-3).join() === 'hub/lab-config.js,hub/page-chrome.js,hub/nav.js', 'the new header\'s scripts must load last, in order');
// The page's own inline scripts ride along unchanged.
const inline = html => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1].trim()).filter(Boolean);
const newInline = inline(newPage).filter(s => !/coho-analytics-scheme|glossary-script/.test(s));
ok(/<script type="module">[^<]*gs\.src = 'js\/glossary\.js'/.test(newPage), 'the new page does not load the glossary (js/navigation.js used to)');
assert.deepEqual(newInline, inline(oldPage), 'an inline script differs between the two pages');
checks++;

// 5. No link lost from the step bar.
const bar = /<div class="wf-progress-wrap" id="maWorkflowProgress">[\s\S]*?\n  <\/div>\n/.exec(oldPage);
ok(bar, 'market-analysis.html no longer has the seven-step bar');
const barLinks = [...bar[0].matchAll(/href="([^"]+)"/g)].map(m => m[1]);
const stepLine = /<p class="tool-steps">.*<\/p>/.exec(newPage)[0];
barLinks.forEach(h => ok(stepLine.includes('href="' + h + '"'), 'the step bar\'s link to ' + h + ' is not on the new page'));
ok(barLinks.length === 6, 'the step bar should link six other steps, found ' + barLinks.length);
// Every other link on the old page is on the new one (the body is identical; this covers head and tail).
const hrefs = html => new Set([...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(m => m[1]));
const lostLinks = [...hrefs(oldPage)].filter(h => !hrefs(newPage).has(h));
ok(lostLinks.length === 0, 'links on market-analysis.html that the new page lacks: ' + lostLinks.join(', '));

// 6. The hub pages' own header and footer; one visit counter.
const part = (html, re, what) => { const m = re.exec(html); assert.ok(m, what); return m[0]; };
ok(part(newPage, /<header class="site-header">[\s\S]*?<\/header>/, 'no header') === part(hubPage, /<header class="site-header">[\s\S]*?<\/header>/, 'no hub header'), 'the header is not the hub pages\' header');
ok(part(newPage, /<footer class="site-footer">[\s\S]*?<\/footer>/, 'no footer') === part(hubPage, /<footer class="site-footer">[\s\S]*?<\/footer>/, 'no hub footer'), 'the footer is not the hub pages\' footer');
ok(/<body[^>]*\sdata-menu="deal"/.test(newPage), 'the page does not name its menu (data-menu="deal")');
ok(/<link rel="canonical" href="https:\/\/cohoanalytics\.com\/deal-market-analysis\.html">/.test(newPage), 'no canonical address');
ok(/<meta name="robots" content="noindex, follow">/.test(newPage), 'until the links switch, the new page stays out of search results so the tool is not listed twice');
['hub/palette.css', 'css/pages/market-analysis-hub.css'].forEach(f => { ok(newPage.includes('href="' + f + '"'), 'the page does not load ' + f); ok(fs.existsSync(path.join(root, f)), f + ' is missing'); });
// The new pages' sheets come in a cascade layer, so they can never restyle the tool: an unlayered rule (every rule in
// the tool's own sheets) outranks a layered one.
['hub/shell.css', 'hub/visual-pass.css', 'hub/templates.css', 'hub/look.css'].forEach(f => {
  ok(newPage.includes('@import url("' + f + '") layer(hub);'), 'the page does not load ' + f + ' in the hub layer');
  ok(!newPage.includes('href="' + f + '"'), f + ' is also linked outside the layer, where it would restyle the tool');
  ok(fs.existsSync(path.join(root, f)), f + ' is missing');
});
// The header, footer and trail keep the palette's small-print colour, light and dark.
const mutedLight = /--muted:\s*([^;]+);/.exec(read('hub/palette.css'))[1].trim();
ok(newPage.includes(':is(.skip-link, .site-header, .site-footer, .crumbs) { --muted: ' + mutedLight + '; }'), 'the header and footer do not carry the palette\'s small-print colour');
// The tool's own sheets stay: its scripts draw with their classes.
[...oldPage.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].forEach(m => ok(newPage.includes('href="' + m[1] + '"'), 'the new page dropped the sheet ' + m[1]));
// The old page itself is not touched by any of this.
ok(!/hub\/|tool-steps|deal-market-analysis/.test(oldPage), 'market-analysis.html must stay as it is until paul retires it');

console.log('market-analysis-hub-page: ' + checks + ' checks passed');
