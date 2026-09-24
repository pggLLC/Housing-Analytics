'use strict';

// PC-2 — "An ownership project never displays or exports tax credits, eligible
// basis, NOI or LIHTC debt unless the user intentionally adds a rental
// component."
//
// Found on main 2026-09-24: an ownership-mode Deal Calculator save put
// "Annual credits $1,440,000 · First mortgage $5,776,788" on the project's
// Recommendation. The rental panel is computed even in ownership mode, and the
// save read it regardless of mode; the Recommendation then quoted it with no
// mode check. Both ends are held here, joined: the snapshot the calculator
// actually builds is the one the Recommendation contract is fed, so a change
// to either side that lets LIHTC figures through fails.
//
// Also held: the confidence claim on the Recommendation says what it is
// confidence IN. It read "High data confidence" for a project with no market
// analysis and no scenarios run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nOwnership / rental separation (PC-2)');
console.log('='.repeat(62));

/* ── The whole page, with the calculator rendered into it ─────────────── */

// The page itself, not a bare mount. A first version scanned only
// #dealCalcMount and passed while the page heading, stress tests, capital
// waterfall, QAP tools and LIHTC education — all outside the mount — were
// still on screen in ownership mode (Codex review of #1874). The page's own
// scripts do not run here; the calculator is rendered into its real mount.
const pageSrc = read('deal-calculator.html');
const dom = new JSDOM(pageSrc, { url: 'http://127.0.0.1/deal-calculator.html', runScripts: 'outside-only' });
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');

// Page components that render LIHTC content at load, outside the calculator.
// Loaded with the page's own inline calls to them, so what is scanned below
// is what a browser shows, not only the static markup.
const LOAD_TIME_RENDERERS = [
  ['js/components/development-realism.js', 'DevRealism.'],
  ['js/components/data-quality-summary.js', 'DataQualitySummary.render'],
];
LOAD_TIME_RENDERERS.forEach(([file, call]) => {
  window.eval(read(file));
  const inline = Array.from(pageSrc.matchAll(/<script>([\s\S]*?)<\/script>/g), (m) => m[1])
    .filter((src) => src.includes(call));
  assert(inline.length, 'no inline call to ' + call + ' found in deal-calculator.html');
  inline.forEach((src) => window.eval(src));
});
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
assert(document.getElementById('dealColorado').textContent.length > 100,
  'the Colorado factors checklist did not render; the scan would not see it');

// The page's own save function, taken from the page rather than retyped, so
// this cannot pass against a copy that has drifted from what ships.
const start = pageSrc.indexOf('function readDealState()');
const end = pageSrc.indexOf('// Expose for deal-comparison.js', start);
assert(start > 0 && end > start, 'readDealState() could not be located in deal-calculator.html');
window.eval(pageSrc.slice(start, end) + '\nwindow.__readDealState = readDealState;');
const readDealState = window.__readDealState;

