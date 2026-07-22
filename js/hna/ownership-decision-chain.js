/**
 * js/hna/ownership-decision-chain.js
 * Developer-facing ownership decision chain assembled from the ownership modules.
 */
(function () {
  'use strict';

  var SCREENING_CAVEAT = 'Screening estimate only; verify local prices, financing assumptions, assistance programs, household size, and local deed-restriction policy before using this for a project decision.';
  var DEVELOPER_LABEL = 'DEVELOPER SCREEN';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmtMoney(value) {
    var n = num(value);
    if (n == null) return 'VERIFY';
    return '$' + Math.round(n).toLocaleString();
  }

  function fmtNumber(value) {
    var n = num(value);
    if (n == null) return 'VERIFY';
    return Math.round(n).toLocaleString();
  }

  function programsFrom(doc) {
    if (Array.isArray(doc)) return doc;
    return doc && Array.isArray(doc.programs) ? doc.programs : [];
  }

  function conventionsFrom(doc) {
    if (Array.isArray(doc)) return doc;
    return doc && Array.isArray(doc.conventions) ? doc.conventions : [];
  }

  function defaultAmi(result, options) {
    var explicit = num(options && options.ami4Person);
    if (explicit) return explicit;
    return num(result && result.affordabilityTest && result.affordabilityTest.ami4Person);
  }

  function defaultUnitCost(result, options) {
    var explicit = num(options && options.tdcPerUnit);
    if (explicit) return explicit;
    var home = result && result.affordabilityTest && num(result.affordabilityTest.medianHomeValue);
    if (home) return home;
    var row = result && result.priceBandScreen && result.priceBandScreen.rows && result.priceBandScreen.rows[0];
    return row ? num(row.maxAffordablePrice) : null;
  }

  function computeFeasibility(result, options) {
    options = options || {};
    var dealCalculator = options.dealCalculator || window.__DealCalc;
    if (!dealCalculator || typeof dealCalculator.computeForSaleFeasibility !== 'function') {
      return {
        status: 'missing-calculator',
        source: 'DealCalculator.computeForSaleFeasibility unavailable',
      };
    }
    var units = Math.max(1, Math.round(num(options.units) || 1));
    var tdcPerUnit = defaultUnitCost(result, options);
    var ami4Person = defaultAmi(result, options);
    var targetAmiPct = num(options.targetAmiPct) || 0.80;
    var maxAffordablePrice = options.maxAffordablePrice ||
      (window.HNAOwnershipNeed && window.HNAOwnershipNeed.maxAffordablePrice);
    var input = {
      tdc: tdcPerUnit ? tdcPerUnit * units : null,
      units: units,
      ami4Person: ami4Person,
      targetAmiPct: targetAmiPct,
      maxAffordablePrice: maxAffordablePrice,
      developerFundingPrograms: options.developerFundingDoc || options.developerFundingPrograms,
      resaleConventions: options.resaleConventionsDoc || options.resaleConventions,
      resalePurchasePrice: options.resalePurchasePrice,
      resaleHoldingYears: options.resaleHoldingYears == null ? 5 : options.resaleHoldingYears,
      resaleRemainingPrincipal: options.resaleRemainingPrincipal,
      resaleSellingCosts: options.resaleSellingCosts,
      resaleMarketAppreciation: options.resaleMarketAppreciation,
      assumptions: options.assumptions,
    };
    var out = dealCalculator.computeForSaleFeasibility(input);
    out.source = 'DealCalculator.computeForSaleFeasibility';
    out.input = {
      units: units,
      targetAmiPct: targetAmiPct,
      tdcPerUnit: tdcPerUnit,
    };
    return out;
  }

  function stage(id, title, bodyHtml) {
    return {
      id: id,
      title: title,
      bodyHtml: bodyHtml || '',
    };
  }

  function build(result, options) {
    options = options || {};
    result = result || {};
    var price = result.affordabilityTest || {};
    var priceBand = result.priceBandScreen || null;
    var feasibility = computeFeasibility(result, options);
    var funding = feasibility && feasibility.developerFundingStack;
    var resale = feasibility && feasibility.ownershipResale;
    var stages = [];

    stages.push(stage('site-price-context', 'Site / price context',
      '<p>County price anchor: <strong>' + esc(fmtMoney(price.medianHomeValue)) + '</strong></p>' +
      '<p>Affordability class: <strong>' + esc(price.classification || 'VERIFY') + '</strong></p>' +
      '<p>Source: ' + esc(price.source || 'home-value cascade') + '</p>'));

    var bandRows = priceBand && Array.isArray(priceBand.rows) ? priceBand.rows : [];
    stages.push(stage('demand-by-price-band', 'Demand by price band',
      '<p>' + esc(priceBand && priceBand.label || 'potential buyer pool (moderate-income renter households) - not committed demand') + '</p>' +
      '<table><thead><tr><th>Band</th><th>Max price</th><th>Pool</th><th>Supply</th><th>Current gap</th></tr></thead><tbody>' +
      bandRows.map(function (row) {
        return '<tr><td>' + esc(row.label) + '</td><td>' + esc(fmtMoney(row.maxAffordablePrice)) + '</td><td>' +
          esc(fmtNumber(row.potentialBuyerPoolHouseholds)) + '</td><td>' + esc(fmtNumber(row.ownerValueSupplyUnits)) + '</td><td>' +
          esc(fmtNumber(row.currentGapHouseholds)) + '</td></tr>';
      }).join('') +
      '</tbody></table>'));

    stages.push(stage('per-unit-subsidy-gap', 'Per-unit subsidy gap',
      '<p>Source: ' + esc(feasibility.source || 'DealCalculator.computeForSaleFeasibility') + '</p>' +
      '<p>Per-unit cost screen: <strong>' + esc(fmtMoney(feasibility.tdcPerUnit)) + '</strong></p>' +
      '<p>Max affordable sale price: <strong>' + esc(fmtMoney(feasibility.maxAffordableSalePrice)) + '</strong></p>' +
      '<p>Subsidy gap per unit: <strong>' + esc(fmtMoney(feasibility.subsidyGapPerUnit)) + '</strong></p>'));

    stages.push(stage('developer-funding-stack', 'Developer funding stack',
      '<p>Applied mapped sources: <strong>' + esc(fmtMoney(funding && funding.appliedAmountPerUnit)) + '</strong> per unit</p>' +
      '<p>Residual after mapped stack: <strong>' + esc(fmtMoney(funding && funding.residualGapPerUnit)) + '</strong> per unit</p>' +
      '<p>Programs checked: ' + esc(programsFrom(options.developerFundingDoc).map(function (p) { return p.name; }).join(', ') || 'VERIFY') + '</p>'));

    var defaultConvention = conventionsFrom(options.resaleConventionsDoc).filter(function (c) { return c && c.id === 'fixed_simple'; })[0];
    var defaultRow = resale && Array.isArray(resale.rows)
      ? resale.rows.filter(function (row) { return row && row.conventionId === 'fixed_simple'; })[0]
      : null;
    stages.push(stage('resale-deed-restriction', 'Resale / deed-restriction tradeoff',
      '<p>Default convention: <strong>' + esc((defaultConvention && (defaultConvention.label || defaultConvention.source_program)) || 'fixed_simple') + '</strong></p>' +
      '<p>Max resale price at holding period: <strong>' + esc(fmtMoney(defaultRow && defaultRow.maxResalePrice)) + '</strong></p>' +
      '<p>Owner gross equity screen: <strong>' + esc(fmtMoney(defaultRow && defaultRow.ownerGrossEquity)) + '</strong></p>' +
      '<p>Preserves affordability: <strong>' + esc(defaultRow ? defaultRow.preservationLabel : 'VERIFY') + '</strong></p>'));

    return {
      label: 'Developer ownership decision chain',
      developerLabel: DEVELOPER_LABEL,
      caveat: SCREENING_CAVEAT,
      feasibility: feasibility,
      stages: stages,
    };
  }

  function render(mount, result, options) {
    if (!mount) return null;
    var chain = build(result, options || {});
    mount.innerHTML = '<section class="ownership-decision-chain" aria-label="Developer ownership decision chain">' +
      '<h3 style="margin:0 0 .35rem;font-size:1rem;">' + esc(chain.label) + '</h3>' +
      '<p style="margin:.1rem 0 .8rem;color:var(--muted);font-size:.82rem;">' + esc(DEVELOPER_LABEL) + ' · assembled from existing ownership screens.</p>' +
      '<div style="display:grid;gap:.75rem;">' +
      chain.stages.map(function (item) {
        return '<article data-own-chain-stage="' + esc(item.id) + '" style="border:1px solid var(--border);border-radius:6px;padding:.8rem;background:var(--card);">' +
          '<div style="display:flex;gap:.45rem;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:.35rem;">' +
            '<h4 style="margin:0;font-size:.92rem;">' + esc(item.title) + '</h4>' +
            '<span style="font-size:.68rem;font-weight:800;letter-spacing:.02em;border:1px solid var(--border);border-radius:999px;padding:.15rem .45rem;">' + esc(DEVELOPER_LABEL) + '</span>' +
          '</div>' +
          '<div style="font-size:.8rem;color:var(--text);line-height:1.45;">' + item.bodyHtml + '</div>' +
          '<p style="margin:.55rem 0 0;color:var(--muted);font-size:.76rem;">' + esc(SCREENING_CAVEAT) + '</p>' +
        '</article>';
      }).join('') +
      '</div></section>';
    return chain;
  }

  window.OwnershipDecisionChain = {
    SCREENING_CAVEAT: SCREENING_CAVEAT,
    DEVELOPER_LABEL: DEVELOPER_LABEL,
    build: build,
    render: render,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.OwnershipDecisionChain;
  }
}());
