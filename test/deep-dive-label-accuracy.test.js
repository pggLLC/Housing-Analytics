'use strict';
// Colorado deep dive: labels and figures must match what the code computes and the cited source.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'colorado-deep-dive.html'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'js/policy-simulator.js'), 'utf8');
const mi = fs.readFileSync(path.join(root, 'js/market-intelligence.js'), 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

// 2026 per-capita housing credit: $3.416 (IRS Rev. Proc. 2025-32), not the old $2.75.
ok(!/\$2\.75/.test(sim), 'policy simulator still cites the stale $2.75 per-capita figure');
ok(/\$3\.42 \(IRS Rev\. Proc\. 2025-32\)/.test(sim), 'policy simulator per-capita scenario names the 2026 amount and its source');
// Pipeline pressure is computed as tax credit projects per 1,000 households.
ok(/projects\/1k HH/.test(mi), 'market-intelligence.js no longer computes projects per 1,000 households; update this test and the label');
ok(page.includes('Tax credit projects per 1,000 households') && !page.includes('Permits issued / existing units'), 'Pipeline pressure label does not match its calculation');
// Unemployment is the simple average of county rates, not a statewide rate.
ok(/var avg = vals\.reduce\(function \(s, v\) \{ return s \+ v; \}, 0\) \/ vals\.length;/.test(page), 'unemployment average changed; update its label');
ok(!page.includes('BLS LAUS statewide avg') && !/BLS LAUS<\/a> · CO statewide/.test(page), 'unemployment is labelled statewide but is an average of county rates');
// The concession chart's subtitle names the same source as its data-source and source line.
const sub = page.match(/Average monthly concession value 2022-2025[^\n]*/)[0];
ok(/CBRE Multifamily Outlook 2025/.test(sub) && !/AAMD Q4 2025/.test(sub), 'concession chart subtitle names a different source than its data');
console.log('deep dive label accuracy: PASS (' + n + ' checks)');
