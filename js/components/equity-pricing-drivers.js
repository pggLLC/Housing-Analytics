/**
 * js/components/equity-pricing-drivers.js
 * "What moves LIHTC pricing" on article-pricing.html.
 *
 * Compares Novogradac's monthly national 9%/4% equity pricing
 * (data/market/lihtc-equity-pricing-history.json) with the rate series in
 * data/fred-data.json, and shows the Polymarket odds the economic dashboard
 * already caches (data/polymarket-data.json) as forward-looking context.
 *
 * Every number on the section is computed here from those files when the
 * page loads, so the prose cannot drift from the data: a new pricing capture
 * or a rate refresh changes the sentences with it. The pure statistics are
 * exported on window.EquityPricingDrivers.stats and tested in
 * test/equity-pricing-drivers.test.js against an independent statsmodels run.
 *
 * Absent values stay null: a month without both 9% and 4% prices, a FRED
 * observation of "." and a market with no price are skipped, never zero.
 */
(function (global) {
  'use strict';

  var DATA_URLS = {
    history: 'data/market/lihtc-equity-pricing-history.json',
    fred: 'data/fred-data.json',
    polymarket: 'data/polymarket-data.json',
    curated: 'data/polymarket-curated.json',
    marketHistory: 'data/polymarket-history.json'
  };

  // The rate and spread series compared with pricing. Labels are the page's.
  var RATE_SERIES = [
    { id: 'DGS10', label: '10-year Treasury' },
    { id: 'DGS2', label: '2-year Treasury' },
    { id: 'DGS30', label: '30-year Treasury' },
    { id: 'SOFR', label: 'SOFR (overnight rate)' },
    { id: 'MORTGAGE30US', label: '30-year mortgage rate' },
    { id: 'BAA10Y', label: 'Baa corporate spread over the 10-year' },
    { id: 'T10Y2Y', label: 'Yield curve (10-year minus 2-year)' }
  ];

  var MAX_LEAD = 12;      // months a rate series may lead pricing
  var GRANGER_LAGS = 6;   // monthly lags tested
  var ALPHA = 0.05;

  // Market roles shown in the expectations strip (see polymarket-curated.json).
  var CONTEXT_ROLES = ['recession', 'fed-decision', 'fed-cuts'];

  /* ── Statistics ─────────────────────────────────────────────────── */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function corr(a, b) {
    if (a.length !== b.length || a.length < 3) return null;
    var ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < a.length; i++) {
      sab += (a[i] - ma) * (b[i] - mb);
      saa += (a[i] - ma) * (a[i] - ma);
      sbb += (b[i] - mb) * (b[i] - mb);
    }
    if (!(saa > 0) || !(sbb > 0)) return null;
    return sab / Math.sqrt(saa * sbb);
  }

  // Least-squares slope and intercept of v against 0..n-1.
  function linearFit(v) {
    var n = v.length, mx = (n - 1) / 2, my = mean(v), sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { sxy += (i - mx) * (v[i] - my); sxx += (i - mx) * (i - mx); }
    var slope = sxx > 0 ? sxy / sxx : 0;
    return { slope: slope, intercept: my - slope * mx };
  }

  function detrend(v) {
    var fit = linearFit(v);
    return v.map(function (y, i) { return y - (fit.intercept + fit.slope * i); });
  }

  // Monthly means of a FRED observation list, keyed 'YYYY-MM'. "." and blanks
  // are FRED's missing-value markers and are skipped, not read as zero.
  function monthlyMeans(observations) {
    var sums = {}, counts = {};
    (observations || []).forEach(function (o) {
      if (!o || typeof o.date !== 'string') return;
      var raw = o.value;
      if (raw == null || raw === '' || raw === '.') return;
      var v = typeof raw === 'number' ? raw : parseFloat(raw);
      if (!isNum(v)) return;
      var m = o.date.slice(0, 7);
      sums[m] = (sums[m] || 0) + v;
      counts[m] = (counts[m] || 0) + 1;
    });
    var out = {};
    Object.keys(sums).forEach(function (m) { out[m] = sums[m] / counts[m]; });
    return out;
  }

  function addMonths(month, delta) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + delta;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }

  // Monthly pricing rows that carry both a 9% and a 4% price, in order,
  // with their average. Prices are dollars per credit dollar, so <= 0 is
  // absent, not free.
  function pricingMonths(history) {
    var rows = history && Array.isArray(history.monthly) ? history.monthly : [];
    return rows.filter(function (r) {
      return r && /^\d{4}-\d{2}$/.test(String(r.month)) && isNum(r.nine) && r.nine > 0 && isNum(r.four) && r.four > 0;
    }).map(function (r) {
      return { month: r.month, nine: r.nine, four: r.four, avg: (r.nine + r.four) / 2 };
    }).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
  }

  // Solve A x = b by Gaussian elimination with partial pivoting.
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // Residual sum of squares of y regressed on the columns of X.
  function rss(X, y) {
    var k = X[0].length, XtX = [], Xty = [];
    for (var a = 0; a < k; a++) {
      XtX.push(new Array(k).fill(0));
      Xty.push(0);
    }
    for (var i = 0; i < y.length; i++) {
      for (var p = 0; p < k; p++) {
        Xty[p] += X[i][p] * y[i];
        for (var q = 0; q < k; q++) XtX[p][q] += X[i][p] * X[i][q];
      }
    }
    var beta = solve(XtX, Xty);
    if (!beta) return null;
    var s = 0;
    for (var r = 0; r < y.length; r++) {
      var fit = 0;
      for (var c = 0; c < k; c++) fit += X[r][c] * beta[c];
      s += (y[r] - fit) * (y[r] - fit);
    }
    return s;
  }

  function gammaln(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b).
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Upper-tail p-value of an F statistic.
  function fPValue(F, d1, d2) {
    if (!isNum(F) || F < 0) return null;
    return ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
  }

  // Granger F-test: does the past of x improve a forecast of y beyond y's own
  // past? Same specification as statsmodels' ssr_ftest (constant, `lag` lags
  // of each, d2 = n - 2*lag - 1).
  function grangerP(y, x, lag) {
    var Xr = [], Xu = [], yy = [];
    for (var t = lag; t < y.length; t++) {
      var rowR = [1], rowU = [1];
      for (var l = 1; l <= lag; l++) rowR.push(y[t - l]);
      for (var l2 = 1; l2 <= lag; l2++) rowU.push(y[t - l2]);
      for (var l3 = 1; l3 <= lag; l3++) rowU.push(x[t - l3]);
      Xr.push(rowR); Xu.push(rowU); yy.push(y[t]);
    }
    var n = yy.length, d2 = n - 2 * lag - 1;
    if (d2 < 5) return null;
    var r = rss(Xr, yy), u = rss(Xu, yy);
    if (r == null || u == null || !(u > 0)) return null;
    return fPValue(((r - u) / lag) / (u / d2), lag, d2);
  }

  // Compare pricing with one rate series. `rateMonthly` is monthlyMeans output.
  function compareSeries(pricing, rateMonthly) {
    var best = null, bestDetrended = null;
    for (var k = 0; k <= MAX_LEAD; k++) {
      var py = [], rx = [];
      pricing.forEach(function (row) {
        var v = rateMonthly[addMonths(row.month, -k)];
        if (isNum(v)) { py.push(row.avg); rx.push(v); }
      });
      if (py.length < pricing.length - 2 || py.length < 24) continue;
      var raw = corr(py, rx), det = corr(detrend(py), detrend(rx));
      if (raw == null || det == null) continue;
      if (!best || Math.abs(raw) > Math.abs(best.raw)) best = { lead: k, raw: raw, detrended: det, n: py.length };
      if (!bestDetrended || Math.abs(det) > Math.abs(bestDetrended.detrended)) bestDetrended = { lead: k, detrended: det };
    }
    // Granger on month-over-month changes over the pricing window.
    var dy = [], dx = [], complete = true;
    for (var i = 1; i < pricing.length; i++) {
      var a = rateMonthly[pricing[i].month], b = rateMonthly[pricing[i - 1].month];
      if (!isNum(a) || !isNum(b) || addMonths(pricing[i - 1].month, 1) !== pricing[i].month) { complete = false; break; }
      dy.push(pricing[i].avg - pricing[i - 1].avg);
      dx.push(a - b);
    }
    var granger = null;
    if (complete) {
      for (var lag = 1; lag <= GRANGER_LAGS; lag++) {
        var p = grangerP(dy, dx, lag);
        if (p != null && (!granger || p < granger.p)) granger = { lag: lag, p: p };
      }
    }
    return best ? { atStrongestLead: best, strongestDetrended: bestDetrended, granger: granger } : null;
  }

  function analyze(history, fred) {
    var pricing = pricingMonths(history);
    if (pricing.length < 24) return null;
    var series = (fred && fred.series) || {};
    var avgs = pricing.map(function (r) { return r.avg; });
    var nine = linearFit(pricing.map(function (r) { return r.nine; }));
    var four = linearFit(pricing.map(function (r) { return r.four; }));
    var rates = {};
    var results = RATE_SERIES.map(function (s) {
      var obs = series[s.id] && series[s.id].observations;
      if (!obs) return { id: s.id, label: s.label, result: null };
      rates[s.id] = monthlyMeans(obs);
      return { id: s.id, label: s.label, result: compareSeries(pricing, rates[s.id]) };
    });
    var tested = results.filter(function (r) { return r.result && r.result.granger; });
    return {
      pricing: pricing,
      first: pricing[0].month,
      last: pricing[pricing.length - 1].month,
      months: pricing.length,
      driftCentsPerYear: { nine: nine.slope * 12 * 100, four: four.slope * 12 * 100, avg: linearFit(avgs).slope * 12 * 100 },
      results: results,
      rates: rates,
      grangerTests: tested.length * GRANGER_LAGS,
      grangerSignificant: tested.filter(function (r) { return r.result.granger.p < ALPHA; })
    };
  }

  // SOFR's peak inside the pricing window, and where SOFR and pricing stood
  // then and at the latest pricing month. Null when SOFR is missing.
  function sincePeak(analysis, id) {
    var rate = analysis.rates[id];
    if (!rate) return null;
    var peak = null;
    analysis.pricing.forEach(function (row) {
      var v = rate[row.month];
      if (isNum(v) && (!peak || v > peak.rate)) peak = { month: row.month, rate: v, price: row.avg };
    });
    var end = analysis.pricing[analysis.pricing.length - 1];
    if (!peak || !isNum(rate[end.month]) || peak.month === end.month) return null;
    return { peakMonth: peak.month, peakRate: peak.rate, peakPrice: peak.price, endMonth: end.month, endRate: rate[end.month], endPrice: end.avg };
  }

  /* ── Rendering ──────────────────────────────────────────────────── */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(m) { return MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
  function money(v) { return '$' + v.toFixed(2); }
  function signed(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }
  function pval(p) { return p < 0.001 ? '< 0.001' : p.toFixed(2); }

  // One panel of the comparison chart: monthly lines over a shared month axis.
  function panelSvg(opts) {
    var months = opts.months, W = opts.width, H = opts.height;
    var padL = 64, padR = 16, padT = 30, padB = 40;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var values = [];
    opts.lines.forEach(function (line) {
      months.forEach(function (m) { if (isNum(line.values[m])) values.push(line.values[m]); });
    });
    if (!values.length) return '';
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var step = opts.step(hi - lo);
    var yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
    if (yMax - yMin < step * 2) yMax = yMin + step * 2;
    function f(n) { return n.toFixed(1); }
    function x(i) { return padL + (i / (months.length - 1)) * plotW; }
    function y(v) { return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

    var yAxis = '';
    for (var t = 0; t <= Math.round((yMax - yMin) / step); t++) {
      var tv = yMin + t * step;
      yAxis += '<line x1="' + padL + '" y1="' + f(y(tv)) + '" x2="' + (W - padR) + '" y2="' + f(y(tv)) + '" stroke="var(--border)" stroke-width="1"/>' +
        '<text data-tick x="' + (padL - 8) + '" y="' + f(y(tv) + 4) + '" font-size="12" text-anchor="end" fill="var(--muted)">' + esc(opts.tick(tv)) + '</text>';
    }
    yAxis += '<text data-axis-title x="14" y="' + f(padT + plotH / 2) + '" font-size="12" text-anchor="middle" fill="var(--muted)" transform="rotate(-90 14 ' + f(padT + plotH / 2) + ')">' + esc(opts.yTitle) + '</text>';

    var xAxis = '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="var(--muted)" stroke-width="1"/>';
    var narrow = W < 520, labelled = 0;
    months.forEach(function (m, i) {
      if (m.slice(5) !== '01') return;
      labelled++;
      if (narrow && labelled % 2 === 0) return;
      xAxis += '<line x1="' + f(x(i)) + '" y1="' + (padT + plotH) + '" x2="' + f(x(i)) + '" y2="' + (padT + plotH + 5) + '" stroke="var(--muted)" stroke-width="1"/>' +
        '<text data-tick x="' + f(x(i)) + '" y="' + (padT + plotH + 19) + '" font-size="12" text-anchor="middle" fill="var(--muted)">' + m.slice(0, 4) + '</text>';
    });
    xAxis += '<text data-axis-title x="' + f(padL + plotW / 2) + '" y="' + (H - 4) + '" font-size="12" text-anchor="middle" fill="var(--muted)">Month (monthly average)</text>';

    var paths = '', legend = '', lx = padL;
    opts.lines.forEach(function (line) {
      var d = '', pen = false;
      months.forEach(function (m, i) {
        var v = line.values[m];
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + f(x(i)) + ' ' + f(y(v));
        pen = true;
      });
      paths += '<path d="' + d + '" fill="none" stroke="' + line.color + '" stroke-width="2.25" stroke-linejoin="round"' + (line.dash ? ' stroke-dasharray="' + line.dash + '"' : '') + '/>';
      legend += '<line x1="' + lx + '" y1="12" x2="' + (lx + 22) + '" y2="12" stroke="' + line.color + '" stroke-width="3"' + (line.dash ? ' stroke-dasharray="' + line.dash + '"' : '') + '/>' +
        '<text x="' + (lx + 28) + '" y="16" font-size="12" fill="var(--text)">' + esc(line.label) + '</text>';
      lx += 28 + line.label.length * 6.6 + 18;
    });

    return '<svg data-chart="' + esc(opts.id) + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria) + '" style="display:block;max-width:100%;height:auto;">' +
      '<g data-legend>' + legend + '</g>' +
      '<g data-axis="y">' + yAxis + '</g>' +
      '<g data-axis="x">' + xAxis + '</g>' +
      paths + '</svg>';
  }

  function renderChart(target, analysis) {
    if (!target) return;
    // Start a year before pricing does, so the 2022 rate rise that preceded
    // the pricing slide is in view; end at the latest rate month.
    var start = addMonths(analysis.first, -12);
    var end = analysis.last;
    Object.keys(analysis.rates.DGS10 || {}).forEach(function (m) { if (m > end) end = m; });
    var months = [];
    for (var m = start; m <= end; m = addMonths(m, 1)) months.push(m);
    if (months.length < 2) return;
    var nine = {}, four = {};
    analysis.pricing.forEach(function (r) { nine[r.month] = r.nine; four[r.month] = r.four; });
    var W = Math.max(320, Math.min(1100, Math.round(target.clientWidth || 720)));
    var H = W < 520 ? 220 : 240;
    target.innerHTML =
      panelSvg({
        id: 'equity-drivers-pricing', months: months, width: W, height: H,
        lines: [
          { label: '9% credits', values: nine, color: 'var(--accent)' },
          { label: '4% credits', values: four, color: 'var(--warn)', dash: '6 4' }
        ],
        step: function (range) { return range > 0.12 ? 0.05 : 0.02; },
        tick: function (v) { return '$' + v.toFixed(2); },
        yTitle: 'Equity per $1',
        aria: 'LIHTC equity price per dollar of credit, monthly, ' + monthLabel(analysis.first) + ' to ' + monthLabel(analysis.last)
      }) +
      panelSvg({
        id: 'equity-drivers-rates', months: months, width: W, height: H,
        lines: [
          { label: '10-year Treasury', values: analysis.rates.DGS10 || {}, color: 'var(--text)' },
          { label: 'SOFR', values: analysis.rates.SOFR || {}, color: 'var(--accent)', dash: '6 4' }
        ],
        step: function () { return 1; },
        tick: function (v) { return v.toFixed(0) + '%'; },
        yTitle: 'Percent',
        aria: '10-year Treasury yield and SOFR, monthly averages, ' + monthLabel(months[0]) + ' to ' + monthLabel(end)
      });
  }

  function renderFindings(target, analysis) {
    if (!target) return;
    var d = analysis.driftCentsPerYear;
    var ten = analysis.results.filter(function (r) { return r.id === 'DGS10'; })[0];
    var tenR = ten && ten.result;
    var peak = sincePeak(analysis, 'SOFR');
    var sig = analysis.grangerSignificant;
    var items = [];
    items.push('<li data-finding="drift"><strong>Pricing has mostly moved in one direction.</strong> Across ' + analysis.months + ' months (' +
      esc(monthLabel(analysis.first)) + ' to ' + esc(monthLabel(analysis.last)) + '), the straight-line trend is ' +
      signed(d.nine) + '¢ a year for 9% credits and ' + signed(d.four) + '¢ a year for 4% credits.</li>');
    if (tenR) {
      var a = tenR.atStrongestLead;
      items.push('<li data-finding="ten-year"><strong>The 10-year Treasury lines up with pricing only through that trend.</strong> Its strongest correlation with pricing is ' +
        signed(a.raw) + ' with the yield leading by ' + a.lead + ' month' + (a.lead === 1 ? '' : 's') +
        '. Remove each series’ straight-line trend and the same comparison is ' + signed(a.detrended) +
        '. Two series that both trend look related whether or not one drives the other.</li>');
    }
    if (peak) {
      items.push('<li data-finding="since-peak"><strong>Lower short-term rates have not lifted pricing.</strong> SOFR averaged ' +
        peak.peakRate.toFixed(2) + '% in ' + esc(monthLabel(peak.peakMonth)) + ' and ' + peak.endRate.toFixed(2) + '% in ' +
        esc(monthLabel(peak.endMonth)) + '; over the same months the average 9%/4% price went from ' + money(peak.peakPrice) +
        ' to ' + money(peak.endPrice) + '.</li>');
    }
    items.push('<li data-finding="granger"><strong>' + (sig.length ? 'Some rate changes preceded pricing changes.' : 'No rate series forecasts next month’s price.') + '</strong> ' +
      'A Granger test asks whether a series’ past changes help forecast pricing’s next change beyond pricing’s own past. ' +
      (sig.length
        ? sig.map(function (r) { return esc(r.label) + ' (p = ' + pval(r.result.granger.p) + ' at ' + r.result.granger.lag + ' months)'; }).join(', ') +
          ' passed at p < ' + ALPHA + ', out of ' + analysis.grangerTests + ' tests; at that many tests about ' +
          Math.round(analysis.grangerTests * ALPHA) + ' pass by chance alone.'
        : 'None of the ' + analysis.grangerTests + ' tests (' + analysis.results.filter(function (r) { return r.result && r.result.granger; }).length +
          ' series, 1 to ' + GRANGER_LAGS + ' months of lags) reached p < ' + ALPHA + '.') + '</li>');
    target.innerHTML = '<ul style="margin:0 0 var(--sp3);padding-left:1.2rem;line-height:1.6;">' + items.join('') + '</ul>';
  }

  function renderTable(target, analysis) {
    if (!target) return;
    target.innerHTML = '<table data-equity-drivers-table><thead><tr><th>Series</th><th>Strongest correlation (lead)</th><th>Same lead, trend removed</th><th>Granger test, best lag</th></tr></thead><tbody>' +
      analysis.results.map(function (row) {
        var r = row.result;
        if (!r) return '<tr data-series="' + esc(row.id) + '"><td><strong>' + esc(row.label) + '</strong></td><td colspan="3" style="color:var(--muted);">Not available in data/fred-data.json for this window</td></tr>';
        var a = r.atStrongestLead;
        return '<tr data-series="' + esc(row.id) + '"><td><strong>' + esc(row.label) + '</strong><br><span style="color:var(--muted);font-size:var(--tiny);">FRED ' + esc(row.id) + '</span></td>' +
          '<td>' + signed(a.raw) + ' (' + a.lead + ' mo)</td>' +
          '<td>' + signed(a.detrended) + '</td>' +
          '<td>' + (r.granger ? 'p = ' + pval(r.granger.p) + ' (' + r.granger.lag + ' mo)' : '<span style="color:var(--muted);">Not computed</span>') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // Headline odds for the context strip: for a single yes/no market, the yes
  // price; for a set of outcomes, the likeliest. A market with no parseable
  // price is skipped.
  function headline(event) {
    var best = null;
    (event.markets || []).forEach(function (m) {
      var prices, outcomes;
      try { prices = JSON.parse(m.outcomePrices || '[]'); outcomes = JSON.parse(m.outcomes || '[]'); } catch (e) { return; }
      var yesAt = outcomes.indexOf('Yes');
      var p = parseFloat(prices[yesAt >= 0 ? yesAt : 0]);
      if (!isNum(p) || p < 0 || p > 1) return;
      if (!best || p > best.p) best = { name: m.question, p: p };
    });
    return best;
  }

  function renderContext(target, poly, curated, history) {
    if (!target) return;
    var events = (curated && Array.isArray(curated.events)) ? curated.events : [];
    var live = (poly && poly.events) || {};
    var cards = events.filter(function (e) { return CONTEXT_ROLES.indexOf(e.role) !== -1 && live[e.slug] && !live[e.slug].stale_since; })
      .map(function (e) {
        var h = headline(live[e.slug]);
        if (!h) return '';
        var single = (live[e.slug].markets || []).length === 1;
        return '<div class="card" data-market="' + esc(e.slug) + '" style="padding:var(--sp3);">' +
          '<div style="font-size:var(--tiny);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600;">' + esc(e.label) + '</div>' +
          '<div style="font-size:1.25rem;font-weight:700;margin:.25rem 0;">' + Math.round(h.p * 100) + '%</div>' +
          '<div style="font-size:var(--small);color:var(--muted);">' + (single ? 'Market odds of yes' : 'Likeliest outcome: ' + esc(h.name)) + '</div>' +
        '</div>';
      }).filter(Boolean);
    if (!cards.length) {
      target.innerHTML = '<p style="color:var(--muted);">No live market odds are cached right now.</p>';
      return;
    }
    var rows = history && Array.isArray(history.rows) ? history.rows : [];
    var kept = rows.length
      ? 'The site\u2019s daily record of these odds starts ' + esc(rows[0].date) + ' (' + rows.length + ' daily snapshots so far), which is too short to test against pricing. It is kept so that test can be run later.'
      : 'The site does not yet hold a history of these odds, so they cannot be tested against pricing.';
    target.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp3);">' + cards.join('') + '</div>' +
      '<p data-market-history style="font-size:var(--tiny);color:var(--muted);margin:var(--sp2) 0 0;">Polymarket odds as of ' + esc(String(poly.updated || '').slice(0, 10)) +
      '. These are context, not drivers. ' + kept + '</p>';
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function init() {
    var root = document.getElementById('tceDrivers');
    if (!root) return;
    var status = document.getElementById('tceDriversStatus');
    Promise.all([fetchJson(DATA_URLS.history), fetchJson(DATA_URLS.fred)]).then(function (p) {
      var analysis = analyze(p[0], p[1]);
      if (!analysis) throw new Error('fewer than 24 months of pricing');
      renderFindings(document.getElementById('tceDriversFindings'), analysis);
      renderTable(document.getElementById('tceDriversTable'), analysis);
      var chart = document.getElementById('tceDriversChart');
      renderChart(chart, analysis);
      if (chart && !chart.__resize && global.addEventListener) {
        var timer = null;
        chart.__resize = function () { clearTimeout(timer); timer = setTimeout(function () { renderChart(chart, analysis); }, 150); };
        global.addEventListener('resize', chart.__resize);
      }
    }).catch(function (err) {
      if (status) status.textContent = 'The pricing comparison could not be computed: ' + err.message;
    });
    Promise.all([
      fetchJson(DATA_URLS.polymarket),
      fetchJson(DATA_URLS.curated),
      fetchJson(DATA_URLS.marketHistory).catch(function () { return null; })
    ]).then(function (p) {
      renderContext(document.getElementById('tceDriversMarkets'), p[0], p[1], p[2]);
    }).catch(function () {
      var t = document.getElementById('tceDriversMarkets');
      if (t) t.innerHTML = '<p style="color:var(--muted);">Market odds are unavailable right now.</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.EquityPricingDrivers = {
    DATA_URLS: DATA_URLS,
    RATE_SERIES: RATE_SERIES,
    stats: {
      corr: corr, detrend: detrend, linearFit: linearFit, monthlyMeans: monthlyMeans,
      pricingMonths: pricingMonths, grangerP: grangerP, fPValue: fPValue,
      compareSeries: compareSeries, analyze: analyze, sincePeak: sincePeak
    },
    headline: headline,
    renderContext: renderContext,
    init: init
  };
})(typeof window !== 'undefined' ? window : this);
