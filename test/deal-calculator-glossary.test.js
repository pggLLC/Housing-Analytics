'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const glossary = JSON.parse(fs.readFileSync(path.join(root, 'data/glossary.json'), 'utf8'));
const inlineSource = fs.readFileSync(path.join(root, 'js/components/inline-glossary.js'), 'utf8');

// These keys reproduce the casing used in visible Deal Calculator copy. The
// auto-linker is deliberately case-sensitive, so changing case is behavioral.
const expectedTerms = [
  'Cap Rate',
  'Eligible Basis',
  'qualified basis',
  'applicable fraction',
  'basis boost',
  'Developer Fee',
  'Hard costs',
  'Soft costs',
  'Debt Service',
  'Vacancy',
  'Replacement Reserve',
  'credit price',
  'Equity pricing',
  'placed in service',
  'compliance period',
  'extended use',
  'gap financing',
  'amortization',
  'Operating expenses',
  'concessions',
  'stabilization',
];

const byTerm = new Map(glossary.terms.map((entry) => [entry.term, entry]));
for (const term of expectedTerms) {
  const entry = byTerm.get(term);
  assert(entry, `${term} resolves from data/glossary.json with UI-exact casing`);
  assert.equal(typeof entry.full, 'string', `${term} has a full label`);
  assert(entry.full.trim().length >= 5, `${term} full label is not a stub`);
  assert.equal(typeof entry.definition, 'string', `${term} has a definition`);
  assert(entry.definition.trim().length >= 120, `${term} definition is substantive`);
}
assert(!byTerm.has('Basis'), 'a standalone Basis entry was not added');

const body = expectedTerms.map((term) => `<p>${term}</p>`).join('');
const dom = new JSDOM(`<!doctype html><body><main class="js-glossary-auto">${body}</main></body>`, {
  runScripts: 'outside-only',
  url: 'http://127.0.0.1/deal-calculator.html',
});
dom.window.eval(inlineSource);
dom.window.InlineGlossary.decorate(dom.window.document);

const linked = [...dom.window.document.querySelectorAll('abbr[data-glossary]')];
assert.equal(linked.length, expectedTerms.length, 'all 21 Deal Calculator terms render as inline glossary links');
assert.deepEqual(
  linked.map((node) => node.getAttribute('data-glossary')),
  expectedTerms,
  'rendered inline links preserve the exact UI term order and casing',
);
for (const node of linked) {
  assert(node.classList.contains('ig-term'), `${node.textContent} is decorated for hover and keyboard focus`);
  assert.equal(node.getAttribute('tabindex'), '0', `${node.textContent} is keyboard focusable`);
  assert(node.getAttribute('title').length > 20, `${node.textContent} exposes a plain-language tooltip`);
}

const dynamicDom = new JSDOM(
  '<!doctype html><body><main><div id="mount"></div></main></body>',
  { runScripts: 'outside-only', url: 'http://127.0.0.1/deal-calculator.html' },
);
dynamicDom.window.eval(inlineSource);
const mount = dynamicDom.window.document.getElementById('mount');
mount.innerHTML = '<p>Cap Rate</p><p>Eligible Basis</p><p>Debt Service</p>';
dynamicDom.window.InlineGlossary.decorate(mount);
assert.deepEqual(
  [...mount.querySelectorAll('abbr[data-glossary]')].map((node) => node.textContent),
  ['Cap Rate', 'Eligible Basis', 'Debt Service'],
  'a renderer can explicitly decorate content inserted into an empty mount after DOMContentLoaded',
);

console.log('deal-calculator-glossary: PASS (21 terms)');
