'use strict';

/**
 * hna-decade-trend-source-copy — the "How Affordable Has Housing Become Over
 * the Last 15 Years?" panel's intro and source line must describe the file
 * that served its cohorts.
 *
 * Since #1808 a place with full 2009–2024 coverage in
 * data/hna/place-decade-trends.json renders its OWN place-geography ACS
 * cohorts (verified live for Fruita, 0828745, on 2026-09-22). Two strings on
 * the card did not follow:
 *
 *   • the intro said the panel "Combines three publicly-available series at
 *     the county level";
 *   • the source badge cited "B25064 median gross rent, B19013 median HH
 *     income, B25070 rent burden" — the detail tables behind
 *     data/co-housing-costs/county-trends.json. The place file is built from
 *     the DP03/DP04 profile tables (meta.vintage_variables).
 *
 * This drives renderDecadeAffordTrend through both paths against the real
 * card markup from housing-needs-assessment.html, with source-badge.js
 * rendering the badge exactly as it does on the page, and asserts the copy
 * flips with the path — and flips back.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const CANON = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
const BADGE = fs.readFileSync(path.join(ROOT, 'js/components/source-badge.js'), 'utf8');
const PLACE_FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-decade-trends.json'), 'utf8'));

const COUNTY_TABLE_IDS = /B25064|B19013|B25070/;
const AT_COUNTY_LEVEL = /at the county level/i;

/** The F199 card, lifted verbatim from the canonical page. */
function cardMarkup() {
  const start = CANON.indexOf('<!-- F199 — Decade Affordability Trend');
  assert.ok(start > 0, 'canonical page carries the F199 decade-trend card');
  const end = CANON.indexOf('<!-- F200', start);
  return CANON.slice(start, end);
}

// Fixtures. The county record mirrors county-trends.json's shape; the place
// record is Fruita's committed shape (hpi null — the panel tolerates that).
const COUNTY_DOC = {
  counties: {
    '08077': {
      county_name: 'Mesa, Colorado',
      acs_cohorts: [
        { year: 2009, median_gross_rent: 560, median_hh_income: 35360, rent_burden_30_plus: 0.55 },
        { year: 2014, median_gross_rent: 710, median_hh_income: 41600, rent_burden_30_plus: 0.53 },
        { year: 2024, median_gross_rent: 990, median_hh_income: 52000, rent_burden_30_plus: 0.50 },
      ],
      hpi: { latest: 265, base_15y: 99, change_15y_pct: 1.68 },
    },
  },
};
const PLACE_DOC = {
  meta: {
    vintage_variables: {
      2009: { income: 'DP03_0063E', rent: 'DP04_0132E', grapi_30_34: 'DP04_0139PE', grapi_35_plus: 'DP04_0140PE' },
      2014: { income: 'DP03_0062E', rent: 'DP04_0132E', grapi_30_34: 'DP04_0139PE', grapi_35_plus: 'DP04_0140PE' },
      2024: { income: 'DP03_0062E', rent: 'DP04_0134E', grapi_30_34: 'DP04_0141PE', grapi_35_plus: 'DP04_0142PE' },
    },
  },
  places: {
    '0828745': {
      place_name: 'Fruita',
      acs_cohorts: [
        { year: 2009, median_gross_rent: 886, median_hh_income: 55898, rent_burden_30_plus: 0.479 },
        { year: 2014, median_gross_rent: 1018, median_hh_income: 54875, rent_burden_30_plus: 0.582 },
        { year: 2024, median_gross_rent: 1472, median_hh_income: 87184, rent_burden_30_plus: 0.436 },
      ],
      hpi: null,
    },
  },
};

