const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(repoRoot, 'js/market-intelligence.js'), 'utf8');
const html = fs.readFileSync(path.join(repoRoot, 'colorado-deep-dive.html'), 'utf8');

assert.match(
  js,
  /var permits = data\.COBPPRIV\b/,
  'Supply KPI permits must prefer Colorado COBPPRIV before national permit series.'
);

assert.match(
  js,
  /var obs = fred && \(fred\.COBPPRIV\b/,
  'Supply chart must prefer Colorado COBPPRIV before national permit series.'
);

assert.ok(
  html.includes('CO Building Permits'),
  'Supply permits label should identify Colorado building permits.'
);

assert.ok(
  !html.includes('Multifamily Permits (12 mo)'),
  'Supply permits label should not claim a stale 12-month multifamily metric.'
);

assert.ok(
  html.includes('U.S. Completions (SAAR)'),
  'Completions card should disclose that the value is U.S. national context.'
);

assert.ok(
  html.includes('U.S. Under Construction (SAAR)'),
  'Under-construction card should disclose that the value is U.S. national context.'
);

assert.ok(
  !html.includes('via FRED series COBPPRIV and COBPPRIV5F'),
  'Data note should not imply all supply cards use Colorado FRED series.'
);

console.log('Market Intelligence supply source labels guard passed.');

// Invoke the real renderer with a narrow DOM; expose its closure only in this test.
const vm = require('node:vm');
const caption = { textContent: '' };
const card = { textContent: '', title: '', className: '', nextElementSibling: caption };
const context = { window: {}, document: { addEventListener() {}, getElementById(id) { return id === 'riskAffordGap' ? card : null; } } };
const instrumented = js.replace('  /* ── Public API', '  window.renderRiskForTest = function(demo) { currentData = { demographics: demo }; renderRiskKpis({}); };\n  /* ── Public API');
vm.runInNewContext(instrumented, context);
const render = context.window.renderRiskForTest;
for (const value of [undefined, null, '']) {
  render({ ami_estimate: 120000, median_gross_rent: 1800, affordable_rent_60pct: value });
  assert.equal(card.textContent, '—', 'AMI cannot substitute for an absent bedroom-weighted rent');
  assert.equal(card.title, '60% AMI affordable rent unavailable for this geography');
  assert.equal(caption.textContent, card.title, 'absence is visible, not tooltip-only');
}
render({ ami_estimate: 999999, median_gross_rent: 1800, affordable_rent_60pct: 1500 });
assert.equal(card.textContent, '-300/mo', 'gap uses only the supplied bedroom-weighted rent');
assert(caption.textContent.includes('$1,500/mo'));
assert.match(caption.textContent, /HUD.*bedroom-mix weighted.*not a CHFA LIHTC limit/);
for (const value of [0, -1]) {
  render({ ami_estimate: 120000, median_gross_rent: 1800, affordable_rent_60pct: value });
  assert.equal(card.textContent, '—', `nonpositive affordable rent ${value} is unavailable`);
  assert.equal(card.title, '60% AMI affordable rent unavailable for this geography');
  assert.equal(caption.textContent, card.title, 'nonpositive rent has a visible unavailable reason');
  assert.equal(card.className, 'risk-value', 'nonpositive rent clears the previous gap status');
}
render({ ami_estimate: 120000, median_gross_rent: 1800 });
assert.equal(card.className, 'risk-value', 'missing data clears the previous gap status');
console.log('Market Intelligence affordable-rent source and absence: PASS');
