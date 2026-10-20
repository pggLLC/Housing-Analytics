'use strict';
// Walkthrough 2026-10-20 (R1, R4), approved by paul.
// 1. The end-of-page "Next" block is not pinned to the screen, and the step it
//    names is the next step on the canonical 1-7 path (workflow-next-action.js
//    FALLBACK_STEPS), so the two cannot drift apart.
// 2. A town opened in the Deal Calculator says why the header shows its county.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const cta = read('js/components/next-action-cta.js');
assert(!/position:\s*(sticky|fixed)/.test(cta), 'the Next block is not pinned to the screen');

// The canonical route and its product variants come from workflow-progress.js.
const wpSrc = read('js/components/workflow-progress.js');
function routeFor(product) {
  const dom = new JSDOM('<!doctype html><main></main>', { runScripts: 'outside-only', url: 'http://127.0.0.1/' });
  if (product) dom.window.localStorage.setItem('coho:guided-product', product);
  dom.window.eval(wpSrc);
  return { dom, route: dom.window.WorkflowProgress.routeSteps() };
}

function renderNext(win, fromPage, jurisdiction) {
  win.eval(cta);
  const html = win.NextActionCTA.render({ fromPage, jurisdiction });
  const doc = new JSDOM(html).window.document;
  const next = doc.querySelectorAll('.naca-next');
  assert.equal(next.length, 1, `${fromPage}: exactly one primary next action`);
  const m = /^Next: Step (\d+), (.+?) →$/.exec(next[0].textContent.trim());
  assert(m, `${fromPage}: the link reads "Next: Step N, Label →", got "${next[0].textContent}"`);
  return { num: Number(m[1]), label: m[2], href: next[0].getAttribute('href') };
}

const SLOT = { of: 2, hna: 3, pma: 4, deal: 6 };
let routedChecked = 0;
for (const product of [null, 'for-sale']) {
  for (const [fromPage, slot] of Object.entries(SLOT)) {
    const { dom, route } = routeFor(product);
    const want = route.find((st) => st.num === slot + 1);
    const got = renderNext(dom.window, fromPage, null);
    assert.equal(got.num, want.num, `${product || 'rental'} ${fromPage}: step number follows the route`);
    assert.equal(got.label, want.label, `${product || 'rental'} ${fromPage}: label follows the route`);
    assert.equal(got.href, want.href, `${product || 'rental'} ${fromPage}: link follows the route`);
    if (want.routed) routedChecked++;
  }
}
assert(routedChecked > 0, 'fixture: the for-sale route replaces at least one next step');

// Without workflow-progress.js on the page, the fallback is the canonical route.
const canon = routeFor(null).route;
for (const [fromPage, slot] of Object.entries(SLOT)) {
  const dom = new JSDOM('<!doctype html><main></main>', { runScripts: 'outside-only' });
  const got = renderNext(dom.window, fromPage, null);
  const want = canon.find((st) => st.num === slot + 1);
  assert.deepEqual([got.num, got.label, got.href], [want.num, want.label, want.href], `${fromPage}: fallback mirrors workflow-progress.js STEPS`);
}

// The link is rebuilt whenever the route can change: a product pick or a
// project switch (which fires only workflow:project-loaded).
for (const ev of ['workflow:product-changed', 'workflow:project-loaded']) {
  assert(cta.includes(`addEventListener('${ev}', _autoMount)`), `the Next link remounts on ${ev}`);
}

// The place travels in the form each page reads.
{
  const jx = { fips: '0862880', geoType: 'place' };
  const pma = renderNext(routeFor(null).dom.window, 'pma', jx);
  assert.equal(pma.href, 'hna-scenario-builder.html?geoType=place&geoid=0862880&auto=1', 'Scenario Builder gets geoid/geoType/auto');
  const hna = renderNext(routeFor(null).dom.window, 'hna', jx);
  assert.equal(hna.href, 'market-analysis.html?fips=0862880&geoType=place&auto=1', 'Market Analysis gets fips/geoType/auto');
  const deal = renderNext(routeFor(null).dom.window, 'deal', jx);
  assert.equal(deal.href, 'recommendation.html?fips=0862880&geoType=place', 'Recommendation gets fips/geoType without auto-run');
}

const dc = read('deal-calculator.html');
const banner = /function updateJurisdictionBanner\(\)[\s\S]*?\n    \}\n/.exec(dc);
assert(banner, 'deal-calculator.html has the jurisdiction banner');
assert(/cityName\s*\n?\s*\?[^:]*by county, not by town/.test(banner[0]),
  'when a town is open, the banner says limits are set by county, not by town');

console.log('next-step-link: PASS');
