#!/usr/bin/env node
/**
 * The for-sale market study is about the reader's town.
 *
 * Before #1620 §7 slice 2 it was about one town, always. The page hard-coded a
 * single place GEOID twice and fetched that place's summary, so a planner who
 * chose Longmont at step 1 walked in and read another town's AMI, another
 * town's home values and another town's buyer pool. Every figure was correct
 * arithmetic about the wrong place, and nothing on screen said so — the only
 * clue was the example project's name, six lines into section 1, which no
 * reader has any reason to read as a statement about the DATA.
 *
 * The fix splits the page in two: the PROGRAM stays an example fixture, the
 * MARKET follows the jurisdiction. This file guards that split, and four
 * failure modes it could decay into:
 *
 *   - the example geography creeping back in as a hard-coded id;
 *   - a jurisdiction with missing data silently falling back to the example's
 *     numbers instead of saying it cannot be screened;
 *   - the browser's input assembly drifting from the one in
 *     scripts/hna/build_jurisdiction_metrics_digest.mjs, which computes the
 *     same thing for data/hna/ownership-need.json;
 *   - walkStale() — a provenance check on the shipped fixtures — firing on a
 *     live jurisdiction's true home value. Thirty Colorado places sit inside
 *     the band it rejects, Denver among them.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const StudyGeography = require('../js/project-market-study/study-geography.js');
const ProjectScenario = require('../js/project-market-study/project-scenario.js');
const OwnershipFinance = require('../js/hna/ownership-finance.js');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const Page = require('../js/project-market-study/market-study-page.js');
const Report = require('../js/project-market-study/market-study-report.js');

function ownershipEngine() {
  const context = { window: {} };
  vm.runInNewContext(read('js/hna/hna-ownership-need.js'), context);
  return context.window.HNAOwnershipNeed;
}
const HNAOwnershipNeed = ownershipEngine();
const ENGINES = { HNAOwnershipNeed, EffectiveDemand };

const DATA = {
  placeChas: json('data/hna/place-chas.json'),
  countyChas: json('data/hna/chas_affordability_gap.json'),
  amiGapPlace: json('data/co_ami_gap_by_place.json'),
  amiGapCounty: json('data/co_ami_gap_by_county.json'),
  homeValueCascade: json('data/hna/home-value-cascade.json'),
  summary: null
};

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('for-sale-study-follows-jurisdiction');

/* ── The page is wired to the jurisdiction at all ────────────────────────── */

const PAGE_HTML = read('for-sale-market-study.html');
const CONTROLLER = read('js/project-market-study/market-study-page.js');

test('the page loads the jurisdiction stack', () => {
  for (const src of [
    'js/workflow-state-core.js', 'js/workflow-state-api.js', 'js/site-state.js',
    'js/components/jurisdiction-url-context.js', 'js/project-market-study/study-geography.js'
  ]) {
    assert.ok(PAGE_HTML.includes(`src="${src}"`), `for-sale-market-study.html no longer loads ${src}`);
  }
});

