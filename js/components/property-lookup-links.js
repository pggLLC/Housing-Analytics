/**
 * js/components/property-lookup-links.js — F124
 * ==============================================
 * Reusable helper that builds "look up this property" link bars for any
 * affordable-housing property record. Used by the HNA LIHTC info panel,
 * the affordable-housing map layer popup, and any future surface that
 * shows a property name + address.
 *
 * Three goals:
 *   1. Let the user verify a property exists in the source-of-record
 *      (CHFA, HUD MF, USDA RD, NHPD).
 *   2. Let the user see the building on the ground (Google Maps + street).
 *   3. Let the user catch up on recent activity (news search, DOLA awards).
 *
 * Usage:
 *   PropertyLookup.htmlFor(p)           → ready-to-paste link bar (HTML)
 *   PropertyLookup.htmlFor(p, { compact: true })  → smaller variant
 *   PropertyLookup.creditTypeTip(credit) → { label, desc } for tooltip
 *
 * The `p` argument can be either a CHFA ArcGIS feature.properties object
 * (PROJECT, PROJ_ADD, PROJ_CTY, PROJ_ST, TypeOfCredits) OR a unified
 * record from properties.json (property_name, address, city, type_of_
 * credits, program_type[]). Both shapes are auto-detected.
 */
(function (global) {
  'use strict';
  if (global.PropertyLookup) return;

  // ─────────────────────────────────────────────────────────────────────
  // Credit-type tooltips. Maps the most common CHFA / HUD credit-type
  // strings to a plain-English explanation. Used by the popup hover.
  // ─────────────────────────────────────────────────────────────────────
  var CREDIT_TIPS = {
    '9%':            'Federal 9% Low-Income Housing Tax Credit (IRC §42). CHFA allocates competitively; ~30% of project cost lands as equity. The classic new-construction subsidy.',
    '9% Competitive':'Federal 9% LIHTC — competitively allocated by CHFA each year. ~30% equity yield. Hardest layer to win; most-subsidized stack.',
    '4%':            'Federal 4% LIHTC paired with tax-exempt private activity bonds. No competitive cap (bond-driven). ~25% equity. Common for larger deals + preservation.',
    '4% Tax Exempt': 'Federal 4% LIHTC with tax-exempt bond financing. Bond-driven, no competitive cap. ~25% equity. Common for larger or preservation deals.',
    'State':         'Colorado State LIHTC — stacks on top of federal 4% or 9%. Roughly doubles equity yield. Tax credit recapture risk if income compliance fails.',
    'State LIHTC':   'Colorado State LIHTC — stacks on top of federal 4% or 9%. Roughly doubles equity yield.',
    'MIHTC':         'Middle Income Housing Tax Credit — Colorado state-only credit. Serves 80–120% AMI. Small annual cap; CHFA-allocated.',
    'TOC':           'Transit-Oriented Communities — bonus / set-aside category in CHFA QAP for projects near rail or high-frequency bus stops.',
    'Prop 123':      'Proposition 123 — Colorado statutory affordable-housing fund (since 2022). Direct equity grant; stacks with federal LIHTC.',
  };

  function _matchCreditTip(creditStr) {
    if (!creditStr) return null;
    var s = String(creditStr).trim();
    // Exact match first
    if (CREDIT_TIPS[s]) return { label: s, desc: CREDIT_TIPS[s] };
    // Then substring match — order matters for paired stacks
    var upper = s.toUpperCase();
    var parts = [];
    if (upper.indexOf('9%') !== -1 || upper.indexOf('9 %') !== -1) parts.push({ label: '9% LIHTC',     desc: CREDIT_TIPS['9%'] });
    if (upper.indexOf('4%') !== -1 || upper.indexOf('4 %') !== -1) parts.push({ label: '4% LIHTC',     desc: CREDIT_TIPS['4%'] });
    if (upper.indexOf('TAX EXEMPT') !== -1 && !parts.length)       parts.push({ label: '4% Tax Exempt',desc: CREDIT_TIPS['4% Tax Exempt'] });
    if (upper.indexOf('MIHTC') !== -1)                              parts.push({ label: 'MIHTC',       desc: CREDIT_TIPS['MIHTC'] });
    if (upper.indexOf('STATE') !== -1)                              parts.push({ label: 'State LIHTC', desc: CREDIT_TIPS['State'] });
    if (upper.indexOf('TOC') !== -1)                                parts.push({ label: 'TOC',         desc: CREDIT_TIPS['TOC'] });
    if (upper.indexOf('PROP 123') !== -1 || upper.indexOf('PROP123') !== -1) {
      parts.push({ label: 'Prop 123', desc: CREDIT_TIPS['Prop 123'] });
    }
    if (!parts.length) return { label: s, desc: 'Credit type not in our reference table — see CHFA portfolio for detail.' };
    // Combine into a single tooltip for stacked credits
    return {
      label: parts.map(function (p) { return p.label; }).join(' + '),
      desc: parts.map(function (p) { return '• ' + p.label + ': ' + p.desc; }).join('\n')
    };
  }

  // Expose so popup / info panel can build tooltip HTML
  function creditTypeTip(creditStr) {
    return _matchCreditTip(creditStr);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Unify a property record from either ArcGIS or properties.json shape.
  // ─────────────────────────────────────────────────────────────────────
  function _normalize(p) {
    if (!p) return null;
    return {
      name:    p.property_name || p.PROJECT || p.PROJ_NM || p.project || '',
      address: p.address       || p.STD_ADDR || p.PROJ_ADD || '',
      city:    p.city          || p.STD_CITY || p.PROJ_CTY || '',
      state:   p.state         || p.STD_ST   || p.PROJ_ST  || 'CO',
      zip:     p.zip           || p.STD_ZIP5 || '',
      county:  p.county_fips   || p.CNTY_FIPS || '',
      creditType: p.type_of_credits || p.CREDIT || p.TypeOfCredits || '',
      programs: Array.isArray(p.program_type) ? p.program_type : [],
      source:  p.source || '',
      lat:     Number.isFinite(p.lat) ? p.lat : null,
      lng:     Number.isFinite(p.lng) ? p.lng : null,
    };
  }

  function _enc(s) { return encodeURIComponent(String(s || '')); }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─────────────────────────────────────────────────────────────────────
  // Build lookup link list.
  // ─────────────────────────────────────────────────────────────────────
  function _buildLinks(n) {
    var links = [];
    var fullAddr = [n.address, n.city, n.state, n.zip].filter(Boolean).join(', ');

    // 1. Google Maps — works for any property with address OR coordinates.
    if (fullAddr) {
      links.push({
        key:   'map',
        label: 'Map',
        title: 'Open this property on Google Maps (street view + driving directions)',
        url:   'https://www.google.com/maps/search/?api=1&query=' + _enc(fullAddr),
        icon:  '🗺️'
      });
    } else if (Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
      links.push({
        key:   'map',
        label: 'Map',
        title: 'Open this location on Google Maps',
        url:   'https://www.google.com/maps/search/?api=1&query=' + n.lat + ',' + n.lng,
        icon:  '🗺️'
      });
    }

    // 2. News search — always useful for catching up on award announcements,
    //    NIMBY pushback, rehab activity, etc. F165: targeted property-news
    //    query (housing keywords + funding/award/preservation/refinance/
    //    closing/lease-up + last 12 months) via shared SearchLinks helper.
    if (n.name) {
      var newsUrl;
      var newsTitle = 'Search recent news mentions of this property (funding, award, preservation, refinance, closing, lease-up — last 12 months)';
      if (global.SearchLinks && typeof global.SearchLinks.build === 'function') {
        var built = global.SearchLinks.build({
          context:          'property-news',
          propertyName:     n.name,
          jurisdictionName: n.city
        });
        newsUrl = built.url;
        if (built.title) newsTitle = built.title;
      } else {
        // Fallback if SearchLinks isn't loaded — still better than a raw
        // jurisdiction-only query.
        newsUrl = 'https://www.google.com/search?tbm=nws&q=' +
                  _enc('"' + n.name + '" ' + (n.city ? '"' + n.city + '" ' : '') +
                       'Colorado affordable housing');
      }
      links.push({
        key:   'news',
        label: 'News',
        title: newsTitle,
        url:   newsUrl,
        icon:  '📰'
      });
    }

    // 3. CHFA portfolio — only for LIHTC properties. CHFA does not expose a
    //    per-property URL, so we link to the searchable portfolio page.
    var isLihtc = n.programs.some(function (t) { return t.indexOf('lihtc-') === 0; }) ||
                  /CHFA/i.test(n.source) ||
                  /LIHTC/i.test(n.creditType);
    if (isLihtc) {
      // F183 — Link to CHFA's portfolio search; user types the name once
      // they land there. (Prior versions tried ?propertyName= which CHFA
      // ignores — see F182. The Google-redirect version felt indirect to
      // users; keep this as a clean direct link.)
      links.push({
        key:   'chfa',
        label: 'CHFA',
        title: 'Open CHFA tax-credit property search',
        url:   'https://co.chfainfo.com/find-a-tax-credit-property',
        icon:  '🏛️'
      });
    }

    // 4. HUD MF property finder — for HUD-administered subsidy contracts.
    var isHudMf = n.programs.indexOf('hud-multifamily') !== -1 ||
                  /HUD MULT/i.test(n.source);
    if (isHudMf) {
      links.push({
        key:   'hud',
        label: 'HUD MF',
        title: 'Search HUD\'s Multifamily Properties Assisted database',
        url:   'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted/explore?location=' +
               (Number.isFinite(n.lat) && Number.isFinite(n.lng) ? n.lat + ',' + n.lng + ',16' : '39.0,-105.5,7'),
        icon:  '🏢'
      });
    }

    // 5. USDA RD reporter — for rural development properties.
    var isUsda = n.programs.indexOf('usda-rural-development') !== -1 ||
                 /USDA/i.test(n.source);
    if (isUsda) {
      links.push({
        key:   'usda',
        label: 'USDA RD',
        title: 'USDA Rural Development multifamily property search',
        url:   'https://www.rd.usda.gov/programs-services/multifamily-housing-programs/multi-family-housing-rentals',
        icon:  '🌾'
      });
    }

    // 6. Local PHA — for PBV-local records, jump to the PHA website if known.
    var isPbvLocal = n.programs.indexOf('pbv-local') !== -1;
    if (isPbvLocal) {
      // PHA lookup uses HUD's national PHA contact list — works for any CO PHA
      // by zip / county. Better than guessing a per-PHA URL we don't have.
      links.push({
        key:   'pha',
        label: 'PHA',
        title: 'Look up the administering Housing Authority on HUD\'s PHA contact list',
        url:   'https://www.hud.gov/states/colorado/renting/hawebsites',
        icon:  '🏘️'
      });
    }

    // 7. NHPD — National Housing Preservation Database. Searches by zip.
    if (n.zip) {
      links.push({
        key:   'nhpd',
        label: 'NHPD',
        title: 'Search the National Housing Preservation Database for this zip',
        url:   'https://preservationdatabase.org/property-search/?zip=' + _enc(n.zip),
        icon:  '📋'
      });
    } else if (n.city && n.state) {
      links.push({
        key:   'nhpd',
        label: 'NHPD',
        title: 'Search NHPD by city + state',
        url:   'https://preservationdatabase.org/property-search/?city=' + _enc(n.city) + '&state=' + _enc(n.state),
        icon:  '📋'
      });
    }

    return links;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Inject one-time stylesheet for the link bar + credit tooltip.
  // ─────────────────────────────────────────────────────────────────────
  function _ensureStyles() {
    if (document.getElementById('pl-styles')) return;
    var st = document.createElement('style');
    st.id = 'pl-styles';
    st.textContent = [
      '.pl-links { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }',
      '.pl-link {',
      '  display:inline-flex; align-items:center; gap:3px;',
      '  padding:2px 8px; border-radius:10px; font-size:11px;',
      '  background:rgba(99,102,241,.08); color:#4338ca;',
      '  border:1px solid rgba(99,102,241,.2);',
      '  text-decoration:none; cursor:pointer;',
      '  transition: background .12s ease, transform .08s ease;',
      '}',
      '.pl-link:hover { background:rgba(99,102,241,.18); transform: translateY(-1px); text-decoration:none; }',
      '.pl-link:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }',
      '.dark-mode .pl-link { background:rgba(99,102,241,.15); color:#a5b4fc; border-color:rgba(99,102,241,.35); }',
      '.dark-mode .pl-link:hover { background:rgba(99,102,241,.25); }',
      '.pl-links--compact .pl-link { padding:1px 6px; font-size:10px; }',
      '.pl-credit-tag {',
      '  position:relative; display:inline-block; cursor:help;',
      '  border-bottom:1px dotted currentColor;',
      '}',
      // position:fixed escapes overflow:auto ancestors (e.g. the HNA
      // LIHTC info panel) so tooltips are never clipped. JS sets top/left
      // on hover via positionFloatingTooltip().
      '.pl-credit-tag .pl-credit-tt, .hna-cat-badge .hna-cat-tt {',
      '  position:fixed; left:0; top:0;',
      '  background:#111827; color:#f3f4f6;',
      '  padding:8px 10px; border-radius:6px;',
      '  font-size:11px; line-height:1.5;',
      '  width:max-content; max-width:min(320px, calc(100vw - 32px));',
      '  white-space:normal; text-align:left;',
      '  box-shadow:0 4px 12px rgba(0,0,0,.25);',
      '  border:1px solid rgba(255,255,255,.08);',
      '  opacity:0; visibility:hidden;',
      '  transition: opacity .12s ease;',
      '  pointer-events:none; z-index:5000;',
      '}',
      '.pl-credit-tag:hover .pl-credit-tt,',
      '.pl-credit-tag:focus-within .pl-credit-tt,',
      '.hna-cat-badge:hover .hna-cat-tt,',
      '.hna-cat-badge:focus-within .hna-cat-tt { opacity:1; visibility:visible; }',
    ].join('\n');
    document.head.appendChild(st);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public: build a "Look up:" link bar HTML for a property record.
  // ─────────────────────────────────────────────────────────────────────
  function htmlFor(p, opts) {
    opts = opts || {};
    _ensureStyles();
    var n = _normalize(p);
    if (!n) return '';
    var links = _buildLinks(n);
    if (!links.length) return '';
    var compactClass = opts.compact ? ' pl-links--compact' : '';
    var header = opts.hideLabel ? '' :
      '<span style="font-size:11px;opacity:.7;font-weight:600;margin-right:2px;align-self:center">Look up:</span>';
    var pillHtml = links.map(function (lnk) {
      return '<a class="pl-link" href="' + _esc(lnk.url) + '" target="_blank" rel="noopener noreferrer"' +
             ' title="' + _esc(lnk.title) + '">' +
               '<span aria-hidden="true">' + lnk.icon + '</span>' +
               '<span>' + _esc(lnk.label) + '</span>' +
             '</a>';
    }).join('');
    return '<div class="pl-links' + compactClass + '">' + header + pillHtml + '</div>';
  }

  // Public: build a credit-type tag with a hover tooltip explaining the
  // funding stack. Returns plain text if no match.
  function creditTypeTagHtml(creditStr) {
    _ensureStyles();
    var tip = _matchCreditTip(creditStr);
    if (!tip || !creditStr) return _esc(creditStr || '—');
    return '<span class="pl-credit-tag" tabindex="0" title="' + _esc(tip.desc) + '" aria-label="' +
           _esc(tip.label) + ': ' + _esc(tip.desc) + '">' +
             _esc(creditStr) +
             '<span class="pl-credit-tt" role="tooltip">' + _esc(tip.desc) + '</span>' +
           '</span>';
  }

  // ─────────────────────────────────────────────────────────────────────
  // Floating tooltip positioner. Triggers (`.pl-credit-tag`, `.hna-cat-
  // badge`) hold their tooltip child (`.pl-credit-tt`, `.hna-cat-tt`)
  // with position:fixed so it can escape `overflow:auto` ancestors. On
  // hover/focus we compute the trigger's viewport rect and place the
  // tooltip above it (or below if there's no room), and shift it left
  // so it doesn't run off-screen.
  // ─────────────────────────────────────────────────────────────────────
  function _positionFloatingTooltip(trigger) {
    if (!trigger) return;
    var tt = trigger.querySelector('.pl-credit-tt, .hna-cat-tt');
    if (!tt) return;
    // Reveal off-screen first so we can measure its real size, then move.
    tt.style.left = '-9999px';
    tt.style.top  = '-9999px';
    tt.style.visibility = 'hidden';
    tt.style.opacity = '0';
    // Force a layout so measurement is fresh.
    var trRect = trigger.getBoundingClientRect();
    // Temporarily allow it to render so we can read its size.
    tt.style.visibility = 'visible';
    var ttRect = tt.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var margin = 8;
    // Prefer placing tooltip ABOVE the trigger; fall back to below.
    var top = trRect.top - ttRect.height - 6;
    if (top < margin) top = trRect.bottom + 6;
    if (top + ttRect.height > vh - margin) {
      top = Math.max(margin, vh - ttRect.height - margin);
    }
    // Horizontal: align to trigger's right edge, then clamp inside viewport.
    var left = trRect.right - ttRect.width;
    if (left < margin) left = margin;
    if (left + ttRect.width > vw - margin) left = vw - ttRect.width - margin;
    tt.style.left = left + 'px';
    tt.style.top  = top  + 'px';
    tt.style.opacity = '';   // let CSS hover rule control visibility
    tt.style.visibility = '';
  }

  function _bindFloatingTooltipListeners() {
    if (document.__plFloatingBound) return;
    document.__plFloatingBound = true;
    var SELECTOR = '.pl-credit-tag, .hna-cat-badge';
    document.addEventListener('mouseover', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest(SELECTOR);
      if (t) _positionFloatingTooltip(t);
    }, true);
    document.addEventListener('focusin', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest(SELECTOR);
      if (t) _positionFloatingTooltip(t);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _bindFloatingTooltipListeners);
    } else {
      _bindFloatingTooltipListeners();
    }
  }

  global.PropertyLookup = {
    htmlFor: htmlFor,
    creditTypeTip: creditTypeTip,
    creditTypeTagHtml: creditTypeTagHtml,
    CREDIT_TIPS: CREDIT_TIPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