function boot() {
  const dom = new JSDOM('<!doctype html><html><body>' + cardMarkup() + '</body></html>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/hna-what-households-can-afford.html',
  });
  const w = dom.window;
  w.HNAState = { charts: {} };
  w.HNAUtils = {
    fmtMoney: (v) => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US')),
    fmtNum: (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US')),
  };
  w.Chart = function Chart() { this.destroy = function () {}; };
  // glossary.js remembers "already wrapped" per section; the renderer must
  // ask it to forget the card when it swaps the intro, or the new prose never
  // gets its ACS / DOLA tooltips (seen live on 2026-09-22 before the hook).
  w.__glossaryForgot = [];
  w.CohoGlossary = { forget: (el) => w.__glossaryForgot.push(el) };
  w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  w.fetch = (url) => {
    const doc = url.includes('place-decade-trends') ? PLACE_DOC
      : url.includes('county-trends') ? COUNTY_DOC : null;
    if (!doc) return Promise.reject(new Error('unexpected fetch ' + url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(doc) });
  };
  w.eval(BADGE);     // renders the badge from data-source at load, as on the page
  w.eval(RENDERER);
  assert.ok(w.HNARenderers && typeof w.HNARenderers.renderDecadeAffordTrend === 'function',
    'renderer exposes renderDecadeAffordTrend');
  return dom;
}

function read(dom) {
  const d = dom.window.document;
  const card = d.querySelector('.chart-card');
  const badge = card.querySelector(':scope > .chart-source');
  return {
    intro: d.getElementById('decadeAffordTrendIntro').textContent,
    attr: card.getAttribute('data-source'),
    badge: badge ? badge.textContent : null,
    panel: d.getElementById('decadeAffordTrendPanel').textContent,
  };
}

