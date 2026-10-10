'use strict';

/**
 * The guided path follows the product being planned (docs/DEVELOPER-TRACKS.md).
 *
 * For-sale ownership swaps the three rental-only slots (Opportunity Finder,
 * Market Analysis, Scenario Builder) for the ownership tools. Held here:
 *   1. With no product chosen the route is exactly the LIHTC route (STEPS), so
 *      nothing changes for anyone who never picks.
 *   2. Routing changes where a slot leads and what it is called, never its
 *      number or key, so completion and saved projects keep working.
 *   3. Agreement, not copy: every routed slot names a page that exists, with an
 *      anchor that exists, and its label is how the site nav names that page.
 *   4. The hard-coded rails in the pages follow the choice, except the slot
 *      for the page the reader is on.
 *   5. The next-step banner reads the same route as the rail.
 *   6. The chooser offers exactly the products the rail knows.
 *   7. Rental and for-sale keeps the LIHTC route and lists, for each slot the
 *      for-sale route reroutes, that same for-sale page beside it: on the
 *      rail, in the banner, and nowhere for the other products.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const railSrc = read('js/components/workflow-progress.js');
const bannerSrc = read('js/components/workflow-next-action.js');

function page(file, html) {
  const dom = new JSDOM(html || read(file), {
    url: 'https://cohoanalytics.com/' + file,
    runScripts: 'outside-only',
  });
  dom.window.eval(railSrc);
  return dom.window;
}

let failures = 0;
let bannerCheck = null;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nGuided path: product routes');
console.log('='.repeat(62));

test('no product chosen: the route is the LIHTC route', () => {
  const WP = page('index.html', '<!doctype html><main></main>').WorkflowProgress;
  assert.strictEqual(WP.getProduct(), null);
  assert.deepStrictEqual(WP.routeSteps().map((s) => [s.num, s.key, s.label, s.href]),
    WP.STEPS.map((s) => [s.num, s.key, s.label, s.href]));
  assert.deepStrictEqual(WP.stepsFor('middle-income-rental').map((s) => s.href), WP.STEPS.map((s) => s.href),
    'middle-income rental walks the LIHTC route');
});

test('for-sale reroutes slots 2, 4, 5 and 6 and keeps numbers and keys', () => {
  const win = page('index.html', '<!doctype html><main></main>');
  const WP = win.WorkflowProgress;
  assert.strictEqual(WP.setProduct('for-sale'), true);
  assert.strictEqual(WP.getProduct(), 'for-sale');
  const route = WP.routeSteps();
  assert.deepStrictEqual(Array.from(route, (s) => [s.num, s.key]), Array.from(WP.STEPS, (s) => [s.num, s.key]));
  assert.deepStrictEqual(Array.from(route.filter((s) => s.routed), (s) => s.num), [2, 4, 5, 6]);
  assert.strictEqual(WP.setProduct('condo-hotel'), false, 'an unknown product is refused');
  assert.strictEqual(WP.getProduct(), 'for-sale');
});

test('every routed slot opens a page and anchor that exist, named as the nav names it', () => {
  const WP = page('index.html', '<!doctype html><main></main>').WorkflowProgress;
  const nav = read('js/navigation.js');
  const navItems = [...nav.matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)].map((m) => ({ label: m[1], href: m[2] }));
  const routed = WP.stepsFor('for-sale').filter((s) => s.routed);
  assert(routed.length >= 3, 'scan found the routed slots');
  routed.forEach((s) => {
    const [target, anchor] = s.href.split('#');
    const file = target.split('?')[0];
    assert(fs.existsSync(path.join(ROOT, file)), s.href + ': page exists');
    if (anchor) assert(read(file).includes('id="' + anchor + '"'), s.href + ': anchor exists');
    // An exact link first: the nav links the calculator twice, once per mode.
    const navItem = navItems.find((n) => n.href === s.href)
      || navItems.find((n) => (anchor && n.href.endsWith('#' + anchor)) || (!anchor && n.href === file));
    assert(navItem, s.href + ': the nav links this page');
    assert(navItem.label.startsWith(s.label), 'rail "' + s.label + '" vs nav "' + navItem.label + '"');
  });
});

test('hard-coded rails follow the choice, except the page the reader is on', () => {
  const win = page('hna-what-to-do.html');
  const WP = win.WorkflowProgress;
  const doc = win.document;
  const label = (n) => doc.querySelector('#hnaWorkflowProgress .wf-step[data-step="' + n + '"] .wf-step__label').textContent.trim();
  const href = (n) => doc.querySelector('#hnaWorkflowProgress .wf-step[data-step="' + n + '"]').getAttribute('href');
  assert.strictEqual(label(4), 'Market Analysis', 'fixture: rental rail before any choice');
  WP.setProduct('for-sale');
  assert.strictEqual(label(4), 'For-Sale Market Study');
  assert.strictEqual(href(4), 'for-sale-market-study.html');
  assert.strictEqual(label(5), 'Land Value');
  assert.strictEqual(label(3), 'Needs Assessment', 'the active slot is left alone');
  WP.setProduct('lihtc-rental');
  assert.strictEqual(label(4), 'Market Analysis', 'switching back restores the rental route');
  assert.strictEqual(href(4), 'market-analysis.html');
});

test('the next-step banner reads the same route as the rail', () => {
  const win = page('hna-what-to-do.html', '<!doctype html><main><section class="hero"><h1>x</h1></section></main>');
  win.WorkflowState = { getProgress: () => ({ completedSteps: ['jurisdiction', 'hsa'] }) };
  win.WorkflowProgress.setProduct('for-sale');
  win.eval(bannerSrc);
  const steps = win.WorkflowNextAction.steps();
  assert.deepStrictEqual(steps.keys.map((k) => steps.urls[k]), win.WorkflowProgress.routeSteps().map((s) => s.href));
  win.WorkflowNextAction.render();
  const cta = win.document.querySelector('#workflowNextAction .wf-next-action__cta');
  assert(cta, 'banner renders a forward link');
  assert.strictEqual(cta.getAttribute('href'), 'for-sale-market-study.html');
  assert.match(cta.textContent, /For-Sale Market Study/);
});

test('the chooser offers exactly the products the rail knows', () => {
  const WP = page('index.html', '<!doctype html><main></main>').WorkflowProgress;
  const html = read('select-jurisdiction.html');
  const offered = [...html.matchAll(/name="sjProduct" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(offered.sort(), Array.from(WP.PRODUCTS, (p) => p.id).sort());
});

test('rental and for-sale keeps the LIHTC route and adds the for-sale pages beside it', () => {
  const WP = page('index.html', '<!doctype html><main></main>').WorkflowProgress;
  const mixed = WP.stepsFor('mixed');
  const forSale = WP.stepsFor('for-sale');
  assert.deepStrictEqual(Array.from(mixed, (s) => [s.num, s.key, s.label, s.href]),
    Array.from(WP.STEPS, (s) => [s.num, s.key, s.label, s.href]), 'the rental pages stay');
  const withCompanion = mixed.filter((s) => s.companion);
  assert.strictEqual(withCompanion.length, forSale.filter((s) => s.routed).length, 'scan found the companions');
  withCompanion.forEach((s) => {
    const f = forSale.find((x) => x.num === s.num);
    assert(f.routed, 'step ' + s.num + ' has a companion only where for-sale reroutes');
    assert.deepStrictEqual([s.companion.label, s.companion.href], [f.label, f.href], 'step ' + s.num);
  });
  ['lihtc-rental', 'middle-income-rental', 'for-sale'].forEach((p) =>
    assert(!WP.stepsFor(p).some((s) => s.companion), p + ' has no companions'));
});

test('the rail lists the companions only while rental and for-sale is chosen', () => {
  const win = page('hna-what-to-do.html');
  const WP = win.WorkflowProgress;
  const line = () => win.document.querySelector('#hnaWorkflowProgress .wf-companions');
  assert.strictEqual(line(), null, 'fixture: no line before any choice');
  WP.setProduct('mixed');
  assert(line(), 'line appears');
  const hrefs = Array.from(line().querySelectorAll('a'), (a) => a.getAttribute('href'));
  assert.deepStrictEqual(hrefs, Array.from(WP.routeSteps().filter((s) => s.companion), (s) => s.companion.href));
  assert.strictEqual(win.document.querySelector('#hnaWorkflowProgress .wf-step[data-step="4"] .wf-step__label').textContent.trim(),
    'Market Analysis', 'step 4 still opens the rental page');
  WP.setProduct('mixed');
  assert.strictEqual(win.document.querySelectorAll('#hnaWorkflowProgress .wf-companions').length, 1, 'not duplicated');
  WP.setProduct('lihtc-rental');
  assert.strictEqual(line(), null, 'line goes away');
});

test('the banner names the for-sale page beside the rental one', () => {
  const html = '<!doctype html><main><section class="hero"><h1>x</h1></section></main>';
  const make = (file) => {
    const win = page(file, html);
    win.WorkflowState = { getProgress: () => ({ completedSteps: ['jurisdiction', 'hsa'] }) };
    win.WorkflowProgress.setProduct('mixed');
    win.eval(bannerSrc);
    win.WorkflowNextAction.render();
    return win.document.querySelector('#workflowNextAction');
  };
  const study = WP0().stepsFor('mixed').find((s) => s.key === 'market');
  const onRental = make('market-analysis.html');
  assert(onRental.querySelector('a[href="' + study.companion.href + '"]'), 'rental page links the for-sale study');
  const onStudy = make(study.companion.href);
  assert.match(onStudy.textContent, /Step 4 of 7/, 'the study page is step 4');
  assert(onStudy.querySelector('a[href="' + study.href + '"]'), 'study page links back to the rental page');
});

test('loading a saved project applies that project\'s route', () => {
  const dom = new JSDOM(read('hna-what-to-do.html'), { url: 'https://cohoanalytics.com/hna-what-to-do.html', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(read('js/workflow-state-core.js'));
  win.eval(read('js/workflow-state-api.js'));
  win.eval(railSrc);
  const WS = win.WorkflowState;
  const WP = win.WorkflowProgress;
  const label4 = () => win.document.querySelector('#hnaWorkflowProgress .wf-step[data-step="4"] .wf-step__label').textContent.trim();
  const rental = WS.newProject('Rental');
  WP.setProduct('lihtc-rental');
  const forSale = WS.newProject('For-sale');
  WP.setProduct('for-sale');
  assert.strictEqual(label4(), 'For-Sale Market Study', 'fixture: the for-sale project is active');
  WS.loadProject(rental);
  assert.strictEqual(WP.getProduct(), 'lihtc-rental', 'fixture: the loaded project carries its product');
  assert.strictEqual(label4(), 'Market Analysis', 'the rail follows the loaded project');
  WS.loadProject(forSale);
  assert.strictEqual(label4(), 'For-Sale Market Study');
  bannerCheck = { win, WS, rental, forSale };
});

// The banner wires its listeners on a deferred init, so this half waits a tick.
const pending = new Promise((resolve) => {
  if (!bannerCheck) return resolve();
  const { win, WS, rental, forSale } = bannerCheck;
  WS.loadProject(rental);
  win.eval(bannerSrc);
  setTimeout(() => {
    test('loading a saved project resets the banner\'s route', () => {
      assert.strictEqual(win.WorkflowNextAction.steps().urls.market, 'market-analysis.html', 'fixture: rental project');
      WS.loadProject(forSale);
      assert.strictEqual(win.WorkflowNextAction.steps().urls.market, 'for-sale-market-study.html', 'the banner drops its cached route');
    });
    resolve();
  }, 0);
});

test('the ownership link opens the calculator in ownership mode', () => {
  const WP = WP0();
  const deal = WP.stepsFor('for-sale').find((s) => s.key === 'deal');
  // The nav item that opens it is the one whose label the rail uses.
  const nav = [...read('js/navigation.js').matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
    .filter((m) => m[1] === deal.label).map((m) => m[2]);
  assert.deepStrictEqual(nav, [deal.href], 'the nav item and the route open the same link');
  const url = new URL(deal.href, 'https://cohoanalytics.com/');
  const src = read('js/deal-calculator.js');
  const fn = src.match(/function applyModeFromUrl\(\) \{[\s\S]*?\n  \}\n/);
  assert(fn, 'calculator reads its mode from the URL');
  const mode = (search) => {
    const dom = new JSDOM('<input type="radio" name="dc-deal-mode" id="dc-mode-rental" value="rental" checked>'
      + '<input type="radio" name="dc-deal-mode" id="dc-mode-ownership" value="ownership">',
      { url: 'https://cohoanalytics.com/deal-calculator.html' + search, runScripts: 'outside-only' });
    let changed = 0;
    dom.window.document.getElementById('dc-mode-ownership').addEventListener('change', () => { changed += 1; });
    dom.window.eval(fn[0] + '; applyModeFromUrl();');
    return [dom.window.document.querySelector('input[name="dc-deal-mode"]:checked').value, changed];
  };
  assert.deepStrictEqual(mode(url.search), ['ownership', 1], 'the link opens ownership mode and the calculator hears it');
  assert.deepStrictEqual(mode(''), ['rental', 0], 'no parameter keeps rental');
  assert.deepStrictEqual(mode('?mode=condo'), ['rental', 0], 'an unknown mode keeps rental');
});

function WP0() { return page('index.html', '<!doctype html><main></main>').WorkflowProgress; }

pending.then(() => {
  if (failures) { console.log('\n' + failures + ' failed'); process.exit(1); }
  console.log('\nAll product-route checks passed');
});
