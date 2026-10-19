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
const pending = [];
function test(name, fn) {
  const fail = (e) => { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pending.push(r.then(() => console.log('  ✓ ' + name), fail)); return; }
    console.log('  ✓ ' + name);
  } catch (e) { fail(e); }
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
// methods.html is generated: a PR commits only the empty placeholder and CI
// fills it. So the tree is built here, into a copy, by the same injector.
function builtTree() {
  const os = require('os');
  const { execFileSync } = require('child_process');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'methods-')), 'methods.html');
  fs.copyFileSync(path.join(ROOT, 'methods.html'), tmp);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/paper/inject-paper-figures.mjs')],
    { env: Object.assign({}, process.env, { PAPER_PAGE: tmp }), stdio: 'pipe' });
  const doc = new JSDOM(fs.readFileSync(tmp, 'utf8')).window.document;
  return doc.querySelector('figure[data-figure-block="ranking-tree"]');
}
const pct = (w) => `${Math.round(w * 100)}%`;

test('methods.html keeps the score-tree placeholder the injector fills', () => {
  assert.ok(methods.querySelector('figure.diagram[data-figure-block="ranking-tree"]'),
    'methods.html has no ranking-tree placeholder');
});

test('every Table 3 weight appears in the score tree on its own factor', () => {
  const tree = builtTree();
  assert.ok(tree, 'the injector left no ranking-tree figure');
  const want = Object.assign({}, params.community_need_weights, params.opportunity_weights, params.axis_weights);
  assert.ok(Object.keys(want).length >= 11, 'fewer weights than expected; the scan would be blind');
  for (const [k, w] of Object.entries(want)) {
    const node = tree.querySelector(`.dg-node[data-factor="${k}"] .dg-weight`);
    assert.ok(node, `the tree has no node for "${k}"`);
    assert.strictEqual(node.textContent.trim(), pct(w), `"${k}" shows ${node.textContent.trim()}, Table 3 says ${pct(w)}`);
    checks += 1;
  }
  const keyed = tree.querySelectorAll('.dg-node[data-factor]').length;
  assert.strictEqual(keyed, Object.keys(want).length, 'the tree draws a factor Table 3 does not list');
  const text = tree.textContent.replace(/\s+/g, ' ');
  const sw = params.subscore_weights;
  for (const part of [pct(sw.gap.count), pct(sw.gap.rate), pct(sw.commuter.augment_alpha),
    pct(sw.cost_burden.severe), pct(sw.future.units)]) {
    assert.ok(text.includes(part), `the tree does not carry the sub-weight ${part}`);
    checks += 1;
  }
});

/* 5 ── residual land value ─────────────────────────────────────────────── */
const landDoc = new JSDOM(read('land-value.html')).window.document;
const money1 = (n) => '$' + n.toFixed(1) + 'M';
test('residual diagram: parts add to each bar, residual is sources minus costs, widths follow one scale', () => {
  const fig = landDoc.getElementById('residualDiagram');
  assert.ok(fig, 'land-value.html has no #residualDiagram');
  const scale = Number(fig.getAttribute('data-scale'));
  const stacks = fig.querySelectorAll('.dg-stack');
  assert.strictEqual(stacks.length, 2);
  const totals = [...stacks].map((st) => {
    const total = Number(st.getAttribute('data-total'));
    const parts = [...st.querySelectorAll('.dg-stack__key li')].map((li) => Number(li.getAttribute('data-part')));
    assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - total) < 1e-9, `parts ${parts} do not add to ${total}`);
    assert.ok(st.querySelector('.dg-stack__label').textContent.includes(money1(total)), `the bar label does not print ${money1(total)}`);
    st.querySelectorAll('.dg-stack__key li').forEach((li) => assert.ok(li.textContent.includes(money1(Number(li.getAttribute('data-part'))))));
    const segs = [...st.querySelectorAll('.dg-stack__bar .dg-seg:not(.dg-seg--residual)')].map((x) => parseFloat(x.style.width));
    parts.forEach((pt, i) => assert.ok(Math.abs(segs[i] - pt / scale * 100) < 0.1, `segment ${i} is ${segs[i]}%, ${pt} of ${scale} is ${(pt / scale * 100).toFixed(1)}%`));
    checks += 3 + parts.length * 2;
    return total;
  });
  const residual = totals[0] - totals[1];
  const ask = Number(landDoc.getElementById('dgAsk').textContent.replace(/[^0-9.]/g, ''));
  assert.strictEqual(landDoc.getElementById('dgResidual').textContent, money1(residual));
  assert.strictEqual(landDoc.getElementById('dgShort').textContent, money1(ask - residual));
  assert.ok(Math.abs(scale - (totals[1] + ask)) < 1e-9, 'the scale is cost plus the asking price');
  const res = parseFloat(fig.querySelector('.dg-seg--residual').style.width);
  assert.ok(Math.abs(res - residual / scale * 100) < 0.1, 'the residual segment is drawn to scale');
  const box = fig.querySelector('.dg-askbox').style;
  assert.ok(Math.abs(parseFloat(box.left) - totals[1] / scale * 100) < 0.1 && Math.abs(parseFloat(box.width) - ask / scale * 100) < 0.1, 'the asking-price box starts where costs end');
  assert.ok(/Example numbers, not a real deal/.test(fig.textContent), 'the example says it is an example');
  checks += 6;
});

