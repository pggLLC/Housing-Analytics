'use strict';

/**
 * Explanatory diagrams: each one must agree with the thing it explains.
 *
 * Four diagrams draw something the site already states elsewhere, so each is
 * held to that source rather than to its own wording:
 *   1. LIHTC guide, "How tax credits become cash": the worked example's static
 *      figures equal the arithmetic at the Colorado median in
 *      data/market/novogradac-equity-pricing.json, and a missing price gives
 *      no figure rather than $0.
 *   2. Start page route map: every stop is the step WorkflowProgress.stepsFor
 *      returns for that product, with the same label, link and swaps.
 *   3. Recommendation "Your path at a glance": each tile quotes the same
 *      value "What you have recorded" lists for that step, and the result
 *      tile is the headline verdict.
 *   4. Methods "How the overall score is built": every weight in Table 3's
 *      source (data/paper/model-parameters.json) appears in the tree.
 * And none of them is an <svg role="img"> in a .chart-card, which the daily
 * chart-axes audit would fail as a chart with no axes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));

let failures = 0;
let checks = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nExplanatory diagrams agree with what they explain');
console.log('='.repeat(62));

/* 1 ── credits to cash ─────────────────────────────────────────────────── */
const CreditsToCash = require('../js/components/lihtc-credits-to-cash.js');
const pricing = json('data/market/novogradac-equity-pricing.json');
const coMedian = pricing.pricing.by_state.CO.median_all_credits;
const guide = new JSDOM(read('lihtc-guide-for-stakeholders.html')).window.document;

test('credits-to-cash static figures are the arithmetic at the data file\'s Colorado median', () => {
  const ex = CreditsToCash.example(coMedian);
  assert.ok(ex, 'the data file has no Colorado median to check against');
  const text = (id) => {
    const el = guide.getElementById(id);
    assert.ok(el, `#${id} is missing from the guide`);
    return el.textContent.trim();
  };
  assert.strictEqual(text('dgCoPrice'), ex.price);
  assert.strictEqual(text('dgCoEquity'), ex.equity);
  assert.strictEqual(text('dgLowPrice'), ex.lowPrice);
  assert.strictEqual(text('dgLowEquity'), ex.lowEquity);
  assert.strictEqual(text('dgLowDiff'), ex.difference);
  assert.strictEqual(text('dgVintage'), pricing.meta.vintage);
  checks += 6;
});

test('credits-to-cash equity is annual credit × 10 × price, and no price gives no figure', () => {
  const ex = CreditsToCash.example(0.9);
  assert.strictEqual(ex.equity, '$13.50M');
  assert.strictEqual(ex.lowEquity, '$12.75M');
  assert.strictEqual(ex.difference, '$750K');
  for (const bad of [null, undefined, 0, -0.8, NaN, '0.81']) {
    assert.strictEqual(CreditsToCash.example(bad), null, `example(${bad}) produced a figure`);
  }
  checks += 9;
});

test('the guide binds the diagram to the data file and loads the helper first', () => {
  const src = read('lihtc-guide-for-stakeholders.html');
  const helper = src.indexOf('js/components/lihtc-credits-to-cash.js');
  const binder = src.indexOf('LihtcCreditsToCash.example(co.median_all_credits)');
  assert.ok(helper > -1, 'the helper script is not loaded');
  assert.ok(binder > helper, 'the binding does not call the helper with the Colorado median, or runs before it loads');
  checks += 2;
});

/* 2 ── route map ───────────────────────────────────────────────────────── */
const sjHtml = read('select-jurisdiction.html');
function startPage() {
  const dom = new JSDOM('<!doctype html><main><div id="sjRouteMap"></div></main>', {
    url: 'https://cohoanalytics.com/select-jurisdiction.html', runScripts: 'outside-only',
  });
  dom.window.eval(read('js/components/workflow-progress.js'));
  dom.window.eval(read('js/components/guided-route-map.js'));
  return dom.window;
}

