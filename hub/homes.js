// Homes and affordability (step 4): the scenario's unit mix, priced by the public site's own
// ChfaRentLimits.rentSchedule from the pinned copy, then the handoff review and manual mix conversion.
// This file does no rent arithmetic of its own.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var P = global.LabProjects;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var BEDROOMS = ['efficiency', '1BR', '2BR', '3BR', '4BR'];
  var BR_LABEL = { efficiency: 'Studio', '1BR': '1 bedroom', '2BR': '2 bedrooms', '3BR': '3 bedrooms', '4BR': '4 bedrooms' };
  // The Deal Calculator's manual grid (js/deal-calculator.js DEAL_AMI_BANDS, SPLIT_BR_TYPES, RENT_BEDROOMS).
  // qa/homes.test.js fails if these drift from the pinned copy.
  var DEAL_AMI_BANDS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var CELL_FOR_BEDROOM = {};
  Object.keys(RENT_BEDROOMS).forEach(function (k) { CELL_FOR_BEDROOM[RENT_BEDROOMS[k]] = k; });

  var chfa = null;
  var chfaError = null;
  function loadChfa() {
    if (chfa || chfaError) return;
    fetch(VENDOR + 'data/chfa-income-rent-limits-2026.json').then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (t) { chfa = t; Shell.render(); })
      .catch(function () { chfaError = 'The CHFA rent table did not load. Reload the page to try again.'; Shell.render(); });
  }

  function money(n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function reasonText(code) { return code ? ChfaRentLimits.unavailableMessage(code) : ''; }

  function emptyDraft(p) {
    return { county_fips: '', total_units: '', vacancy_rate: '', use_hera_special: false,
      utility_allowance_basis: { method: '', reference: '', effective_date: '', resident_paid: [] },
      unit_mix: [{ bedrooms: '2BR', ami_tier: 60, count: '', proposed_gross_rent: '', utility_allowance: '', fees: '' }] };
  }

  function draftFor(p, scenarioId) {
    var o = p.overrides[scenarioId] && p.overrides[scenarioId].homesDraft;
    return o ? JSON.parse(JSON.stringify(o)) : emptyDraft(p);
  }

  // Inputs as typed become the subject shape the public site uses (js/components/subject-project.js).
  function subjectFrom(d) {
    var num = function (v) { return v === '' || v == null ? null : Number(v); };
    return {
      county_fips: d.county_fips || null, total_units: num(d.total_units),
      vacancy_rate: d.vacancy_rate === '' ? null : Number(d.vacancy_rate) / 100,
      use_hera_special: !!d.use_hera_special,
      utility_allowance_basis: d.utility_allowance_basis,
      unit_mix: d.unit_mix.map(function (r) {
        var market = r.ami_tier === 'market';
        return market
          ? { bedrooms: r.bedrooms, ami_tier: 'market', count: num(r.count), market_rent: num(r.market_rent), market_rent_source: r.market_rent_source || '' }
          : { bedrooms: r.bedrooms, ami_tier: Number(r.ami_tier), count: num(r.count), proposed_gross_rent: num(r.proposed_gross_rent), utility_allowance: num(r.utility_allowance), fees: r.fees === '' ? null : num(r.fees) };
      })
    };
  }

  function tiersFor(fips) {
    var row = chfa && chfa.counties.filter(function (c) { return c.fips === fips; })[0];
    var tiers = chfa ? chfa.meta.ami_tiers_regular.slice() : [];
    if (row && row.rural_resort && chfa.meta.ami_tiers_rural_resort) tiers = chfa.meta.ami_tiers_rural_resort.slice();
    return tiers;
  }

  function select(name, options, value, label, extra) {
    return '<label class="field"><span>' + esc(label) + '</span><select name="' + esc(name) + '"' + (extra || '') + '>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function input(name, value, label, type, extra) {
    return '<label class="field"><span>' + esc(label) + '</span><input name="' + esc(name) + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '></label>';
  }

  // One bar per row: CHFA's gross ceiling split into the rent to owner, the utility allowance, required fees and
  // any room left. Every part is the schedule's own figure; nothing is recomputed.
  function ceilingBar(res, r) {
    var cap = res.limit && res.limit.grossRent, rent = res.contractRent;
    var ua = Number(r.utility_allowance) || 0, fees = Number(r.fees) || 0;
    if (!(cap > 0) || rent == null || !isFinite(rent)) return '';
    var left = cap - rent - ua - fees;
    var parts = [['Rent to owner', rent, 'cb-rent'], ['Utility allowance', ua, 'cb-ua'], ['Fees', fees, 'cb-fee'], ['Room under the ceiling', Math.max(0, left), 'cb-room']].filter(function (x) { return x[1] > 0; });
    var whole = Math.max(cap, rent + ua + fees);
    return '<figure class="ceiling-bar"><figcaption>' + (left >= 0 ? 'Rent, allowance and fees use ' + Math.round((cap - left) / cap * 100) + '% of the ' + esc(money(cap)) + ' CHFA ceiling (gross)' : 'Rent, allowance and fees are ' + esc(money(-left)) + ' over the ' + esc(money(cap)) + ' CHFA ceiling') + '</figcaption>' +
      '<div class="cb-track" role="img" aria-label="' + esc(parts.map(function (x) { return x[0] + ' ' + money(x[1]); }).join(', ')) + '">' +
      parts.map(function (x) { return '<span class="' + x[2] + '" style="width:' + (x[1] / whole * 100).toFixed(2) + '%"></span>'; }).join('') + '</div>' +
      '<ul class="cb-key">' + parts.map(function (x) { return '<li><i class="' + x[2] + '"></i>' + esc(x[0]) + ' ' + esc(money(x[1])) + '</li>'; }).join('') + '</ul></figure>';
  }

  function homesView(params, parts) {
    var p = P.get(parts[1]);
    if (!p) return '<a class="back-link" href="#/projects">← Projects</a><h1>Project not found</h1>';
    var s = p.scenarios.filter(function (x) { return x.scenarioId === parts[2]; })[0];
    if (!s) return '<a class="back-link" href="#/project/' + esc(p.projectId) + '">← ' + esc(p.name) + '</a><h1>Scenario not found</h1>';
    loadChfa();
    var head = '<a class="back-link" href="#/project/' + esc(p.projectId) + '">← ' + esc(p.name) + '</a>' +
      '<h1>Homes and affordability</h1><p class="lede">' + esc(s.name) + '. Set the homes, who they are for, and their rents. Ceilings come from CHFA’s published table, checked by the site’s own code.</p>';
    var manual = p.overrides[s.scenarioId] && p.overrides[s.scenarioId].manualMix;
    if (manual) return head + manualSummary(p, s, manual);
    if (chfaError) return head + '<p class="callout">' + esc(chfaError) + '</p>';
    if (!chfa) return head + '<p role="status">Loading the CHFA rent table…</p>';
    var d = draftFor(p, s.scenarioId);
    var schedule = ChfaRentLimits.rentSchedule(subjectFrom(d), { chfaTable: chfa });
    var saved = p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0];
    var counties = [['', 'Choose a county']].concat(chfa.counties.map(function (c) { return [c.fips, c.county_name + ' County']; }));
    var tiers = tiersFor(d.county_fips).map(function (t) { return [t, t + '% of area median income']; }).concat([['market', 'Market rate (no limit)']]);
    var basis = d.utility_allowance_basis;
    var methods = [['', 'Choose how the allowance was set']].concat(ChfaRentLimits.ALLOWANCE_METHODS.map(function (m) { return [m.method, m.label]; }));

    var rows = d.unit_mix.map(function (r, i) {
      var res = schedule.rows[i] || {};
      var market = r.ami_tier === 'market';
      return '<fieldset class="mix-row" data-row="' + i + '"><legend>Row ' + (i + 1) + '</legend><div class="field-grid">' +
        select('bedrooms', BEDROOMS.map(function (b) { return [b, BR_LABEL[b]]; }), r.bedrooms, 'Size') +
        select('ami_tier', tiers, r.ami_tier, 'Who it is for') +
        input('count', r.count, 'Homes', 'number', ' min="1" step="1" inputmode="numeric"') +
        (market
          ? input('market_rent', r.market_rent, 'Market rent per month', 'number', ' min="0" step="1" inputmode="decimal"') + input('market_rent_source', r.market_rent_source, 'Where the market rent comes from')
          : input('proposed_gross_rent', r.proposed_gross_rent, 'Rent plus utilities per month (gross)', 'number', ' min="0" step="1" inputmode="decimal"') +
            input('utility_allowance', r.utility_allowance, 'Utility allowance per month', 'number', ' min="0" step="1" inputmode="decimal"') +
            input('fees', r.fees, 'Required monthly fees (blank if none)', 'number', ' min="0" step="1" inputmode="decimal"')) +
        '</div><dl class="row-result">' +
        (market ? '' : '<div><dt>CHFA ceiling (gross)</dt><dd>' + money(res.limit && res.limit.grossRent) + '</dd></div>' +
          '<div><dt>Highest allowed rent to owner</dt><dd>' + (res.maxNetRent != null ? money(res.maxNetRent) : '—') + '</dd></div>') +
        '<div><dt>Rent to owner</dt><dd>' + money(res.contractRent) + '</dd></div></dl>' +
        (market ? '' : ceilingBar(res, r)) +
        (res.rowReason ? '<p class="row-reason"><strong>Not priced:</strong> ' + esc(reasonText(res.rowReason)) + '</p>' : '') +
        (d.unit_mix.length > 1 ? '<button type="button" class="quiet small" data-remove-row="' + i + '">Remove row ' + (i + 1) + '</button>' : '') +
        '</fieldset>';
    }).join('');

    var t = schedule.totals;
    var totals = t.unavailableReason
      ? '<p class="callout"><strong>Not complete yet:</strong> ' + esc(reasonText(t.unavailableReason)) + '</p>'
      : '<dl class="totals"><div><dt>Homes</dt><dd>' + schedule.scheduledUnits + '</dd></div><div><dt>Rent-restricted</dt><dd>' + t.restrictedUnits + '</dd></div>' +
        '<div><dt>At or below 80% of median</dt><dd>' + Math.round(t.le80Share * 100) + '%</dd></div>' +
        '<div><dt>Average rent to owner</dt><dd>' + money(t.contractRent) + '</dd></div>' +
        '<div><dt>Scheduled rent per year</dt><dd class="key-figure">' + money(t.annualScheduledRent) + '</dd></div>' +
        '<div><dt>After vacancy</dt><dd>' + (t.effectiveRentAfterVacancy == null ? esc(reasonText(t.effectiveRentUnavailableReason)) : money(t.effectiveRentAfterVacancy)) + '</dd></div></dl>';

    return head +
      (saved ? '<p class="note">' + (global.LabProjects.isTemporary && global.LabProjects.isTemporary(p.projectId) ? 'Kept for this visit only, because this browser is not storing data. Download the deal file to keep it. Last kept ' : 'Saved to the project ') + esc(Shell.when(saved.attachedAt)) + (saved.state === 'stale' ? ' (out of date: ' + esc(saved.staleReason) + ')' : '') + '. Changes below are a draft until you save again.</p>' : '') +
      '<form class="homes" data-action="homes" novalidate>' +
      '<div class="field-grid">' + select('county_fips', counties, d.county_fips, 'County for rent limits') +
      input('total_units', d.total_units, 'Total homes in the project', 'number', ' min="1" step="1" inputmode="numeric"') +
      input('vacancy_rate', d.vacancy_rate, 'Vacancy assumption (%)', 'number', ' min="0" max="100" step="0.1" inputmode="decimal"') + '</div>' +
      '<fieldset><legend>Utility allowance basis</legend><div class="field-grid">' +
      select('ua_method', methods, basis.method, 'Method') + input('ua_reference', basis.reference, 'Schedule or source name') +
      input('ua_date', basis.effective_date, 'Effective date', 'date') + '</div>' +
      '<p class="field-label">Utilities residents pay</p><div class="checks">' + Object.keys(ChfaRentLimits.RESIDENT_UTILITIES).map(function (k) {
        return '<label><input type="checkbox" name="ua_paid" value="' + esc(k) + '"' + (basis.resident_paid.indexOf(k) > -1 ? ' checked' : '') + '> ' + esc(ChfaRentLimits.RESIDENT_UTILITIES[k]) + '</label>';
      }).join('') + '</div>' +
      (d.ua_notices && d.ua_notices.county ? '<p class="callout" role="status" data-role="allowance-county-notice">Location changed: the utility allowance must be re-sourced for the new jurisdiction.</p>' : '') +
      (d.ua_notices && d.ua_notices.source ? '<p class="callout" role="status" data-role="allowance-source-notice">Allowance source changed. Re-enter the amounts from the new source.</p>' : '') +
      '</fieldset>' +
      '<h2>Homes</h2>' + rows +
      '<button type="button" class="quiet" data-add-row>Add a row</button>' +
      '<h2>Result</h2>' + totals +
      '<p class="note">CHFA table: ' + esc(chfa.meta.source) + ', effective ' + esc(chfa.meta.effective_date) + '. <a href="' + esc(chfa.meta.source_url) + '">Source</a></p>' +
      '<div class="actions"><button type="submit">Save to ' + esc(s.name) + '</button>' +
      (saved ? '<a class="button-link secondary" href="#/handoff/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Review handoff to Financials</a>' +
        '<a class="button-link secondary" href="#/convert/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Copy these homes into the unit grid</a>' : '') +
      '</div></form>' +
      '<form class="cg-start" data-action="start-grid"><p class="note">Pricing with HOME, Prop 123, another income-limit formula or market rents, or want the Deal Calculator’s own grid of income level by size? ' +
      '<button type="submit" class="link-button">Start a scenario in the unit grid</button>. ' + esc(s.name) + ' stays as it is.</p></form>';
  }

  // The public site's Subject Project rules for a utility allowance (js/components/subject-project.js setSubject
  // and updateBasis), applied to the draft as it was (before) and as the form now reads (next):
  // - a new method clears the reference and date; changing to or from "owner pays all" also clears the utilities;
  // - a new method, reference, date or set of resident-paid utilities clears every entered allowance;
  // - a new county clears market rents and their sources, and (unless the owner pays) the reference, date and
  //   county binding, and every allowance;
  // - when the owner pays all utilities every allowance is $0;
  // - only naming a reference binds the source to the county; a date or utility change keeps the old binding.
  function applyAllowanceRules(before, next) {
    var ob = before.utility_allowance_basis || {}, basis = next.utility_allowance_basis;
    var sorted = function (a) { return JSON.stringify(Array.isArray(a) ? a.slice().sort() : a); };
    var methodChanged = (ob.method || '') !== basis.method;
    var referenceEdited = (ob.reference || '') !== basis.reference;
    var sourceChanged = referenceEdited || (ob.effective_date || '') !== basis.effective_date ||
      sorted(ob.resident_paid || []) !== sorted(basis.resident_paid);
    basis.bound_county_fips = referenceEdited ? next.county_fips : (ob.bound_county_fips || '');
    if (methodChanged && (basis.method === 'owner_pays_all' || ob.method === 'owner_pays_all')) { basis.reference = ''; basis.effective_date = ''; basis.resident_paid = []; }
    else if (methodChanged) { basis.reference = ''; basis.effective_date = ''; }
    var ownerPays = basis.method === 'owner_pays_all';
    var countyChanged = !!before.county_fips && before.county_fips !== next.county_fips;
    if (countyChanged) {
      next.unit_mix.forEach(function (r) { if (r.ami_tier === 'market') { r.market_rent = ''; r.market_rent_source = ''; } });
      if (!ownerPays) { basis.reference = ''; basis.effective_date = ''; basis.bound_county_fips = ''; }
    }
    if (ownerPays || methodChanged || sourceChanged || countyChanged) {
      next.unit_mix.forEach(function (r) { if (r.ami_tier !== 'market') r.utility_allowance = ownerPays ? '0' : ''; });
    }
    var notices = Object.assign({}, before.ua_notices);
    if (countyChanged && !ownerPays) notices.county = true;
    if ((methodChanged || sourceChanged) && !ownerPays) notices.source = true;
    var restricted = next.unit_mix.filter(function (r) { return r.ami_tier !== 'market'; });
    if (ownerPays || (restricted.length && restricted.every(function (r) { return r.utility_allowance !== '' && r.utility_allowance != null; }))) notices.source = false;
    if (ownerPays || ChfaRentLimits.allowanceBasisStatus(basis, next.county_fips).complete) notices.county = false;
    next.ua_notices = notices;
    return next;
  }

  function readForm(form, d) {
    var fd = new FormData(form);
    var before = JSON.parse(JSON.stringify(d));
    d.county_fips = fd.get('county_fips') || '';
    d.total_units = fd.get('total_units') || '';
    d.vacancy_rate = fd.get('vacancy_rate') || '';
    d.utility_allowance_basis = { method: fd.get('ua_method') || '', reference: fd.get('ua_reference') || '', effective_date: fd.get('ua_date') || '', resident_paid: fd.getAll('ua_paid') };
    d.unit_mix = Array.prototype.map.call(form.querySelectorAll('.mix-row'), function (fs) {
      var get = function (n) { var el = fs.querySelector('[name="' + n + '"]'); return el ? el.value : ''; };
      var tier = get('ami_tier');
      return tier === 'market'
        ? { bedrooms: get('bedrooms'), ami_tier: 'market', count: get('count'), market_rent: get('market_rent'), market_rent_source: get('market_rent_source') }
        : { bedrooms: get('bedrooms'), ami_tier: tier === '' ? '' : Number(tier), count: get('count'), proposed_gross_rent: get('proposed_gross_rent'), utility_allowance: get('utility_allowance'), fees: get('fees') };
    });
    return applyAllowanceRules(before, d);
  }

  function currentSchedule(p, s) {
    return p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0] || null;
  }

  function scheduleRows(att) {
    return '<div class="table-scroll" role="region" aria-label="Schedule rows" tabindex="0"><table><thead><tr><th scope="col">Size</th><th scope="col">For</th><th scope="col" class="num">Homes</th><th scope="col" class="num">CHFA ceiling</th><th scope="col" class="num">Allowance</th><th scope="col" class="num">Fees</th><th scope="col" class="num">Rent to owner</th></tr></thead><tbody>' +
      att.snapshot.result.rows.map(function (r) {
        return '<tr><td>' + esc(BR_LABEL[r.bedrooms]) + '</td><td>' + esc(r.isMarket ? 'Market' : r.amiTier + '% AMI') + '</td><td class="num">' + r.count + '</td><td class="num">' + money(r.limit && r.limit.grossRent) + '</td><td class="num">' + money(r.utilityAllowance) + '</td><td class="num">' + money(r.fees) + '</td><td class="num">' + money(r.contractRent) + (r.rowReason ? ' <span class="note">(' + esc(reasonText(r.rowReason)) + ')</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function handoffView(params, parts) {
    var p = P.get(parts[1]);
    var s = p && p.scenarios.filter(function (x) { return x.scenarioId === parts[2]; })[0];
    if (!s) return '<h1>Not found</h1><p><a href="#/projects">Projects</a></p>';
    var att = currentSchedule(p, s);
    var back = '<a class="back-link" href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">← Homes and affordability</a>';
    if (!att) return back + '<h1>Nothing to hand off</h1><p class="lede">Save a schedule first.</p>';
    var mix = ChfaRentLimits.dealMixFromSchedule(att.snapshot.result, { countyFips: att.snapshot.subject.county_fips, regime: 'chfa_lihtc' });
    var meta = att.snapshot.result.sourceMeta;
    var c = chfa && chfa.counties.filter(function (x) { return x.fips === meta.countyFips; })[0];
    return back + '<h1>Handoff to Financials</h1><p class="lede">Check what Financials will receive. Nothing changes until you continue.</p>' +
      '<dl class="facts">' +
      '<div><dt>Project</dt><dd>' + esc(p.name) + ', ' + esc(s.name) + '</dd></div>' +
      '<div><dt>Schedule</dt><dd>Saved ' + esc(Shell.when(att.attachedAt)) + (att.state === 'stale' ? ', out of date: ' + esc(att.staleReason) : '') + '</dd></div>' +
      '<div><dt>County and table</dt><dd>' + esc(c ? c.county_name + ' County' : meta.countyFips) + ', CHFA ' + esc(meta.tableYear) + ' table effective ' + esc(meta.effectiveDate) + '</dd></div>' +
      '<div><dt>Utility allowance</dt><dd>' + esc(meta.allowanceBasis.method || 'not set') + (meta.allowanceBasis.reference ? ', ' + esc(meta.allowanceBasis.reference) : '') + (meta.allowanceBasis.effectiveDate ? ', effective ' + esc(meta.allowanceBasis.effectiveDate) : '') + '</dd></div>' +
      '<div><dt>Vacancy</dt><dd>' + (meta.vacancyRate == null ? 'Not set' : (meta.vacancyRate * 100).toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>Goes to</dt><dd>Financials, on the COHO Deal Calculator</dd></div></dl>' +
      scheduleRows(att) +
      (mix.available ? '<p class="callout">Ready: ' + mix.restrictedRows.length + ' restricted row(s) and ' + mix.marketRows.length + ' market row(s), ' + mix.totalUnits + ' homes.</p>'
        : '<p class="callout"><strong>Not ready:</strong> ' + esc(ChfaRentLimits.unavailableMessage(mix.reason.replace(/^schedule_unavailable:/, '')) || mix.reason) + '</p>') +
      '<div class="actions">' + (mix.available ? '<a class="button-link" href="#/financials/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Continue to Financials</a>' : '<span class="button-link disabled" aria-disabled="true">Continue to Financials (the schedule is not ready)</span>') +
      '<a class="button-link secondary" href="#/project/' + esc(p.projectId) + '">Return without changing anything</a></div>';
  }

  // Decision 3 (2026-10-25): if any row cannot be shown in the calculator's manual grid, block the conversion and say why.
  function conversionPlan(att) {
    var rows = att.snapshot.result.rows;
    var cells = [], blocked = [];
    rows.forEach(function (r) {
      if (r.isMarket) blocked.push({ row: r, why: 'Market-rate homes have no place in the calculator’s manual grid, which lists rent-restricted bands only.' });
      else if (DEAL_AMI_BANDS.indexOf(Number(r.amiTier)) < 0) blocked.push({ row: r, why: 'The calculator’s manual grid has no ' + r.amiTier + '% band (it has ' + DEAL_AMI_BANDS.join(', ') + ').' });
      else if (!CELL_FOR_BEDROOM[r.bedrooms]) blocked.push({ row: r, why: 'The calculator’s manual grid has no column for this size.' });
      else cells.push({ tier: Number(r.amiTier), bedroomCell: CELL_FOR_BEDROOM[r.bedrooms], units: r.count, scheduleRent: r.contractRent, utilityAllowance: r.utilityAllowance, fees: r.fees, rowNumber: r.rowNumber });
    });
    return { cells: cells, blocked: blocked };
  }

  function convertView(params, parts) {
    var p = P.get(parts[1]);
    var s = p && p.scenarios.filter(function (x) { return x.scenarioId === parts[2]; })[0];
    if (!s) return '<h1>Not found</h1><p><a href="#/projects">Projects</a></p>';
    var att = currentSchedule(p, s);
    var back = '<a class="back-link" href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">← Back without changing anything</a>';
    if (!att) return back + '<h1>Nothing to convert</h1><p class="lede">Save a schedule first.</p>';
    var plan = conversionPlan(att);
    var head = back + '<h1>Copy these homes into the unit grid</h1><p class="lede">This copies the homes in ' + esc(s.name) + ' into a new scenario that is priced from the Deal Calculator’s unit grid: income level by size, with the rent limits you choose (CHFA, HOME, Prop 123, another formula or market). ' + esc(s.name) + ' keeps its linked schedule.</p>';
    if (plan.blocked.length) {
      return head + '<div class="callout"><strong>Can’t convert yet.</strong> ' + plan.blocked.length + ' row(s) would be lost, and this page never drops homes silently.</div>' +
        '<ul class="route-list">' + plan.blocked.map(function (b) {
          return '<li><span class="unlinked">Row ' + b.row.rowNumber + ': ' + esc(BR_LABEL[b.row.bedrooms]) + ', ' + esc(b.row.isMarket ? 'market' : b.row.amiTier + '% AMI') + ', ' + b.row.count + ' homes</span><p class="note">' + esc(b.why) + '</p></li>';
        }).join('') + '</ul><p>Keep using the linked schedule, or change these rows first.</p>';
    }
    return head + '<h2>What changes</h2><div class="table-scroll" role="region" aria-label="Conversion preview" tabindex="0"><table><thead><tr><th scope="col">Grid cell</th><th scope="col" class="num">Homes</th><th scope="col" class="num">Rent to owner now</th><th scope="col" class="num">Allowance now</th></tr></thead><tbody>' +
      plan.cells.map(function (c) {
        return '<tr><td>' + c.tier + '% AMI, ' + esc(BR_LABEL[RENT_BEDROOMS[c.bedroomCell]]) + '</td><td class="num">' + c.units + '</td><td class="num">' + money(c.scheduleRent) + '</td><td class="num">' + money(c.utilityAllowance) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<ul class="plain"><li>All ' + plan.cells.reduce(function (n, c) { return n + c.units; }, 0) + ' homes keep their band and size.</li>' +
      '<li>In the grid the calculator sets each rent from the rent limit for its income level and size, less the utility allowance and fees saved with these homes for that size. A rent you set below the limit here is not carried: the copy prices at the limit.</li>' +
      '<li>The county, table year and vacancy stay as saved.</li></ul>' +
      '<form data-action="convert"><button type="submit">Make the copy</button></form>';
  }

  function manualSummary(p, s, manual) {
    var from = p.scenarios.filter(function (x) { return x.scenarioId === manual.fromScenarioId; })[0];
    var open = '<div class="actions"><a class="button-link" href="#/financials/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Edit the homes and run Financials</a></div>';
    if (!manual.fromScenarioId) return '<p class="callout">The homes in this scenario are typed in the unit grid on its Financials page: income level by size, with the rent limits you choose.</p>' + open;
    return '<p class="callout">This scenario started as a copy of the homes in ' + esc(from ? from.name : 'another scenario') + ', made ' + esc(Shell.when(manual.convertedAt)) + '. Its homes are now edited in the unit grid on its Financials page.' +
      (from ? ' <a href="#/homes/' + esc(p.projectId) + '/' + esc(from.scenarioId) + '">Go back to the linked schedule in ' + esc(from.name) + '</a>' : '') + '</p>' + open +
      '<h2>The homes as copied</h2><div class="table-scroll" role="region" aria-label="Homes as copied" tabindex="0" data-no-source="the visitor’s own inputs"><table><thead><tr><th scope="col">Grid cell</th><th scope="col" class="num">Homes</th></tr></thead><tbody>' +
      manual.cells.map(function (c) { return '<tr><td>' + c.tier + '% AMI, ' + esc(BR_LABEL[RENT_BEDROOMS[c.bedroomCell]]) + '</td><td class="num">' + c.units + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  Shell.views.homes = homesView;
  Shell.views.handoff = handoffView;
  Shell.views.convert = convertView;

  var main = document.getElementById('main');
  function route() { return (location.hash || '').slice(2).split('?')[0].split('/'); }

  function saveDraft(form) {
    var parts = route();
    var p = P.get(parts[1]);
    var d = readForm(form, draftFor(p, parts[2]));
    P.setOverride(parts[1], parts[2], 'homesDraft', d);
    return { p: P.get(parts[1]), d: d, parts: parts };
  }

  // Recalculate as the visitor types, keeping focus on the field they were in.
  main.addEventListener('change', function (ev) {
    var form = ev.target.form;
    if (!form || form.dataset.action !== 'homes') return;
    var name = ev.target.name, row = ev.target.closest('.mix-row');
    var rowIndex = row ? row.dataset.row : null;
    saveDraft(form);
    Shell.render();
    var sel = (rowIndex != null ? '.mix-row[data-row="' + rowIndex + '"] ' : '') + '[name="' + name + '"]';
    var again = main.querySelector(sel);
    if (again) again.focus();
  });
  main.addEventListener('click', function (ev) {
    var form = ev.target.form || (ev.target.closest && ev.target.closest('form'));
    if (!form || form.dataset.action !== 'homes') return;
    if (ev.target.matches('[data-add-row]')) {
      var x = saveDraft(form);
      x.d.unit_mix.push({ bedrooms: '2BR', ami_tier: 60, count: '', proposed_gross_rent: '', utility_allowance: '', fees: '' });
      P.setOverride(x.parts[1], x.parts[2], 'homesDraft', x.d);
      Shell.render();
      var rows = main.querySelectorAll('.mix-row');
      rows[rows.length - 1].querySelector('select').focus();
    } else if (ev.target.matches('[data-remove-row]')) {
      var y = saveDraft(form);
      y.d.unit_mix.splice(Number(ev.target.dataset.removeRow), 1);
      P.setOverride(y.parts[1], y.parts[2], 'homesDraft', y.d);
      Shell.render();
    }
  });
  main.addEventListener('submit', function (ev) {
    var form = ev.target;
    var parts = route();
    if (form.dataset.action === 'homes') {
      var x = saveDraft(form);
      var subject = subjectFrom(x.d);
      var result = ChfaRentLimits.rentSchedule(subject, { chfaTable: chfa });
      P.attach(parts[1], parts[2], {
        kind: 'rent-schedule', label: (result.scheduledUnits || 0) + ' homes, ' + (result.totals.unavailableReason ? 'not complete' : 'priced'),
        snapshot: { subject: subject, result: JSON.parse(JSON.stringify(result)) },
        sourceDates: { chfaTable: chfa.meta.effective_date, chfaYear: chfa.meta.fiscal_year, allowance: subject.utility_allowance_basis.effective_date || null },
        methodVersions: { rentSchedule: 'Housing-Analytics ' + (global.LAB_PIN || '') + ' js/chfa-rent-limits.js' },
        origin: { route: '#/homes/' + parts[1] + '/' + parts[2] }
      });
      Shell.render();
    } else if (form.dataset.action === 'convert') {
      var p = P.get(parts[1]);
      var s = p.scenarios.filter(function (z) { return z.scenarioId === parts[2]; })[0];
      var plan = conversionPlan(currentSchedule(p, s));
      if (plan.blocked.length) return;
      var copy = P.addScenario(parts[1], 'Manual mix (copy of ' + s.name + ')', parts[2]);
      P.setOverride(parts[1], copy, 'manualMix', { fromScenarioId: parts[2], convertedAt: new Date().toISOString(), cells: plan.cells });
      // The copy's own Financials draft starts from the copied cells, not from a grid the source may have carried.
      var cd = P.get(parts[1]).overrides[copy].financialsDraft;
      if (cd && cd.grid) { delete cd.grid; P.setOverride(parts[1], copy, 'financialsDraft', cd); }
      location.hash = '#/financials/' + parts[1] + '/' + copy;
    } else if (form.dataset.action === 'start-grid') {
      // A new scenario with an empty grid, in the county chosen on this form if any. Nothing in this one changes.
      ev.preventDefault();
      var gp = P.get(parts[1]);
      var gd = draftFor(gp, parts[2]);
      var grid = P.addScenario(parts[1], 'Unit grid');
      P.setOverride(parts[1], grid, 'manualMix', { fromScenarioId: null, convertedAt: new Date().toISOString(), cells: [], countyFips: gd.county_fips || '' });
      location.hash = '#/financials/' + parts[1] + '/' + grid;
    }
  });

  global.LabHomes = { conversionPlan: conversionPlan, subjectFrom: subjectFrom, applyAllowanceRules: applyAllowanceRules, DEAL_AMI_BANDS: DEAL_AMI_BANDS, RENT_BEDROOMS: RENT_BEDROOMS };
})(window);
