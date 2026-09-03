/**
 * Tier-1 ownership strategy screening renderer.
 * Pure module: callers pass the selected geography, existing ownership result,
 * finance engine, and already-fetched datasets.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root && root.ProvenanceLabel);
  if (typeof module === 'object' && module.exports) api = factory(require('../provenance-label.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HNAOwnershipStrategy = api;
}(typeof window !== 'undefined' ? window : this, function (ProvenanceLabel) {
  'use strict';

  var BASE_TIERS = [0.60, 0.80, 1.00];
  var DEFAULT_AMI_CEILING_PCT = 1.20;
  var CEILING_OPTIONS = [0.80, 1.00, 1.10, 1.20, 1.30, 1.40, 1.50, 1.60];
  var MISSING = 'data not available for this jurisdiction';
  var NOT_TRACKED = 'not tracked for this jurisdiction';
  var VERIFY_PARTIES = 'Verify with developer discussions, lender, appraiser, broker, program administrator, and local jurisdiction before decision-grade use.';

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(value) { return Number.isFinite(value) ? '$' + Math.round(value).toLocaleString('en-US') : MISSING; }
  function number(value) { return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : MISSING; }
  function pill(label, scope) {
    return '<span class="hna-own-strategy-pill" data-scope="' + esc(scope) + '" style="display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:.72rem;font-weight:800;">' + esc(label) + '</span>';
  }
  function keyForGeo(geo) { return (geo.type === 'county' ? 'county:' : geo.type === 'cdp' ? 'cdp:' : 'place:') + geo.geoid; }

  function amiCeilingModel(registry) {
    return registry && registry.models && registry.models.find(function (row) {
      return row && row.id === 'prop123_dpa_eligibility';
    });
  }

  function defaultAmiCeilingPct(registry) {
    var model = amiCeilingModel(registry);
    var value = Number(model && model.params && model.params.amiCeilingPct);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_AMI_CEILING_PCT;
  }

  function priceTiers(amiCeilingPct) {
    var ceiling = Number(amiCeilingPct);
    if (!Number.isFinite(ceiling) || ceiling <= 0) ceiling = DEFAULT_AMI_CEILING_PCT;
    var tiers = BASE_TIERS.filter(function (tier) { return tier < ceiling; });
    tiers.push(ceiling);
    return tiers.filter(function (tier, index) { return tiers.indexOf(tier) === index; });
  }

  function resolvePrice(geo, cascade) {
    if (!geo || !cascade) return null;
    if (geo.type === 'county') {
      var county = cascade.counties && cascade.counties[geo.geoid];
      return county ? { value: Number(county.value), source: county.source, asOf: county.as_of, scope: 'county', label: 'County value' } : null;
    }
    var place = cascade.places && cascade.places[geo.geoid];
    if (place) return { value: Number(place.value), source: place.source, asOf: place.as_of, scope: 'place', label: 'Place value' };
    if (geo.allowCountyFallback && geo.countyGeoid && cascade.counties && cascade.counties[geo.countyGeoid]) {
      var fallback = cascade.counties[geo.countyGeoid];
      return { value: Number(fallback.value), source: fallback.source, asOf: fallback.as_of, scope: 'county-fallback', label: 'County fallback — not place data' };
    }
    return null;
  }

  function relevantPrograms(programs, geo) {
    return (programs || []).filter(function (program) {
      var eligible = program.eligible_geography || [];
      if (!eligible.length) return true;
      return eligible.indexOf('statewide') >= 0 || eligible.indexOf('CO') >= 0 ||
        eligible.indexOf(geo.geoid) >= 0 || eligible.indexOf(geo.countyGeoid) >= 0 ||
        eligible.indexOf('eligible_rural_areas') >= 0 || eligible.indexOf('eligible_committed_jurisdictions') >= 0;
    });
  }

  function resolveProviders(local, providerDoc) {
    var refs = local && local.stewardship_providers || [];
    var providers = providerDoc && providerDoc.providers || [];
    return refs.map(function (ref) {
      var id = ref.provider_id || ref.id;
      return providers.find(function (provider) { return provider.id === id; });
    }).filter(Boolean);
  }

  function resolvePublicLandRecords(county, meta) {
    var records = county && county.publicParcels || [];
    var verified = records.filter(function (parcel) {
      return parcel && parcel.evidence_status === 'verified_primary_record';
    });
    if (verified.length) {
      return { status: 'verified', parcels: verified, unavailableReason: null };
    }
    var reason = records.length
      ? meta && meta.quarantine_reason
      : meta && meta.absence_reason;
    return {
      status: 'not_researched',
      parcels: [],
      unavailableReason: reason || 'Public-land parcel records are not researched for this county.'
    };
  }

  function buildViewModel(input) {
    input = input || {};
    var geo = input.geo || {};
    var engine = input.engine;
    if (!engine) throw new Error('HNAOwnershipStrategy requires OwnershipFinance');
    var registry = engine.getRegistry && engine.getRegistry();
    var defaultModel = engine.recommendedModel && engine.recommendedModel();
    var modelId = input.modelId || (defaultModel && defaultModel.id);
    if (!modelId) throw new Error('HNAOwnershipStrategy requires the model registry');
    var householdSize = Number(input.householdSize) || 4;
    var ami = Number(input.ami4Person);
    var price = input.price || resolvePrice(geo, input.homeValueCascade);
    var target = price && Number.isFinite(price.value) ? price.value : null;
    var selectedModel = engine.getModel(modelId);
    var registryCeiling = defaultAmiCeilingPct(registry);
    var ceilingModel = amiCeilingModel(registry);
    var enteredCeiling = Number(input.amiCeilingPct);
    var amiCeilingPct = Number.isFinite(enteredCeiling) && enteredCeiling > 0 ? enteredCeiling : registryCeiling;
    var comparison = Number.isFinite(ami) && ami > 0
      ? engine.compareModels(ami, 1, [modelId], { overrides: { householdSize: householdSize }, targetPrice: target })[0]
      : null;
    var ladder = priceTiers(amiCeilingPct).map(function (tier) {
      var maxPrice = Number.isFinite(ami) && ami > 0
        ? engine.maxAffordablePrice(ami, tier, { modelId: modelId, householdSize: householdSize }) : null;
      var shortfall = target != null && maxPrice != null ? target - maxPrice : null;
      return {
        tier: tier,
        income: Number.isFinite(ami) ? Math.round(ami * tier * engine.householdSizeFactor(householdSize)) : null,
        maxPrice: maxPrice,
        shortfall: shortfall,
        clearsMedian: shortfall == null ? null : shortfall <= 0,
      };
    });
    var requiredIncome = target != null ? engine.incomeNeededForHomeValue(target, { modelId: modelId, householdSize: householdSize }) : null;
    var datasets = input.datasets || {};
    var local = datasets.localResources && datasets.localResources[keyForGeo(geo)] || null;
    var providers = resolveProviders(local, datasets.stewardshipProviders);
    var noSteward = datasets.stewardshipProviders && datasets.stewardshipProviders.meta && datasets.stewardshipProviders.meta.no_stewardship_flag;
    var county = datasets.countyOwnership && datasets.countyOwnership.counties && datasets.countyOwnership.counties[geo.countyGeoid || geo.geoid];
    var publicLandRecords = resolvePublicLandRecords(county, datasets.countyOwnership && datasets.countyOwnership.meta);
    var progress = datasets.progress && datasets.progress.by_geoid && datasets.progress.by_geoid[geo.geoid] || null;
    var resaleComparison = input.resaleEngine && typeof input.resaleEngine.compareConventions === 'function'
      ? input.resaleEngine.compareConventions(datasets.resaleConventions, {
        purchasePrice: target,
        holdingPeriodYears: 10,
        remainingPrincipal: 0,
        sellingCosts: 0,
        cpiRateAnnual: 0.02,
        recaptureAmount: 90000,
        subsidyType: input.resaleSubsidyType || 'none',
        selectedConventionId: input.resaleConventionId,
        ami4Person: ami,
        targetAmiPct: amiCeilingPct,
        maxAffordablePrice: engine.maxAffordablePrice
      }) : null;
    return {
      geo: geo,
      ami4Person: Number.isFinite(ami) ? ami : null,
      householdSize: householdSize,
      registry: registry,
      modelId: modelId,
      model: selectedModel,
      amiCeilingPct: amiCeilingPct,
      amiCeilingSource: Number.isFinite(enteredCeiling) && enteredCeiling > 0 ? 'user' : 'registry',
      amiCeilingCaveat: ceilingModel && ceilingModel.implications && ceilingModel.implications.when_not_to_use || '',
      comparison: comparison,
      price: price,
      ladder: ladder,
      requiredIncome: requiredIncome,
      requiredIncomeAmiRatio: requiredIncome != null && ami > 0 ? requiredIncome / ami : null,
      ownership: input.ownershipNeedResult || {},
      developerPrograms: relevantPrograms(datasets.developerFunding && datasets.developerFunding.programs, geo),
      buyerPrograms: relevantPrograms(datasets.buyerAssistance && datasets.buyerAssistance.programs, geo),
      local: local,
      providers: providers,
      noStewardshipFlag: noSteward || 'Permanent ownership stewardship capacity not established',
      publicLandRecords: publicLandRecords,
      publicParcels: publicLandRecords.parcels,
      progress: progress,
      prop123: progress && progress.prop123 || local && local.prop123 || null,
      resaleComparison: resaleComparison,
      resaleEngine: input.resaleEngine || null,
    };
  }

  function section(title, body) {
    return '<section style="border-top:1px solid var(--border);padding-top:.8rem;margin-top:.8rem;min-width:0;"><h4 style="margin:0 0 .45rem;font-size:.92rem;color:var(--text);">' + esc(title) + '</h4>' + body + '</section>';
  }

  function renderHtml(vm) {
    var geoPill = pill(vm.geo.type === 'county' ? 'County scope' : 'Place scope', vm.geo.type === 'county' ? 'county' : 'place');
    var pricePill = vm.price ? pill(vm.price.label, vm.price.scope) : pill('Place value unavailable', 'unavailable');
    var models = vm.registry && vm.registry.models || [];
    var options = models.map(function (model) { return '<option value="' + esc(model.id) + '"' + (model.id === vm.modelId ? ' selected' : '') + '>' + esc(model.label) + '</option>'; }).join('');
    var ceilingValues = CEILING_OPTIONS.concat([vm.amiCeilingPct]).sort(function (a, b) { return a - b; }).filter(function (value, index, values) { return values.indexOf(value) === index; });
    var ceilingOptions = ceilingValues.map(function (value) {
      return '<option value="' + value + '"' + (value === vm.amiCeilingPct ? ' selected' : '') + '>' + Math.round(value * 100) + '% AMI</option>';
    }).join('');
    var ladderRows = vm.ladder.map(function (row) {
      var state = row.clearsMedian === true ? 'market-attainable at this tier' : row.clearsMedian === false ? 'shortfall ' + money(row.shortfall) : MISSING;
      return '<tr><td>' + Math.round(row.tier * 100) + '% AMI</td><td>' + money(row.income) + '</td><td>' + money(row.maxPrice) + '</td><td>' + esc(state) + '</td><td>' + (row.clearsMedian == null ? 'Unavailable' : row.clearsMedian ? 'Yes' : 'No') + '</td></tr>';
    }).join('');
    // Household-share data ends at 100% AMI, so no household exclusion percentage is presented.
    var risk = vm.comparison && vm.comparison.riskDisclosureRequired
      ? '<div data-risk-disclosure="true" style="border:1px solid var(--warning);padding:.65rem;border-radius:6px;margin-top:.55rem;color:var(--text);"><strong>Buyer-risk note:</strong> ' + esc(vm.comparison.riskDisclosure) + '</div>' : '';
    var implications = vm.model && vm.model.implications || {};
    var supply = vm.ownership.ownerValueSupply;
    var bands = supply && supply.bands || [];
    var pool = vm.ownership.priceBandScreen && vm.ownership.priceBandScreen.rows || [];
    var supplyBody = bands.length
      ? '<p><strong>' + number(bands.reduce(function (sum, band) { return sum + (Number(band.ownerOccupiedUnits) || 0); }, 0)) + '</strong> owner units across existing value bands. ' + pill('Jurisdiction owner stock', vm.geo.type) + '</p>' : '<p>' + MISSING + '</p>';
    supplyBody += pool.length ? '<ul>' + pool.map(function (row) {
      var demand = row.demandUnavailableReason
        ? esc(row.demandUnavailableReason)
        : 'potential buyer pool ' + number(row.potentialBuyerPoolHouseholds) + ' households';
      return '<li>' + esc(row.label || row.priceBand || 'Price band') + ': ' + demand + '; ' + number(row.ownerValueSupplyUnits) + ' owner units. Potential buyer pool — not committed demand.</li>';
    }).join('') + '</ul>' : '<p>Potential buyer pool: ' + MISSING + '</p>';
    var funding = vm.developerPrograms.concat(vm.buyerPrograms);
    var fundingBody = funding.length ? '<p><strong>Available is context, never money.</strong></p><ul>' + funding.map(function (program) {
      var potential = program.screening_apply === true ? ' — potential — not committed' : '';
      return '<li>' + esc(program.name || program.provider || program.id) + potential + ' ' + ProvenanceLabel.html(program) + '</li>';
    }).join('') + '</ul>' : '<p>Programs and funding: ' + NOT_TRACKED + '. Available is context, never money.</p>';
    var authorities = vm.local && vm.local.housingAuthority || [];
    var capacityBody = authorities.length ? '<ul>' + authorities.map(function (authority) { return '<li>' + esc(authority.name) + ' — structure: ' + esc(authority.structure_type || 'Not yet verified') + '; capacity: ' + esc(authority.capacity_tier || 'Not yet verified') + '. ' + geoPill + '</li>'; }).join('') + '</ul>' : '<p>Authority capacity: ' + MISSING + '. ' + geoPill + '</p>';
    capacityBody += vm.providers.length ? '<ul>' + vm.providers.map(function (provider) { return '<li>' + esc(provider.name) + ' — status: ' + esc(provider.commitment_status || 'available') + '</li>'; }).join('') + '</ul>' : '<p>' + esc(vm.noStewardshipFlag) + '</p>';
    var landBody = vm.publicLandRecords.status === 'verified'
      ? '<p><strong>' + vm.publicParcels.length + '</strong> verified public parcels in the containing-county file. ' + pill('County scope', 'county') + '</p><ul>' + vm.publicParcels.map(function (parcel) { return '<li>' + esc(parcel.owner) + ' — ' + esc(parcel.address || 'address unavailable') + '</li>'; }).join('') + '</ul>'
      : '<p><strong>Records unverified.</strong> ' + esc(vm.publicLandRecords.unavailableReason) + ' ' + pill('County scope', 'county') + '</p>';
    var progressBody = vm.progress || vm.prop123 ? '<ul><li>Current HNA: ' + esc(vm.progress && vm.progress.hna && vm.progress.hna.status || 'not tracked') + '</li><li>Proposition 123: ' + esc(vm.prop123 && vm.prop123.status || 'not tracked') + '</li><li>Rural/urban designation: ' + esc(vm.progress && vm.progress.rural_urban || 'Not yet verified') + '</li></ul>' : '<p>Funding competitiveness: ' + NOT_TRACKED + '. Rural/urban designation: Not yet verified.</p>';
    progressBody += '<ul><li>Status: ' + (vm.progress ? 'done' : 'unknown') + ' — current-HNA review</li><li>Status: ' + (vm.progress ? 'done' : 'unknown') + ' — Proposition 123 review</li><li>Status: unknown — local contribution documentation</li><li>Status: gap — decision-grade partner verification</li></ul>';
    var recommendation = vm.ownership.tenureMixRecommendation || MISSING;
    var detail = vm.ownership.recommendationDetail || MISSING;
    var resaleBody = vm.resaleComparison && vm.resaleEngine && typeof vm.resaleEngine.renderComparisonHtml === 'function'
      ? vm.resaleEngine.renderComparisonHtml(vm.resaleComparison)
      : '<p>Resale mechanism comparison: ' + MISSING + '.</p>';
    return '<div class="hna-ownership-strategy" style="overflow-wrap:anywhere;min-width:0;">' +
      '<div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center;"><h3 style="margin:0;font-size:1.05rem;">Ownership Strategy</h3>' + geoPill + '</div>' +
      '<p style="color:var(--muted);line-height:1.45;">Tier-1 jurisdictional screening interface — screening estimate; not a completed project market study.</p>' +
      '<div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;"><label>Model<select data-own-strategy-model style="display:block;max-width:100%;background:var(--card);color:var(--text);border:1px solid var(--border);">' + options + '</select></label><label>Household size<select data-own-strategy-household style="display:block;background:var(--card);color:var(--text);border:1px solid var(--border);">' + [1,2,3,4,5,6,7,8].map(function (size) { return '<option' + (size === vm.householdSize ? ' selected' : '') + '>' + size + '</option>'; }).join('') + '</select></label><label>AMI price ceiling<select data-own-strategy-ami-ceiling style="display:block;min-height:44px;background:var(--card);color:var(--text);border:1px solid var(--border);">' + ceilingOptions + '</select></label></div>' +
      '<p data-own-strategy-ami-ceiling-note style="margin:.45rem 0;color:var(--muted);font-size:.8rem;line-height:1.45;"><strong>Price-only control.</strong> This changes modeled affordable-price thresholds; it does not create household-demand counts above 100% AMI because CHAS\'s 100plus band is unbounded. The statutory default is 120% AMI under SB26-040 (effective July 1, 2026). Rural resort communities may petition DOLA under HB23-1304 for a different percentage.</p>' +
      (vm.amiCeilingCaveat ? '<details style="margin:.35rem 0 .65rem;"><summary style="cursor:pointer;font-size:.8rem;font-weight:700;">Documented AMI-ceiling exception path</summary><p style="color:var(--muted);font-size:.78rem;line-height:1.45;">' + esc(vm.amiCeilingCaveat) + '</p></details>' : '') +
      '<p><strong>Model implications:</strong> ' + esc(implications.who_it_fits || MISSING) + ' ' + ProvenanceLabel.html(vm.model || { classification: 'modeled' }, { compact: true }) + '</p>' + risk +
      section('AMI and affordable-price ladder', '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr><th>Tier</th><th>Income</th><th>Maximum price</th><th>Shortfall state</th><th>Clears local median</th></tr></thead><tbody>' + ladderRows + '</tbody></table></div>') +
      section('Local price and income required', '<p>Local price: <strong>' + money(vm.price && vm.price.value) + '</strong> ' + pricePill + '</p><p>Income required to buy: <strong>' + money(vm.requiredIncome) + '</strong>' + (vm.requiredIncomeAmiRatio != null ? ' (' + vm.requiredIncomeAmiRatio.toFixed(2) + ' × 4-person AMI)' : '') + '. ' + ProvenanceLabel.html({ classification: 'modeled' }, { compact: true }) + '</p>') +
      section('Attainable supply and potential buyer pool', supplyBody) + section('Programs and funding', fundingBody) +
      section('Stewardship and authority capacity', capacityBody) + section('Public land', landBody) +
      section('Resale mechanism comparison', resaleBody) +
      section('Funding-competitiveness checklist', progressBody) +
      section('Preliminary strategy', '<p><strong>' + esc(recommendation) + '</strong></p><p>' + esc(detail) + '</p><p>' + ProvenanceLabel.html({ classification: 'derived' }, { compact: true }) + '</p>') +
      section('Disclosure and verification', '<p><strong>Screening estimate; not a completed project market study.</strong> Figures show their source scope, model, or classification through pills and labels.</p><p>' + esc(VERIFY_PARTIES) + '</p>') + '</div>';
  }

  function render(mount, input) {
    if (!mount) return null;
    var current = Object.assign({}, input || {});
    function paint() {
      var vm = buildViewModel(current);
      mount.innerHTML = renderHtml(vm);
      var model = mount.querySelector('[data-own-strategy-model]');
      var household = mount.querySelector('[data-own-strategy-household]');
      var amiCeiling = mount.querySelector('[data-own-strategy-ami-ceiling]');
      var resaleSubsidy = mount.querySelector('[data-resale-subsidy-type]');
      var resaleMechanism = mount.querySelector('[data-resale-mechanism]');
      if (model) model.addEventListener('change', function () { current.modelId = model.value; paint(); });
      if (household) household.addEventListener('change', function () { current.householdSize = Number(household.value); paint(); });
      if (amiCeiling) amiCeiling.addEventListener('change', function () { current.amiCeilingPct = Number(amiCeiling.value); paint(); });
      if (resaleSubsidy) resaleSubsidy.addEventListener('change', function () { current.resaleSubsidyType = resaleSubsidy.value; paint(); });
      if (resaleMechanism) resaleMechanism.addEventListener('change', function () { current.resaleConventionId = resaleMechanism.value; paint(); });
      return vm;
    }
    return paint();
  }

  return { TIERS: BASE_TIERS.concat([DEFAULT_AMI_CEILING_PCT]), MISSING: MISSING, NOT_TRACKED: NOT_TRACKED, defaultAmiCeilingPct: defaultAmiCeilingPct, priceTiers: priceTiers, resolvePrice: resolvePrice, buildViewModel: buildViewModel, renderHtml: renderHtml, render: render };
}));
