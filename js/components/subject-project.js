/**
 * js/components/subject-project.js
 * ===============================================================
 * The Subject Project panel anchors the PMA tool to a SPECIFIC proposed
 * LIHTC project (unit mix × AMI tier × bedroom × proposed rent + size),
 * rather than just a site location. Every downstream card (rent
 * comparison vs LIHTC max, income eligibility, demand & capture by tier)
 * keys off this single source of truth.
 *
 * Persistence: localStorage under one global key (the Subject Project
 * applies to whichever site is active — it travels with the analysis).
 *
 * Income-limit / max-rent source: CHFA's "Income Limit and Maximum Rent
 * Tables for All Colorado Counties" — the authoritative table for CO
 * LIHTC underwriting. CHFA republishes HUD MTSP with any HERA-Special
 * adjustments and the Prop 123 rural-resort extensions (130-160% AMI for
 * 12 rural-resort counties: Archuleta, Chaffee, Eagle, Grand, Gunnison,
 * La Plata, Ouray, Pitkin, Routt, San Juan, San Miguel, Summit).
 *
 * The CHFA table publishes rents DIRECTLY by AMI tier × bedroom (no
 * formula needed) and income limits by 1-8 person household size.
 *
 * HERA Special applies only to Housing Tax Credit projects placed in
 * service on or before 12.31.2008. The same county can have BOTH HERA
 * and non-HERA limits in the table; toggle in the Subject Project to
 * pick the right set for the project's PIS date.
 *
 * LIHTC family-size-by-bedroom (IRS §42):
 *   Eff = 1.0 person, 1BR = 1.5, 2BR = 3.0, 3BR = 4.5, 4BR = 6.0
 *
 * Exposes window.SubjectProject:
 *   • mount(container)            — render input + cards
 *   • get()                       — read current Subject from storage
 *   • set(subject)                — write Subject + notify subscribers
 *   • subscribe(fn)               — fire on every change
 *   • computeLihtcMaxRent(c,fips,tier,br,opts) — published CHFA rent
 *   • computeIncomeLimit(c,fips,tier,size,opts) — published CHFA income
 *   • maxNetRent(maxGross, utilityAllowance) — null when the allowance is blank
 *   • loadChfa() / loadHud()      — singleton data loaders
 *   • DEFAULT_SUBJECT             — empty starter shape
 */
