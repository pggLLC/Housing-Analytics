'use strict';
/**
 * test/hna-lehd-partial-flows.test.js
 *
 * The HNA commute-flow chart (renderLehd) must not turn a missing flow into
 * zero. A partial record such as { within: null, inflow: 40, outflow: 55 }
 * draws no bar for the missing flow and names it in the note; a published 0
 * stays 0. Runs the real function body against stubs, with invented data.
 *
 * Run: node test/hna-lehd-partial-flows.test.js
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else { console.error('  ❌ FAIL:', msg); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'js/hna/hna-renderers.js'), 'utf8');
const body = (src.match(/function renderLehd\([\s\S]*?\n  \}\n/) || [])[0];
assert(!!body, 'renderLehd() found');

function run(lehd, geoType) {
  const charts = [], placeholders = [];
  const note = { textContent: 'stale' };
  const canvas = { getContext: () => ({}) };
  const safeNum = (v) => { if (v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fn = new Function('document', 'S', 'U', 'chartTheme', 'makeChart', '_placeholderInBox',
    body + '\nreturn renderLehd;')(
    { getElementById: () => canvas },
    () => ({ els: { lehdNote: note } }),
    () => ({ safeNum, fmtNum: String }),
    () => ({ c1: 'a', c3: 'b', c5: 'c', muted: 'm', border: 'x' }),
    (_ctx, cfg) => charts.push(cfg),
    (_c, msg) => placeholders.push(msg));
  fn(lehd, geoType || 'county', '08077');
  return { charts, placeholders, note: note.textContent };
}

if (body) {
  const partial = run({ within: null, inflow: 40, outflow: 55 });
  const data = partial.charts[0] && partial.charts[0].data.datasets[0].data;
  assert(Array.isArray(data) && data[0] === null && data[1] === 40 && data[2] === 55,
    'a missing within flow stays null, not 0: ' + JSON.stringify(data));
  assert(/Not available[^.]*live and work here/.test(partial.note),
    'the note names the missing flow: ' + partial.note);

  const zero = run({ within: 0, inflow: 40, outflow: 55 });
  const zd = zero.charts[0] && zero.charts[0].data.datasets[0].data;
  assert(Array.isArray(zd) && zd[0] === 0, 'a published 0 stays 0');
  assert(!/Not available/.test(zero.note), 'a published 0 is not called missing');

  const none = run({ within: null, inflow: undefined, outflow: '' });
  assert(none.charts.length === 0 && none.placeholders.length === 1, 'all three missing shows the not-available placeholder');

  const full = run({ within: 10, inflow: 40, outflow: 55, flows_source: 'block-od' }, 'place');
  assert(/BLOCK-classified/.test(full.note) && !/Not available/.test(full.note), 'a complete place record keeps its source note only');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
