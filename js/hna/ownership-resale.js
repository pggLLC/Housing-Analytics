(function () {
  'use strict';
  var ProvenanceLabel = window.ProvenanceLabel || (typeof require === 'function' ? require('../provenance-label.js') : null);

  var SCREENING_CAVEAT = 'Screening estimate only; confirm the controlling deed restriction, ground lease, and program administrator terms before underwriting.';
  var DEFAULT_SCENARIOS = [
    { id: 'downturn', label: 'Downturn (-2% annually)', appreciationRateAnnual: -0.02 },
    { id: 'moderate', label: 'Moderate (3% annually)', appreciationRateAnnual: 0.03 },
    { id: 'high', label: 'High (6% annually)', appreciationRateAnnual: 0.06 }
  ];
  var SUBSIDY_TYPES = [
    { id: 'none', label: 'No HOME subsidy' },
    { id: 'home_homebuyer_assistance', label: 'HOME direct homebuyer assistance' },
    { id: 'home_development_subsidy', label: 'HOME development subsidy' },
    { id: 'other_public_subsidy', label: 'Other public subsidy' }
  ];

  function num(value) {
    if (value == null) return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function money(value) {
    var n = num(value);
    return n == null ? null : Math.round(n);
  }

  function conventionList(doc) {
    if (Array.isArray(doc)) return doc;
    return doc && Array.isArray(doc.conventions) ? doc.conventions : [];
  }

  function defaultConvention(doc) {
    var list = conventionList(doc);
    return list.find(function (item) { return item && item.default; }) || list[0] || null;
  }

  function fixedSimpleCap(purchasePrice, years, rate) {
    var price = num(purchasePrice);
    var hold = num(years);
    var r = num(rate);
    if (price == null || hold == null || r == null || price <= 0 || hold < 0 || r < 0) return null;
    return price * (1 + (r * hold));
  }

  function sharedAppreciationCap(purchasePrice, marketAppreciation, share, sellingCosts) {
    var price = num(purchasePrice);
    var appreciation = num(marketAppreciation);
    var pct = num(share);
    var costs = num(sellingCosts) || 0;
    if (price == null || appreciation == null || pct == null || price <= 0 || pct < 0) return null;
    return price + (pct * appreciation) + costs;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function optionState(convention, subsidyType) {
    convention = convention || {};
    var gate = (convention.legal_gates || []).find(function (item) {
      return item && item.subsidy_type === subsidyType && item.disabled === true;
    });
    return {
      id: convention.id || '',
      label: convention.label || convention.id || 'Resale mechanism',
      disabled: !!gate,
      disabledReason: gate ? gate.reason : null,
      citation: gate ? gate.citation : null
    };
  }

  function scenarioMarketValue(purchasePrice, years, annualRate) {
    var price = num(purchasePrice);
    var hold = num(years);
    var rate = num(annualRate);
    if (price == null || hold == null || rate == null || price <= 0 || hold < 0 || rate <= -1) return null;
    return money(price * Math.pow(1 + rate, hold));
  }

  function affordabilityBenchmark(input) {
    input = input || {};
    if (typeof input.maxAffordablePrice === 'function') {
      return money(input.maxAffordablePrice(input.ami4Person, input.targetAmiPct || 0.80, input.assumptions));
    }
    var own = window.HNAOwnershipNeed;
    if (own && typeof own.maxAffordablePrice === 'function') {
      return money(own.maxAffordablePrice(input.ami4Person, input.targetAmiPct || 0.80, input.assumptions));
    }
    return null;
  }

  function evaluateConvention(convention, input) {
    input = input || {};
    convention = convention || {};
    var purchasePrice = num(input.purchasePrice);
    var years = num(input.holdingPeriodYears);
    if (years == null) years = 5;
    var sellingCosts = num(input.sellingCosts) || 0;
    var remainingPrincipal = num(input.remainingPrincipal) || 0;
    var resaleCap = null;
    var calculationBasis = '';
    var verifyParameter = convention.parameter_status && convention.parameter_status !== 'verified';

    if (convention.type === 'fixed_simple') {
      resaleCap = fixedSimpleCap(purchasePrice, years, convention.annual_rate);
      calculationBasis = convention.rate_label || 'Fixed simple appreciation';
    } else if (convention.type === 'lesser_of_fixed_cpi') {
      var cpiRate = num(input.cpiRateAnnual);
      if (cpiRate == null) cpiRate = num(convention.fixed_rate_upper_bound);
      resaleCap = fixedSimpleCap(purchasePrice, years, Math.min(convention.fixed_rate_upper_bound, cpiRate));
      calculationBasis = 'Lesser of fixed cap or entered CPI rate; exact governing terms require verification';
      verifyParameter = true;
    } else if (convention.type === 'shared_appreciation') {
      resaleCap = sharedAppreciationCap(purchasePrice, input.marketAppreciation || 0, convention.appreciation_share, sellingCosts);
      calculationBasis = convention.share_label || 'Shared appreciation';
      verifyParameter = true;
    } else if (convention.type === 'recapture') {
      resaleCap = num(input.unrestrictedMarketValue);
      var recoveryAmount = num(input.recaptureAmount);
      if (recoveryAmount == null) recoveryAmount = num(convention.default_recapture_amount) || 0;
      calculationBasis = convention.rate_label || 'Fixed public-subsidy recovery';
      verifyParameter = true;
    }

    var cap = money(resaleCap);
    var unavailableReason = null;
    if (cap == null) {
      unavailableReason = purchasePrice == null || purchasePrice <= 0
        ? (input.unavailableReason || 'A positive purchase price is unavailable; resale price and owner equity cannot be calculated.')
        : 'Required resale inputs are unavailable; resale price and owner equity cannot be calculated.';
    }
    var recaptured = convention.type === 'recapture' && cap != null
      ? money(Math.min(recoveryAmount, Math.max(0, cap - remainingPrincipal - sellingCosts)))
      : 0;
    var equity = cap == null ? null : money(cap - remainingPrincipal - sellingCosts - recaptured);
    var affordablePrice = affordabilityBenchmark(input);
    var preserves = cap != null && affordablePrice != null ? cap <= affordablePrice : null;

    return {
      conventionId: convention.id || '',
      label: convention.label || convention.id || 'Resale convention',
      type: convention.type || '',
      sourceProgram: convention.source_program || '',
      sourceUrl: convention.source_url || '',
      sourceNote: convention.source_note || '',
      lastVerified: convention.last_verified || '',
      parameterStatus: convention.parameter_status || 'VERIFY',
      classification: convention.classification || 'modeled',
      observationClass: convention.observation_class || null,
      evidenceBasis: convention.evidence_basis || null,
      verify: convention.verify === true,
      verifyParameter: !!verifyParameter,
      holdingPeriodYears: years,
      purchasePrice: money(purchasePrice),
      maxResalePrice: cap,
      ownerGrossEquity: equity,
      unavailableReason: unavailableReason,
      publicSubsidyRecaptured: recaptured,
      estimatedRemainingPrincipal: money(remainingPrincipal),
      sellingCosts: money(sellingCosts),
      currentAmiAffordablePrice: affordablePrice,
      preservesAffordability: preserves,
      preservationLabel: preserves == null
        ? 'Affordability preservation unavailable'
        : (preserves ? "Keeps price at or below today's AMI-affordable price" : "Drifts above today's AMI-affordable price"),
      calculationBasis: calculationBasis,
      caveat: SCREENING_CAVEAT
    };
  }

  function evaluateAll(doc, input) {
    return conventionList(doc).map(function (convention) {
      return evaluateConvention(convention, input);
    });
  }

  function compareConventions(doc, input) {
    input = input || {};
    var conventions = conventionList(doc);
    var subsidyType = input.subsidyType || 'none';
    var scenarios = Array.isArray(input.scenarios) && input.scenarios.length
      ? input.scenarios.slice() : DEFAULT_SCENARIOS.slice();
    var options = conventions.map(function (convention) { return optionState(convention, subsidyType); });
    var requested = input.selectedConventionId || (defaultConvention(doc) || {}).id;
    var selectedOption = options.find(function (option) { return option.id === requested && !option.disabled; }) ||
      options.find(function (option) { return !option.disabled; }) || null;
    var purchasePrice = num(input.purchasePrice);
    var years = num(input.holdingPeriodYears);
    if (years == null) years = 10;
    var rows = conventions.map(function (convention) {
      var option = options.find(function (candidate) { return candidate.id === convention.id; });
      return {
        conventionId: convention.id,
        label: convention.label,
        objective: convention.objective || convention.screening_note || '',
        sourceProgram: convention.source_program || '',
        sourceUrl: convention.source_url || '',
        sourceNote: convention.source_note || '',
        classification: convention.classification || 'modeled',
        observationClass: convention.observation_class || null,
        evidenceBasis: convention.evidence_basis || null,
        lastVerified: convention.last_verified || '',
        verify: convention.verify === true,
        disabled: option.disabled,
        disabledReason: option.disabledReason,
        outcomes: scenarios.map(function (scenario) {
          var marketValue = scenarioMarketValue(purchasePrice, years, scenario.appreciationRateAnnual);
          return evaluateConvention(convention, Object.assign({}, input, {
            holdingPeriodYears: years,
            unrestrictedMarketValue: marketValue,
            marketAppreciation: marketValue == null || purchasePrice == null ? null : marketValue - purchasePrice
          }));
        })
      };
    });
    return {
      subsidyType: subsidyType,
      cpiRateAnnual: num(input.cpiRateAnnual),
      selectedConventionId: selectedOption ? selectedOption.id : null,
      options: options,
      scenarios: scenarios,
      rows: rows,
      caveat: SCREENING_CAVEAT
    };
  }

  function displayMoney(value) {
    return Number.isFinite(value) ? '$' + Math.round(value).toLocaleString('en-US') : 'Not available';
  }

  function renderComparisonHtml(comparison) {
    comparison = comparison || { options: [], scenarios: [], rows: [] };
    var subsidyOptions = SUBSIDY_TYPES.map(function (item) {
      return '<option value="' + escapeHtml(item.id) + '"' + (item.id === comparison.subsidyType ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>';
    }).join('');
    var mechanismOptions = (comparison.options || []).map(function (option) {
      return '<option value="' + escapeHtml(option.id) + '"' +
        (option.id === comparison.selectedConventionId ? ' selected' : '') +
        (option.disabled ? ' disabled' : '') + '>' + escapeHtml(option.label + (option.disabled ? ' — unavailable' : '')) + '</option>';
    }).join('');
    var legalNotes = (comparison.options || []).filter(function (option) { return option.disabledReason; }).map(function (option) {
      return '<p data-resale-disabled-reason="' + escapeHtml(option.id) + '" role="note"><strong>' + escapeHtml(option.label) + ':</strong> ' + escapeHtml(option.disabledReason) + '</p>';
    }).join('');
    var headings = (comparison.scenarios || []).map(function (scenario) { return '<th>' + escapeHtml(scenario.label) + '</th>'; }).join('');
    var rows = (comparison.rows || []).map(function (row) {
      var outcomes = row.outcomes.map(function (outcome) {
        return '<td><span>Next buyer ' + displayMoney(outcome.maxResalePrice) + '</span><br><span>Owner equity ' + displayMoney(outcome.ownerGrossEquity) + '</span><br><span>Public recovery ' + displayMoney(outcome.publicSubsidyRecaptured) + '</span></td>';
      }).join('');
      return '<tr data-resale-row="' + escapeHtml(row.conventionId) + '"' + (row.conventionId === comparison.selectedConventionId ? ' data-selected="true"' : '') + '><th scope="row">' + escapeHtml(row.label) + '<br><small>' + escapeHtml(row.objective) + '</small><br><small>' + ProvenanceLabel.html(row, { sourceText: row.sourceProgram || 'View source' }) + '</small></th>' + outcomes + '</tr>';
    }).join('');
    return '<div data-resale-comparison><p><strong>Compare mechanisms in declared source order.</strong> These alternatives are not ranked; they protect different interests.</p>' +
      (Number.isFinite(comparison.cpiRateAnnual) ? '<p>Lesser-of comparison CPI input: ' + escapeHtml((comparison.cpiRateAnnual * 100).toFixed(1)) + '% annually.</p>' : '') +
      '<div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:end"><label>Subsidy type<select data-resale-subsidy-type style="display:block;min-height:44px">' + subsidyOptions + '</select></label>' +
      '<label>Selected mechanism<select data-resale-mechanism style="display:block;min-height:44px">' + mechanismOptions + '</select></label></div>' +
      legalNotes + '<div style="overflow-x:auto"><table><thead><tr><th>Mechanism</th>' + headings + '</tr></thead><tbody>' + rows + '</tbody></table></div><p>' + escapeHtml(comparison.caveat || SCREENING_CAVEAT) + '</p></div>';
  }

  function bindComparisonControls(mount, onChange) {
    if (!mount || typeof onChange !== 'function') return;
    var subsidy = mount.querySelector('[data-resale-subsidy-type]');
    var mechanism = mount.querySelector('[data-resale-mechanism]');
    if (subsidy) subsidy.addEventListener('change', function () { onChange({ subsidyType: subsidy.value }); });
    if (mechanism) mechanism.addEventListener('change', function () { onChange({ selectedConventionId: mechanism.value }); });
  }

  window.OwnershipResale = {
    SCREENING_CAVEAT: SCREENING_CAVEAT,
    conventionList: conventionList,
    defaultConvention: defaultConvention,
    fixedSimpleCap: fixedSimpleCap,
    sharedAppreciationCap: sharedAppreciationCap,
    scenarioMarketValue: scenarioMarketValue,
    optionState: optionState,
    evaluateConvention: evaluateConvention,
    evaluateAll: evaluateAll,
    compareConventions: compareConventions,
    renderComparisonHtml: renderComparisonHtml,
    bindComparisonControls: bindComparisonControls,
    DEFAULT_SCENARIOS: DEFAULT_SCENARIOS.slice(),
    SUBSIDY_TYPES: SUBSIDY_TYPES.slice()
  };
})();
