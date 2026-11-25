'use strict';
// For-sale sizing panel (Deal Calculator, Homes for sale): DealEngine.sizeForSaleHomes prices each bedroom
// count for its own household (1.5 people per bedroom, CHFA 2026 income limits), costs a home of that size,
// and reports the gap and the largest home the buyer's price covers. Blank costs stay unknown, never $0.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const Engine = require('../js/deal-engine.js');
const OF = require('../js/hna/ownership-finance.js');
const limits = require('../data/chfa-income-rent-limits-2026.json');
const programs = require('../data/policy/developer-ownership-funding.json');

const adams = limits.counties.find((c) => c.fips === '08001').regular_tiers;
const RATE = { rateAnnual: 0.0728 };
const pinned = (income, opts) => OF.maxAffordablePrice(income, 1, Object.assign({ householdSize: 4 }, RATE, opts || {}));
const base = { incomeLimitsByTier: adams, priceFor: pinned, buildCostPerSf: 300, softCostPct: 25, landPerHome: 60000,
  developerFundingPrograms: programs, countyFips: '08001' };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  PASS ' + name); }

console.log('\nFor-sale sizing panel');
test('household size is 1.5 people per bedroom; half a person averages the two published limits', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [
    { bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }, { bedrooms: 2, homes: 1, sqft: 1000, amiPct: 80 },
    { bedrooms: 3, homes: 1, sqft: 1200, amiPct: 80 }] }));
  const il = adams['80'].income_limits;
  assert.strictEqual(r.rows[0].householdSize, 1.5);
  assert.strictEqual(r.rows[0].income, (il['1p'] + il['2p']) / 2);
  assert.strictEqual(r.rows[1].income, il['3p']);
  assert.strictEqual(r.rows[2].income, (il['4p'] + il['5p']) / 2);
});
test('the buyer price is the shared ownership engine at the household income (no new price math)', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [{ bedrooms: 2, homes: 10, sqft: 1000, amiPct: 80 }] }));
  assert.strictEqual(r.rows[0].maxPrice, OF.maxAffordablePrice(adams['80'].income_limits['3p'], 1, RATE));
});
test('cost, gap and largest home follow the entered costs (worked example in the proposal)', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [{ bedrooms: 2, homes: 10, sqft: 1000, amiPct: 80 }] }));
  const row = r.rows[0];
  assert.strictEqual(r.costPerSfAllIn, 375);
  assert.strictEqual(row.costPerHome, 435000);
  assert.strictEqual(row.gapPerHome, 435000 - row.maxPrice);
  assert.strictEqual(row.largestSf, Math.floor((row.maxPrice - 60000) / 375));
  assert.strictEqual(r.totals.totalGap, row.gapPerHome * 10);
});
test('a land write-down lowers cost and grows the largest home; it never goes below $0 land', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { landWriteDownPerHome: 100000, rows: [{ bedrooms: 2, homes: 1, sqft: 1000, amiPct: 80 }] }));
  assert.strictEqual(r.netLandPerHome, 0);
  assert.strictEqual(r.rows[0].costPerHome, 375000);
});
test('HOA or ground lease lowers what the buyer can pay', () => {
  const a = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  const b = Engine.sizeForSaleHomes(Object.assign({}, base, { hoaMonthly: 300, rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  assert(b.rows[0].maxPrice < a.rows[0].maxPrice);
});
test('blank costs leave cost, gap and largest home unknown with a reason, never $0', () => {
  const r = Engine.sizeForSaleHomes({ incomeLimitsByTier: adams, priceFor: pinned, rows: [{ bedrooms: 2, homes: 4, sqft: 900, amiPct: 100 }] });
  const row = r.rows[0];
  assert(row.maxPrice > 0);
  assert.strictEqual(row.costPerHome, null);
  assert.strictEqual(row.gapPerHome, null);
  assert.strictEqual(row.largestSf, null);
  assert(/build cost per square foot/.test(row.reason));
  assert.strictEqual(r.totals.totalGap, null);
});
test('a tier the county does not publish is named, not priced', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [{ bedrooms: 2, homes: 1, sqft: 900, amiPct: 160 }] }));
  assert.strictEqual(r.rows[0].maxPrice, null);
  assert(/No CHFA income limit at 160%/.test(r.rows[0].reason));
  const summit = limits.counties.find((c) => c.fips === '08117').regular_tiers;
  const s = Engine.sizeForSaleHomes(Object.assign({}, base, { incomeLimitsByTier: summit, rows: [{ bedrooms: 2, homes: 1, sqft: 900, amiPct: 160 }] }));
  assert(s.rows[0].maxPrice > 0, 'rural resort county prices 160%');
});
test('one home type\'s surplus does not cover another\'s gap; uncounted sources stay uncounted', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [
    { bedrooms: 2, homes: 10, sqft: 1000, amiPct: 80 }, { bedrooms: 2, homes: 10, sqft: 1000, amiPct: 120 }] }));
  assert(r.rows[1].surplusPerHome > 0);
  assert.strictEqual(r.totals.totalGap, r.rows[0].gapPerHome * 10);
  const stack = r.totals.fundingStack;
  assert.strictEqual(stack.appliedTotal, 0, 'nothing in the starter list is awarded');
  assert(stack.verifySources.some((s) => s.id === 'chfa-dpa-layering'), 'CHFA buyer aid listed, not counted');
});
test('the largest home is known without a size; an odd size is costed with a warning, never blocked', () => {
  const r = Engine.sizeForSaleHomes(Object.assign({}, base, { rows: [
    { bedrooms: 2, homes: '', sqft: '', amiPct: 80 }, { bedrooms: 2, homes: 1, sqft: 100, amiPct: 80 }, { bedrooms: 2, homes: 1, sqft: 1000, amiPct: 80 }] }));
  assert(r.rows[0].largestSf > 0 && r.rows[0].costPerHome === null && r.rows[0].sizeWarning === null);
  assert(/outside the usual/.test(r.rows[1].sizeWarning) && r.rows[1].costPerHome === 100 * 375 + 60000);
  assert.strictEqual(r.rows[2].sizeWarning, null);
});
test('zero, negative and huge inputs: $0 build cost is blank; negatives are blank; land above price gives 0 sq ft', () => {
  const zero = Engine.sizeForSaleHomes(Object.assign({}, base, { buildCostPerSf: 0, rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  assert.strictEqual(zero.rows[0].costPerHome, null);
  assert(zero.costMissing.includes('build cost per square foot'));
  const neg = Engine.sizeForSaleHomes(Object.assign({}, base, { softCostPct: -5, rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  assert(neg.costMissing.includes('soft costs %'));
  const pricey = Engine.sizeForSaleHomes(Object.assign({}, base, { landPerHome: 5000000, rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  assert.strictEqual(pricey.rows[0].largestSf, 0);
  assert(pricey.rows[0].gapPerHome > 4000000);
  const softZero = Engine.sizeForSaleHomes(Object.assign({}, base, { softCostPct: 0, rows: [{ bedrooms: 1, homes: 1, sqft: 700, amiPct: 80 }] }));
  assert.strictEqual(softZero.rows[0].costPerHome, 700 * 300 + 60000, '0% soft costs is a real value');
});
test('cost references agree with their records: amounts, publisher period and link destination', () => {
  const refs = Engine.FOR_SALE_COST_REFERENCES;
  assert(refs.length > 0, 'scan found references to check');
  const html = Engine.forSaleCostReferenceHtml();
  refs.forEach((r) => {
    const span = html.slice(html.indexOf('data-cost-ref="' + r.id + '"'));
    assert(span.length < html.length, r.id + ' is rendered');
    const piece = span.slice(0, span.indexOf('</span>'));
    assert(piece.includes('$' + r.lowPerSf + '&ndash;$' + r.highPerSf), r.id + ' shows its own range');
    assert(r.lowPerSf < r.highPerSf, r.id + ' low below high');
    const href = /href="([^"]+)"/.exec(piece)[1];
    assert.strictEqual(href, r.url, r.id + ' links to its own source');
    const u = new URL(href);
    assert.strictEqual(u.protocol, 'https:');
    assert(u.pathname.includes('/' + r.year + '/'), r.id + ' link is filed under its stated year ' + r.year);
    assert(piece.includes(String(r.year)), r.id + ' names its year on screen');
  });
});
test('the panel is owner-only, reads the shared references, and no box carries a cost default', () => {
  const src = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
  const reg = fs.readFileSync(path.join(root, 'js', 'deal-calculator-input-registry.js'), 'utf8');
  const foldStart = src.indexOf('<div id="dc-own-sizing"');
  assert(foldStart > 0, 'panel markup found');
  const fold = src.slice(foldStart, src.indexOf('<!--', foldStart));
  assert(/data-dc-mode="ownership" hidden/.test(fold), 'shown only in the for-sale view');
  assert(/<h3[^>]*>[^<]*\bowners?\b/i.test(fold), 'heading names owners (renter vs owner rule)');
  assert(src.includes('forSaleCostReferenceHtml()'), 'references come from the engine records');
  Engine.FOR_SALE_COST_REFERENCES.forEach((r) => assert(!src.includes('$' + r.lowPerSf + '&ndash;'), 'no second copy of ' + r.id));
  const inputs = fold.match(/<input [^>]*>/g) || [];
  assert(inputs.length >= 13, 'scan found the panel inputs');
  inputs.forEach((tag) => {
    assert(!/\svalue="/.test(tag), 'no prefilled value: ' + tag);
    const id = /id="([^"]+)"/.exec(tag)[1];
    assert(reg.includes("'" + id + "'") || reg.includes("'" + id.replace(/\d+$/, "'")), 'registry has ' + id);
  });
});
console.log('\n' + passed + ' passed');
