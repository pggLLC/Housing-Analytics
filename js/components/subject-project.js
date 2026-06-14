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
 *   • loadChfa() / loadHud()      — singleton data loaders
 *   • DEFAULT_SUBJECT             — empty starter shape
 */
(function (global) {
  'use strict';
  if (global.SubjectProject) return;

  var STORAGE_KEY = 'coho.subjectProject.v1';
  var CHFA_DATA_URL = 'data/chfa-income-rent-limits-2026.json';
  var HUD_DATA_URL = 'data/hud-fmr-income-limits.json';  // kept for HUD FMR market comp

  // IRS §42 LIHTC max-rent imputed household size by bedroom count.
  var BR_HH_SIZE = {
    'efficiency': 1.0,
    '1BR':        1.5,
    '2BR':        3.0,
    '3BR':        4.5,
    '4BR':        6.0
  };

  // CHFA-published AMI tiers (regular counties). Rural-resort counties also
  // get 130/140/150/160 per Prop 123.
  var AMI_TIERS_REGULAR = [20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120];
  var AMI_TIERS_RURAL_RESORT = AMI_TIERS_REGULAR.concat([130, 140, 150, 160]);
  // The picker shows the LIHTC-common set by default to keep the dropdown
  // short; users can still type any tier the data file supports.
  var AMI_TIERS = [30, 40, 50, 60, 70, 80];
  var BEDROOMS  = ['efficiency', '1BR', '2BR', '3BR', '4BR'];

  // Bedroom → CHFA's max_rents key.
  var BR_TO_CHFA_KEY = {
    'efficiency': '0br', '1BR': '1br', '2BR': '2br', '3BR': '3br', '4BR': '4br'
  };

  var DEFAULT_SUBJECT = {
    project_name: '',
    address: '',
    county_fips: '',
    county_name: '',
    total_units: 0,
    site_acres: null,
    buildings: null,
    construction_type: 'new_construction', // or 'acquisition_rehab', 'preservation'
    credit_type: '9% competitive',
    in_migration_pct: 0,           // default conservative (0 = all PMA-resident demand)
    target_population: 'family',   // 'family', 'senior', 'PSH', 'workforce'
    use_hera_special: false,       // true for projects with PIS ≤ 12.31.2008 in a HERA county
    pis_date: null,                // optional placed-in-service date (informational)
    unit_mix: [],                  // rows: {bedrooms, ami_tier, count, sqft, proposed_gross_rent, utility_allowance}
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

  function _countyRow(data, fips) {
    if (!data || !data.counties || !fips) return null;
    fips = String(fips).padStart(5, '0');
    return data.counties.find(function (c) { return c.fips === fips; }) || null;
  }

  // Pick the right tier bucket given HERA preference.
  function _tiersBucket(countyRow, useHera) {
    if (!countyRow) return null;
    if (useHera && countyRow.hera_special && countyRow.hera_tiers) {
      // HERA-flagged counties only publish HERA limits for a subset of tiers
      // (30/40/45/50/55/60 typically). For tiers above the HERA range, fall
      // back to regular limits.
      return { hera: countyRow.hera_tiers, regular: countyRow.regular_tiers };
    }
    return { regular: countyRow.regular_tiers };
  }

  function _findTier(buckets, tier) {
    if (!buckets) return null;
    var key = String(tier);
    if (buckets.hera && buckets.hera[key]) return { row: buckets.hera[key], hera: true };
    if (buckets.regular && buckets.regular[key]) return { row: buckets.regular[key], hera: false };
    return null;
  }

  // Read CHFA-published income limit at a tier × HH size. Returns dollars or null.
  function computeIncomeLimit(chfa, fips, tier, familySize, opts) {
    var row = _countyRow(chfa, fips);
    if (!row) return null;
    var buckets = _tiersBucket(row, opts && opts.useHera);
    var hit = _findTier(buckets, tier);
    if (!hit || !hit.row.income_limits) return null;
    var key = familySize + 'p';
    var val = hit.row.income_limits[key];
    return val != null ? +val : null;
  }

  // Read CHFA-published LIHTC max gross rent at a tier × bedroom.
  // Returns { gross_rent, source: "CHFA published", hera }.
  function computeLihtcMaxRent(chfa, fips, tier, bedrooms, opts) {
    var row = _countyRow(chfa, fips);
    if (!row) return null;
    var buckets = _tiersBucket(row, opts && opts.useHera);
    var hit = _findTier(buckets, tier);
    if (!hit || !hit.row.max_rents) return null;
    var brKey = BR_TO_CHFA_KEY[bedrooms];
    if (!brKey) return null;
    var rent = hit.row.max_rents[brKey];
    if (rent == null) return null;
    return {
      gross_rent: +rent,
      source: 'CHFA published',
      hera: hit.hera,
      family_size: BR_HH_SIZE[bedrooms] || null
    };
  }

  // ── Storage ─────────────────────────────────────────────────────────
  var _subscribers = [];

  function getSubject() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [] });
      var parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SUBJECT, parsed);
    } catch (e) {
      return Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [] });
    }
  }

  function setSubject(s) {
    var next = Object.assign({}, DEFAULT_SUBJECT, s);
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

  // Sync county from SiteState on load.
  function _syncFromSiteState(s) {
    if (global.SiteState && typeof global.SiteState.getCounty === 'function') {
      var c = global.SiteState.getCounty();
      if (c && c.fips && (!s.county_fips || s.county_fips !== c.fips)) {
        s.county_fips = c.fips;
        s.county_name = c.name || '';
      }
    }
    return s;
  }

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

  // ── Renderer ────────────────────────────────────────────────────────
  function _renderRow(row, idx, onChange, onRemove, chfa, subject) {
    var lihtc = null;
    if (subject.county_fips) {
      lihtc = computeLihtcMaxRent(chfa, subject.county_fips, row.ami_tier, row.bedrooms,
        { useHera: !!subject.use_hera_special });
    }
    var maxRent = lihtc ? lihtc.gross_rent : null;
    var ua = +row.utility_allowance || 0;
    var maxNet = maxRent != null ? Math.max(0, maxRent - ua) : null;
    var proposed = +row.proposed_gross_rent || 0;
    var overMax  = maxRent != null && proposed > maxRent;

    var input = function (key, type, val, w) {
      return $h('input', {
        type: type || 'number',
        min: '0',
        value: val == null ? '' : val,
        'data-key': key,
        'data-idx': idx,
        style: { width: w || '78px', padding: '3px 5px', border: '1px solid var(--border)',
                 borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                 fontSize: '.78rem' }
      });
    };
    var select = function (key, val, opts) {
      var sel = $h('select', {
        'data-key': key, 'data-idx': idx,
        style: { padding: '3px 5px', border: '1px solid var(--border)',
                 borderRadius: '3px', background: 'var(--card)', color: 'var(--text)',
                 fontSize: '.78rem' }
      });
      opts.forEach(function (o) {
        var op = $h('option', { value: o.value }, [o.label]);
        if (o.value === val) op.selected = true;
        sel.appendChild(op);
      });
      return sel;
    };

    var brSel  = select('bedrooms', row.bedrooms, BEDROOMS.map(function (b) {
      return { value: b, label: b === 'efficiency' ? 'Eff' : b };
    }));
    var amiSel = select('ami_tier', row.ami_tier, AMI_TIERS.map(function (t) {
      return { value: t, label: t + '%' };
    }));

    var tr = $h('tr', {}, [
      $h('td', { style: { padding: '4px 6px' } }, [brSel]),
      $h('td', { style: { padding: '4px 6px' } }, [amiSel]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('count', 'number', row.count)]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('sqft', 'number', row.sqft, '70px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('proposed_gross_rent', 'number', row.proposed_gross_rent, '78px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right' } }, [input('utility_allowance', 'number', row.utility_allowance, '60px')]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right',
                          color: overMax ? 'var(--bad,#c14545)' : 'var(--muted)',
                          fontWeight: overMax ? '600' : '400' } }, [
        maxRent == null ? '—' : $fmtMoney(maxRent)
      ]),
      $h('td', { style: { padding: '4px 6px', textAlign: 'right', color: 'var(--muted)' } }, [
        maxNet == null ? '—' : $fmtMoney(maxNet)
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
    var rm = tr.querySelector('button[data-action=remove]');
    if (rm) rm.addEventListener('click', function () { onRemove(idx); });
    return tr;
  }

  function render(container) {
    if (!container) return;
    var subject = _syncFromSiteState(getSubject());
    setSubject(subject);  // ensures updated_at

    loadChfa().then(function (chfa) {
      container.innerHTML = '';
      var wrap = $h('div', { class: 'subject-project-wrap' });
      container.appendChild(wrap);

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
      subscribe(function (s) {
        var ind = wrap.querySelector('[data-role="saved-indicator"]');
        if (ind) {
          ind.textContent = s.updated_at
            ? 'Saved ' + new Date(s.updated_at).toLocaleString()
            : 'Unsaved';
        }
      });

      wrap.appendChild($h('p', { style: { margin: '0 0 .75rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'Anchor the analysis to a specific proposed project. This drives the LIHTC max-rent comparison, ',
        'the income-eligibility table, and the per-tier capture-rate stack. ',
        'All fields persist locally — nothing leaves your browser.'
      ]));

      // ── Project meta (basic) ──
      var meta = $h('div', { style: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
            value: subject[key] == null ? '' : subject[key],
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
        s[key] = val;
        if (key === 'county_fips') {
          var row = _countyRow(chfa, val);
          s.county_name = row ? row.county_name : '';
          // If the user picks a non-HERA county, force HERA toggle off.
          if (row && !row.hera_special) s.use_hera_special = false;
        }
        setSubject(s);
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
          ' — only for Housing Tax Credit projects with PIS ≤ 2008-12-31 in a HERA county.'
        ])
      ]);
      var heraCb = heraLabel.querySelector('input');
      heraCb.checked = !!subject.use_hera_special;
      heraCb.addEventListener('change', _onMetaChange);
      heraWrap.appendChild(heraLabel);
      // Auto-disable when county is not HERA-eligible
      function _refreshHeraEnabled() {
        var s = getSubject();
        var row = _countyRow(chfa, s.county_fips);
        var enable = !!(row && row.hera_special);
        heraCb.disabled = !enable;
        heraWrap.style.opacity = enable ? '1' : '.55';
      }
      _refreshHeraEnabled();
      subscribe(_refreshHeraEnabled);
      wrap.appendChild(heraWrap);

      // ── Unit mix table ──
      wrap.appendChild($h('h3', { style: { margin: '0 0 .35rem', fontSize: '.95rem' } }, ['Unit mix']));
      wrap.appendChild($h('p', { style: { margin: '0 0 .4rem', fontSize: '.74rem',
        color: 'var(--muted)' } }, [
        'LIHTC max gross rent is read directly from CHFA\'s published "Income Limit and ' +
        'Maximum Rent Tables for All Colorado Counties" (' + amiSrc + ', HUD effective ' +
        amiEff + '). Tiers below match the LIHTC-common set; the underlying CHFA file covers ' +
        '20–120% AMI (plus 130–160% for the 12 Prop 123 rural-resort counties).'
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
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Proposed gross rent']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Utility allow.']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max gross']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max net']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'center' } }, ['']),
        ])
      ]);
      var tbody = $h('tbody', {});
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);

      function _redrawRows() {
        var s = getSubject();
        tbody.innerHTML = '';
        (s.unit_mix || []).forEach(function (row, i) {
          tbody.appendChild(_renderRow(row, i, function (idx, el) {
            var s2 = getSubject();
            var k = el.getAttribute('data-key');
            var v = el.value;
            if (el.type === 'number') v = v === '' ? null : +v;
            if (k === 'ami_tier') v = +v;
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
          }, chfa, s));
        });
        if ((s.unit_mix || []).length === 0) {
          tbody.appendChild($h('tr', {}, [
            $h('td', { colspan: '9', style: { padding: '14px 8px', textAlign: 'center',
              color: 'var(--muted)', fontSize: '.8rem' } }, [
              'No unit-mix rows yet. Use the buttons below to add a row.'
            ])
          ]));
        }
      }

      var totals = $h('div', { style: { fontSize: '.78rem', color: 'var(--muted)',
        margin: '.35rem 0 .65rem' } });
      function _redrawTotals() {
        var s = getSubject();
        var totalUnits = (s.unit_mix || []).reduce(function (a, r) { return a + (+r.count || 0); }, 0);
        var tierCounts = {};
        AMI_TIERS.forEach(function (t) { tierCounts[t] = 0; });
        (s.unit_mix || []).forEach(function (r) {
          if (tierCounts[r.ami_tier] != null) tierCounts[r.ami_tier] += (+r.count || 0);
        });
        var bits = ['Total: ' + totalUnits + ' units'];
        AMI_TIERS.forEach(function (t) {
          if (tierCounts[t] > 0) bits.push(t + '% AMI: ' + tierCounts[t]);
        });
        totals.textContent = bits.join(' · ');
        if (totalUnits !== s.total_units) {
          s.total_units = totalUnits;
          setSubject(s);
        }
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
          proposed_gross_rent: null, utility_allowance: 0 });
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('+ Family preset (30/50/60 mix)', function () {
        var s = getSubject();
        s.unit_mix = [
          { bedrooms: '1BR', ami_tier: 30, count: 4, sqft: 650, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '1BR', ami_tier: 60, count: 8, sqft: 650, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '2BR', ami_tier: 50, count: 8, sqft: 900, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '2BR', ami_tier: 60, count: 12, sqft: 900, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '3BR', ami_tier: 60, count: 8, sqft: 1150, proposed_gross_rent: null, utility_allowance: 0 }
        ];
        s.target_population = 'family';
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('+ Senior preset (50/60 mix)', function () {
        var s = getSubject();
        s.unit_mix = [
          { bedrooms: '1BR', ami_tier: 30, count: 6, sqft: 600, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '1BR', ami_tier: 50, count: 12, sqft: 600, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '1BR', ami_tier: 60, count: 14, sqft: 600, proposed_gross_rent: null, utility_allowance: 0 },
          { bedrooms: '2BR', ami_tier: 60, count: 8, sqft: 850, proposed_gross_rent: null, utility_allowance: 0 }
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
        (s.unit_mix || []).forEach(function (r) {
          var lihtc = computeLihtcMaxRent(chfa, s.county_fips, r.ami_tier, r.bedrooms,
            { useHera: !!s.use_hera_special });
          if (lihtc) r.proposed_gross_rent = lihtc.gross_rent;
        });
        setSubject(s);
        _redrawRows();
        _redrawTotals();
      }));
      btnBar.appendChild(btn('Clear all', function () {
        if (!confirm('Clear all Subject Project data?')) return;
        setSubject(Object.assign({}, DEFAULT_SUBJECT, { unit_mix: [] }));
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
    loadChfa: loadChfa,
    loadHud: loadHud,
    AMI_TIERS: AMI_TIERS,
    AMI_TIERS_REGULAR: AMI_TIERS_REGULAR,
    AMI_TIERS_RURAL_RESORT: AMI_TIERS_RURAL_RESORT,
    BEDROOMS: BEDROOMS,
    BR_HH_SIZE: BR_HH_SIZE,
    DEFAULT_SUBJECT: DEFAULT_SUBJECT
  };

})(window);
