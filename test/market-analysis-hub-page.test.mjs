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
 *  6. the header and footer are the hub pages' own, and the visit is counted once;
 *  7. the place the visitor is working on and the saved projects, which the old header's pill showed, are in a row
 *     above the page (js/components/ma-place-row.js), reading and doing what the pill does;
 *  8. the bridging sheet's rules point at markup the tool still draws: every id it names exists, and the built-in
 *     calculator's phone rules find the inline layouts they were written against;
 *  9. every menu, step bar, next step and profile link opens the new page, and the scripts that recognise the
 *     Market Analysis link by its file name (carrying the place, saving before leaving) recognise the new name.
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
const GONE = new Set(['site-footer']); // the old footer's empty slot; the new footer stands in its place
const missing = [...oldIds].filter(id => !newIds.has(id) && !GONE.has(id));
ok(missing.length === 0, 'ids on market-analysis.html that the new page lacks: ' + missing.join(', '));
ok(oldIds.size > 200, 'market-analysis.html has far fewer ids than expected (' + oldIds.size + '); has the page changed shape?');

// 4. The same scripts, in order.
const scripts = html => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
const DROPPED = ['js/navigation.js', 'js/dark-mode-toggle.js', 'js/mobile-menu.js'];
const ADDED = ['js/components/ma-place-row.js', 'hub/lab-config.js', 'hub/page-chrome.js', 'hub/nav.js'];
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
ok(/<script type="module">[^<]*dispatchEvent\(new CustomEvent\('nav:rendered'\)\)/.test(newPage), 'the new page does not announce nav:rendered (js/navigation.js used to; the Watchlist listens for it)');
ok(/<link rel="icon" href="favicon\.svg"/.test(newPage) && fs.existsSync(path.join(root, 'favicon.svg')), 'the new page has no favicon (js/navigation.js used to add it)');
// The next-step card finds the page's step by file name: an alias, or the page its step list sends that step to.
{
  const wna = read('js/components/workflow-next-action.js');
  const knows = f => new RegExp("'" + f.replace(/[.-]/g, '\\$&') + "':\\s*'market'|key: 'market',[^}]*href: '" + f.replace(/[.-]/g, '\\$&') + "'").test(wna);
  ok(knows('deal-market-analysis.html') && knows('market-analysis.html'), 'js/components/workflow-next-action.js does not know both Market Analysis pages are step 4');
}
assert.deepEqual(newInline, inline(oldPage), 'an inline script differs between the two pages');
checks++;

// 5. The seven-step bar is carried whole: js/components/workflow-progress.js ticks its finished steps and puts the
//    chosen place on its links, so it stays the old page's own markup.
const barOf = html => (/<div class="wf-progress-wrap" id="maWorkflowProgress">[\s\S]*?\n  <\/div>\n/.exec(html) || [''])[0];
ok(barOf(oldPage).length > 0, 'market-analysis.html no longer has the seven-step bar');
ok(barOf(newPage) === barOf(oldPage), 'the seven-step bar on the new page differs from market-analysis.html\'s');
ok([...barOf(newPage).matchAll(/href="([^"]+)"/g)].length === 6, 'the step bar should link six other steps');
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
ok(newScripts.indexOf('js/components/ma-place-row.js') === newScripts.length - 4, 'the place row\'s script must load after the tool\'s own scripts and before the new header\'s');
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

console.log('market-analysis-hub-page: ' + checks + ' checks passed');
