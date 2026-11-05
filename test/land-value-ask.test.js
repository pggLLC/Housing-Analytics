// Land value tool: the asking price check (js/components/land-value-tool.js evaluateAsk).
// Run: node test/land-value-ask.test.js. Invented figures only.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js/components/land-value-tool.js'), 'utf8');
const win = {};
new Function('window', 'document', src)(win, { addEventListener() {}, getElementById() { return null; }, readyState: 'complete' });
const T = win.LandValueTool;
let n = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } n++; };

const res = T.computeResidual({ tdc: 20000000, equityAndDebt: 18000000, softSources: 2500000, deferredFee: 500000, offSiteCosts: 200000 });
ok(res.adjustedResidual === 800000, 'residual is sources less cost less off-site work');
ok(T.evaluateAsk(0, res, 0, 40) === null && T.evaluateAsk('', res, 0, 40) === null, 'no price entered, no check');
const fits = T.evaluateAsk(600000, res, 0, 40);
ok(fits.verdict === 'fits' && fits.room === 200000 && fits.perUnit === 5000, 'a price under the most the deal can pay fits, with the room per home');
const short = T.evaluateAsk(1200000, res, 0, 40);
ok(short.verdict === 'short' && short.room === -400000 && Math.abs(short.covered - 2 / 3) < 1e-9, 'a price over it is short by the difference');
const disc = T.evaluateAsk(1200000, res, 50, 40);
ok(disc.net === 600000 && disc.verdict === 'fits', 'a public discount comes off the price first');
ok(T.evaluateAsk(1200000, res, 100, 40).verdict === 'free', 'donated land is free');
const none = T.evaluateAsk(500000, T.computeResidual({ tdc: 20000000, equityAndDebt: 15000000 }), 0, 0);
ok(none.verdict === 'none' && none.max === 0 && none.perUnit === null, 'a deal with no room for land shows the whole price as a gap');
console.log('land-value-ask: ' + n + ' checks passed');
