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
      '<p class="metric-source">The site’s Deal Engine, the same swings as the full Deal Calculator’s sensitivity chart.</p></section>';
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
      source: 'The full Deal Calculator’s rent-or-buy calculation, with the assumptions above.' }) : '';
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

  // The project's scenarios side by side, each run on its own saved schedule and draft: the live Deal Calculator's
  // "Scenario A and B" rows (js/deal-comparison.js: its deal assumptions, pro forma outputs and homes by income
  // level), for every scenario of the project, this one first. Each value is the engine's own record for that
  // scenario, not text read off a page; another scenario's results in money also give its difference from this one.
  // The live page's Save as A or B is "Copy this scenario" here: the copy gets this scenario's homes and draft.
  function compare(p, here, data) {
    var F = global.LabFinancials, E = global.DealEngine, O = global.LabCalcOutcome, G0 = global.LabCalcGrid;
    var list = p.scenarios.filter(function (s) { return s.scenarioId === here; }).concat(p.scenarios.filter(function (s) { return s.scenarioId !== here; }));
    var cols = list.map(function (s) {
      // From the scenario's saved schedule, or from its unit grid when its homes are typed there.
      var d = F.draftFor(p, s.scenarioId), inp = F.inputsFor(p, s.scenarioId, d);
      if (!inp) return { s: s, r: null };
      var G = G0 ? G0.ctx(p, s.scenarioId, d) : null;
      return { s: s, d: d, inp: inp, tiers: O ? O.homesByTier(inp, G) : null, r: E.computeDeal(Object.assign(inp, { skipSchedules: true })) };
    });
    // A scenario with no saved homes has nothing to set beside this one: it is named under the table, not given a column of dashes.
    var empty = cols.filter(function (x, i) { return i > 0 && !x.r; });
    cols = cols.filter(function (x, i) { return i === 0 || x.r; });
    function pctText(v, k) { return known(v) ? (+v).toFixed(k) : '—'; }
    function stateEq(r) { return r.creditStack && known(r.creditStack.state) ? r.creditStack.state : r.stateEquity; }
    // [label, value (a number, or text), shown, money row?]
    var ROWS = [
      ['Deal assumptions'],
      ['Credit type', function (x) { return x.d.fields['dc-credit'] === '4' ? '4%' : '9%'; }],
      ['Total development cost', function (x) { var v = Number(x.d.fields['dc-tdc']); return v > 0 ? v : null; }, money],
      ['Homes', function (x) { return x.r.units; }, function (v) { return known(v) ? num(v) : '—'; }],
      ['Basis boost', function (x) { return F.boostTag(x.r, x.d.fields).short; }],
      ['Equity price a credit dollar', function (x) { return x.r.equityPrice; }, function (v) { return known(v) ? '$' + (+v).toFixed(2) : '—'; }],
      ['Net operating income', function (x) { return x.r.noi; }, money],
      ['Coverage the lender requires', function (x) { return Number(x.inp.fields['dc-dcr']); }, function (v) { return v > 0 ? (+v).toFixed(2) + 'x' : '—'; }],
      ['Interest rate', function (x) { return x.r.interestRate; }, function (v) { return pctText(v, 2) === '—' ? '—' : pctText(v, 2) + '%'; }],
      ['Loan term', function (x) { return x.r.term; }, function (v) { return known(v) ? v + ' years' : '—'; }],
      ['Results'],
      ['Qualified basis', function (x) { return x.r.eligibleBasis; }, money, true],
      ['Annual tax credits', function (x) { return x.r.annualCredits; }, money, true],
      ['Federal credit equity', function (x) { return x.r.equity; }, money, true],
      ['State credit equity', function (x) { return stateEq(x.r); }, money, true],
      ['Rent a year before vacancy', function (x) { return x.r.annualRents; }, money, true],
      ['Supportable first mortgage', function (x) { return x.r.mortgage; }, money, true],
      ['Funding gap', function (x) { return x.r.gap == null ? null : Math.max(0, x.r.gap); }, money, true],
      ['Coverage', function (x) { return x.r.baseDSCR; }, function (v) { return known(v) ? (+v).toFixed(2) + 'x' : '—'; }]
    ];
    // Homes by income level: the live page's 30, 40, 50 and 60% rows, and any other level a scenario uses.
    var levels = [30, 40, 50, 60];
    cols.forEach(function (x) { Object.keys(x.tiers || {}).forEach(function (t) { t = +t; if (levels.indexOf(t) < 0 && x.tiers[t] > 0) levels.push(t); }); });
    levels.sort(function (a, b) { return a - b; });
    if (O) {
      ROWS.push(['Homes by income level']);
      levels.forEach(function (t) { ROWS.push([t + '% AMI', function (x) { return x.tiers ? x.tiers[t] || 0 : null; }, function (v) { return known(v) ? num(v) : '—'; }]); });
    }
    var base = cols[0];
    function cell(row, x) {
      if (!x.r) return '<td class="num">—</td>';
      var v = row[1](x), shown = row[2] ? row[2](v) : (v == null ? '—' : String(v));
      var diff = '';
      if (row[3] && x !== base && base.r) {
        var b = row[1](base);
        // From the whole dollars shown, so the difference is the one a reader works out from the two cells.
        if (known(v) && known(b)) { var dd = Math.round(v) - Math.round(b); diff = dd === 0 ? 'same as this one' : (dd > 0 ? '+' : '−') + money(Math.abs(dd)) + ' against this one'; }
      }
      return '<td class="num">' + esc(shown) + (diff ? '<br><small class="note">' + esc(diff) + '</small>' : '') + '</td>';
    }
    var width = cols.length + 1;
    return '<section class="fin-section" aria-labelledby="fin-compare" data-role="compare"><h2 id="fin-compare">Compare this project’s scenarios</h2>' +
      (cols.length < 2 ? '<p>' + (empty.length ? 'Once another scenario has saved homes, say a 4% version or a different mix, its results line up here.' : 'Add a second scenario to this project, say a 4% version or a different mix, and each one’s results line up here.') + ' Copy this one to try a change; the copy starts with these homes, costs and settings.</p>'
        : '<p>Each scenario runs on its own saved homes and costs. This one is first; each result in money also gives another scenario’s difference from this one.</p>') +
      '<div class="table-scroll" role="region" aria-label="Scenarios side by side" tabindex="0"><table data-role="compare-table"><thead><tr><th scope="col">For each scenario</th>' +
      cols.map(function (x) { return '<th scope="col" class="num">' + esc(x.s.name) + (x.s.scenarioId === here ? ' <small>(this one)</small>' : '') + (x.r ? '' : ' <span class="note">(no saved homes yet)</span>') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ROWS.map(function (row) {
        if (row.length === 1) return '<tr class="compare-group"><th scope="rowgroup" colspan="' + width + '">' + esc(row[0]) + '</th></tr>';
        return '<tr><th scope="row">' + esc(row[0]) + '</th>' + cols.map(function (x) { return cell(row, x); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      (empty.length ? '<p class="note" data-role="compare-empty">Not in the table, with no saved homes yet: ' + esc(empty.map(function (x) { return x.s.name; }).join(', ')) + '.</p>' : '') +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="copy-scenario" data-pid="' + esc(p.projectId) + '" data-sid="' + esc(here) + '">Copy this scenario</button>' +
      '<a class="button-link secondary" href="#/project/' + esc(p.projectId) + '">Rename or remove scenarios on the project page</a></div></section>';
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

  // Copy this scenario: the live page's Save as A or B. The copy gets this scenario's homes, draft and settings,
  // and opens on its own Financials, ready for the change to try.
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button[data-action="copy-scenario"]');
    var P = global.LabProjects;
    if (!b || !P) return;
    var p = P.get(b.dataset.pid), s = p && p.scenarios.filter(function (x) { return x.scenarioId === b.dataset.sid; })[0];
    if (!s) return;
    var copy = P.addScenario(p.projectId, 'Copy of ' + s.name, s.scenarioId);
    location.hash = '#/financials/' + p.projectId + '/' + copy;
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.name || t.name.indexOf('rvb:') !== 0) return;
    global.LabDealExtras._rvb(t.name.slice(4), parseFloat(t.value));
    Shell.render();
    var again = document.querySelector('[name="' + t.name + '"]');
    if (again) again.focus();
  });
})(window);
