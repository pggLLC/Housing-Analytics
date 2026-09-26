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
// Household display is presentation only: absence, measured zero, and a
// positive estimate smaller than one household are three different states.
const unavailableHouseholds = Report.formatHouseholds(null);
assert.strictEqual(unavailableHouseholds, 'Owner input required');
[
  [undefined, unavailableHouseholds], [NaN, unavailableHouseholds],
  [Infinity, unavailableHouseholds], [-Infinity, unavailableHouseholds],
  ['invalid', unavailableHouseholds], [-1, unavailableHouseholds],
  [0, '0'], [0.01, '<1'], [0.2, '<1'], [0.49, '<1'],
  [0.5, '<1'], [0.99, '<1'], [1, '1'], [1.4, '1'],
  [54102.5, '54,103']
].forEach(([value, expected]) => assert.strictEqual(Report.formatHouseholds(value), expected,
  `household display for ${String(value)}`));
assert.notStrictEqual(Report.formatHouseholds(0), unavailableHouseholds);
assert.notStrictEqual(Report.formatHouseholds(0.2), Report.formatHouseholds(0));
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
// A buyer-pool denominator is a count of households: shown whole.
const denominator = 'denominator: ' + Math.round(thirty.totalProjectPenetration.denominator.value).toLocaleString('en-US') + ' ';
assert(!Number.isInteger(thirty.totalProjectPenetration.denominator.value),
  'the fixture pool is a whole number, so the rounding assertion would pass vacuously');
assert(Report.renderReportPreview(resolvedReport).includes(denominator));
assert(Report.renderReportHtml(resolvedReport).includes(denominator));
const resolvedPreview = Report.renderReportPreview(resolvedReport);
const resolvedDom = new JSDOM(resolvedPreview);
const captureSection = Array.from(resolvedDom.window.document.querySelectorAll('section')).find((section) => section.querySelector('h2') && section.querySelector('h2').textContent.startsWith('7. Capture scenarios'));
const evenSchedule = '≈2.08 / month × 24 months (total 50)';
assert.strictEqual(Report.formatSchedule(resolved.capture.scenarios.find((item) => item.selloutMonths === 24).monthlyClosings, 50), evenSchedule);
assert(captureSection.innerHTML.includes(evenSchedule));
assert(captureSection.innerHTML.includes('25 · 25'));
assert.strictEqual(captureSection.querySelectorAll('tbody tr')[1].children[3].innerHTML.split(/<br\s*\/?\s*>/i).length,
  resolved.capture.scenarios.find((item) => item.selloutMonths === 30).annualCaptureRate.length,
  'report annual capture must show one entry for each model year');
assert(!/\d\.\d{4,}/.test(captureSection.innerHTML), 'report capture section must not expose floating-point noise');
const pageDom = new JSDOM('<main><div id="mount"></div></main>');
Page.render(pageDom.window.document.getElementById('mount'), resolved, data);
const pageSchedule = pageDom.window.document.querySelector('#ms-s6 tbody tr td:nth-child(2)').textContent;
const reportSchedule = captureSection.querySelector('tbody tr td:nth-child(2)').textContent;
assert.strictEqual(pageSchedule, reportSchedule, 'page S6 and report §7 must use the identical shared schedule string');

// Read only the annual-capture cell for a scenario, independently of its
// surrounding sentence. Each value is checked against the unrounded engine
// figure, then the two surfaces against each other.
function annualNumbers(cell) {
  const firstLineNode = cell.ownerDocument.createElement('span');
  firstLineNode.innerHTML = cell.innerHTML.split(/<br\s*\/?\s*>/i)[0];
  const firstLine = firstLineNode.textContent;
  const percents = firstLine.match(/\d[\d,]*(?:\.\d+)?%/g) || [];
  assert.strictEqual(percents.length, 1, 'the first annual-capture line needs one percentage');
  const afterPercent = firstLine.slice(firstLine.indexOf(percents[0]) + percents[0].length);
  const pools = afterPercent.match(/<1|\d[\d,]*/g) || [];
  assert.strictEqual(pools.length, 1, 'the first annual-capture line needs one household denominator');
  return { percent: percents[0], pool: pools[0] };
}
function annualAgreement(captureModel, pageDocument, reportDocument) {
  const scenarioIndex = captureModel.capture.scenarios.findIndex((item) => item.selloutMonths === 30);
  assert(scenarioIndex >= 0, 'the 30-month scenario is missing');
  const entry = captureModel.capture.scenarios[scenarioIndex].annualCaptureRate[0];
  assert(Number.isFinite(entry.value) && Number.isFinite(entry.denominator.value));
  const expected = {
    percent: entry.value.toLocaleString('en-US', {
      style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1
    }),
    pool: Report.formatHouseholds(entry.denominator.value)
  };
  const pageCell = pageDocument.querySelectorAll('#ms-s6 tbody tr')[scenarioIndex].children[3];
  const section = Array.from(reportDocument.querySelectorAll('section')).find((node) =>
    node.querySelector('h2') && node.querySelector('h2').textContent.startsWith('7. Capture scenarios'));
  assert(section, 'the report capture section is missing');
  const reportCell = section.querySelectorAll('tbody tr')[scenarioIndex].children[3];
  const onPage = annualNumbers(pageCell);
  const inReport = annualNumbers(reportCell);
  assert.deepStrictEqual(onPage, expected, 'page annual capture disagrees with the model');
  assert.deepStrictEqual(inReport, expected, 'report annual capture disagrees with the model');
  assert.deepStrictEqual(onPage, inReport, 'page and report annual capture disagree');
  return expected;
}
annualAgreement(resolved, pageDom.window.document, resolvedDom.window.document);

