#!/usr/bin/env node
/*
 * The Finder's "CHFA location points (draft 2027)" row reads the tables
 * copied from CHFA's 2027 Common Application (data/policy/chfa-common-app-tables.json):
 * county lowest-AMI points and city renter cost-burden points, 0 for a city
 * CHFA does not list. It is labeled draft and feeds no score.
 */
const test = require('node:test');
const assert = require('assert');

global.window = global;
global.document = {
  readyState: 'loading',
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; }
};
require('../js/lihtc-opportunity-finder.js');
const lof = global.__LOF._test;
const tables = require('../data/policy/chfa-common-app-tables.json');
const idx = lof.chfaLocationIndex(tables);

test('tables are the draft V9 copy with 64 counties and 20-point tops', () => {
  assert.strictEqual(tables.status, 'draft');
  assert.strictEqual(Object.keys(tables.counties).length, 64);
  const city = Object.values(tables.city_cost_burden_points);
  assert.strictEqual(Math.max(...city), 20);
  assert.deepStrictEqual([...new Set(Object.values(tables.counties).map(c => c.lowest_ami_points))].sort((a, b) => a - b), [0, 20]);
});

test('a listed city gets its county and city points, labeled draft', () => {
  const html = lof.chfaLocationFacts({ name: 'Alamosa', containingCounty: '08003' }, idx);
  assert.match(html, /Lowest-AMI county: <strong>20<\/strong> \(Alamosa County\)/);
  assert.match(html, /Renter cost burden: <strong>8<\/strong> \(Alamosa\)/);
  assert.match(html, /Draft/);
  assert.match(html, /not adopted/);
  assert.match(html, /chfainfo\.com\/rental-housing\/housing-credit\/application/);
});

test('Census spelling still finds the CHFA name', () => {
  const html = lof.chfaLocationFacts({ name: 'Cañon City', containingCounty: '08043' }, idx);
  assert.match(html, /Renter cost burden: <strong>\d+<\/strong> \(Canon City\)/);
});

test('a place CHFA does not list scores 0 and says why', () => {
  // The workbook's own rule (city_cost_burden_note): 0 when the city is not listed.
  assert.match(tables.city_cost_burden_note, /0 when the city is not listed/);
  assert.ok(!('Nunn' in tables.city_cost_burden_points));
  const html = lof.chfaLocationFacts({ name: 'Nunn', containingCounty: '08123' }, idx);
  const m = html.match(/Renter cost burden: <strong>(\d+)<\/strong> \(([^)]*)\)/);
  assert.ok(m, 'renter cost burden row present');
  assert.strictEqual(m[1], '0');
  assert.match(m[2], /Nunn/, 'names the place');
  assert.match(m[2], /not/, 'explains the place is absent from the list');
});

test('no tables, no row', () => {
  assert.strictEqual(lof.chfaLocationIndex(null), null);
  assert.strictEqual(lof.chfaLocationFacts({ name: 'Alamosa', containingCounty: '08003' }, null), null);
});
