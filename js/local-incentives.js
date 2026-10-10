/**
 * js/local-incentives.js
 * Renders local-incentives.html from the hand-verified incentive files.
 * All joining and counting is in js/local-incentives-data.js; this file only
 * draws it. A blank is never drawn as "none": every jurisdiction and scope
 * says whether it has records, was checked and found none, could not be read,
 * or has not been checked yet.
 */
(function (global) {
  'use strict';

  var FILES = {
    geoConfig: 'data/hna/geo-config.json',
    fees: 'data/policy/fee-reductions.json',
    funds: 'data/policy/local-housing-funds.json',
    coverage: 'data/policy/incentive-coverage.json',
    prop123: 'data/policy/prop123_jurisdictions.json',
    alternatives: 'data/policy/incentive-alternatives.json'
  };

  var STATE_TEXT = {
    records: 'Verified records',
    none_found: 'Checked, none found',
    unreadable: 'Official source could not be read',
    not_checked: 'Not yet checked'
  };
  var STATE_PILL = { records: 'pill good', none_found: 'pill', unreadable: 'pill warn', not_checked: 'pill warn' };
  var SCOPE_TEXT = { fees: 'Fee relief', land_use: 'Land-use incentives', funds: 'Local funding and ownership tools' };
  var STATUS_TEXT = {
    authorized: 'Authorized',
    authorized_with_voter_approval: 'Needs voter approval',
    restricted: 'Restricted',
    prohibited_for_new: 'Closed to new adoption',
    not_usable_for_housing: 'Revenue cannot fund housing',
    unclear: 'Legal basis unclear'
  };
  var FAMILY_TEXT = {
    fee_relief: 'Fee relief',
    land_use: 'Land use',
    local_revenue: 'Local revenue',
    land_and_ownership: 'Land and ownership',
    tax_relief: 'Tax relief'
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function longDate(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }

  function safeUrl(url) {
    return /^https:\/\//.test(String(url || '')) ? String(url) : null;
  }

  function sourceLink(record) {
    var src = record.source || {};
    var url = safeUrl(src.url);
    var label = src.label || 'Source';
    return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : esc(label);
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      return response.json();
    });
  }

  function pill(state) {
    return '<span class="' + STATE_PILL[state] + '">' + esc(STATE_TEXT[state]) + '</span>';
  }

  function money(n) {
    return typeof n === 'number' && isFinite(n) && n > 0 ? '$' + n.toLocaleString('en-US') : null;
  }

  function reviewWarning(record) {
    if (!global.ReviewStatus) return '';
    return global.ReviewStatus.html({
      review_by: record.review_by,
      last_verified: record.last_verified || (record.verification && record.verification.checked)
    });
  }

  function verificationLine(record) {
    var v = record.verification || {};
    var level = v.level === 'reported' ? 'Reported (not read from the primary document)' : 'Read from the primary source';
    var checked = longDate(v.checked || record.last_verified);
    return '<p class="li-meta">' + esc(level) + (checked ? ' · checked ' + esc(checked) : '') +
      (record.review_by ? ' · re-check by ' + esc(longDate(record.review_by)) : '') + ' · ' + sourceLink(record) + '</p>';
  }

  function evidenceBlock(record) {
    var ev = record.evidence || [];
    if (!ev.length) return '';
    return '<details class="li-evidence"><summary>Source wording (' + ev.length + ')</summary>' +
      ev.map(function (e) {
        return '<blockquote><p>' + esc(e.quote) + '</p><footer>' + esc(e.section || '') + '</footer></blockquote>';
      }).join('') + '</details>';
  }

  function eligibilityText(el) {
    if (!el) return 'Eligibility not stated';
    var parts = [];
    if (typeof el.ami_max === 'number') parts.push('up to ' + el.ami_max + '% AMI');
    if (el.tenure && el.tenure !== 'any') parts.push(el.tenure);
    if (typeof el.deed_restriction_years === 'number') parts.push(el.deed_restriction_years + '-year restriction');
    if (el.by_right === true) parts.push('by right');
    if (el.by_right === false) parts.push('discretionary');
    return parts.length ? parts.join(' · ') : 'Eligibility terms not published in the source';
  }

  function feeValue(r) {
    var D = global.LocalIncentivesData;
    var bits = [D.FEE_MEASURE_LABELS[r.measure] || r.measure];
    if (typeof r.percent === 'number') bits.push(r.percent + '%');
    if (money(r.amount)) bits.push(money(r.amount));
    if (r.amount == null && r.percent == null && r.measure !== 'deferred') bits.push('amount not published');
    return bits.join(' · ');
  }

  function kindNote(r) {
    if (r.kind === 'project_award') return ' <span class="tag tag-ghost">One project</span>';
    if (r.kind === 'repealed' || r.status === 'repealed' || r.status === 'expired') return ' <span class="tag tag-red">No longer in effect</span>';
    if (r.status === 'ballot_failed') return ' <span class="tag tag-red">Failed at the ballot</span>';
    return '';
  }

  // ── Fee components: one row per component, relieved or not ──────────────
  function renderFees(p) {
    var D = global.LocalIncentivesData;
    var fees = p.items.filter(function (i) { return i.scope === 'fees'; }).map(function (i) { return i.record; });
    var state = p.states.fees;
    var rows = D.FEE_COMPONENTS.map(function (c) {
      var mine = fees.filter(function (r) { return D.componentOf(r) === c.id; });
      if (!mine.length) {
        var none = state === 'records' || state === 'none_found' ? 'No relief found in the sources read' : STATE_TEXT[state];
        return '<tr><th scope="row">' + esc(c.label) + '</th><td colspan="2" class="li-muted">' + esc(none) + '</td></tr>';
      }
      return mine.map(function (r, idx) {
        return '<tr>' + (idx === 0 ? '<th scope="row" rowspan="' + mine.length + '">' + esc(c.label) + '</th>' : '') +
          '<td><strong>' + esc(feeValue(r)) + '</strong>' + kindNote(r) + '<br><span>' + esc(r.summary || '') + '</span>' +
          (r.deferral_trigger ? '<br><span class="li-muted">Paid at: ' + esc(r.deferral_trigger) + '</span>' : '') +
          (r.provider && r.provider !== r.jurisdiction ? '<br><span class="li-muted">Charged by ' + esc(r.provider) + '</span>' : '') +
          reviewWarning(r) + evidenceBlock(r) + '</td>' +
          '<td>' + esc(eligibilityText(r.eligibility)) + (r.authorizing_code ? '<br><span class="li-muted">' + esc(r.authorizing_code) + '</span>' : '') +
          verificationLine(r) + '</td></tr>';
      }).join('');
    }).join('');
    return '<section class="li-block" aria-labelledby="li-fees-h"><h3 id="li-fees-h">' + esc(SCOPE_TEXT.fees) + ' ' + pill(state) + '</h3>' +
      '<div class="data-table li-stack"><table><thead><tr><th scope="col">Fee component</th><th scope="col">What is offered</th><th scope="col">Who qualifies, and the source</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></section>';
  }

  function renderList(p, scope) {
    var D = global.LocalIncentivesData;
    var items = p.items.filter(function (i) { return i.scope === scope; }).map(function (i) { return i.record; });
    var state = p.states[scope];
    var body;
    if (!items.length) {
      var note = p.ledger && p.ledger.note ? ' ' + esc(p.ledger.note) : '';
      body = '<p class="li-muted">' + esc(STATE_TEXT[state]) + '.' + (state === 'not_checked' ? ' A blank here does not mean the jurisdiction has no such tool.' : note) + '</p>';
    } else {
      body = '<div class="li-cards">' + items.map(function (r) {
        var title = scope === 'land_use' ? (D.LAND_USE_LABELS[r.measure] || r.measure) : (D.FUND_TOOL_LABELS[r.tool] || r.tool);
        var detail = scope === 'land_use' ? r.detail : r.summary;
        var facts = [];
        if (scope === 'funds') {
          if (r.rate_text) facts.push(esc(r.rate_text));
          if (money(r.annual_revenue)) facts.push(esc(money(r.annual_revenue)) + ' a year' + (r.revenue_year ? ' (' + esc(r.revenue_year) + ')' : ''));
          if (r.voter_approved === true) facts.push('voter-approved');
          if (r.adopted) facts.push('adopted ' + esc(longDate(r.adopted) || r.adopted));
          if (r.sunset) facts.push('sunsets ' + esc(longDate(r.sunset) || r.sunset));
          if (r.uses) facts.push('uses: ' + esc(r.uses));
        } else {
          facts.push(esc(r.requirement_or_incentive === 'requirement' ? 'Requirement' : r.requirement_or_incentive === 'both' ? 'Requirement with incentives' : 'Incentive'));
          facts.push(esc(eligibilityText(r.eligibility)));
          if (r.adopted) facts.push('adopted ' + esc(longDate(r.adopted) || r.adopted));
        }
        return '<article class="li-card"><h4>' + esc(title) + kindNote(r) + '</h4><p>' + esc(detail || '') + '</p>' +
          (facts.length ? '<p class="li-meta">' + facts.join(' · ') + '</p>' : '') +
          (r.authorizing_code ? '<p class="li-meta">' + esc(r.authorizing_code) + '</p>' : '') +
          reviewWarning(r) + verificationLine(r) + evidenceBlock(r) + '</article>';
      }).join('') + '</div>';
    }
    return '<section class="li-block" aria-labelledby="li-' + scope + '-h"><h3 id="li-' + scope + '-h">' + esc(SCOPE_TEXT[scope]) + ' ' + pill(state) + '</h3>' + body + '</section>';
  }

  function nameOf(model, geoid) {
    var g = model.geo.get(geoid);
    return g ? g.name : geoid;
  }

  function renderProp123(model, p) {
    var f = p.prop123;
    var asOf = longDate(model.prop123.updated);
    var src = '<a href="https://cdola.colorado.gov/commitment-filings" target="_blank" rel="noopener">DOLA commitment filings</a>' +
      (asOf ? ', as recorded on ' + esc(asOf) : '');
    if (!f) {
      return '<p><strong>Prop 123:</strong> no commitment filing on record for ' + esc(p.inheritsFrom ? nameOf(model, p.inheritsFrom) : p.name) +
        ' in ' + src + '. A filing made after that date would not show here.</p>';
    }
    return '<p><strong>Prop 123:</strong> ' + esc(f.status) + (f.filing_date ? ', filed ' + esc(longDate(f.filing_date) || f.filing_date) : '') +
      (f.required_commitment ? ' (' + esc(f.required_commitment) + ')' : '') +
      (f.fast_track === true ? '. Listed as having a fast-track approval process.' : f.fast_track === false ? '. Not listed with a fast-track process.' : '.') +
      ' Source: ' + src + '.</p>';
  }

  function renderAlternatives(model, geoid) {
    var alt = model.alternatives(geoid);
    if (!alt || !alt.suggestions.length) return '';
    var p = alt.profile;
    var subject = p.inheritsFrom ? nameOf(model, p.inheritsFrom) : p.name;
    var top = alt.suggestions.slice(0, 8).map(function (s) {
      var t = s.tool;
      var scope = scopeOfTool(t);
      var caveat = scope && p.states[scope] !== 'records' && p.states[scope] !== 'none_found'
        ? ' <span class="li-muted">(' + esc(subject) + '\'s ' + esc(SCOPE_TEXT[scope].toLowerCase()) + ': ' + esc(STATE_TEXT[p.states[scope]].toLowerCase()) + ')</span>' : '';
      var near = s.nearby.length ? ' Nearby: ' + s.nearby.slice(0, 4).map(function (id) { return esc(nameOf(model, id)); }).join(', ') + '.' : '';
      return '<li><strong>' + esc(t.label) + '</strong> <span class="tag tag-ghost">' + esc(STATUS_TEXT[t.colorado_status] || t.colorado_status) + '</span>' + caveat +
        '<br>' + esc(t.what_it_is) + ' ' + (s.adopters.length
        ? 'Used by ' + s.adopters.length + ' Colorado jurisdiction' + (s.adopters.length === 1 ? '' : 's') + ' with a verified record.'
        : 'No Colorado jurisdiction has a verified record of it yet.') + near + '</li>';
    }).join('');
    var out = alt.ruledOut.length ? '<p class="li-muted">Not suggested, because of Colorado law: ' + alt.ruledOut.map(function (r) {
      return esc(r.tool.label) + ' (' + esc(STATUS_TEXT[r.tool.colorado_status]) + ')';
    }).join('; ') + '. See the catalog below.</p>' : '';
    return '<section class="li-block" aria-labelledby="li-alt-h"><h3 id="li-alt-h">Tools to consider</h3>' +
      '<p>These are tools ' + esc(subject) + ' has no verified record of, ranked by use nearby and then statewide. They are suggestions to investigate, not a forecast. Where this jurisdiction has not been checked yet, it may already use them.</p>' +
      '<ol class="li-alt">' + top + '</ol>' + out + '</section>';
  }

  function scopeOfTool(tool) {
    var m = tool.maps_to || {};
    if ((m.fee_measure || []).length) return 'fees';
    if ((m.land_use_measure || []).length) return 'land_use';
    if ((m.funds_tool || []).length) return 'funds';
    return null;
  }

  function renderJurisdiction(model, geoid, target) {
    var p = model.profile(geoid);
    if (!p) { target.innerHTML = '<p>Choose a county, city or town.</p>'; return; }
    var kind = p.kind === 'county' ? 'County' : p.kind === 'cdp' ? 'Unincorporated community (CDP)' : 'Municipality';
    var countyName = p.county && p.kind !== 'county' ? nameOf(model, p.county) : null;
    var inherits = p.inheritsFrom
      ? '<div class="callout callout-info"><p>' + esc(p.name) + ' is an unincorporated community with no local government of its own, so the tools shown are ' + esc(nameOf(model, p.inheritsFrom)) + '\'s.</p></div>' : '';
    var links = '<p class="li-meta">See also <a href="housing-needs-assessment.html?type=' + (p.inheritsFrom || p.kind === 'county' ? 'county' : p.kind) + '&amp;geoid=' + encodeURIComponent(p.inheritsFrom || p.geoid) + '">the Housing Needs Assessment for this area</a> and <a href="colorado-deep-dive.html">state and federal programs on the Colorado Deep Dive</a>.</p>';
    target.innerHTML = '<h2 id="li-j-name" style="margin-top:0;">' + esc(p.name) + '</h2>' +
      '<p class="li-meta">' + esc(kind) + (countyName ? ' · ' + esc(countyName) : '') + '</p>' + inherits +
      renderProp123(model, p) + renderFees(p) + renderList(p, 'land_use') + renderList(p, 'funds') +
      renderAlternatives(model, geoid) + links;
  }

  function renderSummary(model, target) {
    var s = model.coverageSummary();
    var cells = model.SCOPES.map(function (scope) {
      var b = s.by_scope[scope];
      return '<tr><th scope="row">' + esc(SCOPE_TEXT[scope]) + '</th><td>' + b.records + '</td><td>' + b.none_found + '</td><td>' + b.unreadable + '</td><td>' + b.not_checked + '</td></tr>';
    }).join('');
    target.innerHTML = '<p><strong>' + s.any_records + '</strong> of Colorado\'s <strong>' + s.jurisdictions + '</strong> counties and municipalities have at least one verified record so far. Coverage grows in batches, starting with the largest jurisdictions and the Prop 123 filers.</p>' +
      '<div class="data-table"><table aria-label="Coverage by scope"><thead><tr><th scope="col">Scope</th><th scope="col">Verified records</th><th scope="col">Checked, none found</th><th scope="col">Could not be read</th><th scope="col">Not yet checked</th></tr></thead><tbody>' +
      cells + '</tbody></table></div>';
  }

  function renderToolkit(model, target) {
    var families = {};
    model.adoption.forEach(function (a) {
      var f = a.tool.family || 'other';
      (families[f] = families[f] || []).push(a);
    });
    target.innerHTML = Object.keys(FAMILY_TEXT).filter(function (f) { return families[f]; }).map(function (f) {
      var rows = families[f].slice().sort(function (x, y) { return y.adopters.length - x.adopters.length; }).map(function (a) {
        var ex = a.adopters.slice(0, 5).map(function (id) {
          return '<a href="#j=' + esc(id) + '" data-li-jump="' + esc(id) + '">' + esc(nameOf(model, id)) + '</a>';
        }).join(', ');
        return '<tr><th scope="row">' + esc(a.tool.label) + '</th><td>' + a.adopters.length + '</td><td>' + esc(STATUS_TEXT[a.tool.colorado_status] || a.tool.colorado_status) + '</td><td>' + (ex || '<span class="li-muted">No verified record yet</span>') + (a.adopters.length > 5 ? ', and others' : '') + '</td></tr>';
      }).join('');
      return '<h3>' + esc(FAMILY_TEXT[f]) + '</h3><div class="data-table li-stack"><table><thead><tr><th scope="col">Tool</th><th scope="col">Jurisdictions with a verified record</th><th scope="col">Colorado law</th><th scope="col">Examples</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }).join('') + renderFundTypes(model);
  }

  // Every kind of local fund on record, counted straight from the records,
  // including kinds (a housing trust fund) the catalog files under no single tool.
  function renderFundTypes(model) {
    var D = global.LocalIncentivesData;
    var by = {};
    model.records.forEach(function (items, geoid) {
      items.forEach(function (i) {
        if (i.scope !== 'funds' || !D.inUse(i)) return;
        (by[i.record.tool] = by[i.record.tool] || new Set()).add(geoid);
      });
    });
    var rows = Object.keys(by).sort(function (a, b) { return by[b].size - by[a].size; }).map(function (tool) {
      var ex = Array.from(by[tool]).sort().slice(0, 5).map(function (id) {
        return '<a href="#j=' + esc(id) + '" data-li-jump="' + esc(id) + '">' + esc(nameOf(model, id)) + '</a>';
      }).join(', ');
      return '<tr><th scope="row">' + esc(D.FUND_TOOL_LABELS[tool] || tool) + '</th><td>' + by[tool].size + '</td><td>' + ex + (by[tool].size > 5 ? ', and others' : '') + '</td></tr>';
    }).join('');
    if (!rows) return '';
    return '<h3>Local funding on record, by kind</h3><div class="data-table li-stack"><table><thead><tr><th scope="col">Kind of fund or tool</th><th scope="col">Jurisdictions</th><th scope="col">Examples</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderCatalog(doc, target, fees) {
    var shared = {};
    (((fees || {}).meta || {}).legal_basis || []).forEach(function (b) { shared[b.id] = b; });
    target.innerHTML = (doc.tools || []).map(function (t) {
      var reused = (t.reuse_legal_basis_ids || []).map(function (id) { return shared[id]; }).filter(Boolean);
      var all = (t.legal_basis || []).concat(reused);
      var basis = all.map(function (b) {
        var url = safeUrl(b.source && b.source.url);
        return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(b.citation) + '</a>' : esc(b.citation);
      });
      return '<details class="li-tool"><summary><strong>' + esc(t.label) + '</strong> <span class="tag tag-ghost">' + esc(STATUS_TEXT[t.colorado_status] || t.colorado_status) + '</span>' +
        '<br><span class="li-muted">' + esc(t.what_it_is) + '</span></summary>' +
        '<p>' + esc(t.status_reason || '') + '</p>' +
        (t.considerations ? '<p class="li-muted">' + esc(t.considerations) + '</p>' : '') +
        (basis.length ? '<p class="li-meta">Colorado legal basis: ' + basis.join('; ') + '</p>' : '') +
        evidenceBlock({ evidence: [].concat.apply([], all.map(function (b) { return b.evidence || []; })) }) + '</details>';
    }).join('');
  }

  function options(model) {
    var list = [];
    model.geo.forEach(function (g) {
      if (model.geo.has(g.geoid) && global.LocalIncentivesData.CONSOLIDATED[g.geoid]) return;
      list.push(g);
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list.map(function (g) { return '<option value="' + esc(g.geoid) + '">' + esc(g.name) + '</option>'; }).join('');
  }

  function geoidFromHash() {
    var m = String(global.location && global.location.hash || '').match(/j=(\d{5,7})/);
    return m ? m[1] : null;
  }

  function init() {
    var root = document.querySelector('[data-local-incentives]');
    if (!root) return;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) { return fetchJson(FILES[k]); })).then(function (docs) {
      var byKey = {};
      keys.forEach(function (k, i) { byKey[k] = docs[i]; });
      var D = global.LocalIncentivesData;
      var model = D.build(byKey);
      model.SCOPES = D.SCOPES;
      renderSummary(model, root.querySelector('[data-li-summary]'));
      renderToolkit(model, root.querySelector('[data-li-toolkit]'));
      renderCatalog(byKey.alternatives, root.querySelector('[data-li-catalog]'), byKey.fees);
      var select = root.querySelector('[data-li-select]');
      var panel = root.querySelector('[data-li-jurisdiction]');
      select.innerHTML = options(model);
      function show(geoid, scroll) {
        geoid = D.canonicalGeoid(geoid);
        if (!model.geo.has(geoid)) return;
        select.value = geoid;
        renderJurisdiction(model, geoid, panel);
        if (scroll) panel.scrollIntoView({ block: 'start' });
      }
      select.addEventListener('change', function () {
        if (global.history && global.history.replaceState) global.history.replaceState(null, '', '#j=' + select.value);
        show(select.value, false);
      });
      root.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('[data-li-jump]');
        if (!a) return;
        e.preventDefault();
        if (global.history && global.history.replaceState) global.history.replaceState(null, '', '#j=' + a.getAttribute('data-li-jump'));
        show(a.getAttribute('data-li-jump'), true);
      });
      show(geoidFromHash() || '0820000', false);
    }).catch(function (err) {
      root.querySelector('[data-li-summary]').innerHTML = '<p style="color:var(--bad);">The incentive data could not be loaded (' + esc(err.message) + '). Nothing below is current.</p>';
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  global.LocalIncentivesPage = { FILES: FILES, renderJurisdiction: renderJurisdiction, renderToolkit: renderToolkit, renderSummary: renderSummary, init: init };
})(typeof window !== 'undefined' ? window : this);