test('the route map draws exactly the route WorkflowProgress gives each product', () => {
  const win = startPage();
  const WP = win.WorkflowProgress;
  const mount = win.document.getElementById('sjRouteMap');
  assert.ok(WP.PRODUCTS.length >= 4, 'the product list shrank; the scan would be blind');
  for (const { id, label } of WP.PRODUCTS) {
    assert.strictEqual(win.GuidedRouteMap.render(mount, id), true);
    const route = WP.stepsFor(id);
    const items = Array.from(mount.querySelectorAll('.dg-route > li'));
    assert.strictEqual(items.length, route.length, `${id}: ${items.length} stops for a ${route.length}-step route`);
    route.forEach((step, i) => {
      const li = items[i];
      const link = li.querySelector('.dg-route__label');
      assert.strictEqual(li.dataset.stepKey, step.key);
      assert.strictEqual(li.querySelector('.dg-route__num').textContent, String(step.num));
      assert.strictEqual(link.getAttribute('href'), step.href, `${id} step ${step.num} links elsewhere`);
      assert.ok(link.textContent.endsWith(step.label), `${id} step ${step.num} is called "${link.textContent}", the rail says "${step.label}"`);
      assert.strictEqual(li.dataset.routed === 'true', !!step.routed, `${id} step ${step.num} swap flag disagrees`);
      const also = li.querySelector('.dg-route__also');
      assert.strictEqual(!!also, !!step.companion, `${id} step ${step.num} companion disagrees`);
      if (also) assert.strictEqual(also.getAttribute('href'), step.companion.href);
      checks += 6;
    });
    assert.ok(mount.querySelector('#routeMapTitle').textContent.endsWith(label), `${id}: title does not name "${label}"`);
  }
});

test('every step the rail knows has a plain-language question on the map', () => {
  const win = startPage();
  for (const step of win.WorkflowProgress.STEPS) {
    assert.ok(win.GuidedRouteMap.ANSWERS[step.key], `no question for step "${step.key}"`);
    checks += 1;
  }
  assert.ok(win.GuidedRouteMap.OPTIONAL.opportunity, 'step 2 is no longer marked optional');
  assert.ok(/Step 2[\s\S]{0,200}not required/.test(sjHtml),
    'select-jurisdiction.html no longer says step 2 is not required, but the map still marks it optional');
});

