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
    root && root.ForsaleCapture
  );
  if (typeof module === 'object' && module.exports) {
    api = factory(
      require('./project-scenario.js'), require('../hna/ownership-finance.js'),
      require('./land-disposition.js'), require('./shared-equity-lifecycle.js'),
      require('./resale-waterfall.js'), require('./effective-demand.js'),
      require('./forsale-capture.js')
    );
    module.exports = api;
  }
  if (root) root.MarketStudyPage = api;
}(typeof window !== 'undefined' ? window : this, function (
  ProjectScenario, OwnershipFinance, LandDisposition, SharedEquityLifecycle,
  ResaleWaterfall, EffectiveDemand, ForsaleCapture
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
  function display(value, kind) {
    if (unavailable(value)) return '<span class="ms-unavailable">not_available — owner input required</span>';
    if (typeof value !== 'number') return String(value);
    if (kind === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    if (kind === 'rate') return value.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  function pill(value) { return `<span class="ms-pill">${String(value)}</span>`; }
  function caveat() { return '<p class="ms-caveat">Screening arithmetic for analyst review; verify source evidence and owner inputs before project use.</p>'; }
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
    var derived = ProjectScenario.derive(scenario, OwnershipFinance);
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
    var funnel = EffectiveDemand.run(scenario, data.observed, assumptions);
    var capture = ForsaleCapture.run(scenario, funnel, { selloutMonths: 30, distribution: 'even' });
    return {
      scenario: scenario, derived: derived, path: path,
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
      return `<tr><td>${display(row.count)}</td><td>${display(row.bedrooms)} bedroom</td><td>${display(row.sqft_range[0])}–${display(row.sqft_range[1])} sq ft</td><td>${pill(row.classification)}</td></tr>`;
    });
    var bandRows = model.derived.bands.map(function (row) {
      return `<tr><td>${display(row.count)}</td><td>${display(row.band[0], 'rate')}–${display(row.band[1], 'rate')}</td><td>${display(row.maxAffordablePrice, 'money')}</td><td>${display(row.gapVsLocalPrice, 'money')}</td><td><strong class="ms-finding">${row.assistanceRangeCheck}</strong></td><td>${pill(row.classification)}</td></tr>`;
    });
    var partners = model.scenario.partners.map(function (partner) {
      return `<li><strong>${partner.role}</strong>: ${partner.name || partner.provider_id || display(null)} — candidate — no commitment; is_commitment: ${String(partner.is_commitment)}</li>`;
    }).join('');
    return `<section id="ms-s1" class="chart-card ms-section"><h2>1. Scenario selector and program comparison</h2>${caveat()}<label>Project scenario <select id="ms-scenario-select">${options}</select></label>${table(['Units', 'Type', 'Size', 'Classification'], mixRows, 'Unit mix')}${table(['Units', 'AMI band', 'Max affordable price', 'Gap vs local price', 'Assistance check', 'Classification'], bandRows, 'AMI comparison')}<div class="ms-grid"><div><h3>TDC-dependent fields</h3><p>TDC per unit: ${display(model.derived.tdcDependent.tdcPerUnit, 'money')}</p><p>Subsidy per unit: ${display(model.derived.tdcDependent.subsidyPerUnit, 'money')}</p><p><strong>owner_inputs_pending:</strong> ${model.scenario.meta.owner_inputs_pending.join(', ')}</p></div><div><h3>Partners</h3><ul>${partners}</ul></div></div></section>`;
  }

  function renderLand(model) {
    var rows = model.landOutcomes.map(function (item) {
      var fields = Object.keys(item.row.assessments).map(function (key) {
        var field = item.row.assessments[key];
        return `<li><strong>${key}</strong>: ${field.value} ${pill(field.classification)} <span class="ms-verify">VERIFY — ${field.validator}</span></li>`;
      }).join('');
      return `<article class="ms-subcard" data-land-model="${item.row.modelId}"><h3>${item.row.label}</h3><p>${item.row.modelId === 'model_a_public_land_retention' ? '<strong>hypothesis_to_test</strong>' : ''}</p><p>Initial per-unit affordability benefit: ${display(item.row.initialPerUnitAffordabilityBenefit, 'money')}</p><p>Monthly housing cost at year 5: <strong>${display(item.lifecycle.results[5].monthlyHousingCost, 'money')}</strong> ${pill(item.lifecycle.classification)}</p><details><summary>15 assessment fields</summary><ul>${fields}</ul></details></article>`;
    }).join('');
    return `<section id="ms-s2" class="chart-card ms-section"><h2>2. Land-disposition comparison</h2>${caveat()}<p>Rows remain in policy-dataset order. Dollar figures below are direct lifecycle-engine outputs using the disclosed screening inputs.</p><div class="ms-card-grid">${rows}</div></section>`;
  }

  function renderConventions(model) {
    var pathOptions = Object.keys(SharedEquityLifecycle.SCENARIOS).map(function (key) {
      var selected = model.path === SharedEquityLifecycle.SCENARIOS[key] ? ' selected' : '';
      return `<option value="${key}"${selected}>${SharedEquityLifecycle.SCENARIOS[key].scenarioLabel}</option>`;
    }).join('');
    var cards = model.conventionResults.map(function (result) {
      var rows = HORIZONS.map(function (year) {
        var item = result.results[year];
        return `<tr><td>${display(year)} years</td><td>${display(item.ownerNetProceeds, 'money')}</td><td>${display(item.appraisalConstrainedPrice, 'money')}</td><td>${display(item.nextBuyerMaxAffordablePrice, 'money')}</td><td>${item.preservesAffordabilityLabel}</td></tr>`;
      });
      return `<article class="ms-subcard" data-convention="${result.conventionId}"><h3>${result.conventionLabel}</h3><p>${pill(result.classification)} ${result.verifyParameter ? '<span class="ms-verify">VERIFY parameter</span>' : ''}</p><p>${result.scenarioLabel}</p>${table(['Horizon', 'Owner net proceeds', 'Restricted resale price', 'Next-buyer capacity', 'Affordability outcome'], rows, `${result.conventionLabel} outcomes`)}</article>`;
    }).join('');
    return `<section id="ms-s3" class="chart-card ms-section"><h2>3. Shared-equity conventions</h2>${caveat()}<label>Market path <select id="ms-path-select">${pathOptions}</select></label><div class="ms-card-grid">${cards}</div></section>`;
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
      return `<tr><td>${step.label}</td><td>${display(step.owed, 'money')}</td><td>${display(step.paid, 'money')}</td><td>${display(step.shortfall, 'money')}</td><td>${pill(step.classification)}</td></tr>`;
    });
    var warning = model.settlement.ownerNetTransparencyWarning
      ? `<div class="ms-warning" role="alert" data-transparency-warning="visible"><strong>Owner-net transparency warning:</strong> ${model.settlement.ownerNetTransparencyNote}</div>` : '';
    return `<section id="ms-s4" class="chart-card ms-section"><h2>4. Resale settlement viewer</h2>${caveat()}<div class="ms-controls"><label>Convention <select id="ms-convention-select">${conventionOptions}</select></label><label>Year <select id="ms-year-select">${yearOptions}</select></label></div><p>${model.settlement.scenarioLabel} ${pill(model.settlement.classification)}</p>${table(['Step', 'Owed', 'Paid', 'Shortfall', 'Classification'], rows, 'Resale settlement steps')}<div class="ms-grid"><p>Public subsidy retained in home: <strong>${display(model.settlement.publicSubsidyRetainedInHome, 'money')}</strong></p><p>Public subsidy recaptured at sale: <strong>${display(model.settlement.publicSubsidyRecapturedAtSale, 'money')}</strong></p><p>Owner net proceeds: <strong>${display(model.settlement.ownerNetProceeds, 'money')}</strong></p></div>${warning}</section>`;
  }

  function renderFunnel(model) {
    var rows = model.funnel.stages.map(function (stage) {
      if (stage.id === 'observed_base') return `<tr><td>${stage.id}</td><td>${display(stage.outputCount)}</td><td>${stage.label}</td><td>${stage.basis}</td><td>${pill(stage.classification)}</td></tr>`;
      var assumption = model.assumptions[stage.id];
      return `<tr><td>${stage.id}</td><td><input class="ms-share-input" data-stage-id="${stage.id}" type="number" min="0" max="1" step="0.01" value="${assumption.share === null ? '' : assumption.share}" aria-label="${stage.id} share"></td><td>${display(stage.outputCount)}</td><td>${stage.basis}</td><td>${pill(stage.classification)}</td></tr>`;
    });
    return `<section id="ms-s5" class="chart-card ms-section"><h2>5. Effective-demand funnel</h2>${caveat()}<p><strong>Owner inputs pending:</strong> session-only shares; reload clears every entry. No values are stored.</p><p><strong>Unresolved stages:</strong> ${model.funnel.unresolvedStages.length ? model.funnel.unresolvedStages.join(', ') : 'none'}</p>${table(['Stage', 'Share / output', 'Output / protected label', 'Evidence basis', 'Classification'], rows, 'Effective-demand funnel')}</section>`;
  }

  function figure(value, kind) {
    return `<span class="ms-figure">${display(value.value, kind)} <span class="ms-denominator">denominator: ${display(value.denominator.value)} — ${value.denominator.basis}</span></span>`;
  }
  function renderCapture(model) {
    var scenarioRows = model.capture.scenarios.map(function (item) {
      var annual = Array.isArray(item.annualCaptureRate)
        ? item.annualCaptureRate.map(function (rate) { return figure(rate, 'rate'); }).join('<br>')
        : display(item.annualCaptureRate);
      return `<tr><td>${item.scenarioLabel}</td><td>${display(item.monthlyClosings)}</td><td>${display(item.annualClosings)}</td><td>${annual}</td><td>${figure(item.totalProjectPenetration, 'rate')}</td><td>${figure(item.grossContractsNeeded)}</td><td>${String(item.poolDepletionModeled)}</td></tr>`;
    });
    var amiRows = Object.keys(model.capture.captureByAmiBand).map(function (key) {
      var item = model.capture.captureByAmiBand[key];
      return `<tr><td>${key}</td><td>${display(item.numerator)}</td><td>${figure(item, 'rate')}</td><td>${item.reason || ''}</td></tr>`;
    });
    return `<section id="ms-s6" class="chart-card ms-section"><h2>6. Capture scenarios</h2>${caveat()}${table(['Pace', 'Monthly closings', 'Annual closings', 'Annual capture and denominator', 'Project penetration and denominator', 'Gross contracts and denominator', 'Pool depletion modeled'], scenarioRows, 'Capture scenarios')}${table(['AMI band', 'Scenario units', 'Capture and denominator', 'Data limitation'], amiRows, 'AMI capture cross-tab')}<div class="ms-warning"><strong>Competitive-supply limitation:</strong> ${model.capture.competitiveSupplyNote}</div><div class="ms-warning"><strong>Capture humility:</strong> ${model.capture.captureHumilityCaveat}</div></section>`;
  }

  function render(mount, model, data) {
    mount.innerHTML = [
      renderScenario(model, data), renderLand(model), renderConventions(model),
      renderSettlement(model), renderFunnel(model), renderCapture(model)
    ].join('');
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
        input.addEventListener('input', function (event) {
          options.assumptions = options.assumptions || {};
          options.assumptions[event.target.dataset.stageId] = event.target.value === '' ? null : Number(event.target.value);
          paint();
        });
      });
      return model;
    }
    return paint();
  }

  function observedFromData(scenario, chas, summary, HNAOwnershipNeed) {
    var ownershipNeed = HNAOwnershipNeed.computeOwnershipNeed({
      geographyId: '0828745', geoLevel: 'place', placeChasEntry: chas.places['0828745'],
      amiGapEntry: { ami_4person: scenario.local_baseline.ami_4person.value },
      homeValueEntry: scenario.local_baseline.home_value,
      ownerValueSupply: HNAOwnershipNeed.ownerValueSupplySeries(summary.acsProfile)
    });
    return EffectiveDemand.fromOwnershipNeed(scenario, ownershipNeed);
  }

  function init() {
    var mount = document.getElementById('marketStudyMount');
    if (!mount) return Promise.resolve(null);
    var files = window.MARKET_STUDY_SCENARIO_FILES;
    return Promise.all(files.map(function (name) { return fetch(`data/fixtures/${name}`).then(function (response) { return response.json(); }); }).concat([
      fetch('data/policy/resale-conventions.json').then(function (response) { return response.json(); }),
      fetch('data/hna/place-chas.json').then(function (response) { return response.json(); }),
      fetch('data/hna/summary/0828745.json').then(function (response) { return response.json(); })
    ])).then(function (loaded) {
      var scenarios = loaded.slice(0, files.length);
      return start(mount, {
        scenarios: scenarios, conventions: loaded[4],
        observed: observedFromData(scenarios[0], loaded[5], loaded[6], window.HNAOwnershipNeed)
      });
    }).catch(function (error) {
      mount.innerHTML = `<div class="ms-warning" role="alert">not_available — page inputs could not be loaded: ${error.message}</div>`;
      return null;
    });
  }

  return {
    buildModel: buildModel, render: render, start: start, init: init,
    lifecycleInput: lifecycleInput, LAND_INPUTS: LAND_INPUTS, WATERFALL_INPUTS: WATERFALL_INPUTS
  };
}));