/* 6 ── 4% or 9% ─────────────────────────────────────────────────────────── */
test('credit path tree quotes the 4% vs 9% table it sits above', () => {
  const tree = guide.getElementById('creditPathDiagram');
  assert.ok(tree, 'the guide has no #creditPathDiagram');
  const table = tree.parentElement.querySelector('.table-wrap table').textContent.replace(/\s+/g, ' ');
  for (const k of ['awards', 'value4', 'value9']) {
    const v = tree.querySelector(`[data-dg="${k}"]`).textContent.trim();
    const want = k === 'awards' ? v : v.replace('/yr', '');
    assert.ok(table.includes(want), `the table does not carry "${want}"`);
    checks += 1;
  }
});

/* 7 ── building types ───────────────────────────────────────────────────── */
const hnaDocs = ['housing-needs-assessment.html', 'hna-what-to-do.html'].map((f) => [f, new JSDOM(read(f)).window.document]);
test('building types: each range bar is drawn from its printed range on one 0-70 scale', () => {
  for (const [f, doc] of hnaDocs) {
    const fig = doc.getElementById('buildingTypesDiagram');
    assert.ok(fig, `${f} has no #buildingTypesDiagram`);
    const rows = fig.querySelectorAll('.dg-btype');
    assert.strictEqual(rows.length, 4);
    rows.forEach((li) => {
      const lo = Number(li.dataset.min), hi = Number(li.dataset.max);
      assert.ok(li.textContent.includes(`${lo}\u2013${hi} homes per acre`), `${li.dataset.type}: printed range is not ${lo}-${hi}`);
      const fill = li.querySelector('.dg-range__fill').style;
      assert.ok(Math.abs(parseFloat(fill.left) - lo / 70 * 100) < 0.1 && Math.abs(parseFloat(fill.width) - (hi - lo) / 70 * 100) < 0.1, `${li.dataset.type}: bar is not ${lo}-${hi}`);
      const marks = [...li.querySelectorAll('.dg-range__mark')].map((m) => parseFloat(m.style.left));
      assert.deepStrictEqual(marks.map((m) => Math.round(m / 100 * 70)), [15, 40], 'the Colorado marks sit at 15 and 40');
      checks += 3;
    });
    assert.ok(/15 homes per acre/.test(fig.textContent) && /40 homes per acre/.test(fig.textContent) && /HB24-1313/.test(fig.textContent));
    assert.ok(fig.querySelector('a[href="https://missingmiddlehousing.com/types"]'), 'the ranges name their source');
    assert.strictEqual(fig.querySelectorAll('svg[role="img"]').length, 0, 'the drawings are decoration, not charts');
    checks += 3;
  }
});

