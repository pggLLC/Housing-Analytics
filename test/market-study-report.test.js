'use strict';

const assert = require('assert');
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
assert.equal(model.settlement.publicSubsidyRetainedInHome, 20000);
assert.equal(model.settlement.publicSubsidyRecapturedAtSale, 80000);
assert(preview.includes('$20,000') && preview.includes('$80,000'));
assert(exported.includes('$20,000') && exported.includes('$80,000'));

const shares = {};
EffectiveDemand.STAGE_IDS.forEach((id) => { shares[id] = id === 'contract_fallout' ? 0.85 : 0.8; });
const resolved = Page.buildModel(data, { assumptions: shares });
const resolvedReport = Report.buildReport(resolved, meta);
const thirty = resolved.capture.scenarios.find((item) => item.selloutMonths === 30);
const denominator = thirty.totalProjectPenetration.denominator.value.toLocaleString('en-US', { maximumFractionDigits: 3 });
assert(Report.renderReportPreview(resolvedReport).includes(denominator));
assert(Report.renderReportHtml(resolvedReport).includes(denominator));

assert.equal(model.funnel.effectiveDemand, 'not_available');
model.funnel.stages.forEach((stage) => assert(preview.includes(stage.basis)));
assert(preview.includes('not_available — owner input required'));
assert(preview.includes(model.funnel.unresolvedStages.join(', ')));

assert(!/<script\b/i.test(exported));
assert(!/<link\b/i.test(exported));
assert(!/(?:src|href)=["'](?:https?:)?\/\//i.test(exported));
const source = fs.readFileSync(path.join(ROOT, 'js/project-market-study/market-study-report.js'), 'utf8');
assert(!/Date\.now|new\s+Date\s*\(/.test(source));
assert(!/priced[- ]out[^\n%]{0,80}%/i.test(source));
assert(!/\b(rank(?:ed|ing)?|recommended|preferred|winner|best option|merit score)\b/i.test(source));
assert(!/(model|result|row|item|stage|funnel|capture|report)\.[A-Za-z0-9_.]+\s*[+*\/-]\s*/.test(source));

const dom = new JSDOM('<main><div id="mount"></div><section id="ms-s7"><button id="marketStudyReportDownload"></button><div id="marketStudyReportPreview"></div></section></main>', { url: 'https://cohoanalytics.com/for-sale-market-study.html' });
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
assert.equal(filename, 'fruita-commons-market-study-screening-draft.html');
assert(blobParts && blobParts[0].includes('$20,000') && blobParts[0].includes('$80,000'));
Report.REQUIRED_CAVEATS.forEach((entry) => assert(blobParts[0].includes(entry)));
global.Blob = priorBlob;
global.URL = priorUrl;

const html = fs.readFileSync(path.join(ROOT, 'for-sale-market-study.html'), 'utf8');
assert(html.includes('id="ms-s7"'));
assert(html.includes('js/project-market-study/market-study-report.js'));
const pkg = require('../package.json');
assert.equal(pkg.scripts['test:market-study-report'], 'node test/market-study-report.test.js');
assert(pkg.scripts['test:ci'].indexOf('test:market-study-report') > pkg.scripts['test:ci'].indexOf('test:market-study-page'));

console.log('market-study-report tests passed');