// This fixture goes through the real demand and capture engines. Its positive
// fractional pool must stay precise in division, while both renderers say <1.
const tinyShares = Object.assign({}, shares, { [EffectiveDemand.STAGE_IDS[0]]: 0.000001 });
const tinyModel = Page.buildModel(data, { assumptions: tinyShares });
const tinyPool = tinyModel.funnel.effectiveDemand;
assert(tinyPool > 0 && tinyPool < 1, 'the fixture must produce a positive sub-one buyer pool');
const tinyYear = tinyModel.capture.scenarios.find((item) => item.selloutMonths === 30).annualCaptureRate[0];
assert.strictEqual(tinyYear.denominator.value, tinyPool, 'capture must receive the unrounded pool');
assert(Math.abs(tinyYear.value - tinyModel.capture.scenarios.find((item) => item.selloutMonths === 30).annualClosings[0] / tinyPool) < 1e-8,
  'capture percentage must use the full-precision denominator');
const tinyPage = new JSDOM('<main><div id="mount"></div></main>');
Page.render(tinyPage.window.document.getElementById('mount'), tinyModel, data);
const tinyReport = new JSDOM(Report.renderReportPreview(Report.buildReport(tinyModel, meta)));
assert.strictEqual(annualAgreement(tinyModel, tinyPage.window.document, tinyReport.window.document).pool, '<1');
assert.strictEqual(tinyModel.funnel.effectiveDemand, tinyPool, 'rendering must not round the engine result');
assert.strictEqual(tinyYear.denominator.value, tinyPool, 'rendering must not round the capture denominator');
const tinyFunnelPage = Array.from(tinyPage.window.document.querySelectorAll('#ms-s5 tbody tr')).at(-1).children[2].textContent.trim();
const tinyDemandSection = Array.from(tinyReport.window.document.querySelectorAll('section')).find((node) =>
  node.querySelector('h2') && node.querySelector('h2').textContent.startsWith('6. Demand'));
const tinyFunnelReport = Array.from(tinyDemandSection.querySelectorAll('tbody tr')).at(-1).children[2].textContent.trim();
assert.strictEqual(tinyFunnelPage, '<1');
assert.strictEqual(tinyFunnelReport, tinyFunnelPage);

// A contract-survival denominator is a share, and annual capture is a percent.
// Neither inherits the household-count rounding rule.
const survival = resolved.capture.scenarios[0].grossContractsNeeded.denominator;
assert.strictEqual(survival.value, 0.85);
assert.strictEqual(Report.formatDenominatorValue(survival), '0.85');
const pageShare = pageDom.window.document.querySelector('#ms-s6 tbody tr td:nth-child(6) .ms-denominator').textContent;
const reportShare = captureSection.querySelector('tbody tr td:nth-child(6) small').textContent;
assert(pageShare.includes('0.85') && reportShare.includes('0.85'));

// Sabotage the comparison helper without changing any repository source: a
// harmless rewording passes; an incorrect percent or pool is rejected.
const year = resolved.capture.scenarios.find((item) => item.selloutMonths === 30).annualCaptureRate[0];
const expectedYear = {
  percent: year.value.toLocaleString('en-US', {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1
  }),
  pool: Report.formatHouseholds(year.denominator.value)
};
const alternate = new JSDOM('<table><tr><td>First year used ' + expectedYear.percent + ' of ' + expectedYear.pool + ' households</td></tr></table>');
const alternateCell = alternate.window.document.querySelector('td');
assert.deepStrictEqual(annualNumbers(alternateCell), expectedYear);
const originalText = alternateCell.innerHTML;
const percentSabotage = originalText.replace(expectedYear.percent, '999.9%');
assert.notStrictEqual(percentSabotage, originalText, 'percentage sabotage did not apply');
alternateCell.innerHTML = percentSabotage;
assert.throws(() => assert.deepStrictEqual(annualNumbers(alternateCell), expectedYear));
const poolSabotage = originalText.replace(expectedYear.pool + ' households', '999 households');
assert.notStrictEqual(poolSabotage, originalText, 'denominator sabotage did not apply');
alternateCell.innerHTML = poolSabotage;
assert.throws(() => assert.deepStrictEqual(annualNumbers(alternateCell), expectedYear));