/* ── 6b. the 9% round counts come from the applicant and award reports ─── */
const RoundOdds = require('../js/components/chfa-round-odds.js');
const oddsData = [json(RoundOdds.APPLICATIONS), json(RoundOdds.LEDGER)];

test('the printed 9% round counts are the latest three years in the data files', () => {
  const want = RoundOdds.phrase(RoundOdds.rounds(oddsData[0], oddsData[1], 3));
  const spans = guide.querySelectorAll('[data-dg="awards"]');
  assert.strictEqual(spans.length, 2, 'the tree and the table each carry the counts');
  spans.forEach((sp) => assert.strictEqual(sp.textContent.trim(), want,
    'printed counts drifted from the data files; run the page and copy what it shows'));
  checks += 2;
});

test('"roughly half funded" is still true of every year shown', () => {
  RoundOdds.rounds(oddsData[0], oddsData[1], 3).forEach((r) => {
    const share = r.awarded / r.applied;
    assert.ok(share >= 0.35 && share <= 0.65, `${r.year}: ${r.awarded} of ${r.applied} is not roughly half`);
    checks += 1;
  });
});

test('a year without both reports is left out, and the page fills from the files', async () => {
  const apps = { meta: { documents: [{ round_label: '2030 Round One', credit_type: '9%', status: 'ok', rows: 20 },
    { round_label: '2031 Round One', credit_type: '9%', status: 'mismatch', rows: 30 }] } };
  const ledger = { awards: [{ agency: 'CHFA', federal_credit_type: '9%', year: 2030 }, { agency: 'CHFA', federal_credit_type: '9%', year: 2031 }] };
  assert.strictEqual(RoundOdds.phrase(RoundOdds.rounds(apps, ledger, 3)), '1 of 20 in 2030');
  const doc = new JSDOM(read('lihtc-guide-for-stakeholders.html')).window.document;
  global.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u === RoundOdds.LEDGER ? ledger : apps) });
  try { await RoundOdds.fill(doc); } finally { delete global.fetch; }
  doc.querySelectorAll('[data-dg="awards"]').forEach((sp) => assert.strictEqual(sp.textContent, '1 of 20 in 2030'));
  checks += 2;
});

