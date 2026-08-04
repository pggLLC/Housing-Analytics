/**
 * Structured land-control comparison for the Tier-2 project layer.
 * Rows stay in dataset order and expose labeled trade-offs without merit sorting.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../data/policy/land-disposition-models.json'));
    if (typeof window !== 'undefined') window.LandDisposition = module.exports;
  } else {
    root.LandDisposition = factory(root.LandDispositionModels);
  }
}(typeof window !== 'undefined' ? window : this, function (dataset) {
  'use strict';

  var CLASSIFICATION = 'modeled';
  if (!dataset || !Array.isArray(dataset.models)) throw new Error('LandDisposition: model dataset is required');

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonnegative(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0) throw new Error('LandDisposition: ' + label + ' must be nonnegative');
    return n;
  }

  function decimalRate(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0 || n >= 1) {
      throw new Error('LandDisposition: ' + label + ' must be a decimal rate from 0 through less than 1');
    }
    return n;
  }

  function fraction(value, label, fallback) {
    var n = value == null ? fallback : number(value, null);
    if (n == null || n < 0 || n > 1) throw new Error('LandDisposition: ' + label + ' must be from 0 through 1');
    return n;
  }

  function modelFor(id) {
    var model = dataset.models.find(function (item) { return item.id === id; });
    if (!model) throw new Error('LandDisposition: unknown model "' + id + '"');
    return model;
  }

  function normalize(params) {
    params = params || {};
    return {
      landValuePerUnit: nonnegative(params.landValuePerUnit, 'landValuePerUnit', 0),
      groundRentMonthly: nonnegative(params.groundRentMonthly, 'groundRentMonthly', 0),
      groundRentEscalationRate: decimalRate(params.groundRentEscalationRate, 'groundRentEscalationRate', 0),
      marketPropertyTaxRate: decimalRate(params.marketPropertyTaxRate, 'marketPropertyTaxRate', 0),
      restrictedValueAssessment: !!params.restrictedValueAssessment,
      unitPrice: nonnegative(params.unitPrice, 'unitPrice', 0),
      discountedLandShare: fraction(params.discountedLandShare, 'discountedLandShare', 0),
      landWriteDown: nonnegative(params.landWriteDown, 'landWriteDown', 0),
    };
  }

  function benefit(model, params) {
    if (model.benefit_basis === 'full_land_value') return params.landValuePerUnit;
    if (model.benefit_basis === 'discount_share') return params.landValuePerUnit * params.discountedLandShare;
    if (model.benefit_basis === 'write_down_share') return Math.min(params.landValuePerUnit, params.landWriteDown);
    return 0;
  }

  function engineInputs(modelId, rawParams) {
    var model = modelFor(modelId);
    var params = normalize(rawParams);
    var landBenefit = benefit(model, params);
    var retained = model.property_tax_treatment === 'exempt_while_authority_owns';
    var treatment;
    var effectiveRate;
    if (retained) {
      treatment = 'exempt_while_authority_owns';
      effectiveRate = params.unitPrice > 0
        ? params.marketPropertyTaxRate * Math.max(0, params.unitPrice - params.landValuePerUnit) / params.unitPrice : 0;
    } else if (params.restrictedValueAssessment) {
      treatment = 'restricted_value_assessment_verify';
      effectiveRate = params.unitPrice > 0
        ? params.marketPropertyTaxRate * Math.max(0, params.unitPrice - landBenefit) / params.unitPrice
        : params.marketPropertyTaxRate;
    } else {
      treatment = 'fee_simple_market_value_assessment';
      effectiveRate = params.marketPropertyTaxRate;
    }
    return {
      propertyTaxRate: Math.round(effectiveRate * 100000000) / 100000000,
      propertyTaxTreatment: treatment,
      propertyTaxVerify: true,
      propertyTaxValidator: 'assessor',
      propertyTaxNote: retained
        ? 'VERIFY improvements-basis treatment while the authority owns the land; exemption ends on fee-simple sale.'
        : 'VERIFY the assessment basis with the county assessor; the fee-simple buyer pays property tax.',
      groundRentMonthly: retained ? Math.round(params.groundRentMonthly) : 0,
      groundRentEscalationRate: retained ? params.groundRentEscalationRate : 0,
      priceIncludesLand: !!model.price_includes_land,
      landBenefitPerUnit: Math.round(landBenefit),
      classification: CLASSIFICATION,
    };
  }

  function assess(modelId, rawParams) {
    var model = modelFor(modelId);
    var params = normalize(rawParams);
    var assessments = {};
    Object.keys(model.assessments).forEach(function (key) {
      var field = model.assessments[key];
      assessments[key] = {
        value: field.value,
        verify: !!field.verify,
        validator: field.validator,
        note: field.note || null,
        classification: CLASSIFICATION,
      };
    });
    return {
      modelId: model.id,
      label: model.label,
      initialPerUnitAffordabilityBenefit: Math.round(benefit(model, params)),
      assessments: assessments,
      engineInputs: engineInputs(modelId, params),
      classification: CLASSIFICATION,
    };
  }

  function compare(params) {
    return dataset.models.map(function (model) { return assess(model.id, params); });
  }

  return {
    MODELS: dataset.models,
    assess: assess,
    engineInputs: engineInputs,
    compare: compare,
  };
}));
