/**
 * Resort workforce housing programs (data/resort-workforce-housing-programs.json)
 * are pinned to their sources: every program names a source and carries
 * verbatim quotes, and every dollar, percent or count in its summary or
 * magnitude sits in one of those quotes. An inventory badge prints the
 * source's own words, qualifier included ("nearly", "over"). A town gets an
 * authority only when the authority's stated service area names it, never
 * because it shares a county. The renderer must find a county's authorities
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

test('inventory counts are quoted, the badge keeps the source\'s qualifier, and nothing unsourced survives', () => {
  let qualified = 0;
  for (const a of DATA.authorities) {
    assert.equal(a.headline, undefined, `${a.id}: unsourced headline`);
    assert.equal(a.portfolio_size_units, undefined, `${a.id}: unsourced portfolio size`);
    assert.equal(a.developer_actions, undefined, `${a.id}: unsourced developer actions`);
    if (!a.inventory) continue;
    const quote = squash(a.inventory.quote);
    const shown = a.inventory.display;
    assert.ok(Array.isArray(shown) && shown.length, `${a.id}: no display words`);
    for (const f of shown) assert.ok(quote.includes(f), `${a.id}: "${f}" is not the source's words`);
    const units = typeof a.inventory.units === 'object' ? Object.values(a.inventory.units) : [a.inventory.units];
    for (const u of units) {
      const n = Number(u).toLocaleString('en-US');
      assert.ok(quote.includes(n), `${a.id}: ${u} not in its quote`);
      assert.ok(shown.some((f) => f.includes(n)), `${a.id}: ${n} not in what the badge shows`);
      // A qualifier in front of the number in the source must be in front of it on the badge.
      const q = new RegExp(`\\b(nearly|over|approximately|about|more than|almost)\\s+${n}\\b`, 'i').exec(quote);
      if (q) { qualified++; assert.ok(shown.some((f) => f.toLowerCase().includes(q[0].toLowerCase())), `${a.id}: badge drops "${q[1]}"`); }
    }
    assert.match(a.inventory.source_url, /^https:\/\//);
  }
  assert.ok(qualified >= 3, `only ${qualified} qualified counts were checked`);
});

test('geographies are real GEOIDs, each served place sits in its county, and service areas are explicit', () => {
  const county = new Map([...GEO.places, ...GEO.cdps].map((g) => [g.geoid, g.containingCounty]));
  const counties = new Set(GEO.counties.map((c) => c.geoid));
  for (const a of DATA.authorities) {
    assert.ok(counties.has(a.county_fips), `${a.id}: county ${a.county_fips}`);
    assert.equal(a.scope, undefined, `${a.id}: county-wide coverage must be listed, not inferred from a scope flag`);
    assert.ok(Array.isArray(a.serves_place_geoids) && a.serves_place_geoids.length, `${a.id}: no service area`);
    for (const g of a.place_geoids) assert.ok(a.serves_place_geoids.includes(g), `${a.id}: does not serve its own town ${g}`);
    for (const g of a.serves_place_geoids) assert.equal(county.get(g), a.county_fips, `${a.id}: ${g} is not in ${a.county_fips}`);
  }
});

test('the renderer matches towns by service area, counties by 3-digit FIPS, and prints each program\'s source', async () => {
  const dom = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only' });
  dom.window.fetch = async () => ({ ok: true, json: async () => structuredClone(DATA) });
  dom.window.eval(read('js/components/resort-wfh.js'));
  const m = dom.window.document.getElementById('m');
  const places = [...GEO.places, ...GEO.cdps];
  const own = new Set(DATA.authorities.flatMap((a) => a.place_geoids));

  // A served town that is not the authority's home town still gets it.
  const wide = DATA.authorities.find((a) => a.serves_place_geoids.some((g) => !own.has(g)));
  const town = places.find((p) => wide.serves_place_geoids.includes(p.geoid) && !own.has(p.geoid));
  assert.ok(town, 'no served town outside an authority\'s home towns to test with');
  await dom.window.ResortWfh.attach(m, { placeGeoid: town.geoid, countyFips: wide.county_fips.slice(-3) });
  assert.ok(m.textContent.includes(wide.name), `${town.label} does not get ${wide.name}`);
  const shown = m.querySelectorAll('.rw-program').length;
  assert.equal(m.querySelectorAll('.rw-program__src a').length, shown, 'a program rendered without its source');

  // A town in an authority's county that its service area does not name gets nothing from it.
  const narrow = DATA.authorities.find((a) => places.some((p) => p.containingCounty === a.county_fips && !a.serves_place_geoids.includes(p.geoid)
    && !DATA.authorities.some((b) => b.serves_place_geoids.includes(p.geoid))));
  assert.ok(narrow, 'no unserved town in an authority\'s county to test with');
  const outside = places.find((p) => p.containingCounty === narrow.county_fips && !DATA.authorities.some((b) => b.serves_place_geoids.includes(p.geoid)));
  await dom.window.ResortWfh.attach(m, { placeGeoid: outside.geoid, countyFips: narrow.county_fips.slice(-3) });
  assert.equal(m.textContent.includes(narrow.name), false, `${outside.label} is shown ${narrow.name}, which does not serve it`);

  // A county page lists every authority inside it, and badges print the source's words.
  await dom.window.ResortWfh.attach(m, { countyFips: narrow.county_fips.slice(-3) });
  for (const a of DATA.authorities.filter((x) => x.county_fips === narrow.county_fips)) {
    assert.ok(m.textContent.includes(a.name), `county page misses ${a.name}`);
  }
  for (const a of DATA.authorities.filter((x) => x.inventory)) {
    await dom.window.ResortWfh.attach(m, { placeGeoid: a.serves_place_geoids[0], countyFips: a.county_fips });
    const badge = [...m.querySelectorAll('.rw-portfolio')].map((b) => b.textContent).join(' ');
    for (const f of a.inventory.display) assert.ok(badge.includes(f), `${a.id}: badge "${badge}" lacks "${f}"`);
  }
});