/** The panel is async (fetch → then → paint); settle every queued microtask. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

let failures = 0;
async function run(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

(async function main() {
  console.log('hna-decade-trend-source-copy');

  await run('the authored card starts with the county wording and a rendered badge', async () => {
    const dom = boot();
    await settle(); // jsdom fires DOMContentLoaded (source-badge's initial scan) asynchronously
    const s = read(dom);
    assert.match(s.intro, AT_COUNTY_LEVEL, 'authored intro is the county wording');
    assert.match(s.attr, COUNTY_TABLE_IDS, 'authored data-source cites the county detail tables');
    assert.ok(s.badge && /^Source:/.test(s.badge.trim()), 'source-badge.js rendered a badge at load');
    dom.window.SourceBadge._disconnect();
  });

  await run('a place served from place-decade-trends.json gets place-geography copy and the DP03/DP04 citation', async () => {
    const dom = boot();
    dom.window.HNARenderers.renderDecadeAffordTrend('place', '0828745', '08077');
    await settle();
    const s = read(dom);
    assert.match(s.panel, /Place-level ACS 5-yr cohorts \(2009–2024\) for Fruita/, 'panel rendered from the place file');
    assert.doesNotMatch(s.intro, AT_COUNTY_LEVEL, 'place intro must not say "at the county level"');
    assert.match(s.intro, /place/i, 'place intro names place geography');
    assert.match(s.intro, /DP03/, 'place intro cites DP03');
    assert.match(s.intro, /DP04/, 'place intro cites DP04');
    for (const text of [s.attr, s.badge]) {
      assert.ok(text, 'source text is present');
      assert.doesNotMatch(text, COUNTY_TABLE_IDS, 'place source must not cite B25064/B19013/B25070: ' + text);
      assert.doesNotMatch(text, AT_COUNTY_LEVEL, 'place source must not say "at the county level"');
      assert.match(text, /place-geography/, 'place source names place geography');
      assert.match(text, /FHFA House Price Index/, 'place source keeps the HPI citation');
    }
    // The citation is built from the IDs the file itself declares per vintage.
    for (const id of ['DP03_0063E', 'DP03_0062E', 'DP04_0132E', 'DP04_0134E', 'DP04_0139PE', 'DP04_0142PE']) {
      assert.ok(s.badge.includes(id), 'badge cites ' + id + ' from meta.vintage_variables: ' + s.badge);
    }
    assert.equal(dom.window.document.querySelectorAll('.chart-source').length, 1,
      'the stale county badge was replaced, not stacked under a second one');
    const card = dom.window.document.querySelector('.chart-card');
    assert.deepEqual(dom.window.__glossaryForgot, [card],
      'the renderer asks the glossary to forget the card once, so the swapped intro is re-decorated');
    dom.window.SourceBadge._disconnect();
  });

  await run('a county selection after a place selection restores the county wording', async () => {
    const dom = boot();
    dom.window.HNARenderers.renderDecadeAffordTrend('place', '0828745', '08077');
    await settle();
    assert.doesNotMatch(read(dom).intro, AT_COUNTY_LEVEL, 'precondition: place copy applied');
    dom.window.HNARenderers.renderDecadeAffordTrend('county', '08077', null);
    await settle();
    const s = read(dom);
    assert.match(s.panel, /Median rent change/, 'county panel rendered');
    assert.doesNotMatch(s.panel, /Place-level ACS/, 'county panel carries no place provenance line');
    assert.match(s.intro, AT_COUNTY_LEVEL, 'county intro restored');
    assert.match(s.badge, COUNTY_TABLE_IDS, 'county badge restored');
    assert.equal(dom.window.document.querySelectorAll('.chart-source').length, 1, 'one badge');
    dom.window.SourceBadge._disconnect();
  });

  await run('a place NOT in the place file falls back to county cohorts and keeps the county wording', async () => {
    const dom = boot();
    dom.window.HNARenderers.renderDecadeAffordTrend('place', '0899999', '08077');
    await settle();
    const s = read(dom);
    assert.match(s.panel, /Mesa, Colorado figures/, 'county-inherits banner shown');
    assert.match(s.intro, AT_COUNTY_LEVEL, 'fallback keeps the county intro');
    assert.match(s.badge, COUNTY_TABLE_IDS, 'fallback keeps the county citation');
    dom.window.SourceBadge._disconnect();
  });

  await run('the place citation degrades to static DP03/DP04 wording when the file carries no vintage_variables', () => {
    const dom = boot();
    const R = dom.window.HNARenderers;
    for (const meta of [undefined, null, {}, { vintage_variables: null }, { vintage_variables: { 2024: {} } }]) {
      const line = R._placeDecadeSourceLine(meta);
      assert.equal(line, R._decadeTrendCopy.place.source, 'static fallback for ' + JSON.stringify(meta));
      assert.doesNotMatch(line, COUNTY_TABLE_IDS);
      assert.match(line, /DP03/);
      assert.match(line, /DP04/);
    }
    dom.window.SourceBadge._disconnect();
  });

  await run('the committed place file still declares the DP03/DP04 IDs the citation is built from', () => {
    const vv = PLACE_FILE.meta && PLACE_FILE.meta.vintage_variables;
    assert.ok(vv && Object.keys(vv).length >= 2, 'meta.vintage_variables present');
    for (const year of Object.keys(vv)) {
      assert.match(vv[year].income, /^DP03_/, year + ' income is a DP03 profile variable');
      assert.match(vv[year].rent, /^DP04_/, year + ' rent is a DP04 profile variable');
    }
    assert.ok(PLACE_FILE.places['0828745'], 'Fruita (0828745), the live-verified place, is still covered');
  });

  await run('the generated afford view carries the same intro hook the renderer targets', () => {
    const view = fs.readFileSync(path.join(ROOT, 'hna-what-households-can-afford.html'), 'utf8');
    assert.ok(view.includes('id="decadeAffordTrendIntro"'), 'view has #decadeAffordTrendIntro');
    assert.ok(CANON.includes('id="decadeAffordTrendIntro"'), 'canonical page has #decadeAffordTrendIntro');
  });

  if (failures) { console.error('\n' + failures + ' failing'); process.exit(1); }
  console.log('\nall passing');
})().catch((e) => { console.error(e); process.exit(1); });
