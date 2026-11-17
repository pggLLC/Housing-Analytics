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
 *  2. everything between <main> and </main> is the old page's, character for character, plus one added line
 *     (the trail back to Build a deal);
 *  3. every id on the old page is on the new one, except the old step bar's, which the new pages' bar replaces;
 *  4. the same scripts load in the same order, less the three the new header replaces, plus the new header's
 *     three, the seven-step bar's two, the place row's, and the calculator hand-off's two (section 10); the glossary,
 *     which js/navigation.js used to load, is loaded the same way;
 *  5. the seven-step bar is the new pages' own, in the old bar's place, with the same seven steps, so it looks and
 *     sits as on every other step (paul, 15 Nov 2026); every other link the old page offers is on the new one;
 *  6. the header and footer are the hub pages' own, and the visit is counted once;
 *  7. the place the visitor is working on and the saved projects, which the old header's pill showed, are in a row
 *     above the page (js/components/ma-place-row.js), reading and doing what the pill does;
 *  8. the bridging sheet's rules point at markup the tool still draws: every id it names exists, and the built-in
 *     calculator's phone rules find the inline layouts they were written against;
 *  9. every menu, step bar, next step and profile link opens the new page, and the scripts that recognise the
 *     Market Analysis link by its file name (carrying the place, saving before leaving) recognise the new name;
 * 10. a link under the built-in calculator opens its numbers in the Deal hub's Financials, on the route the hub
 *     registers, without the page's own address being read as a share link;
 * 11. a site sent from Market check (?site=lat,lon&sl=) is typed into the page's own address box and found there,
 *     under the parameter names Market check (hub/market.js) sends, and only on the new page.
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
const added = [/^ *<nav class="crumbs" aria-label="Breadcrumb">.*<\/nav>\n/m];
let newMain = mainOf(newPage);
added.forEach(re => { ok(re.test(newMain), 'the new page lacks an added line: ' + re); newMain = newMain.replace(re, ''); });
ok(newMain === mainOf(oldPage), 'between <main> and </main> the new page differs from market-analysis.html by more than the one added line (the trail)');

// 3. Every id.
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const oldIds = ids(oldPage), newIds = ids(newPage);
// The old footer's empty slot (the new footer stands in its place) and the old step bar (the new pages' bar does).
const GONE = new Set(['site-footer', 'maWorkflowProgress']);
const missing = [...oldIds].filter(id => !newIds.has(id) && !GONE.has(id));
ok(missing.length === 0, 'ids on market-analysis.html that the new page lacks: ' + missing.join(', '));
ok(oldIds.size > 200, 'market-analysis.html has far fewer ids than expected (' + oldIds.size + '); has the page changed shape?');

// 4. The same scripts, in order.
const scripts = html => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
const DROPPED = ['js/navigation.js', 'js/dark-mode-toggle.js', 'js/mobile-menu.js'];
const ADDED = ['js/components/ma-calc-handoff.js', 'js/deal-calculator-share.js', 'js/components/ma-site-link.js', 'js/components/ma-place-row.js', 'hub/lab-config.js', 'hub/page-chrome.js', 'hub/nav.js', 'hub/step-bar.js', 'js/components/ma-step-bar.js'];
const oldScripts = scripts(oldPage), newScripts = scripts(newPage);
DROPPED.forEach(f => { ok(oldScripts.includes(f), 'market-analysis.html no longer loads ' + f + '; update the build script'); ok(!newScripts.includes(f), 'the new page still loads ' + f); });
ADDED.forEach(f => ok(newScripts.includes(f), 'the new page does not load ' + f));
assert.deepEqual(newScripts.filter(f => !ADDED.includes(f)), oldScripts.filter(f => !DROPPED.includes(f)), 'the new page loads different scripts, or in a different order');
checks++;
ok(newScripts.slice(-5).join() === 'hub/lab-config.js,hub/page-chrome.js,hub/nav.js,hub/step-bar.js,js/components/ma-step-bar.js', 'the new header\'s scripts, then the seven-step bar\'s, must load last, in order');
// The page's own inline scripts ride along unchanged.
const inline = html => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1].trim()).filter(Boolean);
const newInline = inline(newPage).filter(s => !/coho-analytics-scheme|glossary-script/.test(s));
ok(/<script type="module">[^<]*gs\.src = 'js\/glossary\.js'/.test(newPage), 'the new page does not load the glossary (js/navigation.js used to)');
ok(/<script type="module">[^<]*dispatchEvent\(new CustomEvent\('nav:rendered'\)\)/.test(newPage), 'the new page does not announce nav:rendered (js/navigation.js used to; the Watchlist listens for it)');
ok(/<link rel="icon" href="favicon\.svg"/.test(newPage) && fs.existsSync(path.join(root, 'favicon.svg')), 'the new page has no favicon (js/navigation.js used to add it)');
// The next-step card finds the page's step by file name: an alias, or the page its step list sends that step to.
{
  const wna = read('js/components/workflow-next-action.js');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const knows = f => new RegExp("'" + esc(f) + "':\\s*'market'|key: 'market',[^}]*href: '" + esc(f) + "'").test(wna);
  ok(knows('deal-market-analysis.html') && knows('market-analysis.html'), 'js/components/workflow-next-action.js does not know both Market Analysis pages are step 4');
}
assert.deepEqual(newInline, inline(oldPage), 'an inline script differs between the two pages');
checks++;

