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
 * HUD MTSP/LIHTC max-rent methodology:
 *   Max gross rent = 30% × income_limit(AMI tier, family_size_for_bedroom) ÷ 12
 *   where family_size_for_bedroom:
 *     Eff = 1.0 person, 1BR = 1.5, 2BR = 3.0, 3BR = 4.5, 4BR = 6.0
 *   (See HUD HBL 4350.3 + IRS Section 42.)
 *
 * Family-size adjustment factor (HUD):
 *   1p = 0.70, 2p = 0.80, 3p = 0.90, 4p = 1.00,
 *   5p = 1.08, 6p = 1.16, 7p = 1.24, 8p = 1.32
 *   (Tiers 40% and 70% AMI computed from 100% AMI x tier/100 x adj.)
 *
 * Exposes window.SubjectProject:
 *   • mount(container)            — render input + cards
 *   • get()                       — read current Subject from storage
 *   • set(subject)                — write Subject + notify subscribers
 *   • subscribe(fn)               — fire on every change
 *   • computeLihtcMaxRent(t,br,c) — pure helper; returns gross + tier
 *   • computeIncomeLimit(...)     — pure helper; returns dollars
 *   • DEFAULT_SUBJECT             — empty starter shape
 */
(function (global) {
  'use strict';
  if (global.SubjectProject) return;

  var STORAGE_KEY = 'coho.subjectProject.v1';
  var HUD_DATA_URL = 'data/hud-fmr-income-limits.json';

  // HUD family-size adjustment factors (multiplier vs 4-person 100% AMI).
  var FAMILY_SIZE_FACTOR = {
    1: 0.70, 2: 0.80, 3: 0.90, 4: 1.00,
    5: 1.08, 6: 1.16, 7: 1.24, 8: 1.32
  };

  // LIHTC max-rent imputed household size by bedroom count.
  var BR_HH_SIZE = {
    'efficiency': 1.0,
    '1BR':        1.5,
    '2BR':        3.0,
    '3BR':        4.5,
    '4BR':        6.0
  };

  var AMI_TIERS = [30, 40, 50, 60, 70, 80];
  var BEDROOMS  = ['efficiency', '1BR', '2BR', '3BR', '4BR'];

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
    unit_mix: [],                  // rows: {bedrooms, ami_tier, count, sqft, proposed_gross_rent, utility_allowance}
    amenities: [],                 // free-text checklist
    notes: '',
    updated_at: null
  };

  // ── HUD data loader (singleton cache) ───────────────────────────────
  var _hudCache = null;
  function loadHud() {
    if (_hudCache) return _hudCache;
    _hudCache = fetch(HUD_DATA_URL)
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return _hudCache;
  }

  function _countyRow(hud, fips) {
    if (!hud || !hud.counties || !fips) return null;
    fips = String(fips).padStart(5, '0');
    return hud.counties.find(function (c) { return c.fips === fips; }) || null;
  }

  // Compute family-size-adjusted income limit at any tier (30..80) for any size 1-8.
  // Uses published 4-person 100% AMI (ami_4person) × tier/100 × factor.
  function computeIncomeLimit(hud, fips, tier, familySize) {
    var row = _countyRow(hud, fips);
    if (!row || !row.income_limits || !row.income_limits.ami_4person) return null;
    var ami100 = +row.income_limits.ami_4person;
    var factor = FAMILY_SIZE_FACTOR[familySize] || FAMILY_SIZE_FACTOR[4];
    var raw = ami100 * (tier / 100) * factor;
    // HUD rounds income limits to nearest $50 then $100.  Use $50 here as
    // a documented approximation — exact rule varies by tier.
    return Math.round(raw / 50) * 50;
  }

  // Compute LIHTC max gross rent for a given tier × bedroom × county.
  // Returns { gross_rent: $/mo, family_size, income_limit }.
  function computeLihtcMaxRent(hud, fips, tier, bedrooms) {
    var size = BR_HH_SIZE[bedrooms];
    if (size == null) return null;
    // For half-sizes we interpolate between integer family sizes.
    var floor = Math.floor(size), ceil = Math.ceil(size);
    var ilFloor = computeIncomeLimit(hud, fips, tier, floor);
    var ilCeil  = computeIncomeLimit(hud, fips, tier, ceil);
    if (ilFloor == null || ilCeil == null) return null;
    var t = size - floor;
    var il = ilFloor * (1 - t) + ilCeil * t;
    var gross = Math.floor(il * 0.30 / 12);
    return {
      gross_rent: gross,
      family_size: size,
      income_limit: Math.round(il)
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
  function _renderRow(row, idx, onChange, onRemove, hud, subject) {
    var lihtc = null;
    if (subject.county_fips) {
      lihtc = computeLihtcMaxRent(hud, subject.county_fips, row.ami_tier, row.bedrooms);
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

    loadHud().then(function (hud) {
      container.innerHTML = '';
      var wrap = $h('div', { class: 'subject-project-wrap' });
      container.appendChild(wrap);

      var amiSrc = hud && hud.meta ? hud.meta.fiscal_year : '—';
      var countyOpts = (hud && hud.counties) ? hud.counties.map(function (c) {
        return { value: c.fips, label: c.county_name + ' (' + c.fmr_area_name + ')' };
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
            color: 'var(--muted)' } }, ['HUD MTSP FY' + amiSrc])
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
        if (el.type === 'number') val = val === '' ? null : +val;
        var s = getSubject();
        s[key] = val;
        if (key === 'county_fips') {
          var row = _countyRow(hud, val);
          s.county_name = row ? row.county_name : '';
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

      // ── Unit mix table ──
      wrap.appendChild($h('h3', { style: { margin: '0 0 .35rem', fontSize: '.95rem' } }, ['Unit mix']));
      wrap.appendChild($h('p', { style: { margin: '0 0 .4rem', fontSize: '.74rem',
        color: 'var(--muted)' } }, [
        'LIHTC max gross rent is computed from county MTSP income limits ' +
        '(HUD HBL 4350.3 / IRS §42). Family-size imputation by bedroom: ' +
        'Eff=1.0, 1BR=1.5, 2BR=3.0, 3BR=4.5, 4BR=6.0. Tiers 40% and 70% ' +
        'computed from published 30/50/60/80 via standard scaling.'
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
          }, hud, s));
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
          var lihtc = computeLihtcMaxRent(hud, s.county_fips, r.ami_tier, r.bedrooms);
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
    loadHud: loadHud,
    AMI_TIERS: AMI_TIERS,
    BEDROOMS: BEDROOMS,
    BR_HH_SIZE: BR_HH_SIZE,
    FAMILY_SIZE_FACTOR: FAMILY_SIZE_FACTOR,
    DEFAULT_SUBJECT: DEFAULT_SUBJECT
  };

})(window);
