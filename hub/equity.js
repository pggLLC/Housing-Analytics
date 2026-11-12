// Tax credit equity markets (#/equity-pricing): what investors pay per dollar of credit, from the live site's
// data files. National 9% and 4% history, what interest rates do and do not explain, Novogradac's regional and
// Colorado medians, what state allocation plans assume, transfer prices for credits that can be sold, how each
// credit prices, and the federal and Colorado laws that move pricing. Every section of the live
// article-pricing.html has a home here (qa/content-parity.json).
//
// The rate comparison uses the same statistics as the public site's js/components/equity-pricing-drivers.js
// (STATS below); qa/equity.test.js runs both on the pinned data and fails if any result differs. When this hub
// moves into Housing-Analytics it calls that module's stats directly and drops the copy.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var FILES = {
    hist: 'data/market/lihtc-equity-pricing-history.json', bench: 'data/market/novogradac-equity-pricing.json',
    fred: 'data/fred-data.json', law: 'data/policy/tax-credit-legislation.json', transfer: 'data/market/tax-credit-transfer-pricing.json'
  };
  // Market odds load on their own, so a missing snapshot only empties that one card row.
  var MARKET_FILES = { poly: 'data/polymarket-data.json', curated: 'data/polymarket-curated.json', polyHist: 'data/polymarket-history.json' };
  var SERIES = [{ key: 'nine', label: '9% credits', cls: 'eq-nine' }, { key: 'four', label: '4% credits', cls: 'eq-four' }];
  // The live watch shows these credit types (its data-tax-credit-watch list); Opportunity Zones stay on Legislation.
  var WATCH_SCOPES = ['lihtc', 'nmtc', 'htc', 'itc-ptc', 'cra', 'homebuyer'];
  var SCOPE = { lihtc: 'Housing tax credits', nmtc: 'New Markets', htc: 'Historic', 'itc-ptc': 'Clean-energy credits', cra: 'Bank CRA rules', homebuyer: 'Homes and energy' };
  var STATUS = { enacted: 'Enacted', proposed: 'Proposed', 'rule-pending': 'Rule pending', 'phased-out': 'Phased out', expired: 'Expired', verified: 'Verified', VERIFY: 'Not yet verified' };
  var STATUS_CLS = { enacted: 'ok', verified: 'ok', proposed: 'wait', 'rule-pending': 'wait', VERIFY: 'wait' };

  function cents(v) { return v == null ? '—' : '$' + Number(v).toFixed(2); }
  function priced(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function safe(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function link(text, href) { var u = safe(href); return u ? '<a href="' + esc(u) + '">' + esc(text) + '</a>' : esc(text); }
  function status(s) { return '<span class="eq-status eq-' + (STATUS_CLS[s] || 'off') + '">' + esc(STATUS[s] || 'Watch') + '</span>'; }

  /* ── Rate comparison statistics (same as the public site's equity-pricing-drivers.js) ── */
  var RATE_SERIES = [
    { id: 'DGS10', label: '10-year Treasury' },
    { id: 'DGS2', label: '2-year Treasury' },
    { id: 'DGS30', label: '30-year Treasury' },
    { id: 'SOFR', label: 'SOFR (overnight rate)' },
    { id: 'MORTGAGE30US', label: '30-year mortgage rate' },
    { id: 'BAA10Y', label: 'Baa corporate spread over the 10-year' },
    { id: 'T10Y2Y', label: 'Yield curve (10-year minus 2-year)' }
  ];
  var MAX_LEAD = 12, GRANGER_LAGS = 6, ALPHA = 0.05;
  var CONTEXT_ROLES = ['recession', 'fed-decision', 'fed-cuts'];

  var STATS = (function () {
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
    function corr(a, b) {
      if (a.length !== b.length || a.length < 3) return null;
      var ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
      for (var i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
      if (!(saa > 0) || !(sbb > 0)) return null;
      return sab / Math.sqrt(saa * sbb);
    }
    function linearFit(v) {
      var n = v.length, mx = (n - 1) / 2, my = mean(v), sxy = 0, sxx = 0;
      for (var i = 0; i < n; i++) { sxy += (i - mx) * (v[i] - my); sxx += (i - mx) * (i - mx); }
      var slope = sxx > 0 ? sxy / sxx : 0;
      return { slope: slope, intercept: my - slope * mx };
    }
    function detrend(v) { var fit = linearFit(v); return v.map(function (y, i) { return y - (fit.intercept + fit.slope * i); }); }
    // FRED's "." and blanks are missing values, skipped, never read as zero.
    function monthlyMeans(observations) {
      var sums = {}, counts = {};
      (observations || []).forEach(function (o) {
        if (!o || typeof o.date !== 'string') return;
        var raw = o.value;
        if (raw == null || raw === '' || raw === '.') return;
        var v = typeof raw === 'number' ? raw : parseFloat(raw);
        if (!isNum(v)) return;
        var m = o.date.slice(0, 7);
        sums[m] = (sums[m] || 0) + v; counts[m] = (counts[m] || 0) + 1;
      });
      var out = {};
      Object.keys(sums).forEach(function (m) { out[m] = sums[m] / counts[m]; });
      return out;
    }
    function addMonths(month, delta) {
      var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + delta;
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      return y + '-' + (m < 9 ? '0' : '') + (m + 1);
    }
    // Months with both a 9% and a 4% price; a price of zero or less is absent, not free.
    function pricingMonths(history) {
      var rows = history && Array.isArray(history.monthly) ? history.monthly : [];
      return rows.filter(function (r) {
        return r && /^\d{4}-\d{2}$/.test(String(r.month)) && isNum(r.nine) && r.nine > 0 && isNum(r.four) && r.four > 0;
      }).map(function (r) { return { month: r.month, nine: r.nine, four: r.four, avg: (r.nine + r.four) / 2 }; })
        .sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    }
    function solve(A, b) {
      var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
      for (var c = 0; c < n; c++) {
        var p = c;
        for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-14) return null;
        var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
        for (var r2 = c + 1; r2 < n; r2++) { var f = M[r2][c] / M[c][c]; for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k]; }
      }
      var x = new Array(n);
      for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
      return x;
    }
    function rss(X, y) {
      var k = X[0].length, XtX = [], Xty = [];
      for (var a = 0; a < k; a++) { XtX.push(new Array(k).fill(0)); Xty.push(0); }
      for (var i = 0; i < y.length; i++) for (var p = 0; p < k; p++) { Xty[p] += X[i][p] * y[i]; for (var q = 0; q < k; q++) XtX[p][q] += X[i][p] * X[i][q]; }
      var beta = solve(XtX, Xty);
      if (!beta) return null;
      var s = 0;
      for (var r = 0; r < y.length; r++) { var fit = 0; for (var c = 0; c < k; c++) fit += X[r][c] * beta[c]; s += (y[r] - fit) * (y[r] - fit); }
      return s;
    }
    function gammaln(x) {
      var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
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
    function ibeta(x, a, b) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
      return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
    }
    function fPValue(F, d1, d2) { if (!isNum(F) || F < 0) return null; return ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2); }
    // Granger F-test with a constant and `lag` lags of each series (statsmodels' ssr_ftest).
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
    function compareSeries(pricing, rateMonthly) {
      var best = null, bestDetrended = null;
      for (var k = 0; k <= MAX_LEAD; k++) {
        var py = [], rx = [];
        pricing.forEach(function (row) { var v = rateMonthly[addMonths(row.month, -k)]; if (isNum(v)) { py.push(row.avg); rx.push(v); } });
        if (py.length < pricing.length - 2 || py.length < 24) continue;
        var raw = corr(py, rx), det = corr(detrend(py), detrend(rx));
        if (raw == null || det == null) continue;
        if (!best || Math.abs(raw) > Math.abs(best.raw)) best = { lead: k, raw: raw, detrended: det, n: py.length };
        if (!bestDetrended || Math.abs(det) > Math.abs(bestDetrended.detrended)) bestDetrended = { lead: k, detrended: det };
      }
      var dy = [], dx = [], complete = true;
      for (var i = 1; i < pricing.length; i++) {
        var a = rateMonthly[pricing[i].month], b = rateMonthly[pricing[i - 1].month];
        if (!isNum(a) || !isNum(b) || addMonths(pricing[i - 1].month, 1) !== pricing[i].month) { complete = false; break; }
        dy.push(pricing[i].avg - pricing[i - 1].avg); dx.push(a - b);
      }
      var granger = null;
      if (complete) for (var lag = 1; lag <= GRANGER_LAGS; lag++) { var p = grangerP(dy, dx, lag); if (p != null && (!granger || p < granger.p)) granger = { lag: lag, p: p }; }
      return best ? { atStrongestLead: best, strongestDetrended: bestDetrended, granger: granger } : null;
    }
    function analyze(history, fred) {
      var pricing = pricingMonths(history);
      if (pricing.length < 24) return null;
      var series = (fred && fred.series) || {};
      var nine = linearFit(pricing.map(function (r) { return r.nine; })), four = linearFit(pricing.map(function (r) { return r.four; }));
      var rates = {};
      var results = RATE_SERIES.map(function (s) {
        var obs = series[s.id] && series[s.id].observations;
        if (!obs) return { id: s.id, label: s.label, result: null };
        rates[s.id] = monthlyMeans(obs);
        return { id: s.id, label: s.label, result: compareSeries(pricing, rates[s.id]) };
      });
      var tested = results.filter(function (r) { return r.result && r.result.granger; });
      return {
        pricing: pricing, first: pricing[0].month, last: pricing[pricing.length - 1].month, months: pricing.length,
        driftCentsPerYear: { nine: nine.slope * 12 * 100, four: four.slope * 12 * 100, avg: linearFit(pricing.map(function (r) { return r.avg; })).slope * 12 * 100 },
        results: results, rates: rates, grangerTests: tested.length * GRANGER_LAGS,
        grangerSignificant: tested.filter(function (r) { return r.result.granger.p < ALPHA; })
      };
    }
    function sincePeak(analysis, id) {
      var rate = analysis.rates[id];
      if (!rate) return null;
      var peak = null;
      analysis.pricing.forEach(function (row) { var v = rate[row.month]; if (isNum(v) && (!peak || v > peak.rate)) peak = { month: row.month, rate: v, price: row.avg }; });
      var end = analysis.pricing[analysis.pricing.length - 1];
      if (!peak || !isNum(rate[end.month]) || peak.month === end.month) return null;
      return { peakMonth: peak.month, peakRate: peak.rate, peakPrice: peak.price, endMonth: end.month, endRate: rate[end.month], endPrice: end.avg };
    }
    // For a yes/no market, the yes price; for a set of outcomes, the likeliest. Unparseable prices are skipped.
    function headline(event) {
      var best = null;
      (event.markets || []).forEach(function (m) {
        var prices, outcomes;
        try { prices = JSON.parse(m.outcomePrices || '[]'); outcomes = JSON.parse(m.outcomes || '[]'); } catch (e) { return; }
        var yesAt = outcomes.indexOf('Yes'), p = parseFloat(prices[yesAt >= 0 ? yesAt : 0]);
        if (!isNum(p) || p < 0 || p > 1) return;
        if (!best || p > best.p) best = { name: m.question, p: p };
      });
      return best;
    }
    return { corr: corr, detrend: detrend, linearFit: linearFit, monthlyMeans: monthlyMeans, pricingMonths: pricingMonths, grangerP: grangerP,
      fPValue: fPValue, compareSeries: compareSeries, analyze: analyze, sincePeak: sincePeak, addMonths: addMonths, headline: headline };
  })();

  // How each credit prices, as the live page's matrix states it (terms and tax treatment from the Internal
  // Revenue Code; the pricing direction is the site's reading, not a published estimate).
  var CREDITS = [
    { id: 'lihtc-9', credit: 'LIHTC 9%', statute: 'IRC §42', stream: '10-year credit stream; 15-year compliance and recapture period.', transfer: 'Not transferable. Investor must enter a partnership/syndication structure.', taxTreatment: 'Bundled with depreciation losses and long compliance risk.', direction: 'Longer stream and syndication cost push price below $1.00; CRA demand can pull hot markets higher.' },
    { id: 'lihtc-4', credit: 'LIHTC 4%', statute: 'IRC §42', stream: '10-year credit stream; 15-year compliance and recapture period.', transfer: 'Not transferable. Investor must own an equity interest.', taxTreatment: 'Bond-deal supply and depreciation shape the investor return.', direction: 'Bond volume and the new 25% test expand supply, which can pressure cents-per-dollar down.' },
    { id: 'htc', credit: 'Federal HTC', statute: 'IRC §47', stream: '20% rehabilitation credit claimed ratably over 5 years.', transfer: 'Not transferable. Syndicated through ownership structures.', taxTreatment: 'Pricing depends on rehab risk, basis certification, and recapture exposure.', direction: 'Shorter stream helps pricing, but smaller/niche deal flow keeps the buyer pool narrower.' },
    { id: 'nmtc', credit: 'NMTC', statute: 'IRC §45D', stream: '39% over 7 years: 5% for the first 3 years, then 6% for the next 4 years.', transfer: 'Not transferable. Uses CDE allocation and partnership/leverage structures.', taxTreatment: 'Pricing is structure-heavy and tied to allocation rounds and leverage.', direction: 'Permanent extension removes extender risk, but allocation scarcity and structure still drive pricing.' },
    { id: 'itc', credit: 'ITC / 48E', statute: 'IRC §§48, 48E, 6418', stream: 'One-time credit in the placed-in-service year; 5-year recapture exposure.', transfer: 'Transferable for cash under §6418.', taxTreatment: '§6418 transfer proceeds are excluded from seller income; buyer discount is not taxed as income.', direction: 'Shorter stream and transferability support prices close to $1.00, discounted for recapture and diligence risk.' },
    { id: 'ptc', credit: 'PTC / 45Y', statute: 'IRC §§45, 45Y, 6418', stream: 'Per-kWh production credit over 10 years; payment depends on actual generation.', transfer: 'Transferable for cash under §6418.', taxTreatment: 'Buyer needs tax appetite; §6418 cash sale is structurally simpler than syndication.', direction: 'No ITC-style recapture risk can make PTC transfers price richer than ITC transfers.' }
  ];
  var IRC = ['42', '45D', '47', '48', '48E', '50', '6418'];

  // Inputs the rate comparison leaves out, as the live page lists them.
  var NOT_MEASURED = [
    ['Credit supply.', 'Annual 9% allocations and private activity bond volume for 4% deals. The 2025 federal law raised 9% allocations and lowered the 4% bond test; see the legislation watch below.'],
    ['Bank CRA demand.', 'Banks are the main buyers, and they pay more in markets where they need Community Reinvestment Act credit.'],
    ['Investor tax capacity.', 'Bank and corporate earnings, since credits only help an investor that owes tax.'],
    ['Investor yields.', 'The after-tax return investors accept, which syndicators report and is the mirror image of price.'],
    ['Corporate bond spreads beyond Baa.', 'The return investors could earn elsewhere.'],
    ['The corporate tax rate.', 'It was 21% throughout this period, so it cannot explain these years, but a change would move pricing.']
  ];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(m) { return MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
  function signed(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }
  function pval(p) { return p < 0.001 ? '< 0.001' : p.toFixed(2); }
  function monthDate(m) { return new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 15); }

  // The analysis runs once per loaded data set, not on every render.
  var cached = { key: null, value: null };
  function analysisFor(d) {
    if (cached.key !== d) { cached.key = d; cached.value = STATS.analyze(d.hist, d.fred); }
    return cached.value;
  }

  // Quarterly national price, one line per credit type. The scale starts near the lowest price, not at zero,
  // because the story is a few cents of movement; the axis labels say so.
  // Drawn twice, at desktop width and at phone width, so the phone's labels stay at 13 px (drawing 3.1); CSS shows one.
  function lineChart(q) {
    return '<figure class="eq-chart viz-pair"><figcaption><strong>National price per dollar of credit, by quarter</strong>' +
      '<span class="note">Novogradac’s monthly averages, averaged by quarter. The scale does not start at zero. Point to a mark for its value.</span></figcaption>' +
      '<ul class="eq-key">' + SERIES.map(function (s) { return '<li><span class="eq-swatch ' + s.cls + '" aria-hidden="true"></span>' + esc(s.label) + '</li>'; }).join('') + '</ul>' +
      '<div class="pm-frame">' + drawLines(q, false) + drawLines(q, true) + '</div>' +
      (global.LabVizData ? global.LabVizData.block('National price per dollar of credit, by quarter', ['Quarter', '9% credits ($)', '4% credits ($)'], q.map(function (r) { return [r.quarter, r.nine, r.four]; })) : '') + '</figure>';
  }
  function drawLines(q, phone) {
    var W = phone ? 340 : 720, H = phone ? 240 : 260, L = 44, R = phone ? 64 : 70, TOP = 14, B = 34;
    var vals = [];
    q.forEach(function (r) { SERIES.forEach(function (s) { if (r[s.key] != null) vals.push(r[s.key]); }); });
    var lo = Math.floor(Math.min.apply(null, vals) * 100 - 1) / 100, hi = Math.ceil(Math.max.apply(null, vals) * 100 + 1) / 100;
    var x = function (i) { return L + i * (W - L - R) / (q.length - 1); };
    var y = function (v) { return TOP + (hi - v) / (hi - lo) * (H - TOP - B); };
    var grid = '';
    for (var g = Math.ceil(lo * 100); g <= hi * 100; g += phone ? 4 : 2) {
      grid += '<line class="eq-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g / 100).toFixed(1) + '" y2="' + y(g / 100).toFixed(1) + '"/>' +
        '<text class="eq-axis" x="' + (L - 6) + '" y="' + (y(g / 100) + 4).toFixed(1) + '" text-anchor="end">' + cents(g / 100) + '</text>';
    }
    var ticks = q.map(function (r, i) {
      var yr = +r.quarter.slice(0, 4);
      return /Q1$/.test(r.quarter) && (!phone || yr % 2 === 0) ? '<text class="eq-axis" x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + r.quarter.slice(0, 4) + '</text>' : '';
    }).join('');
    var lines = SERIES.map(function (s) {
      var pts = q.map(function (r, i) { return r[s.key] == null ? null : [x(i), y(r[s.key]), r]; }).filter(Boolean);
      var last = pts[pts.length - 1];
      return '<g class="eq-series ' + s.cls + '"><path d="M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + '"/>' +
        pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4"><title>' + esc(p[2].quarter + ', ' + s.label + ': ' + cents(p[2][s.key])) + '</title></circle>'; }).join('') +
        '<text class="eq-end" x="' + (last[0] + 8).toFixed(1) + '" y="' + (last[1] + (s.key === 'nine' ? 12 : -4)).toFixed(1) + '">' + esc((phone ? '' : s.label.split(' ')[0] + ' ') + cents(last[2][s.key])) + '</text></g>';
    }).join('');
    return '<svg class="viz-' + (phone ? 'p' : 'd') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="National 9% and 4% equity prices by quarter, ' + esc(q[0].quarter + ' to ' + q[q.length - 1].quarter) + '">' + grid + ticks + lines + '</svg>';
  }

  // ---------- What moves LIHTC pricing ----------
  function findings(a) {
    var d = a.driftCentsPerYear, ten = a.results.filter(function (r) { return r.id === 'DGS10'; })[0], tenR = ten && ten.result;
    var peak = STATS.sincePeak(a, 'SOFR'), sig = a.grangerSignificant, items = [];
    items.push(['Pricing has mostly moved one way.', 'Across ' + a.months + ' months (' + monthLabel(a.first) + ' to ' + monthLabel(a.last) + '), the straight-line trend is ' +
      signed(d.nine) + '¢ a year for 9% credits and ' + signed(d.four) + '¢ a year for 4% credits.']);
    if (tenR) {
      var s = tenR.atStrongestLead;
      items.push(['The 10-year Treasury lines up with pricing only through that trend.', 'Its strongest correlation with pricing is ' + signed(s.raw) + ' with the yield leading by ' + s.lead +
        ' month' + (s.lead === 1 ? '' : 's') + '. Take out each series’ straight-line trend and the same comparison is ' + signed(s.detrended) + '. Two series that both trend look related whether or not one drives the other.']);
    }
    if (peak) {
      items.push(['Lower short-term rates have not lifted pricing.', 'SOFR averaged ' + peak.peakRate.toFixed(2) + '% in ' + monthLabel(peak.peakMonth) + ' and ' + peak.endRate.toFixed(2) + '% in ' +
        monthLabel(peak.endMonth) + '; over the same months the average 9%/4% price went from ' + cents(peak.peakPrice) + ' to ' + cents(peak.endPrice) + '.']);
    }
    var nTested = a.results.filter(function (r) { return r.result && r.result.granger; }).length;
    items.push([sig.length ? 'Some rate changes came before pricing changes.' : 'No rate series forecasts next month’s price.',
      'A Granger test asks whether a series’ past changes help forecast pricing’s next change beyond pricing’s own past. ' +
      (sig.length
        ? sig.map(function (r) { return r.label + ' (p = ' + pval(r.result.granger.p) + ' at ' + r.result.granger.lag + ' months)'; }).join(', ') + ' passed at p < ' + ALPHA + ', out of ' +
          a.grangerTests + ' tests; at that many tests about ' + Math.round(a.grangerTests * ALPHA) + ' pass by chance alone.'
        : 'None of the ' + a.grangerTests + ' tests (' + nTested + ' series, 1 to ' + GRANGER_LAGS + ' months of lags) reached p < ' + ALPHA + '.')]);
    return '<ul class="eq-findings">' + items.map(function (i) { return '<li><strong>' + esc(i[0]) + '</strong> ' + esc(i[1]) + '</li>'; }).join('') + '</ul>';
  }

  function driverCharts(a, fred) {
    var V = global.LabViz;
    if (!V) return '';
    var end = a.last;
    Object.keys(a.rates.DGS10 || {}).forEach(function (m) { if (m > end) end = m; });
    var start = STATS.addMonths(a.first, -12), months = [];
    for (var m = start; m <= end; m = STATS.addMonths(m, 1)) months.push(m);
    var pts = function (src) { return months.filter(function (k) { return typeof src[k] === 'number'; }).map(function (k) { return [monthDate(k), src[k]]; }); };
    var nine = {}, four = {};
    a.pricing.forEach(function (r) { nine[r.month] = r.nine; four[r.month] = r.four; });
    var fredWhen = String(fred.updated || '').slice(0, 10);
    return '<div class="eq-pair">' +
      V.timeLines({
        title: 'Price per dollar of credit, by month', zero: false, fmt: function (v) { return '$' + v.toFixed(2); },
        answer: 'The scale does not start at zero.', label: 'LIHTC equity price per dollar of credit, monthly, ' + monthLabel(a.first) + ' to ' + monthLabel(a.last),
        series: [{ label: '9% credits', color: 'var(--c-blue)', points: pts(nine) }, { label: '4% credits', color: 'var(--rust)', dash: true, points: pts(four) }],
        source: 'Source: ' + link('Novogradac, LIHTC Equity Pricing Trends', FILES_SRC.novo) + ', monthly to ' + esc(monthLabel(a.last))
      }) +
      V.timeLines({
        title: 'Interest rates over the same months', fmt: function (v) { return (Math.round(v) === v ? v.toFixed(0) : v.toFixed(2)) + '%'; },
        answer: 'Monthly averages, starting a year before pricing does.', label: '10-year Treasury yield and SOFR, monthly averages, ' + monthLabel(months[0]) + ' to ' + monthLabel(end),
        series: [{ label: '10-year Treasury', color: 'var(--ink)', points: pts(a.rates.DGS10 || {}) }, { label: 'SOFR', color: 'var(--c-green)', dash: true, points: pts(a.rates.SOFR || {}) }],
        source: 'Source: ' + link('FRED, Federal Reserve Bank of St. Louis', 'https://fred.stlouisfed.org/') + (fredWhen ? ', updated ' + esc(fredWhen) : '')
      }) + '</div>';
  }
  var FILES_SRC = { novo: 'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/lihtc-equity-pricing-trends' };

  function rateTable(a) {
    var rows = a.results.map(function (r) {
      var x = r.result, s = x && x.atStrongestLead;
      return { label: r.label + ' (FRED ' + r.id + ')', raw: s ? s.raw : null, lead: s ? s.lead : null, det: s ? s.detrended : null, p: x && x.granger ? x.granger.p : null, lag: x && x.granger ? x.granger.lag : null };
    });
    return UI.table('eqd', 'Each rate series compared with the average 9%/4% price', [
      { key: 'label', label: 'Series' },
      { key: 'raw', label: 'Strongest correlation (lead)', num: true, tip: 'Correlation from −1 to +1 at the lead, 0 to 12 months, where it is strongest', fmt: function (v, r) { return signed(v) + ' (' + r.lead + ' mo)'; } },
      { key: 'det', label: 'Same lead, trend removed', num: true, tip: 'The same correlation after each series’ straight-line trend is taken out', fmt: signed },
      { key: 'p', label: 'Granger test, best lag', num: true, tip: 'Lowest p-value over 1 to 6 months of lags; below 0.05 counts as a pass', fmt: function (v, r) { return 'p = ' + pval(v) + ' (' + r.lag + ' mo)'; } }
    ], rows, { noun: 'series', placeholder: 'Rate' });
  }

  function marketCards() {
    var m = UI.load(MARKET_FILES);
    if (!m.data) return m.error ? '<p class="note">Market odds are unavailable right now.</p>' : '<p class="note">Loading market odds…</p>';
    var poly = m.data.poly, live = (poly && poly.events) || {}, events = (m.data.curated && m.data.curated.events) || [];
    var cards = events.filter(function (e) { return CONTEXT_ROLES.indexOf(e.role) !== -1 && live[e.slug] && !live[e.slug].stale_since; }).map(function (e) {
      var h = STATS.headline(live[e.slug]);
      if (!h) return '';
      var single = (live[e.slug].markets || []).length === 1;
      return '<li><span class="fact-label">' + esc(e.label) + '</span><span class="fact-value">' + Math.round(h.p * 100) + '%</span><span class="note">' + esc(single ? 'Market odds of yes' : 'Likeliest: ' + h.name) + '</span></li>';
    }).filter(Boolean);
    if (!cards.length) return '<p class="note">No live market odds are cached right now.</p>';
    var rows = m.data.polyHist && Array.isArray(m.data.polyHist.rows) ? m.data.polyHist.rows : [];
    var kept = rows.length ? 'The site’s daily record of these odds starts ' + rows[0].date + ' (' + rows.length + ' daily snapshots so far), too short to test against pricing. It is kept so that test can be run later.'
      : 'The site does not yet hold a history of these odds, so they cannot be tested against pricing.';
    return '<ul class="eq-odds">' + cards.join('') + '</ul><p class="note">' + link('Polymarket', 'https://polymarket.com') + ' odds as of ' + esc(String(poly.updated || '').slice(0, 10)) + '. These are context, not drivers. ' + esc(kept) + '</p>';
  }

  // ---------- Benchmarks, plans, transfers, law ----------
  function benchmarks(b) {
    var p = b.pricing, rows = [];
    if (p.national_avg) rows.push({ name: 'National average (quarter)', nine: p.national_avg.credit_9pct, four: p.national_avg.credit_4pct, median: null, notes: p.national_avg.notes || '' });
    Object.keys(p.by_region || {}).forEach(function (k) {
      var r = p.by_region[k];
      rows.push({ name: r.label + ' region (' + (r.states || []).join(', ') + ')' + ((r.states || []).indexOf('CO') > -1 ? ', Colorado’s region' : ''), nine: r.credit_9pct, four: r.credit_4pct, median: r.median_all_credits, notes: r.notes || '' });
    });
    if (p.by_state && p.by_state.CO) rows.push({ name: 'Colorado', nine: p.by_state.CO.credit_9pct, four: p.by_state.CO.credit_4pct, median: p.by_state.CO.median_all_credits, notes: p.by_state.CO.notes || '' });
    var pub = function (v) { return priced(v) ? cents(v) : 'Not published'; };
    var col = function (k, label, tip) { return { key: k, label: label, num: true, fmt: pub, tip: tip }; };
    var states = Object.keys(p.by_state).map(function (k) { var r = p.by_state[k]; return { name: r.label, median: r.median_all_credits, nine: r.credit_9pct, four: r.credit_4pct }; });
    return UI.table('eqb', 'Novogradac benchmarks: national, by region and Colorado, ' + b.meta.vintage, [
      { key: 'name', label: 'Market' }, col('nine', '9%', 'National: average of the quarter’s monthly 9% figures. Blank where Novogradac does not split credit types'),
      col('four', '4%', 'National: average of the quarter’s monthly 4% figures. Blank where Novogradac does not split credit types'),
      col('median', 'All credits (median)', 'Novogradac’s median for the quarter, 9% and 4% together'), { key: 'notes', label: 'Notes' }
    ], rows, { noun: 'markets', placeholder: 'Region or state' }) +
      '<details class="counted"><summary>Every state Novogradac lists</summary>' +
      UI.table('eqs', 'Novogradac medians by state, ' + b.meta.vintage, [{ key: 'name', label: 'State' }, col('median', 'Median', 'All credit types together'), col('nine', '9%', 'Only where Novogradac splits credit types'), col('four', '4%', 'Only where Novogradac splits credit types')], states, { noun: 'states', placeholder: 'State' }) +
      '</details><p class="note">' + esc(p.regional_notes) + '</p>' +
      '<p class="source-line"><span>Source</span> Novogradac, ' + link('national 9% and 4% averages', p.national_avg && p.national_avg.source_url) + ' and ' + link('regional and state medians', p.regional_source_url) +
      ' (' + esc(b.meta.vintage) + ', captured ' + esc(b.meta.captured) + ')</p>';
  }

  function qapTable(qap) {
    var figure = function (e) {
      if (priced(e.price_low) && priced(e.price_high)) return cents(e.price_low) + '–' + cents(e.price_high);
      if (priced(e.price_assumed)) return cents(e.price_assumed);
      if (priced(e.price_low)) return cents(e.price_low) + ' or more';
      return 'Not stated';
    };
    var rows = qap.entries.map(function (e) {
      return { name: e.name, fig: figure(e), says: (e.quote ? '“' + e.quote + '”' : '') + (e.note ? ' ' + e.note : ''), doc: e.document + (e.section ? ', ' + e.section : ''), url: safe(e.source_url) };
    });
    return UI.table('eqp', 'Equity prices in Colorado’s and nearby states’ allocation plans, checked ' + qap.checked, [
      { key: 'name', label: 'State' }, { key: 'fig', label: 'Figure', tip: 'As the plan states it; “Not stated” is a finding, not a gap' },
      { key: 'says', label: 'What the plan says' }, { key: 'doc', label: 'Source', href: function (r) { return r.url; } }
    ], rows, { noun: 'plans', placeholder: 'State' });
  }

  function transferTable(t) {
    var meta = t.meta || {};
    var rows = (t.markets || []).map(function (e) {
      var price = e.price_low == null || e.price_high == null ? 'Not yet verified' : e.price_low === e.price_high ? '$' + String(Math.round(e.price_low * 1000) / 1000) + ' average' : cents(e.price_low) + '–' + cents(e.price_high);
      return { label: e.label, scope: e.credit_type || e.scope, price: price, st: STATUS[e.status] || e.status, note: e.source_note || '', when: e.as_of ? 'as of ' + e.as_of : (e.last_verified || meta.last_verified) ? 'checked ' + (e.last_verified || meta.last_verified) : 'date unconfirmed', url: safe(e.source_url) };
    });
    return UI.table('eqt', 'Transfer and syndication prices per dollar of credit, ' + (meta.vintage || ''), [
      { key: 'label', label: 'Market' }, { key: 'scope', label: 'Credit' },
      { key: 'price', label: 'Price', tip: 'Dollars paid per $1.00 of credit, where a public source states it' },
      { key: 'st', label: 'Status', tip: '“Not yet verified” rows keep no number until a public source states one' },
      { key: 'when', label: 'Source', href: function (r) { return r.url; } }, { key: 'note', label: 'Notes' }
    ], rows, { noun: 'markets', placeholder: 'Credit' }) + '<p class="note">' + esc(meta.methodology || '') + '</p>';
  }

  function creditCards() {
    return '<ul class="eq-credits">' + CREDITS.map(function (c) {
      return '<li><p class="eq-credit-name">' + esc(c.credit) + ' <span class="note">' + esc(c.statute) + '</span></p><dl>' +
        '<dt>Term and timing</dt><dd>' + esc(c.stream) + '</dd><dt>Can it be sold?</dt><dd>' + esc(c.transfer) + '</dd>' +
        '<dt>Tax treatment</dt><dd>' + esc(c.taxTreatment) + '</dd><dt>Which way it pushes price</dt><dd>' + esc(c.direction) + '</dd></dl></li>';
    }).join('') + '</ul><p class="source-line"><span>Source</span> Internal Revenue Code ' +
      IRC.map(function (s) { return '<a href="https://www.law.cornell.edu/uscode/text/26/' + s + '">§' + s + '</a>'; }).join(', ') +
      ', read 2026-10-23. “Which way it pushes price” is the site’s reading, not a published estimate.</p>';
  }

  function lawWatch(law) {
    var m = law.meta || {}, e = law.entries.filter(function (x) { return WATCH_SCOPES.indexOf(x.scope) > -1; });
    var tally = Object.keys(STATUS).map(function (k) { var n = e.filter(function (x) { return x.status === k; }).length; return n ? n + ' ' + STATUS[k].toLowerCase() : ''; }).filter(Boolean).join(', ');
    return '<p>' + e.length + ' federal and Colorado laws and rules that move credit prices: ' + esc(tally) + '. Checked ' + esc(m.last_verified || '') + '; next review by ' + esc(m.review_by || '') + '.</p>' +
      '<ul class="eq-law">' + e.map(function (x) {
        var dates = [x.effective_date ? 'Effective ' + x.effective_date : '', x.sunset_date ? 'Ends ' + x.sunset_date : '', 'Checked ' + (x.last_verified || m.last_verified)].filter(Boolean).join(' · ');
        return '<li><div class="eq-law-top">' + status(x.status) + '<span class="scope-tag">' + esc(SCOPE[x.scope] || x.scope) + '</span></div><h3>' + esc(x.title) + '</h3>' +
          '<p>' + esc(x.pricing_impact || '') + '</p><p class="note">' + esc(dates) + (safe(x.source_url) ? ' · ' + link('Official source', x.source_url) : '') + '</p>' +
          (x.source_note ? '<details class="counted"><summary>What the source says</summary><p>' + esc(x.source_note) + '</p></details>' : '') + '</li>';
      }).join('') + '</ul><p class="note">How each change may move prices is the site’s reading, reviewed quarterly. The ROAD to Housing Act timeline and Colorado policy watch are on <a href="#/legislation">Legislation</a>.</p>';
  }

  function view() {
    var s = UI.load(FILES);
    var crumbs = T.trail('deal', 'Tax credit equity markets');
    if (!s.data) return T.head({ kind: 'data', crumbs: crumbs, title: 'Tax credit equity markets' }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var h = s.data.hist, b = s.data.bench, p = b.pricing, q = h.quarterly, now = q[q.length - 1], first = q[0];
    var co = p.by_state.CO, nc = p.by_region.north_central, qap = b.state_qap_pricing, a = analysisFor(s.data);
    return T.head({
      kind: 'data', crumbs: crumbs, title: 'Tax credit equity markets',
      answer: 'Investors paid about ' + cents(now.nine) + ' for each dollar of 9% credit and ' + cents(now.four) + ' for 4% in ' + esc(now.quarter) + ', down from ' + cents(first.nine) + ' and ' + cents(first.four) + ' in ' + esc(first.quarter) + '.',
      meta: '<span class="scope-tag">Market context, not a quote</span> Novogradac splits 9% and 4% only nationally; for Colorado it gives one median for both. For a real deal, get a letter of intent from a syndicator.',
      facts: [
        { value: cents(now.nine), label: '9% credits, national, ' + now.quarter, source: 'Novogradac', href: h.meta.source_url },
        { value: cents(now.four), label: '4% credits, national, ' + now.quarter, source: 'Novogradac', href: h.meta.source_url },
        { value: cents(co.median_all_credits), label: 'Colorado median, all credits, ' + b.meta.vintage, source: 'Novogradac', href: p.regional_source_url },
        { value: cents(nc.median_all_credits), label: 'North Central region median, ' + b.meta.vintage, source: 'Novogradac', href: p.regional_source_url }
      ]
    }) +
      T.onThisPage([{ id: 'eq-tracks', title: 'What this page tracks' }, { id: 'eq-trend', title: 'Price history' }, { id: 'eq-drivers', title: 'What moves pricing' },
        { id: 'eq-where', title: 'Benchmarks' }, { id: 'eq-qap', title: 'State plans' }, { id: 'eq-transfer', title: 'Transfer prices' },
        { id: 'eq-how', title: 'How pricing works' }, { id: 'eq-law', title: 'Law watch' }, { id: 'eq-sources', title: 'Sources' }], true) +
      '<section id="eq-tracks" tabindex="-1" class="callout"><h2>What this page tracks</h2><p>What investors pay for tax credits, in one place: the national 9% and 4% history, what interest rates do and do not explain, Novogradac’s regional and Colorado figures, what state plans assume, prices for credits that can be sold outright, and the laws that move all of these.</p>' +
      '<p class="note">Use these figures as market anchors. A real deal’s price depends on the sponsor, the location, bank CRA demand, investor tax appetite, guarantees, insurance, recapture risk and how the deal is structured.</p></section>' +
      '<section id="eq-trend" tabindex="-1"><h2>LIHTC equity pricing history</h2>' + lineChart(q) +
      '<p>' + esc(p.national_avg.notes) + '</p>' +
      '<details class="counted"><summary>Every quarter as a table</summary>' +
      UI.table('eqq', 'National price per dollar of credit, by quarter', [{ key: 'quarter', label: 'Quarter' }, { key: 'nine', label: '9%', num: true, fmt: cents, tip: 'Average of the quarter’s three monthly 9% figures' }, { key: 'four', label: '4%', num: true, fmt: cents, tip: 'Average of the quarter’s three monthly 4% figures' }], q.slice().reverse(), { noun: 'quarters', placeholder: 'Year or quarter' }) +
      '</details>' + T.source(h.meta.source, h.meta.source_url, 'captured ' + h.meta.captured) +
      '<p>To see what a different price does to a project, change the equity price in the <a href="#/deal-calculator">Deal Calculator</a>. These figures are context for a project-specific quote.</p></section>' +
      '<section id="eq-drivers" tabindex="-1"><h2>What moves LIHTC pricing</h2>' +
      (a ? '<p>Monthly 9% and 4% prices set against the interest rates on the Economic Dashboard. Every figure here is worked out from the data files when the page opens.</p>' + findings(a) + driverCharts(a, s.data.fred) +
        '<h3>Each rate compared with pricing</h3>' + rateTable(a) + T.source('Worked out from Novogradac monthly pricing and FRED rate series', FILES_SRC.novo, 'pricing to ' + monthLabel(a.last) + (s.data.fred && s.data.fred.updated ? ', FRED updated ' + String(s.data.fred.updated).slice(0, 10) : '')) +
        '<p class="note">Pricing here is the average of Novogradac’s national 9% and 4% monthly figures. Rates are monthly averages of FRED’s daily and weekly series. A lead of 12 months compares each month’s price with the rate a year earlier. The 9%/4% series starts in September 2021, so it covers one rate cycle and one change in federal law, and Novogradac rounds to the cent, so moves of a cent are partly rounding. Nothing here is a forecast.</p>'
        : '<p class="callout">The comparison needs at least 24 months with both a 9% and a 4% price; the file has fewer.</p>') +
      '<h3>What the rate dashboard does not measure</h3><p>Equity pricing is what investors pay for credits, set by how much they want them against how many are on offer. The rates above cover only the investors’ cost of money. These inputs are not on the site yet:</p>' +
      '<ul class="eq-gaps">' + NOT_MEASURED.map(function (n) { return '<li><strong>' + esc(n[0]) + '</strong> ' + esc(n[1]) + '</li>'; }).join('') + '</ul>' +
      // The live page's list of what the rates leave out, word for word (article-pricing.html; QA 11-09).
      '<h3>What this page does not measure</h3><p>Equity pricing is what investors pay for credits, set by how much they want them against how many are on offer. The rates above cover only the investors’ cost of money. These inputs are not on the site yet:</p><ul>' +
        [['Credit supply.', 'Annual 9% allocations and private activity bond volume for 4% deals. The 2025 federal law raised 9% allocations and lowered the 4% bond test.'],
         ['Bank CRA demand.', 'Banks are the main buyers, and they pay more in markets where they need Community Reinvestment Act credit.'],
         ['Investor tax capacity.', 'Bank and corporate earnings, since credits only help an investor that owes tax.'],
         ['Investor yields.', 'The after-tax return investors accept, which syndicators report and is the mirror image of price.'],
         ['Corporate bond spreads beyond Baa.', 'The return investors could earn elsewhere.'],
         ['The corporate tax rate.', 'It was 21% throughout this period, so it cannot explain these years, but a change would move pricing.']].map(function (x) { return '<li><strong>' + esc(x[0]) + '</strong> ' + esc(x[1]) + '</li>'; }).join('') + '</ul>' +
      '<h3>What markets expect</h3>' + marketCards() + '</section>' +
      '<section id="eq-where" tabindex="-1"><h2>Novogradac LIHTC benchmarks</h2><p>National, regional and Colorado prices per dollar of credit. ' + esc(co.notes || '') + '</p>' + benchmarks(b) + '</section>' +
      '<section id="eq-qap" tabindex="-1"><h2>What state QAPs assume</h2><p class="note">A QAP (qualified allocation plan) is each state’s rulebook for awarding credits.</p><p>' + esc(qap.summary) + '</p>' + qapTable(qap) + '</section>' +
      '<section id="eq-transfer" tabindex="-1"><h2>Transfer and syndication snapshot</h2><p>Prices for credits that can be sold for cash, and for credits that still sell through investor partnerships. A row keeps a number only where a public source states it; the rest say “Not yet verified”.</p>' + transferTable(s.data.transfer) + '</section>' +
      '<section id="eq-how" tabindex="-1"><h2>How credit pricing works</h2><p>Why housing, historic, New Markets and clean-energy credits do not sell at the same discount.</p>' +
      '<p>Housing (LIHTC), historic (HTC) and New Markets (NMTC) credits generally need an ownership, partnership or allocation structure. Clean-energy credits are different: under IRC §6418, eligible credits can be sold for cash, and §6417 lets eligible tax-exempt and government bodies take them as a direct payment. That is why clean-energy credit markets look closer to trading, while LIHTC, HTC and NMTC still price through syndication.</p>' +
      '<p>Pricing also reflects tax treatment. Section 6418 sale proceeds are not counted as the seller’s income, and the buyer’s discount is not taxed as income. Credits that cannot be sold build the investor’s return into the partnership: depreciation, compliance risk and exit terms.</p>' + creditCards() + '</section>' +
      '<section id="eq-law" tabindex="-1"><h2>Tax credit legislation watch</h2>' + lawWatch(s.data.law) + '</section>' +
      '<section id="eq-sources" tabindex="-1"><h2>Data sources and methodology</h2><ul>' +
      '<li><strong>LIHTC benchmarks:</strong> ' + link('Novogradac equity pricing', h.meta.source_url) + ', captured by hand once a quarter and used as market context per dollar of credit. ' + esc(b.meta.methodology) + '</li>' +
      '<li><strong>Interest rates:</strong> ' + link('FRED, Federal Reserve Bank of St. Louis', 'https://fred.stlouisfed.org/') + ' daily and weekly series, averaged by month.</li>' +
      '<li><strong>Transfer pricing:</strong> ' + link('Crux’s public transfer-credit pricing reports', 'https://www.crux.com/blog/transferable-tax-credits') + ' for verified clean-energy ranges; official program pages for markets left as not yet verified.</li>' +
      '<li><strong>Legislation watch:</strong> official sources only: Congress.gov, GovInfo, IRS guidance, the Federal Register, the Colorado General Assembly, and the U.S. Department of Energy and EPA program pages.</li>' +
      '<li><strong>Market odds:</strong> ' + link('Polymarket', 'https://polymarket.com') + ', as cached for the Economic Dashboard.</li></ul>' +
      '<p class="callout"><strong>Not advice.</strong> This page is a public-data reference. Do not use it as transaction-level pricing, tax, legal or investment advice.</p></section>' +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Test a LIHTC deal at this price →' }, { href: '#/guide/cra-pricing', label: 'CRA and pricing', secondary: true }]);
  }

  Shell.views['equity-pricing'] = view;
  global.LabEquity = { view: view, FILES: FILES, MARKET_FILES: MARKET_FILES, STATS: STATS, CREDITS: CREDITS, RATE_SERIES: RATE_SERIES, WATCH_SCOPES: WATCH_SCOPES };
})(window);