test('the start page mounts the map and redraws it when the product changes', () => {
  assert.ok(sjHtml.includes('<div id="sjRouteMap"></div>'));
  assert.ok(sjHtml.indexOf('js/components/guided-route-map.js') > sjHtml.indexOf('js/components/workflow-progress.js'));
  assert.ok(/function sync\(product\) \{[\s\S]{0,200}GuidedRouteMap\.render\(mapMount, product\)/.test(sjHtml),
    'sync(product) no longer redraws the map');
});

/* 3 ── recommendation path ─────────────────────────────────────────────── */
const Page = require('../js/workflow/recommendation-page.js');
const Contract = require('../js/workflow/recommendation-contract.js');
const digestDir = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');
const digestFile = fs.readdirSync(digestDir).filter((f) => /^08\d+\.json$/.test(f)).sort()[0];
const digest = JSON.parse(fs.readFileSync(path.join(digestDir, digestFile), 'utf8'));
const project = {
  jurisdiction: { completedAt: '2026-10-10T10:00:00Z', name: 'Example', geoType: 'county' },
  hsa: { completedAt: '2026-10-10T10:05:00Z', population: '12,345', costBurden: '49.5%' },
  deal: { completedAt: '2026-10-10T10:20:00Z', dealMode: 'rental',
    outputs: { gap: '$1,600,000', annualCredits: '$1,500,000' } },
};

test('each path tile quotes the value "What you have recorded" lists for that step', () => {
  const contract = Contract.build({ digest, project, generatedAt: 'fixed' });
  const doc = new JSDOM('<!doctype html><div id="m"></div>').window.document;
  const mount = doc.getElementById('m');
  Page.render(mount, contract);
  const tiles = Array.from(mount.querySelectorAll('.rec-path .dg-tile:not(.dg-tile--verdict)'));
  assert.strictEqual(tiles.length, contract.project.length);
  let recorded = 0;
  tiles.forEach((tile) => {
    const key = tile.dataset.pathKey;
    const row = mount.querySelector(`.rec-steps .rec-step[data-step-key="${key}"]`);
    assert.ok(row, `no "What you have recorded" row for ${key}`);
    assert.strictEqual(tile.dataset.status, row.dataset.status, `${key}: tile and record disagree on status`);
    if (row.dataset.status === 'recorded') {
      recorded += 1;
      const firstDd = row.querySelector('.rec-step__fields dd');
      assert.strictEqual(tile.querySelector('.dg-tile__value').textContent, firstDd.textContent,
        `${key}: tile shows a different figure from the record`);
    } else {
      assert.strictEqual(tile.querySelector('a').getAttribute('href'), row.querySelector('a').getAttribute('href'));
    }
    checks += 2;
  });
  assert.strictEqual(recorded, 3, 'the fixture project should record three steps; the scan checked fewer');
  const verdict = mount.querySelector('.rec-path .dg-tile--verdict');
  assert.strictEqual(verdict.querySelector('.dg-tile__value').textContent,
    mount.querySelector('.rec-headline__verdict').textContent, 'the result tile is not the headline verdict');
  assert.strictEqual(verdict.dataset.state, contract.headline.state);
  assert.ok(mount.firstElementChild.classList.contains('rec-headline'), 'the path pushed the verdict off the top');
});

test('with no jurisdiction there is no path strip to invent', () => {
  const contract = Contract.build({ digest: null, project: null, generatedAt: 'fixed' });
  assert.strictEqual(Page.renderPath(contract), '');
});

/* 4 ── score tree ──────────────────────────────────────────────────────── */
const params = json('data/paper/model-parameters.json').ranking;
const methods = new JSDOM(read('methods.html')).window.document;
const tree = methods.querySelector('figure[data-figure-block="ranking-tree"]');
const pct = (w) => `${Math.round(w * 100)}%`;
const PLAIN = {
  gap_pressure_score: 'Housing gap', cost_burden_pressure_score: 'Cost burden',
  affordability_intensity_score: 'Affordability', future_pressure_score: 'Future pressure',
  overcrowding_score: 'Overcrowding', opportunity_mobility_score: 'Economic mobility',
  walkability_score: 'Walkability', amenity_access_score: 'Amenity access', qct_dda_score: 'QCT / DDA status',
};

test('every Table 3 weight appears in the score tree beside its factor', () => {
  assert.ok(tree, 'methods.html has no ranking-tree figure');
  const nodes = Array.from(tree.querySelectorAll('.dg-node strong')).map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  const want = [];
  for (const [k, w] of Object.entries(params.community_need_weights)) want.push(`${PLAIN[k] || k} ${pct(w)}`);
  for (const [k, w] of Object.entries(params.opportunity_weights)) want.push(`${PLAIN[k] || k} ${pct(w)}`);
  want.push(`Community need ${pct(params.axis_weights.community_need)}`);
  want.push(`Opportunity ${pct(params.axis_weights.opportunity)}`);
  assert.ok(want.length >= 11, 'fewer weights than expected; the scan would be blind');
  for (const label of want) {
    assert.ok(nodes.includes(label), `the tree has no "${label}" (it shows: ${nodes.join(' | ')})`);
    checks += 1;
  }
  const text = tree.textContent.replace(/\s+/g, ' ');
  const sw = params.subscore_weights;
  for (const part of [`${pct(sw.gap.count)} unit count and ${pct(sw.gap.rate)} rate`,
    `up to ${pct(sw.commuter.augment_alpha)}`, `home value to income ${pct(sw.affordability.homebuyer)}`]) {
    assert.ok(text.includes(part), `the tree does not say "${part}"`);
    checks += 1;
  }
});

/* ── none of them is a chart the axes audit would fail ─────────────────── */
test('no diagram is an svg[role=img] inside .chart-card', () => {
  const pages = {
    'lihtc-guide-for-stakeholders.html': guide,
    'methods.html': methods,
    'select-jurisdiction.html': new JSDOM(sjHtml).window.document,
  };
  for (const [file, doc] of Object.entries(pages)) {
    const figs = doc.querySelectorAll('figure.diagram, #sjRouteMap');
    assert.ok(figs.length > 0, `${file}: no diagram found; the scan is blind`);
    figs.forEach((fig) => {
      assert.strictEqual(fig.querySelectorAll('svg[role="img"], svg[data-chart]').length, 0,
        `${file}: a diagram carries an SVG the chart-axes audit would treat as a chart`);
      checks += 1;
    });
  }
});

console.log(`\n${checks} checks`);
if (failures) {
  console.log(`${failures} failed\n`);
  process.exit(1);
}
console.log('all passed\n');
