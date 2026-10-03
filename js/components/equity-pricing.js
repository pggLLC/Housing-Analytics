/**
 * js/components/equity-pricing.js
 * One reading of LIHTC equity pricing for every page that shows it (#2010).
 *
 * Until 2026-10 Insights, the CRA scenario page and the Colorado Deep Dive
 * each typed their own prices, and none agreed with the data the Tax Credit
 * Equity Markets page reads (Insights showed 4% at $0.89, above 9%; the file
 * had $0.84). Every current price now comes from
 * data/market/novogradac-equity-pricing.json with its as_of, and every
 * quarter-on-quarter figure from data/market/lihtc-equity-pricing-history.json.
 *
 * A price that is missing or not positive is unknown and comes back as null,
 * never 0: a $0.00 credit price is not a price.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EquityPricing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var URLS = {
    benchmark: 'data/market/novogradac-equity-pricing.json',
    history: 'data/market/lihtc-equity-pricing-history.json'
  };

  function price(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
  }

  /** Current national prices, with the date the file says they are as of. */
  function current(benchmark) {
    var meta = benchmark && benchmark.meta;
    var nat = benchmark && benchmark.pricing && benchmark.pricing.national_avg;
    if (!meta || !nat) return null;
    return {
      nine: price(nat.credit_9pct),
      four: price(nat.credit_4pct),
      asOf: meta.as_of || null,
      vintage: meta.vintage || null,
      source: meta.source || null,
      sourceUrl: meta.source_url || null
    };
  }

  /** Quarterly rows, oldest first, with null for any price that is not one. */
  function quarters(history) {
    var rows = history && Array.isArray(history.quarterly) ? history.quarterly : [];
    return rows.map(function (r) {
      return { quarter: r.quarter, nine: price(r.nine), four: price(r.four) };
    });
  }

  /**
   * Fractional change in `key` ('nine' | 'four') over `lag` quarters, ending
   * at the latest quarter. null when either end is unknown.
   */
  function change(history, key, lag) {
    var q = quarters(history);
    if (q.length <= lag) return null;
    var now = q[q.length - 1][key];
    var then = q[q.length - 1 - lag][key];
    return now != null && then != null ? now / then - 1 : null;
  }

  /**
   * The history's latest quarter must be the benchmark's vintage, at the same
   * prices; otherwise a QoQ figure would describe a different price from the
   * one printed beside it.
   */
  function agrees(benchmark, history) {
    var c = current(benchmark);
    var q = quarters(history);
    if (!c || !q.length) return false;
    var last = q[q.length - 1];
    return last.quarter === c.vintage && last.nine === c.nine && last.four === c.four;
  }

  /** A scenario's price range: the base moved by the stated % assumptions. */
  function scenarioRange(base, lowPct, highPct) {
    if (price(base) == null || !isFinite(lowPct) || !isFinite(highPct)) return null;
    return {
      low: base * (1 + lowPct / 100),
      high: base * (1 + highPct / 100),
      mid: base * (1 + (lowPct + highPct) / 200)
    };
  }

  /** Probability-weighted range across scenarios {probability, lowPct, highPct}. */
  function weightedRange(base, scenarios) {
    if (price(base) == null || !scenarios.length) return null;
    var total = 0, low = 0, high = 0;
    scenarios.forEach(function (s) {
      total += s.probability;
      low += s.probability * s.lowPct;
      high += s.probability * s.highPct;
    });
    if (total <= 0) return null;
    return scenarioRange(base, low / total, high / total);
  }

  function money(v) {
    return v == null ? 'Value unavailable' : '$' + v.toFixed(2);
  }

  function pct(v) {
    if (v == null) return 'n/a';
    var p = v * 100;
    return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%';
  }

  function load(fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve({ benchmark: null, history: null });
    function get(url) {
      return f(url, { cache: 'no-cache' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return Promise.all([get(URLS.benchmark), get(URLS.history)]).then(function (d) {
      return { benchmark: d[0], history: d[1] };
    });
  }

  return {
    URLS: URLS,
    current: current,
    quarters: quarters,
    change: change,
    agrees: agrees,
    scenarioRange: scenarioRange,
    weightedRange: weightedRange,
    money: money,
    pct: pct,
    load: load
  };
}));
