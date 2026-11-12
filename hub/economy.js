// Economic dashboard (#/places/economy): what money costs, what it costs to build here, whether the Colorado
// pipeline is growing and whether demand is holding, read from the public site's own data files. Colorado series
// come first; the national series the live economic-dashboard.html charts sit in a folded "United States" list
// under each section, labelled national and never compared with Colorado. Every section of the live page has a
// home here (qa/content-parity.json).
//
// Files (all Housing-Analytics data/, pinned in wave 0): fred-data.json, market/co-construction-labor-cost.json,
// market/aamd-denver-vacancy.json, market/colorado-foreclosure-performance.json, hmda/co-state-trends.json,
// census-acs-state.json, kalshi/prediction-market.json, polymarket-data.json, polymarket-curated.json and
// policy/policy-timeline.json. Changes from a year earlier use the live page's rule (yearAgoIndex): the last
// reading on or before the same date a year back, so a month FRED never published is not miscounted.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var LIVE = 'https://cohoanalytics.com/';
  var LIVE_PAGE = LIVE + 'economic-dashboard.html';
  var FILES = {
    fred: 'data/fred-data.json', labor: 'data/market/co-construction-labor-cost.json', aamd: 'data/market/aamd-denver-vacancy.json',
    fc: 'data/market/colorado-foreclosure-performance.json', hmda: 'data/hmda/co-state-trends.json', census: 'data/census-acs-state.json',
    kalshi: 'data/kalshi/prediction-market.json', poly: 'data/polymarket-data.json', curated: 'data/polymarket-curated.json',
    timeline: 'data/policy/policy-timeline.json'
  };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // The national series of the live page, by section, with its titles corrected where they named the wrong
  // series (see the PR notes): units "thousands" and "$M" read as the live cards do.
  var US = {
    money: [
      ['DGS10', '10-year Treasury yield', 'pct', '', 'Permanent loans and tax-exempt bonds price off it.'],
      ['DGS2', '2-year Treasury yield', 'pct', '', 'Moves with what traders expect the Fed to do next.'],
      ['DFF', 'Effective federal funds rate', 'pct', '', 'The Federal Reserve’s policy rate, daily.'],
      ['MORTGAGE30US', '30-year fixed mortgage rate', 'pct', '', 'Freddie Mac weekly survey; sets homebuyer payments.'],
      ['SOFR', 'SOFR (Secured Overnight Financing Rate)', 'pct', '', 'Most construction loans float on it.'],
      ['BAA10Y', 'Moody’s Baa minus 10-year Treasury spread', 'pct', '', 'Extra yield lenders ask over Treasuries; wider means tighter credit.'],
      ['T10Y2Y', 'Yield curve (10-year minus 2-year)', 'pct', '', 'Below zero has come before most recessions.']
    ],
    build: [
      ['WPUIP231120', 'PPI: Net inputs to multifamily residential construction', 'index', '', 'Prices of the goods and services an apartment building uses.'],
      ['WPUIP2310001', 'PPI: Net inputs to new construction, goods', 'index', '', 'All new construction, goods only.'],
      ['WPUIP2312001', 'PPI: Net inputs to nonresidential construction, goods', 'index', '', 'Commercial and public building goods.'],
      ['WPUSI012011', 'PPI: Construction materials (special index)', 'index', '', 'Materials only, all construction.'],
      ['PCU331110331110', 'PPI: Iron and steel mills', 'index', '', 'Rebar, structural steel and framing.'],
      ['WPU0811', 'PPI: Lumber (lumber and wood products)', 'index', '', 'Framing lumber.'],
      ['PCU327320327320', 'PPI: Ready-mix concrete', 'index', '', 'Foundations and slabs.'],
      ['PCU327310327310', 'PPI: Cement manufacturing', 'index', '', 'Cement, the binder in concrete and block.'],
      ['CES2000000008', 'Construction average hourly earnings (production and nonsupervisory workers)', 'usd', '', 'National trades pay.'],
      ['ECIALLCIV', 'Employment cost index (total compensation)', 'index', '', 'Wages and benefits, all civilian workers, quarterly.']
    ],
    pipeline: [
      ['HOUST', 'Housing starts', 'int', 'thousands', 'Homes started, yearly rate.'],
      ['PERMIT', 'Building permits', 'int', 'thousands', 'Homes permitted, yearly rate.'],
      ['HOUST5F', 'Multifamily starts (5+ units)', 'int', 'thousands', 'Apartment buildings started, yearly rate.'],
      ['PERMIT5', 'Multifamily permits (5+ units)', 'int', 'thousands', 'Apartment buildings permitted, yearly rate.'],
      ['UNDCONTSA', 'Units under construction', 'int', 'thousands', 'All homes being built now.'],
      ['COMPUTSA', 'U.S. housing completions (all homes)', 'int', 'thousands', 'Homes finished, yearly rate.'],
      ['HSN1F', 'New one-family houses sold', 'int', 'thousands', 'Turns first in a housing cycle.'],
      ['TLRESCONS', 'Construction spending: residential', 'int', '$M', 'Moves with the cycle, yearly rate.'],
      ['USCONS', 'Construction employment, national', 'int', 'thousands', 'Turns last in a housing cycle.']
    ],
    demand: [
      ['UNRATE', 'Unemployment rate', 'pct', '', 'United States, seasonally adjusted.'],
      ['PAYEMS', 'Nonfarm payrolls', 'int', 'thousands', 'Jobs in the United States.'],
      ['CIVPART', 'Labor force participation', 'pct', '', 'Adults working or looking for work.'],
      ['CES0500000003', 'Average hourly earnings', 'usd', '', 'All private workers.'],
      ['JTSJOL', 'Job openings (JOLTS)', 'int', 'thousands', 'Open jobs at month end.'],
      ['ICSA', 'Initial jobless claims', 'int', '', 'New unemployment claims each week.'],
      ['CPIAUCSL', 'CPI: All items', 'index', '', 'Consumer prices, the main inflation measure.'],
      ['CUUR0000SAH1', 'CPI: Shelter', 'index', '', 'Rent and owners’ housing costs.'],
      ['RRVRUSQ156N', 'Rental vacancy rate', 'pct', '', 'Share of rental homes empty, quarterly.'],
      ['RHORUSQ156N', 'Homeownership rate', 'pct', '', 'Share of households that own, quarterly.'],
      ['CSUSHPISA', 'Case-Shiller home price index', 'index', '', 'Repeat sales of the same homes.'],
      ['MSPUS', 'Median sales price of houses', 'usd', '', 'New houses sold, quarterly.']
    ]
  };
  var METROS = [
    ['COSTHPI', 'Colorado', null],
    ['ATNHPIUS19740Q', 'Denver metro', 'MEDDAYONMAR19740'],
    ['ATNHPIUS17820Q', 'Colorado Springs metro', 'MEDDAYONMAR17820'],
    ['ATNHPIUS22660Q', 'Fort Collins metro', 'MEDDAYONMAR22660'],
    ['ATNHPIUS24300Q', 'Grand Junction metro', 'MEDDAYONMAR24300']
  ];

  /* ── Series helpers ── */
  // The date COHO last saved the FRED file, for every FRED source line (format rule, 12 Nov: a dated source on every figure).
  function saved(fred) { var u = String(fred && fred.updated || '').slice(0, 10); return u ? ', saved ' + u : ''; }
  function fredLink(id) { return 'https://fred.stlouisfed.org/series/' + encodeURIComponent(id); }
  function link(text, href) { return /^https?:\/\//.test(String(href || '')) ? '<a href="' + esc(href) + '">' + esc(text) + '</a>' : esc(text); }
  // A series' readings, oldest first: [{ date, value }]. A series the fetcher marked unavailable reads as empty.
  function obs(fred, id) {
    var e = fred.series && fred.series[id];
    if (!e || !e.observations || (e.status && e.status !== 'ok')) return [];
    return e.observations.filter(function (o) { return o && o.date && o.value !== '.' && o.value != null && o.value !== ''; })
      .map(function (o) { return { date: o.date, value: Number(o.value) }; }).filter(function (o) { return isFinite(o.value); });
  }
  function freq(fred, id) { var e = fred.series[id]; return String(e && e.frequency || ''); }
  function dt(iso) { var d = String(iso).split('-'); return new Date(+d[0], +d[1] - 1, +(d[2] || 1)); }
  // The live page's rule: the last reading on or before the same day a year earlier.
  function yearAgoIndex(s, end) {
    end = end == null ? s.length - 1 : end;
    if (end < 1) return -1;
    var t = (+s[end].date.slice(0, 4) - 1) + s[end].date.slice(4, 10);
    for (var i = end - 1; i >= 0; i--) if (s[i].date <= t) return i;
    return -1;
  }
  function backIndex(s, months) {
    var d = dt(s[s.length - 1].date); d.setMonth(d.getMonth() - months);
    var t = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    for (var i = s.length - 2; i >= 0; i--) if (s[i].date <= t) return i;
    return -1;
  }
  function when(iso, f) {
    var d = dt(iso);
    if (/quarter/i.test(f || '')) return 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();
    if (/annual/i.test(f || '')) return String(d.getFullYear());
    if (/daily|weekly/i.test(f || '')) return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    return MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function pct(v, dp) { return v == null || !isFinite(v) ? '—' : v.toFixed(dp == null ? 1 : dp) + '%'; }
  function signed(v, dp, unit) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp == null ? 1 : dp) + (unit == null ? '%' : unit); }
  function fmtValue(v, fmt, units) {
    if (units === 'thousands') return num(v) + ' thousand';
    if (units === '$M') return '$' + num(v) + ' million';
    if (fmt === 'pct') return v.toFixed(2).replace(/\.00$/, '') + '%';
    if (fmt === 'usd') return '$' + v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
    if (fmt === 'int') return num(v);
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  // The change shown under a reading: points for a rate, per cent for anything else; "on a year" when a reading
  // a year back exists, otherwise against the reading before.
  function change(s, fmt) {
    if (s.length < 2) return null;
    var yi = yearAgoIndex(s), i = yi > -1 ? yi : s.length - 2, last = s[s.length - 1].value, base = s[i].value;
    var d = fmt === 'pct' ? last - base : (base ? (last / base - 1) * 100 : NaN);
    if (!isFinite(d)) return null;
    return { d: d, text: fmt === 'pct' ? signed(d, 2, ' pts') : signed(d), span: yi > -1 ? 'on a year' : 'on the reading before' };
  }
  function yoyPct(s) { var i = yearAgoIndex(s); return i < 0 || !s[i].value ? NaN : (s[s.length - 1].value / s[i].value - 1) * 100; }
  function pts(s, since) { return s.filter(function (o) { return !since || o.date >= since; }).map(function (o) { return [dt(o.date), o.value, o.date]; }); }
  // Daily and weekly readings drawn as each month's last one, so a long line stays light.
  function monthly(p) {
    var out = [], seen = {};
    for (var i = p.length - 1; i >= 0; i--) { var k = p[i][0].getFullYear() * 12 + p[i][0].getMonth(); if (!seen[k]) { seen[k] = 1; out.unshift(p[i]); } }
    return out;
  }

  /* ── A small chart card: one series, its latest reading, its change and its last 120 readings ── */
  function spark(values, label) {
    var W = 300, H = 84, lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), span = (hi - lo) || 1;
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + (4 + i / Math.max(1, values.length - 1) * (W - 8)).toFixed(1) + ' ' + (6 + (1 - (v - lo) / span) * (H - 12)).toFixed(1); }).join('');
    var zero = lo < 0 && hi > 0 ? '<line x1="4" x2="' + (W - 4) + '" y1="' + (6 + (1 - (0 - lo) / span) * (H - 12)).toFixed(1) + '" y2="' + (6 + (1 - (0 - lo) / span) * (H - 12)).toFixed(1) + '" stroke="var(--grey)" stroke-dasharray="4,3"/>' : '';
    return '<svg class="econ-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' + zero +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.25" vector-effect="non-scaling-stroke"/></svg>';
  }
  // The two ends of a sparkline, value and date, so a line with no scale still reads (Gemini round 2, question 8;
  // big visual pass 11-06).
  function ends(a, b) {
    return '<p class="econ-ends"><span><b>' + esc(a[0]) + '</b> ' + esc(a[1]) + '</span><span><b>' + esc(b[0]) + '</b> ' + esc(b[1]) + '</span></p>';
  }
  function card(fred, spec, geo) {
    var id = spec[0], title = spec[1], fmt = spec[2], units = spec[3], what = spec[4];
    var s = obs(fred, id), f = freq(fred, id);
    var head = '<h4><a href="' + esc(fredLink(id)) + '">' + esc(title) + '</a></h4>';
    if (!s.length) return '<li class="econ-card econ-off">' + head + '<p class="econ-v">Not in this copy of the data</p><p class="econ-what">' + esc(what) + ' FRED series ' + esc(id) + '.</p></li>';
    var last = s[s.length - 1], c = change(s, fmt), win = s.slice(-120);
    return '<li class="econ-card' + (geo === 'co' ? ' econ-co' : '') + '">' + head +
      '<p class="econ-v">' + esc(fmtValue(last.value, fmt, units)) + '</p>' +
      '<p class="econ-when">' + esc(when(last.date, f)) + (c ? ' · <span class="econ-d ' + (c.d > 0 ? 'up' : c.d < 0 ? 'down' : '') + '">' + esc(c.text) + '</span> ' + esc(c.span) : '') + '</p>' +
      spark(win.map(function (o) { return o.value; }), title + ': ' + win.length + ' readings, ' + when(win[0].date, f) + ' to ' + when(last.date, f) + ', latest ' + fmtValue(last.value, fmt, units)) +
      ends([fmtValue(win[0].value, fmt, units), when(win[0].date, f)], [fmtValue(last.value, fmt, units), when(last.date, f)]) +
      '<p class="econ-what">' + esc(what) + '</p></li>';
  }
  function usFold(fred, key, title, take) {
    var list = US[key];
    return '<details class="fold econ-us"><summary><span class="fold-title">' + esc(title) + ' (' + list.length + ' national series)</span>' +
      '<span class="fold-take">' + esc(take) + '</span></summary><div class="panel"><ul class="econ-cards">' +
      list.map(function (x) { return card(fred, x, 'us'); }).join('') + '</ul>' +
      '<p class="note">United States figures, shown for context and not compared with Colorado. Each line is the latest 120 readings: about ten years of a monthly series, two years of a weekly one, six months of a daily one.</p>' +
      '<p class="metric-source">' + link('Federal Reserve Bank of St. Louis (FRED)', 'https://fred.stlouisfed.org/') + '; each title links to its series.</p></div></details>';
  }
  function tiles(list) {
    return '<ul class="econ-tiles">' + list.filter(Boolean).map(function (t) {
      return '<li><span class="econ-tile-v">' + esc(t[0]) + '</span><span class="econ-tile-l">' + esc(t[1]) + '</span>' + (t[2] ? '<span class="econ-tile-s">' + t[2] + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function section(id, title, read, body) {
    return '<section class="econ-sec" id="' + id + '" tabindex="-1"><h2>' + esc(title) + '</h2>' + (read ? '<p class="econ-read">' + esc(read) + '</p>' : '') + body + '</section>';
  }
  function moved(d, up, down, flat) { return Math.abs(d) < 0.05 ? flat : d > 0 ? up : down; }

  /* ── 1. What money costs ── */
  function money(fred, since) {
    var t10 = obs(fred, 'DGS10'), m30 = obs(fred, 'MORTGAGE30US'), sofr = obs(fred, 'SOFR');
    if (!t10.length) return section('econ-money', 'What money costs', '', '<p class="callout">The rate series are not in this copy of the data.</p>');
    var l = t10[t10.length - 1].value, i3 = backIndex(t10, 3), i12 = yearAgoIndex(t10);
    var d3 = i3 > -1 ? l - t10[i3].value : NaN, d12 = i12 > -1 ? l - t10[i12].value : NaN;
    var read = 'The 10-year Treasury, which prices most permanent loans, is ' + pct(l, 2) + ': ' +
      (isFinite(d3) ? moved(d3, 'up ', 'down ', 'flat, ') + (Math.abs(d3) < 0.05 ? '' : Math.abs(d3).toFixed(2) + ' points ') + 'in three months' : '') +
      (isFinite(d12) ? ' and ' + moved(d12, 'up ', 'down ', 'flat ') + (Math.abs(d12) < 0.05 ? '' : Math.abs(d12).toFixed(2) + ' points ') + 'on a year.' : '.') +
      (d12 > 0.05 ? ' The same rents now carry a smaller loan.' : d12 < -0.05 ? ' The same rents now carry a larger loan.' : '');
    var chart = global.LabViz.timeLines({
      title: 'Borrowing costs since ' + since.slice(0, 4),
      answer: m30.length ? 'The 30-year mortgage is ' + pct(m30[m30.length - 1].value, 2) + ' (' + when(m30[m30.length - 1].date, 'weekly') + '); SOFR, the construction-loan base, is ' + (sofr.length ? pct(sofr[sofr.length - 1].value, 2) : 'not in the file') + '.' : '',
      series: [
        { label: '30-year mortgage', color: 'var(--rust)', points: monthly(pts(m30, since)) },
        { label: '10-year Treasury', color: 'var(--c-blue)', points: monthly(pts(t10, since)) },
        { label: '2-year Treasury', color: 'var(--c-purple)', dash: true, points: monthly(pts(obs(fred, 'DGS2'), since)) },
        { label: 'SOFR', color: 'var(--c-green)', points: monthly(pts(sofr, since)) },
        { label: 'Federal funds', color: 'var(--muted)', dash: true, points: monthly(pts(obs(fred, 'DFF'), since)) }
      ], fmt: function (v) { return v.toFixed(1) + '%'; },
      note: 'Each line is the last reading of each month. These are national rates: a Colorado deal borrows at them.',
      source: link('Freddie Mac', fredLink('MORTGAGE30US')) + ', ' + link('U.S. Treasury', fredLink('DGS10')) + ', ' + link('New York Fed', fredLink('SOFR')) + ' and ' + link('Federal Reserve', fredLink('DFF')) + ', via FRED' + saved(fred)
    });
    return section('econ-money', 'What money costs', read, chart +
      '<p>Equity prices move with rates too: see <a href="#/equity-pricing">tax credit equity prices</a>.</p>' +
      usFold(fred, 'money', 'Every rate and spread', 'Treasuries, the Fed’s rate, SOFR, mortgages, the credit spread and the yield curve.'));
  }

  /* ── 2. What it costs to build in Colorado ── */
  function build(fred, labor) {
    var cocons = obs(fred, 'COCONS'), sum = labor && labor.summary, wage = labor && labor.monthly && labor.monthly.SMU08000002000000003;
    var lastWage = wage && wage.observations[wage.observations.length - 1];
    var read = sum && sum.text ? sum.text : '';
    var hist = labor && Array.isArray(labor.history) ? labor.history.filter(function (h) { return h.period >= '2019-01'; }) : [];
    var ser = function (k) { return hist.filter(function (h) { return h[k] != null; }).map(function (h) { return [dt(h.period + '-01'), h[k], h.period]; }); };
    var chart = hist.length ? global.LabViz.timeLines({
      title: 'Colorado construction pay and building material prices, change on a year',
      answer: sum ? 'In ' + MONTH[+sum.period.slice(5, 7) - 1] + ' ' + sum.period.slice(0, 4) + ' Colorado construction pay was ' + signed(sum.laborWageYoyPct) + ' on a year and apartment building inputs ' + signed(sum.materialsYoyPct) + '.' : '',
      series: [
        { label: 'Colorado construction hourly pay', color: 'var(--c-green)', points: ser('laborWageYoyPct') },
        { label: 'Colorado construction jobs', color: 'var(--c-blue)', dash: true, points: ser('employmentYoyPct') },
        { label: 'Apartment building inputs (U.S. price index)', color: 'var(--rust)', points: ser('materialsYoyPct') }
      ], fmt: function (v) { return (v > 0 ? '+' : '') + Math.round(v) + '%'; },
      note: 'Pay and jobs are Colorado (BLS, not seasonally adjusted; the latest months are preliminary). Material prices are U.S.-wide: no state price index exists.',
      source: link('BLS State and Metro Employment', 'https://www.bls.gov/sae/') + ' and ' + link('BLS Producer Price Index', fredLink('WPUIP231120')) + ', as gathered by COHO' + (labor && labor.generatedAt ? ', built ' + String(labor.generatedAt).slice(0, 10) : saved(fred))
    }) : '';
    var t = tiles([
      lastWage ? ['$' + lastWage.value.toFixed(2), 'Colorado construction hourly pay, ' + MON[+lastWage.period.slice(5, 7) - 1] + ' ' + lastWage.period.slice(0, 4) + (lastWage.preliminary ? ' (preliminary)' : ''), link('BLS CES', 'https://www.bls.gov/sae/')] : null,
      cocons.length ? [num(cocons[cocons.length - 1].value * 1000), 'Colorado construction jobs, ' + when(cocons[cocons.length - 1].date) + ', ' + signed(yoyPct(cocons)) + ' on a year (seasonally adjusted)', link('BLS via FRED', fredLink('COCONS'))] : null,
      sum ? [signed(sum.materialsYoyPct), 'Apartment building input prices on a year (U.S.)', link('BLS PPI via FRED', fredLink('WPUIP231120'))] : null
    ]);
    return section('econ-build', 'What it costs to build in Colorado', read, t + chart +
      '<ul class="econ-cards econ-co-cards">' + card(fred, ['COCONS', 'Colorado construction jobs', 'int', 'thousands', 'All construction employees in Colorado, seasonally adjusted.'], 'co') + '</ul>' +
      '<p>Trade-by-trade Colorado wages and every material price are on <a href="#/places/costs">construction costs</a>.</p>' +
      usFold(fred, 'build', 'National price indexes and pay', 'Producer prices for building inputs, steel, lumber and concrete, plus national trades pay.'));
  }

  /* ── 3. Is the Colorado pipeline growing? ── */
  function pipeline(fred, since) {
    var p = obs(fred, 'COBPPRIV');
    if (!p.length) return section('econ-pipeline', 'Is the Colorado pipeline growing?', '', '<p class="callout">Colorado permits are not in this copy of the data.</p>' + usFold(fred, 'pipeline', 'National starts, permits and completions', ''));
    var last = p[p.length - 1], ly = +last.date.slice(0, 4), lm = +last.date.slice(5, 7), now = 0, prev = 0;
    p.forEach(function (o) { var y = +o.date.slice(0, 4), m = +o.date.slice(5, 7); if (m <= lm) { if (y === ly) now += o.value; if (y === ly - 1) prev += o.value; } });
    var ytd = prev ? (now / prev - 1) * 100 : NaN, yi = yearAgoIndex(p), mo = yi > -1 ? (last.value / p[yi].value - 1) * 100 : NaN;
    var read = 'Colorado permitted ' + num(now) + ' homes from January to ' + MONTH[lm - 1] + ' ' + ly + ', ' + (isFinite(ytd) ? signed(ytd) + ' on the same months of ' + (ly - 1) : '') + '. ' +
      (ytd < -2 ? 'Fewer new homes means less competing lease-up, and a thinner contractor bench.' : ytd > 2 ? 'More new homes means more competing lease-up for a deal opening in two or three years.' : 'The pace is about level with last year.');
    var chart = global.LabViz.timeLines({
      title: 'Homes permitted in Colorado each month',
      answer: num(last.value) + ' in ' + MONTH[lm - 1] + ' ' + ly + (isFinite(mo) ? ', ' + signed(mo) + ' on ' + MONTH[lm - 1] + ' ' + (ly - 1) + '.' : '.'),
      series: [{ label: 'Homes permitted, all building types', color: 'var(--c-green)', points: pts(p, since) }], fmt: num,
      note: 'Monthly, not seasonally adjusted, so summers run high. County and town permits are in each place’s needs assessment.',
      source: link('Census Building Permits Survey, via FRED', fredLink('COBPPRIV')) + saved(fred)
    });
    return section('econ-pipeline', 'Is the Colorado pipeline growing?', read,
      tiles([[num(now), 'Colorado homes permitted, Jan–' + MON[lm - 1] + ' ' + ly, link('Census BPS via FRED', fredLink('COBPPRIV'))], [signed(ytd), 'Against the same months of ' + (ly - 1), link('Census BPS via FRED', fredLink('COBPPRIV'))]]) +
      chart + usFold(fred, 'pipeline', 'National starts, permits and completions', 'Starts, permits, homes under construction and finished, and the three housing-cycle readings.'));
  }

  /* ── 4. Is Colorado demand holding? ── */
  function demand(fred, aamd, fc, since) {
    var cour = obs(fred, 'COUR'), out = '';
    var jobs = cour.length ? global.LabViz.timeLines({
      title: 'Unemployment in Colorado',
      answer: 'Colorado’s unemployment rate is ' + pct(cour[cour.length - 1].value) + ' (' + when(cour[cour.length - 1].date) + ')' + (yearAgoIndex(cour) > -1 ? ', against ' + pct(cour[yearAgoIndex(cour)].value) + ' a year earlier.' : '.'),
      series: [{ label: 'Colorado', color: 'var(--pine)', points: pts(cour, since) }], fmt: function (v) { return v.toFixed(0) + '%'; },
      note: 'Seasonally adjusted. The U.S. rate is under the national readings below.', source: link('BLS Local Area Unemployment Statistics, via FRED', fredLink('COUR')) + saved(fred)
    }) : '';
    var m = aamd && aamd.metro, meta = aamd && aamd.meta || {};
    if (m) {
      var rows = Object.keys(aamd.counties || {}).map(function (k) { return { county: k, vac: aamd.counties[k].stabilized_vacancy_pct, rent: aamd.counties[k].average_rent }; });
      out += '<h3>Apartment vacancy in metro Denver</h3>' +
        '<p>Stabilized vacancy is ' + esc(pct(m.stabilized_vacancy_pct)) + ' in ' + esc(String(meta.vintage || '').replace(/^(\d{4})-(Q\d)$/, '$2 $1')) + ', against ' + esc(pct(m.stabilized_vacancy_prior_quarter_pct)) + ' the quarter before and ' + esc(pct(m.stabilized_vacancy_year_ago_pct)) + ' a year earlier. Counting buildings still leasing up, it is ' + esc(pct(m.overall_vacancy_pct)) + '.</p>' +
        tiles([[pct(m.stabilized_vacancy_pct), 'Stabilized vacancy', ''], [pct(m.overall_vacancy_pct), 'Including lease-up', ''], ['$' + num(m.average_rent), 'Average asking rent (' + '$' + num(m.average_rent_year_ago) + ' a year earlier)', ''],
          ['$' + num(m.average_concession), 'Average concession a month (' + pct(m.concession_pct_of_gross_rent) + ' of rent)', ''], [signed(m.effective_rent_yoy_pct), 'Rent after concessions, on a year', '']]) +
        UI.table('econ-aamd', 'Stabilized vacancy and average rent by county, metro Denver', [
          { key: 'county', label: 'County' }, { key: 'vac', label: 'Stabilized vacancy', num: true, fmt: function (v) { return pct(v); }, tip: 'Share of units empty in buildings past lease-up.' },
          { key: 'rent', label: 'Average rent', num: true, fmt: function (v) { return '$' + num(v); }, tip: 'Gross asking rent; does not take concessions off.' }], rows, { noun: 'counties', placeholder: 'County' }) +
        '<p class="metric-source">' + link(meta.source || 'Apartment Association of Metro Denver', meta.source_url) + ', ' + esc(String(meta.vintage || '').replace(/^(\d{4})-(Q\d)$/, '$2 $1')) + '. Next report expected ' + esc(String(meta.next_expected_update || '').replace(/^(\d{4})-(Q\d)$/, '$2 $1')) + '.</p>';
    }
    var act = obs(fred, 'ACTLISCOUCO'), cut = obs(fred, 'PRIREDCOUCO');
    if (act.length) {
      out += global.LabViz.timeLines({
        title: 'Colorado homes for sale and price cuts',
        answer: num(act[act.length - 1].value) + ' homes listed in ' + when(act[act.length - 1].date) + ' (' + signed(yoyPct(act)) + ' on a year)' + (cut.length ? ', ' + num(cut[cut.length - 1].value) + ' of them with a price cut.' : '.'),
        series: [{ label: 'Active listings', color: 'var(--c-blue)', points: pts(act, since) }, { label: 'Listings with a price cut', color: 'var(--rust)', dash: true, points: pts(cut, since) }], fmt: num,
        note: 'More listings and more cuts mean a softer for-sale market: easier for buyers, slower for a for-sale project.',
        source: link('Realtor.com, via FRED', fredLink('ACTLISCOUCO')) + saved(fred)
      });
    }
    var hpRows = METROS.map(function (x) {
      var s = obs(fred, x[0]); if (!s.length) return null;
      var dm = x[2] ? obs(fred, x[2]) : [], di = dm.length ? yearAgoIndex(dm) : -1;
      return { area: x[1], idx: s[s.length - 1].value, q: when(s[s.length - 1].date, 'quarterly'), yoy: Math.round(yoyPct(s) * 10) / 10, dom: dm.length ? dm[dm.length - 1].value : null, domY: di > -1 ? dm[di].value : null, id: x[0] };
    }).filter(Boolean);
    if (hpRows.length) {
      var up = hpRows.slice(1).sort(function (a, b) { return b.yoy - a.yoy; });
      out += '<h3>Home prices by metro</h3><p>Over the last year, ' + esc(up.map(function (r) { return r.area.replace(' metro', '') + ' ' + signed(r.yoy); }).join(', ')) + '; Colorado as a whole ' + esc(signed(hpRows[0].yoy)) + '. Days on market are the median for homes listed that month.</p>' +
        UI.table('econ-hpi', 'House price index and days on market, Colorado and four metros', [
          { key: 'area', label: 'Area', href: function (r) { return fredLink(r.id); } },
          { key: 'yoy', label: 'Price change on a year', num: true, fmt: function (v) { return signed(v); }, tip: 'FHFA all-transactions house price index against the same quarter a year earlier.' },
          { key: 'q', label: 'Quarter' },
          { key: 'dom', label: 'Days on market', num: true, tip: 'Realtor.com median days on market, latest month.' },
          { key: 'domY', label: 'A year earlier', num: true }], hpRows, { noun: 'areas', placeholder: 'Area' }) +
        '<p class="metric-source">' + link('FHFA house price index', 'https://www.fhfa.gov/data/hpi') + ' and ' + link('Realtor.com', fredLink('MEDDAYONMAR19740')) + ', via FRED' + saved(fred) + '.</p>';
    }
    if (fc && fc.series) {
      var fs = function (k) { var s = fc.series[k]; return s ? s.points.filter(function (x) { return !x.suppressed && x.value_pct != null && x.year >= 2015; }).map(function (x) { return [new Date(x.year, (x.quarter - 1) * 3, 1), x.value_pct, x.period]; }) : []; };
      var sd = fs('serious_delinquency_pct'), ed = fs('early_delinquency_pct'), fp = fs('foreclosure_process_pct');
      out += global.LabViz.timeLines({
        title: 'Colorado mortgages behind on payments',
        answer: sd.length ? pct(ed[ed.length - 1][1]) + ' of Colorado mortgages were 30 to 89 days late in ' + sd[sd.length - 1][2].replace(/^(\d{4})(Q\d)$/, '$2 $1') + ', ' + pct(sd[sd.length - 1][1]) + ' were 90 days or more and ' + pct(fp[fp.length - 1][1]) + ' were in foreclosure.' : '',
        series: [{ label: '30–89 days late', color: 'var(--c-amber)', points: ed }, { label: '90 days or more', color: 'var(--rust)', points: sd }, { label: 'In foreclosure', color: 'var(--pine)', dash: true, points: fp }],
        fmt: function (v) { return v.toFixed(1) + '%'; }, note: 'Share of active mortgages, statewide, quarterly. Rising late payments come before foreclosures and soften the for-sale market.',
        source: link(fc.meta.source, fc.meta.source_landing_url) + ', data through ' + esc(fc.meta.data_through)
      });
    }
    var read = cour.length && m ? 'Colorado unemployment is ' + pct(cour[cour.length - 1].value) + ' and metro Denver apartments are ' + pct(m.stabilized_vacancy_pct) + ' vacant once leased up, with concessions worth ' + pct(m.concession_pct_of_gross_rent) + ' of rent: renters are there, but owners are paying to keep them.' : '';
    // Folds shut behind its title and the one-line reading (paul, 10 Nov: phone length).
    var body = jobs + out + usFold(fred, 'demand', 'National jobs, prices and housing', 'U.S. unemployment, payrolls, pay, openings, claims, consumer prices, vacancy, ownership and home prices.');
    if (global.LabTpl && global.LabTpl.fold) return '<section class="econ-sec" id="econ-demand" tabindex="-1">' + global.LabTpl.fold(esc('Is Colorado demand holding?'), esc(read || 'Jobs, unemployment, apartment vacancy and late mortgage payments in Colorado.'), body, { id: 'econ-demand-h' }) + '</section>';
    return section('econ-demand', 'Is Colorado demand holding?', read, body);
  }

  /* ── 5. Census snapshot (Colorado) ── */
  function census(c) {
    var r = c && (c.data || []).filter(function (x) { return x.state_fips === '08'; })[0];
    if (!r) return section('econ-census', 'Census snapshot', '', '<p class="callout">The Census state file did not load.</p>');
    var renters = r.occupied_housing_units ? r.renter_occupied / r.occupied_housing_units * 100 : null;
    var built = r.housing_units_year_built_total ? r.built_2020_or_later / r.housing_units_year_built_total * 100 : null;
    var src = link('Census ACS ' + (r.year - 4) + '–' + r.year + ' 5-year', 'https://data.census.gov/profile/Colorado?g=040XX00US08');
    return section('econ-census', 'Census snapshot', 'The households every rate and cost on this page is tested against: Colorado, ACS ' + (r.year - 4) + '–' + r.year + '.',
      tiles([[num(r.population_total), 'People', src], ['$' + num(r.median_household_income), 'Median household income', src], ['$' + num(r.median_gross_rent), 'Median gross rent', src],
        ['$' + num(r.median_home_value), 'Median home value (lags the market)', src], [pct(renters), 'Households that rent', src], [pct(built), 'Homes built 2020 or later', src]]) +
      '<p>County, city and town figures are in each place’s <a href="#/places">needs assessment</a> and in <a href="#/places/county-costs">housing costs by county</a>.</p>' +
      '<p class="metric-source">' + link('U.S. Census Bureau API, ACS 5-year', 'https://www.census.gov/data/developers/data-sets/acs-5year.html') + ' (tables B01001, B19013, B25064, B25077, B25003, B25034), pulled ' + esc(String(c.meta.pulled_at_utc || '').slice(0, 10)) + '.</p>');
  }

  /* ── 6. Mortgage credit access (HMDA) ── */
  function credit(h) {
    if (!h || !h.years) return section('econ-credit', 'Mortgage credit access: statewide trends', '', '<p class="callout">The HMDA file did not load.</p>');
    var ys = Object.keys(h.years).sort(), ly = ys[ys.length - 1], py = ys[ys.length - 2], L = h.years[ly], P = py ? h.years[py] : null;
    var delta = function (a, b) { return a != null && b ? signed((a / b - 1) * 100) : '—'; };
    var M = [
      ['Originations', function (y) { return y.originations; }, num, function () { return delta(L.originations, P && P.originations); }],
      ['Denial rate', function (y) { return y.denial_rate * 100; }, function (v) { return pct(v); }, function () { return P ? signed((L.denial_rate - P.denial_rate) * 100, 1, ' pts') : '—'; }],
      ['Mean loan amount', function (y) { return y.mean_loan_amount_usd; }, function (v) { return '$' + num(v); }, function () { return delta(L.mean_loan_amount_usd, P && P.mean_loan_amount_usd); }],
      ['Multifamily originations', function (y) { return y.multifamily && y.multifamily.originations; }, num, function () { return delta(L.multifamily && L.multifamily.originations, P && P.multifamily && P.multifamily.originations); }]
    ];
    var cards = M.map(function (m) {
      var vals = ys.map(function (y) { return m[1](h.years[y]); });
      return '<li class="econ-card econ-co"><h4>' + esc(m[0]) + '</h4><p class="econ-v">' + esc(m[2](m[1](L))) + '</p><p class="econ-when">' + esc(ly) + ' · <span class="econ-d">' + esc(m[3]()) + '</span> on ' + esc(py) + '</p>' +
        spark(vals, m[0] + ' in Colorado, ' + ys[0] + ' to ' + ly + ': ' + vals.map(function (v, i) { return ys[i] + ' ' + m[2](v); }).join(', ')) +
        (vals[0] != null && vals[vals.length - 1] != null ? ends([m[2](vals[0]), ys[0]], [m[2](vals[vals.length - 1]), ly]) : '') +
        '<p class="econ-what">' + esc(ys[0] + ' to ' + ly + ', one point a year.') + '</p></li>';
    }).join('');
    var dr = L.denial_rate * 100, drp = P ? P.denial_rate * 100 : null;
    return section('econ-credit', 'Mortgage credit access: statewide trends',
      'Colorado lenders made ' + num(L.originations) + ' home loans in ' + ly + ' and turned down ' + pct(dr) + ' of applications' + (drp != null ? ' (' + pct(drp) + ' in ' + py + ')' : '') + '. Tighter credit, with more denials and fewer loans, tends to come before slower apartment starts.',
      '<ul class="econ-cards">' + cards + '</ul>' +
      '<p class="metric-source">' + link('CFPB HMDA Data Browser', 'https://ffiec.cfpb.gov/data-browser/') + ', Colorado, ' + esc(ys[0]) + '–' + esc(ly) + '. Checked monthly; built ' + esc(String(h.meta.generated_at || '').slice(0, 10)) + '.</p>');
  }

  /* ── 7. Market odds (Kalshi and Polymarket) ── */
  function strikeOf(name) { var h = /above\s+\$?([\d.,]+)/i.exec(String(name || '')); if (!h) return null; var n = parseFloat(h[1].replace(/,/g, '')); return isFinite(n) ? n : null; }
  // The live page's check: on an "above X" ladder a lower line can never be less likely than a higher one. When
  // the prices say otherwise, none of that ladder's lines is shown.
  function ladderChecked(outs) {
    var k = outs.map(function (o) { return strikeOf(o.name); });
    if (outs.length < 2 || k.some(function (x) { return x == null; })) return outs;
    var groups = {}, broken = {};
    outs.forEach(function (o, i) { var g = String(o.name).replace(/above\s+\$?[\d.,]+/i, 'above #'); (groups[g] = groups[g] || []).push(i); });
    Object.keys(groups).forEach(function (g) {
      var pr = groups[g].map(function (i) { return { k: k[i], p: outs[i].prob }; }).filter(function (x) { return typeof x.p === 'number' && isFinite(x.p); }).sort(function (a, b) { return a.k - b.k; });
      if (!pr.every(function (x, j) { return j === 0 || x.p <= pr[j - 1].p; })) groups[g].forEach(function (i) { broken[i] = 1; });
    });
    return outs.map(function (o, i) { return broken[i] ? { name: o.name, prob: null, thin: true } : o; });
  }
  function bars(rows) {
    if (!rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.prob || 0; })) || 1;
    return '<ul class="econ-odds-bars">' + rows.map(function (r) {
      return '<li' + (r.settled ? ' class="econ-settled"' : '') + '><span class="econ-odds-l">' + esc(r.label) + '</span><span class="econ-odds-bar"><span style="width:' + (r.settled ? 0 : Math.round((r.prob || 0) / max * 100)) + '%"></span></span><span class="econ-odds-p">' + (r.settled ? 'Settled' : Math.round(r.prob * 100) + '%') + '</span></li>';
    }).join('') + '</ul>';
  }
  function kalshi(k) {
    if (!k || !Array.isArray(k.items) || !k.items.length) return '<p class="note">Kalshi odds are not in this copy of the data. They are saved weekly.</p>';
    var quiet = [];
    var cards = k.items.map(function (it) {
      var mk = it.market || {}, outs = ladderChecked(it.outcomes || []);
      var priced = outs.filter(function (o) { return typeof o.prob === 'number' && isFinite(o.prob); });
      if (!priced.length) { quiet.push(link(it.label || it.metric, mk.url)); return ''; }
      var even = priced.filter(function (o) { return o.prob >= 0.5; });
      var top = even.length ? even.slice().sort(function (a, b) { return a.prob - b.prob; })[0] : priced.slice().sort(function (a, b) { return b.prob - a.prob; })[0];
      var un = outs.length - priced.length;
      return '<li class="econ-odds-card' + (/^colorado/.test(it.metric) ? ' econ-co' : '') + '"><h4>' + esc(it.label || it.metric) + '</h4>' + (it.note ? '<p class="econ-what">' + esc(it.note) + '</p>' : '') +
        '<p class="econ-v">' + esc(top.name) + ' <span class="econ-odds-top">' + Math.round(top.prob * 100) + '%</span></p>' +
        bars(priced.map(function (o) { return { label: o.name, prob: o.prob }; })) +
        (un ? '<p class="econ-what">' + (un === 1 ? '1 more line is' : un + ' more lines are') + ' not shown: buyers and sellers are more than 10 points apart, or the prices contradict each other.</p>' : '') +
        '<p class="econ-what">' + (mk.closes ? 'Trading closes ' + esc(when(mk.closes.slice(0, 10), 'daily')) + '. ' : '') + esc(mk.title || '') + ' ' + link('View on Kalshi', mk.url) + '</p></li>';
    }).join('');
    var co = k.items.filter(function (i) { return /^colorado/.test(i.metric); }).length;
    return '<p>What Kalshi traders pay on upcoming housing figures: ' + (co ? co + ' Colorado figures first (home prices and permits), then ' : '') + 'the year’s highest 30-year mortgage rate and monthly U.S. starts, permits, home prices and rents. A line’s price is the odds the figure lands above it.</p>' +
      '<ul class="econ-odds-grid">' + cards + '</ul>' +
      (quiet.length ? '<p class="note">Too few trades this week for a reading on: ' + quiet.join('; ') + '.</p>' : '') +
      '<p class="metric-source">' + link('Kalshi', 'https://kalshi.com') + ', a U.S. exchange regulated by the CFTC (Commodity Futures Trading Commission). Saved weekly; updated ' + esc(when(String(k.updated).slice(0, 10), 'daily')) + '.</p>';
  }
  function parse(ev) {
    return (ev && ev.markets || []).map(function (m) {
      var pr = [0, 0]; try { pr = JSON.parse(m.outcomePrices); } catch (e) {}
      var n = pr.map(Number).filter(function (x) { return !isNaN(x); });
      return { q: m.groupItemTitle || m.question || '', prob: parseFloat(pr[0]) || 0, settled: n.length > 1 && Math.max.apply(null, n) >= 0.999 && Math.min.apply(null, n) <= 0.001, vol: parseFloat(m.volume) || 0 };
    }).sort(function (a, b) { return b.prob - a.prob; });
  }
  function vol(ms) { var v = ms.reduce(function (s, m) { return s + m.vol; }, 0); return v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v); }
  // One card per curated event, drawn by its role as the live page draws it.
  function polyCard(e, ev) {
    var ms = parse(ev), all = ms.length && ms.every(function (m) { return m.settled; }), body = '', head = '';
    var has = function (w) { return ms.reduce(function (t, m) { return t + (m.q.toLowerCase().indexOf(w) > -1 ? m.prob : 0); }, 0); };
    if (!ms.length) body = '<p class="econ-what">No prices in this copy of the data.</p>';
    else if (e.role === 'recession' || e.role === 'up-down') {
      var y = e.role === 'up-down' ? (ms.filter(function (m) { return /up/i.test(m.q); })[0] || ms[0]).prob : ms[ms.length - 1].prob;
      head = all ? 'Settled' : Math.round(y * 100) + '% ' + (e.role === 'up-down' ? 'up' : 'yes');
      body = bars([{ label: e.role === 'up-down' ? 'Up' : 'Yes', prob: y, settled: all }]);
    } else if (e.role === 'fed-decision-pair') {
      var hold = ms.filter(function (m) { return /no change/i.test(m.q); })[0];
      head = all ? 'Settled' : hold ? Math.round(hold.prob * 100) + '% hold' : '';
      body = hold && !all ? bars([{ label: 'Hold', prob: hold.prob }, { label: 'Raise', prob: has('increase') }, { label: 'Cut', prob: has('decrease') }]) : '';
    } else if (e.role === 'brackets') {
      var pre = e.prefix || '', shown = ms.filter(function (m) { return !m.settled && m.prob >= 0.05; }), st = ms.filter(function (m) { return m.settled; }).length, ls = ms.length - shown.length - st;
      var lab = function (q) { return pre + (pre ? q.charAt(0).toLowerCase() + q.slice(1) : q); };
      body = bars((shown.length || st < ms.length ? shown : ms).map(function (m) { return { label: lab(m.q), prob: m.prob, settled: m.settled }; })) +
        ((ls || st) ? '<p class="econ-what">' + esc([ls ? (ls === 1 ? '1 more open line is' : ls + ' more open lines are') + ' under 5%.' : '', st ? (st === 1 ? '1 line has' : st + ' lines have') + ' already settled.' : ''].join(' ').trim()) + '</p>' : '');
    } else {
      var label = function (q) { return q.replace(/Will there be exactly /i, '').replace(/ Federal Reserve.*$/i, '').replace(/^Fed decision in [A-Za-z]+:\s*/i, '').replace(/Will inflation /i, '').replace(/ in 2026\??/i, '').replace(/\?$/, '').trim(); };
      var open = ms.filter(function (m) { return !m.settled; });
      if (e.role === 'fed-decision') { var nc = ms.filter(function (m) { return /no change/i.test(m.q); })[0]; head = all ? 'Settled' : nc ? Math.round(nc.prob * 100) + '% hold' : ''; }
      else if (e.role === 'inflation') { var g4 = ms.filter(function (m) { return /4\s?%/.test(m.q) && !/4\.\d/.test(m.q); })[0]; var lv = g4 && !g4.settled ? g4 : open[0]; head = lv ? Math.round(lv.prob * 100) + '% ' + label(lv.q).toLowerCase() : 'Settled'; }
      else if (open.length) head = label(open[0].q) + ' (' + Math.round(open[0].prob * 100) + '%)';
      body = bars(ms.slice(0, 8).map(function (m) { return { label: label(m.q), prob: m.prob, settled: m.settled }; }));
    }
    return '<li class="econ-odds-card"><p class="econ-badge" style="border-color:' + esc(/^#[0-9a-f]{3,6}$/i.test(e.color || '') ? e.color : 'var(--muted)') + '">' + esc(e.badge || '') + '</p><h4>' + esc(e.label) + '</h4>' +
      (head ? '<p class="econ-v">' + esc(head) + '</p>' : '') + '<p class="econ-what">' + esc(e.description || '') + '</p>' + body +
      '<p class="econ-what">' + (ms.length ? 'Traded ' + esc(vol(ms)) + '. ' : '') + link('View on Polymarket', 'https://polymarket.com/event/' + encodeURIComponent(e.slug)) + '</p></li>';
  }
  function polymarket(p, c) {
    if (!p || !c || !p.events) return '<p class="note">Polymarket odds are not in this copy of the data. They are saved daily.</p>';
    var live = (c.events || []).filter(function (e) { return p.events[e.slug]; });
    var dropped = (c.events || []).length - live.length;
    var first = function (role) { return live.filter(function (e) { return e.role === role; }).map(function (e) { return { e: e, ms: parse(p.events[e.slug]) }; }).filter(function (x) { return x.ms.length && !x.ms.every(function (m) { return m.settled; }); })[0]; };
    var rec = first('recession'), inf = first('inflation'), infLine = inf && (inf.ms.filter(function (m) { return /4\s?%/.test(m.q) && !/4\.\d/.test(m.q) && !m.settled; })[0] || inf.ms.filter(function (m) { return !m.settled; })[0]);
    var SECT = [['fed', 'Federal Reserve and interest rates'], ['mortgage', 'Mortgage rates'], ['growth', 'Recession risk and economic growth'], ['labor', 'Employment and labor market']];
    return '<p>Polymarket prices are crowd odds on national outcomes that reach Colorado deals through rates, building costs and jobs. They are not forecasts and not advice.</p>' +
      '<h3>Colorado real estate and affordability impact</h3>' +
      '<p>Two national odds read for a Colorado deal: inflation pushes building costs, and a recession slows starts and tax credit deal flow.</p>' +
      tiles([
        ['Construction cost pressure: ' + (infLine ? (infLine.prob > 0.5 ? 'high' : 'moderate') : 'unavailable'), infLine ? 'Odds inflation goes ' + infLine.q.replace(/Will inflation /i, '').replace(/ in 2026\??/i, '').toLowerCase() + ' in 2026: ' + Math.round(infLine.prob * 100) + '%' : 'No open inflation line', ''],
        ['Recession risk: ' + (rec ? Math.round(rec.ms[rec.ms.length - 1].prob * 100) + '%' : 'unavailable'), rec ? rec.e.label.replace(/\?$/, '') : 'No open recession market', '']
      ]) +
      SECT.map(function (s) {
        var es = live.filter(function (e) { return e.section === s[0]; });
        return es.length ? '<h3>' + esc(s[1]) + '</h3><ul class="econ-odds-grid">' + es.map(function (e) { return polyCard(e, p.events[e.slug]); }).join('') + '</ul>' : '';
      }).join('') +
      '<p class="metric-source">' + link('Polymarket', 'https://polymarket.com') + ' public market data, saved daily; updated ' + esc(when(String(p.updated).slice(0, 10), 'daily')) + '.' + (dropped ? ' ' + dropped + (dropped === 1 ? ' market has' : ' markets have') + ' settled and dropped out of the file.' : '') + '</p>';
  }

  /* ── 8. Policy and economic milestones ── */
  function timeline(t) {
    if (!t || !Array.isArray(t.events)) return section('econ-timeline', 'Policy and economic milestones', '', '<p class="callout">Policy timeline unavailable: the file did not load.</p>');
    var today = new Date().toISOString().slice(0, 10);
    return section('econ-timeline', 'Policy and economic milestones', 'Events that moved rates, costs and housing money since 2020. History for context, not a list of programs open today.',
      '<details class="fold"><summary><span class="fold-title">Read the timeline and official sources</span><span class="fold-take">' + t.events.length + ' events, each with its source.</span></summary><div class="panel"><ol class="econ-timeline">' + t.events.map(function (e) {
        var st = e.date < today ? 'historical' : e.status;
        return '<li><p class="econ-when">' + esc(e.date) + ' · ' + esc(st) + '</p><p><strong>' + link(e.title, e.source_url) + '</strong></p><p>' + esc(e.detail) + '</p><p class="econ-what">' + esc(e.verified ? 'Source checked ' + e.verified : 'Not independently verified — ' + (e.note || '')) + '</p></li>';
      }).join('') + '</ol></div></details><p class="metric-source">COHO policy timeline, as of ' + esc(t.meta && t.meta.as_of || '') + '. Current tax credit status is on <a href="#/legislation">legislation</a>.</p>');
  }

  /* ── 9. About this data ── */
  function about(fred) {
    var list = function (k) { return US[k].map(function (x) { return x[0] + ' (' + x[1] + ')'; }).join(', '); };
    return section('econ-about', 'About this data', '',
      '<p><strong>What this page is.</strong> The rates, costs, jobs and supply figures that move affordable housing deals in Colorado, each from a daily saved copy of its source, not a live feed. Pair the rate lines with the <a href="#/deal-calculator">deal calculator</a> before locking an interest rate, and check the consumer price lines against the operating cost growth in a 30-year pro forma.</p>' +
      '<p><strong>What it is not.</strong> A trading screen, a forecast or underwriting advice. FRED revises some past values. Prediction-market odds are prices set by traders, not forecasts from an agency or economist.</p>' +
      '<details class="fold"><summary><span class="fold-title">Sources and method</span><span class="fold-take">Every series by section, and how changes are worked out.</span></summary><div class="panel"><h3>Data sources by section</h3><ul class="econ-src">' +
      '<li><strong>What money costs</strong>: Federal Reserve, U.S. Treasury, New York Fed, Freddie Mac and Moody’s via ' + link('FRED', 'https://fred.stlouisfed.org/') + ': ' + esc(list('money')) + '.</li>' +
      '<li><strong>What it costs to build</strong>: ' + link('BLS State and Metro Employment', 'https://www.bls.gov/sae/') + ' (Colorado construction pay and jobs, series SMU08000002000000003 and SMU08000002000000001), COCONS, and BLS producer prices via FRED: ' + esc(list('build')) + '.</li>' +
      '<li><strong>Pipeline</strong>: ' + link('Census Building Permits Survey', 'https://www.census.gov/construction/bps/') + ' (COBPPRIV) and Census and HUD via FRED: ' + esc(list('pipeline')) + '.</li>' +
      '<li><strong>Demand</strong>: BLS (COUR), ' + link('Apartment Association of Metro Denver', 'https://www.aamdhq.org/') + ', Realtor.com (ACTLISCOUCO, PRIREDCOUCO, median days on market), ' + link('FHFA house price index', 'https://www.fhfa.gov/data/hpi') + ', ' + link('FHFA National Mortgage Database', 'https://www.fhfa.gov/data/nmdb') + ', and via FRED: ' + esc(list('demand')) + '.</li>' +
      '<li><strong>Census snapshot</strong>: ' + link('U.S. Census Bureau ACS 5-year estimates', 'https://www.census.gov/data/developers/data-sets/acs-5year.html') + ', Colorado.</li>' +
      '<li><strong>Mortgage credit</strong>: ' + link('CFPB HMDA Data Browser', 'https://ffiec.cfpb.gov/data-browser/') + ', Colorado, every year since 2018.</li>' +
      '<li><strong>Market odds</strong>: ' + link('Kalshi', 'https://kalshi.com') + ' (saved weekly) and ' + link('Polymarket', 'https://polymarket.com') + ' (saved daily).</li></ul>' +
      '<h3>Methodology</h3>' +
      '<p>FRED series are checked daily and read from a saved copy (this one updated ' + esc(String(fred.updated || '').slice(0, 10)) + '). Each small chart shows the latest 120 readings of its series. A change “on a year” compares the latest reading with the last one on or before the same date a year earlier, so a month that was never published (October 2025, during the federal shutdown) is not counted as a year. A series without a reading a year back is compared with the reading before, and says so. Rates change in points; everything else in per cent.</p>' +
      '<p>Prediction-market cards show each contract’s latest saved price. They are not adjusted, averaged or combined with forecasts. A Kalshi line with no reliable price (buyers and sellers more than 10 points apart) is left out and counted, never shown as 0%.</p>' +
      '<p class="note">Screening tool only: for early deal context, not investment advice or an underwriting input. Each series updates on its agency’s own schedule, monthly or quarterly.</p></div></details>');
  }

  function view() {
    var title = 'Economic dashboard', s = {};
    Object.keys(FILES).forEach(function (k) { var o = {}; o[k] = FILES[k]; s[k] = UI.load(o); });
    var got = function (k) { return s[k].data ? s[k].data[k] : null; };
    var fred = got('fred');
    if (!fred) return T.head({ kind: 'data', crumbs: T.trail('places', title), title: title }) + (s.fred.error ? '<p class="callout">' + esc(s.fred.error) + '</p>' : '<p role="status" class="note">Loading the data…</p>');
    var since = (new Date().getFullYear() - 6) + '-01-01';
    var labor = got('labor'), aamd = got('aamd');
    var last = function (id) { var a = obs(fred, id); return a.length ? a[a.length - 1] : null; };
    var t10 = last('DGS10'), cour = last('COUR'), p = obs(fred, 'COBPPRIV');
    var ytd = null;
    if (p.length) { var lp = p[p.length - 1], ly = +lp.date.slice(0, 4), lm = +lp.date.slice(5, 7), a = 0, b = 0; p.forEach(function (o) { var y = +o.date.slice(0, 4); if (+o.date.slice(5, 7) <= lm) { if (y === ly) a += o.value; if (y === ly - 1) b += o.value; } }); ytd = { v: b ? (a / b - 1) * 100 : NaN, lm: lm, ly: ly }; }
    var t10s = obs(fred, 'DGS10'), yi = t10s.length ? yearAgoIndex(t10s) : -1;
    var answer = (t10 ? 'Money costs ' + (yi > -1 && t10.value - t10s[yi].value > 0.05 ? 'more than' : yi > -1 && t10.value - t10s[yi].value < -0.05 ? 'less than' : 'about what it did') + ' a year ago' : '') +
      (ytd && isFinite(ytd.v) ? ', Colorado is permitting ' + (ytd.v < 0 ? 'fewer' : 'more') + ' homes' : '') +
      (labor && labor.summary ? ', and building here costs more: pay ' + signed(labor.summary.laborWageYoyPct) + ', materials ' + signed(labor.summary.materialsYoyPct) + ' on a year' : '') + '.';
    var m = aamd && aamd.metro;
    var head = T.head({
      kind: 'data', crumbs: T.trail('places', title), title: title, answer: esc(answer),
      meta: '<span class="scope-tag">Scope: Colorado first; national rates and readings labelled as such</span> FRED copy updated ' + esc(String(fred.updated || '').slice(0, 10)) + '.',
      facts: [
        t10 ? { value: pct(t10.value, 2), label: '10-year Treasury, ' + when(t10.date, 'daily'), source: 'Treasury via FRED', href: fredLink('DGS10') } : null,
        ytd ? { value: signed(ytd.v), label: 'Colorado homes permitted, Jan–' + MON[ytd.lm - 1] + ' ' + ytd.ly + ' vs ' + (ytd.ly - 1), source: 'Census via FRED', href: fredLink('COBPPRIV') } : null,
        labor && labor.summary ? { value: signed(labor.summary.laborWageYoyPct), label: 'Colorado construction pay on a year, ' + MON[+labor.summary.period.slice(5, 7) - 1] + ' ' + labor.summary.period.slice(0, 4) + ' (preliminary)', source: 'BLS', href: 'https://www.bls.gov/sae/' } : null,
        cour ? { value: pct(cour.value), label: 'Colorado unemployment, ' + when(cour.date), source: 'BLS via FRED', href: fredLink('COUR') } : null,
        m ? { value: pct(m.stabilized_vacancy_pct), label: 'Metro Denver apartment vacancy, ' + String(aamd.meta.vintage).replace(/^(\d{4})-(Q\d)$/, '$2 $1'), source: 'AAMD', href: aamd.meta.source_url } : null
      ].filter(Boolean)
    });
    var otp = T.onThisPage([
      { id: 'econ-money', title: 'What money costs' }, { id: 'econ-build', title: 'Cost to build' }, { id: 'econ-pipeline', title: 'Pipeline' },
      { id: 'econ-demand', title: 'Demand' }, { id: 'econ-rents', title: 'Apartment rents' }, { id: 'econ-census', title: 'Census snapshot' }, { id: 'econ-credit', title: 'Mortgage credit' },
      { id: 'econ-odds', title: 'Market odds' }, { id: 'econ-timeline', title: 'Milestones' }, { id: 'econ-about', title: 'About this data' }
    ], true);
    var odds = section('econ-odds', 'Market odds', 'What traders are paying on rates, recession, inflation and housing figures. Context only: prices, not forecasts.',
      '<details class="fold econ-odds"><summary><span class="fold-title">Market-priced macro expectations (Kalshi prediction markets)</span><span class="fold-take">Colorado home prices and permits first, then U.S. housing figures.</span></summary><div class="panel">' + kalshi(got('kalshi')) + '</div></details>' +
      '<details class="fold econ-odds"><summary><span class="fold-title">Prediction markets: real estate, finance and economic outlook (Polymarket)</span><span class="fold-take">The Fed, the 10-year, mortgages, recession, growth, inflation and jobs.</span></summary><div class="panel">' + polymarket(got('poly'), got('curated')) + '</div></details>');
    var rents = section('econ-rents', 'Colorado apartment rents', '',
      '<p>' + (m ? 'Metro Denver’s average asking rent is $' + num(m.average_rent) + ' (' + esc(String(aamd.meta.vintage).replace(/^(\d{4})-(Q\d)$/, '$2 $1')) + ', AAMD), down from $' + num(m.average_rent_year_ago) + ' a year earlier. ' : '') +
      'Rents for every county (Zillow’s observed rent index and Apartment List) are on the <a href="#/places/deep-dive">Colorado deep dive</a> and <a href="#/places/county-costs">housing costs by county</a>; what a household can afford is in each place’s <a href="#/places">needs assessment</a>.</p>');
    // The page story (paul 11-06): after the four questions, what they add up to for a deal, from the same figures.
    var up = t10 && yi > -1 ? t10.value - t10s[yi].value : null;
    var means = T.means([
      up != null && Math.abs(up) > 0.05 ? { who: 'Debt', text: 'The 10-year Treasury is ' + pct(t10.value, 2) + ', ' + (up > 0 ? 'up ' : 'down ') + Math.abs(up).toFixed(2) + ' points on a year, so the same rents carry a ' + (up > 0 ? 'smaller' : 'larger') + ' permanent loan.' } : null,
      labor && labor.summary ? { who: 'Costs', text: 'Apartment building inputs are ' + signed(labor.summary.materialsYoyPct) + ' and Colorado construction pay ' + signed(labor.summary.laborWageYoyPct) + ' on a year. A materials budget priced a year ago is now about that much short.' } : null,
      ytd && isFinite(ytd.v) ? { who: 'Competition', text: 'Colorado permitted ' + Math.abs(ytd.v).toFixed(1) + '% ' + (ytd.v < 0 ? 'fewer' : 'more') + ' homes from January to ' + MONTH[ytd.lm - 1] + ' than a year earlier. ' +
        (ytd.v < -2 ? 'Fewer starts mean less competing lease-up, and a thinner contractor bench.' : ytd.v > 2 ? 'More starts mean more competing lease-up for a deal opening in two or three years.' : 'The pace is about level with last year.') } : null
    ], 'Why it matters for a deal');
    return head + otp + money(fred, since) + build(fred, labor) + pipeline(fred, since) + demand(fred, aamd, got('fc'), since) + means + rents +
      '<h2 class="econ-more">More indicators</h2><p class="note">Context for the four questions above: households, mortgage credit, market odds and the dates that moved them.</p>' +
      census(got('census')) + credit(got('hmda')) + odds + timeline(got('timeline')) + about(fred) +
      T.source('Federal Reserve Bank of St. Louis (FRED), BLS, Census, AAMD, FHFA, CFPB, Kalshi and Polymarket, as gathered by COHO', LIVE_PAGE, String(fred.updated || '').slice(0, 10)) +
      T.next('What to do next', [{ href: '#/deal-calculator', label: 'Test today\u2019s rates in the Deal Calculator →' }, { href: '#/places/costs', label: 'See costs since 2020', secondary: true }, { href: '#/equity-pricing', label: 'Check tax credit prices', secondary: true }]);
  }

  global.LabEconomy = { view: view, FILES: FILES, US: US, yearAgoIndex: yearAgoIndex, change: change, ladderChecked: ladderChecked, parse: parse };
})(window);
