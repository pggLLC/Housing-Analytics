/** Display-only controller for the for-sale market-study comparison workflow. */
(function (root, factory) {
  'use strict';
  var api = factory(
    root && root.ProjectScenario,
    root && root.OwnershipFinance,
    root && root.LandDisposition,
    root && root.SharedEquityLifecycle,
    root && root.ResaleWaterfall,
    root && root.EffectiveDemand,
    root && root.ForsaleCapture,
    root && root.MarketStudyReport,
    root && root.ProvenanceLabel,
    root && root.StudyGeography
  );
  if (typeof module === 'object' && module.exports) {
    api = factory(
      require('./project-scenario.js'), require('../hna/ownership-finance.js'),
      require('./land-disposition.js'), require('./shared-equity-lifecycle.js'),
      require('./resale-waterfall.js'), require('./effective-demand.js'),
      require('./forsale-capture.js'), require('./market-study-report.js'),
      require('../provenance-label.js'), require('./study-geography.js')
    );
    module.exports = api;
  }
  if (root) root.MarketStudyPage = api;
}(typeof window !== 'undefined' ? window : this, function (
  ProjectScenario, OwnershipFinance, LandDisposition, SharedEquityLifecycle,
  ResaleWaterfall, EffectiveDemand, ForsaleCapture, MarketStudyReport, ProvenanceLabel,
  StudyGeography
) {
  'use strict';

  var NOT_AVAILABLE = 'not_available';
  var HORIZONS = [5, 10, 20, 30];
  var LAND_INPUTS = {
    landValuePerUnit: 100000, groundRentMonthly: 150,
    groundRentEscalationRate: 0.02, marketPropertyTaxRate: 0.006,
    restrictedValueAssessment: false, unitPrice: 400000,
    discountedLandShare: 0.4, landWriteDown: 25000
  };
  var WATERFALL_INPUTS = {
    sellingCostRate: 0.06, returnOwnerDownPayment: true,
    ownerDownPayment: 40000, originalRestrictedPrice: 400000,
    publicAppreciationShare: 0.25,
    subsidyRecovery: { countSubordinatePublicSources: true, countAppreciationShare: true },
    publicSubsidyAtClosing: 100000, nextBuyerPricing: 'formula',
    totalOwnerCashInvested: 50000
  };

  function lifecycleInput(path, landEngine) {
    return {
      unrestrictedValue: 500000, restrictedPrice: 400000, downPayment: 40000,
      subordinateDebt: [{
        label: 'Public deferred assistance', principal: 50000, interestRate: 0,
        structure: 'deferred', publicSource: true
      }],
      firstMortgage: { rateAnnual: 0.06, termYears: 30 },
      hoaMonthly: 175, hoaEscalationRate: 0.03,
      groundRentMonthly: landEngine.groundRentMonthly,
      groundRentEscalationRate: landEngine.groundRentEscalationRate,
      propertyTaxRate: landEngine.propertyTaxRate,
      insuranceRate: 0.0035, pmiRate: 0.005,
      scenario: path, ami4Person: 100000, amiPct: 0.8, householdSize: 4,
      sellingCostRate: 0.06, capitalImprovements: [],
      publicSubsidyAtClosing: 100000, horizons: HORIZONS
    };
  }

  function unavailable(value) { return value === NOT_AVAILABLE || value === null || value === undefined; }
  function noviceText(value) { return String(value).replace(/\bmodeled\b/gi, 'calculated'); }
  function display(value, kind) {
    if (unavailable(value)) return '<span class="ms-unavailable">Owner input required</span>';
    if (typeof value !== 'number') return noviceText(value);
    if (kind === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    if (kind === 'rate') return value.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  function pill(value) { return ProvenanceLabel.html(typeof value === 'object' ? value : { classification: value }, { compact: true }); }
  function provenance(value) { return ProvenanceLabel.html(value); }
  function caveat() { return '<p class="ms-caveat">Screening arithmetic for analyst review; verify source evidence and owner inputs before project use.</p>'; }
  // Plain-language labels live in market-study-report.js so the page and the
  // downloaded report describe every field the same way.
  // Looked up at call time: this factory also runs once before the report
  // module is loaded (the bare-global pass in Node).
  function humanize(id) { return MarketStudyReport.humanize(id); }
  function plainLabel(group, id) {
    var labels = MarketStudyReport.PLAIN_LABELS[group];
    return (labels && labels[id]) || humanize(id);
  }
  function stageLabel(id) { return plainLabel('stages', id); }
  function affordabilityAnswer(item) {
    if (typeof item.preservesAffordability !== 'boolean') return noviceText(item.preservesAffordabilityLabel);
    return (item.preservesAffordability ? '<strong>Yes</strong> — ' : '<strong>No</strong> — ') + noviceText(item.preservesAffordabilityLabel);
  }
  function plain(text) { return `<p class="ms-plain"><strong>In plain terms:</strong> ${text}</p>`; }
  function heading(text, term) { return `<h2>${text}${term ? ` <span class="ms-term">(${term})</span>` : ''}</h2>`; }
  function marketPathLabel(value) { return value.replace(/\s+—\s+scenario, not a prediction$/, ''); }
  function assistanceForBand(scenario, band) {
    return scenario.assistance_ranges.find(function (item) {
      return item.band[0] === band[0] && item.band[1] === band[1];
    });
  }
  function assistanceFinding(row, assistance) {
    if (!assistance || unavailable(row.gapVsLocalPrice) || row.assistanceRangeCheck === 'unknown') {
      return '<span class="ms-unavailable">Assistance comparison unavailable</span>';
    }
    if (row.assistanceRangeCheck === 'sufficient') {
      return '<strong>Gap covered</strong><span class="ms-assistance-qualifier">sufficient at the top of the available assistance range</span>';
    }
    var gap = Math.max(0, row.gapVsLocalPrice);
    var maximumAssistance = assistance.range[1];
    var residual = Math.max(0, gap - maximumAssistance);
    return `<strong class="ms-assistance-residual">Short by ${display(residual, 'money')}</strong><span class="ms-assistance-qualifier">insufficient at the top of the available assistance range</span>`;
  }
  function table(headers, rows, label) {
    return `<div class="ms-table-wrap"><table aria-label="${label}"><thead><tr>${headers.map(function (item) { return `<th>${item}</th>`; }).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function scenarioKey(doc) {
    return doc.program.variant_note ? doc.program.variant_note.value : doc.meta.name;
  }
  function scenarioByKey(data, key) {
    return data.scenarios.find(function (doc) { return scenarioKey(doc) === key; }) || data.scenarios[0];
  }
  function assumptionSet(values) {
    var out = {};
    EffectiveDemand.STAGE_IDS.forEach(function (id) {
      var value = values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : null;
      out[id] = {
        share: value, classification: value === null ? 'modeled' : 'user_entered',
        basis: EffectiveDemand.DEFAULT_ASSUMPTIONS[id].basis, verify: true, sensitivity: null
      };
    });
    return out;
  }
  function landLifecycle(path, row) {
    return SharedEquityLifecycle.project(Object.assign({}, lifecycleInput(path, row.engineInputs), {
      formula: { type: 'fixed_simple', annualRate: 0.03, appraisalCap: false }
    }));
  }

  function buildModel(data, options) {
    options = options || {};
    var scenario = scenarioByKey(data, options.scenarioKey);
    // The reader's jurisdiction supplies the market; the fixture supplies the
    // program. With no jurisdiction chosen this is null and the fixture's own
    // baseline stands, which is the example study exactly as it shipped.
    var localBaseline = data.localBaseline || null;
    var derived = ProjectScenario.derive(scenario, OwnershipFinance, localBaseline ? { localBaseline: localBaseline } : {});
    var path = SharedEquityLifecycle.SCENARIOS[options.pathKey || 'base'];
    var landRows = LandDisposition.compare(LAND_INPUTS);
    var landOutcomes = landRows.map(function (row) {
      return { row: row, lifecycle: landLifecycle(path, row) };
    });
    var conventionResults = data.conventions.conventions.map(function (convention) {
      return SharedEquityLifecycle.fromConvention(
        data.conventions, convention.id, lifecycleInput(path, landRows[0].engineInputs)
      );
    });
    var selectedConvention = conventionResults.find(function (item) {
      return item.conventionId === (options.conventionId || data.conventions.meta.default_convention);
    }) || conventionResults[0];
    var selectedYear = options.year || 10;
    var settlement = ResaleWaterfall.settle(selectedConvention.results[selectedYear], WATERFALL_INPUTS);
    var assumptions = assumptionSet(options.assumptions);
    // No buyer pool for this jurisdiction means no funnel and no capture. They
    // stay null and every consumer renders the reason instead — the one thing
    // that must not happen is falling back to the example town's buyers and
    // presenting them as this town's.
    // The starting pool is allocated across the SELECTED scenario's AMI bands,
    // so it has to be recomputed when the reader switches variants. It used to
    // be computed once from the first fixture, which screened the compact and
    // family variants against the baseline variant's band split and labelled
    // the result as theirs.
    var observed = (data.geography && data.geography.ownershipNeed && !data.geography.unavailable)
      ? StudyGeography.observedFor(data.geography, scenario, EffectiveDemand)
      : data.observed;
    var funnel = observed ? EffectiveDemand.run(scenario, observed, assumptions) : null;
    var capture = funnel ? ForsaleCapture.run(scenario, funnel, { selloutMonths: 30, distribution: 'even' }) : null;
    return {
      scenario: scenario, derived: derived, path: path, localBaseline: localBaseline,
      landRows: landRows, landOutcomes: landOutcomes,
      conventionResults: conventionResults, selectedConvention: selectedConvention,
      selectedYear: selectedYear, settlement: settlement,
      assumptions: assumptions, funnel: funnel, capture: capture,
      options: options
    };
  }

  function renderScenario(model, data) {
    var options = data.scenarios.map(function (doc) {
      var selected = scenarioKey(doc) === scenarioKey(model.scenario) ? ' selected' : '';
      return `<option${selected}>${scenarioKey(doc)}</option>`;
    }).join('');
    var mixRows = model.scenario.program.unit_mix.map(function (row) {
      return `<tr><td>${display(row.count)}</td><td>${display(row.bedrooms)} bedroom</td><td>${display(row.sqft_range[0])}–${display(row.sqft_range[1])} sq ft</td><td>${pill(row)}</td></tr>`;
    });
    var bandRows = model.derived.bands.map(function (row) {
      var assistance = assistanceForBand(model.scenario, row.band);
      return `<tr><td>${display(row.count)}</td><td>${display(row.band[0], 'rate')}–${display(row.band[1], 'rate')}</td><td>${display(row.maxAffordablePrice, 'money')}</td><td class="ms-affordability-gap"><strong>${display(row.gapVsLocalPrice, 'money')}</strong></td><td>${assistanceFinding(row, assistance)}</td><td>${pill(row)}</td></tr>`;
    });
    var partners = model.scenario.partners.map(function (partner) {
      return `<li><strong>${humanize(partner.role)}</strong>: ${partner.name || partner.provider_id || display(null)} — candidate; no commitment has been made</li>`;
    }).join('');
    var pending = model.scenario.meta.owner_inputs_pending;
    return `<section id="ms-s1" class="chart-card ms-section">${heading('1. The project and who it is priced for', 'scenario and program comparison')}${plain('the first table is the mix of homes in an example project. The second splits the homes by income group (AMI band). For each group it shows the most a household could pay, how far that falls short of the typical local home value (the gap), and whether the down-payment help assumed for the example project could close that gap. That help is an example assumption, not a list of programs available where you are. Use the menu to try other versions of the project.')}<label>Project scenario <select id="ms-scenario-select">${options}</select></label>${table(['Homes', 'Type', 'Size', 'Where the number comes from'], mixRows, 'Unit mix')}${table(['Homes', 'Income group (AMI band)', 'Most they could pay', 'Gap to typical home value', 'Still short after the example\'s down-payment help', 'Where the number comes from'], bandRows, 'AMI comparison')}<div class="ms-grid"><div><h3>Cost per home</h3><p>Total development cost (TDC) per home: ${display(model.derived.tdcDependent.tdcPerUnit, 'money')}</p><p>Public subsidy needed per home: ${display(model.derived.tdcDependent.subsidyPerUnit, 'money')}</p><p><strong>Still needed from the project sponsor before costs can be worked out:</strong> ${pending.map(function (id) { return plainLabel('pending', id); }).join('; ')}.</p><p class="ms-caveat">Values still needed: ${pending.join(', ')}</p></div><div><h3>Partners</h3><ul>${partners}</ul></div></div></section>`;
  }

  function renderLand(model) {
    var rows = model.landOutcomes.map(function (item) {
      var fields = Object.keys(item.row.assessments).map(function (key) {
        var field = item.row.assessments[key];
        return `<li><strong>${plainLabel('landFields', key)}</strong>: ${humanize(field.value)} ${provenance(field)}</li>`;
      }).join('');
      return `<article class="ms-subcard" data-land-model="${item.row.modelId}"><h3>${item.row.label}</h3><p>${item.row.modelId === 'model_a_public_land_retention' ? '<strong>Hypothesis to test</strong> — an idea to check, not a finding' : ''}</p><p>Upfront price reduction per home: ${display(item.row.initialPerUnitAffordabilityBenefit, 'money')}</p><p>Buyer's monthly housing cost in year 5: <strong>${display(item.lifecycle.results[5].monthlyHousingCost, 'money')}</strong> ${pill(item.lifecycle)}</p><details><summary>What this option means in practice (15 questions)</summary><ul>${fields}</ul></details></article>`;
    }).join('');
    return `<section id="ms-s2" class="chart-card ms-section">${heading('2. What to do with the land', 'land-disposition comparison')}${plain('four ways a town or housing authority could handle the land under the homes. Keeping the land and leasing it to buyers (a ground lease) takes the land out of the price, but adds a monthly land fee and more paperwork. Selling the land with a deed restriction or covenant avoids the land fee and gives buyers ordinary ownership, but the public keeps only the right to enforce the restriction, not the land itself. Open each card to see the trade-offs.')}<p class="ms-caveat">The options are listed in a fixed order, not ranked. Dollar figures are calculated from the same example assumptions for every option.</p><div class="ms-card-grid">${rows}</div></section>`;
  }

  function renderConventions(model) {
    var pathOptions = Object.keys(SharedEquityLifecycle.SCENARIOS).map(function (key) {
      var selected = model.path === SharedEquityLifecycle.SCENARIOS[key] ? ' selected' : '';
      return `<option value="${key}"${selected}>${marketPathLabel(SharedEquityLifecycle.SCENARIOS[key].scenarioLabel)}</option>`;
    }).join('');
    var cards = model.conventionResults.map(function (result) {
      var rows = HORIZONS.map(function (year) {
        var item = result.results[year];
        return `<tr><td>${display(year)} years</td><td>${display(item.ownerNetProceeds, 'money')}</td><td>${display(item.appraisalConstrainedPrice, 'money')}</td><td>${display(item.nextBuyerMaxAffordablePrice, 'money')}</td><td>${affordabilityAnswer(item)}</td></tr>`;
      });
      return `<article class="ms-subcard" data-convention="${result.conventionId}"><h3>${result.conventionLabel}</h3><p>${provenance(result)}</p><p>${result.scenarioLabel}</p>${table(['Years owned', 'Seller walks away with (net proceeds)', 'Capped resale price', 'Most the next buyer could pay', 'Still affordable to the next buyer?'], rows, `${result.conventionLabel} outcomes`)}</article>`;
    }).join('');
    return `<section id="ms-s3" class="chart-card ms-section">${heading('3. What happens when an owner sells', 'shared-equity resale formulas')}${plain('price-restricted homes come with a resale formula that caps what an owner can sell for. The goal is to keep the home affordable for the next buyer, but a cap does not guarantee it — the last column checks whether it does. Each card below is one common formula. Compare two things: what the seller walks away with, and whether the capped price is still within reach of the next buyer. The market path menu sets one yearly rate that home values, incomes and inflation all follow, so it moves the resale price and what the next buyer can pay together.')}<label>Market path <select id="ms-path-select">${pathOptions}</select></label><span class="ms-control-note">Each market path is a scenario, not a prediction.</span><div class="ms-card-grid">${cards}</div></section>`;
  }

  function renderSettlement(model) {
    var conventionOptions = model.conventionResults.map(function (item) {
      var selected = item.conventionId === model.selectedConvention.conventionId ? ' selected' : '';
      return `<option value="${item.conventionId}"${selected}>${item.conventionLabel}</option>`;
    }).join('');
    var yearOptions = HORIZONS.map(function (year) {
      return `<option${year === model.selectedYear ? ' selected' : ''}>${year}</option>`;
    }).join('');
    var rows = model.settlement.steps.map(function (step) {
      return `<tr><td>${step.label}</td><td>${display(step.owed, 'money')}</td><td>${display(step.paid, 'money')}</td><td>${display(step.shortfall, 'money')}</td><td>${pill(step)}</td></tr>`;
    });
    var warning = model.settlement.ownerNetTransparencyWarning
      ? `<div class="ms-warning" role="alert" data-transparency-warning="visible"><strong>Owner-net transparency warning:</strong> ${model.settlement.ownerNetTransparencyNote}</div>` : '';
    return `<section id="ms-s4" class="chart-card ms-section">${heading('4. Where the money goes at resale', 'resale settlement')}${plain('pick a resale formula and a year to follow one sale line by line: selling costs are paid first, then the mortgage, then the owner gets their down payment back, then any public help is repaid. The owner\'s net proceeds are their down payment back, any improvement credit, and whatever is left after that. A shortfall means there was not enough money to pay that line in full.')}<div class="ms-controls"><label>Resale formula <select id="ms-convention-select">${conventionOptions}</select></label><label>Year <select id="ms-year-select">${yearOptions}</select></label></div><p>${model.settlement.scenarioLabel} ${pill(model.settlement)}</p>${table(['Step', 'Owed', 'Paid', 'Shortfall', 'Evidence'], rows, 'Resale settlement steps')}<div class="ms-grid"><p>Public subsidy retained in home: <strong>${display(model.settlement.publicSubsidyRetainedInHome, 'money')}</strong></p><p>Public subsidy recaptured at sale: <strong>${display(model.settlement.publicSubsidyRecapturedAtSale, 'money')}</strong></p><p>Owner net proceeds: <strong>${display(model.settlement.ownerNetProceeds, 'money')}</strong></p></div>${warning}</section>`;
  }

  function renderFunnel(model) {
    var rows = model.funnel.stages.map(function (stage) {
      if (stage.id === 'observed_base') return `<tr><td>Starting pool</td><td>${display(stage.outputCount)}</td><td>${stage.label}</td><td>${stage.basis}</td><td>${pill(stage)}</td></tr>`;
      var assumption = model.assumptions[stage.id];
      return `<tr><td>${stageLabel(stage.id)}</td><td><input class="ms-share-input" data-stage-id="${stage.id}" type="number" min="0" max="1" step="0.01" placeholder="0–1" value="${assumption.share === null ? '' : assumption.share}" aria-label="${stageLabel(stage.id)} — share"></td><td>${display(stage.outputCount)}</td><td>${stage.basis}</td><td>${pill(stage)}</td></tr>`;
    });
    var howTo = `<div class="ms-warning"><strong>How to fill this in:</strong> the first row, the starting pool, is filled in for you from public HUD data (CHAS). For each row after it, type the share of the remaining households that pass that step, as a decimal — 0.5 means half. Each step shrinks the pool, top to bottom. If a row is left blank, every row below it stays blank too, because the page will not guess. The <em>Evidence basis</em> column says where a real share should come from: buyer surveys, lender or broker records, or results from similar projects.</div>`;
    return `<section id="ms-s5" class="chart-card ms-section">${heading('5. How many local households could buy', 'effective-demand funnel')}${plain('this starts from a rough count of local moderate-income renter households, taken from HUD\'s CHAS tables and split across the project\'s income groups. It is a potential pool, not committed buyers. Each step below narrows it by a share you supply, so the result is only as good as the evidence behind those shares.')}${howTo}<p class="ms-caveat">Nothing you type is saved — reloading the page clears it.</p><p><strong>Steps still blank:</strong> ${model.funnel.unresolvedStages.length ? model.funnel.unresolvedStages.map(stageLabel).join('; ') : 'none'}</p>${table(['Stage', 'Share / output (decimal share, e.g. 0.8 = 80%)', 'Output / protected label', 'Evidence basis', 'Classification'], rows, 'Effective-demand funnel')}</section>`;
  }

  function figure(value, kind) {
    var shown = unavailable(value.value) && value.denominator.value === 0 ? 'None — the pool is empty' : display(value.value, kind);
    return `<span class="ms-figure">${shown} <span class="ms-denominator">denominator: ${value.denominator.value === NOT_AVAILABLE ? display(value.denominator.value) : value.denominator.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} — ${MarketStudyReport.plainBasis(value.denominator.basis)}</span></span>`;
  }
  function renderCapture(model) {
    var scenarioRows = model.capture.scenarios.map(function (item) {
      return `<tr><td>${item.scenarioLabel}</td><td>${MarketStudyReport.formatSchedule(item.monthlyClosings, model.scenario.program.total_units.value)}</td><td>${MarketStudyReport.formatAnnualClosings(item.annualClosings)}</td><td>${MarketStudyReport.formatAnnualCapture(item.annualCaptureRate)}</td><td>${figure(item.totalProjectPenetration, 'rate')}</td><td>${figure(item.grossContractsNeeded)}</td><td>${item.poolDepletionModeled ? 'Yes' : 'No'}</td></tr>`;
    });
    var amiRows = Object.keys(model.capture.captureByAmiBand).map(function (key) {
      var item = model.capture.captureByAmiBand[key];
      return `<tr><td>${key}</td><td>${display(item.numerator)}</td><td>${figure(item, 'rate')}</td><td>${MarketStudyReport.plainReason(item.reason)}</td></tr>`;
    });
    return `<section id="ms-s6" class="chart-card ms-section">${heading('6. How fast the homes might sell', 'capture scenarios')}${plain('given the estimated buyer pool from section 5, this asks what share of those buyers the project would have to sign up to sell every home in two, two and a half, three or four years. The bigger the share, the harder the sales job. It stays blank until section 5 is complete.')}${table(['Sales pace', 'Homes closing each month', 'Homes closing each year', 'Share of ready buyers needed each year', 'Share of all ready buyers the project needs', 'Signed contracts needed (some fall through)', 'Pool only shrinks as homes sell (no new buyers added)'], scenarioRows, 'Capture scenarios')}${table(['Income group (AMI band)', 'Homes in this group', 'Share of this group\'s ready buyers needed', 'Data limitation'], amiRows, 'AMI capture cross-tab')}<div class="ms-warning"><strong>Other homes for sale are not counted:</strong> ${model.capture.competitiveSupplyNote}</div><div class="ms-warning"><strong>Treat these as rough arithmetic:</strong> ${model.capture.captureHumilityCaveat}</div></section>`;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Say whose study this is, above everything else.
   *
   * The page used to answer this nowhere. One town's AMI and home values were
   * loaded for every reader, and the only clue was the example project's name
   * six lines into section 1 — which a reader has no reason to read as a
   * statement about the DATA.
   */
  function renderGeographyBanner(data) {
    var geography = data.geography;
    if (!geography || geography.mode !== 'jurisdiction') {
      return '<aside class="ms-geography ms-geography--example" role="note" data-study-mode="example">'
        + '<p><strong>Example study.</strong> No jurisdiction is selected, so this page screens an example project '
        + 'against its own town. The arithmetic is real; the place is not yours.</p>'
        + '<p><a href="select-jurisdiction.html">Choose your jurisdiction</a> to run the same screen on your market.</p>'
        + '</aside>';
    }
    var name = esc(geography.context.name || geography.context.geoid);
    var note = geography.unavailable
      ? '<p class="ms-caveat">' + esc(geography.unavailable.detail) + ' Sections 5 and 6 cannot be screened here.</p>'
      : '';
    return '<aside class="ms-geography" role="note" data-study-mode="jurisdiction" data-study-geoid="' + esc(geography.context.geoid) + '">'
      + '<p><strong>Market: ' + name + '.</strong> Income limits, home values and the buyer pool below are ' + name + "'s. "
      + 'The project itself is still an example program — nobody has supplied a real one — so read this as '
      + '"what would a project like this meet in ' + name + '".</p>'
      + note
      + '<p><a href="select-jurisdiction.html">Change jurisdiction</a></p>'
      + '</aside>';
  }

  /**
   * A file on someone's disk outlives the tab it came from. Naming every
   * download after the example town guaranteed that a screening draft for
   * another jurisdiction would be filed, and later read, as that town's.
   */
  function downloadName(data) {
    var geography = data && data.geography;
    var stem = (geography && geography.mode === 'jurisdiction' && (geography.context.name || geography.context.geoid))
      ? String(geography.context.name || geography.context.geoid)
      : 'example';
    return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-for-sale-market-study-screening-draft.html';
  }

  /**
   * The ownership market, said plainly.
   *
   * #1620 §6 criterion 3 wants both halves: a covered place shows its figure
   * WITH its date, and an uncovered place shows "no sale-price source for this
   * place" WITH the reasons. Before this the page showed neither, because
   * nothing on the site read the tracker at all.
   *
   * The label never says "median sale price for X". Every row in that file is
   * allocated from ZIP-level sales — Fruita's is spread across seven ZIPs,
   * three of them Grand Junction — so the ZIP count is part of the figure, not
   * a footnote under it.
   */
  function renderSalePrice(data) {
    var evidence = data.geography && data.geography.salePrice;
    if (!evidence) return '';
    if (evidence.state === 'unavailable') {
      var reasons = evidence.reasons.map(function (reason) {
        return '<li><strong>' + esc(reason.source) + '</strong> \u2014 ' + esc(reason.detail)
          + (reason.issue ? ' <span class="ms-caveat">(tracked in #' + esc(reason.issue) + ')</span>' : '')
          + '</li>';
      }).join('');
      return '<section id="ms-s0" class="chart-card ms-section" data-sale-price="unavailable">'
        + '<h2>Local sale prices</h2>'
        + plain('this would show what homes near you have recently sold for. No sale-price source covers this place; the reasons are listed below.')
        + '<p class="ms-unavailable">' + esc(evidence.label) + '.</p>'
        + '<p class="ms-caveat">' + esc(evidence.caveat) + '</p>'
        + '<ul class="ms-reasons">' + reasons + '</ul></section>';
    }
    return '<section id="ms-s0" class="chart-card ms-section" data-sale-price="' + esc(evidence.state) + '">'
      + '<h2>Local sale prices</h2>'
        + plain('what homes near you have recently sold for — roughly the price a buyer with no help would face. The gaps in section 1 are measured against a separate typical home-value estimate, so the two figures can differ.')
      + '<p class="ms-sale-price"><strong>' + display(evidence.value, 'money') + '</strong> '
      + '<span class="ms-pill">' + esc(evidence.label) + '</span></p>'
      + (evidence.period
        ? '<p class="ms-caveat">Three-month period ending ' + esc(evidence.period) + '.</p>'
        : '')
      + '<p class="ms-caveat">' + esc(evidence.caveat) + '</p></section>';
  }

  function renderUnmeasured(id, heading, detail) {
    return '<section id="' + id + '" class="chart-card ms-section" data-unmeasured="true"><h2>' + esc(heading) + '</h2>'
      + '<p class="ms-unavailable">Not screened for this jurisdiction.</p>'
      + '<p class="ms-caveat">' + esc(detail) + '</p></section>';
  }

  function render(mount, model, data) {
    var reason = (data.geography && data.geography.unavailable && data.geography.unavailable.detail)
      || 'The buyer pool for this jurisdiction could not be screened.';
    mount.innerHTML = [
      renderGeographyBanner(data),
      '<aside class="ms-screening-notice" role="note">' + caveat() + '</aside>',
      renderSalePrice(data),
      renderScenario(model, data), renderLand(model), renderConventions(model),
      renderSettlement(model),
      model.funnel ? renderFunnel(model) : renderUnmeasured('ms-s5', '5. How many local households could buy', reason),
      model.capture ? renderCapture(model) : renderUnmeasured('ms-s6', '6. How fast the homes might sell', reason)
    ].join('');
    var preview = mount.ownerDocument.getElementById('marketStudyReportPreview');
    var download = mount.ownerDocument.getElementById('marketStudyReportDownload');
    if (preview && download && !model.funnel) {
      // buildReport throws on an incomplete model, by design. Refusing here
      // keeps that refusal legible instead of turning it into a stack trace,
      // and makes sure no one downloads a report that silently omits the two
      // sections a for-sale study is actually commissioned for.
      preview.innerHTML = '<p class="ms-unavailable">No report for this jurisdiction.</p>'
        + '<p class="ms-caveat">' + esc(reason) + ' A screening report without the demand and capture '
        + 'sections would be a document about an example town wearing this one\'s name.</p>';
      download.disabled = true;
      download.onclick = null;
    } else if (preview && download) {
      var baselineForReport = model.localBaseline || model.scenario.local_baseline;
      var report = MarketStudyReport.buildReport(model, {
        asOf: data.reportAsOf,
        jurisdictionLabel: (data.geography && data.geography.mode === 'jurisdiction'
          && (data.geography.context.name || data.geography.context.geoid)) || null,
        vintages: {
          scenario: model.scenario.meta.as_of,
          homeValue: baselineForReport.home_value.as_of || null,
          conventions: data.conventions.meta.as_of
        },
        requiredCaveats: MarketStudyReport.REQUIRED_CAVEATS
      });
      preview.innerHTML = MarketStudyReport.renderReportPreview(report);
      download.onclick = function () {
        var blob = new Blob([MarketStudyReport.renderReportHtml(report)], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = mount.ownerDocument.createElement('a');
        link.href = url;
        link.download = downloadName(data);
        link.click();
        URL.revokeObjectURL(url);
      };
    }
    return mount;
  }

  function start(mount, data) {
    var options = {};
    function paint() {
      var model = buildModel(data, options);
      render(mount, model, data);
      mount.querySelector('#ms-scenario-select').addEventListener('change', function (event) {
        options.scenarioKey = event.target.value; paint();
      });
      mount.querySelector('#ms-path-select').addEventListener('change', function (event) {
        options.pathKey = event.target.value; paint();
      });
      mount.querySelector('#ms-convention-select').addEventListener('change', function (event) {
        options.conventionId = event.target.value; paint();
      });
      mount.querySelector('#ms-year-select').addEventListener('change', function (event) {
        options.year = Number(event.target.value); paint();
      });
      mount.querySelectorAll('.ms-share-input').forEach(function (input) {
        input.addEventListener('change', function (event) {
          options.assumptions = options.assumptions || {};
          options.assumptions[event.target.dataset.stageId] = event.target.value === '' ? null : Number(event.target.value);
          paint();
        });
      });
      return model;
    }
    return paint();
  }

  function getJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(url + ' — HTTP ' + response.status);
      return response.json();
    });
  }

  /**
   * A dataset that is simply absent for this geography is not an error — most
   * of Colorado's 546 geographies are missing something. Resolve to null and
   * let StudyGeography name what is missing.
   */
  function optionalJson(url) {
    return getJson(url).catch(function () { return null; });
  }

  function init() {
    var mount = document.getElementById('marketStudyMount');
    if (!mount) return Promise.resolve(null);
    var files = window.MARKET_STUDY_SCENARIO_FILES;
    var context = StudyGeography.resolve(window);
    var paths = StudyGeography.datasetPaths(context);
    return Promise.all([
      Promise.all(files.map(function (name) { return getJson('data/fixtures/' + name); })),
      getJson('data/policy/resale-conventions.json'),
      optionalJson(paths.placeChas),
      optionalJson(paths.countyChas),
      optionalJson(paths.amiGapPlace),
      optionalJson(paths.amiGapCounty),
      optionalJson(paths.homeValueCascade),
      paths.summary ? optionalJson(paths.summary) : Promise.resolve(null),
      optionalJson(paths.redfinTracker),
      optionalJson(paths.bridge),
      optionalJson(paths.assessor)
    ]).then(function (loaded) {
      var scenarios = loaded[0];
      // The absence sources are read even when a price exists: they cost one
      // small file each and they are what makes the "no source" case sayable
      // rather than blank.
      var salePriceEvidence = context && window.SalePriceEvidence
        ? window.SalePriceEvidence.forPlace(context.geoid, {
          tracker: loaded[8], bridge: loaded[9], assessor: loaded[10]
        })
        : null;
      var geography = StudyGeography.inputs(context, {
        placeChas: loaded[2], countyChas: loaded[3],
        amiGapPlace: loaded[4], amiGapCounty: loaded[5],
        homeValueCascade: loaded[6], summary: loaded[7],
        salePriceEvidence: salePriceEvidence
      }, { HNAOwnershipNeed: window.HNAOwnershipNeed, EffectiveDemand: EffectiveDemand });
      return start(mount, {
        scenarios: scenarios,
        conventions: loaded[1],
        reportAsOf: scenarios[0].meta.as_of,
        geography: geography,
        localBaseline: geography.mode === 'jurisdiction' ? geography.localBaseline : null,
        observed: StudyGeography.observedFor(geography, scenarios[0], EffectiveDemand)
      });
    }).catch(function (error) {
      mount.innerHTML = `<div class="ms-warning" role="alert">Page inputs could not be loaded: ${error.message}</div>`;
      return null;
    });
  }

  return {
    buildModel: buildModel, render: render, start: start, init: init,
    lifecycleInput: lifecycleInput, LAND_INPUTS: LAND_INPUTS, WATERFALL_INPUTS: WATERFALL_INPUTS
  };
}));
