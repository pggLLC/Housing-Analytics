// Deal Calculator quick estimate: one home (duplicate cleanup, 24 Nov 2026).
//
// The five-box quick estimate used to be drawn twice: on the Deal Calculator's front page
// (deal-hub.html#/deal-calculator, hub/deal-quick.js) and as a panel at the top of the full calculator
// (deal-calculator.html, js/deal-calculator-quick.js). It now lives on the front page only. The full calculator
// links to it, and the front page opens the full calculator filled in with what was entered. Every input the panel
// mirrored (county, total cost, credit rate, homes and bedroom size per income limit) is still on
// deal-calculator.html, where the panel only ever mirrored it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const calc = read('deal-calculator.html');
const scripts = html => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
ok(!/id="dcQuick"/.test(calc), 'deal-calculator.html should not draw a second quick estimate');
ok(!scripts(calc).includes('js/deal-calculator-quick.js') && !fs.existsSync(path.join(ROOT, 'js/deal-calculator-quick.js')), 'the panel script should be gone');
ok(/id="dcQuickLink"[^>]*>[\s\S]*?<a href="deal-hub\.html#\/deal-calculator">/.test(calc), 'deal-calculator.html should link to the quick estimate on the front page');

// The front page draws the estimate and lets its route through.
const hub = read('deal-hub.html');
ok(scripts(hub).includes('hub/deal-quick.js'), 'deal-hub.html no longer loads the quick estimate');
const hubs = JSON.parse((/var HUBS = (\{.*?\}), STARTS = /.exec(read('hub/lab-config.js')) || [])[1] || '{}');
ok((hubs['deal-hub.html'] || []).some(re => new RegExp(re).test('#/deal-calculator')), 'hub/lab-config.js does not let #/deal-calculator through on deal-hub.html');

// And opens the full calculator, carrying what was entered.
const quick = read('hub/deal-quick.js');
ok(/var LIVE_TOOL = 'https:\/\/cohoanalytics\.com\/deal-calculator\.html';/.test(quick), 'the quick estimate no longer opens the full calculator');
ok(/function fullTool\(/.test(quick) && /h\.hash \? '#' \+ h\.hash/.test(quick), 'the quick estimate no longer carries its entries to the full calculator');

// Every box the panel mirrored is still an input of the full calculator.
const engine = read('js/deal-calculator.js');
['dc-county-select', 'dc-tdc', 'dc-rate-4', 'dc-rate-9', 'dc-units'].forEach(id => ok(engine.includes('id="' + id + '"') || engine.includes("'" + id + "'"), 'the full calculator no longer has ' + id));
ok(/dc-units-\$\{pct\}|'dc-units-' \+/.test(engine) && /dc-br-\$\{pct\}|'dc-br-' \+/.test(engine), 'the full calculator no longer has homes and bedroom size per income limit');

console.log('deal-quick-estimate: ' + checks + ' checks passed');
