'use strict';

const assert = require('assert');
const { ciOrder } = require('./helpers/ci-wiring');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const Page = require('../js/project-market-study/market-study-page.js');
const Report = require('../js/project-market-study/market-study-report.js');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const conventions = require('../data/policy/resale-conventions.json');

const scenarioNames = [
  'fruita-commons.scenario.json', 'fruita-commons-compact.scenario.json',
  'fruita-commons-family.scenario.json', 'fruita-commons-broad-income.scenario.json'
];
const scenarios = scenarioNames.map((name) => require(path.join(ROOT, 'data/fixtures', name)));
function ownershipNeedModule() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8'), context);
  return context.window.HNAOwnershipNeed;
}
function observed(scenario) {
  const module = ownershipNeedModule();
  const chas = require('../data/hna/place-chas.json').places['0828745'];
  const profile = require('../data/hna/summary/0828745.json').acsProfile;
  return EffectiveDemand.fromOwnershipNeed(scenario, module.computeOwnershipNeed({
    geographyId: '0828745', geoLevel: 'place', placeChasEntry: chas,
    amiGapEntry: { ami_4person: scenario.local_baseline.ami_4person.value },
    homeValueEntry: scenario.local_baseline.home_value,
    ownerValueSupply: module.ownerValueSupplySeries(profile)
  }));
}
const data = { scenarios, conventions, observed: observed(scenarios[0]), reportAsOf: '2026-08-06' };
const meta = {
  asOf: data.reportAsOf,
  vintages: {
    scenario: scenarios[0].meta.as_of,
    homeValue: scenarios[0].local_baseline.home_value.as_of,
    conventions: conventions.meta.as_of
  },
  requiredCaveats: Report.REQUIRED_CAVEATS
};
function money(value) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function cloneReport(report, content) { return { title: report.title, asOf: report.asOf, content }; }

const model = Page.buildModel(data, {});
const report = Report.buildReport(model, meta);
const preview = Report.renderReportPreview(report);
const exported = Report.renderReportHtml(report);
// Counted on the provenance badge's own attribute, not on the bare words.
//
// The placeholder label used to read "Enter your value" — written in the
// grammar of a button, with no control behind it anywhere — and is now "Owner
// input required", which ownership-decision-chain.js and market-study-page.js
// already say for an absent value. That made a bare substring count ambiguous:
// the phrase occurs as ordinary body text elsewhere in the same document, so
// the old count jumped 45 -> 119 while nothing about the badges changed.
//
// #1514 pinned 3 / 167 / 45 / 5 by bare substring. Those decompose exactly as
// (2 x badges) + 1 legend entry — the attribute, the inner label span, and the
// <dt> in the evidence legend. The reconciliation is asserted below, so these
// numbers are demonstrably the same facts #1514 pinned rather than values read
// off the current output and pasted in.
const HISTORICAL_BARE_COUNTS = {
  'Source confirmed': 3,
  'Calculated estimate': 167,
  'Owner input required': 45,
  'Not yet verified': 5,
};
const BADGE_COUNTS = {
  'Source confirmed': 1,
  'Calculated estimate': 83,
  'Owner input required': 22,
  'Not yet verified': 2,
};
Object.entries(BADGE_COUNTS).forEach(([label, expectedCount]) => {
  const badge = `data-provenance-label="${label}"`;
  assert.strictEqual(exported.split(badge).length - 1, expectedCount,
    `${label} export count must remain unchanged from #1514`);
  assert.strictEqual(expectedCount * 2 + 1, HISTORICAL_BARE_COUNTS[label],
    `${label}: the badge count no longer reconciles with the #1514 bare-substring figure, `
    + 'so one of them has stopped describing the same thing');
});

