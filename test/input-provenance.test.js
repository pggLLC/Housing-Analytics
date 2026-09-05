'use strict';

/**
 * Guard: the reader must be able to tell their own numbers from the tool's.
 *
 * Measured on live cohoanalytics.com 2026-09-05: the Deal Calculator renders
 * 133 visible fields and 109 of them arrive pre-filled — Total Development
 * Cost at $20,000,000, Total Units at 60. Those are starting assumptions, but
 * they render identically to a figure the user typed and to one derived from
 * their jurisdiction's data.
 *
 * Same class as a null rendered as $0 (AGENTS.md, "An unmeasurable quantity is
 * null, never 0"), moved from data into the UI: a value the reader might act
 * on, presented with more confidence than it has earned.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/components/input-provenance.js'), 'utf8');

function load(html) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/deal-calculator.html',
  });
  dom.window.eval(SRC);
  return dom.window;
}

const FORM = `
  <form id="f">
    <label>TDC <input id="dc-tdc" type="number" value="20000000"></label>
    <label>Units <input id="dc-units" type="number" value="60"></label>
    <label>Site address <input id="dc-addr" type="text" value=""></label>
    <label>County <select id="dc-county" data-provenance="data">
      <option value="08015" selected>Chaffee</option></select></label>
    <label>Rate <input id="dc-rate" type="radio" value="0.09"></label>
    <label>Cap <input id="dc-cap" type="checkbox"></label>
    <label>Locked <input id="dc-locked" type="number" value="7" disabled></label>
  </form>`;

// ── Pre-filled values are marked as assumptions, empties are not ───────────
const w = load(FORM);
const counts = w.InputProvenance.apply(w.document);

assert.strictEqual(
  w.document.getElementById('dc-tdc').getAttribute('data-provenance'), 'assumption',
  'a pre-filled Total Development Cost must be marked an assumption, not left bare'
);
assert.strictEqual(
  w.document.getElementById('dc-units').getAttribute('data-provenance'), 'assumption',
  'a pre-filled unit count must be marked an assumption'
);
assert.strictEqual(
  w.document.getElementById('dc-addr').getAttribute('data-provenance'), null,
  'an empty field has nothing to disclose and must stay unmarked'
);
assert.strictEqual(
  w.document.getElementById('dc-county').getAttribute('data-provenance'), 'data',
  'a jurisdiction-supplied value keeps its declared "data" provenance'
);

// Radios, checkboxes and disabled fields are out of scope — they are not
// figures the reader could mistake for a finding.
['dc-rate', 'dc-cap', 'dc-locked'].forEach((id) => {
  assert.strictEqual(
    w.document.getElementById(id).getAttribute('data-provenance'), null,
    `${id} must not be marked — it is not a free-text figure`
  );
});

// ── Editing a field flips it to the user's own ────────────────────────────
const tdc = w.document.getElementById('dc-tdc');
tdc.value = '18500000';
tdc.dispatchEvent(new w.Event('input', { bubbles: true }));
assert.strictEqual(
  tdc.getAttribute('data-provenance'), 'yours',
  'once the user edits a field it must read as theirs, not as an assumption'
);

// Overriding a jurisdiction value also becomes theirs.
const county = w.document.getElementById('dc-county');
county.value = '08015';
county.dispatchEvent(new w.Event('change', { bubbles: true }));
assert.strictEqual(
  county.getAttribute('data-provenance'), 'yours',
  'overriding a jurisdiction-supplied value must read as the user’s'
);

// ── A visible badge accompanies each marked field ─────────────────────────
const badge = w.document.getElementById('dc-units-prov');
assert(badge, 'each marked field must carry a visible provenance badge');
assert.strictEqual(badge.textContent, w.InputProvenance.LABELS.assumption,
  'the badge must name the state in plain language');
assert.ok((badge.title || '').length > 20, 'the badge must explain itself on hover');

// ── Re-applying is safe and does not downgrade user edits ─────────────────
const before = tdc.getAttribute('data-provenance');
w.InputProvenance.apply(w.document);
assert.strictEqual(
  tdc.getAttribute('data-provenance'), before,
  're-running after a re-render must not reset a field the user already edited'
);
assert.strictEqual(
  w.document.querySelectorAll('#dc-units-prov').length, 1,
  're-running must not duplicate badges'
);

// ── It must never alter a value ───────────────────────────────────────────
const w2 = load(FORM);
const valuesBefore = ['dc-tdc', 'dc-units', 'dc-addr'].map((id) => w2.document.getElementById(id).value);
w2.InputProvenance.apply(w2.document);
const valuesAfter = ['dc-tdc', 'dc-units', 'dc-addr'].map((id) => w2.document.getElementById(id).value);
assert.deepStrictEqual(
  valuesAfter, valuesBefore,
  'provenance marking must be read-only with respect to values — it cannot alter a calculation'
);

// ── The page must actually load the component ─────────────────────────────
const page = fs.readFileSync(path.join(ROOT, 'deal-calculator.html'), 'utf8');
assert(
  /src="js\/components\/input-provenance\.js"/.test(page),
  'deal-calculator.html must load the provenance component'
);
const calc = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8');
assert(
  /InputProvenance\.apply\(/.test(calc),
  'deal-calculator.js must apply provenance after render, or the markup is never marked'
);

// Market Analysis carries 99 pre-filled fields of its own — a 3-mile buffer,
// 100 proposed units, AMI tier counts of 0 — with the same ambiguity.
const pmaPage = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
assert(
  /src="js\/components\/input-provenance\.js"/.test(pmaPage),
  'market-analysis.html must load the provenance component'
);
const pma = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
assert(
  /InputProvenance\.apply\(/.test(pma),
  'market-analysis.js must apply provenance on init, or its 99 pre-filled fields stay unmarked'
);

console.log(
  `input-provenance: PASS (${counts.assumption} assumption, ${counts.data} data, ` +
  `${counts.total} fields scanned; values unchanged)`
);
