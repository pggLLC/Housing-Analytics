'use strict';

// js/land-comps.js: dates, vacant reading, acres from the shape, the widening steps, the summary (no middle value
// below 3 sales), the best-use tests and the open questions. All offline, from hand-built state-layer features.
const assert = require('assert');
const L = require('../js/land-comps.js');

// ---- dates as counties send them ----
assert.strictEqual(L.saleDate('5/12/2016'), '2016-05-12');
assert.strictEqual(L.saleDate('20160524'), '2016-05-24');
assert.strictEqual(L.saleDate('20190228000000'), '2019-02-28');
assert.strictEqual(L.saleDate('04/28/2016 00:00:00'), '2016-04-28');
assert.strictEqual(L.saleDate('2016-05-24'), '2016-05-24');
assert.strictEqual(L.saleDate('12:00:00 AM'), null);
assert.strictEqual(L.saleDate(''), null);

// ---- vacant: text, Division of Property Taxation codes, and counties that can't say ----
assert.strictEqual(L.isVacant('VACANT 1-<5 AC', null, 'La Plata'), true);
assert.strictEqual(L.isVacant('Vacant Land', null, 'Weld'), true);
assert.strictEqual(L.isVacant('Residential', '0100', 'Mesa'), true);
assert.strictEqual(L.isVacant(null, '100', 'Gilpin'), true);
assert.strictEqual(L.isVacant(null, '0540', 'Rio Grande'), true);
assert.strictEqual(L.isVacant('Residential', '1112,1212', 'Mesa'), false);
assert.strictEqual(L.isVacant('Agricultural', '4147', 'Mesa'), false);
assert.strictEqual(L.isVacant('Residential', null, 'Adams'), null, 'Adams sends broad classes only');
assert.strictEqual(L.isVacant(null, null, 'Boulder'), null);
assert.strictEqual(L.isVacant('Residential', '100', 'Broomfield'), null, 'a local code in the state range proves nothing there');
assert.strictEqual(L.isVacant('Vacant Land', '100', 'Broomfield'), true, 'vacant text still counts');
assert.strictEqual(L.isVacant('SFR Grade C', null, 'Denver'), false);

// ---- one feature to a record ----
const subject = { lat: 39.0, lon: -108.5, acres: 4 };
function ring(lon, lat, d) { return { rings: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d]]] }; }
function feat(o) {
  return { attributes: Object.assign({ countyName: 'Mesa', landUseDsc: 'VACANT LAND', salePrice: '400000', landAcres: 4, saleDate: '20240115', dateReceived: '3/27/2026' }, o.a || {}),
    geometry: ring(o.lon == null ? -108.5 : o.lon, o.lat == null ? 39.0 : o.lat, 0.001) };
}
const r1 = L.fromFeature(feat({}), subject);
assert.strictEqual(r1.price, 400000);
assert.strictEqual(r1.ppa, 100000);
assert.strictEqual(r1.date, '2024-01-15');
assert.strictEqual(r1.vacant, true);
assert.ok(r1.miles < 0.1);
assert.strictEqual(L.fromFeature(feat({ a: { salePrice: '0' } }), subject), null, 'a $0 sale is not a sale');
assert.strictEqual(L.fromFeature(feat({ a: { salePrice: '500' } }), subject), null, 'under $1,000 is left out');
assert.strictEqual(L.fromFeature(feat({ a: { saleDate: '' } }), subject), null, 'no date, no sale');
// Acres from the shape when the county leaves them blank: 1 acre at 39.7 N in square degrees.
const sq = L.sqDegPerAcre(39.7);
const shaped = L.fromFeature(feat({ a: { landAcres: null, 'Shape.STArea()': sq * 2 }, lat: 39.7 }), { lat: 39.7, lon: -108.5 });
assert.ok(Math.abs(shaped.acres - 2) < 0.01 && shaped.acresFromShape === true, 'acres come from the shape');

assert.deepStrictEqual(L.parcelAcres({ attributes: { landAcres: 3.5 } }), { acres: 3.5, fromShape: false });
assert.strictEqual(L.parcelAcres({ attributes: {} }), null);

// ---- distance ----
assert.ok(Math.abs(L.miles({ lat: 39, lon: -105 }, { lat: 40, lon: -105 }) - 69.1) < 0.2, 'one degree of latitude is about 69 miles');

// ---- the query: vacant and acres read by the server, widest step ----
const q = L.queryParams(subject, 0);
assert.ok(/landAcres >= 1\.0000 AND landAcres <= 16\.0000/.test(q.where), 'acres band is the widest step (0.25x to 4x)');
assert.ok(/VACANT/.test(q.where) && /COMMON/.test(q.where), 'vacant only, HOA common areas out');
assert.strictEqual(q.distance, String(L.MAX_MILES));