(function (global) {
  'use strict';
  if (global.SubjectProject) return;

  var RentLimits = global.ChfaRentLimits ||
    (typeof module === 'object' && module.exports ? require('../chfa-rent-limits.js') : null);

  var STORAGE_KEY = 'coho.subjectProject.v1';
  var CHFA_DATA_URL = 'data/chfa-income-rent-limits-2026.json';
  var HUD_DATA_URL = 'data/hud-fmr-income-limits.json';  // kept for HUD FMR market comp

  // CHFA-published AMI tiers (regular counties). Rural-resort counties also
  // get 130/140/150/160 per Prop 123.
  var AMI_TIERS_REGULAR = [20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120];
  var AMI_TIERS_RURAL_RESORT = AMI_TIERS_REGULAR.concat([130, 140, 150, 160]);
  // The picker shows the LIHTC-common set by default to keep the dropdown
  // short; users can still type any tier the data file supports.
  var AMI_TIERS = [30, 40, 50, 60, 70, 80, 90, 110, 120];
  var BEDROOMS  = ['efficiency', '1BR', '2BR', '3BR', '4BR'];

  var DEFAULT_SUBJECT = {
    project_name: '',
    address: '',
    county_fips: '',
    jurisdiction_geoid: '',
    location_cleared: false,
    county_name: '',
    total_units: 0,
    vacancy_rate: null,            // entered fraction (0..1); blank remains unknown
    site_acres: null,
    buildings: null,
    construction_type: 'new_construction', // or 'acquisition_rehab', 'preservation'
    credit_type: '9% competitive',
    in_migration_pct: 0,           // default conservative (0 = all PMA-resident demand)
    target_population: 'family',   // 'family', 'senior', 'PSH', 'workforce'
    use_hera_special: false,       // true for projects with PIS ≤ 12.31.2008 in a HERA county
    pis_date: null,                // required when requesting HERA Special limits
    utility_allowance_basis: null, // older saved projects must choose a method explicitly
    unit_mix: [],                  // numeric ami_tier: proposed_gross_rent, utility_allowance, fees; 'market': market_rent, market_rent_source
    amenities: [],                 // free-text checklist
    notes: '',
    updated_at: null
  };

  // ── Data loaders (singleton cache) ──────────────────────────────────
  var _chfaCache = null;
  function loadChfa() {
    if (_chfaCache) return _chfaCache;
    _chfaCache = fetch(CHFA_DATA_URL)
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return _chfaCache;
  }

  // HUD FMR is still useful — it's the market-rent benchmark for the rent-comparison card.
  var _hudCache = null;
  function loadHud() {
    if (_hudCache) return _hudCache;
    _hudCache = fetch(HUD_DATA_URL)
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return _hudCache;
  }

  // Keep the component's public API while sharing all lookup rules.
  function computeIncomeLimit(chfa, fips, tier, familySize, opts) {
    return RentLimits.incomeLimit(chfa, fips, tier, familySize, opts).incomeLimit;
  }

  function computeLihtcMaxRent(chfa, fips, tier, bedrooms, opts) {
    var result = RentLimits.maxGrossRent(chfa, fips, tier, bedrooms, opts);
    if (result.grossRent == null) return null;
    return {
      gross_rent: result.grossRent,
      source: 'CHFA published',
      hera: result.hera,
      family_size: result.familySize
    };
  }

  // ── Storage ─────────────────────────────────────────────────────────
  var _subscribers = [];
  // render() registers internal subscribers (saved-indicator + HERA-enable
  // refresher). When the panel is re-mounted, those would leak — call any
  // tracked unsub fns before re-rendering.
  var _renderUnsubs = [];

  var _allowanceCountyNotice = false;
  var _allowanceSourceNotice = false;
  function _newAllowanceBasis() {
    return { method: 'pha', reference: '', effective_date: '', resident_paid: [], bound_county_fips: '' };
  }

  function _readSubject() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [], utility_allowance_basis: _newAllowanceBasis() });
      var parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SUBJECT, parsed);
    } catch (e) {
      return Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [], utility_allowance_basis: _newAllowanceBasis() });
    }
  }

  function _activeJurisdiction() {
    var ws = global.WorkflowState;
    return ws && typeof ws.getJurisdiction === 'function' ? ws.getJurisdiction() : null;
  }

  function getSubject() {
    var s = _readSubject();
    var jurisdiction = _activeJurisdiction();
    // Covers a change on another page while this component was not loaded.
    return jurisdiction && jurisdiction.geoid && s.jurisdiction_geoid !== jurisdiction.geoid
      ? _syncFromSiteState(s) : s;
  }

  function setSubject(s) {
    var previous = _readSubject();
    var hadStored = false;
    try { hadStored = localStorage.getItem(STORAGE_KEY) != null; } catch (e) {}
    var next = Object.assign({}, DEFAULT_SUBJECT, s);
    var jurisdiction = _activeJurisdiction();
    if (!next.jurisdiction_geoid && jurisdiction && jurisdiction.geoid) next.jurisdiction_geoid = jurisdiction.geoid;
    var basis = next.utility_allowance_basis;
    var previousBasis = previous.utility_allowance_basis;
    var ownerPays = basis && basis.method === 'owner_pays_all';
    var oldBasis = previousBasis || {};
    var newBasis = basis || {};
    var methodChanged = hadStored && oldBasis.method !== newBasis.method;
    // Compare before clearing method-specific metadata, so unchanged save/input
    // events preserve amounts while any source-defining edit invalidates them.
    var sourceFieldsChanged = hadStored && (
      oldBasis.reference !== newBasis.reference ||
      oldBasis.effective_date !== newBasis.effective_date ||
      JSON.stringify(Array.isArray(oldBasis.resident_paid) ? oldBasis.resident_paid.slice().sort() : oldBasis.resident_paid) !==
        JSON.stringify(Array.isArray(newBasis.resident_paid) ? newBasis.resident_paid.slice().sort() : newBasis.resident_paid));
    if (methodChanged && basis) {
      basis = Object.assign({}, basis, { reference: '', effective_date: '' });
      next.utility_allowance_basis = basis;
    }
    var countyChanged = hadStored && !!previous.county_fips && previous.county_fips !== next.county_fips;
    var transition = global.SiteState && global.SiteState.get ? global.SiteState.get('jurisdictionChange') : null;
    var legacyMoved = !previous.jurisdiction_geoid && transition && transition.previousGeoid && transition.geoid === next.jurisdiction_geoid &&
      (!previous.updated_at || transition.changedAt >= previous.updated_at);
    var jurisdictionChanged = hadStored && !!previous.jurisdiction_geoid && previous.jurisdiction_geoid !== next.jurisdiction_geoid;
    var locationChanged = countyChanged || jurisdictionChanged || (hadStored && !!legacyMoved);
    if (locationChanged) {
      next.address = '';
      ['lat', 'lon', 'lng', 'latitude', 'longitude', 'site_lat', 'site_lon', 'siteLat', 'siteLon', 'coordinates'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = null;
      });
      next.unit_mix = (next.unit_mix || []).map(function (row) {
        return Object.assign({}, row, { market_rent: null, market_rent_source: '' });
      });
      next.location_cleared = true;
    }
    if (locationChanged && !ownerPays) {
      if (basis) {
        basis = Object.assign({}, basis, { reference: '', effective_date: '', bound_county_fips: '' });
        next.utility_allowance_basis = basis;
      }
      _allowanceCountyNotice = true;
    }
    if (ownerPays || methodChanged || sourceFieldsChanged || locationChanged) {
      next.unit_mix = (next.unit_mix || []).map(function (row) {
        var updated = Object.assign({}, row);
        updated.utility_allowance = ownerPays ? 0 : null;
        return updated;
      });
    }
    if ((methodChanged || sourceFieldsChanged) && !ownerPays) _allowanceSourceNotice = true;
    if (ownerPays || ((next.unit_mix || []).length && next.unit_mix.every(function (row) {
      return row.utility_allowance != null && row.utility_allowance !== '';
    }))) _allowanceSourceNotice = false;
    if (ownerPays || RentLimits.allowanceBasisStatus(basis, next.county_fips).complete) _allowanceCountyNotice = false;
    next.updated_at = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
    _subscribers.forEach(function (fn) {
      try { fn(next); } catch (e) { console.warn('[SubjectProject] subscriber error', e); }
    });
    return next;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subscribers.push(fn);
    return function () { _subscribers = _subscribers.filter(function (s) { return s !== fn; }); };
  }

  // Every location sync uses setSubject's one invalidation path, including
  // render-time county fallback and changes made while the panel is unmounted.
  function _syncFromSiteState(s) {
    var jurisdiction = _activeJurisdiction();
    var county = global.SiteState && global.SiteState.getCounty ? global.SiteState.getCounty() : null;
    var next = Object.assign({}, s);
    if (jurisdiction && jurisdiction.geoid) {
      next.jurisdiction_geoid = jurisdiction.geoid;
      next.county_fips = jurisdiction.countyFips || '';
      next.county_name = jurisdiction.countyName || '';
    } else if (county && county.fips) {
      next.county_fips = county.fips;
      next.county_name = county.name || '';
    }
    return next.jurisdiction_geoid !== s.jurisdiction_geoid || next.county_fips !== s.county_fips
      ? setSubject(next) : s;
  }

  if (typeof document !== 'undefined') document.addEventListener('workflow:step-updated', function (event) {
    if (event.detail && event.detail.stepKey === 'jurisdiction') _syncFromSiteState(_readSubject());
  });

  // ── DOM helpers ─────────────────────────────────────────────────────
  function $h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.keys(attrs[k]).forEach(function (sk) { el.style[sk] = attrs[k][sk]; });
      } else if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      } else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function $fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function $fmtPct(n) {
    if (n == null || isNaN(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + (n).toFixed(1) + '%';
  }

  // Preserve the existing number-or-null API; reasons stay on the module result.
  var UA_MISSING_REASON = 'Enter the utility allowance ($0 only if the owner pays all utilities) to see the max net rent.';
  function maxNetRent(maxGross, utilityAllowance, fees, basisStatus) {
    return RentLimits.maxContractRent({ grossRent: maxGross,
      utilityAllowance: utilityAllowance, fees: fees, basisStatus: basisStatus }).contractRent;
  }

  // ── Renderer ────────────────────────────────────────────────────────
  function _renderRow(row, idx, onChange, onRemove, scheduleRow, ownerPays) {
    var rentLimit = scheduleRow.limit;
    var market = scheduleRow.isMarket;
    var maxRent = rentLimit.grossRent;
    var maxNet = scheduleRow.maxNetRent;
    var reason = scheduleRow.maxNetReason;
    var netMissingUa = maxRent != null && reason === 'utility_allowance_missing';

    var overMax = scheduleRow.rowReason === 'over_chfa_max';

    var input = function (key, type, val, w) {
      return $h('input', {
        type: type || 'number',
        min: '0',
        value: val == null ? '' : val,
        'data-key': key,
        'data-idx': idx,
        'aria-label': key.replace(/_/g, ' ') + ' — row ' + (idx + 1),
        style: { width: w || '78px', minHeight: '44px', padding: '3px 5px', border: '1px solid var(--border)',
                 borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                 fontSize: '.78rem' }
      });
    };
    var select = function (key, val, opts) {
      var sel = $h('select', {
        'data-key': key, 'data-idx': idx,
        'aria-label': key.replace(/_/g, ' ') + ' — row ' + (idx + 1),
        style: { minHeight: '44px', padding: '3px 5px', border: '1px solid var(--border)',
                 borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                 fontSize: '.78rem' }
      });
      opts.forEach(function (o) {
        var op = $h('option', { value: o.value }, [o.label]);
        if (String(o.value) === String(val)) op.selected = true;
        sel.appendChild(op);
      });
      return sel;
    };

    var brSel  = select('bedrooms', row.bedrooms, BEDROOMS.map(function (b) {
      return { value: b, label: b === 'efficiency' ? 'Eff' : b };
    }));
    var amiOptions = AMI_TIERS.map(function (t) {
      return { value: t, label: t + '%' };
    });
    // A saved table-supported tier outside the short list must remain visible.
    if (row.ami_tier != null && row.ami_tier !== 'market' && !amiOptions.some(function (o) {
      return String(o.value) === String(row.ami_tier);
    })) amiOptions.push({ value: row.ami_tier, label: row.ami_tier + '%' });
    amiOptions.push({ value: 'market', label: 'Market-rate' });
    var amiSel = select('ami_tier', row.ami_tier, amiOptions);

    var uaInput = input('utility_allowance', 'number', row.utility_allowance, '60px');
    uaInput.disabled = ownerPays;
    var uaContents = [uaInput];
    if (ownerPays) uaContents.push($h('span', { 'data-role': 'owner-paid-allowance',
      style: { display: 'block', fontSize: '.7rem' } }, ['Owner pays all utilities — $0 allowance']));

    var sourceInput = input('market_rent_source', 'text', row.market_rent_source, '180px');
    sourceInput.required = true;
    var tr = $h('tr', { 'data-row-number': idx + 1, 'data-market-rate': String(market) }, [
      $h('td', { style: { padding: '4px 6px' } }, [brSel]),
      $h('td', { style: { padding: '4px 6px' } }, [amiSel, market ? $h('span', { 'data-role': 'market-rate-label' }, ['Market rate']) : null]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('count', 'number', row.count)]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('sqft', 'number', row.sqft, '70px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [market ? input('market_rent', 'number', row.market_rent, '78px') : input('proposed_gross_rent', 'number', row.proposed_gross_rent, '78px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, market ? [sourceInput] : uaContents),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, market ? ['Market rate — no allowance deducted'] : [input('fees', 'number', row.fees, '60px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right',
                          color: overMax ? 'var(--bad,#c14545)' : 'var(--muted)',
                          fontWeight: overMax ? '600' : '400' } }, [
        maxRent == null ? RentLimits.unavailableMessage(rentLimit.unavailableReason) : $fmtMoney(maxRent)
      ]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right', color: 'var(--muted)' },
        title: netMissingUa ? UA_MISSING_REASON : (reason || ''),
        'data-net-rent-unavailable': netMissingUa ? 'utility-allowance' : (reason || '') }, [
        maxNet != null ? $fmtMoney(maxNet) : RentLimits.unavailableMessage(reason)
      ]),
      $h('td', { 'data-role': 'scheduled-contract-rent', 'data-row-reason': scheduleRow.rowReason || '',
        title: scheduleRow.rowReason || '', style: { padding: '4px 6px', textAlign: 'right' } }, [
        scheduleRow.contractRent == null ? RentLimits.unavailableMessage(scheduleRow.rowReason) : $fmtMoney(scheduleRow.contractRent)
      ]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'center' } }, [
        $h('button', {
          type: 'button', 'data-action': 'remove', 'data-idx': idx,
          'aria-label': 'Remove row',
          style: { padding: '2px 8px', border: '1px solid var(--border)', background: 'transparent',
                   color: 'var(--muted)', borderRadius: '3px', cursor: 'pointer', fontSize: '.85rem' }
        }, ['×'])
      ])
    ]);

    Array.from(tr.querySelectorAll('input,select')).forEach(function (el) {
      el.addEventListener('change', function () { onChange(idx, el); });
      el.addEventListener('input',  function () { onChange(idx, el); });
    });
    var rentFigure = tr.querySelector('[data-role="scheduled-contract-rent"]');
    rentFigure.id = 'subject-scheduled-rent-' + (idx + 1);
    rentFigure.setAttribute('data-methodology-key', 'scheduled-row-rent');
    rentFigure.setAttribute('data-methodology-placement', 'after');
    var subject = getSubject(), basis = subject.utility_allowance_basis || {};
    rentFigure.methodologyContext = { market: scheduleRow.isMarket, gross: scheduleRow.grossResidentRent,
      allowance: scheduleRow.utilityAllowance, fees: scheduleRow.fees,
      unavailableReason: scheduleRow.rowReason ? RentLimits.unavailableMessage(scheduleRow.rowReason) : null,
      sources: 'County ' + (subject.county_fips || 'not selected') + (scheduleRow.isMarket
        ? ' · market-rent citation: ' + (scheduleRow.marketRentSource || 'missing') + ' (date supplied in citation)'
        : ' · CHFA ' + (scheduleRow.limit.tableYear || 'date unavailable') + ' · effective ' + (scheduleRow.limit.effectiveDate || 'unavailable') +
          ' · allowance: ' + (basis.reference || basis.method || 'missing') + ' · effective ' + (basis.effective_date || 'not supplied')) };
    var rm = tr.querySelector('button[data-action=remove]');
    if (rm) rm.addEventListener('click', function () { onRemove(idx); });
    return tr;
  }

  function render(container) {
    if (!container) return;
    var subject = _syncFromSiteState(getSubject());
    subject = setSubject(subject);  // applies any SiteState county change before rendering

    // Clear any subscribers registered by a prior render of this panel so
    // re-mounts don't leak listeners. External subscribers (other components
    // that called SubjectProject.subscribe) are not in this list.
    _renderUnsubs.forEach(function (u) { try { u(); } catch (e) {} });
    _renderUnsubs = [];

    loadChfa().then(function (chfa) {
      // The jurisdiction may have changed while the table was loading.
      subject = getSubject();
      container.innerHTML = '';
      var wrap = $h('div', { class: 'subject-project-wrap' });
      container.appendChild(wrap);
      var locationNotice = $h('p', { 'data-role': 'subject-location-cleared', role: 'status', 'aria-live': 'polite' });
      wrap.appendChild(locationNotice);
      function refreshLocationNotice() {
        var current = _readSubject();
        locationNotice.hidden = !current.location_cleared;
        locationNotice.textContent = current.location_cleared
          ? 'Location changed — cleared site address and coordinates, market rents and sources, and location-specific utility allowances.' : '';
        // Metadata inputs must not keep displaying the cleared address.
        var address = wrap.querySelector('[data-key="address"]');
        if (address) address.value = current.address || '';
        var county = wrap.querySelector('[data-key="county_fips"]');
        if (county) county.value = current.county_fips || '';
      }
      _renderUnsubs.push(subscribe(refreshLocationNotice));
      refreshLocationNotice();

      var amiSrc = chfa && chfa.meta ? chfa.meta.fiscal_year : '—';
      var amiEff = chfa && chfa.meta ? chfa.meta.effective_date : '—';
      var countyOpts = (chfa && chfa.counties) ? chfa.counties.map(function (c) {
        var label = c.county_name + ' County';
        if (c.hera_special) label += ' (HERA Special available)';
        if (c.rural_resort) label += ' · rural-resort (Prop 123)';
        return { value: c.fips, label: label };
      }) : [];

      // Header strip
      var hdr = $h('div', { style: {
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '8px', marginBottom: '.5rem'
      } }, [
        $h('div', {}, [
          $h('h2', { style: { margin: '0 0 .15rem', display: 'inline-block' } }, ['Subject Project']),
          $h('span', { style: { fontSize: '.7rem', marginLeft: '.5rem',
            padding: '2px 7px', background: 'var(--card2,#1a1a1a)',
            border: '1px solid var(--border)', borderRadius: '3px',
            color: 'var(--muted)' } }, ['CHFA ' + amiSrc + ' · eff ' + amiEff])
        ]),
        $h('div', { 'data-role': 'saved-indicator',
          style: { fontSize: '.72rem', color: 'var(--muted)' } }, [
          subject.updated_at ? 'Saved ' + new Date(subject.updated_at).toLocaleString() : 'Unsaved'
        ])
      ]);
      wrap.appendChild(hdr);
      // Keep the "Saved at" timestamp live without re-rendering the whole panel
      // (which would steal focus from inputs the user is currently typing in).
      _renderUnsubs.push(subscribe(function (s) {
        var ind = wrap.querySelector('[data-role="saved-indicator"]');
        if (ind) {
          ind.textContent = s.updated_at
            ? 'Saved ' + new Date(s.updated_at).toLocaleString()
            : 'Unsaved';
        }
      }));

      wrap.appendChild($h('p', { style: { margin: '0 0 .75rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'Anchor the analysis to a specific proposed project. This drives the LIHTC max-rent comparison, ',
        'the income-eligibility table, and the per-tier capture-rate stack. ',
        'All fields persist locally — nothing leaves your browser.'
      ]));

      // ── Project meta (basic) ──
      var meta = $h('div', { style: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
        gap: '.5rem .75rem', marginBottom: '.85rem', padding: '.6rem .75rem',
        background: 'var(--card2,#1a1a1a)', border: '1px solid var(--border)',
        borderRadius: '4px'
      } });

      function field(label, key, type, opts) {
        var id = 'sp-' + key;
        var node;
        if (opts) {
          node = $h('select', { id: id, 'data-key': key,
            style: { width: '100%', padding: '4px 6px', border: '1px solid var(--border)',
                     borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                     fontSize: '.82rem' } });
          opts.forEach(function (o) {
            var op = $h('option', { value: o.value }, [o.label]);
            if (String(o.value) === String(subject[key] || '')) op.selected = true;
            node.appendChild(op);
          });
        } else {
          node = $h('input', { id: id, type: type || 'text', 'data-key': key,
            value: subject[key] == null ? '' : key === 'vacancy_rate' ? subject[key] * 100 : subject[key],
            style: { width: '100%', padding: '4px 6px', border: '1px solid var(--border)',
                     borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                     fontSize: '.82rem' } });
        }
        node.addEventListener('change', _onMetaChange);
        node.addEventListener('input',  _onMetaChange);
        return $h('div', {}, [
          $h('label', { for: id, style: { display: 'block', fontSize: '.7rem',
            color: 'var(--muted)', marginBottom: '2px' } }, [label]),
          node
        ]);
      }

      function _onMetaChange(e) {
        var el = e.target;
        var key = el.getAttribute('data-key');
        if (!key) return;
        var val = el.value;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'number') val = val === '' ? null : +val;
        var s = getSubject();
        s[key] = key === 'vacancy_rate' && val != null ? val / 100 : val;
        if (key === 'county_fips') {
          var row = RentLimits.countyRow(chfa, val);
          s.county_name = row ? row.county_name : '';
          // If the user picks a non-HERA county, force HERA toggle off.
          if (row && !row.hera_special) s.use_hera_special = false;
        }
        setSubject(s);
        // Changing county or HERA flag changes every row's LIHTC max — re-render
        // the unit-mix table so the in-row "LIHTC max gross / net" columns update.
        if (key === 'county_fips' || key === 'use_hera_special') {
          if (typeof _redrawRows === 'function') _redrawRows();
        }
      }

      meta.appendChild(field('Project name', 'project_name'));
      meta.appendChild(field('Address (optional)', 'address'));
      meta.appendChild(field('County', 'county_fips', null, [{ value: '', label: '— select county —' }].concat(countyOpts)));
      meta.appendChild(field('Target population', 'target_population', null, [
        { value: 'family', label: 'Family' },
        { value: 'senior', label: 'Senior (55+)' },
        { value: 'PSH', label: 'PSH / supportive' },
        { value: 'workforce', label: 'Workforce' }
      ]));
      meta.appendChild(field('Construction type', 'construction_type', null, [
        { value: 'new_construction', label: 'New construction' },
        { value: 'acquisition_rehab', label: 'Acquisition / rehab' },
        { value: 'preservation', label: 'Preservation' }
      ]));
      meta.appendChild(field('Credit type', 'credit_type', null, [
        { value: '9% competitive', label: '9% competitive' },
        { value: '4% PAB', label: '4% PAB' },
        { value: 'Other', label: 'Other / mixed' }
      ]));
      var unitField = field('Project total units', 'total_units', 'number');
      unitField.querySelector('input').setAttribute('min', '1');
      unitField.querySelector('input').setAttribute('step', '1');
      unitField.querySelector('input').style.minHeight = '44px';
      meta.appendChild(unitField);
      var vacancyField = field('Vacancy rate (%) — required for effective rent', 'vacancy_rate', 'number');
      vacancyField.querySelector('input').setAttribute('min', '0');
      vacancyField.querySelector('input').setAttribute('max', '100');
      vacancyField.querySelector('input').setAttribute('step', '0.1');
      vacancyField.querySelector('input').style.minHeight = '44px';
      vacancyField.querySelector('input').required = true;
      meta.appendChild(vacancyField);
      meta.appendChild(field('Site (acres)', 'site_acres', 'number'));
      meta.appendChild(field('Buildings', 'buildings', 'number'));
      meta.appendChild(field('In-migration assumption (%)', 'in_migration_pct', 'number'));
      wrap.appendChild(meta);

      // HERA Special toggle — only relevant for HERA counties + Housing Tax Credit projects
      // placed in service on or before 12.31.2008.
      var heraWrap = $h('div', { style: {
        marginBottom: '.85rem', padding: '.5rem .7rem',
        background: 'var(--card2,#1a1a1a)', border: '1px solid var(--border)',
        borderRadius: '4px', fontSize: '.78rem', color: 'var(--text)'
      } });
      var heraLabel = $h('label', { style: { display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' } }, [
        $h('input', { id: 'sp-use_hera_special', type: 'checkbox', 'data-key': 'use_hera_special' }),
        $h('span', {}, ['Use HERA Special limits']),
        $h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, [
          chfa && chfa.meta && chfa.meta.hera_special_note || 'HERA requires a placed-in-service date on or before 2008-12-31.'
        ])
      ]);
      var heraCb = heraLabel.querySelector('input');
      heraCb.checked = !!subject.use_hera_special;
      heraCb.addEventListener('change', _onMetaChange);
      heraWrap.appendChild(field('Placed-in-service date (required for HERA)', 'pis_date', 'date'));
      heraWrap.appendChild(heraLabel);
      // Auto-disable when county is not HERA-eligible
      function _refreshHeraEnabled() {
        var s = getSubject();
        var row = RentLimits.countyRow(chfa, s.county_fips);
        var enable = !!(row && row.hera_special && s.pis_date);
        heraCb.checked = !!s.use_hera_special;
        heraCb.disabled = !enable;
        heraLabel.style.opacity = enable ? '1' : '.55';
      }
      _refreshHeraEnabled();
      _renderUnsubs.push(subscribe(_refreshHeraEnabled));
      wrap.appendChild(heraWrap);

      // ── Project-wide utility allowance basis ──
      var basisPanel = $h('fieldset', { 'data-role': 'utility-allowance-basis', style: {
        margin: '0 0 .85rem', padding: '.6rem .75rem', minWidth: '0', fontSize: '.82rem',
        border: '1px solid var(--border)', borderRadius: '4px'
      } });
      basisPanel.appendChild($h('legend', {}, ['Utility allowance basis']));
      var basisGrid = $h('div', { style: { display: 'grid', gap: '.5rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' } });
      function basisField(label, key, node) {
        node.id = 'sp-ua-' + key;
        node.style.width = '100%';
        node.style.minHeight = '44px';
        node.style.background = 'var(--card)';
        node.style.color = 'var(--text)';
        basisGrid.appendChild($h('div', { style: { minWidth: '0' } }, [$h('label', { for: node.id }, [label]), node]));
        node.addEventListener('change', function () { updateBasis(key, node.value); });
        if (key !== 'method') node.addEventListener('input', function () { updateBasis(key, node.value); });
      }
      var methodSelect = $h('select');
      methodSelect.appendChild($h('option', { value: '' }, ['— choose method —']));
      RentLimits.ALLOWANCE_METHODS.forEach(function (m) {
        methodSelect.appendChild($h('option', { value: m.method }, [m.label + ' — ' + m.applicability]));
      });
      basisField('Method', 'method', methodSelect);
      var referenceInput = $h('input', { type: 'text' });
      basisField('Schedule, authority or model', 'reference', referenceInput);
      var dateInput = $h('input', { type: 'date' });
      basisField('Effective date', 'effective_date', dateInput);
      basisPanel.appendChild(basisGrid);
      basisPanel.appendChild($h('p', { 'data-role': 'allowance-applicability' }));
      var utilityFields = $h('fieldset', { style: { border: '0', padding: '0', margin: '.4rem 0' } });
      utilityFields.appendChild($h('legend', {}, ['Utilities residents pay']));
      var utilityChecks = {};
      Object.keys(RentLimits.RESIDENT_UTILITIES).forEach(function (key) {
        var cb = $h('input', { type: 'checkbox', 'data-utility': key });
        utilityChecks[key] = cb;
        cb.addEventListener('change', function () {
          updateBasis('resident_paid', Object.keys(utilityChecks).filter(function (k) { return utilityChecks[k].checked; }));
        });
        utilityFields.appendChild($h('label', { style: { display: 'inline-flex', alignItems: 'center',
          minHeight: '44px', minWidth: '44px', gap: '.3rem', marginRight: '.8rem' } }, [cb, RentLimits.RESIDENT_UTILITIES[key]]));
      });
      basisPanel.appendChild(utilityFields);
      basisPanel.appendChild($h('a', { href: RentLimits.REGULATION_URL, target: '_blank', rel: 'noopener noreferrer' }, ['26 CFR §1.42-10 — utility allowance rules']));
      var basisStatusText = $h('p', { 'data-role': 'allowance-basis-status', 'aria-live': 'polite', 'aria-atomic': 'true' });
      var countyNotice = $h('p', { 'data-role': 'allowance-county-notice', 'aria-live': 'polite', 'aria-atomic': 'true' });
      basisPanel.appendChild(basisStatusText);
      basisPanel.appendChild(countyNotice);
      wrap.appendChild(basisPanel);
      var sourceNotice = $h('p', { 'data-role': 'allowance-source-notice', 'aria-live': 'polite', 'aria-atomic': 'true' });
      wrap.appendChild(sourceNotice);

      function updateBasis(key, value) {
        var s = getSubject();
        var basis = Object.assign({}, s.utility_allowance_basis || _newAllowanceBasis());
        basis[key] = value;
        // Only naming a source binds it to this county; changing a date or
        // utility checkbox must not rebind a saved source from elsewhere.
        if (key === 'reference') basis.bound_county_fips = s.county_fips;
        if (key === 'method' && (value === 'owner_pays_all' ||
            (s.utility_allowance_basis && s.utility_allowance_basis.method === 'owner_pays_all'))) {
          basis.reference = '';
          basis.effective_date = '';
          basis.resident_paid = [];
        }
        s.utility_allowance_basis = basis;
        setSubject(s);
        if (typeof global.__announceUpdate === 'function') global.__announceUpdate(basisStatusText.textContent);
      }
      function refreshBasis() {
        var s = getSubject();
        var basis = s.utility_allowance_basis || {};
        var ownerPays = basis.method === 'owner_pays_all';
        methodSelect.value = basis.method || '';
        referenceInput.value = basis.reference || '';
        dateInput.value = basis.effective_date || '';
        referenceInput.disabled = dateInput.disabled = ownerPays;
        Object.keys(utilityChecks).forEach(function (key) {
          utilityChecks[key].checked = Array.isArray(basis.resident_paid) && basis.resident_paid.indexOf(key) !== -1;
          utilityChecks[key].disabled = ownerPays;
        });
        var method = RentLimits.ALLOWANCE_METHODS.find(function (m) { return m.method === basis.method; });
        basisPanel.querySelector('[data-role="allowance-applicability"]').textContent = method
          ? method.applicability + (method.paragraph ? ' §1.42-10' + method.paragraph : '') : '';
        var status = RentLimits.allowanceBasisStatus(basis, s.county_fips);
        basisStatusText.setAttribute('data-unavailable-reason', status.unavailableReason || '');
        basisStatusText.textContent = status.complete ? 'Allowance basis complete. Enter the sourced amounts on each row.'
          : RentLimits.unavailableMessage(status.unavailableReason);
        if (ownerPays && status.complete) basisStatusText.textContent = 'Owner pays all utilities — $0 allowance';
        countyNotice.textContent = _allowanceCountyNotice
          ? 'Location changed: the utility allowance must be re-sourced for the new jurisdiction.' : '';
        sourceNotice.textContent = _allowanceSourceNotice
          ? 'Allowance source changed — re-enter the amounts from the new source.' : '';
      }

      // ── Unit mix table ──
      wrap.appendChild($h('h3', { style: { margin: '0 0 .35rem', fontSize: '.95rem' } }, ['Unit mix']));
      wrap.appendChild($h('p', { style: { margin: '0 0 .4rem', fontSize: '.74rem',
        color: 'var(--muted)' } }, [
        'LIHTC max gross rent is read directly from CHFA\'s published "Income Limit and ' +
        'Maximum Rent Tables for All Colorado Counties" (' + amiSrc + ', HUD effective ' +
        amiEff + '). Tiers below match the LIHTC-common set; the underlying CHFA file covers ' +
        '20–120% AMI (plus 130–160% for the 12 Prop 123 rural-resort counties). ' +
        'Max net rent subtracts the resident-paid utility allowance and required nonoptional fees. Blank fees default to $0.'
      ]));

      var tableWrap = $h('div', { style: { overflowX: 'auto', border: '1px solid var(--border)',
        borderRadius: '4px', marginBottom: '.5rem' } });
      var table = $h('table', { style: { width: '100%', borderCollapse: 'collapse',
        fontSize: '.78rem' } });
      var thead = $h('thead', { style: { background: 'var(--card2,#1a1a1a)',
        textTransform: 'uppercase', fontSize: '.66rem', letterSpacing: '.03em',
        color: 'var(--muted)' } }, [
        $h('tr', {}, [
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Bedrooms']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['AMI']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Count']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Sqft']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Proposed gross / market rent']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Utility allow. / market source']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Nonoptional fees / market status']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max gross']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max net']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Scheduled contract rent']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'center' } }, ['']),
        ])
      ]);
      var caption = $h('caption', { 'data-role': 'chfa-table-vintage', style: { textAlign: 'left', padding: '6px' } });
      table.appendChild(caption);
      var tbody = $h('tbody', {});
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);

      function _redrawRows() {
        var s = getSubject();
        // Row edits refresh calculated cells; keep typing in the same input.
        var active = document.activeElement;
        var focusKey = active && tbody.contains(active) && active.getAttribute('data-key');
        var focusIndex = focusKey ? active.getAttribute('data-idx') : null;
        var caret = focusKey && active.type === 'text' ? active.selectionStart : null;
        tbody.innerHTML = '';
        var tableLimit = null;
        var schedule = RentLimits.rentSchedule(s, { chfaTable: chfa });
        var ownerPays = !!(s.utility_allowance_basis && s.utility_allowance_basis.method === 'owner_pays_all');
        (s.unit_mix || []).forEach(function (row, i) {
          var rentLimit = schedule.rows[i].limit;
          if (rentLimit.grossRent != null) tableLimit = rentLimit;
          tbody.appendChild(_renderRow(row, i, function (idx, el) {
            var s2 = getSubject();
            var k = el.getAttribute('data-key');
            var v = el.value;
            if (el.type === 'number') v = v === '' ? null : +v;
            if (k === 'ami_tier' && v !== 'market') v = +v;
            s2.unit_mix[idx][k] = v;
            setSubject(s2);
            _redrawRows();
            _redrawTotals();
          }, function (idx) {
            var s3 = getSubject();
            s3.unit_mix.splice(idx, 1);
            setSubject(s3);
            _redrawRows();
            _redrawTotals();
          }, schedule.rows[i], ownerPays));
        });
        caption.textContent = tableLimit ? 'CHFA ' + (tableLimit.tableYear || '—') +
          ' · effective ' + (tableLimit.effectiveDate || '—') : 'CHFA rent limits unavailable for these rows';
        var basisCaption = RentLimits.allowanceBasisCaption(s.utility_allowance_basis, s.county_fips);
        if (basisCaption) caption.textContent += ' · ' + basisCaption;
        if ((s.unit_mix || []).length === 0) {
          tbody.appendChild($h('tr', {}, [
            $h('td', { colspan: '11', style: { padding: '14px 8px', textAlign: 'center',
              color: 'var(--muted)', fontSize: '.8rem' } }, [
              'No unit-mix rows yet. Use the buttons below to add a row.'
            ])
          ]));
        }
        if (focusKey) {
          var replacement = tbody.querySelector('[data-key="' + focusKey + '"][data-idx="' + focusIndex + '"]');
          if (replacement) {
            replacement.focus();
            if (caret != null) replacement.setSelectionRange(caret, caret);
          }
        }
      }

      var totals = $h('div', { 'data-role': 'rent-schedule-summary', 'aria-live': 'polite', 'aria-atomic': 'true',
        style: { fontSize: '.78rem', color: 'var(--text)', margin: '.35rem 0 .65rem' } });
      function _redrawTotals() {
        var schedule = RentLimits.rentSchedule(getSubject(), { chfaTable: chfa });
        var t = schedule.totals;
        totals.innerHTML = '';
        totals.setAttribute('data-unavailable-reason', t.unavailableReason || '');
        totals.appendChild($h('p', { 'data-role': 'schedule-unit-count' }, [
          'Scheduled: ' + (schedule.scheduledUnits == null ? 'unavailable' : schedule.scheduledUnits) +
          ' units · Project total: ' + (schedule.projectUnits == null ? 'unavailable' : schedule.projectUnits)
        ]));
        if (t.unavailableReason) totals.appendChild($h('p', { 'data-role': 'schedule-blocked' }, [
          RentLimits.unavailableMessage(t.unavailableReason) + (schedule.unpricedRows.length ?
            ' · ' + schedule.unpricedRows.map(function (r) {
              return 'Row ' + r.rowNumber + ' (' + r.bedrooms + ', ' + (r.amiTier === 'market' ? 'market rate' : r.amiTier + '% AMI') + '): ' + RentLimits.unavailableMessage(r.rowReason);
            }).join('; ') : '')
        ]));
        function figure(key, label, value) {
          totals.appendChild($h('div', { 'data-total': key, 'data-value': t[key] == null ? '' : String(t[key]) },
            [label + ': ' + (t[key] == null ? 'unavailable' : value)]));
        }
        figure('restrictedUnits', 'Restricted units', String(t.restrictedUnits));
        figure('marketUnits', 'Market-rate units', String(t.marketUnits));
        figure('le80Units', '≤80% AMI units', String(t.le80Units));
        figure('le80Share', '≤80% AMI share', t.le80Share == null ? '' : (t.le80Share * 100).toFixed(1) + '%');
        figure('contractRent', 'Unit-weighted monthly contract rent', $fmtMoney(t.contractRent));
        figure('grossResidentRent', 'Unit-weighted monthly gross resident rent', $fmtMoney(t.grossResidentRent));
        figure('utilityAllowance', 'Unit-weighted monthly utility allowance', $fmtMoney(t.utilityAllowance));
        figure('annualScheduledRent', 'Annual scheduled rent', $fmtMoney(t.annualScheduledRent));
        figure('effectiveRentAfterVacancy', 'Annual effective rent after vacancy', $fmtMoney(t.effectiveRentAfterVacancy));
        if (t.effectiveRentUnavailableReason && !t.unavailableReason) totals.appendChild($h('p', {
          'data-role': 'vacancy-reason', 'data-unavailable-reason': t.effectiveRentUnavailableReason
        }, [RentLimits.unavailableMessage(t.effectiveRentUnavailableReason)]));
        totals.appendChild($h('p', { 'data-role': 'pre-expense-disclosure' }, ['Scheduled rent is pre-expense revenue — not NOI or supportable debt']));
        totals.appendChild($h('p', { 'data-role': 'ami-planning-disclosure' }, ['≤80% AMI share is a planning indicator — not the Average Income Test, minimum set-aside, applicable fraction or a tax opinion']));
      }
      wrap.appendChild(totals);

      // Quick-add buttons
      var btnBar = $h('div', { style: { display: 'flex', flexWrap: 'wrap',
        gap: '.4rem', marginBottom: '.85rem' } });
      function btn(label, onClick) {
        return $h('button', { type: 'button',
          style: { padding: '5px 10px', fontSize: '.78rem',
                   border: '1px solid var(--border)', borderRadius: '3px',
                   background: 'var(--card)', color: 'var(--text)', cursor: 'pointer' },
          onclick: onClick
        }, [label]);
      }
      btnBar.appendChild(btn('+ Add row', function () {
        var s = getSubject();
        s.unit_mix = s.unit_mix || [];
        s.unit_mix.push({ bedrooms: '2BR', ami_tier: 60, count: 1, sqft: null,
          proposed_gross_rent: null, utility_allowance: null });
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('+ Family preset (30/50/60 mix)', function () {
        var s = getSubject();
        s.unit_mix = [
          { bedrooms: '1BR', ami_tier: 30, count: 4, sqft: 650, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '1BR', ami_tier: 60, count: 8, sqft: 650, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '2BR', ami_tier: 50, count: 8, sqft: 900, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '2BR', ami_tier: 60, count: 12, sqft: 900, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '3BR', ami_tier: 60, count: 8, sqft: 1150, proposed_gross_rent: null, utility_allowance: null }
        ];
        s.target_population = 'family';
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('+ Senior preset (50/60 mix)', function () {
        var s = getSubject();
        s.unit_mix = [
          { bedrooms: '1BR', ami_tier: 30, count: 6, sqft: 600, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '1BR', ami_tier: 50, count: 12, sqft: 600, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '1BR', ami_tier: 60, count: 14, sqft: 600, proposed_gross_rent: null, utility_allowance: null },
          { bedrooms: '2BR', ami_tier: 60, count: 8, sqft: 850, proposed_gross_rent: null, utility_allowance: null }
        ];
        s.target_population = 'senior';
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('Fill rents at LIHTC max', function () {
        var s = getSubject();
        if (!s.county_fips) {
          alert('Pick a county above first — LIHTC max rents are county-specific.');
          return;
        }
        var schedule = RentLimits.rentSchedule(s, { chfaTable: chfa });
        (s.unit_mix || []).forEach(function (r, i) {
          if (!schedule.rows[i].isMarket && schedule.rows[i].limit.grossRent != null) {
            r.proposed_gross_rent = schedule.rows[i].limit.grossRent;
          }
        });
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('Clear all', function () {
        if (!confirm('Clear all Subject Project data?')) return;
        setSubject(Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [], utility_allowance_basis: _newAllowanceBasis() }));
        _redrawRows();
        _redrawTotals();
        // Force re-render of meta inputs
        Array.from(meta.querySelectorAll('input,select')).forEach(function (el) {
          var k = el.getAttribute('data-key');
          if (!k) return;
          el.value = '';
        });
      }));
      wrap.appendChild(btnBar);

      // Notes
      var notesWrap = $h('div', { style: { marginTop: '.5rem' } }, [
        $h('label', { for: 'sp-notes', style: { display: 'block',
          fontSize: '.7rem', color: 'var(--muted)', marginBottom: '2px' } }, ['Notes (optional)']),
        $h('textarea', { id: 'sp-notes', 'data-key': 'notes', rows: '2',
          style: { width: '100%', padding: '5px 7px', border: '1px solid var(--border)',
                   borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                   fontSize: '.78rem', resize: 'vertical', fontFamily: 'inherit' } }, [
            subject.notes || ''
        ])
      ]);
      var ta = notesWrap.querySelector('textarea');
      ta.addEventListener('input', function () {
        var s = getSubject(); s.notes = ta.value; setSubject(s);
      });
      wrap.appendChild(notesWrap);

      _renderUnsubs.push(subscribe(function () { refreshBasis(); _redrawRows(); _redrawTotals(); }));
      refreshBasis();
      _redrawRows();
      _redrawTotals();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────
  global.SubjectProject = {
    mount: render,
    get: getSubject,
    set: setSubject,
    subscribe: subscribe,
    computeLihtcMaxRent: computeLihtcMaxRent,
    computeIncomeLimit: computeIncomeLimit,
    maxNetRent: maxNetRent,
    UA_MISSING_REASON: UA_MISSING_REASON,
    loadChfa: loadChfa,
    loadHud: loadHud,
    AMI_TIERS: AMI_TIERS,
    AMI_TIERS_REGULAR: AMI_TIERS_REGULAR,
    AMI_TIERS_RURAL_RESORT: AMI_TIERS_RURAL_RESORT,
    BEDROOMS: BEDROOMS,
    BR_HH_SIZE: RentLimits.BR_HH_SIZE,
    DEFAULT_SUBJECT: DEFAULT_SUBJECT
  };

})(window);