// The legend explains the badges, so it has to use the badges' own words.
//
// Nothing tied the two together: renaming the placeholder label left the
// <dt> in section 9 saying "Enter your value" while every badge in the
// document said something else, and no test noticed. A glossary that defines
// terms the document does not use is worse than no glossary.
Object.keys(BADGE_COUNTS).forEach((label) => {
  assert.ok(exported.includes(`<dt>${label}</dt>`),
    `the evidence legend has no entry for "${label}", which every badge of that `
    + 'class is labelled with — the legend and the labels have drifted apart');
});

const bannedProvenanceTokens = /\b(?:observed|modeled|user_entered|not_available|VERIFY|hypothesis_to_test|owner_inputs_pending|is_commitment|observation_class|evidence_basis|primary_source|named_unretrieved|stated_method|machine_inferred|human_verified|unverified)\b/;
const exportMatch = exported.match(bannedProvenanceTokens);
assert(!exportMatch, 'export must use novice-facing evidence labels; context ' + exported.slice(Math.max(0, exportMatch && exportMatch.index - 50), (exportMatch && exportMatch.index || 0) + 80));

Report.REQUIRED_CAVEATS.forEach((entry) => {
  assert(preview.includes(entry), `preview caveat missing: ${entry}`);
  assert(exported.includes(entry), `export caveat missing: ${entry}`);
});

Report.REQUIRED_CAVEATS.forEach((entry) => {
  const strippedManifest = Report.REQUIRED_CAVEATS.filter((item) => item !== entry);
  assert.throws(() => Report.buildReport(model, Object.assign({}, meta, { requiredCaveats: strippedManifest })), /required caveat manifest is incomplete/);
  const strippedContent = report.content.split(entry).join('');
  assert.throws(() => Report.renderReportPreview(cloneReport(report, strippedContent)), /required caveat missing/);
  assert.throws(() => Report.renderReportHtml(cloneReport(report, strippedContent)), /required caveat missing/);
});

const firstBand = model.derived.bands[0];
assert(preview.includes(money(firstBand.gapVsLocalPrice)));
assert(exported.includes(money(firstBand.gapVsLocalPrice)));
assert(preview.includes('<p><strong>TDC per unit:</strong> Owner input required</p>'));
assert(preview.includes('<p><strong>Subsidy per unit:</strong> Owner input required</p>'));
const engineBoundMoney = money(model.landOutcomes[0].lifecycle.results[5].monthlyHousingCost);
assert(preview.includes('Monthly housing cost at year 5: ' + engineBoundMoney));
assert(exported.includes('Monthly housing cost at year 5: ' + engineBoundMoney));
assert.equal(model.settlement.publicSubsidyRetainedInHome, 20000);
assert.equal(model.settlement.publicSubsidyRecapturedAtSale, 80000);
assert(preview.includes('$20,000') && preview.includes('$80,000'));
assert(exported.includes('$20,000') && exported.includes('$80,000'));

const shares = {};
EffectiveDemand.STAGE_IDS.forEach((id) => { shares[id] = id === 'contract_fallout' ? 0.85 : 0.8; });
const resolved = Page.buildModel(data, { assumptions: shares });
const resolvedReport = Report.buildReport(resolved, meta);
const thirty = resolved.capture.scenarios.find((item) => item.selloutMonths === 30);
const denominator = thirty.totalProjectPenetration.denominator.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
assert(Report.renderReportPreview(resolvedReport).includes(denominator));
assert(Report.renderReportHtml(resolvedReport).includes(denominator));
const resolvedPreview = Report.renderReportPreview(resolvedReport);
const resolvedDom = new JSDOM(resolvedPreview);
const captureSection = Array.from(resolvedDom.window.document.querySelectorAll('section')).find((section) => section.querySelector('h2') && section.querySelector('h2').textContent.startsWith('7. Capture scenarios'));
const evenSchedule = '≈2.08 / month × 24 months (total 50)';
assert.strictEqual(Report.formatSchedule(resolved.capture.scenarios.find((item) => item.selloutMonths === 24).monthlyClosings, 50), evenSchedule);
assert(captureSection.innerHTML.includes(evenSchedule));
assert(captureSection.innerHTML.includes('25 · 25'));
assert(captureSection.innerHTML.includes('Year 1:'));
assert(captureSection.innerHTML.includes('Year 2:'));
assert(!/\d\.\d{4,}/.test(captureSection.innerHTML), 'report capture section must not expose floating-point noise');
const pageDom = new JSDOM('<main><div id="mount"></div></main>');
Page.render(pageDom.window.document.getElementById('mount'), resolved, data);
const pageSchedule = pageDom.window.document.querySelector('#ms-s6 tbody tr td:nth-child(2)').textContent;
const reportSchedule = captureSection.querySelector('tbody tr td:nth-child(2)').textContent;
assert.strictEqual(pageSchedule, reportSchedule, 'page S6 and report §7 must use the identical shared schedule string');