test('every building-type photo is on disk and credits its author and license', () => {
  for (const [file, doc] of hnaDocs) {
    const figs = doc.querySelectorAll('#buildingTypesDiagram .dg-btype__photo');
    assert.strictEqual(figs.length, 4, `${file}: one photo per building type`);
    figs.forEach((fig) => {
      const img = fig.querySelector('img');
      assert.ok(fs.existsSync(path.join(ROOT, img.getAttribute('src'))), `${file}: ${img.getAttribute('src')} is missing`);
      assert.ok(img.getAttribute('alt').length > 20, `${file}: photo needs a description`);
      const links = [...fig.querySelectorAll('figcaption a')].map((a) => a.getAttribute('href'));
      assert.ok(links.some((h) => h.startsWith('https://commons.wikimedia.org/wiki/File:')), `${file}: no link to the photo's file page`);
      assert.ok(links.some((h) => /^https:\/\/creativecommons\.org\/licenses\//.test(h)), `${file}: no license link`);
      checks += 4;
    });
  }
});

/* ── 8. Deal Calculator capital stack and waterfall ladder ──────────────── */
const DealDiagrams = require('../js/components/deal-diagrams.js');
const deal = (o) => Object.assign({ tdc: 20e6, mortgage: 3e6, creditStack: { federal: 12e6, state: 1e6, added: 0, counted: false },
  totalSoftSourceAmt: 1.5e6, deferredDevFee: 0.5e6, gap: 2e6, unavailable: {} }, o);

test('the capital stack pieces are the Sources & Uses figures and fill the cost exactly', () => {
  const m = DealDiagrams.stackModel(deal());
  assert.deepStrictEqual(m.segments.map((s) => s.label),
    ['First mortgage', 'Federal credit equity', 'State credit equity', 'Soft funding', 'Deferred developer fee', 'Gap still to fill']);
  assert.deepStrictEqual(m.segments.map((s) => s.amount), [3e6, 12e6, 1e6, 1.5e6, 0.5e6, 2e6]);
  const total = m.segments.reduce((a, s) => a + s.width, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `widths add to ${total}, not the whole bar`);
  assert.strictEqual(m.segments[5].gap, true);
  assert.ok(DealDiagrams.renderStack(m).includes('gap of $2.00M, 10% of the cost'));
  checks += 4;
});

test('an unknown mortgage is unavailable with its reason, never $0', () => {
  const m = DealDiagrams.stackModel(deal({ mortgage: NaN, gap: NaN, unavailable: { mortgage: 'Rents are missing.', gap: 'Rents are missing.' } }));
  assert.ok(!m.segments.some((s) => s.label === 'First mortgage'), 'an unknown mortgage is drawn');
  const rest = m.segments.find((s) => s.unknown);
  assert.ok(rest && Math.abs(rest.amount - 5e6) < 1e-6, 'the uncovered cost is shown as not yet known');
  const html = DealDiagrams.renderStack(m);
  assert.ok(html.includes('First mortgage: unavailable. Rents are missing.'));
  assert.ok(!/First mortgage <strong>\$0/.test(html));
  assert.ok(html.includes('The gap cannot be worked out yet.'));
  checks += 5;
});

test('a surplus runs past the cost line instead of drawing a gap', () => {
  const m = DealDiagrams.stackModel(deal({ gap: -1e6, mortgage: 6e6 }));
  assert.ok(!m.segments.some((s) => s.gap));
  assert.ok(m.costLine < 1 && Math.abs(m.costLine - 20 / 21) < 1e-9);
  assert.ok(DealDiagrams.renderStack(m).includes('run $1.00M past the cost'));
  assert.strictEqual(DealDiagrams.stackModel(deal({ tdc: 0 })).unavailable, 'Total development cost is missing.');
  checks += 4;
});

test('each ladder step starts where the one above it ended', () => {
  const wf = { grossProceeds: 10e6, tiers: [
    { name: '1. Hard debt payoff (1st mortgage)', amount: 4e6, recipient: 'Lender' },
    { name: '2. Soft debt payoff (priority order)', amount: 0, recipient: 'Soft lenders' },
    { name: '3. Deferred developer fee', amount: 1e6, recipient: 'Developer (GP)' },
    { name: '4a. LP return of capital', amount: 5e6, recipient: 'LP investor' },
    { name: '4b. LP preferred return', amount: 0, recipient: 'LP investor' }] };
  const m = DealDiagrams.ladderModel(wf);
  assert.deepStrictEqual(m.steps.map((s) => s.left), [0, 0.4, 0.4, 0.5, 1]);
  assert.deepStrictEqual(m.steps.map((s) => s.width), [0.4, 0, 0.1, 0.5, 0]);
  assert.deepStrictEqual(m.steps.map((s) => s.empty), [null, 'None owed', null, null, 'Nothing left']);
  assert.strictEqual(DealDiagrams.ladderModel(null), null);
  checks += 4;
});

test('the Deal Calculator loads the diagrams before the calculator publishes a result', () => {
  const html = read('deal-calculator.html');
  const at = html.indexOf('js/components/deal-diagrams.js'), calc = html.indexOf('src="js/deal-calculator.js"');
  assert.ok(at > 0 && at < calc);
  checks += 1;
});

/* ── none of them is a chart the axes audit would fail ─────────────────── */
test('no diagram is an svg[role=img] inside .chart-card', () => {
  const pages = {
    'lihtc-guide-for-stakeholders.html': guide,
    'methods.html': methods,
    'select-jurisdiction.html': new JSDOM(sjHtml).window.document,
    'land-value.html': landDoc,
    'hna-what-to-do.html': hnaDocs[1][1],
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

Promise.all(pending).then(() => {
  console.log(`\n${checks} checks`);
  if (failures) {
    console.log(`${failures} failed\n`);
    process.exit(1);
  }
  console.log('all passed\n');
});
