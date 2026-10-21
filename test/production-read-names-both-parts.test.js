#!/usr/bin/env node
'use strict';
// The HNA page's 20-year tile names both parts of a figure they make small.
//
// The figure is resident growth plus today's in-commuters who would move
// closer. Where households fall, the two pull apart: Rangely's reads 2, from
// 23 homes for in-commuters less 21 as households fall. A bare "2, Gap
// remains" as the first number a practitioner sees reads as a mistake
// (walkthrough re-walk, 2026-10-21), so the tile's line says both parts, and
// they add up to the figure shown. Elsewhere the line is unchanged.
//
// It runs the shipped productionRead() from js/hna/hna-controller.js on the
// ranking index's published parts for every jurisdiction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');

function extract(name) {
  const i = SRC.indexOf('function ' + name + '(');
  assert(i >= 0, `${name}() is gone from hna-controller.js; this test is checking nothing`);
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') { depth -= 1; if (!depth) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}
const productionRead = new Function(`${extract('productionRead')}; return productionRead;`)();
const BASIS = 'resident_growth_plus_incommuters';

assert(/read: productionRead\(incUnits, growthUnits, incUnitsBasis\)/.test(SRC), 'the decision strip reads its line from productionRead');

// Rangely, as the re-walk saw it.
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/ranking-index.json'), 'utf8')).rankings;
const rangely = rows.find((r) => r.geoid === '0862880');
const m = rangely.metrics;
assert.equal(m.future_units_needed_20yr, m.future_units_growth_20yr + m.incommuter_need_units, 'Rangely: the figure is its two parts');
const line = productionRead(m.future_units_needed_20yr, m.future_units_growth_20yr, BASIS);
assert.equal(line, `Gap remains: ${m.incommuter_need_units} for in-commuters, less ${-m.future_units_growth_20yr} as households fall`, `Rangely: "${line}"`);

// On the page the parts are not whole numbers; the named parts still add up
// to the rounded figure shown (2.4 shows as 2: 23 less 21, not 24 less 21).
assert.equal(productionRead(2.4, -21.4, BASIS), 'Gap remains: 23 for in-commuters, less 21 as households fall', 'fractional parts add up to the figure shown');

// Unchanged readings.
assert.equal(productionRead(85556, 80000, BASIS), 'Gap remains', 'growth: no parts named');
assert.equal(productionRead(40, -10, 'resident_growth'), 'Gap remains', 'no in-commuter record: no parts named');
assert.equal(productionRead(0, -23, BASIS), 'At target');
assert.equal(productionRead(-65, -90, BASIS), 'Surplus');
assert.equal(productionRead(null, 5, BASIS), 'Unavailable');

// Every jurisdiction: the parts named add up to the figure the tile shows.
let named = 0;
for (const r of rows) {
  const t = r.metrics.future_units_needed_20yr;
  const g = r.metrics.future_units_growth_20yr;
  if (t == null || g == null || r.metrics.incommuter_need_units == null) continue;
  const read = productionRead(t, g, BASIS);
  const parts = read.match(/^Gap remains: ([\d,]+) for in-commuters, less ([\d,]+) as households fall$/);
  if (t > 0 && Math.round(g) < 0) {
    assert(parts, `${r.name}: growth ${g}, figure ${t}, names both parts: "${read}"`);
    const num = (s) => Number(s.replace(/,/g, ''));
    assert.equal(num(parts[1]) - num(parts[2]), Math.round(t), `${r.name}: the parts add up to the figure shown`);
    named += 1;
  } else {
    assert(!parts, `${r.name}: only a figure its parts pull apart names them`);
  }
}
assert(named >= 1, 'at least one jurisdiction names both parts');

console.log(`production-read-names-both-parts: PASS (Rangely: "${line}"; ${named} jurisdictions name both parts)`);