function setMode(mode) {
  const radio = document.getElementById('dc-mode-' + mode);
  assert(radio, 'deal-mode radio ' + mode + ' renders');
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

// Codex audit PC-2 terms, plus the LIHTC output labels that leaked.
const LIHTC_TERMS = /(tax credit|eligible basis|\bNOI\b|\bLIHTC\b|credit equity|annual credits|supportable first mortgage)/i;

function visibleLihtcText() {
  const mount = document.querySelector('main');
  const chooser = document.getElementById('dc-mode-rental').closest('fieldset');
  const hits = [];
  const walker = document.createTreeWalker(mount, dom.window.NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el || el.closest('[hidden]') || el.closest('script,style,template,noscript')) continue;
    // The mode chooser names both paths by design: "Rental (LIHTC)" is how a
    // reader picks the rental path, not a leak into the ownership one.
    if (chooser && chooser.contains(el)) continue;
    if (LIHTC_TERMS.test(node.textContent)) hits.push(node.textContent.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  return hits;
}

test('the scan sees LIHTC terms in rental mode (non-vacuity)', () => {
  setMode('rental');
  const hits = visibleLihtcText();
  assert(hits.length >= 10, 'rental mode shows only ' + hits.length + ' LIHTC terms; the scan is not reading the calculator');
});

test('ownership mode shows no tax-credit, basis, NOI or LIHTC-debt text', () => {
  setMode('ownership');
  const hits = visibleLihtcText();
  assert.deepStrictEqual(hits, [], 'visible in ownership mode:\n      ' + hits.join('\n      '));
});

test('every control only the rental save reads is hidden in ownership mode', () => {
  // A text scan cannot see the Debt Sizing inputs: "DCR", "Interest rate" and
  // "Amortization" are not LIHTC words, yet they size LIHTC debt. So the set
  // is taken from the save itself — whatever the rental snapshot reads and
  // the ownership snapshot does not is rental-only by definition, and must
  // not be on screen in ownership mode.
  const fn = pageSrc.slice(start, end);
  const split = fn.indexOf("if (dealMode === 'ownership')");
  const rentalReturn = fn.indexOf('return {', fn.indexOf('return {', split) + 1);
  assert(split > 0 && rentalReturn > split, 'readDealState() no longer has an ownership branch and a rental return');
  const ids = (src) => new Set(Array.from(src.matchAll(/(?:safeVal|safeChecked|outText|getElementById)\('([\w-]+)'\)/g), (m) => m[1]));
  const ownershipIds = ids(fn.slice(split, rentalReturn));
  const rentalOnly = Array.from(ids(fn.slice(rentalReturn))).filter((id) => !ownershipIds.has(id));
  assert(rentalOnly.length >= 10, 'only ' + rentalOnly.length + ' rental-only controls found; the parse is not reading the save');
  setMode('ownership');
  const shown = rentalOnly.filter((id) => {
    const el = document.getElementById(id);
    assert(el, id + ' is read by the rental save but does not render');
    return !el.closest('[hidden]');
  });
  assert.deepStrictEqual(shown, [], 'rental-only controls visible in ownership mode: ' + shown.join(', '));
});

test('a mode-hidden element stays hidden even with an inline display', () => {
  // jsdom applies no CSS, so the scan above trusts [hidden]. In a browser an
  // inline display beats the UA [hidden] rule; that kept the Eligible Basis
  // slider on screen in ownership mode. The site rule is what makes [hidden]
  // true on the page, so it is asserted against the elements that need it.
  const css = read('css/site-theme.css');
  assert(/\[data-dc-mode\]\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css),
    'css/site-theme.css no longer forces [data-dc-mode][hidden] to display:none');
  const inlineDisplay = Array.from(document.querySelectorAll('[data-dc-mode]'))
    .filter((el) => /display\s*:/.test(el.getAttribute('style') || ''));
  assert(inlineDisplay.length > 0, 'no mode-tagged element carries an inline display; this check has nothing to hold');
});

/* ── The export ──────────────────────────────────────────────────────── */

require('../js/deal-calculator-share.js');

// PC-2's own list, stated independently of how the exporter decides: tax
// credits (credit rate, set-aside, equity pricing), eligible basis (basis %,
// QCT/DDA), NOI, and LIHTC debt (DCR). Plus the LIHTC-only stress and
// waterfall inputs that live outside the calculator.
const PC2_KEYS = ['rate-9', 'minimum-set-aside', 'equity-price', 'basis-pct', 'qct-dda',
  'noi', 'auto-noi', 'dcr', 'stress-equity-price', 'wf-lp-equity'];

test('the JSON export and share URL carry no LIHTC input in ownership mode', () => {
  const share = window.__DealCalcShare;
  assert(share && typeof share.buildSnapshot === 'function', 'the exporter no longer exposes buildSnapshot()');

  setMode('rental');
  const rental = share.buildSnapshot();
  assert.strictEqual(rental.dealMode, 'rental');
  const missing = PC2_KEYS.filter((k) => !(k in rental.inputs));
  assert.deepStrictEqual(missing, [], 'rental export lacks ' + missing.join(', ') + '; these checks would pass vacuously');

  setMode('ownership');
  const own = share.buildSnapshot();
  assert.strictEqual(own.dealMode, 'ownership');
  const leaked = PC2_KEYS.filter((k) => k in own.inputs);
  assert.deepStrictEqual(leaked, [], 'ownership JSON export carries ' + leaked.join(', '));
  assert.deepStrictEqual(own.tranches, [], 'ownership JSON export carries soft-funding tranches');
  const params = new URL(own.url).searchParams;
  const inUrl = PC2_KEYS.filter((k) => params.has(k)).concat(params.has('tr') ? ['tr'] : []);
  assert.deepStrictEqual(inUrl, [], 'ownership share URL carries ' + inUrl.join(', '));
  ['tdc', 'units', 'sale-target-ami'].forEach((k) =>
    assert(k in own.inputs, 'ownership export dropped the ownership input ' + k));
  assert.strictEqual(own.inputs['mode-rental'], 'ownership', 'the export does not say it is an ownership deal');
});

/* ── The save, fed to the Recommendation ─────────────────────────────── */

const Contract = require('../js/workflow/recommendation-contract.js');
const RENTAL_ONLY_KEYS = ['creditType', 'basisPct', 'qctDda', 'equityPrice', 'noi', 'dcr', 'minimumSetAsideElection', 'unitMix'];
const RENTAL_ONLY_OUTPUTS = ['eligibleBasis', 'annualCredits', 'creditEquity', 'mortgageConst', 'firstMortgage', 'gap'];

function dealRecord(snapshot) {
  return Contract.projectRecord({ deal: snapshot }).find((s) => s.key === 'deal');
}

test('an ownership save records its mode and carries no LIHTC field', () => {
  setMode('ownership');
  const snap = readDealState();
  assert.strictEqual(snap.dealMode, 'ownership');
  RENTAL_ONLY_KEYS.forEach((k) => assert(!(k in snap), 'ownership save carries ' + k));
  RENTAL_ONLY_OUTPUTS.forEach((k) => assert(!(k in (snap.outputs || {})), 'ownership save carries outputs.' + k));
  assert(snap.outputs && 'maxAffordablePrice' in snap.outputs, 'ownership save does not carry the ownership outputs');
});

test('the Recommendation quotes an ownership save as ownership, never as LIHTC', () => {
  setMode('ownership');
  const snap = readDealState();
  // Give the ownership outputs values, as a computed panel would, so the
  // assertion is about which fields are quoted rather than about emptiness.
  snap.outputs = { costPerUnit: '$333,333', maxAffordablePrice: '$378,138', subsidyGapPerUnit: '$0', totalOwnershipGap: '$0' };
  const rec = dealRecord(snap);
  assert.strictEqual(rec.mode, 'ownership');
  assert(/ownership/i.test(rec.label), 'deal step label does not name the ownership path: ' + rec.label);
  const labels = rec.fields.map((f) => f.label).join(' | ');
  assert(!/credit|mortgage|funding gap/i.test(labels), 'ownership deal quotes: ' + labels);
  assert(rec.fields.some((f) => f.value === '$378,138'), 'the max affordable price is not quoted');
});

test('a rental save still quotes its rental figures', () => {
  setMode('rental');
  const snap = readDealState();
  assert.strictEqual(snap.dealMode, 'rental');
  snap.outputs.annualCredits = '$1,440,000';
  const rec = dealRecord(snap);
  assert.strictEqual(rec.mode, 'rental');
  assert(rec.fields.some((f) => f.label === 'Annual credits' && f.value === '$1,440,000'),
    'the rental deal no longer quotes its annual credits');
});

test('a save with no recorded mode quotes nothing and says why', () => {
  // Every save before this change. It may have been an ownership deal carrying
  // LIHTC figures, so none can be quoted as fact.
  const rec = dealRecord({ completedAt: '2026-09-01T00:00:00Z', creditType: '9%',
    outputs: { annualCredits: '$1,440,000', firstMortgage: '$5,776,788', gap: '$639,212' } });
  assert.strictEqual(rec.status, 'recorded');
  assert.deepStrictEqual(rec.fields, [], 'a mode-less save still quotes: ' + JSON.stringify(rec.fields));
  assert(rec.note && /rental or an ownership/.test(rec.note), 'no explanation for the missing figures');
});

test('the rendered Recommendation carries the ownership record, and the legacy note', () => {
  const Page = require('../js/workflow/recommendation-page.js');
  const digest = JSON.parse(read('data/hna/jurisdiction-metrics-digest/08069.json'));
  const render = (deal) => {
    const d = new JSDOM('<!DOCTYPE html><div id="m"></div>');
    Page.render(d.window.document.getElementById('m'),
      Contract.build({ digest, project: { deal }, generatedAt: '2026-09-24T00:00:00Z' }));
    const step = d.window.document.querySelector('[data-step-key="deal"]');
    assert(step, 'the deal step did not render');
    return step.textContent.replace(/\s+/g, ' ');
  };
  const own = render({ completedAt: '2026-09-24T00:00:00Z', dealMode: 'ownership',
    outputs: { maxAffordablePrice: '$378,138', subsidyGapPerUnit: '$0', totalOwnershipGap: '$0' } });
  assert(/for-sale ownership/.test(own) && /\$378,138/.test(own), 'ownership record missing: ' + own);
  assert(!LIHTC_TERMS.test(own) && !/First mortgage/.test(own), 'ownership record shows LIHTC text: ' + own);
  const legacy = render({ completedAt: '2026-09-01T00:00:00Z', outputs: { annualCredits: '$1,440,000' } });
  assert(!/1,440,000/.test(legacy), 'a mode-less save rendered its credits');
  assert(/save again/.test(legacy), 'the legacy note did not render');
});

/* ── Confidence names its scope ──────────────────────────────────────── */

test('the confidence claim names the project steps it does not cover', () => {
  const digest = JSON.parse(read('data/hna/jurisdiction-metrics-digest/08069.json'));
  const jurisdictionOnly = Contract.build({ digest, generatedAt: 'x',
    project: { jurisdiction: { completedAt: '2026-09-24T00:00:00Z', name: 'Larimer County' } } });
  const conf = jurisdictionOnly.conclusions.find((c) => c.id === 'confidence');
  assert(conf && conf.verdict, 'Larimer County has no confidence verdict; pick a digest that has one');
  assert(/public-data confidence/.test(conf.verdict), 'the verdict does not say it is about public data: ' + conf.verdict);
  ['Market analysis', 'Scenarios', 'Deal test'].forEach((label) => {
    assert(conf.plain.includes(label), 'confidence text does not name the unrun "' + label + '": ' + conf.plain);
    assert(jurisdictionOnly.headline.plain.includes(label), 'headline does not name the unrun "' + label + '"');
  });
  assert.deepStrictEqual(jurisdictionOnly.projectStepsNotRun, ['Market analysis', 'Scenarios', 'Deal test']);

  const done = (extra) => Object.assign({ completedAt: '2026-09-24T00:00:00Z' }, extra);
  const complete = Contract.build({ digest, generatedAt: 'x', project: {
    jurisdiction: done(), market: done({ score: 60 }), scenario: done(), deal: done({ dealMode: 'rental', outputs: {} })
  } });
  const conf2 = complete.conclusions.find((c) => c.id === 'confidence');
  assert(!/not been run/.test(conf2.plain), 'a complete project is still told steps have not been run: ' + conf2.plain);
  assert(!/Not yet run/.test(complete.headline.plain), 'a complete project headline lists unrun steps');
});

if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nAll ownership/rental separation checks passed');
