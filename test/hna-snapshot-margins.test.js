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
// Set by a test to answer Census API requests: url -> [header, row].
let censusAnswer = null;
window.fetch = async function (url) {
  if (censusAnswer && new URL(String(url), 'http://localhost/').hostname === 'api.census.gov') {
    const rows = censusAnswer(String(url));
    return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
  }
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
  // Only the raw ACS value is an estimate a margin belongs to. The cascade's
  // copy of it can be another release than the stored DP04_0089E, so the file
  // has an entry for the figure shown as well.
  { id: 'statHomeValueSrc', fields: ['median_home_value', 'DP04_0089E'], unit: 'money', table: 'DP04',
    value: (p) => { const h = U.homeValueInfo(p); return !h.display || h.display.source === 'acs_raw' ? h.value : null; } },
];

// The entry whose estimate is the number a card shows, or null.
function entryFor(geoid, c, value) {
  const g = FILE.geos[geoid] || {};
  return (c.fields || [c.field]).map((f) => g[f])
    .find((e) => e && e.e != null && value != null && Math.abs(value - e.e) < 0.051) || null;
}

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

// What a 1-year figure's 5-year line must say, from the file and written
// independently of the module: the twin's period and estimate, its margin,
// and how far the figure shown is from it, in which direction. The wording
// around those is the page's to choose.
function fiveProblems(e, unit, got) {
  const f = e.five;
  const diff = e.e - f.e;
  const amount = moeText(Math.abs(diff), unit).slice(1);
  const out = [];
  if (!got.startsWith(`5-year ${f.y - 4}–${f.y}`)) out.push(`period ${f.y - 4}–${f.y}`);
  if (!got.includes(valueText(f.e, unit))) out.push(`estimate ${valueText(f.e, unit)}`);
  if (f.m > 0 && !got.includes(moeText(f.m, unit))) out.push(`margin ${moeText(f.m, unit)}`);
  if (f.m === 0 && /±/.test(got)) out.push('no margin for a controlled total');
  if (Math.abs(diff) < 0.051) {
    if (!/same/.test(got) || /higher|lower/.test(got)) out.push('the same figure');
  } else if (!got.includes(`${amount} ${diff > 0 ? 'higher' : 'lower'}`)) {
    out.push(`${amount} ${diff > 0 ? 'higher' : 'lower'}`);
  }
  return out;
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
  const PICK = {};

  await test('every card agrees with the margins file, for every geography in it', async () => {
    let withMargin = 0; let checked = 0; let caution = 0;
    const problems = [];
    for (const geoid of geoids) {
      if (!fs.existsSync(path.join(ROOT, `data/hna/summary/${geoid}.json`))) continue;
      const { profile, s0801, geoType } = await render(geoid);
      for (const c of CARDS) {
        const el = line(c.id);
        // The figure's own line; a 1-year figure's 5-year twin is checked apart.
        const fiveEl = el.querySelector('.acs-five');
        const text = fiveEl ? el.textContent.replace(fiveEl.textContent, '') : el.textContent;
        const value = c.value(profile, s0801);
        const e = entryFor(geoid, c, value);
        checked += 1;
        if (!e || !e.y) {
          // No estimate in the file is this number, or it matched no published
          // one: the card keeps its own source line.
          if (/±|margin not published/.test(text)) problems.push(`${geoid} ${c.id}: margin shown for a number with no published source: ${text}`);
          if (el.dataset.acsTier !== undefined) problems.push(`${geoid} ${c.id}: data-acs-tier set without an entry`);
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
        if (!e.five) {
          if (fiveEl) problems.push(`${geoid} ${c.id}: a 5-year line with no twin in the file: ${fiveEl.textContent}`);
        } else {
          const got = fiveEl ? fiveEl.textContent : '';
          const off = fiveProblems(e, c.unit, got);
          if (off.length) problems.push(`${geoid} ${c.id}: 5-year line "${got}" lacks ${off.join(', ')}`);
        }
      }
      // Geographies for the cases below, picked from the data rather than by name.
      const t = (f) => (FILE.geos[geoid][f] || {});
      if (!PICK.margins && t('DP03_0062E').m > 0 && t('DP04_0134E').m > 0 && profile.DP03_0062E === t('DP03_0062E').e) PICK.margins = geoid;
      if (!PICK.caution && t('rent_burden_30plus').t === 'use_with_caution' && /±/.test(line('statRentBurdenSrc').textContent)) PICK.caution = geoid;
      const hd = U.homeValueInfo(profile).display;
      if (!PICK.zillow && hd && hd.source === 'zhvi' && t('DP04_0089E').m > 0) PICK.zillow = geoid;
      if (!PICK.rawHome && hd && hd.source === 'acs_raw' && /±/.test(line('statHomeValueSrc').textContent)) PICK.rawHome = geoid;
      if (!PICK.oneYear && t('DP04_0134E').s === 'acs1' && t('rent_burden_30plus').s === 'acs1'
        && /±/.test(line('statRentSrc').textContent) && /±/.test(line('statRentBurdenSrc').textContent)) PICK.oneYear = geoid;
    }
    assert.deepStrictEqual(problems.slice(0, 15), [], `${problems.length} disagreements`);
    // Non-vacuity on the scan: it rendered real cards and found margins and
    // caution figures to check.
    assert(checked >= 3500, `only ${checked} cards checked`);
    assert(withMargin >= 2000, `only ${withMargin} margins checked`);
    assert(caution >= 300, `only ${caution} caution figures checked`);
    for (const k of ['margins', 'caution', 'zillow', 'rawHome', 'oneYear']) assert(PICK[k], `the scan found no ${k} case`);
  });

  await test('the label comes from the figure, not from the summary\'s stamp', async () => {
    // A stamp that disagrees with every entry: another year, the other series.
    const g = PICK.margins;
    const e = FILE.geos[g].DP03_0062E;
    const wrongYear = String(e.y - 3);
    const wrongSeries = e.s === 'acs1' ? 'acs5' : 'acs1';
    await render(g, (p) => { p._acsYear = wrongYear; p._acsSeries = wrongSeries; });
    const text = line('statMhiSrc').textContent;
    const series = e.s === 'acs1' ? '1-year' : '5-year';
    assert(text.includes(`ACS ${e.y} ${series} DP03`), text);
    assert(!text.includes(wrongYear), `the stamp's year reached the label: ${text}`);
    assert(line('statMhiSrc').querySelector('a').href.includes(`ACSDP${e.s === 'acs1' ? '1Y' : '5Y'}${e.y}.DP03`));
  });

  await test('a number that is not the file\'s estimate gets no margin and keeps its label', async () => {
    const g = PICK.margins;
    const { profile } = await render(g, (p) => { p.DP03_0062E += 1000; });
    assert(!/±/.test(line('statMhiSrc').textContent), line('statMhiSrc').textContent);
    assert(line('statMhiSrc').textContent.startsWith(`ACS ${profile._acsYear} DP03`), line('statMhiSrc').textContent);
    assert(/±/.test(line('statRentSrc').textContent), 'the other cards keep their margins');
  });

  await test('a caution figure is read as a range; a Zillow home value has no margin', async () => {
    await render(PICK.caution);
    const e = FILE.geos[PICK.caution].rent_burden_30plus;
    const t = line('statRentBurdenSrc').textContent;
    assert(t.includes(`${Math.max(0, e.e - e.m).toFixed(1)}%`) && t.includes(`${Math.min(100, e.e + e.m).toFixed(1)}%`), t);
    await render(PICK.zillow);
    assert(!/±/.test(line('statHomeValueSrc').textContent), line('statHomeValueSrc').textContent);
  });

  await test('a raw home value from another release than the stored one is labelled from its own entry', async () => {
    // The cascade's copy of DP04_0089E was taken from an older release.
    const g = PICK.rawHome;
    const stored = FILE.geos[g].DP04_0089E;
    const shownValue = stored.e + 77300;
    const older = { e: shownValue, m: 41234, s: 'acs5', y: stored.y - 1, cv: 0.03, t: 'good' };
    const shift = (p) => { p.median_home_value = Object.assign({}, p.median_home_value, { value: shownValue }); };
    const withEntry = (entry) => AR._setFile(Object.assign({}, FILE, {
      geos: Object.assign({}, FILE.geos, { [g]: Object.assign({}, FILE.geos[g], { median_home_value: entry }) }),
    }));
    try {
      withEntry(older);
      const { profile } = await render(g, shift);
      let text = line('statHomeValueSrc').textContent;
      assert(text.includes('±$41,234'), text);
      assert(text.includes(`ACS ${older.y} 5-year DP04`), text);
      assert(!text.includes(`±$${Math.round(stored.m).toLocaleString('en-US')}`), `the stored figure's margin reached the shown one: ${text}`);
      assert(line('statHomeValueSrc').querySelector('a').href.includes(`ACSDP5Y${older.y}.DP04`));
      assert(text.includes(`${U.homeValueInfo(profile).confidence} confidence`), `caveat lost: ${text}`);
      // An entry that matched no release names no source and shows no margin.
      withEntry({ e: shownValue, m: null, s: null, cv: null, t: null, why: 'stored value matches no published estimate' });
      await render(g, shift);
      text = line('statHomeValueSrc').textContent;
      assert(!/±|margin not published|ACS \d{4} 5-year DP04/.test(text), text);
      // Without an entry for the shown figure, the stored one's margin is not borrowed.
      AR._setFile(FILE);
      await render(g, shift);
      assert(!/±/.test(line('statHomeValueSrc').textContent), line('statHomeValueSrc').textContent);
    } finally {
      AR._setFile(FILE);
    }
  });

  await test('a 1-year figure shows its 5-year twin, that margin and the difference', async () => {
    // paul, 2026-10-18: "show the difference from the 5 and note the margin of
    // error". The twins are made up here, so the case does not wait on a
    // margins build; the scan above checks every real one against the file.
    const g = PICK.oneYear;
    const rent = FILE.geos[g].DP04_0134E;
    const burden = FILE.geos[g].rent_burden_30plus;
    const pop = FILE.geos[g].DP05_0001E;
    const twins = {
      DP04_0134E: Object.assign({}, rent, { five: { e: rent.e - 89, m: 22, s: 'acs5', y: rent.y, cv: 0.0075, t: 'good' } }),
      rent_burden_30plus: Object.assign({}, burden, { five: { e: burden.e + 2.5, m: 3.9, s: 'acs5', y: burden.y, cv: 0.2, t: 'fair' } }),
      DP05_0001E: Object.assign({}, pop, { five: { e: pop.e, m: 0, s: 'acs5', y: pop.y, cv: 0, t: 'good' } }),
    };
    AR._setFile(Object.assign({}, FILE, {
      geos: Object.assign({}, FILE.geos, { [g]: Object.assign({}, FILE.geos[g], twins) }),
    }));
    try {
      await render(g);
      const five = (id) => (line(id).querySelector('.acs-five') || {}).textContent || '';
      const cards = [['statRentSrc', 'money', twins.DP04_0134E], ['statRentBurdenSrc', 'pct', twins.rent_burden_30plus],
        ['statPopSrc', 'count', twins.DP05_0001E]];
      for (const [id, unit, e] of cards) {
        assert.deepStrictEqual(fiveProblems(e, unit, five(id)), [], `${id}: ${five(id)}`);
      }
      assert(five('statRentSrc').includes('$89 higher'), five('statRentSrc'));
      assert(five('statRentBurdenSrc').includes('2.5 pts lower'), five('statRentBurdenSrc'));
      // The twin's own tier is said, as for any figure.
      assert(/fair/.test(five('statRentBurdenSrc')), five('statRentBurdenSrc'));
      // The figure's own margin and source are unchanged above the twin.
      const own = line('statRentSrc').textContent.replace(five('statRentSrc'), '');
      assert(own.startsWith(moeText(rent.m, 'money')) && own.includes(`ACS ${rent.y} 1-year DP04`), own);
      // A card with no twin has no 5-year line.
      assert.strictEqual(line('statMhiSrc').querySelector('.acs-five'), null);
    } finally {
      AR._setFile(FILE);
    }
  });

  await test('a figure fetched live gets no margin, even when it equals the stored estimate', async () => {
    // Only a visitor with their own Census key fetches live; the Census API
    // here answers with the stored values, so every number agrees with the file.
    const g = PICK.caution;
    const summary = readJson(`data/hna/summary/${g}.json`);
    const stored = summary.acsProfile;
    const geoType = geoTypeOf(g, summary);
    const others = ['statPopSrc', 'statMhiSrc', 'statRentSrc', 'statTenureSrc'];
    censusAnswer = (url) => {
      const vars = decodeURIComponent(url.split('get=')[1].split('&')[0]).split(',');
      const src = url.includes('/subject') ? (summary.acsS0801 || {}) : stored;
      return [vars, vars.map((v) => (v === 'NAME' ? 'Somewhere' : src[v] == null ? null : String(src[v])))];
    };
    const priorKey = window.APP_CONFIG.CENSUS_API_KEY;
    window.APP_CONFIG.CENSUS_API_KEY = 'test-key';
    try {
      // The extended fetch replaced the two rent-burden inputs with live ones.
      const ext = { DP04_0141PE: stored.DP04_0141PE, DP04_0142PE: stored.DP04_0142PE, DP03_0052E: 1 };
      const merged = window.__HNA_mergeExtendedForTest(Object.assign({}, stored, { _geoid: g, _geoType: geoType }), ext);
      R.clearStats();
      await R.renderSnapshot(merged, summary.acsS0801, summary.geo.label, null);
      assert.strictEqual(U.rentBurden30Plus(merged), FILE.geos[g].rent_burden_30plus.e, 'fixture: the live figure equals the stored one');
      assert(!/±/.test(line('statRentBurdenSrc').textContent), `live rent burden got a margin: ${line('statRentBurdenSrc').textContent}`);
      assert(others.some((id) => /±/.test(line(id).textContent)), 'the cached figures keep their margins');
      // No cached summary: the profile and the commute table are fetched live.
      const live = await window.__HNA_fetchAcsProfileForTest(geoType, g);
      const liveS0801 = await window.__HNA_fetchAcsS0801ForTest(geoType, g);
      assert(live && liveS0801, 'fixture: the live fetch returned nothing');
      assert.strictEqual(U.safeNum(live.DP03_0062E), stored.DP03_0062E, 'fixture: the live figure equals the stored one');
      Object.assign(live, { _geoid: g, _geoType: geoType });
      R.clearStats();
      assert.strictEqual(await R.renderSnapshot(live, liveS0801, summary.geo.label, null), 0);
      assert(!/±/.test(document.querySelector('.stats').textContent), document.querySelector('.stats').textContent);
    } finally {
      censusAnswer = null;
      window.APP_CONFIG.CENSUS_API_KEY = priorKey;
    }
  });

  await test('a reset takes the previous geography\'s margins with its figures', async () => {
    await render(PICK.margins);
    const shown = [...document.querySelectorAll('[data-acs-tier]')];
    assert(shown.length >= 2, `only ${shown.length} cards carried a margin`);
    R.clearStats();
    for (const el of shown) {
      assert(!/±/.test(el.textContent), `${el.id} keeps "${el.textContent}" after the figures were cleared`);
    }
  });

  await test('a margins file that arrives after the next geography is picked writes nothing', async () => {
    AR._setFile(null);
    const g = PICK.margins;
    const summary = readJson(`data/hna/summary/${g}.json`);
    const p = Object.assign({}, summary.acsProfile, { _geoid: g, _geoType: geoTypeOf(g, summary) });
    const pending = R.renderSnapshot(p, summary.acsS0801, summary.geo.label, null);
    R.clearStats();
    assert.strictEqual(await pending, 0);
    assert(!/±/.test(line('statMhiSrc').textContent));
  });

  await test('without the margins file the cards keep their source lines', async () => {
    AR._setFile(null);
    reliabilityMissing = true;
    const before = fetches;
    const { annotated, profile } = await render(PICK.margins);
    reliabilityMissing = false;
    assert(fetches > before, 'the page never asked for the margins file');
    assert.strictEqual(annotated, 0);
    assert.strictEqual(line('statMhiSrc').textContent, `ACS ${profile._acsYear} DP03 · [Source]`);
    assert(!/±/.test(document.querySelector('.stats').textContent));
    AR._setFile(FILE);
  });

  await test('the shared tier rule gives every entry in the file its tier', async () => {
    let n = 0;
    const off = [];
    for (const [geoid, g] of Object.entries(FILE.geos)) {
      // A 1-year figure's 5-year twin carries a tier of its own.
      const entries = Object.entries(g).flatMap(([f, e]) => (e.five ? [[f, e], [`${f}.five`, e.five]] : [[f, e]]));
      for (const [field, e] of entries) {
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
