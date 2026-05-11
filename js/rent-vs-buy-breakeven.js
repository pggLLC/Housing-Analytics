/**
 * rent-vs-buy-breakeven.js
 *
 * Renders the "Rent vs Buy Breakeven" mini-calculator on the Deal
 * Calculator page. Given a home price, monthly rent, mortgage rate,
 * property tax rate, maintenance %, and rent escalation rate, it
 * computes the year at which cumulative ownership costs (mortgage
 * payments + tax + maintenance - principal paydown - equity
 * appreciation) drop below cumulative rent paid.
 *
 * Why this matters for LIHTC analysts (per Phase 3 / C2)
 * ------------------------------------------------------
 * Helps frame the alternative: if a market's breakeven is <5 years,
 * LIHTC demand is stronger (renters can't afford to buy fast enough).
 * If breakeven is >15 years, the rent-vs-buy gap is so wide that
 * the LIHTC pipeline competes mainly with luxury-rental product, not
 * starter-home product.
 *
 * Adapted from flamingo_project's rent/buy comparison logic.
 */
(function () {
  'use strict';

  // Default assumptions — editable via the UI inputs.
  var DEFAULTS = {
    homePrice:         500000,
    monthlyRent:       1750,
    mortgageRatePct:   7.0,
    downPaymentPct:    20,
    propTaxRatePct:    0.55,    // CO average
    maintPct:          1.0,
    rentEscalationPct: 3.0,
    homeAppreciationPct: 3.5,
  };

  /**
   * Compute the breakeven year + cumulative cost series.
   * @param {object} params
   * @returns {object} { breakevenYear, rentSeries, buySeries, ... }
   */
  function compute(params) {
    var p = Object.assign({}, DEFAULTS, params || {});
    var n = 30;  // analyze 30-year horizon
    var downPayment = p.homePrice * (p.downPaymentPct / 100);
    var loanAmount  = p.homePrice - downPayment;
    var monthlyRate = (p.mortgageRatePct / 100) / 12;
    var monthlyPI = loanAmount * monthlyRate *
      Math.pow(1 + monthlyRate, 360) /
      (Math.pow(1 + monthlyRate, 360) - 1);

    var rentCum = 0;
    var buyCum = downPayment;  // starts with down payment outflow
    var rentSeries = [];
    var buySeries  = [];
    var rent = p.monthlyRent;
    var homeValue = p.homePrice;
    var loanBalance = loanAmount;
    var breakevenYear = null;

    for (var year = 1; year <= n; year++) {
      // Rent year
      rentCum += rent * 12;
      rent = rent * (1 + p.rentEscalationPct / 100);
      // Buy year — annual P&I + taxes + maintenance
      buyCum += monthlyPI * 12;
      buyCum += homeValue * (p.propTaxRatePct / 100);
      buyCum += homeValue * (p.maintPct / 100);
      // Principal paid this year (estimate)
      var princThisYear = 0;
      for (var m = 0; m < 12; m++) {
        var interest = loanBalance * monthlyRate;
        var princ = monthlyPI - interest;
        if (princ < 0) princ = 0;
        loanBalance -= princ;
        princThisYear += princ;
      }
      // Home appreciation gain (offsets buy cost)
      var appreciation = homeValue * (p.homeAppreciationPct / 100);
      homeValue += appreciation;
      // Net buy cost = total outflows - equity built - appreciation
      var equity = (p.homePrice - loanBalance) + (homeValue - p.homePrice);
      var netBuyCost = buyCum - equity;

      rentSeries.push({ year: year, cum: rentCum });
      buySeries.push({  year: year, cum: netBuyCost });

      if (breakevenYear == null && netBuyCost < rentCum) {
        breakevenYear = year;
      }
    }

    return {
      breakevenYear: breakevenYear,
      breakeven_label: breakevenYear ? 'Year ' + breakevenYear : '>30 years (rent stays cheaper)',
      rentSeries: rentSeries,
      buySeries: buySeries,
      params: p,
      summary: {
        downPayment: downPayment,
        monthlyPI: monthlyPI,
        monthlyAllIn: monthlyPI + (p.homePrice * (p.propTaxRatePct / 100) / 12) + (p.homePrice * (p.maintPct / 100) / 12),
      },
    };
  }

  function _readInputs() {
    function num(id, def) {
      var el = document.getElementById(id);
      if (!el) return def;
      var v = parseFloat(el.value);
      return Number.isFinite(v) ? v : def;
    }
    return {
      homePrice:           num('rvbHomePrice', DEFAULTS.homePrice),
      monthlyRent:         num('rvbMonthlyRent', DEFAULTS.monthlyRent),
      mortgageRatePct:     num('rvbMortgageRate', DEFAULTS.mortgageRatePct),
      downPaymentPct:      num('rvbDownPayment', DEFAULTS.downPaymentPct),
      propTaxRatePct:      num('rvbPropTax', DEFAULTS.propTaxRatePct),
      maintPct:            num('rvbMaint', DEFAULTS.maintPct),
      rentEscalationPct:   num('rvbRentEsc', DEFAULTS.rentEscalationPct),
      homeAppreciationPct: num('rvbHomeApp', DEFAULTS.homeAppreciationPct),
    };
  }

  function _render() {
    var result = compute(_readInputs());
    var resultEl = document.getElementById('rvbResult');
    if (!resultEl) return;
    var fmt$ = function (v) { return '$' + Math.round(v).toLocaleString(); };
    var lihtcImplication;
    if (!result.breakevenYear) {
      lihtcImplication = 'Renting stays cheaper for the full 30-year horizon. ' +
        'LIHTC pipeline competes mainly with luxury rentals; expect strong demand for affordable units.';
    } else if (result.breakevenYear <= 5) {
      lihtcImplication = 'Fast breakeven — buy looks attractive for higher-income households. ' +
        'LIHTC demand depends on credit access (HMDA denial rates) more than rent-vs-buy math.';
    } else if (result.breakevenYear <= 10) {
      lihtcImplication = 'Mid-range breakeven (' + result.breakevenYear + ' years). ' +
        'Typical market; LIHTC demand tracks renter credit-burden trends.';
    } else {
      lihtcImplication = 'Long breakeven (' + result.breakevenYear + ' years). ' +
        'Renting dominates; LIHTC pipeline competes with the broader rental market — pricing pressure higher.';
    }
    resultEl.innerHTML =
      '<div style="margin-top:.75rem;padding:.75rem;background:var(--bg2);border-left:3px solid var(--accent);border-radius:4px;">' +
        '<div style="font-size:1.05rem;font-weight:700;margin-bottom:.3rem;">Breakeven: ' + result.breakeven_label + '</div>' +
        '<div style="font-size:.85rem;color:var(--muted);line-height:1.5;">' +
          'Down payment: <strong>' + fmt$(result.summary.downPayment) + '</strong> · ' +
          'Monthly P&I: <strong>' + fmt$(result.summary.monthlyPI) + '</strong> · ' +
          'All-in monthly: <strong>' + fmt$(result.summary.monthlyAllIn) + '</strong>' +
        '</div>' +
        '<div style="font-size:.82rem;margin-top:.5rem;line-height:1.5;">' +
          '<strong>LIHTC implication:</strong> ' + lihtcImplication +
        '</div>' +
      '</div>';
  }

  function bind() {
    var section = document.getElementById('rvbCalculator');
    if (!section) return;
    var btn = document.getElementById('rvbCalculate');
    if (btn) btn.addEventListener('click', _render);
    // Auto-render with defaults on load
    _render();
    // Also re-render on any input change for instant feedback
    section.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', _render);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.RentVsBuyBreakeven = { compute: compute, render: _render };
})();
