/** Honest, self-contained screening-report assembly from a Phase-8 model. */
(function (root, factory) {
  'use strict';
  var api = factory(root && root.ProvenanceLabel);
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../provenance-label.js'));
  if (root) root.MarketStudyReport = api;
}(typeof window !== 'undefined' ? window : this, function (ProvenanceLabel) {
  'use strict';

  var NA = 'not_available';
  var BANNER = 'SCREENING DRAFT — not a completed market study';
  var G2 = "CHAS cannot see above 100% HAMFI, so the 100–120% band's measured pool is structurally zero pending an above-100% income source.";
  var COMPETITIVE = 'Capture scenarios do not account for competing for-sale inventory or pipeline; no supply data source exists yet. A professional market study must supply the competitive set.';
  var HUMILITY = 'Even professionally delineated market areas captured only 44% of actual applicants at the Fruita Mews benchmark; outside-area demand of 9–56% is documented. Treat capture scenarios as screening arithmetic, not achievable-sales claims.';
  var BUYER_POOL = 'potential buyer pool (moderate-income renter households) - not committed demand';
  var FHA = 'Fruita Housing Authority ≠ Federal Housing Administration';
  var VERIFY = 'Verification parties: developer discussions, lender, appraiser, broker, program administrator, and local jurisdiction.';
  var LEGEND = 'Evidence labels distinguish confirmed sources, calculated estimates, owner inputs, and sources awaiting review.';
  var COMMITMENT = 'available is context, never money';
  var SCENARIO = 'scenario, not a prediction';
  var TRANSPARENCY = 'Owner-net transparency warning (conditional): always include the engine warning when present.';
  var INTERNAL_CAVEATS = Object.freeze([
    BANNER, 'Hypothesis to test', 'Values still needed', G2, COMPETITIVE,
    HUMILITY, BUYER_POOL, TRANSPARENCY, FHA, VERIFY, LEGEND, COMMITMENT, SCENARIO
  ]);
  var REQUIRED_CAVEATS = Object.freeze(INTERNAL_CAVEATS.slice());

  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unavailable(value) { return value === null || value === undefined || value === NA; }
  function noviceText(value) { return String(value).replace(/\bmodeled\b/gi, 'calculated'); }
  function display(value, kind) {
    if (unavailable(value)) return 'Owner input required';
    if (typeof value !== 'number') return escape(noviceText(value));
    if (kind === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    if (kind === 'rate') return value.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  function rounded(value, digits) {
    if (unavailable(value)) return 'Owner input required';
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }
  function formatSchedule(values, total) {
    if (!Array.isArray(values)) return display(values);
    var even = values.length > 0 && values.every(function (value) {
      return rounded(value, 2) === rounded(values[0], 2);
    });
    if (even) return '≈' + rounded(values[0], 2) + ' / month × ' + values.length + ' months (total ' + rounded(total, 2) + ')';
    return 'total ' + rounded(total, 2) + ' — ' + values.map(function (value) { return rounded(value, 2); }).join(' · ');
  }
  function formatAnnualClosings(values) {
    if (!Array.isArray(values)) return display(values);
    return values.map(function (value) { return rounded(value, 2); }).join(' · ');
  }
  function formatDenominator(figure, kind) {
    return display(figure.value, kind) + '<small>denominator: ' + rounded(figure.denominator.value, 2) + ' — ' + escape(noviceText(figure.denominator.basis)) + '</small>';
  }
  function formatAnnualCapture(values) {
    if (!Array.isArray(values)) return display(values);
    return values.map(function (entry, index) {
      return 'Year ' + (index + 1) + ': ' + (unavailable(entry.value) ? display(entry.value) : entry.value.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })) + ' — pool ' + rounded(entry.denominator.value, 2);
    }).join('<br>');
  }
  function badge(value, compact) { return ProvenanceLabel.html(typeof value === 'object' ? value : { classification: value }, { compact: compact !== false }); }
  function table(headers, rows) {
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (item) {
      return '<th>' + escape(item) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function assertComplete(html) {
    INTERNAL_CAVEATS.forEach(function (entry) {
      if (html.indexOf(entry) === -1) throw new Error('MarketStudyReport: required caveat missing: ' + entry);
    });
  }
  function buildReport(model, meta) {
    if (!model || !model.scenario || !model.derived || !model.funnel || !model.capture) {
      throw new Error('MarketStudyReport: a complete Phase-8 buildModel object is required');
    }
    meta = meta || {};
    if (!meta.asOf || !meta.vintages) throw new Error('MarketStudyReport: caller must supply asOf and vintages');
    var suppliedCaveats = meta.requiredCaveats || INTERNAL_CAVEATS;
    INTERNAL_CAVEATS.forEach(function (entry) {
      if (suppliedCaveats.indexOf(entry) === -1) throw new Error('MarketStudyReport: required caveat manifest is incomplete: ' + entry);
    });

    var scenario = model.scenario;
    var mixRows = scenario.program.unit_mix.map(function (row) {
      return '<tr><td>' + display(row.count) + '</td><td>' + display(row.bedrooms) + '</td><td>' + display(row.sqft_range[0]) + '–' + display(row.sqft_range[1]) + ' sq ft</td><td>' + badge(row) + '</td></tr>';
    });
    var amiRows = scenario.program.ami_mix.map(function (row) {
      return '<tr><td>' + display(row.band[0], 'rate') + '–' + display(row.band[1], 'rate') + '</td><td>' + display(row.count) + '</td><td>' + badge(row) + '</td></tr>';
    });
    var partnerRows = scenario.partners.map(function (row) {
      return '<tr><td>' + escape(row.role) + '</td><td>' + display(row.name || row.provider_id) + '</td><td>candidate — no commitment</td><td>' + badge(row) + '</td></tr>';
    });
    var project = '<section><h2>1. Project summary</h2><p><strong>Jurisdiction:</strong> ' + escape(scenario.jurisdiction.name) + '</p><p><strong>Total units:</strong> ' + display(scenario.program.total_units.value) + ' ' + badge(scenario.program.total_units) + '</p><p><strong>Tenure form:</strong> ' + display(scenario.program.tenure_form.value) + ' ' + badge(scenario.program.tenure_form) + '</p><h3>Unit mix and sizes</h3>' + table(['Units', 'Bedrooms', 'Size', 'Evidence'], mixRows) + '<h3>AMI mix</h3>' + table(['AMI band', 'Units', 'Evidence'], amiRows) + '<h3>Partners</h3>' + table(['Role', 'Candidate', 'Status', 'Evidence'], partnerRows) + '<p class="warning"><strong>FHA disambiguation:</strong> ' + FHA + '.</p></section>';

    var bandRows = model.derived.bands.map(function (row) {
      return '<tr><td>' + display(row.band[0], 'rate') + '–' + display(row.band[1], 'rate') + '</td><td>' + display(row.count) + '</td><td>' + display(row.maxAffordablePrice, 'money') + '</td><td>' + display(row.gapVsLocalPrice, 'money') + '</td><td><strong>' + escape(row.assistanceRangeCheck) + '</strong> finding</td><td>' + badge(row) + '</td></tr>';
    });
    var selectedOutcome = model.selectedConvention.results[model.selectedYear];
    var affordability = '<section><h2>2. Affordability &amp; gap</h2><p><strong>Local home value:</strong> ' + display(scenario.local_baseline.home_value.value, 'money') + ' — ' + escape(scenario.local_baseline.home_value.source) + ' (' + badge(scenario.local_baseline.home_value) + ')</p>' + table(['AMI band', 'Units', 'Max price', 'Gap vs local price', 'Assistance-range finding', 'Evidence'], bandRows) + '<p><strong>Income required at selected settlement:</strong> ' + display(selectedOutcome.futureBuyerIncomeNeeded, 'money') + ' ' + badge(selectedOutcome) + '</p></section>';

    var costs = Object.keys(scenario.costs).map(function (key) {
      var item = scenario.costs[key];
      return '<tr><td>' + escape(key) + '</td><td>' + display(item.value, 'money') + '</td><td>' + badge(item) + '</td></tr>';
    });
    var pending = scenario.meta.owner_inputs_pending.map(function (item) { return '<li>' + escape(item) + '</li>'; }).join('');
    var costSection = '<section><h2>3. Costs &amp; subsidy</h2>' + table(['Input', 'Value', 'Evidence'], costs) + '<p><strong>TDC per unit:</strong> ' + display(model.derived.tdcDependent.tdcPerUnit, 'money') + '</p><p><strong>Subsidy per unit:</strong> ' + display(model.derived.tdcDependent.subsidyPerUnit, 'money') + '</p><h3>What this report is waiting on</h3><p><strong>Values still needed</strong></p><ul>' + pending + '</ul></section>';

    var landCards = model.landOutcomes.map(function (item) {
      var checks = Object.keys(item.row.assessments).map(function (key) {
        var field = item.row.assessments[key];
        return '<li><strong>' + escape(key) + ':</strong> ' + display(field.value) + ' ' + badge(field, false) + '</li>';
      }).join('');
      return '<article><h3>' + escape(item.row.label) + '</h3><p>' + (item.row.modelId === 'model_a_public_land_retention' ? '<strong>Hypothesis to test</strong>' : '') + '</p><p>Initial per-unit affordability benefit: ' + display(item.row.initialPerUnitAffordabilityBenefit, 'money') + '</p><p>Monthly housing cost at year 5: ' + display(item.lifecycle.results[5].monthlyHousingCost, 'money') + ' ' + badge(item.lifecycle) + '</p><ul>' + checks + '</ul></article>';
    }).join('');
    var land = '<section><h2>4. Land disposition</h2><p>Models remain in policy-dataset order.</p>' + landCards + '<p class="warning">Retained-ownership property-tax nuance: improvements-basis treatment while the authority owns the land requires county-assessor and counsel confirmation.</p></section>';

    var conventionRows = model.conventionResults.map(function (result) {
      var outcome = result.results[model.selectedYear];
      return '<tr><td>' + escape(result.conventionLabel) + '</td><td>' + display(outcome.ownerNetProceeds, 'money') + '</td><td>' + escape(noviceText(outcome.preservesAffordabilityLabel)) + '</td><td>' + badge(result, false) + '</td><td>' + escape(result.scenarioLabel) + '</td></tr>';
    });
    var warning = model.settlement.ownerNetTransparencyWarning ? '<p class="warning"><strong>Owner-net transparency warning:</strong> ' + escape(model.settlement.ownerNetTransparencyNote) + '</p>' : '';
    var equity = '<section><h2>5. Shared equity &amp; settlement</h2>' + table(['Convention', 'Owner outcome', 'Affordability outcome', 'Evidence', 'Scenario'], conventionRows) + '<h3>Selected settlement</h3><p>' + escape(model.settlement.scenarioLabel) + ' ' + badge(model.settlement) + '</p><p>Public subsidy retained in home: <strong>' + display(model.settlement.publicSubsidyRetainedInHome, 'money') + '</strong></p><p>Public subsidy recaptured at sale: <strong>' + display(model.settlement.publicSubsidyRecapturedAtSale, 'money') + '</strong></p><p>Owner net proceeds: <strong>' + display(model.settlement.ownerNetProceeds, 'money') + '</strong></p><p>' + TRANSPARENCY + '</p>' + warning + '</section>';

    var funnelRows = model.funnel.stages.map(function (stage) {
      return '<tr><td>' + escape(stage.id === 'observed_base' ? 'Starting pool' : stage.id.replace(/_/g, ' ')) + '</td><td>' + display(stage.share, 'rate') + '</td><td>' + display(stage.outputCount) + '</td><td>' + escape(stage.label || '') + '</td><td>' + escape(stage.basis) + '</td><td>' + badge(stage) + '</td></tr>';
    });
    var demand = '<section><h2>6. Demand (screening)</h2><p><strong>Unresolved stages:</strong> ' + escape(model.funnel.unresolvedStages.length ? model.funnel.unresolvedStages.join(', ') : 'none') + '</p>' + table(['Stage', 'Share', 'Output', 'Protected label', 'Evidence basis', 'Classification'], funnelRows) + '<p><strong>' + BUYER_POOL + '</strong></p><p class="warning">' + G2 + '</p></section>';

    var captureRows = model.capture.scenarios.map(function (item) {
      return '<tr><td>' + escape(item.scenarioLabel) + '</td><td>' + formatSchedule(item.monthlyClosings, model.scenario.program.total_units.value) + '</td><td>' + formatAnnualClosings(item.annualClosings) + '</td><td>' + formatAnnualCapture(item.annualCaptureRate) + '</td><td>' + formatDenominator(item.totalProjectPenetration, 'rate') + '</td><td>' + formatDenominator(item.grossContractsNeeded) + '</td><td>' + display(item.poolDepletionModeled) + '</td></tr>';
    });
    var captureBands = Object.keys(model.capture.captureByAmiBand).map(function (key) {
      var item = model.capture.captureByAmiBand[key];
      return '<tr><td>' + escape(key) + '</td><td>' + display(item.numerator) + '</td><td>' + formatDenominator(item, 'rate') + '</td><td>' + escape(item.reason || '') + '</td></tr>';
    });
    var capture = '<section><h2>7. Capture scenarios (screening)</h2>' + table(['Pace', 'Monthly closings', 'Annual closings', 'Annual capture and denominator', 'Project penetration and denominator', 'Gross contracts and denominator', 'Pool depletion included'], captureRows) + table(['AMI band', 'Scenario units', 'Capture and denominator', 'Data limitation'], captureBands) + '<p class="warning">' + escape(model.capture.competitiveSupplyNote) + '</p><p class="warning">' + escape(model.capture.captureHumilityCaveat) + '</p></section>';

    var validation = '<section><h2>8. Validation steps</h2><p>' + VERIFY + '</p><ul><li>Legal: deed-restriction and ground-lease enforceability; CDARA exposure for attached product.</li><li>Appraisal treatment.</li><li>Lender product acceptance.</li><li>Administrator capacity.</li><li>Assessor treatment of restricted value.</li></ul></section>';
    var legend = '<section><h2>9. Evidence legend</h2><p><strong>' + LEGEND + '</strong></p><dl><dt>Source confirmed</dt><dd>A cited primary source supports the value.</dd><dt>Calculated estimate</dt><dd>The value follows a stated screening method and assumptions.</dd><dt>Enter your value</dt><dd>Replace the screening placeholder with a project-specific input.</dd><dt>Not yet verified</dt><dd>A named document exists but its applicable terms still need review.</dd></dl><p><strong>Commitment-status rule:</strong> ' + COMMITMENT + '.</p><p>All time-shaped paths retain the suffix “' + SCENARIO + '.”</p></section>';
    var vintages = '<ul><li>Scenario: ' + escape(meta.vintages.scenario) + '</li><li>Home value: ' + escape(meta.vintages.homeValue) + '</li><li>Resale conventions: ' + escape(meta.vintages.conventions) + '</li></ul>';
    var content = '<article class="report"><header><h1>Fruita Commons — For-Sale Fundamental Market Study</h1><p class="banner"><strong>' + BANNER + '</strong></p><p><strong>As of:</strong> ' + escape(meta.asOf) + '</p><h2>Data vintages</h2>' + vintages + '</header>' + project + affordability + costSection + land + equity + demand + capture + validation + legend + '<footer><strong>' + BANNER + '</strong></footer></article>';
    assertComplete(content);
    return Object.freeze({ title: 'Fruita Commons — For-Sale Fundamental Market Study', asOf: meta.asOf, content: content });
  }

  function renderReportPreview(report) {
    if (!report || !report.content) throw new Error('MarketStudyReport: report content is required');
    assertComplete(report.content);
    return report.content;
  }
  function renderReportHtml(report) {
    var content = renderReportPreview(report);
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(report.title) + '</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172033;max-width:1100px;margin:auto;padding:28px}h1,h2,h3{line-height:1.2}section{border-top:1px solid #bac4d0;padding-top:18px;margin-top:24px}.banner,.warning{border:2px solid #8b4b00;background:#fff5df;padding:12px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bac4d0;padding:7px;text-align:left;vertical-align:top}th{background:#eef2f6}.provenance__label{display:inline-block;border:1px solid #52616f;border-radius:999px;padding:1px 7px;font-size:.8em}.provenance__explanation{display:block;font-size:.85em;margin-top:3px}small{display:block}footer{border-top:3px solid #172033;margin-top:30px;padding-top:16px}@media print{body{max-width:none}.table-wrap{overflow:visible}}</style></head><body>' + content + '</body></html>';
  }

  return {
    REQUIRED_CAVEATS: REQUIRED_CAVEATS,
    formatSchedule: formatSchedule,
    formatAnnualClosings: formatAnnualClosings,
    formatAnnualCapture: formatAnnualCapture,
    formatDenominator: formatDenominator,
    buildReport: buildReport,
    renderReportPreview: renderReportPreview,
    renderReportHtml: renderReportHtml
  };
}));
