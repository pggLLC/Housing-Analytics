'use strict';

// #1814 — gross building area may be ESTIMATED from the unit mix, but only
// from a cited reference standard, with the working shown, on an explicit
// click, and never from partial data. Colorado has no standard of its own
// and the dataset must say so.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data', 'policy', 'unit-size-standards.json'), 'utf8'));
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const UnitSize = require('../js/deal-calculator-unit-size.js');

console.log('\nDeal Calculator gross-area estimate from unit mix (#1814)');
console.log('='.repeat(62));

// ── dataset ──────────────────────────────────────────────────────────────
assert.strictEqual(dataset.schema, 'unit-size-standards/v1', 'schema versioned');
assert.strictEqual(dataset.meta.colorado.has_statewide_minimum, false, 'dataset records that Colorado has no statewide minimum');
assert(/CHFA/.test(dataset.meta.colorado.note) && /2025-2026/.test(dataset.meta.colorado.note), 'Colorado note names the QAP checked');
assert(dataset.meta.colorado.sources.length >= 2 && dataset.meta.colorado.sources.every(s => /^https:\/\/www\.chfainfo\.com\//.test(s.url)), 'Colorado verification cites chfainfo.com documents');
assert(/^\d{4}-\d{2}-\d{2}$/.test(dataset.meta.colorado.last_verified), 'Colorado check is dated');
const eff = dataset.meta.efficiency;
assert(eff.default > 0 && eff.default <= 1, 'efficiency default is a ratio');
assert(eff.range[0] <= eff.default && eff.default <= eff.range[1], 'efficiency default sits inside its cited range');
assert(eff.sources.length >= 1 && eff.sources.every(s => /^https:\/\//.test(s.url) && s.quote), 'efficiency benchmarks carry source URLs and quotes');
assert(Array.isArray(dataset.standards) && dataset.standards.length >= 1, 'at least one reference standard');
dataset.standards.forEach((std) => {
  assert(std.id && std.label && std.jurisdiction, std.id + ' has id, label, jurisdiction');
  assert.strictEqual(std.applies_to_colorado, false, std.id + ' is honest that it is not a Colorado standard');
  assert(/^https:\/\//.test(std.source_url) && !/example\./.test(std.source_url), std.id + ' has a real HTTPS source');
  assert(std.source_note && std.source_note.length > 40, std.id + ' quotes its source');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(std.last_verified) && /^\d{4}-\d{2}-\d{2}$/.test(std.review_by), std.id + ' is dated with a review date');
  UnitSize.BEDROOM_TYPES.forEach((br) => {
    assert(br in std.sizes, std.id + ' lists ' + br + ' (null when the source is silent)');
    assert(std.sizes[br] === null || std.sizes[br] > 0, std.id + ' ' + br + ' is positive or null');
  });
});
const nc = dataset.standards.find(s => s.id === 'nc-qap-2026-appendix-b');
assert(nc && nc.sizes['2br'] === 900 && nc.sizes['3br'] === 1100 && nc.sizes['4br'] === 1250, 'NC 2026 Appendix B figures match the cited table');
const wa = dataset.standards.find(s => s.id === 'wa-rcw-36-70a-819');
assert(wa && wa.sizes['1br'] === 550 && wa.sizes['4br'] === null, 'WA statute figures match; no 4BR figure');

// ── pure derivation ──────────────────────────────────────────────────────
const ok = UnitSize.derive({ standard: nc, mix: { '1br': 4, '2br': 22, '3br': 22, '4br': 2 }, efficiency: 0.8 });
assert.strictEqual(ok.status, 'ok');
const expectedNet = 4 * 660 + 22 * 900 + 22 * 1100 + 2 * 1250;
assert.strictEqual(ok.netSf, expectedNet, 'net SF is the sum of units × reference size');
assert.strictEqual(ok.grossSf, Math.round(expectedNet / 0.8), 'gross SF is net ÷ efficiency');
assert(ok.grossSf > ok.netSf, 'gross exceeds net');
const working = UnitSize.workingText(ok, nc);
assert(working.includes('22 × 2BR @ 900 SF') && working.includes('÷ 0.8') && working.includes('not a Colorado standard'), 'working shows each term, the efficiency and the jurisdiction caveat');

const partial = UnitSize.derive({ standard: wa, mix: { '2br': 10, '4br': 2 }, efficiency: 0.8 });
assert.strictEqual(partial.status, 'missing-size', 'a mix with an unsized bedroom type yields no estimate');
assert.deepStrictEqual(partial.missing, ['4br']);
assert(/4BR/.test(UnitSize.workingText(partial, wa)), 'working names the unsized type');
assert.strictEqual(UnitSize.derive({ standard: null, mix: { '2br': 10 }, efficiency: 0.8 }).status, 'no-standard', 'no standard, no estimate');
assert.strictEqual(UnitSize.derive({ standard: nc, mix: {}, efficiency: 0.8 }).status, 'no-mix', 'empty mix, no estimate');
assert.strictEqual(UnitSize.derive({ standard: nc, mix: { '2br': 10 }, efficiency: 0 }).status, 'bad-efficiency', 'zero efficiency rejected');
assert.strictEqual(UnitSize.derive({ standard: nc, mix: { '2br': 10 }, efficiency: 1.2 }).status, 'bad-efficiency', 'efficiency above 1 rejected');

// ── page wiring ──────────────────────────────────────────────────────────
assert(html.indexOf('js/deal-calculator-unit-size.js') < html.indexOf('js/deal-calculator.js'), 'unit-size module loads before the calculator');
assert(!/placeholder="e\.g\. ?62,?000"/.test(dcSrc), 'the invented 62,000 SF placeholder is gone');
assert(/data\/policy\/unit-size-standards\.json/.test(dcSrc), 'calculator loads the dataset');

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', { url: 'http://127.0.0.1/deal-calculator.html' });
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
window.DealCalcUnitSize = UnitSize;
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
const dc = window.__DealCalc;

const field = document.getElementById('dc-gross-sf');
const select = document.getElementById('dc-gsf-standard');
const apply = document.getElementById('dc-gsf-apply');
const workingEl = document.getElementById('dc-gsf-working');
assert(field && select && apply && workingEl, 'estimate controls render');
assert.strictEqual(field.value, '', 'gross area starts blank');
assert(!field.getAttribute('placeholder') || !/\d/.test(field.getAttribute('placeholder')), 'gross area placeholder carries no number');
assert(/Colorado/.test(document.getElementById('dc-gsf-colorado-note').textContent) && /no minimum unit size/.test(document.getElementById('dc-gsf-colorado-note').textContent), 'page says Colorado has no minimum');

dc.setUnitSizeStandards(dataset);
assert.strictEqual(select.options.length, 1 + dataset.standards.length, 'every reference standard is offered');
assert.strictEqual(select.value, '', 'no reference is preselected');
Array.from(select.options).slice(1).forEach((opt) => assert(/not Colorado/.test(opt.textContent), 'option "' + opt.textContent + '" is labelled not Colorado'));
assert.strictEqual(document.getElementById('dc-gsf-efficiency').value, String(eff.default), 'efficiency input shows the disclosed default');
assert.strictEqual(field.value, '', 'loading the dataset does not fill the field');
assert.strictEqual(apply.disabled, true, 'apply is disabled without a reference');

// Default mix: the checked LIHTC tiers at 15 units each, 2BR by default.
const mix = dc.collectBedroomMix();
const totalMix = Object.values(mix).reduce((a, b) => a + b, 0);
assert(totalMix > 0 && mix['2br'] === totalMix, 'default mix is all 2BR (' + totalMix + ' units)');

select.value = 'nc-qap-2026-appendix-b';
select.dispatchEvent(new Event('input', { bubbles: true }));
assert.strictEqual(apply.disabled, false, 'apply enables once a reference is chosen');
assert(workingEl.textContent.includes(totalMix + ' × 2BR @ 900 SF'), 'working shows the mix term');
assert.strictEqual(field.value, '', 'choosing a reference still does not fill the field');

apply.click();
const expectGross = Math.round(totalMix * 900 / eff.default);
assert.strictEqual(field.value, String(expectGross), 'clicking apply writes net ÷ efficiency into gross area');
assert.strictEqual(field.getAttribute('data-derived'), 'nc-qap-2026-appendix-b', 'field records what it was derived from');
assert(/Estimated from the unit mix/.test(document.getElementById('dc-gross-sf-help').textContent), 'help text says the value is an estimate');
assert(document.getElementById('dc-own-cost-per-sf'), 'cost per SF row exists to consume the estimate');

// Manual override wins and drops the derived marker.
field.value = '70000';
field.dispatchEvent(new Event('input', { bubbles: true }));
assert.strictEqual(field.hasAttribute('data-derived'), false, 'typing clears the derived marker');
assert(!/Estimated/.test(document.getElementById('dc-gross-sf-help').textContent), 'help text returns to the plain definition');
assert.strictEqual(field.value, '70000', 'typed value is kept');

// Partial data: a 4BR unit under the WA reference blocks the estimate.
select.value = 'wa-rcw-36-70a-819';
select.dispatchEvent(new Event('input', { bubbles: true }));
const firstChecked = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120].find(p => document.getElementById('dc-chk-' + p).checked);
document.getElementById('dc-units-' + firstChecked + '-4br').value = '2';
document.getElementById('dc-units-' + firstChecked + '-4br').dispatchEvent(new Event('input', { bubbles: true }));
assert.strictEqual(apply.disabled, true, 'apply disables when the reference lacks a size for a unit type in the mix');
assert(/4BR/.test(workingEl.textContent), 'working names the unsized type');
assert.strictEqual(field.value, '70000', 'the typed value is untouched by a failed estimate');

console.log('  ✓ estimate derives from a cited reference, shows working, applies only on click, stays blank on partial data');
console.log('\nAll tests passed');