// 5. The seven-step bar is the new pages' own (hub/step-bar.js), drawn by js/components/ma-step-bar.js into an empty
//    block where the old page has its bar, so all seven steps draw the same bar in the same place (paul, 15 Nov 2026:
//    it looked and sat differently here). The lab's qa/journey-steps.js walks the seven steps in a browser.
const barOf = html => (/<div class="wf-progress-wrap" id="maWorkflowProgress">[\s\S]*?\n  <\/div>\n/.exec(html) || [''])[0];
const oldBar = barOf(oldPage);
ok(oldBar.length > 0, 'market-analysis.html no longer has its seven-step bar; update the build script');
ok(barOf(newPage) === '', 'the new page still carries the old page\'s step bar');
ok(/\n  <div id="maStepBar" class="ma-step-bar"><\/div>\n/.test(newPage) && newPage.indexOf('id="maStepBar"') < newPage.indexOf('id="maPlaceRow"'),
  'the new page has no empty block for the seven-step bar above the place row, where the old bar sat');
{
  const vm = await import('node:vm');
  const win = {};
  vm.runInNewContext(read('hub/step-bar.js'), { window: win });
  const PATH = win.LabStep && win.LabStep.PATH;
  const oldNames = [...oldBar.matchAll(/wf-step__label">([^<]+)</g)].map(m => m[1].trim());
  ok(PATH && PATH.map(s => s[0]).join() === oldNames.join(), 'the new bar\'s steps (' + (PATH || []).map(s => s[0]).join(', ') + ') are not the old bar\'s (' + oldNames.join(', ') + ')');
  const mine = PATH && PATH.findIndex(s => s[3] === 'deal-market-analysis.html');
  ok(mine === oldNames.indexOf('Market Analysis'), 'the new bar does not send its Market Analysis step to this page');
  ok(/Step\.mount\(el, AT\b/.test(read('js/components/ma-step-bar.js')) && /var AT = 'deal-market-analysis\.html'/.test(read('js/components/ma-step-bar.js')),
    'js/components/ma-step-bar.js does not draw the bar with this page as the step it is on');
  ok(PATH && PATH.every(s => s[2] || s[3]), 'a step of the new bar links nowhere');
}
// The bar follows the page's place and product as they change (Codex P2s on #2878). With no place in the address, it
// is drawn from the open project or the chosen county, so opening another project draws it again; and a for-sale or
// mixed product sends four steps to the ownership tools as the old bar did (js/components/workflow-progress.js).
{
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body><div id="maStepBar" class="ma-step-bar"></div></body>', { runScripts: 'outside-only', url: 'https://cohoanalytics.com/deal-market-analysis.html' });
  const w = dom.window;
  let ctx = { geoid: '08077', fips: '08077', displayName: 'Mesa County' };
  w.JurisdictionUrlContext = { resolveSync: () => ctx };
  w.LAB_LIVE = '';
  w.eval(read('hub/step-bar.js'));
  w.eval(read('js/components/ma-step-bar.js'));
  // The bar is drawn once the page's deferred scripts have run (DOMContentLoaded), as on the page.
  if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  const links = () => [...w.document.querySelectorAll('#maStepBar .step-path ol > li')].map(li => { const a = li.querySelector('a.sp-box'); return a ? a.getAttribute('href') : null; });
  const titles = () => [...w.document.querySelectorAll('#maStepBar .sp-title')].map(t => t.firstChild.textContent.trim());
  ok(/deal-calculator\?g=08077$/.test(links()[5]), 'the bar is not drawn on the open project (Mesa): ' + links()[5]);
  ctx = { geoid: '08013', fips: '08013', displayName: 'Boulder County' };
  w.document.dispatchEvent(new w.CustomEvent('workflow:project-loaded', { detail: { id: 'b' } }));
  ok(/deal-calculator\?g=08013$/.test(links()[5]) && /Boulder/.test(w.document.querySelector('#maStepBar .sp-place').textContent),
    'opening another project left the bar on the last one: ' + links()[5] + ' / ' + w.document.querySelector('#maStepBar .sp-place').textContent);
  ctx = { geoid: '08045', fips: '08045', displayName: 'Garfield County' };
  w.document.dispatchEvent(new w.CustomEvent('sitestate:county-changed'));
  ok(/deal-calculator\?g=08045$/.test(links()[5]), 'choosing another county left the bar on the last place: ' + links()[5]);
  // The old bar's for-sale route, read from the code that drew it.
  const wp = new JSDOM('<!doctype html><main></main>', { runScripts: 'outside-only', url: 'https://cohoanalytics.com/' });
  wp.window.localStorage.setItem('coho:guided-product', 'for-sale');
  wp.window.eval(read('js/components/workflow-progress.js'));
  const oldRoute = wp.window.WorkflowProgress.routeSteps();
  w.localStorage.setItem('coho:guided-product', 'for-sale');
  w.document.dispatchEvent(new w.CustomEvent('workflow:product-changed', { detail: { product: 'for-sale' } }));
  const t = titles(), l = links();
  oldRoute.forEach((s, i) => {
    // This page's own step stays itself, as on the old bar (checked below).
    if (!s.routed || i === 3) return;
    ok(t[i] === s.label, 'for-sale step ' + (i + 1) + ' reads "' + t[i] + '"; the old bar read "' + s.label + '"');
    const want = s.href.replace(/(#.*)?$/, m => (s.href.split('#')[0].includes('?') ? '&' : '?') + 'geoid=08045' + m);
    ok(l[i] === want, 'for-sale step ' + (i + 1) + ' links ' + l[i] + '; the old bar linked ' + want);
  });
  ok(oldRoute.filter(s => s.routed).length === 4, 'the old bar\'s for-sale route no longer replaces four steps; update hub/step-bar.js OWN to match');
  ok(t[3] === 'Market Analysis' && l[3] === null, 'with a for-sale product this page is no longer its own step');
  w.localStorage.setItem('coho:guided-product', 'mixed');
  w.document.dispatchEvent(new w.CustomEvent('workflow:product-changed', { detail: { product: 'mixed' } }));
  const also = w.document.querySelector('#maStepBar .sp-also');
  ok(also && [...also.querySelectorAll('a')].map(a => a.textContent).join() === 'Ownership Need,For-Sale Market Study,Land Value,For-Sale Feasibility' && titles()[5] === 'Deal Calculator',
    'a mixed project does not keep the rental steps and list the ownership tools under the bar');
  w.close(); wp.window.close();
}
// Every other link on the old page is on the new one (the body is identical; this covers head and tail). The old
// bar's links are the old step pages; the new bar links each step's new page.
const hrefs = html => new Set([...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(m => m[1]));
const lostLinks = [...hrefs(oldPage.replace(oldBar, ''))].filter(h => !hrefs(newPage).has(h));
ok(lostLinks.length === 0, 'links on market-analysis.html that the new page lacks: ' + lostLinks.join(', '));

// 6. The hub pages' own header and footer; one visit counter.
const part = (html, re, what) => { const m = re.exec(html); assert.ok(m, what); return m[0]; };
ok(part(newPage, /<header class="site-header">[\s\S]*?<\/header>/, 'no header') === part(hubPage, /<header class="site-header">[\s\S]*?<\/header>/, 'no hub header'), 'the header is not the hub pages\' header');
ok(part(newPage, /<footer class="site-footer">[\s\S]*?<\/footer>/, 'no footer') === part(hubPage, /<footer class="site-footer">[\s\S]*?<\/footer>/, 'no hub footer'), 'the footer is not the hub pages\' footer');
ok(/<body[^>]*\sdata-menu="deal"/.test(newPage), 'the page does not name its menu (data-menu="deal")');
ok(/<link rel="canonical" href="https:\/\/cohoanalytics\.com\/deal-market-analysis\.html">/.test(newPage), 'no canonical address');
// The menus and the seven-step bar send visitors here (section 9), so search engines may list it.
ok(!/<meta name="robots"[^>]*noindex/.test(newPage), 'the page every link now opens is hidden from search');
['hub/palette.css', 'css/pages/market-analysis-hub.css'].forEach(f => { ok(newPage.includes('href="' + f + '"'), 'the page does not load ' + f); ok(fs.existsSync(path.join(root, f)), f + ' is missing'); });
// The new pages' sheets come in a cascade layer, so they can never restyle the tool: an unlayered rule (every rule in
// the tool's own sheets) outranks a layered one.
['hub/shell.css', 'hub/visual-pass.css', 'hub/templates.css', 'hub/look.css'].forEach(f => {
  ok(newPage.includes('@import url("' + f + '") layer(hub);'), 'the page does not load ' + f + ' in the hub layer');
  ok(!newPage.includes('href="' + f + '"'), f + ' is also linked outside the layer, where it would restyle the tool');
  ok(fs.existsSync(path.join(root, f)), f + ' is missing');
});
// An open header menu must paint above the tool: above its seven-step bar, its sticky section row and its map. The
// new header is sticky (a stacking context that carries the menus), and on this page it takes the old header's
// level, which the tool's own sheets stack everything else under.
{
  const headerRule = [...['hub/shell.css', 'hub/visual-pass.css', 'hub/templates.css', 'hub/look.css'].map(read).join('\n')
    .matchAll(/^\.site-header\s*\{([^}]*)\}/gm)].map(m => m[1]).filter(b => /z-index/.test(b)).pop() || '';
  const bridge = read('css/pages/market-analysis-hub.css');
  const headerZ = /body\.tool-page \.site-header:not\(#_\)\s*\{\s*z-index:\s*(\d+)\s*!important/.exec(bridge);
  const rowZ = /\.ma-section-nav\s*\{[^}]*z-index:\s*(\d+)/.exec(bridge);
  // Every level the tool's theme gives the step bar (.wf-progress-wrap, .workflow-progress).
  const barZ = [...read('css/site-theme.css').matchAll(/\.(?:wf-progress-wrap|workflow-progress)\b[^{}]*\{([^}]*)\}/g)]
    .map(m => /z-index:\s*(\d+)/.exec(m[1])).filter(Boolean).map(m => Number(m[1]));
  ok(/position:\s*sticky/.test(headerRule), 'the new header is no longer sticky, so it no longer carries its menus above the page');
  ok(headerZ, 'the bridging sheet no longer gives the header a level of its own on this page');
  ok(barZ.length > 0, 'css/site-theme.css no longer gives the seven-step bar a z-index the way this reads it');
  ok(headerZ && barZ.every(z => Number(headerZ[1]) > z), 'the seven-step bar would paint over an open header menu');
  ok(headerZ && rowZ && Number(headerZ[1]) > Number(rowZ[1]), 'the section row would paint over an open header menu');
  const slimZ = /\.ma-step-bar \.sp-sticky:not\(#_\)\s*\{\s*z-index:\s*(\d+)\s*!important/.exec(bridge);
  ok(slimZ && headerZ && Number(headerZ[1]) > Number(slimZ[1]) && rowZ && Number(slimZ[1]) > Number(rowZ[1]), 'the seven-step bar\'s slim line must sit above the section row and below an open header menu');
}
// The header, footer and trail keep the palette's small-print colour, light and dark.
const mutedLight = /--muted:\s*([^;]+);/.exec(read('hub/palette.css'))[1].trim();
ok(newPage.includes(':is(.skip-link, .site-header, .site-footer, .crumbs) { --muted: ' + mutedLight + '; }'), 'the header and footer do not carry the palette\'s small-print colour');
// The tool's own sheets stay: its scripts draw with their classes.
[...oldPage.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].forEach(m => ok(newPage.includes('href="' + m[1] + '"'), 'the new page dropped the sheet ' + m[1]));
// The old page itself is not touched by any of this.
ok(!/hub\/|class="crumbs"|deal-market-analysis/.test(oldPage), 'market-analysis.html must stay as it is until paul retires it');

// 7. The place and saved-projects row. The old header's pill (js/navigation.js) names the place and, on a click,
//    lists up to three saved projects and "New Project". The new header has no pill; the row does both jobs.
ok(/\n {2}<div id="maPlaceRow" class="ma-place-row" role="region" aria-label="[^"<>]+" hidden><\/div>\n {2}<main id="main-content">\n/.test(newPage), 'the place row is not just above <main>, a named region, empty and hidden until its script fills it');
ok(newScripts.indexOf('js/components/ma-place-row.js') === newScripts.length - 6, 'the place row\'s script must load after the tool\'s own scripts and before the new header\'s');
{
  const nav = read('js/navigation.js');
  // What the row copies from the pill. If the pill changes, the row must be looked at again.
  ok(nav.includes('projects.slice(0, 3)') && nav.includes(".slice(0, 28)") && nav.includes("select-jurisdiction.html?new=1") && nav.includes('setCounty(null)') && nav.includes("'workflow:step-updated', _updateJurisdictionPill"),
    'the pill in js/navigation.js no longer works the way js/components/ma-place-row.js copies it');
  const { JSDOM } = await import('jsdom');
  const src = read('js/components/ma-place-row.js');
  const proj = (id, name, jx) => ({ _meta: { projectId: id, projectName: name }, jurisdiction: jx });
  const open = (state, withRow = true) => {
    const dom = new JSDOM('<!doctype html><body>' + (withRow ? '<div id="maPlaceRow" class="ma-place-row" hidden></div>' : '') + '<main id="main-content"><button id="elsewhere">x</button></main></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    const calls = [];
    if (state) {
      w.WorkflowState = {
        getActiveProject: () => state.projects.find(x => x._meta.projectId === state.active) || null,
        listProjects: () => state.projects.map(x => ({ id: x._meta.projectId, name: x._meta.projectName })),
        loadProject: id => { calls.push('load ' + id); state.active = id; w.document.dispatchEvent(new w.CustomEvent('workflow:project-loaded', { detail: { id } })); },
      };
      w.SiteState = { getCounty: () => state.county || { fips: null, name: null }, setCounty: v => { calls.push('county ' + v); state.county = null; } };
    }
    w.eval(src);
    const row = w.document.getElementById('maPlaceRow');
    // The place the row names: the one emphasised name in its place line, or '' when it names none. The words around
    // it are a wording choice and are not checked (AGENTS.md, "Guards: pin the agreement, not the copy").
    const place = () => { const e = row.querySelectorAll('.ma-place-row__place strong'); return e.length === 1 ? e[0].textContent : e.length ? '(more than one name)' : ''; };
    return { w, row, calls, place, q: sel => row.querySelector(sel), click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })) };
  };
  // What the row must agree with is the pill: the same joiner between town and county, the same stand-in for a
  // project with no name. Both are read from js/navigation.js, so rewording the pill and the row together stays green.
  const joiner = (/pillLabel = city \? city \+ '([^']+)' \+ county : county/.exec(nav) || [])[1];
  const noName = (/_esc\(\(p\.name \|\| '([^']+)'\)\.slice\(0, 28\)\)/.exec(nav) || [])[1];
  ok(joiner && noName, 'js/navigation.js no longer builds the pill\'s label or a nameless project\'s label the way this reads them');
  // Nothing saved, nothing chosen; and the page's scripts missing altogether.
  for (const state of [{ projects: [], active: null }, null]) {
    const t = open(state);
    ok(!t.row.hidden && t.q('.ma-place-row__place').textContent.trim() && t.place() === '', 'with no place the row should show, say something, and name no place');
    ok(!t.q('[data-proj-id]') && !t.q('.ma-place-row__menu ul') && t.q('.ma-place-row__menu').textContent.trim(), 'with no project the list should offer none, and not be blank');
    ok(t.q('.ma-place-row__change').getAttribute('href') === 'select-jurisdiction.html', 'the row should offer the place picker, where the pill links');
    ok(t.q('.ma-place-row__new').getAttribute('href') === 'select-jurisdiction.html?new=1', '"New project" should go where the pill\'s goes');
  }
  ok(open({ projects: [], active: null }, false).row === null, 'without the row on the page the script should do nothing');
  // A county chosen but no project: the pill falls back to SiteState, and so does the row.
  ok(open({ projects: [], active: null, county: { fips: '08015', name: 'Chaffee County' } }).place() === 'Chaffee County', 'the row should fall back to the chosen county, as the pill does');
  // Four projects (invented), the second open.
  const state = { active: 'p2', projects: [
    proj('p1', 'Alamosa family homes', { type: 'city', name: 'Alamosa', displayName: 'Alamosa (city)', countyName: 'Alamosa County' }),
    proj('p2', 'Salida <b>senior</b> flats with a long name', { type: 'city', name: 'Salida', displayName: 'Salida (city)', countyName: 'Chaffee County' }),
    proj('p3', '', { type: 'county', name: 'Morgan County' }),
    proj('p4', 'Lamar duplexes', { type: 'city', name: 'Lamar', countyName: 'Prowers County' }),
  ] };
  const t = open(state);
  ok(t.place() === 'Salida' + joiner + 'Chaffee County', 'the place should read town, then county, joined as on the pill');
  const btns = () => [...t.row.querySelectorAll('[data-proj-id]')];
  ok(btns().length === 3 && btns().map(b => b.getAttribute('data-proj-id')).join() === 'p1,p2,p3', 'the list should hold the first three saved projects, as the pill\'s does');
  ok(btns()[1].firstChild.textContent.trim() === 'Salida <b>senior</b> flats w' && !t.q('.ma-place-row__menu b'), 'a project name should be cut at 28 characters and written as text');
  ok(btns()[2].textContent === noName, 'a project with no name should read as it does on the pill');
  const marked = () => btns().filter(b => b.getAttribute('aria-current') === 'true');
  // Marked for a screen reader (aria-current) and for the eye (a marker inside that button and no other).
  ok(marked().length === 1 && marked()[0] === btns()[1] && [...t.row.querySelectorAll('.ma-place-row__now')].every(m => m.textContent.trim() && m.closest('[data-proj-id]') === btns()[1]) && t.q('.ma-place-row__now'), 'the open project, and only it, should be marked');
  // Opening another project: the pill calls WorkflowState.loadProject(id) and shows the new place.
  t.q('details').open = true;
  t.click(btns()[2]);
  ok(t.calls.join() === 'load p3' && t.place() === 'Morgan County', 'a click on a project should open it and show its place');
  ok(!t.q('details').open && marked().length === 1 && marked()[0] === btns()[2], 'after a project is opened the list should close with that project marked');
  // Escape and a click elsewhere close the list; a click inside it does not.
  t.q('details').open = true;
  t.click(t.q('.ma-place-row__menu ul'));
  ok(t.q('details').open, 'a click inside the list should leave it open');
  t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!t.q('details').open, 'Escape should close the list');
  t.q('details').open = true;
  t.click(t.w.document.getElementById('elsewhere'));
  ok(!t.q('details').open, 'a click elsewhere should close the list');
  // The place follows the project while the list is closed; an open list is not redrawn under the visitor's hand.
  state.projects[2].jurisdiction = { type: 'city', name: 'Brush', countyName: 'Morgan County' };
  t.q('details').open = true;
  t.w.document.dispatchEvent(new t.w.CustomEvent('workflow:step-updated'));
  ok(t.place() === 'Morgan County', 'an open list should not be redrawn');
  t.q('details').open = false;
  t.w.document.dispatchEvent(new t.w.CustomEvent('workflow:step-updated'));
  ok(t.place() === 'Brush' + joiner + 'Morgan County', 'the place should follow a saved step, as the pill does');
  // "New project" clears the county first, as the pill does, and lets the link go.
  t.calls.length = 0;
  const ev = new t.w.MouseEvent('click', { bubbles: true, cancelable: true });
  t.q('.ma-place-row__new').dispatchEvent(ev);
  ok(t.calls.join() === 'county null' && !ev.defaultPrevented, '"New project" should clear the county and follow its link');
  // The open list paints above the map (whose layers go up to 1000) and below the seven-step bar.
  const bridge = read('css/pages/market-analysis-hub.css');
  const menuZ = /\.ma-place-row__menu\s*\{[^}]*z-index:\s*(\d+)/.exec(bridge);
  const barZ = [...read('css/site-theme.css').matchAll(/\.(?:wf-progress-wrap|workflow-progress)\b[^{}]*\{([^}]*)\}/g)].map(m => /z-index:\s*(\d+)/.exec(m[1])).filter(Boolean).map(m => Number(m[1]));
  ok(menuZ && Number(menuZ[1]) > 1000 && barZ.every(z => Number(menuZ[1]) < z), 'the open list should sit above the map and below the seven-step bar');
}

// 8. The bridging sheet only lays out what the tool draws. A rule naming an id the tool no longer draws, or written
//    against an inline layout the tool no longer uses, would do nothing without failing anywhere else.
{
  const bridge = read('css/pages/market-analysis-hub.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const jsFiles = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap(d => d.isDirectory() ? jsFiles(dir + '/' + d.name) : d.name.endsWith('.js') ? [dir + '/' + d.name] : []);
  const drawn = [oldPage, ...jsFiles('js').map(read)].join('\n');
  const selectors = [...bridge.matchAll(/([^{}]+)\{/g)].map(m => m[1]).filter(sel => !/^\s*@/.test(sel));
  const named = new Set(selectors.flatMap(sel => [...sel.replace(/"[^"]*"/g, '""').matchAll(/#([A-Za-z][\w-]*)/g)].map(m => m[1])));
  ok(named.has('dealCalcMount') && named.has('dc-ami-rows'), 'the sheet no longer has rules for the built-in calculator');
  // An id is drawn when the page or a script writes it whole.
  const writes = id => ['"' + id + '"', "'" + id + "'", 'id=\\"' + id + '\\"'].some(q => drawn.includes(q));
  named.forEach(id => ok(writes(id), 'the bridging sheet names #' + id + ', which nothing on the page draws'));
  // The calculator's phone rules sit in the phone block, and each still finds its layout.
  const phone = [...bridge.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  ['#dc-ami-rows, div:has(+ #dc-ami-rows))', '#dc-cb-detail > div[style*="grid-template-columns"]', '#dealCalcMount dl[style*="grid-template-columns"]']
    .forEach(k => ok(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{ grid-template-columns:[^;]+!important').test(phone), k + ' should be laid out on a phone only, over its inline grid'));
  ok(/#dealCalcMount label:has\(> :is\(input, select\):is\(\[style\*="display:block"\], \[style\*="display: block"\]\)\)/.test(phone), 'the pay-in labels should be laid out on a phone only');
  const calc = read('js/deal-calculator.js');
  // Tiers: a three-column grid with its heading row just before it.
  ok(/<div style="display:grid;grid-template-columns:[^"]+">\s*(?:<span[^>]*>[^<]*<\/span>\s*){3}<\/div>\s*<div id="dc-ami-rows" style="display:grid;grid-template-columns:/.test(calc),
    'the income tiers are no longer a grid with its heading row just before it');
  ok(/`\s*<label style="display:flex[^"]*">\s*<input id="dc-chk-\$\{pct\}"/.test(calc), 'a tier no longer starts with its label, which the sheet gives the whole row');
  ok(/<div style="grid-column:1 \/ -1;display:grid;grid-template-columns:/.test(calc) && /#dc-ami-rows > div\[style\*="grid-column"\] \{ grid-template-columns:[^;]+!important/.test(phone),
    'the homes-by-bedroom boxes under each tier are no longer a full-row inline grid the sheet sets three to a row');
  // Pay-in boxes: words and a display:block box inside one label, which a phone draws as a row.
  ['fed', 'state', 'add'].forEach(k => ok(new RegExp('<label[^>]*>[^<]*<input id="dc-' + k + '-payin-completion" type="number"[^>]*style="display:block').test(calc),
    'the ' + k + ' pay-in box is no longer a display:block box inside its label'));
  ok(/\blabel,[^{}]*\{[^}]*display:\s*inline-flex/.test(read('css/responsive.css')), 'css/responsive.css no longer draws every label as a row on a phone; the pay-in rule may be unneeded');
  // Terms list and basis lines: inline two-column grids.
  ok(/<dl style="[^"]*display:grid;grid-template-columns:/.test(calc), 'the formula terms are no longer an inline grid');
  ok(/function row\(label, value, note\) \{\s*rows\.push\('<div style="display:grid;grid-template-columns:[^"]+">'/.test(calc) && /el\('dc-cb-detail'\)/.test(calc),
    'the basis lines are no longer inline grids written into #dc-cb-detail');
  // The calculator's notes beat the 18px rule for paragraphs in main: two ids against one, and no inline size.
  const big = /(?:^|[}/])\s*([^{}/]*#main-content p:not\(\[style\*="font-size"\]\))\s*\{[^}]*font-size/m.exec(read('css/pages/housing-needs-assessment.css').replace(/\/\*[\s\S]*?\*\//g, '/'));
  ok(big && (big[1].match(/#/g) || []).length === 1, 'the rule that makes paragraphs in main large has changed; recheck the calculator notes');
  ok(/#main-content #dealCalcMount p:not\(\[style\*="font-size"\]\)\s*\{\s*font-size/.test(bridge), 'the calculator notes no longer outrank the large-paragraph rule');
}

// 9. The links switched. The old page stays up at its address, with no redirect, until paul retires it; nothing on
//    the site sends a visitor there any more. methods.html is kept out of pull requests, so its prose link stays.
{
  const LEFT_ALONE = new Set(['market-analysis.html', 'deal-market-analysis.html', 'methods.html']);
  const linkToOld = /(?:href\s*[=:]\s*["']|["'])(?:\.\.\/)?market-analysis\.html(?=[?#]|["'](?!\s*:))/; // a link or an address, not a key in a lookup table
  const htmlFiles = dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.html')).map(f => (dir === '.' ? '' : dir + '/') + f);
  const jsAll = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap(d => d.isDirectory() ? jsAll(dir + '/' + d.name) : d.name.endsWith('.js') ? [dir + '/' + d.name] : []);
  const stillOld = [...htmlFiles('.'), ...htmlFiles('places'), ...jsAll('js'), ...jsAll('hub'), 'scripts/hna/build_place_pages.py', 'scripts/hna/build_hna_views.py']
    .filter(f => !LEFT_ALONE.has(f) && linkToOld.test(read(f).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')));
  ok(stillOld.length === 0, 'these still send visitors to the old page: ' + stillOld.slice(0, 8).join(', '));
  ok(read('js/components/workflow-progress.js').includes("key: 'market',       label: 'Market Analysis',    href: '" + 'deal-market-analysis.html' + "'")
    || /key: 'market',[^}]*href: 'deal-market-analysis\.html'/.test(read('js/components/workflow-progress.js')), 'step 4 of the seven-step bar does not open the new page');
  ok(/href: "deal-market-analysis\.html"/.test(read('js/navigation.js')), 'the menu does not open the new page');
  // Scripts that know the Market Analysis link by its file name.
  const reFrom = (f, re, what) => { const m = re.exec(read(f)); ok(m, f + ' no longer ' + what); return m ? new RegExp(m[1]) : /$^/; };
  const nextStep = reFrom('js/hna/hna-workflow-autosave.js', /NEXT_STEP_HREF = \/(.+)\/;/, 'names the next-step links it saves before');
  ok(nextStep.test('deal-market-analysis.html') && nextStep.test('market-analysis.html'), 'the needs assessment no longer saves before a visitor follows the Market Analysis link');
  const carry = reFrom('js/components/workflow-next-action.js', /if \(!\/(.+?)\/\.test\(base\)\) return;/, 'checks which link carries the place');
  ok(carry.test('deal-market-analysis.html') && !carry.test('deal-calculator.html'), 'the next-step button no longer carries the place to Market Analysis');
  ok(/href="deal-market-analysis\.html" data-carry-place/.test(read('scripts/hna/build_hna_views.py')), 'the needs assessment view builder writes another Market Analysis link');
  ok(/'market-analysis\.html':\s*'market'/.test(read('js/components/workflow-next-action.js')), 'the old page, still up, is no longer recognised as step 4');
}

// 10. Under the built-in calculator, a link that opens its numbers in the Deal hub's Financials. The settings come from
//     js/deal-calculator-share.js, loaded unchanged (the rules "Copy link" uses), plus the page's subject project.
//     js/components/ma-calc-handoff.js keeps the share script from opening this page's own address (?fips=...)
//     as a share link, which would reset the calculator's rent schedule and utility allowance.
{
  const at = f => newScripts.indexOf(f);
  ok(at('js/deal-calculator.js') >= 0 && at('js/deal-calculator.js') < at('js/components/ma-calc-handoff.js') && at('js/components/ma-calc-handoff.js') === at('js/deal-calculator-share.js') - 1,
    'the hand-off script must load after js/deal-calculator.js (which sets window.DealCalcLinkParams) and just before js/deal-calculator-share.js (which reads it)');
  const tag = f => (newPage.match(new RegExp('<script[^>]*\\ssrc="' + f.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&') + '"[^>]*>')) || [''])[0];
  ok(/\sdefer[\s>]/.test(tag('js/deal-calculator.js')) && /\sdefer[\s>]/.test(tag('js/components/ma-calc-handoff.js')) && /\sdefer[\s>]/.test(tag('js/deal-calculator-share.js')),
    'the calculator, hand-off and share scripts must all be deferred, or they no longer run in that order');
  ok(!scripts(oldPage).includes('js/deal-calculator-share.js') && !scripts(oldPage).includes('js/components/ma-calc-handoff.js'), 'the old page itself should not load the hand-off');

  // The address the link opens agrees with the route the Deal hub registers.
  const src = read('js/components/ma-calc-handoff.js');
  const route = (/var ROUTE = '([^']+)';/.exec(src) || [])[1] || '';
  const m = /^([a-z0-9-]+\.html)#\/([a-z0-9-]+)\?v=1&$/.exec(route);
  ok(m, 'the hand-off route is not "<page>#/<view>?v=1&": ' + route);
  const [, hubFile, view] = m || [];
  const hubScripts = scripts(read(hubFile || 'deal-hub.html'));
  const registers = hubScripts.filter(f => f.startsWith('hub/') && fs.existsSync(path.join(root, f)) && new RegExp("Shell\\.views\\[['\"]" + view + "['\"]\\]\\s*=").test(read(f)));
  ok(registers.length === 1, hubFile + ' does not load a script that registers the "' + view + '" view the hand-off opens');
  // And the hub page lets the route through: hub/lab-config.js sends a route its page's list does not match to that
  // page's start (#/projects). Tested the way its drawnBy() tests a hash: the path, with and without a closing slash.
  const hubs = JSON.parse((/var HUBS = (\{.*?\}), STARTS = /.exec(read('hub/lab-config.js')) || [])[1] || '{}');
  ok((hubs[hubFile] || []).some(re => new RegExp(re).test('#/' + view) || new RegExp(re).test('#/' + view + '/')),
    'hub/lab-config.js does not let #/' + view + ' through on ' + hubFile + ', so the link would land on its start page');
  if (registers.length === 1) {
    const reader = read(registers[0]);
    ok(/['"]subject['"]/.test(reader), registers[0] + ' no longer reads the subject setting the hand-off sends');
  }

  // What the script does, in a page with the calculator drawn. The share script and subject project are stand-ins.
  const { JSDOM } = await import('jsdom');
  const opened = [];
  const run = async ({ drawn = true, share = true, subject = { total_units: 40, unit_mix: [{ br: 2, ami: 60, count: 40 }] } } = {}) => {
    const dom = new JSDOM('<!doctype html><body><main id="main-content"><div id="dealCalcMount">' + (drawn ? '<input id="dc-units" value="40">' : '') + '</div><section id="lihtcConceptSection"></section></main></body>',
      { runScripts: 'outside-only', url: 'https://example.com/deal-market-analysis.html?fips=08013&auto=1' });
    const w = dom.window;
    opened.push(w);
    w.DealCalcLinkParams = () => new w.URLSearchParams('fips=08013&auto=1');
    const snap = { q: 'units=40&tr=a%3D1' };
    if (share) w.__DealCalcShare = { buildSnapshot: () => ({ url: 'https://example.com/deal-market-analysis.html?' + snap.q }) };
    if (subject) w.SubjectProject = { get: () => subject };
    w.eval(src);
    if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
    const p = w.document.getElementById('maCalcHandoff');
    return { w, p, a: p && p.querySelector('a'), snap };
  };
  const t = await run();
  ok(t.w.DealCalcLinkParams(t.w.location).toString() === '', 'on this page the share script must see no share link in the address');
  ok(t.p && t.p.previousElementSibling && t.p.previousElementSibling.id === 'dealCalcMount', 'the link should sit just under the built-in calculator');
  const href = () => t.a.getAttribute('href');
  const parts = h => { const q = new URLSearchParams(h.slice(h.indexOf('?') + 1)); return { route: h.slice(0, h.indexOf('?') + 1), q }; };
  ok(parts(href()).route === route.slice(0, -('v=1&'.length)) && parts(href()).q.get('v') === '1', 'the link should open the hub route with v=1 first');
  ok(parts(href()).q.get('units') === '40' && parts(href()).q.get('tr') === 'a=1', 'the link should carry the share script\'s settings as they are');
  ok(JSON.stringify(JSON.parse(parts(href()).q.get('subject'))) === JSON.stringify({ total_units: 40, unit_mix: [{ br: 2, ami: 60, count: 40 }] }), 'the link should carry the subject project whole');
  t.snap.q = 'units=52';
  t.a.dispatchEvent(new t.w.Event('pointerdown'));
  ok(parts(href()).q.get('units') === '52', 'the link should carry the numbers on screen when it is used, not when it was drawn');
  ok(t.a.textContent.trim() && t.p.querySelector('#' + t.a.getAttribute('aria-describedby')), 'the link should have words and a described note');
  ok(!parts((await run({ subject: null })).a.getAttribute('href')).q.has('subject'), 'with no subject project the link should still open, without one');
  ok(!(await run({ drawn: false })).p && !(await run({ share: false })).p, 'before the calculator is drawn, or without the share script, there should be no link yet');
  opened.forEach(w => w.close()); // the script keeps looking for the calculator for a minute
}

// 11. A site from Market check. hub/market.js links "Full Market Analysis for this site" to this page with
//     &site=<lat>,<lon>&sl=<address>; js/components/ma-site-link.js types the point into the page's own address box
//     as "lat, lon" and presses Find once the data has loaded, so js/market-analysis.js places it and starts the
//     analysis as for a person pasting coordinates. Nothing in it places a site or runs anything itself.
{
  const src = read('js/components/ma-site-link.js');
  const at = f => newScripts.indexOf(f);
  ok(at('js/market-analysis.js') >= 0 && at('js/market-analysis.js') < at('js/components/ma-site-link.js'), 'the site link must load after js/market-analysis.js');
  ok(/<script defer src="js\/components\/ma-site-link\.js"><\/script>/.test(newPage), 'the site link must be deferred');
  ok(!scripts(oldPage).includes('js/components/ma-site-link.js'), 'the old page itself should not load the site link');
  // It drives the page's own controls, which must still be on the page.
  const used = [...new Set([...src.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
  ok(used.length === 6 && used.every(id => oldIds.has(id)), 'the site link uses ids the page no longer has: ' + used.filter(id => !oldIds.has(id)).join(', '));
  // The same Colorado box the address search checks, and the status words it writes for a typed point.
  const engine = read('js/market-analysis.js');
  const box = /CO_LAT_MIN = ([-\d.]+), CO_LAT_MAX = ([-\d.]+);\s*var CO_LON_MIN = ([-\d.]+), CO_LON_MAX = ([-\d.]+);/.exec(engine);
  const mine = /latMin: ([-\d.]+), latMax: ([-\d.]+), lonMin: ([-\d.]+), lonMax: ([-\d.]+)/.exec(src);
  ok(box && mine && box.slice(1).join() === mine.slice(1).join(), 'the site link\'s Colorado box differs from the one js/market-analysis.js checks');
  ok(/'Pin dropped at '/.test(engine) && /\^Pin dropped/.test(src), 'the address search no longer says "Pin dropped at" for a typed point');
  // Agreement with Market check: the parameter names it sends are the ones read here, and it never sends ?auto=1
  // (which would place the town centre over the site).
  const market = read('hub/market.js');
  const link = /'deal-market-analysis\.html\?geoid=' \+ encodeURIComponent\(g\) \+ \(lead \? '&(\w+)=' \+ site\.lat\.toFixed\(5\) \+ ',' \+ site\.lon\.toFixed\(5\) \+ '&(\w+)=' \+ encodeURIComponent\(site\.label\)/.exec(market);
  ok(link, 'hub/market.js no longer builds the Market Analysis link with a site as ?geoid=...&<site>=lat,lon&<label>=...');
  const reads = [...src.matchAll(/sp\.get\('(\w+)'\)/g)].map(m => m[1]);
  ok(link && reads.slice().sort().join() === [link[1], link[2], 'tr', 'tl'].sort().join(), 'Market check sends ' + (link ? link.slice(1).join(', ') : '?') + ' but the site link reads ' + reads.join(', '));
  // And the market area (paul, 17 Nov 2026: the site should transfer and run the PMA): Market check adds the picked
  // tracts as tr= and the area's name as tl= when the link is followed.
  ok(/q\.set\('tr', /.test(market) && /q\.set\('tl', /.test(market), 'hub/market.js no longer adds the market area (tr=, tl=) to the Market Analysis link');
  const picker = read('js/pma-tract-picker.js');
  ok(/setSelection:\s+setSelection,/.test(picker), 'js/pma-tract-picker.js no longer exposes setSelection for the market area from Market check');
  ok(!/deal-market-analysis\.html[^'"]*auto=1/.test(market), 'Market check should never send auto=1 to the full Market Analysis');

  // What it does, in a page with the four controls.
  const { JSDOM } = await import('jsdom');
  const opened = [];
  const run = async (query, { ready = true, setup } = {}) => {
    const dom = new JSDOM('<!doctype html><body><input id="pmaAddressInput"><button id="pmaAddressSearchBtn">Find</button><p id="pmaAddressStatus"></p><div id="pmaMap"></div></body>',
      { runScripts: 'outside-only', url: 'https://example.com/deal-market-analysis.html' + query });
    const w = dom.window; opened.push(w);
    const pressed = [];
    w.document.getElementById('pmaAddressSearchBtn').addEventListener('click', () => {
      const v = w.document.getElementById('pmaAddressInput').value; pressed.push(v);
      w.document.getElementById('pmaAddressStatus').textContent = 'Pin dropped at ' + v;
    });
    let release; const data = ready ? Promise.resolve() : new Promise(r => { release = r; });
    w.PMAEngine = { whenDataReady: () => data };
    const later = w.setTimeout.bind(w); w.setTimeout = f => later(f, 0);   // the three-second wait, without waiting
    if (setup) setup(w);
    w.eval(src);
    await new Promise(r => setTimeout(r, 50));
    return { w, pressed, release, status: () => w.document.getElementById('pmaAddressStatus').textContent };
  };
  const a = await run('?geoid=0828745&site=39.15887,-108.72898&sl=' + encodeURIComponent('544 Rood Ave, Grand Junction'));
  ok(a.pressed.join('|') === '39.15887, -108.72898', 'with a site, the point should be typed as "lat, lon" and found once (got ' + a.pressed.join('|') + ')');
  ok(/^Site from Market check: 544 Rood Ave, Grand Junction\. Pin dropped at /.test(a.status()), 'the status should name the address Market check sent: ' + a.status());
  ok((await run('?geoid=0828745')).pressed.length === 0, 'with no site, nothing should be typed or found');
  ok((await run('?site=40.71,-74.01')).pressed.length === 0 && (await run('?site=near+the+river')).pressed.length === 0, 'a point outside Colorado, or not a point, should be left alone');
  const b = await run('?site=39.15887,-108.72898', { ready: false });
  ok(b.pressed.length === 0, 'nothing should be found before the page\'s data has loaded');
  b.release(); await new Promise(r => setTimeout(r, 50));
  ok(b.pressed.length === 1 && b.status().startsWith('Pin dropped at '), 'once the data has loaded, the point should be found (no label, no "Site from Market check")');
  // With the market area: once the picker has loaded round the site, Market check's tracts replace its pick, the reason
  // is written, and Run Analysis is pressed once. Without it, the 4-mile pick runs as it stands.
  ok(/readyAt:\s+readyAt,/.test(picker) && /_readyAt = \{ lat: lat, lon: lon \};/.test(picker), 'js/pma-tract-picker.js no longer says where it finished loading (readyAt), which the site link waits on');
  const withPicker = async (query, { count = 5, at = [37.2256, -107.5981] } = {}) => {
    const got = { set: null, why: '', runs: 0 };
    const r = await run(query, { setup: (w) => {
      const d = w.document, btn = d.createElement('button'), ta = d.createElement('textarea');
      btn.id = 'pmaRunBtn'; ta.id = 'pmaTractRationale'; d.body.append(btn, ta);
      btn.addEventListener('click', () => { got.runs++; });
      let n = count;
      w.PMATractPicker = { getCount: () => n, readyAt: () => (at ? { lat: at[0], lon: at[1] } : null),
        setSelection: g => { got.set = g; n = g.length; return g.length; }, getRationale: () => got.why, setRationale: t => { got.why = t; } };
      got.ta = () => ta.value;
    } });
    await new Promise(res => setTimeout(res, 50));
    got.ta = got.ta(); got.w = r.w; return got;
  };
  const c = await withPicker('?site=37.2256,-107.5981&tr=067940600.067940700&tl=' + encodeURIComponent('Local market area'));
  ok(c.set && c.set.join() === '08067940600,08067940700', 'the market area\'s tracts should replace the picker\'s (got ' + c.set + ')');
  // The reason agrees with the market area that came in (its name, its tract count, where it came from) and is the one
  // the site link builds; the box and the picker hold the same text. Its wording is free.
  const L = c.w.MASiteLink;
  ok(L && typeof L.reason === 'function' && c.ta === L.reason('Local market area', c.set.length), 'the reason should be the one the site link builds for this market area: ' + c.ta);
  ok(c.ta.includes('Local market area') && new RegExp('\\b' + c.set.length + '\\b').test(c.ta) && c.ta.includes(L.FROM) && L.FROM === 'Market check', 'the reason should carry the area\'s name, its tract count and where it came from: ' + c.ta);
  ok(c.why === c.ta, 'the rationale box and the picker should hold the same reason');
  ok(c.runs === 1, 'the analysis should run once (ran ' + c.runs + ')');
  const e = await withPicker('?site=37.2256,-107.5981');
  ok(e.set === null && e.runs === 1 && e.ta === '', 'with no market area, the picker\'s own tracts should run unchanged');
  const f = await withPicker('?site=37.2256,-107.5981&tr=12345.abc');
  ok(f.set === null && f.runs === 1, 'tract numbers that are not 9 digits should be ignored');
  // A rural site where nothing could be picked (no centroid within 12 miles): the market area still comes in and runs.
  const g = await withPicker('?site=37.7666,-108.9067&tr=033972100&tl=' + encodeURIComponent('Dove Creek area'), { count: 0, at: [37.7666, -108.9067] });
  ok(g.set && g.set.join() === '08033972100' && g.runs === 1, 'with an empty auto-pick, the market area should still be put in and run (set ' + g.set + ', ran ' + g.runs + ')');
  // Nothing to run on (no market area, nothing picked): Run Analysis is left for the reader.
  const h = await withPicker('?site=37.7666,-108.9067', { count: 0, at: [37.7666, -108.9067] });
  ok(h.runs === 0, 'with no market area and nothing picked, the analysis should not be run (ran ' + h.runs + ')');
  // The picker loaded round another point (or not yet): wait, put nothing in, run nothing.
  const k = await withPicker('?site=37.2256,-107.5981&tr=067940600', { at: [39.7392, -104.9903] });
  ok(k.set === null && k.runs === 0, 'a picker loaded round another point should be waited on, not used');
  const m = await withPicker('?site=37.2256,-107.5981&tr=067940600', { at: null });
  ok(m.set === null && m.runs === 0, 'a picker that has not loaded should be waited on');
  opened.forEach(w => w.close());
}

console.log('market-analysis-hub-page: ' + checks + ' checks passed');