test('the controller names no geography of its own', () => {
  // The original defect, stated directly: a seven-digit Colorado GEOID
  // written into the page controller means every reader gets that town.
  const hits = CONTROLLER.match(/['"]08\d{5}['"]/g) || [];
  assert.deepStrictEqual(hits, [],
    `market-study-page.js hard-codes ${hits.join(', ')}; the geography comes from the reader`);
  assert.ok(!/data\/hna\/summary\/\d/.test(CONTROLLER),
    'the controller fetches one fixed summary file rather than the selected jurisdiction\'s');
});

test('the resolver is the shared one, not a fourth copy', () => {
  const geo = read('js/project-market-study/study-geography.js');
  assert.ok(geo.includes('JurisdictionUrlContext'),
    'StudyGeography no longer delegates to the site resolver');
  assert.ok(!/localStorage|getActiveProject/.test(geo),
    'StudyGeography reads WorkflowState directly; that is a second resolver and they will disagree');
});

/* ── The two producers of the same assembly agree ────────────────────────── */

test('the browser assembly matches the precomputed ownership-need file', () => {
  // scripts/hna/build_jurisdiction_metrics_digest.mjs computes ownership need
  // for all 546 geographies into data/hna/ownership-need.json. This page now
  // computes the same thing in the browser. Two producers of one result is the
  // defect that has bitten this repo repeatedly, so they are compared here on
  // a spread of real geographies rather than trusted to stay aligned.
  const records = json('data/hna/ownership-need.json').records;
  const ids = Object.keys(records);
  const places = ids.filter((id) => records[id].type === 'place');
  const counties = ids.filter((id) => records[id].type === 'county');
  assert.ok(places.length > 100 && counties.length > 10,
    `the ownership-need file no longer holds both levels (${places.length} places, ${counties.length} counties)`);

  // A deterministic spread rather than a random sample: every 37th place plus
  // every 7th county. A flaky guard gets disabled; a fixed one gets fixed.
  const sample = places.filter((_, i) => i % 37 === 0).concat(counties.filter((_, i) => i % 7 === 0));
  assert.ok(sample.length >= 15, `sample collapsed to ${sample.length}`);

  const mismatches = [];
  let compared = 0;
  for (const geoid of sample) {
    const record = records[geoid];
    const context = {
      geoid,
      geoLevel: record.type === 'county' ? 'county' : 'place',
      name: record.name,
      countyFips: record.type === 'county' ? geoid : null
    };
    // summary is null here on purpose: the digest builder passes no ACS
    // profile either, so this compares like with like.
    const result = StudyGeography.inputs(context, DATA, ENGINES);
    if (!result.ownershipNeed) continue;
    compared += 1;
    if (result.ownershipNeed.tenureMixRecommendation !== record.recommendation
      || result.ownershipNeed.dataQuality !== record.data_quality) {
      mismatches.push(`${geoid} ${record.name}: page says `
        + `${result.ownershipNeed.tenureMixRecommendation}/${result.ownershipNeed.dataQuality}, `
        + `file says ${record.recommendation}/${record.data_quality}`);
    }
  }
  assert.ok(compared >= 10, `only ${compared} geographies actually compared; the guard is nearly blind`);
  assert.deepStrictEqual(mismatches, [],
    `the page and the precomputed file disagree:\n    ${mismatches.join('\n    ')}`);
});

/* ── Absence is named, never filled in from the example ──────────────────── */

test('no jurisdiction means example mode, explicitly', () => {
  const result = StudyGeography.inputs(null, DATA, ENGINES);
  assert.strictEqual(result.mode, 'example');
  assert.strictEqual(result.localBaseline, null,
    'example mode must leave the fixture baseline alone rather than substituting one');
});

test('a geoid with no data behind it says so, rather than showing the example', () => {
  // Every geography in the registry has CHAS today, so this is not a gap in
  // the data — it is the live path where a reader arrives on a hand-typed or
  // stale ?fips=. The resolver accepts any well-formed Colorado GEOID, so the
  // page has to answer for one it cannot screen.
  const covered = json('data/hna/place-chas.json').places;
  const orphan = '0899999';
  assert.ok(!covered[orphan], 'that id is now a real place; pick another');

  const result = StudyGeography.inputs({ geoid: orphan, geoLevel: 'place', name: null }, DATA, ENGINES);
  assert.strictEqual(result.mode, 'jurisdiction');
  assert.ok(result.unavailable, 'an unknown geoid was reported as screenable');
  assert.strictEqual(result.unavailable.reason, 'no_chas');
  assert.strictEqual(result.observed, null, 'an unscreenable geoid must not carry a buyer pool');
  assert.strictEqual(result.localBaseline.home_value.value, null,
    'the example town\'s home value was substituted for a geoid with no data');
});

test('a place with households but no home value loses one row, not the page', () => {
  // 53 of the 482 places have CHAS but no value in the home-value cascade.
  // This is the commonest partial state and the one most likely to be papered
  // over with a county figure or a statewide median.
  const chasPlaces = json('data/hna/place-chas.json').places;
  const values = json('data/hna/home-value-cascade.json').places;
  const partial = Object.keys(chasPlaces).find((id) => !values[id] || typeof values[id].value !== 'number');
  assert.ok(partial, 'every place now has a home value; re-point this assertion');

  const result = StudyGeography.inputs({ geoid: partial, geoLevel: 'place', name: 'Partial' }, DATA, ENGINES);
  assert.strictEqual(result.localBaseline.home_value.value, null,
    'a home value appeared for a place the cascade does not cover');
  assert.strictEqual(result.localBaseline.home_value.classification, 'not_available');
  assert.ok(typeof result.localBaseline.ami_4person.value === 'number' || result.localBaseline.ami_4person.value === null,
    'the AMI node is malformed');

  // The page still derives — the gap column goes to "Owner input required"
  // rather than the whole study refusing to render.
  const scenario = json('data/fixtures/fruita-commons.scenario.json');
  const derived = ProjectScenario.derive(scenario, OwnershipFinance, { localBaseline: result.localBaseline });
  assert.ok(derived.bands.length > 0, 'derive() produced no bands');
  assert.deepStrictEqual([...new Set(derived.bands.map((b) => b.gapVsLocalPrice))], [null],
    'a gap was computed against a home value that does not exist');
});

test('a missing figure becomes not_available, not a borrowed number', () => {
  const noData = { geoid: '0899999', geoLevel: 'place', name: 'Nowhere' };
  const baseline = StudyGeography.localBaseline(noData, DATA);
  for (const key of ['ami_4person', 'home_value', 'median_sale_price']) {
    assert.strictEqual(baseline[key].value, null, `${key} was filled in for a geography with no data`);
    assert.strictEqual(baseline[key].classification, 'not_available');
  }
  // And it still satisfies the scenario schema, so derive() degrades one row
  // at a time instead of throwing.
  assert.ok(ProjectScenario.validateLocalBaseline(baseline));
});

/* ── walkStale is a fixture check, and stops behaving like a data check ──── */

test("a live jurisdiction's true home value no longer takes the page down", () => {
  // walkStale() rejects any number between 536,000 and 594,000 anywhere in a
  // scenario document. It was written to keep a handful of untraced figures
  // out of the SHIPPED FIXTURES. Run against live data it rejects thirty real
  // Colorado places — Denver's current value sits inside the band — and the
  // rejection is a thrown error, so the whole study goes blank on a true
  // number. The jurisdiction baseline is validated instead of walked.
  const values = json('data/hna/home-value-cascade.json').places;
  const inBand = Object.keys(values).filter((id) => {
    const v = values[id] && values[id].value;
    return typeof v === 'number' && v >= 536000 && v <= 594000;
  });
  assert.ok(inBand.length > 0,
    'no place sits in the rejected band any more; if that is permanent this guard can go');

  const scenario = json('data/fixtures/fruita-commons.scenario.json');
  const broken = [];
  for (const geoid of inBand) {
    const baseline = StudyGeography.localBaseline({ geoid, geoLevel: 'place', name: 'In band' }, DATA);
    try { ProjectScenario.derive(scenario, OwnershipFinance, { localBaseline: baseline }); }
    catch (e) { broken.push(`${geoid} (${values[geoid].value}): ${e.message}`); }
  }
  assert.deepStrictEqual(broken, [],
    `these real places still crash the study on a true home value:\n    ${broken.join('\n    ')}`);
});

test('the fixtures are still walked for the figures that earned the check', () => {
  // The other half. Relaxing the live path must not relax the fixture path —
  // that check exists because those numbers could not be traced to a source.
  const scenario = json('data/fixtures/fruita-commons.scenario.json');
  const tampered = JSON.parse(JSON.stringify(scenario));
  tampered.local_baseline.ami_4person.value = 94100;
  assert.throws(() => ProjectScenario.validate(tampered),
    'an untraced figure is once again accepted in a shipped fixture');

  const fixtureText = ['fruita-commons', 'fruita-commons-compact',
    'fruita-commons-family', 'fruita-commons-broad-income']
    .map((name) => read(`data/fixtures/${name}.scenario.json`)).join('\n');
  assert.ok(!/94100|87\.3|82\.2/.test(fixtureText),
    'an untraced figure is present in the shipped fixtures');
});

/* ── What the reader sees ────────────────────────────────────────────────── */

const scenarios = ['fruita-commons', 'fruita-commons-compact', 'fruita-commons-family', 'fruita-commons-broad-income']
  .map((name) => json(`data/fixtures/${name}.scenario.json`));
const conventions = json('data/policy/resale-conventions.json');

function mountFor(geography, PageModule = Page) {
  const dom = new JSDOM(
    '<main><div id="mount"></div><div id="marketStudyReportPreview"></div>'
    + '<button id="marketStudyReportDownload"></button></main>',
    { url: 'http://127.0.0.1/for-sale-market-study.html' }
  );
  const data = {
    scenarios,
    conventions,
    reportAsOf: scenarios[0].meta.as_of,
    geography,
    localBaseline: geography && geography.mode === 'jurisdiction' ? geography.localBaseline : null,
    observed: StudyGeography.observedFor(geography, scenarios[0], EffectiveDemand)
  };
  const model = PageModule.buildModel(data, {});
  const mount = dom.window.document.getElementById('mount');
  PageModule.render(mount, model, data);
  return { dom, mount, model, data };
}

const denver = StudyGeography.inputs(
  { geoid: '0820000', geoLevel: 'place', name: 'Denver', countyFips: '08031' }, DATA, ENGINES);

test('the sample jurisdiction is screenable, or the DOM checks prove nothing', () => {
  assert.ok(!denver.unavailable,
    `Denver came back unscreenable (${denver.unavailable && denver.unavailable.reason}); `
    + 'every rendering assertion below would then be testing the absence path');
  assert.ok(denver.localBaseline.home_value.value > 0, 'no Denver home value');
});

test('the page says whose market it is', () => {
  const { mount } = mountFor(denver);
  const banner = mount.querySelector('[data-study-mode]');
  assert.ok(banner, 'no geography banner rendered');
  assert.strictEqual(banner.getAttribute('data-study-mode'), 'jurisdiction');
  assert.strictEqual(banner.getAttribute('data-study-geoid'), '0820000');
  assert.ok(/Denver/.test(banner.textContent), 'the banner does not name the jurisdiction');
});

test('example mode admits it is an example, and offers the way out', () => {
  const { mount } = mountFor(StudyGeography.inputs(null, DATA, ENGINES));
  const banner = mount.querySelector('[data-study-mode]');
  assert.strictEqual(banner.getAttribute('data-study-mode'), 'example');
  assert.ok(/Example study/.test(banner.textContent), 'example mode does not say so');
  assert.ok(banner.querySelector('a[href="select-jurisdiction.html"]'),
    'example mode offers no route to choosing a jurisdiction');
});

test("the jurisdiction's numbers actually reach the page", () => {
  // The assertion that would have caught the original bug: two different
  // jurisdictions must not render the same affordability gap.
  const example = mountFor(StudyGeography.inputs(null, DATA, ENGINES));
  const real = mountFor(denver);
  const gapOf = (m) => m.model.derived.bands[0].gapVsLocalPrice;
  assert.notStrictEqual(gapOf(real), gapOf(example),
    'the example baseline and Denver produce the same gap; the baseline is not reaching derive()');
  assert.ok(/Denver/.test(real.mount.textContent), 'Denver appears nowhere in the rendered study');
});

test('an unscreenable jurisdiction loses two sections, and is told which', () => {
  const orphan = StudyGeography.inputs({ geoid: '0899999', geoLevel: 'place', name: 'Unknown' }, DATA, ENGINES);
  const { mount } = mountFor(orphan);
  for (const id of ['ms-s5', 'ms-s6']) {
    const section = mount.querySelector(`#${id}`);
    assert.ok(section, `${id} is missing entirely; it must be present and marked, not dropped`);
    assert.strictEqual(section.getAttribute('data-unmeasured'), 'true',
      `${id} rendered as if it had been screened`);
  }
  // And the sections that do not depend on the buyer pool still render.
  for (const id of ['ms-s1', 'ms-s2', 'ms-s3', 'ms-s4']) {
    assert.ok(mount.querySelector(`#${id}`), `${id} was dropped along with the demand sections`);
    assert.notStrictEqual(mount.querySelector(`#${id}`).getAttribute('data-unmeasured'), 'true');
  }
});

test('no report is offered when the demand sections could not be screened', () => {
  const orphan = StudyGeography.inputs({ geoid: '0899999', geoLevel: 'place', name: 'Unknown' }, DATA, ENGINES);
  const { dom } = mountFor(orphan);
  const button = dom.window.document.getElementById('marketStudyReportDownload');
  const preview = dom.window.document.getElementById('marketStudyReportPreview');
  assert.strictEqual(button.disabled, true, 'a report download is still offered');
  assert.ok(/No report for this jurisdiction/.test(preview.textContent),
    'the preview does not say why there is no report');
});

test('the exported report names the reader\'s jurisdiction, not the fixture\'s', () => {
  // A downloaded file outlives the tab. One that said the example town while
  // quoting Denver's home value would be unre-checkable by whoever opens it.
  const { model, data } = mountFor(denver);
  const html = Report.renderReportHtml(Report.buildReport(model, {
    asOf: data.reportAsOf,
    jurisdictionLabel: 'Denver',
    vintages: {
      scenario: model.scenario.meta.as_of,
      homeValue: model.localBaseline.home_value.as_of,
      conventions: conventions.meta.as_of
    },
    requiredCaveats: Report.REQUIRED_CAVEATS
  }));
  assert.ok(/<strong>Jurisdiction:<\/strong> Denver/.test(html),
    'the exported report still names the example jurisdiction');
  assert.ok(html.includes(String(denver.localBaseline.home_value.value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
    "the exported report does not quote the reader's home value");
});

/* ── Fixed example inputs are labelled wherever they reach the reader ───── */
//
// Sections 2-4 of the page (and the land, resale and settlement parts of the
// report) run on a market value, restricted price and four-person AMI fixed in
// market-study-page.js, the same for every jurisdiction. Which sections those
// are is not written down here: the controller is loaded a second time with
// those inputs changed, and whatever section moves is one they drive. Every
// such section must carry the example label; no other section may.

const PAGE_FILE = path.join(ROOT, 'js/project-market-study/market-study-page.js');
const FIXED_INPUT_MUTATIONS = [
  ['unrestrictedValue: 500000, restrictedPrice: 400000', 'unrestrictedValue: 650000, restrictedPrice: 480000'],
  ['ami4Person: 100000', 'ami4Person: 125000'],
  ['restrictedValueAssessment: false, unitPrice: 400000', 'restrictedValueAssessment: false, unitPrice: 480000'],
  ['ownerDownPayment: 40000, originalRestrictedPrice: 400000', 'ownerDownPayment: 40000, originalRestrictedPrice: 480000'],
];
function loadPage(source) {
  const m = new Module(PAGE_FILE);
  m.filename = PAGE_FILE;
  m.paths = Module._nodeModulePaths(path.dirname(PAGE_FILE));
  m._compile(source, PAGE_FILE);
  return m.exports;
}
function mutatedPage() {
  let source = CONTROLLER;
  for (const [from, to] of FIXED_INPUT_MUTATIONS) {
    const next = source.split(from).join(to);
    assert.notStrictEqual(next, source, `fixed-input mutation did not apply: ${from}`);
    source = next;
  }
  return loadPage(source);
}
function sectionsOf(root, selector) {
  return Array.from(root.querySelectorAll(selector)).map((node) => ({
    key: (node.querySelector('h2') || {}).textContent || node.id,
    text: node.textContent.replace(/\s+/g, ' '),
    labels: Array.from(node.querySelectorAll('[data-example-inputs="true"]')).map((el) => el.textContent),
  }));
}
function labelAgreement(geography, name, withReport = true) {
  const base = mountFor(geography);
  const moved = mountFor(geography, mutatedPage());
  const expectedLabel = Report.exampleInputsLabel(name);
  assert.ok(expectedLabel.includes(name), 'the example label does not name the jurisdiction it is not from');
  const out = {};
  for (const [where, selector, rootOf] of [
    ['page', ':scope > section', (m) => m.mount],
    ['report', 'section', (m) => m.dom.window.document.getElementById('marketStudyReportPreview')],
  ].slice(0, withReport ? 2 : 1)) {
    const a = sectionsOf(rootOf(base), selector);
    const b = sectionsOf(rootOf(moved), selector);
    assert.strictEqual(a.length, b.length, `${where}: section count changed under the mutation`);
    assert.ok(a.length >= 6, `${where}: rendered too few sections to check`);
    const driven = [];
    a.forEach((section, i) => {
      const changed = section.text !== b[i].text;
      if (changed) driven.push(section.key);
      assert.strictEqual(section.labels.length > 0, changed,
        `${where} "${section.key}": ${changed ? 'runs on the fixed example inputs but carries no example label'
          : 'carries the example label but does not depend on the fixed example inputs'}`);
      section.labels.forEach((label) => assert.ok(label.includes(expectedLabel),
        `${where} "${section.key}": example label does not read "${expectedLabel}"`));
    });
    // Non-vacuity on the scan: the mutation must have moved something.
    assert.ok(driven.length >= 3, `${where}: the fixed-input mutation moved only ${driven.length} section(s)`);
    out[where] = driven;
  }
  return { base, out };
}

test('every section driven by the fixed example inputs says so, on screen and in the report', () => {
  const { base, out } = labelAgreement(denver, 'Denver');
  // The banner must not claim those sections are local. It names the range of
  // labelled sections the mutation found, and says they are not Denver's.
  const numbers = out.page.map((key) => Number(key.match(/^(\d+)\./)[1]));
  const banner = base.mount.querySelector('[data-study-mode]').textContent.replace(/\s+/g, ' ');
  assert.ok(banner.includes(`Sections ${Math.min(...numbers)} to ${Math.max(...numbers)}`) && banner.includes("not Denver's data"),
    `the banner does not say that sections ${numbers.join(', ')} are not Denver's data`);
});

test('example mode labels the same sections, naming the example town', () => {
  // With no jurisdiction there is no buyer pool, so no report is offered
  // (asserted above for that case); the page is checked alone.
  const example = StudyGeography.inputs(null, DATA, ENGINES);
  assert.ok(mountFor(example).dom.window.document.getElementById('marketStudyReportDownload').disabled,
    'example mode now offers a report; check it here too');
  labelAgreement(example, scenarios[0].jurisdiction.name, false);
});

test('a report for another jurisdiction is not titled or partnered as the example town', () => {
  const { dom, model } = mountFor(denver);
  const preview = dom.window.document.getElementById('marketStudyReportPreview');
  const h1 = preview.querySelector('h1').textContent;
  assert.ok(/Denver/.test(h1), `the report title does not name Denver: ${h1}`);
  assert.ok(!/Fruita/.test(h1), `the Denver report is titled as the example town: ${h1}`);
  const built = Report.buildReport(model, { asOf: '2026-01-01', jurisdictionLabel: 'Denver', jurisdictionGeoid: '0820000',
    vintages: { scenario: 'x', homeValue: 'x', conventions: 'x' }, requiredCaveats: Report.REQUIRED_CAVEATS });
  assert.ok(!/Fruita/.test(built.title), `report.title (the exported <title>) names Fruita: ${built.title}`);
  assert.ok(Report.renderReportHtml(built).includes(`<title>${built.title}</title>`));
  const partnerTable = Array.from(preview.querySelectorAll('h3')).find((h) => h.textContent === 'Partners').nextElementSibling;
  assert.ok(partnerTable.querySelectorAll('tbody tr').length === model.scenario.partners.length, 'partner rows missing');
  const named = model.scenario.partners.map((p) => p.name).filter(Boolean);
  assert.ok(named.length > 0, 'the fixture names no partner, so this check would pass vacuously');
  for (const text of [partnerTable.textContent, dom.window.document.querySelector('#ms-s1').textContent]) {
    named.forEach((n) => assert.ok(!text.includes(n), `the Denver study lists the example town's partner "${n}"`));
    assert.ok(!/Fruita/.test(text.split('Partners').pop()), 'the Denver partners list mentions Fruita');
  }
});

test("the example town's own report keeps its project name and partners", () => {
  const fruita = StudyGeography.inputs(
    { geoid: scenarios[0].jurisdiction.place_geoid, geoLevel: 'place', name: 'Fruita', countyFips: '08077' }, DATA, ENGINES);
  const { dom, model } = mountFor(fruita);
  const preview = dom.window.document.getElementById('marketStudyReportPreview');
  assert.ok(/Fruita/.test(preview.querySelector('h1').textContent), 'Fruita lost its project title');
  model.scenario.partners.map((p) => p.name).filter(Boolean)
    .forEach((n) => assert.ok(preview.textContent.includes(n), `Fruita's report lost partner ${n}`));
});

console.log(failures === 0
  ? '  for-sale-study-follows-jurisdiction: PASS'
  : `  for-sale-study-follows-jurisdiction: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