// ---- widening: the first step with 5 sales wins ----
function at(miles, o) { return Object.assign({ miles: miles, date: '2024-06-01', acres: 4, ppa: 100000, price: 400000, vacant: true, county: 'Mesa', fileDate: '3/27/2026' }, o || {}); }
const near5 = [1, 2, 3, 4, 4.5].map((m) => at(m));
let p = L.pick(subject, near5);
assert.strictEqual(p.index, 0); assert.strictEqual(p.widened, false); assert.strictEqual(p.sales.length, 5);
p = L.pick(subject, [at(1), at(2), at(7), at(8), at(9)]);
assert.strictEqual(p.index, 1, 'widens to 10 miles'); assert.strictEqual(p.widened, true);
p = L.pick(subject, [at(1), at(2), at(3), at(4), at(4.9, { date: '2021-05-01' })]);
assert.strictEqual(p.index, 2, 'widens to 2020 before going further out');
p = L.pick(subject, [at(1), at(2), at(3), at(4), at(4.5, { acres: 40 })]);
assert.ok(p.sales.every((r) => r.acres <= 16), 'a 40-acre sale is never a comp for 4 acres');
p = L.pick(subject, [at(1, { vacant: null }), at(2, { vacant: false }), at(3)]);
assert.strictEqual(p.sales.length, 1, 'built land and unknown counties are not mixed in');

// ---- summary: middle only from 3 or more sales; ask rank ----
const five = [50000, 80000, 100000, 120000, 300000].map((v, i) => at(i + 1, { ppa: v }));
let s = L.summarize(L.pick(subject, five), subject, 4 * 200000);
assert.strictEqual(s.count, 5);
assert.strictEqual(s.median, 100000);
assert.strictEqual(s.q1, 80000); assert.strictEqual(s.q3, 120000);
assert.deepStrictEqual(s.ask, { ppa: 200000, above: 4, of: 5 });
assert.deepStrictEqual(s.counties, [{ county: 'Mesa', fileDate: '3/27/2026' }]);
s = L.summarize(L.pick(subject, five.slice(0, 2)), subject, 0);
assert.strictEqual(s.count, 2);
assert.ok(Number.isNaN(s.median), 'no middle value from 2 sales');
assert.strictEqual(s.ask, null);

// ---- best use ----
let b = L.bestUse({});
assert.deepStrictEqual(b.map((t) => t.result.status), ['not_checked', 'not_checked', 'not_checked', 'not_checked'], 'nothing known, nothing checked');
b = L.bestUse({ zoning: 'mf-right', acres: 4, homes: 60, residual: 500000 });
assert.strictEqual(b[0].result.status, 'checked');
assert.strictEqual(b[1].result.status, 'partly', 'size alone is only partly checked');
assert.ok(/15 homes an acre/.test(b[1].result.answer));
assert.strictEqual(b[2].result.answer, 'Yes');
assert.strictEqual(b[3].result.status, 'not_checked', 'market-rate is not modelled, so the fourth test stays open');
assert.strictEqual(L.bestUse({ residual: -1 })[2].result.answer, 'No');
assert.strictEqual(L.bestUse({ residual: 0 })[2].result.answer, 'No');
b = L.bestUse({ acres: 4, homes: 60, env: { flags: [] } });
assert.strictEqual(b[1].result.status, 'checked');

// ---- questions: from the gaps ----
let qs = L.questions({ zoning: '', summary: null }).map((x) => x.id);
assert.ok(qs.indexOf('zoning') === 0, 'unknown zoning is asked first');
assert.ok(qs.indexOf('few-sales') >= 0 && qs.indexOf('related') < 0);
qs = L.questions({ zoning: 'mf-right', summary: L.summarize(L.pick(subject, five), subject, 4 * 400000) }).map((x) => x.id);
assert.ok(qs.indexOf('zoning') < 0 && qs.indexOf('ask-high') >= 0 && qs.indexOf('related') >= 0 && qs.indexOf('few-sales') < 0);
qs = L.questions({ zoning: 'mf-right', holdingYears: 22, publicOwner: true }).map((x) => x.id);
assert.ok(qs.indexOf('held') >= 0 && qs.indexOf('public-owner') >= 0);

// ---- recorded zoning code: shown, not read ----
b = L.bestUse({ zoningCode: 'R-3', zoningDesc: 'Multi-family residential' });
assert.strictEqual(b[0].result.status, 'partly');
assert.ok(/R-3/.test(b[0].result.text) && /use table/.test(b[0].result.text));
assert.strictEqual(L.bestUse({ zoning: 'mf-right', zoningCode: 'R-3' })[0].result.status, 'checked', 'the reader\'s own reading wins');

// ---- owner type: public and nonprofit owners, a signal only ----
assert.strictEqual(L.ownerType('DURANGO SCHOOL DISTRICT 9-R'), 'school district');
assert.strictEqual(L.ownerType('HOUSING AUTHORITY OF THE CITY OF ASPEN'), 'housing authority');
assert.strictEqual(L.ownerType('TOWN OF BAYFIELD'), 'town, city or county');
assert.strictEqual(L.ownerType('BOARD OF COUNTY COMMISSIONERS OF LA PLATA COUNTY'), 'town, city or county');
assert.strictEqual(L.ownerType('REGIONAL TRANSPORTATION DISTRICT'), 'transit district');
assert.strictEqual(L.ownerType('HABITAT FOR HUMANITY OF METRO DENVER INC'), 'housing nonprofit or land trust');
assert.strictEqual(L.ownerType('SMITH JOHN & MARY'), null);
assert.strictEqual(L.ownerType('COUNTRY ESTATES LLC'), null, 'COUNTRY is not COUNTY');
assert.strictEqual(L.ownerType(''), null);

console.log('land-comps: all checks passed');
