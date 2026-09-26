/**
 * js/components/tax-abatement.js — F141
 * ======================================
 * Renders the curated tax-abatement / PILOT / fee-waiver / linkage
 * inventory for a jurisdiction. Pulls from data/tax-abatement-inventory.json.
 *
 * Two-layer lookup:
 *   1. If the jurisdiction (by GEOID) has its own entry, render it.
 *   2. Otherwise render the statewide statutory baseline (C.R.S.
 *      §39-3-112.5 nonprofit exemption) so the developer always
 *      sees something defensible.
 *
 * Fee waivers come only from data/policy/fee-reductions.json (verified
 * against each jurisdiction's own code). An inventory fee-waiver row with no
 * verified entry renders as "Not yet verified". attachCostReductions()
 * renders a geography's verified fee measures and land-use incentives for
 * the HNA local-resources panel; nothing here feeds any calculation.
 *
 * Usage:
 *   TaxAbatement.attach(container, {
 *     geoKey:    'place:0830780',   // place or county geoKey
 *     jurisName: 'Glenwood Springs'
 *   });
 */
(function (global) {
  'use strict';
  if (global.TaxAbatement) return;

  var _data    = null;
  var _promise = null;

  function _resolvePath(p) {
    if (typeof global.resolveAssetUrl === 'function') return global.resolveAssetUrl(p);
    return p;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _load() {
    if (_data) return Promise.resolve(_data);
    if (_promise) return _promise;
    _promise = fetch(_resolvePath('data/tax-abatement-inventory.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _data = d || { jurisdictions: [] }; return _data; })
      .catch(function (e) {
        console.warn('[TaxAbatement] fetch failed', e);
        return { jurisdictions: [] };
      });
    return _promise;
  }

  // Verified local fee reductions + land-use incentives
  // (data/policy/fee-reductions.json, schema fee-reductions/v1). This is
  // the single source of truth for fee waivers: the inventory's
  // fee-waiver rows point at it by id, and a row that no entry backs is
  // shown as not yet verified rather than as a program.
  var _fees = null;
  var _feesPromise = null;
  function _loadFees() {
    if (_fees) return Promise.resolve(_fees);
    if (_feesPromise) return _feesPromise;
    _feesPromise = fetch(_resolvePath('data/policy/fee-reductions.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _fees = d || { entries: [], land_use: [], meta: {} }; return _fees; })
      .catch(function (e) {
        console.warn('[TaxAbatement] fee-reductions fetch failed', e);
        return { entries: [], land_use: [], meta: {}, unavailable: true };
      });
    return _feesPromise;
  }

  var FEE_LABEL = {
    tap_water: 'Water tap fee', tap_sewer: 'Sewer tap fee',
    plant_investment: 'Plant investment fee', system_development: 'System development fee',
    impact_transportation: 'Transportation impact fee', impact_parks: 'Parks impact fee',
    impact_police_fire: 'Police / fire impact fee', impact_school: 'School impact fee',
    impact_other: 'Impact fees', building_permit: 'Building permit fee',
    plan_review: 'Plan review fee', use_tax: 'Construction use tax', utility_rate: 'Monthly utility rate'
  };
  var MEASURE_LABEL = {
    waived: 'Waived', reduced: 'Reduced', reimbursed: 'Paid by another source or refunded',
    deferred: 'Deferred — still owed', rate_discount: 'Monthly rate discount'
  };
  var LAND_LABEL = {
    density_bonus: 'Density bonus', parking_reduction: 'Parking reduction',
    by_right_or_admin_approval: 'By-right / administrative approval', expedited_review: 'Expedited review',
    inclusionary_zoning: 'Inclusionary zoning', adu_allowance: 'Accessory dwelling units',
    dimensional_relief: 'Dimensional relief', reduced_lot_size: 'Reduced lot size',
    affordable_housing_overlay: 'Affordable-housing overlay', land_dedication_or_donation: 'Land dedication / donation',
    other: 'Other land-use measure'
  };
  var BACKFILL_LABEL = {
    general_fund: 'the general fund pays the fee fund', housing_fund: 'a housing fund pays the fee fund',
    enterprise_absorbed: 'the utility absorbs it', grant: 'a grant pays it',
    reimbursement: 'the applicant pays, then is reimbursed', none: 'it is not backfilled',
    not_specified: 'the source does not say'
  };

  function _checkLine(v) {
    if (!v || !v.level) return 'Not yet verified';
    if (v.level === 'primary') return 'Checked against ' + (v.against || 'the primary source') + (v.checked ? ' on ' + v.checked : '');
    return 'As reported by ' + (v.by || 'the linked source') + (v.checked ? ' (read ' + v.checked + ')' : '') + '; not checked against the primary document';
  }

  function _eligibility(el) {
    if (!el) return '';
    var bits = [];
    if (el.ami_max != null) bits.push('up to ' + el.ami_max + '% AMI');
    if (el.tenure && el.tenure !== 'any') bits.push(el.tenure);
    if (el.deed_restriction_years != null) bits.push(el.deed_restriction_years + '-year restriction');
    if (el.by_right === true) bits.push('by right');
    else if (el.by_right === false) bits.push('needs approval');
    return bits.join(' · ');
  }

  function _renderFeeEntry(e, scopeNote) {
    var head = _esc(FEE_LABEL[e.fee_category] || e.fee_category) + ' — ' + _esc(MEASURE_LABEL[e.measure] || e.measure);
    var elig = _eligibility(e.eligibility);
    var paid = e.measure === 'deferred' ? '' :
      '<div class="ta-item__meta">How the waived amount is paid for: ' + _esc(BACKFILL_LABEL[(e.backfill || {}).method] || 'the source does not say') + '.</div>';
    return '<li class="ta-item" data-fee-entry="' + _esc(e.id) + '">' +
             '<div class="ta-item__head"><span class="ta-item__name">' + head + '</span>' +
               '<span class="ta-item__cat">' + _esc(e.provider) + '</span>' +
               (scopeNote ? '<span class="ta-item__cat">' + _esc(scopeNote) + '</span>' : '') + '</div>' +
             (e.summary ? '<div class="ta-item__summary">' + _esc(e.summary) + '</div>' : '') +
             (elig ? '<div class="ta-item__meta">Eligibility: ' + _esc(elig) + '</div>' : '') +
             paid +
             '<div class="ta-item__meta">' + _esc(_checkLine(e.verification)) +
               (e.source && e.source.url ? ' · <a href="' + _esc(e.source.url) + '" target="_blank" rel="noopener">' + _esc(e.source.label || 'Source') + '</a>' : '') +
             '</div>' +
           '</li>';
  }

  function _renderLandUse(l, scopeNote) {
    var elig = _eligibility(l.eligibility);
    return '<li class="ta-item" data-land-use="' + _esc(l.id) + '">' +
             '<div class="ta-item__head"><span class="ta-item__name">' + _esc(LAND_LABEL[l.measure] || l.measure) + '</span>' +
               '<span class="ta-item__cat">' + _esc(l.requirement_or_incentive === 'requirement' ? 'requirement' : l.requirement_or_incentive === 'both' ? 'requirement with incentives' : 'incentive') + '</span>' +
               (scopeNote ? '<span class="ta-item__cat">' + _esc(scopeNote) + '</span>' : '') + '</div>' +
             (l.detail ? '<div class="ta-item__summary">' + _esc(l.detail) + '</div>' : '') +
             (elig ? '<div class="ta-item__meta">Eligibility: ' + _esc(elig) + '</div>' : '') +
             '<div class="ta-item__meta">' + _esc(_checkLine(l.verification)) +
               (l.source && l.source.url ? ' · <a href="' + _esc(l.source.url) + '" target="_blank" rel="noopener">' + _esc(l.source.label || 'Source') + '</a>' : '') +
             '</div>' +
           '</li>';
  }

  // Entries that apply to a geography: its own, plus its county's (a
  // county program may apply only in unincorporated areas — labelled).
  function costReductionsFor(data, geoid, countyFips) {
    var own = function (x) { return x.geoid && x.geoid === geoid; };
    var county = function (x) { return countyFips && countyFips !== geoid && x.geoid === countyFips; };
    var entries = (data && data.entries) || [];
    var land = (data && data.land_use) || [];
    return {
      fees: entries.filter(own), countyFees: entries.filter(county),
      land: land.filter(own), countyLand: land.filter(county)
    };
  }

  function attachCostReductions(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading verified cost-reduction measures…</p>';
    _loadFees().then(function (data) {
      var name = opts.jurisName || 'this jurisdiction';
      if (data.unavailable) {
        container.innerHTML = '<p class="ta-empty">Unavailable: the verified fee-reduction dataset could not be loaded, so nothing is shown. This is not the same as “none”.</p>';
        return;
      }
      var hit = costReductionsFor(data, opts.geoid, opts.countyFips);
      var countyTag = 'county program — may apply only outside town limits';
      var out = [];
      out.push('<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
        'Screening context, not a study. Each item below was read from the jurisdiction’s own code, fee schedule or program page; nothing here is applied to any calculation. ' +
        'A deferred fee is still owed — it helps cash flow during construction but does not lower total development cost.</p>');
      var ORDER = { waived: 0, reduced: 1, reimbursed: 2, deferred: 3, rate_discount: 4 };
      var byMeasure = function (a, b) { return (ORDER[a.measure] - ORDER[b.measure]) || (a.id < b.id ? -1 : 1); };
      var programs = hit.fees.filter(function (e) { return (e.kind || 'program') === 'program'; }).sort(byMeasure);
      var countyPrograms = hit.countyFees.filter(function (e) { return (e.kind || 'program') === 'program'; }).sort(byMeasure);
      var past = hit.fees.filter(function (e) { return e.kind === 'project_award' || e.kind === 'repealed'; }).sort(byMeasure);
      if (programs.length || countyPrograms.length) {
        out.push('<h5 class="ta-subhead">Standing fee waivers, reductions and deferrals</h5><ul class="ta-list">' +
          programs.map(function (e) { return _renderFeeEntry(e, ''); }).join('') +
          countyPrograms.map(function (e) { return _renderFeeEntry(e, countyTag); }).join('') + '</ul>');
      } else {
        out.push('<p class="ta-empty"><strong>Fee waivers:</strong> none verified yet for ' + _esc(name) + '. ' +
          'That is not the same as none — the dataset covers the jurisdictions checked so far, and water and sewer taps are often charged by a separate district.</p>');
      }
      if (past.length) {
        out.push('<h5 class="ta-subhead">Past project awards and repealed programs — examples, not an offer</h5><ul class="ta-list">' +
          past.map(function (e) { return _renderFeeEntry(e, e.kind === 'repealed' ? 'repealed' : 'one project'); }).join('') + '</ul>');
      }
      if (hit.land.length || hit.countyLand.length) {
        out.push('<h5 class="ta-subhead">Land use and zoning that lowers cost</h5><ul class="ta-list">' +
          hit.land.map(function (l) { return _renderLandUse(l, ''); }).join('') +
          hit.countyLand.map(function (l) { return _renderLandUse(l, countyTag); }).join('') + '</ul>');
      } else {
        out.push('<p class="ta-empty"><strong>Land use and zoning incentives:</strong> none verified yet for ' + _esc(name) + '. Not the same as none.</p>');
      }
      if (window.MethodFooter) {
        out.push(window.MethodFooter.html({
          source:    'data/policy/fee-reductions.json (verified against primary sources)',
          sourceUrl: 'https://cohoanalytics.com/data/policy/fee-reductions.json',
          vintage:   data.meta && data.meta.as_of,
          method:    'Each entry quotes the source wording its figures rest on. Legal basis, how waived fees are paid for, and statewide trends: docs/methodology/LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md.',
          confidence:'med'
        }));
      }
      container.innerHTML = out.join('');
    });
  }

  function _ensureStyles() {
    if (document.getElementById('ta-styles')) return;
    var st = document.createElement('style');
    st.id = 'ta-styles';
    st.textContent = [
      '.ta-list { list-style:none; padding-left:0; margin:.4rem 0; }',
      '.ta-item {',
      '  padding:.5rem .65rem; margin-bottom:.4rem;',
      '  border:1px solid var(--border, rgba(0,0,0,.08)); border-radius:6px;',
      '  background: color-mix(in oklab, var(--bg2, #f3f4f6) 60%, transparent);',
      '}',
      '.ta-item__head { display:flex; flex-wrap:wrap; gap:.4rem; align-items:baseline; }',
      '.ta-item__name { font-weight:700; font-size:.92rem; }',
      '.ta-item__cat {',
      '  font-size:.68rem; font-weight:700; padding:1px 7px; border-radius:9px;',
      '  background:rgba(245,158,11,.15); color:#b45309;',
      '  border:1px solid rgba(245,158,11,.4);',
      '  text-transform:uppercase; letter-spacing:.03em;',
      '}',
      '.dark-mode .ta-item__cat { background:rgba(245,158,11,.2); color:#fbbf24; }',
      '.ta-item__summary { font-size:.82rem; margin-top:.3rem; line-height:1.45; }',
      '.ta-item__mag {',
      '  font-size:.78rem; margin-top:.25rem; padding:.2rem .5rem;',
      '  background:rgba(16,185,129,.12); color:#047857;',
      '  border-left:3px solid #16a34a; border-radius:0 4px 4px 0;',
      '  display:inline-block; font-weight:600;',
      '}',
      '.dark-mode .ta-item__mag { background:rgba(16,185,129,.18); color:#34d399; }',
      '.ta-empty { color:var(--muted); font-size:.85rem; padding:.5rem 0; }',
      '.ta-item__meta { font-size:.76rem; color:var(--muted); margin-top:.2rem; line-height:1.4; }',
      '.ta-subhead { font-size:.86rem; margin:.6rem 0 .2rem; }',
      '.ta-item__unverified { font-size:.68rem; font-weight:700; padding:1px 7px; border-radius:9px; border:1px dashed var(--muted); color:var(--muted); }',
      '.ta-baseline { font-size:.78rem; color:var(--muted); margin:.5rem 0 0; padding-left:.4rem; border-left:3px solid rgba(0,0,0,.1); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // A fee-waiver row in the older inventory is shown only through the
  // verified dataset: backed rows render the verified entries; the rest
  // carry a "Not yet verified" tag and no magnitude.
  function _renderProgram(p, fees) {
    if (p.category === 'fee-waiver') {
      var ids = Array.isArray(p.fee_reductions_ids) ? p.fee_reductions_ids : [];
      var backed = ((fees && fees.entries) || []).filter(function (e) { return ids.indexOf(e.id) !== -1; });
      if (backed.length) {
        return backed.map(function (e) { return _renderFeeEntry(e, ''); }).join('');
      }
      return '<li class="ta-item">' +
               '<div class="ta-item__head"><span class="ta-item__name">' + _esc(p.name) + '</span>' +
                 '<span class="ta-item__unverified">Not yet verified</span></div>' +
               '<div class="ta-item__meta">' + _esc(p.verification_note || 'Listed in an older inventory; not yet checked against the jurisdiction’s own code or fee schedule.') + '</div>' +
             '</li>';
    }
    return '<li class="ta-item">' +
             '<div class="ta-item__head">' +
               (p.url
                 ? '<a href="' + _esc(p.url) + '" target="_blank" rel="noopener" class="ta-item__name">' + _esc(p.name) + '</a>'
                 : '<span class="ta-item__name">' + _esc(p.name) + '</span>') +
               (p.category ? '<span class="ta-item__cat">' + _esc(p.category.replace(/-/g, ' ')) + '</span>' : '') +
             '</div>' +
             (p.summary ? '<div class="ta-item__summary">' + _esc(p.summary) + '</div>' : '') +
             (p.magnitude ? '<div class="ta-item__mag">' + _esc(p.magnitude) + '</div>' : '') +
           '</li>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading tax abatement inventory…</p>';
    Promise.all([_load(), _loadFees()]).then(function (both) {
      var data = both[0], fees = both[1];
      var entry = (data.jurisdictions || []).find(function (j) {
        return Array.isArray(j.geoKeys) && j.geoKeys.indexOf(opts.geoKey) !== -1;
      });

      var rendered = [];
      // 1. Specific jurisdiction programs
      if (entry && Array.isArray(entry.programs) && entry.programs.length) {
        rendered.push(
          '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
          'Curated for <strong>' + _esc(entry.name) + '</strong>. Verify before underwriting — programs change yearly.' +
          '</p>',
          '<ul class="ta-list">' + entry.programs.map(function (p) { return _renderProgram(p, fees); }).join('') + '</ul>'
        );
      } else {
        rendered.push(
          '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
            'No jurisdiction-specific abatement program on file for ' + _esc(opts.jurisName || 'this jurisdiction') + '. ' +
            'Statewide statutory exemption (below) is the operative tool.' +
          '</p>'
        );
      }

      // 2. State baseline (always shown as floor / fallback)
      if (data.metadata && data.metadata.state_baseline) {
        var sb = data.metadata.state_baseline;
        rendered.push(
          '<div class="ta-baseline">' +
            '<strong>Statewide baseline (default for 501(c)(3) ≤ 60% AMI):</strong> ' +
            (sb.url
              ? '<a href="' + _esc(sb.url) + '" target="_blank" rel="noopener">' + _esc(sb.note) + '</a>'
              : _esc(sb.note)) +
          '</div>'
        );
      }

      // 3. Methodology footer
      if (window.MethodFooter) {
        rendered.push(window.MethodFooter.html({
          source:    'data/tax-abatement-inventory.json (curated)',
          sourceUrl: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/tax-abatement-inventory.json',
          vintage:   data.metadata && data.metadata.generated,
          method:    'Curated from each jurisdiction\'s published affordable-housing ordinance, IGA, or property-tax abatement program page. Top 30 CO jurisdictions where affordable housing is actively developing.',
          confidence:'med'
        }));
      }

      container.innerHTML = rendered.join('');
    });
  }

  function loadRoster() { return _load(); }

  global.TaxAbatement = {
    attach: attach, loadRoster: loadRoster,
    attachCostReductions: attachCostReductions,
    loadFeeReductions: _loadFees,
    costReductionsFor: costReductionsFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
