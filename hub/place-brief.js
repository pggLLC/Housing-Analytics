// A county's housing needs summary (reorg step 2, Places pilot; paul 22 Nov 2026 "do the reorg").
// The prose page that opens a county: five findings, renters and owners side by side with a benchmark beside each
// figure, homes needed 2026 to 2036, and area median income in dollars. It is the 16 Nov format trial
// (state-hna-comparison-2026-11-15/format-trial), now the county's first tab, "Summary". The Overview and the five
// chapters are unchanged, one tab away.
// Every figure is read from the files the needs assessment already reads (the HNA digest and summary, the county
// forecast and the AMI gap file); the only arithmetic is sums, differences and rounding for prose. Each figure names
// its survey and years from the digest's own as_of. The state assessment's regional figures in the trial are left
// out until paul decides the state comparison proposals (P1 to P9).
// Towns keep the Overview as their first tab: the forecast and the AMI gap file are county files.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;

  var num = function (n) { return n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'); };
  var money = function (n) { return n == null || !isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString('en-US'); };
  // Prose rounding, as the state report does: nearest 10 under 1,000, nearest 100 above.
  var about = function (n) { if (n == null || !isFinite(n)) return '—'; var a = Math.abs(n), r = a >= 1000 ? 100 : 10; return num(Math.round(n / r) * r); };
  var pct = function (x, d) { return x == null || !isFinite(x) ? '—' : x.toFixed(d == null ? 1 : d) + '%'; };

  var cache = {};
  function getJson(p) { return fetch(global.LAB_VENDOR + p).then(function (r) { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }); }
  function load(g) {
    if (cache[g]) return cache[g];
    var c = cache[g] = { ready: false, err: null };
    var hna = global.LAB_HNA_LOAD ? global.LAB_HNA_LOAD(g)
      : Promise.all([getJson('data/hna/jurisdiction-metrics-digest/' + g + '.json'), getJson('data/hna/summary/' + g + '.json')]);
    Promise.all([hna, getJson('data/hna/projections/' + g + '.json'), getJson('data/co_ami_gap_by_county.json')]).then(function (r) {
      c.digest = r[0][0]; c.summary = r[0][1]; c.proj = r[1];
      var cs = r[2].counties; cs = Array.isArray(cs) ? cs : Object.keys(cs).map(function (k) { return cs[k]; });
      c.gap = cs.filter(function (x) { return x.fips === g; })[0] || null;
      c.ready = true; Shell.render();
    }).catch(function (e) { c.err = String(e && e.message || e); Shell.render(); });
    return c;
  }

  // Sources, named by the digest's own as_of where it has one.
  var ACS_URL = 'https://data.census.gov/table/ACSDP5Y2024.DP04';
  function src(metric, fallback, url) {
    var label = (metric && metric.as_of) || fallback;
    label = String(label).replace(/^ACS (\d{4})-(\d{4}) 5-year$/, 'Census ACS $1–$2').replace(/^HUD CHAS (\d{4})-(\d{4})$/, 'HUD CHAS $1–$2');
    return url ? '<a href="' + esc(url) + '">' + esc(label) + '</a>' : esc(label);
  }
  var CHAS_URL = 'https://www.huduser.gov/portal/datasets/cp.html', SDO_URL = 'https://demography.dola.colorado.gov/', HUD_URL = 'https://www.huduser.gov/portal/datasets/il.html';

  function html(g, entryLabel) {
    var c = load(g);
    if (c.err) return '<div class="callout" role="alert"><p>The summary’s files did not load: ' + esc(c.err) + '. The <a href="#/place/' + esc(g) + '/overview">Overview</a> has the same figures.</p></div>';
    if (!c.ready) return '<p role="status" class="note is-loading">Loading the summary…</p>';
    var M = c.digest.metrics || {}, m = {};
    Object.keys(M).forEach(function (k) { m[k] = M[k] && M[k].value; });
    var a = (c.summary && c.summary.acsProfile) || {};
    var short = String(entryLabel || g).replace(/ County$/, '') + ' County';
    var hn = c.proj.housing_need || {}, ys = c.proj.years || [];
    var at = function (xs, y) { var i = ys.indexOf(y); return i > -1 && xs ? xs[i] : null; };
    // A ten-year change only when both ends are published: a missing end is never read as zero (Codex, HA #2968).
    var fin = function (x) { return typeof x === 'number' && isFinite(x); };
    var diff = function (xs) { var a = at(xs, 2026), b = at(xs, 2036); return fin(a) && fin(b) ? b - a : null; };
    var grow10 = diff(hn.incremental_units_needed_dola);
    var lost10 = diff((hn.replacement || {}).cumulative_units);
    var need10 = grow10 == null ? null : grow10 + (lost10 > 0 ? lost10 : 0);
    var noRep = lost10 == null ? ' The replacement estimate is not published for ' + esc(short) + ', so this counts growth only.' : '';
    var ownShare = hn.tenure_split && hn.tenure_split.owner_share != null ? hn.tenure_split.owner_share : (a.DP04_0046PE != null ? a.DP04_0046PE / 100 : null);
    var hh26 = at(hn.households_dola, 2026), hh36 = at(hn.households_dola, 2036);
    var gp = c.gap || {}, le30 = (gp.households_le_ami_pct || {})['30'], homes30 = (gp.units_priced_affordable_le_ami_pct || {})['30'], rent30 = (gp.affordable_rent_monthly || {})['30'];
    // Homes short is the file's matched minimum (cheapest homes to the lowest incomes first, homes rented for no cash
    // rent counted as housing someone), not households minus cash-rent homes (Codex, HA #2968).
    var mm = (gp.min_shortfall_matched_le_ami_pct || {})['30'], short30 = fin(mm) && mm >= 0 ? mm : null;
    var noCash = gp.renter_units_no_cash_rent, ami = gp.ami_4person;
    var renters = a.DP04_0047E, owners = a.DP04_0046E, rentPct = a.DP04_0047PE, ownPct = a.DP04_0046PE;
    var rb = m.pct_cost_burdened, ob = m.pct_owner_burdened_30plus, inc = m.median_hh_income, val = m.median_home_value;
    var stock100 = m.pct_owner_stock_affordable_100ami, grow20 = m.future_units_needed_20yr, decline = grow10 != null && grow10 < 0;
    var S = {
      rent: src(M.pct_cost_burdened, 'Census ACS', ACS_URL), own: src(M.pct_owner_burdened_30plus, 'HUD CHAS', CHAS_URL),
      value: src(M.median_home_value, 'Census ACS', ACS_URL), stock: src(M.pct_owner_stock_affordable_100ami, 'Census ACS', ACS_URL),
      vac: src(M.raw_rental_vacancy_rate_pct, 'Census ACS', ACS_URL), acs: src(null, 'Census ACS 2020–2024', ACS_URL),
      sdo: '<a href="' + SDO_URL + '">State Demography Office forecast, 2025</a>', hud: '<a href="' + HUD_URL + '">HUD FY2026 income limits</a>'
    };

    // 1. Five things to know: three for renters, two for owners, each a full sentence with its years.
    var f = [];
    if (grow10 == null) f.push('<strong>The forecast file has no 2026 to 2036 homes-needed figure for ' + esc(short) + '</strong>, so this summary gives none. The <a href="#/place/' + esc(g) + '/future">Where it’s heading</a> chapter shows what the forecast has (' + S.sdo + ').');
    else f.push(decline
      ? '<strong>' + esc(short) + '’s forecast has fewer households in 2036 than today</strong>, so growth adds no homes.' + (lost10 != null ? ' About ' + about(lost10) + ' homes will still need replacing as they wear out' : noRep) + ' (' + S.sdo + '; COHO estimate).'
      : '<strong>' + esc(short) + ' needs about ' + about(need10) + ' more homes from 2026 to 2036</strong>: ' + num(grow10) + ' for new households' + (lost10 != null ? ' and ' + num(lost10) + ' to replace homes that wear out.' : '.' + noRep) +
        (ownShare != null ? ' If new households own and rent as today’s do, that is about ' + about(need10 * ownShare) + ' owner homes and ' + about(need10 * (1 - ownShare)) + ' rental homes.' : '') + ' (' + S.sdo + '; COHO estimate.)');
    if (short30 != null && le30 != null && homes30 != null) f.push(short30 > 0
      ? '<strong>The deepest shortage is for the lowest-income renters.</strong> ' + num(le30) + ' renter households earn 30% of area median income or less (about ' + money(ami * 0.3) + ' a year for a family of four). Only ' + num(homes30) + ' homes rent for what they can pay, ' + money(rent30) + ' a month or less. Even if all of them' + (noCash > 0 ? ', and the ' + num(noCash) + ' homes rented for no cash rent,' : '') + ' went to these households, at least ' + num(short30) + ' would be short (' + S.acs + '; ' + S.hud + ').'
      : '<strong>At 30% of area median income, homes priced for renters' + (noCash > 0 ? ' and homes rented for no cash rent' : '') + ' at least match renters in number</strong> (' + num(homes30) + ' homes, ' + num(le30) + ' renter households), but many of those homes are rented by higher earners (' + S.acs + ').');
    f.push('<strong>' + pct(rb) + ' of renter households pay 30% or more of income on rent and utilities.</strong> For owner households it is ' + pct(ob) + ' (renters: ' + S.rent + '; owners: ' + S.own + ').');
    if (val && inc) f.push('<strong>The typical home is worth ' + money(val) + ', ' + (val / inc).toFixed(1) + ' times the typical household’s income of ' + money(inc) + '.</strong> Lenders’ rule of thumb is about three times (' + S.value + ').');
    if (stock100 != null) f.push('<strong>' + pct(stock100, 0) + ' of owner-occupied homes are worth what a household at area median income can buy.</strong> The rest are out of reach without more income or savings (' + S.stock + '; ' + S.hud + ').');

    var out = '<section class="pb-summary" aria-labelledby="pb-h">' +
      '<p class="page-answer">Who needs housing here, what they can pay, and how many homes the next ten years take, for renters and owners.</p>' +
      '<h2 id="pb-h">Five things to know</h2><ol class="pb-findings">' + f.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
      '<p class="pb-why"><strong>Why it matters:</strong> rents at 30% of area median income rarely get built without deep public help, such as vouchers tied to the homes on top of tax credits.</p>';

    // 2. Renters and owners side by side, each figure with its benchmark beside it.
    var tile = function (v, label, bench) { return '<div class="pb-tile"><b>' + v + '</b><span>' + esc(label) + '</span>' + (bench ? '<small>' + bench + '</small>' : '') + '</div>'; };
    out += '<h2>Renters and owners</h2><div class="pb-sides">' +
      '<div class="pb-side"><h3 class="pb-tag pb-tag-rent">Renters</h3>' +
        tile(num(renters), 'renter households (' + pct(rentPct) + ')', S.acs) +
        tile(pct(rb), 'pay 30% or more of income on rent', 'The usual line is 30%. ' + S.rent) +
        tile(pct(m.raw_rental_vacancy_rate_pct), 'of rental homes stand empty', '5% to 7% is a balanced rental market. ' + S.vac) +
      '</div><div class="pb-side"><h3 class="pb-tag pb-tag-own">Owners</h3>' +
        tile(num(owners), 'owner households (' + pct(ownPct) + ')', S.acs) +
        tile(pct(ob), 'pay 30% or more of income on housing', 'The usual line is 30%. ' + S.own) +
        tile(stock100 != null ? pct(stock100, 0) : '—', 'of owner homes are worth what a household at area median income can buy', S.stock + '; HUD FY2026 limits') +
      '</div></div><p class="note">Renter and owner figures come from different surveys and years; each names its own.</p>';

    // 3. Homes needed: one headline, its parts, the other counts in a fold.
    out += '<h2>Homes needed, 2026 to 2036</h2>' +
      (grow10 == null ? '<p>The forecast file has no 2026 to 2036 figure for ' + esc(short) + '.</p>'
      : decline ? '<p><strong>' + esc(short) + '’s forecast has ' + (fin(hh26) && fin(hh36) ? num(Math.abs(hh36 - hh26)) + ' ' : '') + 'fewer households in 2036.</strong> Growth adds no homes' + (lost10 != null ? '; about ' + about(lost10) + ' still need replacing as they wear out.' : '.' + noRep) + '</p>'
        : '<p><strong>About ' + about(need10) + ' more homes</strong>' + (grow20 ? '. Over 20 years, 2024 to 2044, the figure is about ' + about(grow20) + ', counting workers who commute in and might move closer.' : '.') + '</p>' +
          '<ul><li>' + num(grow10) + ' for ' + (fin(hh26) && fin(hh36) ? num(hh36 - hh26) + ' ' : '') + 'new households, with room for people to move.</li>' +
          (lost10 != null ? '<li>' + num(lost10) + ' to replace homes that wear out or are torn down.</li>' : '<li>' + noRep.trim() + '</li>') +
          (ownShare != null ? '<li>About ' + about(need10 * ownShare) + ' owner homes and ' + about(need10 * (1 - ownShare)) + ' rental homes, if new households own and rent like today’s.</li>' : '') + '</ul>') +
      (short30 > 0 ? '<p><strong>On top of that, today’s shortage:</strong> at least ' + num(short30) + ' rental homes for renter households at 30% of area median income or less (renters only). It is a minimum: it assumes every home priced for them goes to them.</p>' : '') +
      '<details class="pb-fold"><summary>How this works, and other ways to count</summary><ul>' +
        '<li>We take the forecast’s new households and add enough homes to leave about 5 in every 100 empty so people can move, then add homes lost to age (yearly loss rates by building age, from the Census year-built count).</li>' +
        (grow20 ? '<li>Over 20 years, 2024–2044: ' + num(grow20) + ' homes, resident growth plus workers who commute in and might move closer (the Overview’s headline).</li>' : '') +
        '<li>DOLA’s local-assessment method, 2024–2034: on the <a href="#/place/' + esc(g) + '/dola">For DOLA</a> tab.</li>' +
        '<li>Low and high growth: the <a href="#/places/scenario?g=' + esc(g) + '">scenario builder</a>.</li>' +
      '</ul></details>';

    // 4. Area median income in dollars.
    if (ami) {
      var rows = [[30, 'Up to 30%', 'Many are older adults on fixed incomes, people with disabilities, or one full-time worker at low pay.'],
        [50, '30% to 50%', 'Often too much income for the deepest help, too little for market rents.'],
        [80, '50% to 80%', 'Many working households; the band most tax credit homes serve (up to 60%) sits here.'],
        [100, '80% to 100%', 'Often called the missing middle: too much for most programs, short of the typical home.']];
      out += '<h2>Area median income in dollars</h2><p>HUD sets area median income (AMI) for ' + esc(short) + ' at ' + money(ami) + ' for a family of four (' + S.hud + '). Each band, in dollars and rent:</p>' +
        '<div class="table-scroll"><table class="pb-table" data-nosort data-no-sort><thead><tr><th scope="col">Band</th><th scope="col" class="num">Family of four earns up to</th><th scope="col" class="num">Rent it can pay</th><th scope="col">Who is often here</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><th scope="row">' + r[1] + '</th><td class="num">about ' + money(ami * r[0] / 100) + '</td><td class="num">' + money((gp.affordable_rent_monthly || {})[String(r[0])]) + ' a month</td><td>' + esc(r[2]) + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="note">Dollar limits are the percent of the four-person median; HUD’s own limit for a band can differ slightly. Rent is 30% of that income, utilities included.</p>';
    }

    // 5. Go to the tools.
    out += '<h2>Go deeper</h2><ul class="pb-tools">' +
      [['overview', 'Overview', 'Every headline figure, with margins of error and the data-strength note'], ['people', 'Who lives here', 'Households, incomes and who commutes in'],
        ['housing', 'What housing exists', 'Homes by type, age and vacancy'], ['afford', 'What households can afford', 'The gap at each income band'],
        ['future', 'Where it’s heading', 'The forecast, year by year'], ['action', 'What to do about it', 'Homes needed and where to start']].map(function (t) {
        return '<li><a href="#/place/' + esc(g) + '/' + t[0] + '"><strong>' + esc(t[1]) + '</strong><span>' + esc(t[2]) + '</span></a></li>';
      }).join('') + '</ul></section>';
    return out;
  }

  global.LabPlaceBrief = { html: html, forCounty: function (g) { return /^08\d{3}$/.test(String(g)); } };
})(window);
