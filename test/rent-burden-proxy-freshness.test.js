'use strict';
/**
 * A rent burden reliability note never reads a wider area's ACS 1-year rate as
 * this geography's market movement (2026-10-18 live walk).
 *
 * Hinsdale has no ACS 1-year figure, so the cross-check carries the state's
 * as a proxy. The module set it against Hinsdale's own CHAS rate (23% against
 * 53%) and said "Newer ACS 1-year shows market has moved materially (30.3pp
 * gap)". That is a gap between two places, and 342 small counties and places
 * carried a note like it. Movement is now measured where the 1-year figure
 * is: the proxy's 1-year rate against its own 5-year rate.
 *
 * Checked against data/processed/rent_burden_crosscheck.json for every
 * geography, so the note's level, amount and direction must agree with the
 * file, whatever its wording.
 *
 * Run: node test/rent-burden-proxy-freshness.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CROSS = JSON.parse(read('data/processed/rent_burden_crosscheck.json'));
const SOURCES = JSON.parse(read('data/metadata/rent_burden_sources.json'));

function load(cross) {
  const w = {
    fetch: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('crosscheck') ? cross : SOURCES) }),
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('js/rent-burden-reliability.js'), w);
  return w.RentBurdenReliability;
}

const pp = (a, b) => Math.abs(a - b) * 100;
const up = /\b(above|higher|up|understate)\b/;
const down = /\b(below|lower|down|overstate)\b/;

(async () => {
  let failures = 0;
  async function test(name, fn) {
    try { await fn(); console.log('  ok  ' + name); } catch (e) { failures += 1; console.log('  FAIL ' + name + '\n       ' + e.message); }
  }

  await test('a proxy is compared only with itself, and its note says whose figure it is', async () => {
    const api = load(CROSS);
    let proxies = 0;
    for (const [gid, entry] of Object.entries(CROSS.geos)) {
      for (const metric of ['renter_cb30', 'renter_cb50']) {
        const m = entry[metric];
        if (!m || !m.acs1 || !m.acs1.isProxy || !m.chas) continue;
        const r = await api.computeReliability({ geoid: gid, metric });
        const proxy = (CROSS.geos[m.acs1.proxyGeoid] || {})[metric] || {};
        const base = proxy.acs5;
        const note = r.notes.find((n) => /1-year/.test(n)) || '';
        const where = m.acs1.proxyKind === 'state' ? 'statewide' : 'county';
        assert(note.includes(where), `${gid} ${metric}: the 1-year note does not say it is the ${where} figure: ${note}`);
        if (!base || base.rate == null) continue;
        proxies += 1;
        const gap = pp(m.acs1.rate, base.rate);
        assert(Math.abs(r.freshness.gap_pp - gap) < 1e-9, `${gid} ${metric}: movement ${r.freshness.gap_pp} is not the ${where} 1-year against its 5-year (${gap})`);
        assert(note.includes(gap.toFixed(1)), `${gid} ${metric}: note does not give the ${where} movement ${gap.toFixed(1)}: ${note}`);
        const geographyGap = pp(m.chas.rate, m.acs1.rate).toFixed(1);
        if (geographyGap !== gap.toFixed(1)) {
          assert(!note.includes(geographyGap + 'pp'), `${gid} ${metric}: note gives the gap between two places (${geographyGap}pp): ${note}`);
        }
        const dir = m.acs1.rate >= base.rate ? up : down;
        const wrong = m.acs1.rate >= base.rate ? down : up;
        assert(dir.test(note) && !wrong.test(note), `${gid} ${metric}: direction of the ${where} change is wrong: ${note}`);
      }
    }
    assert(proxies > 100, `the scan found ${proxies} proxied geographies`);
  });

  await test("a direct 1-year note's direction agrees with the file", async () => {
    const api = load(CROSS);
    let direct = 0;
    for (const [gid, entry] of Object.entries(CROSS.geos)) {
      for (const metric of ['renter_cb30', 'renter_cb50']) {
        const m = entry[metric];
        if (!m || !m.acs1 || m.acs1.isProxy || !m.chas || m.acs1.rate == null) continue;
        direct += 1;
        const r = await api.computeReliability({ geoid: gid, metric });
        assert(Math.abs(r.freshness.gap_pp - pp(m.chas.rate, m.acs1.rate)) < 1e-9, `${gid} ${metric}: direct movement`);
        const note = r.notes.find((n) => /understate|overstate/.test(n));
        if (!note) continue;
        assert((m.acs1.rate >= m.chas.rate ? /understate/ : /overstate/).test(note), `${gid} ${metric}: ${note}`);
      }
    }
    assert(direct > 10, `the scan found ${direct} direct 1-year geographies`);
  });

  await test('a proxy with no earlier rate of its own reports movement as unknown', async () => {
    const cross = JSON.parse(JSON.stringify(CROSS));
    const gid = Object.keys(cross.geos).find((g) => {
      const a = cross.geos[g].renter_cb30 && cross.geos[g].renter_cb30.acs1;
      return a && a.isProxy && a.proxyKind === 'state';
    });
    cross.geos[cross.geos[gid].renter_cb30.acs1.proxyGeoid].renter_cb30.acs5 = null;
    const r = await load(cross).computeReliability({ geoid: gid, metric: 'renter_cb30' });
    assert.strictEqual(r.freshness.tier, 'insufficient');
    assert.strictEqual(r.freshness.gap_pp, null);
    const note = r.notes.find((n) => /1-year/.test(n));
    assert(/statewide/.test(note) && /unknown/.test(note) && !/\d+\.\dpp/.test(note), note);
  });

  await test('a low badge shows what limits the figure first', async () => {
    // The HNA strip shows the first two notes; Hinsdale's badge is low for its
    // margin of error and small denominator, so those lead.
    const r = await load(CROSS).computeReliability({ geoid: '08053', metric: 'renter_cb30' });
    assert.strictEqual(r.combined, 'low');
    const flagged = ['high_margin_of_error', 'denominator_small'].filter((f) => r.flags.includes(f));
    assert(flagged.length > 0, 'Hinsdale carries a quality flag');
    assert(r.notes.slice(0, flagged.length).every((n) => /margin of error|denominator/i.test(n)), r.notes.join(' | '));
  });

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall rent burden proxy checks passed');
})();