assert.equal(model.funnel.effectiveDemand, 'not_available');
model.funnel.stages.forEach((stage) => assert(preview.includes(stage.basis)));
assert(preview.includes('Owner input required'));
assert(preview.includes(model.funnel.unresolvedStages.join(', ')));

// The verdict section leads the report with an answer, or an honest account
// of why there isn't one yet, instead of leaving nine tables of data with no
// synthesis — reported as missing after "the effective demand funnel is
// really difficult to understand ... what else is missing to make a clear
// ownership decision."
const verdictHeading = 'The screening answer, so far';
assert(preview.indexOf(verdictHeading) < preview.indexOf('1. Project summary'),
  'the verdict section must lead the report, before section 1');
assert(preview.includes('Not enough local data yet for even a screening-level answer.'));
assert(preview.includes('0 of ' + (model.funnel.stages.length - 1) + ' demand-funnel stages have a local share entered'));

const resolvedVerdictPreview = Report.renderReportPreview(resolvedReport);
assert(resolvedVerdictPreview.indexOf(verdictHeading) < resolvedVerdictPreview.indexOf('1. Project summary'));
assert(resolvedVerdictPreview.includes('Effective demand: ' + Math.round(resolved.funnel.effectiveDemand).toLocaleString('en-US') + ' households'));
// No household count anywhere in the report carries a fraction: every
// "N households" and every "pool N" is a whole number.
{
  const counts = (resolvedVerdictPreview.match(/[\d,.]+(?= households)|(?<=pool )[\d,.]+/g) || []);
  assert(counts.length >= 3, 'the household-count scan found too little to check');
  counts.forEach((count) => assert(!/\.\d/.test(count), 'fractional household count in the report: ' + count));
  const demandDoc = new JSDOM(resolvedVerdictPreview).window.document;
  const demandSection = Array.from(demandDoc.querySelectorAll('section')).find((s) => s.querySelector('h2') && s.querySelector('h2').textContent.startsWith('6. Demand'));
  const left = Array.from(demandSection.querySelectorAll('tbody tr td:nth-child(3)')).map((td) => td.textContent.trim());
  assert.strictEqual(left.length, resolved.funnel.stages.length);
  resolved.funnel.stages.forEach((stage, i) => assert.strictEqual(left[i], Math.round(stage.outputCount).toLocaleString('en-US'),
    `report funnel row ${i} shows ${left[i]} for ${stage.outputCount} households`));
}
assert(resolvedVerdictPreview.includes(resolved.scenario.program.total_units.value + '-unit program'));
assert(resolvedVerdictPreview.includes('would need to capture'));
assert(resolvedVerdictPreview.includes(denominator), 'verdict penetration figure must match the same denominator section 7 uses');

// Plain language: the report is read by people who have never seen the
// engines, so no engine field id may reach them except in the one line that
// exists to name the field ids. Scanned on rendered text, both states.
{
  const engineIds = new Set([
    ...EffectiveDemand.STAGE_IDS,
    ...Object.keys(scenarios[0].costs),
    ...scenarios[0].meta.owner_inputs_pending,
    ...scenarios[0].partners.map((partner) => partner.role),
    ...model.landOutcomes.flatMap((item) => Object.keys(item.row.assessments)),
    ...model.landOutcomes.flatMap((item) => Object.values(item.row.assessments).map((field) => field.value)),
    'pool_zero_see_data_limitations', 'contract_fallout',
  ].filter((id) => /_/.test(id)));
  assert(engineIds.size > 40, 'the id scan lost its inputs and would pass vacuously');
  [preview, Report.renderReportPreview(resolvedReport)].forEach((content) => {
    const doc = new JSDOM(content).window.document;
    doc.querySelectorAll('.field-ids').forEach((node) => node.remove());
    // Text node by text node: textContent runs adjacent table cells together
    // ("…compatibilityOwner input required"), which hides an id from \b.
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const chunks = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) chunks.push(node.nodeValue);
    const words = chunks.join(' ');
    assert(words.length > 5000, 'the rendered report is too short to be the report');
    const leaked = Array.from(engineIds).filter((id) => new RegExp(`\\b${id}\\b`).test(words));
    assert.deepStrictEqual(leaked, [], 'engine field ids reached the reader: ' + leaked.join(', '));
  });
}