assert.equal(model.funnel.effectiveDemand, 'not_available');
model.funnel.stages.forEach((stage) => assert(preview.includes(stage.basis)));
assert(preview.includes('Owner input required'));
assert(preview.includes(model.funnel.unresolvedStages.join(', ')));

assert(!/<script\b/i.test(exported));
assert(!/<link\b/i.test(exported));
assert(!/src=["'](?:https?:)?\/\//i.test(exported));
assert(!/<link\b[^>]*href=["'](?:https?:)?\/\//i.test(exported));
assert(!/priced.out|% of households/i.test(exported));
const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/market-study-report.js'), 'utf8');
assert(!/Date\.now|new\s+Date\s*\(/.test(source));
assert(!/priced[- ]out[^\n%]{0,80}%/i.test(source));
assert(!/\b(rank(?:ed|ing)?|recommended|preferred|winner|best option|merit score)\b/i.test(source));
assert(!/(model|result|row|item|stage|funnel|capture|report)\.[A-Za-z0-9_.]+\s*[+*\/-]\s*/.test(source));

const dom = new JSDOM('<main><div id="mount"></div><section id="ms-s7"><button id="marketStudyReportDownload"></button><div id="marketStudyReportPreview"></div></section></main>', { url: 'http://127.0.0.1/for-sale-market-study.html' });
let blobParts = null;
let filename = null;
const priorBlob = global.Blob;
const priorUrl = global.URL;
global.Blob = function (parts) { blobParts = parts; };
global.URL = { createObjectURL: () => 'blob:report', revokeObjectURL: () => {} };
dom.window.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
Page.start(dom.window.document.getElementById('mount'), data);
assert(dom.window.document.getElementById('marketStudyReportPreview').innerHTML.includes(Report.REQUIRED_CAVEATS[0]));
dom.window.document.getElementById('marketStudyReportDownload').click();
// #1620 §7 slice 2 — the download is named after the study's jurisdiction, and
// this `data` carries none, so it is the example. The old name put one town on
// every reader's disk: a screening draft for another jurisdiction would be
// filed, and later read, as that town's.
assert.equal(filename, 'example-for-sale-market-study-screening-draft.html');
assert(blobParts && blobParts[0].includes('$20,000') && blobParts[0].includes('$80,000'));
Report.REQUIRED_CAVEATS.forEach((entry) => assert(blobParts[0].includes(entry)));
global.Blob = priorBlob;
global.URL = priorUrl;

const html = fs.readFileSync(path.join(ROOT, 'for-sale-market-study.html'), 'utf8');
assert(html.includes('id="ms-s7"'));
assert(html.includes('js/project-market-study/market-study-report.js'));
const pkg = require('../package.json');
assert.equal(pkg.scripts['test:market-study-report'], 'node test/market-study-report.test.js');
{
  const o = ciOrder(pkg.scripts);
  assert(o.indexOf('test:market-study-report') > o.indexOf('test:market-study-page'),
    'market-study-report must run after market-study-page');
}

console.log('market-study-report tests passed');
