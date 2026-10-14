#!/usr/bin/env node
// test/chas-affordable-available.test.js
//
// data/hna/chas_affordable_available.json is HUD CHAS Tables 15C and 14B
// reduced to renter homes that are affordable AND available to each income
// group (scripts/hna/build_chas_affordable_available.py). This recomputes
// every record from the committed Colorado extracts, independently of the
// builder, and checks the file covers the site's geographies.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'chas_affordable_available.json'), 'utf8'));
const vintageDir = data.meta.source_extracts;
assert(/^data\/hna\/source\/chas\/\d{4}thru\d{4}\/$/.test(vintageDir), 'meta.source_extracts names the extract folder');
const [from, to] = /(\d{4})thru(\d{4})/.exec(vintageDir).slice(1);
assert.equal(data.meta.vintage, `${from}-${to}`, 'meta.vintage matches the extract folder');

function readCsv(file, prefix) {
  const lines = fs.readFileSync(path.join(ROOT, vintageDir, file), 'utf8').trim().split('\n');
  const split = (line) => line.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  const out = new Map();
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    assert.equal(row.source, `${from}thru${to}`, `${file}: every row is the folder's vintage`);
    assert.equal(row.st, '08', `${file}: Colorado rows only`);
    const est = {};
    for (const h of header) if (h.startsWith(`${prefix}_est`)) est[Number(h.slice(prefix.length + 4))] = Number(row[h]);
    out.set(row.geoid.split('US')[1], est);
  }
  return out;
}

// Layout (see the builder's docstring): rent blocks × income subtotals.
const RENT_BLOCKS = [4, 25, 46, 67];
const INCOME = [1, 5, 9, 13, 17];
const VACANT = [4, 8, 12, 16];
const TIERS = { 30: 1, 50: 2, 80: 3 };

function expected(t15, t14) {
  const occ = RENT_BLOCKS.map((b) => INCOME.map((o) => t15[b + o]));
  const vac = VACANT.map((b) => t14[b]);
  const out = {};
  for (const [tier, k] of Object.entries(TIERS)) {
    let hh = 0; let rented = 0; let v = 0;
    for (let i = 0; i < k; i++) for (let r = 0; r < 4; r++) hh += occ[r][i];
    for (let r = 0; r < k; r++) for (let i = 0; i < k; i++) rented += occ[r][i];
    for (let r = 0; r < k; r++) v += vac[r];
    out[tier] = { renter_households: hh, occupied_by_group: rented, vacant_for_rent: v,
      affordable_available_homes: rented + v, homes_short: Math.max(0, hh - rented - v) };
  }
  return out;
}

const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'place-phantom-aliases.json'), 'utf8')).aliases;
let checked = 0;
for (const [level, sum, records] of [['county', '050', data.counties], ['place', '160', data.places]]) {
  const t15 = readCsv(`${level}-${sum}-Table15C.csv`, 'T15C');
  const t14 = readCsv(`${level}-${sum}-Table14B.csv`, 'T14B');
  // A record filed under the site's GEOID names the CHAS GEOID it came from.
  const chasId = (geoid, rec) => rec.chas_geoid || geoid;
  assert.deepEqual(Object.entries(records).map(([g, r]) => chasId(g, r)).sort(), [...t15.keys()].sort(), `${level}: one record per extract row`);
  for (const [geoid, rec] of Object.entries(records)) {
    if (rec.chas_geoid) assert.equal(aliases[rec.chas_geoid], geoid, `${level} ${geoid}: refiled only through place-phantom-aliases.json`);
    const want = expected(t15.get(chasId(geoid, rec)), t14.get(chasId(geoid, rec)));
    for (const tier of Object.keys(TIERS)) {
      const got = rec.tiers[tier];
      for (const k of Object.keys(want[tier])) assert.equal(got[k], want[tier][k], `${level} ${geoid} ≤${tier}% ${k}`);
      if (got.renter_households > 0) {
        // Rounded to one decimal (Python rounds halves to even, so allow the half).
        const per100 = 100 * got.affordable_available_homes / got.renter_households;
        assert(Math.abs(got.homes_per_100_households - per100) <= 0.0500001, `${level} ${geoid} ≤${tier}% per 100`);
      } else {
        assert.equal(got.homes_per_100_households, null, `${level} ${geoid} ≤${tier}% per 100 is null, never 0, with no households`);
      }
    }
    checked++;
  }
}

// Statewide is the sum of the 64 counties.
assert.equal(Object.keys(data.counties).length, 64, 'all 64 counties');
for (const tier of Object.keys(TIERS)) {
  for (const k of ['renter_households', 'affordable_available_homes']) {
    const total = Object.values(data.counties).reduce((s, r) => s + r.tiers[tier][k], 0);
    assert.equal(data.statewide.tiers[tier][k], total, `statewide ≤${tier}% ${k} is the county sum`);
  }
}

// Every county, place and CDP the site offers has a record.
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'geo-config.json'), 'utf8'));
for (const c of geo.counties) assert(data.counties[c.geoid], `county ${c.geoid} has a record`);
for (const p of [...geo.places, ...geo.cdps]) assert(data.places[p.geoid], `place ${p.geoid} (${p.label || p.name}) has a record`);

assert(checked >= 546, `scan checked every record (${checked})`);
console.log(`chas-affordable-available: PASS (${checked} records)`);
