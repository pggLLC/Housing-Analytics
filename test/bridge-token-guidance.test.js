'use strict';

/**
 * Guard for #1611's one item that holds whether Bridge approves or denies:
 * no shipped file may instruct anyone to put a token into js/config.js.
 *
 * js/config.js is served to every visitor of a public site. A token pasted
 * there is published. The distinction that matters — and the reason this is a
 * wording fix rather than a mechanism change — is that a visitor supplying
 * THEIR OWN token through the Data Quality Dashboard keeps it in that person's
 * own browser storage, which is fine.
 *
 * The integration itself is deliberately untouched: #1611 says to await
 * Bridge's decision.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('bridge-token-guidance');

run('no shipped file tells anyone to put a token in js/config.js', () => {
  const files = [
    'data/market/bridge_co_market_summary.json',
    'docs/DATA-INTEGRATIONS-AUDIT.md',
  ];
  for (const p of files) {
    assert.doesNotMatch(read(p), /Set APP_CONFIG\.[A-Z_]*TOKEN in js\/config\.js/,
      p + ' instructs putting a token into a publicly served file');
  }
});

run('the stub warns against it explicitly', () => {
  const note = String(JSON.parse(read('data/market/bridge_co_market_summary.json'))._note || '');
  assert.match(note, /DO NOT put a token in js\/config\.js/, 'the warning must be explicit');
  assert.match(note, /BRIDGE_SERVER_TOKEN/, 'and must name the supported server-side path');
  assert.match(note, /Data Quality Dashboard/,
    'and the legitimate bring-your-own-key route, so the warning does not read as "no way to enable this"');
});

run('the integration itself is untouched while access is pending', () => {
  // #1611: "Retain the honest available: false state and the existing
  // non-Bridge fallback" until Bridge answers.
  const d = JSON.parse(read('data/market/bridge_co_market_summary.json'));
  assert.equal(d.available, false, 'the stub must stay unavailable');
  assert.match(String(d._note), /#1611/, 'and point at the decision record');
});

if (failures) { console.error('bridge-token-guidance: FAIL'); process.exitCode = 1; }
else console.log('bridge-token-guidance: PASS');
