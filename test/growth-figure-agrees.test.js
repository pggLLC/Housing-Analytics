'use strict';

// Same figure, same source and year, everywhere (finish-line PC-1).
//
// ── 1. One name, one number ──
//
// Found 2026-09-26: for Mesa County the HNA's need reconciliation (and its
// Excel sheet) said "Resident growth by 2044 16,071" while the Recommendation
// said "resident growth alone would need about 12,727". Two quantities, one
// name. The digest's future_units_growth_20yr is the change in homes needed as
// households grow (DOLA's incremental_units_needed_dola). The HNA's county
// reading is homes needed at the horizon LESS the homes in the market today,
// which also counts today's shortfall against the target vacancy. Both are
// deliberate; they must not share a name.
//
// Held as agreement: each surface is read from what it actually renders (the
// real applyAssumptions; the real RecommendationContract over the committed
// digest). Where the two surfaces use the same name, the numbers must be
// equal. Fruita (place ledger on both) must agree; Mesa must either agree or
// carry a different name on the HNA.
//
// ── 2. Each metric carries its own source's vintage ──
//
// The digest labelled the HUD CHAS 2018-2022 cost-burden metrics "ACS
// 2020-2024 5-year", and the Recommendation repeated that beside the severe-
// burden figure. Every digest metric is held to the vintage field of the file
// its source_id names: place-chas.json meta.vintage_chas,
// chas_affordability_gap.json meta.vintage, co_ami_gap_by_*.json meta.acs_year,
// and the summary's acsProfile._acsYear/_acsSeries.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const DIGEST_DIR = 'data/hna/jurisdiction-metrics-digest';
const digest = (geoid) => readJson(`${DIGEST_DIR}/${geoid}.json`);

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function freshRequire(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

/* ── The HNA, rendered by the real applyAssumptions ─────────────────── */

function page(geoType, geoid, label) {
  const html = read('housing-needs-assessment.html');
  const card = html.match(/<h2>Housing need summary<\/h2>[\s\S]*?<div id="hnaNeedReconciliation"[^>]*><\/div>/);
  assert(card, 'the housing-need summary (through #hnaNeedReconciliation) could not be found in housing-needs-assessment.html');
  return `<!doctype html><html><body>
    <select id="geoType"><option value="${geoType}" selected>${geoType}</option></select>
    <select id="geoSelect"><option value="${geoid}" selected>${label}</option></select>
    <input type="radio" name="headship" value="current" checked>
    <div class="chart-box"><canvas id="chartProjectedHH"></canvas></div>
    ${card[0]}
  </body></html>`;
}

function install(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Blob = dom.window.Blob;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  const add = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (type, l, o) => (type === 'DOMContentLoaded' ? undefined : add(type, l, o));
  global.Chart = class { constructor(ctx, config) { this.config = config; this.data = config && config.data; } destroy() {} };
  window.Chart = global.Chart;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  window.APP_CONFIG = { DATA_VERSION: 'test' };
  window.fetch = async (url) => {
    const rel = String(url).replace(/^\.?\//, '').split('?')[0];
    const abs = path.join(ROOT, rel);
    if (!rel.startsWith('data/') || !fs.existsSync(abs)) return { ok: false, status: 404, text: async () => '', json: async () => null };
    const body = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  global.fetch = window.fetch;
  window.fetchWithTimeout = (u) => window.fetch(u);
  global.fetchWithTimeout = window.fetchWithTimeout;
  freshRequire('js/hna/hna-utils.js');
  freshRequire('js/hna/hna-renderers.js');
  freshRequire('js/hna/hna-controller.js');
}

async function hnaGrowthRow(selection, countyFips) {
  const dom = new JSDOM(page(selection.geoType, selection.geoid, selection.label),
    { url: 'http://127.0.0.1/housing-needs-assessment.html' });
  install(dom);
  window.HNAState.state.currentSelection = selection;
  const proj = readJson(`data/hna/projections/${countyFips}.json`);
  await window.HNAController.applyAssumptions(proj, selection);
  const row = document.querySelector('#hnaNeedReconciliation [data-recon-key="growth"]');
  assert(row, `${selection.label}: the HNA rendered no resident-side reconciliation row`);
  const units = row.dataset.units === '' ? null : Math.round(Number(row.dataset.units));
  return { label: row.querySelector('.hna-recon-label').textContent, units };
}

/* ── The Recommendation, built by the real contract ──────────────────── */

const RecommendationContract = freshRequire('js/workflow/recommendation-contract.js');

// The name the Recommendation gives the growth-only figure, and its number.
const REC_GROWTH = /(resident growth) alone would need about ([\d,]+)/i;

function recGrowth(geoid) {
  const out = RecommendationContract.build({ digest: digest(geoid), project: null, generatedAt: 'test' });
  const production = out.conclusions.find((c) => c.id === 'production');
  assert(production, `${geoid}: the Recommendation has no production conclusion`);
  const m = String(production.plain || '').match(REC_GROWTH);
  return { out, production, name: m ? m[1].toLowerCase() : null, units: m ? Number(m[2].replace(/,/g, '')) : null };
}

const nameOf = (label) => label.replace(/\s+by\s+\d{4}$/, '').trim().toLowerCase();

/* ── Vintages, from each source file's own field ─────────────────────── */

function acsLabel(year, series) {
  const y = Number(year);
  if (!Number.isInteger(y)) return null;
  return series === 'acs1' ? `ACS ${y} 1-year` : `ACS ${y - 4}-${y} 5-year`;
}
const placeChasMeta = readJson('data/hna/place-chas.json').meta;
const countyChasMeta = readJson('data/hna/chas_affordability_gap.json').meta;
const CHAS_PLACE = 'HUD CHAS ' + placeChasMeta.vintage_chas;
const CHAS_COUNTY = 'HUD CHAS ' + countyChasMeta.vintage;
const AMI_PLACE = acsLabel(readJson('data/co_ami_gap_by_place.json').meta.acs_year, 'acs5');
const AMI_COUNTY = acsLabel(readJson('data/co_ami_gap_by_county.json').meta.acs_year, 'acs5');

function summaryAcs(geoid) {
  const f = `data/hna/summary/${geoid}.json`;
  if (!fs.existsSync(path.join(ROOT, f))) return null;
  return readJson(f).acsProfile || {};
}

(async () => {
  console.log('\nOne name, one number; each metric its own vintage');

  const CASES = [
    { selection: { geoType: 'county', geoid: '08077', label: 'Mesa County' }, county: '08077' },
    { selection: { geoType: 'place', geoid: '0828745', label: 'Fruita', contextCounty: '08077',
      profile: { DP02_0001E: 5807, DP04_0001E: 6100, DP05_0001E: 14000 } }, county: '08077' },
  ];
  const seen = {};
  for (const c of CASES) {
    seen[c.selection.geoid] = { hna: await hnaGrowthRow(c.selection, c.county), rec: recGrowth(c.selection.geoid) };
  }

  await test('both surfaces render a resident-side figure for Mesa and Fruita (the checks below are not vacuous)', () => {
    for (const [geoid, s] of Object.entries(seen)) {
      assert(Number.isFinite(s.hna.units), `${geoid}: HNA growth row has no number`);
      assert(s.rec.name, `${geoid}: the Recommendation no longer quotes the growth-only figure — "${s.rec.production.plain}"`);
    }
  });

  await test('the Recommendation\'s growth figure is the digest\'s future_units_growth_20yr', () => {
    for (const [geoid, s] of Object.entries(seen)) {
      const g = digest(geoid).metrics.future_units_growth_20yr;
      assert(g && Number.isFinite(g.value), `${geoid}: digest carries no future_units_growth_20yr`);
      assert.strictEqual(s.rec.units, g.value, `${geoid}: Recommendation says ${s.rec.units}, digest ${g.value}`);
    }
  });

  await test('the same name on both surfaces means the same number', () => {
    const bad = [];
    for (const [geoid, s] of Object.entries(seen)) {
      if (nameOf(s.hna.label) === s.rec.name && s.hna.units !== s.rec.units) {
        bad.push(`${geoid}: HNA "${s.hna.label}" ${s.hna.units}; Recommendation "${s.rec.name} alone" ${s.rec.units}`);
      }
    }
    assert.deepStrictEqual(bad, [], 'one name, two numbers:\n  ' + bad.join('\n  '));
  });

  await test('Fruita: the place ledger feeds both surfaces, so name and number agree', () => {
    const s = seen['0828745'];
    assert.strictEqual(nameOf(s.hna.label), s.rec.name, `HNA "${s.hna.label}" vs Recommendation "${s.rec.name}"`);
    assert.strictEqual(s.hna.units, s.rec.units);
  });

  await test('Mesa County: a figure that differs from resident growth is not called resident growth', () => {
    const s = seen['08077'];
    if (s.hna.units === s.rec.units) return;
    assert.notStrictEqual(nameOf(s.hna.label), s.rec.name,
      `HNA calls ${s.hna.units} "${s.hna.label}"; the Recommendation calls ${s.rec.units} "${s.rec.name}"`);
    assert(!/resident growth/i.test(s.hna.label), `HNA label "${s.hna.label}" still names resident growth`);
  });

  await test('every digest metric is labelled with its own source\'s vintage', () => {
    const files = fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => f.endsWith('.json'));
    assert(files.length >= 546, `only ${files.length} digests`);
    const bad = [];
    const checked = { chas: 0, acs: 0, ami: 0, blend: 0 };
    for (const f of files) {
      const d = readJson(`${DIGEST_DIR}/${f}`);
      const geoid = d.geography.geoid;
      const acs = summaryAcs(geoid);
      const acsWant = acs ? acsLabel(acs._acsYear, acs._acsSeries) : null;
      for (const [key, m] of Object.entries(d.metrics)) {
        const src = m.source_id || '';
        let want = null;
        let cls = null;
        if (src === 'hud-chas-place-apportioned') { want = CHAS_PLACE; cls = 'chas'; }
        else if (src === 'hud-chas-county') { want = CHAS_COUNTY; cls = 'chas'; }
        else if (src === 'ami-gap-place-acs') { want = AMI_PLACE; cls = 'ami'; }
        else if (src === 'ami-gap-county-acs') { want = AMI_COUNTY; cls = 'ami'; }
        else if (src === 'acs-grapi-and-hud-chas-blend') {
          checked.blend += 1;
          const chas = d.geography.type === 'county' ? CHAS_COUNTY : [CHAS_PLACE, CHAS_COUNTY];
          const hasChas = [].concat(chas).some((c) => String(m.as_of).includes(c));
          if (!hasChas || !String(m.as_of).includes(acsWant)) bad.push(`${geoid} ${key}: "${m.as_of}" does not name ${acsWant} and HUD CHAS`);
          continue;
        } else if (src.startsWith('acs-')) {
          // A home value's as_of is the cascade's own (ACS raw, or adjusted).
          const home = acs && acs.median_home_value;
          if ((key === 'median_home_value' || key === 'home_value_to_income') && home && home.as_of) want = home.as_of;
          else want = acsWant;
          cls = 'acs';
        }
        if (!cls) continue;
        checked[cls] += 1;
        if (m.as_of !== want) bad.push(`${geoid} ${key} (${src}): "${m.as_of}", source says "${want}"`);
      }
    }
    assert(checked.chas >= 546 * 8, `only ${checked.chas} CHAS metrics checked`);
    assert(checked.acs >= 546 * 10, `only ${checked.acs} ACS metrics checked`);
    assert(checked.ami >= 546 * 5, `only ${checked.ami} AMI-gap metrics checked`);
    assert(checked.blend >= 500, `only ${checked.blend} blended metrics checked`);
    assert.deepStrictEqual(bad.slice(0, 15), [], `${bad.length} metric(s) carry another source's vintage:\n  ` + bad.slice(0, 15).join('\n  '));
  });

  await test('the Recommendation\'s severe-burden figure is sourced to HUD CHAS with CHAS\'s vintage', () => {
    for (const [geoid, s] of Object.entries(seen)) {
      const aff = s.rec.out.conclusions.find((c) => c.id === 'affordability');
      const item = aff && aff.evidence.find((e) => e.key === 'pct_renter_severe_burdened');
      assert(item, `${geoid}: no severe-burden evidence`);
      const want = /place/.test(item.source) ? CHAS_PLACE : CHAS_COUNTY;
      assert(/^hud-chas/.test(item.source), `${geoid}: severe burden sourced to ${item.source}`);
      assert.strictEqual(item.asOf, want, `${geoid}: severe burden (${item.source}) labelled "${item.asOf}"`);
      const listed = s.rec.out.sources.find((x) => x.source === item.source);
      assert(listed && listed.asOf === want, `${geoid}: source list shows ${item.source} as "${listed && listed.asOf}"`);
    }
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
