/**
 * js/components/capital-partners.js — F138
 * =========================================
 * Renders a "Capital partners" section for any HNA / OF / Compare
 * jurisdiction view. Pulls from data/capital-partners.json — a
 * curated roster of CHFA, USDA RD, DOLA, Enterprise, LISC, Mercy,
 * FHLB, Fannie / Freddie, and selected impact lenders covering CO.
 *
 * The component is geography-agnostic by default (all partners are
 * statewide or national). The caller can pass a hint like
 * `{ dealTypes: ['lihtc-4pct','preservation'] }` to surface only
 * partners aligned to the deal type the user is scoping.
 *
 * Usage:
 *   CapitalPartners.attach(containerEl, {
 *     dealTypes: ['lihtc-4pct','preservation'],   // optional
 *     jurisName: 'Glenwood Springs'              // for header
 *   });
 *
 * Caches the JSON fetch so repeat attaches don't re-fetch.
 */
(function (global) {
  'use strict';
  if (global.CapitalPartners) return;

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
    _promise = fetch(_resolvePath('data/capital-partners.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _data = d || { partners: [] }; return _data; })
      .catch(function (e) {
        console.warn('[CapitalPartners] fetch failed', e);
        return { partners: [] };
      });
    return _promise;
  }

  function _ensureStyles() {
    if (document.getElementById('cp-styles')) return;
    var st = document.createElement('style');
    st.id = 'cp-styles';
    st.textContent = [
      '.cp-list { list-style:none; padding-left:0; margin:.4rem 0; }',
      '.cp-item {',
      '  padding:.5rem .65rem; margin-bottom:.4rem;',
      '  border:1px solid var(--border, rgba(0,0,0,.08)); border-radius:6px;',
      '  background: color-mix(in oklab, var(--bg2, #f3f4f6) 60%, transparent);',
      '}',
      '.cp-item__head { display:flex; flex-wrap:wrap; gap:.4rem; align-items:baseline; }',
      '.cp-item__name { font-weight:700; font-size:.92rem; }',
      '.cp-item__cat { font-size:.7rem; padding:1px 7px; border-radius:9px;',
      '                background:rgba(99,102,241,.12); color:#4338ca;',
      '                border:1px solid rgba(99,102,241,.3); font-weight:700; }',
      '.dark-mode .cp-item__cat { background:rgba(99,102,241,.18); color:#a5b4fc; }',
      '.cp-item__area { font-size:.78rem; color:var(--muted); }',
      '.cp-item__deal-types { display:flex; flex-wrap:wrap; gap:.25rem; margin-top:.25rem; }',
      '.cp-deal-tag { font-size:.68rem; padding:1px 6px; border-radius:9px;',
      '               background:rgba(16,185,129,.12); color:#047857;',
      '               border:1px solid rgba(16,185,129,.3); font-weight:600; }',
      '.dark-mode .cp-deal-tag { background:rgba(16,185,129,.18); color:#34d399; }',
      '.cp-item__notes { font-size:.78rem; margin-top:.3rem; line-height:1.4; }',
      '.cp-item__contact { font-size:.74rem; color:var(--muted); margin-top:.2rem; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // Match a partner against a deal-type hint. If the hint is empty,
  // include everyone. Otherwise include any partner whose deal_types
  // intersect the hint.
  function _matches(partner, dealTypes) {
    if (!dealTypes || !dealTypes.length) return true;
    if (!Array.isArray(partner.deal_types)) return true;
    return partner.deal_types.some(function (t) { return dealTypes.indexOf(t) !== -1; });
  }

  function _renderPartner(p) {
    var dealTagsHtml = (Array.isArray(p.deal_types) ? p.deal_types : [])
      .map(function (t) { return '<span class="cp-deal-tag">' + _esc(t) + '</span>'; })
      .join('');
    return '<li class="cp-item">' +
             '<div class="cp-item__head">' +
               (p.url
                 ? '<a href="' + _esc(p.url) + '" target="_blank" rel="noopener" class="cp-item__name">' + _esc(p.name) + '</a>'
                 : '<span class="cp-item__name">' + _esc(p.name) + '</span>') +
               (p.category ? '<span class="cp-item__cat">' + _esc(p.category) + '</span>' : '') +
               (p.service_area ? '<span class="cp-item__area">· ' + _esc(p.service_area) + '</span>' : '') +
             '</div>' +
             (dealTagsHtml ? '<div class="cp-item__deal-types">' + dealTagsHtml + '</div>' : '') +
             (p.notes ? '<div class="cp-item__notes">' + _esc(p.notes) + '</div>' : '') +
             (p.contact_path ? '<div class="cp-item__contact">' + _esc(p.contact_path) + '</div>' : '') +
           '</li>';
  }

  // F147 — interactive deal-type filter. When `interactive` is true the
  // section renders a radio strip the user can click to narrow the
  // partner list to a specific stack (9% / 4% / preservation / USDA /
  // workforce / Prop 123). Initial selection is `opts.dealTypes` if
  // provided, otherwise "all".
  var _activeFilters = new WeakMap();  // per-container active dealType key

  var FILTER_OPTIONS = [
    { key: '',                 label: 'All',                  types: [] },
    { key: 'lihtc-9pct',       label: '9% LIHTC',             types: ['lihtc-9pct','lihtc-state'] },
    { key: 'lihtc-4pct',       label: '4% LIHTC + PAB',       types: ['lihtc-4pct','lihtc-state'] },
    { key: 'preservation',     label: 'Preservation',         types: ['preservation','equity-syndication','permanent-debt'] },
    { key: 'usda-rd',          label: 'USDA RD / rural',      types: ['usda-rd','preservation'] },
    { key: 'workforce',        label: 'Workforce / 60-120% AMI', types: ['workforce','soft-debt','prop123'] },
    { key: 'prop123',          label: 'Prop 123 stack',       types: ['prop123','soft-debt','lihtc-4pct'] }
  ];

  function _filterRadioHtml(activeKey) {
    return '<div class="cp-filter-row" role="radiogroup" aria-label="Deal type filter">' +
      FILTER_OPTIONS.map(function (opt) {
        var active = (opt.key === activeKey);
        return '<button type="button" role="radio" aria-checked="' + active + '"' +
               ' data-cp-filter="' + _esc(opt.key) + '"' +
               ' class="cp-filter' + (active ? ' cp-filter--active' : '') + '">' +
               _esc(opt.label) + '</button>';
      }).join('') + '</div>';
  }

  function _ensureFilterStyles() {
    if (document.getElementById('cp-filter-styles')) return;
    var st = document.createElement('style');
    st.id = 'cp-filter-styles';
    st.textContent = [
      '.cp-filter-row { display:flex; flex-wrap:wrap; gap:.3rem; margin:.4rem 0 .6rem; }',
      '.cp-filter {',
      '  font:inherit; font-size:.78rem; padding:.25rem .65rem;',
      '  background: var(--bg2, #f3f4f6); color: var(--text);',
      '  border:1px solid var(--border, rgba(0,0,0,.15)); border-radius:14px;',
      '  cursor:pointer; transition: background .12s, border-color .12s;',
      '}',
      '.cp-filter:hover { background: color-mix(in oklab, var(--bg2,#f3f4f6) 60%, var(--accent,#6366f1) 25%); }',
      '.cp-filter--active {',
      '  background: var(--accent, #6366f1); color: white;',
      '  border-color: var(--accent, #6366f1);',
      '}',
      '.cp-filter:focus-visible { outline:2px solid var(--accent,#6366f1); outline-offset:2px; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _render(container, data, activeKey, opts) {
    var activeOpt = FILTER_OPTIONS.find(function (o) { return o.key === activeKey; }) || FILTER_OPTIONS[0];
    var filterTypes = activeOpt.types.length ? activeOpt.types : (opts.dealTypes || []);
    var partners = (data.partners || []).filter(function (p) {
      return _matches(p, filterTypes);
    });
    var caption = opts.jurisName
      ? 'Capital sources sized to ' + _esc(opts.jurisName) + ' deals'
      : 'Capital sources active in Colorado';
    var hint = activeOpt.key
      ? ' · showing ' + partners.length + ' partner(s) aligned to <strong>' + _esc(activeOpt.label) + '</strong>'
      : ' · ' + partners.length + ' total partner(s); pick a deal type above to narrow';
    var mfHtml = window.MethodFooter ? window.MethodFooter.html({
      source:    'data/capital-partners.json (curated)',
      sourceUrl: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/capital-partners.json',
      vintage:   data.metadata && data.metadata.generated,
      method:    'Curated from each lender\'s own website. Statewide + national CO coverage unless noted. Filter narrows by partner deal_types (each partner is tagged with the stacks they actively work on).',
      confidence:'med'
    }) : '';
    var emptyMsg = partners.length ? '' :
      '<p style="color:var(--muted);font-size:.85rem;padding:.5rem">' +
        'No partners on file with that deal-type tag. Update data/capital-partners.json to expand the roster.</p>';
    container.innerHTML =
      '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' + _esc(caption) + hint + '</p>' +
      (opts.interactive !== false ? _filterRadioHtml(activeKey) : '') +
      emptyMsg +
      '<ul class="cp-list">' + partners.map(_renderPartner).join('') + '</ul>' +
      mfHtml;
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    _ensureFilterStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading capital partners…</p>';
    _load().then(function (data) {
      // Initial active filter: derive from opts.dealTypes if it matches
      // a known filter option, else "all".
      var initialKey = '';
      if (Array.isArray(opts.dealTypes) && opts.dealTypes.length) {
        var match = FILTER_OPTIONS.find(function (o) {
          return o.types.length && o.types.every(function (t) { return opts.dealTypes.indexOf(t) !== -1; });
        });
        if (match) initialKey = match.key;
      }
      _activeFilters.set(container, initialKey);
      _render(container, data, initialKey, opts);

      // Delegate filter clicks (interactive mode)
      if (opts.interactive !== false) {
        container.addEventListener('click', function (e) {
          var btn = e.target.closest && e.target.closest('[data-cp-filter]');
          if (!btn || !container.contains(btn)) return;
          var k = btn.getAttribute('data-cp-filter');
          _activeFilters.set(container, k);
          _render(container, data, k, opts);
        });
      }
    });
  }

  function loadRoster() { return _load(); }

  global.CapitalPartners = { attach: attach, loadRoster: loadRoster };
})(typeof window !== 'undefined' ? window : globalThis);