// The page and the downloaded report name every funnel step the same way,
// because both read Report.PLAIN_LABELS. Asserted on what each renders.
{
  const pageDomLabels = new JSDOM('<main><div id="mount"></div></main>');
  Page.render(pageDomLabels.window.document.getElementById('mount'), model, data);
  const pageSteps = Array.from(pageDomLabels.window.document.querySelectorAll('#ms-s5 tbody tr td:first-child')).map((td) => td.textContent.trim());
  const reportDoc = new JSDOM(preview).window.document;
  const demandSection = Array.from(reportDoc.querySelectorAll('section')).find((section) => section.querySelector('h2').textContent.startsWith('6. Demand'));
  const reportSteps = Array.from(demandSection.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent.trim());
  assert.strictEqual(reportSteps.length, EffectiveDemand.STAGE_IDS.length + 1, 'the report funnel table lost rows');
  assert.deepStrictEqual(reportSteps, pageSteps, 'the page and the report name the funnel steps differently');
}

// A zero buyer pool is a measured result, not a missing input, and "empty
// from the start" is a different fact from "used up by earlier sales".
// Asserted on state, not wording: each rendered line is compared with the
// line the same formatter gives a genuinely missing input, and with lines for
// the other zero case, so the copy can be reworded freely.
{
  const lineBody = (line) => line.replace(/^Year \d+: /, '');
  // The value part only: the pool figure after " — " differs between cases.
  const valuePart = (body) => body.split(' — ')[0];
  const missingInput = valuePart(lineBody(Report.formatAnnualCapture([{ value: 'not_available', denominator: { value: 'not_available' } }])));
  assert(missingInput.length > 0, 'could not read the missing-input label from the formatter');
  const zeroShares = Object.assign({}, shares, { contract_fallout: 0 });
  const zeroModel = Page.buildModel(data, { assumptions: zeroShares });
  assert.strictEqual(zeroModel.funnel.effectiveDemand, 0, 'fixture no longer produces a zero-demand funnel');
  const zeroReport = Report.renderReportPreview(Report.buildReport(zeroModel, meta));
  const zeroPage = new JSDOM('<main><div id="mount"></div></main>');
  Page.render(zeroPage.window.document.getElementById('mount'), zeroModel, data);
  const lastPageCount = Array.from(zeroPage.window.document.querySelectorAll('#ms-s5 tbody tr')).at(-1).children[2].textContent.trim();
  const zeroReportDoc = new JSDOM(zeroReport).window.document;
  const zeroDemandSection = Array.from(zeroReportDoc.querySelectorAll('section')).find((node) =>
    node.querySelector('h2') && node.querySelector('h2').textContent.startsWith('6. Demand'));
  const lastReportCount = Array.from(zeroDemandSection.querySelectorAll('tbody tr')).at(-1).children[2].textContent.trim();
  assert.strictEqual(lastPageCount, '0', 'page measured zero must remain zero');
  assert.strictEqual(lastReportCount, lastPageCount, 'report measured zero must agree with page');
  assert.notStrictEqual(lastPageCount, unavailableHouseholds, 'measured zero must differ from unavailable');
  assert.notStrictEqual(lastPageCount, Report.formatHouseholds(tinyPool), 'measured zero must differ from positive sub-one');
  const depleted = [];
  const emptyFromStart = [];
  [[resolved, Report.renderReportPreview(resolvedReport)], [zeroModel, zeroReport]].forEach(([m, rendered]) => {
    m.capture.scenarios.forEach((item) => {
      const lines = Report.formatAnnualCapture(item.annualCaptureRate).split('<br>');
      assert(rendered.includes(lines.join('<br>')), 'the report does not render the shared capture formatter output');
      let hadBuyers = false;
      item.annualCaptureRate.forEach((entry, index) => {
        if (entry.denominator.value === 0) (hadBuyers ? depleted : emptyFromStart).push(lineBody(lines[index]));
        if (entry.denominator.value > 0) hadBuyers = true;
      });
    });
  });
  assert(depleted.length > 0 && emptyFromStart.length > 0, 'the fixtures no longer cover both zero-pool cases');
  [...depleted, ...emptyFromStart].forEach((body) => {
    assert.notStrictEqual(valuePart(body), missingInput, 'a zero buyer pool is labelled as a missing input: ' + body);
  });
  const depletedSet = new Set(depleted);
  emptyFromStart.forEach((body) => assert(!depletedSet.has(body),
    'a pool that was empty from the start is described the same way as one used up by sales: ' + body));
}

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
