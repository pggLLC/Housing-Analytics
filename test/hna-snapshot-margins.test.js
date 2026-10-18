'use strict';
/*
 * The HNA snapshot cards show the Census margin of error of the figure they
 * show, and the year and release that figure came from.
 *
 * Pinned to what the cards must agree with, not to copy:
 *   - data/hna/acs-reliability.json, built from the published margins
 *     (scripts/hna/build_acs_reliability.py). Every card of every one of its
 *     547 geographies is rendered by the real renderer (hna-renderers.js
 *     renderSnapshot) on the real page, from the real summary, and its source
 *     line must carry that entry's margin, tier, year and series exactly when
 *     the card's number is that entry's estimate, and no margin otherwise.
 *   - the file's own tiers: the shared rule (ACSReliability.tierForCv) must
 *     give every entry the tier the builder gave it, and the second-homes panel
 *     must use that rule's words for its own margins.
 *
 * Defects this pins: 33 geographies showing ACS 1-year figures linked to the
 * 5-year table, and Kremmling, Columbine CDP, Comanche Creek CDP and Copper
 * Mountain CDP showing 2023 figures labelled 2024, all because the label came
 * from one stamp per summary rather than from the figure.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const freshRequire = (rel) => {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
};

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) {
    failures += 1;
    console.error('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e));
  }
}

// ── The real page ────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/housing-needs-assessment.html' });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.URLSearchParams = dom.window.URLSearchParams;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const origAdd = dom.window.document.addEventListener.bind(dom.window.document);
dom.window.document.addEventListener = function (type, l, o) {
  if (type === 'DOMContentLoaded') return undefined;
  return origAdd(type, l, o);
};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.requestAnimationFrame = window.requestAnimationFrame;
window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
global.Chart = window.Chart = class { constructor() {} destroy() {} };
window.APP_CONFIG = { DATA_VERSION: 'test' };
let fetches = 0;
let reliabilityMissing = false;
window.fetch = async function (url) {
  const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '').split('?')[0];
  if (rel === 'data/hna/acs-reliability.json') {
    fetches += 1;
    if (reliabilityMissing) return { ok: false, status: 404, json: async () => null };
  }
  const abs = path.join(ROOT, rel);
  if (rel.startsWith('data/') && fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  }
  return { ok: false, status: 404, json: async () => null, text: async () => '' };
};
global.fetch = window.fetch;
window.fetchWithTimeout = (u, o) => window.fetch(u, o);
global.fetchWithTimeout = window.fetchWithTimeout;

const realWarn = console.warn;
console.warn = () => {};
freshRequire('js/transit-zone.js');
freshRequire('js/hna/hna-utils.js');
freshRequire('js/acs-reliability.js');
freshRequire('js/hna/hna-renderers.js');
freshRequire('js/hna/hna-controller.js');
console.warn = realWarn;

const R = window.HNARenderers;
const AR = window.ACSReliability;
const FILE = readJson('data/hna/acs-reliability.json');
const U = window.HNAUtils;

// The cards, the figure each shows and how its margin is written. The value
// is read the way the page reads it, from the summary.
const CARDS = [
  { id: 'statPopSrc', field: 'DP05_0001E', unit: 'count', table: 'DP05', value: (p) => U.safeNum(p.DP05_0001E) },
  { id: 'statMhiSrc', field: 'DP03_0062E', unit: 'money', table: 'DP03', value: (p) => U.safeNum(p.DP03_0062E) },
  { id: 'statRentSrc', field: 'DP04_0134E', unit: 'money', table: 'DP04', value: (p) => U.safeNum(p.DP04_0134E) },
  { id: 'statTenureSrc', field: 'DP04_0047PE', unit: 'pct', table: 'DP04', value: (p) => U.safeNum(p.DP04_0047PE) },
  { id: 'statRentBurdenSrc', field: 'rent_burden_30plus', unit: 'pct', table: 'DP04', value: (p) => U.rentBurden30Plus(p) },
  { id: 'statCommuteSrc', field: 'S0801_C01_046E', unit: 'min', table: 'S0801', value: (p, s) => (s ? U.safeNum(s.S0801_C01_046E) : null) },
  { id: 'statHomeValueSrc', field: 'DP04_0089E', unit: 'money', table: 'DP04',
    // Only the raw ACS value is the estimate the margin belongs to.
    value: (p) => { const h = U.homeValueInfo(p); return !h.display || h.display.source === 'acs_raw' ? h.value : null; } },
];

// The margin as the Census Bureau publishes it, written independently of the
// module under test.
function moeText(m, unit) {
  if (unit === 'money') return '±$' + Math.round(m).toLocaleString('en-US');
  if (unit === 'pct') return '±' + m.toFixed(1) + ' pts';
  if (unit === 'min') return '±' + m.toFixed(1) + ' min';
  return '±' + Math.round(m).toLocaleString('en-US');
}

function valueText(v, unit) {
  if (unit === 'money') return '$' + Math.round(v).toLocaleString('en-US');
  if (unit === 'pct') return v.toFixed(1) + '%';
  if (unit === 'min') return v.toFixed(1) + ' min';
  return Math.round(v).toLocaleString('en-US');
}

function geoTypeOf(geoid, summary) {
  return (summary.geo && summary.geo.type) || (geoid.length === 2 ? 'state' : geoid.length === 5 ? 'county' : 'place');
}

async function render(geoid, mutate) {
  const summary = readJson(`data/hna/summary/${geoid}.json`);
  const profile = summary.acsProfile;
  const s0801 = summary.acsS0801 || null;
  if (mutate) mutate(profile, s0801);
  profile._geoid = geoid;
  profile._geoType = geoTypeOf(geoid, summary);
  R.clearStats();
  const annotated = await R.renderSnapshot(profile, s0801, summary.geo && summary.geo.label, null);
  return { profile, s0801, annotated, geoType: profile._geoType };
}

const line = (id) => document.getElementById(id);

(async function main() {
  const geoids = Object.keys(FILE.geos);

  await test('every card agrees with the margins file, for every geography in it', async () => {
    let withMargin = 0; let checked = 0; let caution = 0; let relabelled = 0;
    const problems = [];
    for (const geoid of geoids) {
      if (!fs.existsSync(path.join(ROOT, `data/hna/summary/${geoid}.json`))) continue;
      const { profile, s0801, geoType } = await render(geoid);
      for (const c of CARDS) {
        const el = line(c.id);
        const text = el.textContent;
        const value = c.value(profile, s0801);
        const e = FILE.geos[geoid][c.field];
        const matches = e && e.e != null && value != null && Math.abs(value - e.e) < 0.051;
        checked += 1;
        if (!matches) {
          if (/±/.test(text)) problems.push(`${geoid} ${c.id}: margin shown for a number that is not the file's estimate: ${text}`);
          continue;
        }
        const link = el.querySelector('a');
        const series = e.s === 'acs1' ? '1Y' : '5Y';
        const prefix = c.table.startsWith('S') ? 'ACSST' : 'ACSDP';
        if (e.m == null) {
          if (!text.startsWith('margin not published')) problems.push(`${geoid} ${c.id}: no margin in the file, but the line says ${text}`);
        } else if (e.m === 0) {
          if (/±/.test(text)) problems.push(`${geoid} ${c.id}: a controlled total shows a margin: ${text}`);
        } else {
          withMargin += 1;
          if (!text.includes(moeText(e.m, c.unit))) problems.push(`${geoid} ${c.id}: file margin ${e.m}, line ${text}`);
          const tierWords = { good: null, fair: 'fair', use_with_caution: 'use with caution', zero_in_sample: 'none in the survey sample' }[e.t];
          if (tierWords && !text.includes(tierWords)) problems.push(`${geoid} ${c.id}: tier ${e.t} not said: ${text}`);
          if (!tierWords && /fair|caution|survey sample/.test(text)) problems.push(`${geoid} ${c.id}: good figure carries a tier: ${text}`);
          if (e.t === 'use_with_caution') {
            // A caution figure is shown as the range it stands for: the file's
            // estimate less and plus its margin, clipped at 0 (and 100%).
            caution += 1;
            const lo = valueText(Math.max(0, e.e - e.m), c.unit);
            const hi = valueText(c.unit === 'pct' ? Math.min(100, e.e + e.m) : e.e + e.m, c.unit);
            if (!text.includes(lo) || !text.includes(hi)) problems.push(`${geoid} ${c.id}: caution without the range ${lo} to ${hi}: ${text}`);
          }
        }
        if (el.dataset.acsTier !== (e.t || 'no_margin')) problems.push(`${geoid} ${c.id}: data-acs-tier ${el.dataset.acsTier}, file ${e.t}`);
        // The raw ACS home value keeps the cascade's caveat, with its confidence.
        const hv = c.id === 'statHomeValueSrc' && U.homeValueInfo(profile).display;
        if (hv && !text.includes(`${hv.confidence} confidence`)) problems.push(`${geoid} ${c.id}: caveat lost: ${text}`);
        // Every line, the raw home value's included, is labelled and linked
        // from the figure's own year and series.
        const label = `ACS ${e.y} ${e.s === 'acs1' ? '1-year' : '5-year'} ${c.table}`;
        if (!text.includes(label)) problems.push(`${geoid} ${c.id}: label should say "${label}": ${text}`);
        const want = `https://data.census.gov/table/${prefix}${series}${e.y}.${c.table}`;
        if (!link || !link.href.startsWith(want)) problems.push(`${geoid} ${c.id}: link ${link && link.href}, want ${want}`);
        else if (!link.href.endsWith(`?g=${{ state: '0400000US', county: '0500000US' }[geoType] || '1600000US'}${geoid}`)) {
          problems.push(`${geoid} ${c.id}: link is not for this geography: ${link.href}`);
        }
        if (`${e.y}/${e.s}` !== `${profile._acsYear}/${profile._acsSeries}` && c.table !== 'S0801') relabelled += 1;
      }
    }
    assert.deepStrictEqual(problems.slice(0, 15), [], `${problems.length} disagreements`);
    // Non-vacuity on the scan: it rendered real cards, found margins in every
    // tier and found the mislabelled figures this was written for.
    assert(checked >= 3500, `only ${checked} cards checked`);
    assert(withMargin >= 2000, `only ${withMargin} margins checked`);
    assert(caution >= 300, `only ${caution} caution figures checked`);
    assert(relabelled >= 30, `only ${relabelled} figures had a year or series different from the summary stamp`);
  });

  await test('Denver links its 1-year figures to the 1-year table; Kremmling labels its 2023 figures 2023', async () => {
    await render('08031');
    assert.match(line('statMhiSrc').textContent, /ACS 2024 1-year DP03/);
    assert.match(line('statMhiSrc').querySelector('a').href, /ACSDP1Y2024\.DP03/);
    assert(!/±/.test(line('statPopSrc').textContent), 'a county population is controlled and has no margin');
    await render('0841560');
    assert.match(line('statMhiSrc').textContent, /ACS 2023 5-year DP03/);
    assert.match(line('statCommuteSrc').textContent, /ACS 2024 5-year S0801/);
  });

  await test('a number that is not the file\'s estimate gets no margin and keeps its label', async () => {
    const before = await render('0805265');
    assert(before.annotated >= 6, `Bayfield annotated ${before.annotated} cards`);
    assert(/±/.test(line('statMhiSrc').textContent));
    await render('0805265', (p) => { p.DP03_0062E += 1000; });
    assert(!/±/.test(line('statMhiSrc').textContent), line('statMhiSrc').textContent);
    assert.match(line('statMhiSrc').textContent, /^ACS 2024 DP03/);
    assert(/±/.test(line('statRentSrc').textContent), 'the other cards keep their margins');
  });

  await test('Bayfield: renter cost burden is read as a range; a Zillow home value has no margin', async () => {
    await render('0805265');
    const e = FILE.geos['0805265'].rent_burden_30plus;
    assert.strictEqual(e.t, 'use_with_caution');
    const t = line('statRentBurdenSrc').textContent;
    assert(t.includes(`${(e.e - e.m).toFixed(1)}%`) && t.includes(`${(e.e + e.m).toFixed(1)}%`), t);
    assert(!/±/.test(line('statHomeValueSrc').textContent), line('statHomeValueSrc').textContent);
  });

  await test('a reset takes the previous geography\'s margins with its figures', async () => {
    await render('0805265');
    const shown = [...document.querySelectorAll('[data-acs-tier]')];
    assert(shown.length >= 6, `only ${shown.length} cards carried a margin`);
    R.clearStats();
    for (const el of shown) {
      assert(!/±/.test(el.textContent), `${el.id} keeps "${el.textContent}" after the figures were cleared`);
    }
  });

  await test('a margins file that arrives after the next geography is picked writes nothing', async () => {
    AR._setFile(null);
    const summary = readJson('data/hna/summary/0805265.json');
    const p = Object.assign({}, summary.acsProfile, { _geoid: '0805265', _geoType: 'place' });
    const pending = R.renderSnapshot(p, summary.acsS0801, 'Bayfield', null);
    R.clearStats();
    assert.strictEqual(await pending, 0);
    assert(!/±/.test(line('statMhiSrc').textContent));
  });

  await test('without the margins file the cards keep their source lines', async () => {
    AR._setFile(null);
    reliabilityMissing = true;
    const before = fetches;
    const { annotated } = await render('0805265');
    reliabilityMissing = false;
    assert(fetches > before, 'the page never asked for the margins file');
    assert.strictEqual(annotated, 0);
    assert.match(line('statMhiSrc').textContent, /^ACS 2024 DP03 · \[Source\]$/);
    assert(!/±/.test(document.querySelector('.stats').textContent));
    AR._setFile(FILE);
  });

  await test('the shared tier rule gives every entry in the file its tier', async () => {
    let n = 0;
    const off = [];
    for (const [geoid, g] of Object.entries(FILE.geos)) {
      for (const [field, e] of Object.entries(g)) {
        if (e.cv == null || e.m === 0 || [0.15, 0.30].some((x) => Math.abs(e.cv - x) < 1e-4)) continue;
        n += 1;
        if (AR.tierForCv(e.cv) !== e.t) off.push(`${geoid} ${field} cv ${e.cv}: file ${e.t}, rule ${AR.tierForCv(e.cv)}`);
      }
    }
    assert.deepStrictEqual(off.slice(0, 10), []);
    assert(n > 4000, `only ${n} entries compared`);
  });

  await test('the second-homes panel uses the same words for the same margins', async () => {
    const data = readJson('data/hna/second-homes-str.json');
    const w = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only' }).window;
    w.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(data)) });
    w.eval(fs.readFileSync(path.join(ROOT, 'js/components/second-homes-panel.js'), 'utf8'));
    const m = w.document.getElementById('m');
    const recs = Object.values(data.geographies).filter((r) => r.seasonal_homes && r.seasonal_homes.units > 0);
    const words = { good: null, fair: 'Fair reliability', use_with_caution: 'Use with caution' };
    const seen = new Set();
    for (const tier of Object.keys(words)) {
      const r = recs.find((x) => {
        const cv = (x.seasonal_homes.moe / 1.645) / x.seasonal_homes.units;
        return AR.tierForCv(cv) === tier && [0.15, 0.30].every((b) => Math.abs(cv - b) > 1e-3);
      });
      assert(r, `no seasonal-homes record in the ${tier} tier`);
      await w.SecondHomesPanel.attach(m, { geoid: r.geoid, geoType: r.level });
      const caution = m.querySelector('.shp-caution');
      if (words[tier] === null) assert(!caution, `${r.geoid}: a good figure carries "${caution && caution.textContent}"`);
      else assert(caution && caution.textContent.startsWith(words[tier]), `${r.geoid} (${tier}): ${caution && caution.textContent}`);
      assert(!/unreliable/i.test(m.textContent), `${r.geoid}: the panel says "unreliable", a word the site's scale does not use`);
      seen.add(tier);
    }
    assert.strictEqual(seen.size, 3);
  });

  if (failures) {
    console.error(`\n${failures} failing`);
    process.exit(1);
  }
  console.log('\nall snapshot margin checks passed');
  process.exit(0);
})();
