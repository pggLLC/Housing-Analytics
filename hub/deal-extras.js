// The live Deal Calculator's context panels, below a scenario's Financials: how sensitive the deal is, the county's
// rents, rent against buying, the project's scenarios side by side, the county's funding programs, and what the land
// can carry. Each figure comes from the public site's own code at the pin: DealEngine.computeDeal (its tornado
// ranges), RentVsBuyBreakeven.compute, FundingContextCard.buildContext, or a published data file named in the
// section's source line. This file adds no deal arithmetic of its own.
(function (global) {
  'use strict';

  var Shell = global.LabShell, Pl = global.LabPlaces;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var FILES = { zori: 'data/market/zori_rents_co.json', acs: 'data/market/acs_median_rent_co.json', funding: 'data/policy/soft-funding-status.json' };
  var got = {}, asked = false;
  function load() {
    if (asked) return;
    asked = true;
    Object.keys(FILES).forEach(function (k) {
      fetch(VENDOR + FILES[k]).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { got[k] = j || false; Shell.render(); });
    });
  }

  function money(n) { return n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function src(list) { return Pl && Pl.srcLine ? Pl.srcLine(list) : ''; }
  function known(v) { return v != null && isFinite(v); }

  // Scenario sensitivity: the four swings the engine computes (result.tornado), as the live chart draws them.
  function sensitivity(r) {
    var t = r.tornado;
    var head = '<section class="fin-section" aria-labelledby="fin-sens"><h2 id="fin-sens">How sensitive is the deal?</h2>';
    if (!t) return head + '<p class="note">' + esc((r.unavailable && r.unavailable.tornado) || 'Needs a known operating income, rent roll and credit amount.') + '</p></section>';
    var rows = [
      ['Credit equity', t.eqLo, t.eqHi, r.equity, 'Equity price $' + Math.max(0.70, t.eqP - 0.03).toFixed(2) + ' to $' + Math.min(1.05, t.eqP + 0.03).toFixed(2) + ' a credit dollar'],
      ['First mortgage', t.mortLo, t.mortHi, r.mortgage, 'Rate ' + Math.max(3, t.ir - 1).toFixed(1) + '% to ' + Math.min(12, t.ir + 1).toFixed(1) + '%'],
      ['Operating income, by expenses', t.noiLo, t.noiHi, r.noi, 'Expenses $' + num(Math.max(200, t.ou - 50)) + ' to $' + num(t.ou + 50) + ' a home a month'],
      ['Income after vacancy', t.vacLoEgi, t.vacHiEgi, null, 'Vacancy ' + (Math.round(Math.max(1, t.vu - 2) * 10) / 10) + '% to ' + (Math.round(Math.min(15, t.vu + 2) * 10) / 10) + '%']
    ].filter(function (x) { return known(x[1]) && known(x[2]); });
    var widest = Math.max.apply(null, rows.map(function (x) { return Math.abs(x[2] - x[1]); })) || 1;
    rows.sort(function (a, b) { return Math.abs(b[2] - b[1]) - Math.abs(a[2] - a[1]); });
    var top = rows[0];
    return head + '<p>Each bar is how far one figure moves when one assumption moves by a typical amount, the rest held. The longest bar is the assumption to pin down first.</p>' +
      '<div class="swing-list">' + rows.map(function (x) {
        var span = Math.abs(x[2] - x[1]), w = Math.max(4, Math.round(span / widest * 100));
        return '<div class="swing-row"><p class="swing-label"><strong>' + esc(x[0]) + '</strong> <span class="note">' + esc(x[4]) + '</span></p>' +
          '<div class="swing-track" role="img" aria-label="' + esc(x[0] + ': ' + money(Math.min(x[1], x[2])) + ' to ' + money(Math.max(x[1], x[2]))) + '"><span class="swing-bar" style="width:' + w + '%"></span></div>' +
          '<p class="swing-values">' + esc(money(Math.min(x[1], x[2]))) + ' to ' + esc(money(Math.max(x[1], x[2]))) + ' <span class="note">(' + esc(money(span)) + ' swing)</span></p></div>';
      }).join('') + '</div>' +
      (top ? '<p><strong>' + esc(top[0]) + '</strong> moves most here: ' + esc(money(Math.abs(top[2] - top[1]))) + '.</p>' : '') +
      '<p class="metric-source">The public site’s Deal Engine, the same swings as the live Deal Calculator’s sensitivity chart.</p></section>';
  }

  // Rent context: voucher, existing and asking rents for the county, on one scale (as js/components/rent-triangulation.js reads them).
  function rentContext(fips, countyName, hud) {
    var Viz = global.LabViz;
    var head = '<section class="fin-section" aria-labelledby="fin-rents"><h2 id="fin-rents">Rent context: voucher, existing and asking rents</h2>';
    if (!Viz) return '';
    if (got.zori === undefined || got.acs === undefined) return head + '<p role="status" class="note">Loading the county’s rents…</p></section>';
    var c = (hud && hud.counties || []).filter(function (x) { return x.fips === fips; })[0];
    var fmr = c && c.fmr ? c.fmr.two_br : null;
    var acs = got.acs && got.acs.counties && got.acs.counties[fips] ? got.acs.counties[fips].median_gross_rent : null;
    var zr = got.zori && got.zori.counties && got.zori.counties[fips] ? got.zori.counties[fips] : null;
    var rents = [['Median rent paid, all sizes', acs, Viz.COLORS.muted], ['HUD Fair Market Rent, 2-bedroom', fmr, Viz.COLORS.ink], ['Typical asking rent', zr ? zr.rent : null, Viz.COLORS.homes]];
    var gap = zr && fmr != null ? [1, 2, '$' + num(Math.abs(zr.rent - fmr)) + (zr.rent > fmr ? ' above' : ' below') + ' the Fair Market Rent'] : null;
    var fig = Viz.rentScale({ title: 'Three rents in ' + countyName, scope: '', rents: rents, gap: gap,
      answer: gap ? 'Typical asking rent is ' + gap[2].replace('the Fair Market Rent', 'HUD’s 2-bedroom Fair Market Rent') + '.' : null,
      note: 'The Fair Market Rent is a voucher benchmark, not a tax credit rent limit. Tax credit limits come from HUD’s income limits as CHFA publishes them, and the rent a tenant pays is that limit less the utility allowance. Asking rents are listings; the median rent paid covers current tenants.',
      source: src([['HUD Fair Market Rents' + (hud && hud.meta && hud.meta.fiscal_year ? ', FY' + hud.meta.fiscal_year : ''), 'https://www.huduser.gov/portal/datasets/fmr.html'],
        [got.acs && got.acs.meta ? 'Census ACS ' + got.acs.meta.vintage + ' 5-year, ' + got.acs.meta.source_table : 'Census ACS', got.acs && got.acs.meta ? got.acs.meta.source_url : 'https://data.census.gov/'],
        ['Zillow Observed Rent Index' + (zr && zr.vintage_month ? ', ' + zr.vintage_month.slice(0, 7) : ''), 'https://www.zillow.com/research/data/']]) });
    return fig ? head + fig + '</section>' : head + '<p class="note">Fewer than two of the three rents are published for ' + esc(countyName) + '.</p></section>';
  }

  // Rent vs buy breakeven, with the live calculator's own function and its default assumptions.
  var RVB = [['homePrice', 'Home price ($)', 10000], ['monthlyRent', 'Monthly rent ($)', 50], ['mortgageRatePct', 'Mortgage rate (%)', 0.1], ['downPaymentPct', 'Down payment (%)', 1],
    ['propTaxRatePct', 'Property tax (%)', 0.05], ['maintPct', 'Maintenance (%)', 0.1], ['rentEscalationPct', 'Rent growth (% a year)', 0.1], ['homeAppreciationPct', 'Home value growth (% a year)', 0.1]];
  var rvbIn = null;
  function rentVsBuy() {
    var R = global.RentVsBuyBreakeven, Viz = global.LabViz;
    if (!R) return '';
    var base = R.compute({}).params;
    if (!rvbIn) { rvbIn = {}; RVB.forEach(function (f) { rvbIn[f[0]] = base[f[0]]; }); }
    var res = R.compute(rvbIn);
    var y = res.breakevenYear;
    var why = !y ? 'Renting stays cheaper for all 30 years. Tax credit rentals here compete mainly with high-end rentals, so expect strong demand for affordable homes.'
      : y <= 5 ? 'Buying pays off fast here, so higher-income renters can buy. Demand for tax credit rentals turns more on who can get a mortgage than on this math.'
      : y <= 10 ? 'A middle breakeven. Demand for tax credit rentals tracks how many renters are cost-burdened.'
      : 'Renting stays cheaper for a long time. Tax credit rentals compete with the wider rental market, so rent pressure is higher.';
    var fig = Viz ? Viz.multiLine({ title: 'What renting and buying cost over 30 years', series: [
      { label: 'Rent paid', color: Viz.COLORS.households, points: res.rentSeries.map(function (p) { return [p.year, p.cum]; }) },
      { label: 'Net cost of buying', color: Viz.COLORS.homes, points: res.buySeries.map(function (p) { return [p.year, Math.max(0, p.cum)]; }) }],
      answer: 'Breakeven: ' + (y ? 'year ' + y : 'past 30 years, so renting stays cheaper') + '.', note: 'Buying counts the down payment, ' + res.params.closingCostPct + '% closing costs and a ' + res.params.opportunityRatePct + '% return the down payment could have earned, less what a sale returns after ' + res.params.sellingCostPct + '% selling costs.',
      source: 'The live Deal Calculator’s rent-or-buy calculation, with the assumptions above.' }) : '';
    return '<section class="fin-section" aria-labelledby="fin-rvb"><h2 id="fin-rvb">Rent or buy: when does buying win?</h2>' +
      '<p>For the market around the site: the year the net cost of buying a home drops below the rent paid. Change the assumptions to fit the place.</p>' +
      '<form class="homes" data-action="rvb" novalidate><div class="field-grid">' + RVB.map(function (f) {
        return '<label class="field">' + esc(f[1]) + '<input name="rvb:' + f[0] + '" type="number" step="' + f[2] + '" inputmode="decimal" value="' + esc(String(rvbIn[f[0]])) + '"></label>';
      }).join('') + '</div></form>' +
      '<div class="metrics"><div class="metric"><p class="metric-title">Breakeven</p><p class="metric-value">' + esc(y ? 'Year ' + y : 'Over 30 years') + '</p></div>' +
      '<div class="metric"><p class="metric-title">Down payment</p><p class="metric-value">' + esc(money(res.summary.downPayment)) + '</p></div>' +
      '<div class="metric"><p class="metric-title">All-in monthly cost to own</p><p class="metric-value">' + esc(money(res.summary.monthlyAllIn)) + '</p><p class="metric-detail">Mortgage ' + esc(money(res.summary.monthlyPI)) + ' plus tax and upkeep</p></div></div>' +
      fig + '<p><strong>For a tax credit deal:</strong> ' + esc(why) + '</p></section>';
  }

  // The project's scenarios side by side, each run on its own saved schedule and draft.
  function compare(p, here, data) {
    var F = global.LabFinancials, E = global.DealEngine;
    var rows = p.scenarios.map(function (s) {
      var sched = p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0];
      if (!sched) return { s: s, r: null };
      var d = F.draftFor(p, s.scenarioId);
      return { s: s, d: d, r: E.computeDeal(Object.assign(F.buildInputs(d, sched.snapshot, data, { ChfaRentLimits: global.ChfaRentLimits, DealCostBasis: global.DealCostBasis }), { skipSchedules: true })) };
    });
    var cols = [['Homes', function (x) { return x.r ? String(x.r.units) : '—'; }], ['Total cost', function (x) { return x.d ? money(Number(x.d.fields['dc-tdc']) || null) : '—'; }],
      ['Credit equity', function (x) { return x.r ? money(x.r.equity) : '—'; }], ['First mortgage', function (x) { return x.r ? money(x.r.mortgage) : '—'; }],
      ['Basis boost', function (x) { return x.r ? F.boostTag(x.r, x.d.fields).short : '—'; }], ['Funding gap', function (x) { return x.r ? (x.r.gap == null ? '—' : money(Math.max(0, x.r.gap))) : '—'; }], ['Coverage', function (x) { return x.r && known(x.r.baseDSCR) ? x.r.baseDSCR.toFixed(2) + 'x' : '—'; }]];
    return '<section class="fin-section" aria-labelledby="fin-compare"><h2 id="fin-compare">Compare this project’s scenarios</h2>' +
      (rows.length < 2 ? '<p>Add a second scenario to this project, say a 4% version or a different mix, and each one’s results line up here. <a href="#/project/' + esc(p.projectId) + '">Add a scenario on the project page</a>.</p>' : '<p>Each scenario runs on its own saved homes and costs.</p>') +
      '<div class="table-scroll" role="region" aria-label="Scenarios side by side" tabindex="0"><table><thead><tr><th scope="col">Scenario</th>' + cols.map(function (c) { return '<th scope="col" class="num">' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr' + (x.s.scenarioId === here ? ' class="row-strong"' : '') + '><th scope="row">' + esc(x.s.name) + (x.r ? '' : ' <span class="note">(no saved homes yet)</span>') + '</th>' + cols.map(function (c) { return '<td class="num">' + esc(c[1](x)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  // Funding programs open to a deal like this in the county, as js/components/funding-context-card.js filters them.
  function funding(fips, countyName, creditType) {
    var C = global.FundingContextCard;
    var head = '<section class="fin-section" aria-labelledby="fin-funding"><h2 id="fin-funding">Funding programs for this county</h2>';
    if (!C) return '';
    if (got.funding === undefined) return head + '<p role="status" class="note">Loading the funding programs…</p></section>';
    var ctx = C.buildContext(got.funding || null, { countyFips: fips, executionType: creditType === '4' ? '4%' : '9%', useCase: 'multifamily-new-construction' });
    if (!ctx.ok) return head + '<p class="note">' + esc(ctx.reason) + '</p></section>';
    var sum = C._test && C._test.programSummary;
    return head + '<p>Gap and soft sources that can apply to a ' + (creditType === '4' ? '4%' : '9%') + ' rental in ' + esc(countyName) + '. Context only: none of these changes the figures above.</p>' +
      '<div class="program-grid">' + ctx.programs.slice(0, 8).map(function (pr) {
        var url = pr.contactUrl || pr.source_url;
        return '<article class="program-card"><h3>' + esc(pr.name || pr.id) + '</h3>' + (sum ? '<p>' + esc(sum(pr)) + '</p>' : '') +
          (pr.description || pr.warning ? '<p class="note">' + esc(pr.description || pr.warning) + '</p>' : '') +
          '<p class="metric-source">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Program page</a>' : 'No public page') + (pr.last_verified ? ', checked ' + esc(pr.last_verified) : '') + '</p></article>';
      }).join('') + '</div>' +
      (ctx.programs.length > 8 ? '<p class="note">' + (ctx.programs.length - 8) + ' more on the <a href="' + esc(Pl.LIVE) + 'colorado-deep-dive.html#tab-funding" target="_blank" rel="noopener">funding sources list ↗</a>.</p>' : '') + '</section>';
  }

  // What the land can carry: the land value tool, opened with this scenario's homes, cost and sources.
  function landLink(r, d) {
    var tdc = Number(d.fields['dc-tdc']);
    if (!known(r.equity) || !known(r.mortgage) || !(tdc > 0)) return '';
    var q = 'units=' + r.units + '&tdc=' + Math.round(tdc) + '&eq=' + Math.round(r.equity + r.mortgage) + (known(r.deferredDevFee) ? '&def=' + Math.round(r.deferredDevFee) : '');
    return '<section class="fin-section" aria-labelledby="fin-land"><h2 id="fin-land">What the land can carry</h2>' +
      '<p>Before negotiating a land price: the most this deal can pay for the site and still close, set against what nearby land sales say it is worth. The land value tool opens with this scenario’s ' + esc(String(r.units)) + ' homes, ' + esc(money(tdc)) + ' cost and ' + esc(money(r.equity + r.mortgage)) + ' in equity and first mortgage; add the acres and any sales you know.</p>' +
      '<div class="actions"><a class="button-link secondary" href="#/opportunity/land-value?' + esc(q) + '">Open the land value tool</a></div></section>';
  }

  global.LabDealExtras = {
    render: function (p, s, d, inputs, r, data) {
      load();
      var fips = String(inputs.countyFips || (p.jurisdiction && p.jurisdiction.geoid || '').slice(0, 5));
      var c = (data.hud && data.hud.counties || []).filter(function (x) { return x.fips === fips; })[0];
      var countyName = c ? c.name || c.county_name || 'the county' : 'the county';
      return sensitivity(r) + compare(p, s.scenarioId, data) + rentContext(fips, countyName, data.hud) + funding(fips, countyName, d.fields['dc-credit']) + rentVsBuy() + landLink(r, d);
    },
    _rvb: function (k, v) { if (rvbIn && RVB.some(function (f) { return f[0] === k; }) && isFinite(v)) rvbIn[k] = v; }
  };

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.name || t.name.indexOf('rvb:') !== 0) return;
    global.LabDealExtras._rvb(t.name.slice(4), parseFloat(t.value));
    Shell.render();
    var again = document.querySelector('[name="' + t.name + '"]');
    if (again) again.focus();
  });
})(window);
