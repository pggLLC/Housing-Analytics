/**
 * Resort workforce housing programs (data/resort-workforce-housing-programs.json)
 * are pinned to their sources: every program names a source and carries
 * verbatim quotes, and every dollar, percent or count in its summary or
 * magnitude sits in one of those quotes. The renderer must find an authority
 * from a 3-digit county FIPS as well as a 5-digit one (both callers pass 3),
 * and must show the source on every program it prints.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DATA = JSON.parse(read('data/resort-workforce-housing-programs.json'));
const GEO = JSON.parse(read('data/hna/geo-config.json'));
const squash = (s) => String(s).replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/\s+/g, ' ');
// Years are dates, not magnitudes; everything else must be quoted.
const FIGURE = /\$\d[\d,.]*|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b(?!\.\d)(?<!\.\d+)/g;

const programs = DATA.authorities.flatMap((a) => (a.key_programs || []).concat(a.funding || []).map((p) => [a, p]));

test('every program names a source and quotes it', () => {
  assert.ok(programs.length >= 40, `only ${programs.length} programs`);
  for (const [a, p] of programs) {
    assert.match(p.source_url || '', /^https:\/\//, `${a.id} / ${p.name}: no source`);
    assert.ok(Array.isArray(p.evidence) && p.evidence.length, `${a.id} / ${p.name}: no quotes`);
    assert.ok(p.evidence.every((e) => e.quote && e.quote.length > 10), `${a.id} / ${p.name}: empty quote`);
  }
});

test('every figure in a program summary or magnitude sits in that program\'s quotes', () => {
  let checked = 0;
  for (const [a, p] of programs) {
    const quoted = squash(p.evidence.map((e) => e.quote).join(' '));
    const text = squash(`${p.summary || ''} ${p.magnitude || ''}`);
    for (const raw of text.match(FIGURE) || []) {
      const fig = raw.replace(/[.,]$/, '');
      checked++;
      const bare = fig.replace(/^\$/, '');
      assert.ok(quoted.includes(fig) || quoted.includes(bare), `${a.id} / ${p.name}: ${fig} is in no quote`);
    }
  }
  assert.ok(checked >= 60, `the scan found only ${checked} figures to check`);
});

test('inventory counts are quoted, and nothing unsourced survives from the old file', () => {
  for (const a of DATA.authorities) {
    assert.equal(a.headline, undefined, `${a.id}: unsourced headline`);
    assert.equal(a.portfolio_size_units, undefined, `${a.id}: unsourced portfolio size`);
    assert.equal(a.developer_actions, undefined, `${a.id}: unsourced developer actions`);
    if (!a.inventory) continue;
    const units = typeof a.inventory.units === 'object' ? Object.values(a.inventory.units) : [a.inventory.units];
    for (const u of units) assert.ok(squash(a.inventory.quote).includes(Number(u).toLocaleString('en-US')), `${a.id}: ${u} not in its quote`);
    assert.match(a.inventory.source_url, /^https:\/\//);
  }
});

test('geographies are real 5- and 7-digit GEOIDs, and each town sits in its county', () => {
  const county = new Map([...GEO.places, ...GEO.cdps].map((g) => [g.geoid, g.containingCounty]));
  const counties = new Set(GEO.counties.map((c) => c.geoid));
  for (const a of DATA.authorities) {
    assert.ok(counties.has(a.county_fips), `${a.id}: county ${a.county_fips}`);
    assert.ok(['town', 'county'].includes(a.scope), `${a.id}: scope`);
    for (const g of a.place_geoids) assert.equal(county.get(g), a.county_fips, `${a.id}: ${g} is not in ${a.county_fips}`);
  }
});

test('the renderer matches by 3-digit county FIPS and prints each program\'s source', async () => {
  const dom = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only' });
  dom.window.fetch = async () => ({ ok: true, json: async () => structuredClone(DATA) });
  dom.window.eval(read('js/components/resort-wfh.js'));
  const m = dom.window.document.getElementById('m');
  const countyWide = DATA.authorities.find((a) => a.scope === 'county');
  const town = [...GEO.places, ...GEO.cdps].find((p) => p.containingCounty === countyWide.county_fips && !countyWide.place_geoids.includes(p.geoid)
    && !DATA.authorities.some((a) => a.place_geoids.includes(p.geoid)));
  assert.ok(town, 'no plain town in a county-wide authority\'s county to test with');
  await dom.window.ResortWfh.attach(m, { placeGeoid: town.geoid, countyFips: countyWide.county_fips.slice(-3) });
  assert.ok(m.textContent.includes(countyWide.name), `${town.label} does not get ${countyWide.name}`);
  const shown = m.querySelectorAll('.rw-program').length;
  assert.equal(m.querySelectorAll('.rw-program__src a').length, shown, 'a program rendered without its source');

  // A county page lists the town authorities inside it too.
  await dom.window.ResortWfh.attach(m, { countyFips: countyWide.county_fips.slice(-3) });
  for (const a of DATA.authorities.filter((x) => x.county_fips === countyWide.county_fips)) {
    assert.ok(m.textContent.includes(a.name), `county page misses ${a.name}`);
  }
});
