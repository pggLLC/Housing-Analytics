#!/usr/bin/env node
'use strict';
// The market test on the Deal Calculator (workbook piece 7): the calculator's homes by band and size against the
// renters who qualify, counted by the site's own engine, with the deal hub's capture check. Deal figures are invented.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));

// The module's pure parts, without a page.
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('js/market-analysis-scoring.js'), ctx);
ctx.window = ctx;
vm.runInContext(read('js/components/dc-market-test.js'), ctx);
const M = ctx.DcMarketTest;
const E = ctx.PMAMarketScoring;

// The deal hub's own check, loaded with the two globals it reads at start-up.
const hub = { LabShell: { esc: (s) => String(s) }, LabProjects: {}, console, document: { getElementById: () => null, addEventListener() {} } };
hub.globalThis = hub; hub.window = hub;
vm.createContext(hub);
vm.runInContext(read('hub/start-numbers.js'), hub);

const data = { demand: json(M.FILES.demand), acs: json(M.FILES.acs), sizes: json(M.FILES.sizes), limits: json(M.FILES.limits) };

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } finally { close(); }
}

(async () => {
  await test('homes by band and size from the priced rows; market rows, 4BR and bands over 80% handled', () => {
    const h = M.homesFrom([
      { tier: 30, bedrooms: '1BR', units: 6 }, { tier: 60, bedrooms: '2BR', units: 20 }, { tier: 60, bedrooms: '4BR', units: 2 },
      { tier: 60, bedrooms: 'efficiency', units: 4 }, { tier: 100, bedrooms: '2BR', units: 5 }, { tier: 'market', bedrooms: '2BR', units: 8 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(h.byBand)), { 30: 6, 60: 26 });
    assert.deepEqual(JSON.parse(JSON.stringify(h.cell)), { 30: { '1br': 6 }, 60: { '2br': 20, '0br': 4 } });
    assert.deepEqual(Array.from(h.bedrooms), ['0br', '1br', '2br']);
    assert.deepEqual(Array.from(h.over), [100]);
    assert.equal(h.noRule, 2);
  });

  await test('the capture check matches the deal hub’s, row for row', () => {
    const cases = [
      [{ 30: 6, 60: 40 }, { 20: 300, 30: 500, 40: 800, 50: 1100, 60: 220, 70: 1500, 80: 1800 }],
      [{ 40: 10, 50: 30 }, { 20: 0, 30: 50, 40: 60, 50: 100 }],
      [{ 60: 5 }, { 30: 0, 40: 0, 50: 0, 60: 0 }]
    ];
    for (const [by, pool] of cases) {
      assert.deepEqual(JSON.parse(JSON.stringify(M.captureCheck(by, pool))), JSON.parse(JSON.stringify(hub.LabStart.captureCheck(by, pool))));
    }
    assert.equal(M.GOOD, hub.LabStart.GOOD);
    assert.equal(M.VERY_THIN, hub.LabStart.VERY_THIN);
  });

  await test('saved market areas: this county only, live ones only, newest first, storage read only', () => {
    const store = {
      'coho-lab.projects': JSON.stringify([{ projectId: 'p1' }, { projectId: 'p2' }, { projectId: 'gone' }]),
      'coho-lab.project.p1': JSON.stringify({ projectId: 'p1', name: 'Test A', attachments: [
        { attachmentId: 'a1', kind: 'market-snapshot', state: 'replaced', attachedAt: '2026-11-01', snapshot: { tracts: ['08077000100'], countyFips: '08077' } },
        { attachmentId: 'a2', kind: 'market-snapshot', attachedAt: '2026-11-20', snapshot: { tracts: ['08077000200', '08077000300'], countyFips: '08077', areaLabel: 'Drive area' } },
        { attachmentId: 'a3', kind: 'market-snapshot', state: 'stale', attachedAt: '2026-11-22', snapshot: { tracts: ['08077000400'], countyFips: '08077' } }] }),
      'coho-lab.project.p2': JSON.stringify({ projectId: 'p2', name: 'Test B', attachments: [
        { attachmentId: 'b1', kind: 'market-snapshot', attachedAt: '2026-11-24', snapshot: { tracts: ['08077000500'], areaLabel: 'Radius' } },
        { attachmentId: 'b2', kind: 'market-snapshot', attachedAt: '2026-11-25', snapshot: { tracts: ['08013012101'], countyFips: '08013' } }] })
    };
    const writes = [];
    const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) };
    const got = M.savedAreas(storage, '08077');
    assert.deepEqual(Array.from(got, (a) => a.label), ['Radius', 'Drive area']);
    assert.equal(got[1].project, 'Test A');
    assert.deepEqual(Array.from(M.savedAreas(storage, '08013'), (a) => a.tracts[0]), ['08013012101']);
    assert.deepEqual(writes, []);
    assert.equal(M.savedAreas(null, '08077').length, 0);
  });

  await test('the renter count is the engine’s own count for the same tracts, bands and sizes', () => {
    const fips = '08077';
    const tracts = Object.keys(data.demand.tracts).filter((g) => g.slice(0, 5) === fips);
    const rec = data.limits.counties.find((c) => c.fips === fips);
    const bands = M.bandsFor(rec, { 30: 6, 60: 40 });
    assert.ok(bands.includes(30) && bands.includes(60) && bands.every((b) => b <= 80));
    const cnt = M.countRenters(E, data, tracts, bands, { 30: ['1br'], 60: ['2br'] }, ['1br', '2br']);
    const limits = {}; data.limits.counties.forEach((c) => { limits[c.fips] = c; });
    const idx = {}; data.acs.tracts.forEach((m) => { idx[m.geoid] = m; });
    const direct = E.chfaQualifiedRenters(data.demand, limits, tracts.map((g) => ({ geoid: g })), [60], ['2br'], { acsIdx: idx, sizeIdx: data.sizes.tracts });
    assert.ok(direct.value > 0);
    assert.equal(cnt.pool[60], direct.value);
    assert.deepEqual(JSON.parse(JSON.stringify(cnt.bySize[60])), JSON.parse(JSON.stringify(direct.byBedroom)));
    assert.equal(cnt.tracts, tracts.length);
    // A band with no homes, one a weak band could step down to, is counted for every size the deal offers.
    const both = E.chfaQualifiedRenters(data.demand, limits, tracts.map((g) => ({ geoid: g })), [50], ['1br', '2br'], { acsIdx: idx, sizeIdx: data.sizes.tracts });
    assert.equal(cnt.pool[50], both.value);
    // Counting the 60% band for the 30% band's one-bedrooms too would add renters no 60% home fits (Codex P1, #3016).
    const wide = E.chfaQualifiedRenters(data.demand, limits, tracts.map((g) => ({ geoid: g })), [60], ['1br', '2br'], { acsIdx: idx, sizeIdx: data.sizes.tracts });
    assert.ok(wide.value > cnt.pool[60]);
  });

  await test('a step-down is tested for the sizes of the homes that would move (Codex P1 on #3016)', () => {
    const fips = '08077';
    const tracts = Object.keys(data.demand.tracts).filter((g) => g.slice(0, 5) === fips);
    const h = M.homesFrom([{ tier: 30, bedrooms: '1BR', units: 6 }, { tier: 60, bedrooms: '2BR', units: 100 }]);
    const cnt = M.countRenters(E, data, tracts, M.bandsFor(data.limits.counties.find((c) => c.fips === fips), h.byBand), h.sizesByBand, h.bedrooms);
    const chk = M.captureCheck(h.byBand, cnt.pool, { sizesByBand: h.sizesByBand, poolFor: cnt.poolFor });
    const sixty = chk.rows.find((r) => r.band === 60);
    assert.notEqual(sixty.level, 'good');
    // Whatever band it names, the 100 two-bedrooms there stay at 10% of that band's renters a two-bedroom fits.
    if (sixty.down) assert.ok(100 / cnt.poolFor(sixty.down.band, ['2br']) <= M.GOOD + 1e-9, JSON.stringify(sixty.down));
    // Counting every size the deal offers at 50% would have promised a move there.
    assert.ok(100 / cnt.poolFor(50, ['1br', '2br']) <= M.GOOD && 100 / cnt.poolFor(50, ['2br']) > M.GOOD);
  });

  // The panel's state must agree with the capture check run here on the same homes and county, for a deal that
  // passes and one that does not (Codex P1 on #3016: no fixed wording is pinned).
  async function pageCase(name, homes) {
    await test('on the page, ' + name + ': the panel agrees with the capture check', async () => {
      const p = await openPage('', null, {});
      assert.deepEqual(p.errors, []);
      const det = p.d.getElementById('dc-market-test');
      assert.ok(det, 'the panel draws into its mount');
      assert.equal(det.closest('#dc-market-test-mount').dataset.dcMode, 'rental');
      assert.equal(det.open, false);
      setField(p, 'dc-county-select', '08077');
      for (const t of p.w.__DealCalc.getAmiBands()) {
        p.d.getElementById('dc-chk-' + t).checked = homes.some((h) => h.tier === t);
        p.d.getElementById('dc-units-' + t).value = 0;
        for (const br of ['studio', '1br', '2br', '3br', '4br']) { const el = p.d.getElementById('dc-units-' + t + '-' + br); if (el) el.value = 0; }
      }
      for (const h of homes) p.d.getElementById('dc-units-' + h.tier + '-' + h.br).value = h.units;
      setField(p, 'dc-unit-mix-source', 'manual');
      setField(p, 'dc-units', homes.reduce((t, h) => t + h.units, 0));
      det.open = true;
      det.dispatchEvent(new p.w.Event('toggle'));
      const body = p.d.getElementById('dc-mt-body'), flag = p.d.getElementById('dc-mt-flag');
      const end = Date.now() + 20000;
      while (Date.now() < end && !body.querySelector('table')) await new Promise((r) => setTimeout(r, 100));
      const tables = body.querySelectorAll('table');
      assert.equal(tables.length, 2, body.textContent);

      // The same check, run here from the calculator's rows on the county's tracts.
      const h = M.homesFrom(p.w.__DealCalc.getResult().pricedRows);
      const tracts = Object.keys(data.demand.tracts).filter((g) => g.slice(0, 5) === '08077');
      const bands = M.bandsFor(data.limits.counties.find((c) => c.fips === '08077'), h.byBand);
      const cnt = M.countRenters(E, data, tracts, bands, h.sizesByBand, h.bedrooms);
      const chk = hub.LabStart.captureCheck(JSON.parse(JSON.stringify(h.byBand)), cnt.pool);
      const rows = Array.from(tables[0].querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children, (c) => c.textContent));
      assert.deepEqual(rows.map((r) => r[0]), Array.from(chk.rows, (r) => r.band + '%'));
      chk.rows.forEach((r, i) => {
        assert.equal(rows[i][1], r.homes.toLocaleString('en-US'));
        assert.equal(rows[i][2], Math.round(r.renters).toLocaleString('en-US'));
        assert.ok(rows[i][3].startsWith((Math.round(r.share * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%'), rows[i][3]);
        assert.equal(rows[i][3].includes('thin'), r.level !== 'good');
      });
      assert.equal(flag.getAttribute('data-weak'), Array.from(chk.weak, (r) => r.band).join(','));
      assert.equal(!!body.querySelector('[role="note"]'), chk.weak.length > 0, 'the weak-capture warning shows only when a band is weak');
      chk.weak.forEach((r) => assert.ok(flag.textContent.includes(r.band + '%'), flag.textContent));
      assert.ok(body.querySelector('a[href="deal-hub.html#/market?g=08077"]'));
      assert.deepEqual(p.errors, []);
      return chk;
    });
  }
  await pageCase('a small deal', [{ tier: 30, br: '1br', units: 6 }, { tier: 60, br: '2br', units: 30 }]);
  await pageCase('a deal too big for its 30% renters', [{ tier: 30, br: '1br', units: 150 }, { tier: 60, br: '2br', units: 30 }]);
  // The second case must really be weak, or it tests nothing.
  {
    const h = M.homesFrom([{ tier: 30, bedrooms: '1BR', units: 150 }, { tier: 60, bedrooms: '2BR', units: 30 }]);
    const tracts = Object.keys(data.demand.tracts).filter((g) => g.slice(0, 5) === '08077');
    const cnt = M.countRenters(E, data, tracts, M.bandsFor(data.limits.counties.find((c) => c.fips === '08077'), h.byBand), h.sizesByBand, h.bedrooms);
    await test('the weak case is weak', () => assert.ok(M.captureCheck(h.byBand, cnt.pool).weak.some((r) => r.band === 30)));
  }

  if (failed) { console.error(failed + ' failed'); process.exit(1); }
  console.log('dc-market-test: all passed');
})();
