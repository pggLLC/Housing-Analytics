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

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading capital partners…</p>';
    _load().then(function (data) {
      var partners = (data.partners || []).filter(function (p) {
        return _matches(p, opts.dealTypes);
      });
      if (!partners.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
          'No matching capital partners on file. Update data/capital-partners.json to expand the roster.</p>';
        return;
      }
      var caption = opts.jurisName
        ? 'Capital sources sized to ' + _esc(opts.jurisName) + ' deals'
        : 'Capital sources active in Colorado';
      var dealHint = (opts.dealTypes && opts.dealTypes.length)
        ? ' · filtered by: ' + opts.dealTypes.map(_esc).join(', ')
        : '';
      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        source:    'data/capital-partners.json (curated)',
        sourceUrl: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/capital-partners.json',
        vintage:   data.metadata && data.metadata.generated,
        method:    'Curated from each lender\'s own website. Statewide + national CO coverage unless noted. Filter by deal_types to show partners aligned to the specific stack (LIHTC 4%, preservation, USDA RD, etc.).',
        confidence:'med'
      }) : '';
      container.innerHTML =
        '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
          _esc(caption) + dealHint + '</p>' +
        '<ul class="cp-list">' + partners.map(_renderPartner).join('') + '</ul>' +
        mfHtml;
    });
  }

  function loadRoster() { return _load(); }

  global.CapitalPartners = { attach: attach, loadRoster: loadRoster };
})(typeof window !== 'undefined' ? window : globalThis);
