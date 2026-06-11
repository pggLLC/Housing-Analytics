/**
 * js/components/jurisdiction-brief.js
 *
 * Renders a curated jurisdictional housing-history brief from
 * data/jurisdiction-briefs/<geoid>.json. Falls back to the containing
 * county's brief when no place-level brief exists. When no brief is on
 * file at all, the mount stays hidden (caller can hide its parent card).
 *
 * Usage:
 *   JurisdictionBrief.attach(container, {
 *     placeGeoid: '0812045',         // optional 7-digit
 *     countyFips: '08097',           // optional 5-digit (fallback)
 *     onMissing: () => mount.hide()  // optional: called when no brief found
 *   });
 *
 * Curation/QA rules (see data/jurisdiction-briefs/README.md):
 *   - Single-jurisdiction scope per brief
 *   - Every paragraph either carries `cites` or `needs_source: true`
 *   - Sources start with `s` ids and resolve to durable URLs
 *   - Coalition / regional sections (id startsWith 'coalition-' or
 *     'regional-') get a visual distinction so users understand the
 *     scope shift.
 */
(function (global) {
  'use strict';
  if (global.JurisdictionBrief) return;

  var BASE_PATH = 'data/jurisdiction-briefs/';

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _ensureStyles() {
    if (document.getElementById('jbrief-styles')) return;
    var st = document.createElement('style');
    st.id = 'jbrief-styles';
    st.textContent = [
      '.jbrief { font-size:.86rem; line-height:1.55; color:var(--text); }',
      '.jbrief__summary {',
      '  margin:.2rem 0 .9rem; padding:.55rem .7rem;',
      '  border-left:3px solid var(--accent,#096e65);',
      '  background: color-mix(in oklab, var(--bg2,#f3f4f6) 60%, transparent);',
      '  border-radius:0 5px 5px 0; font-style:italic; color:var(--muted);',
      '}',
      '.jbrief__section { margin: .8rem 0; }',
      '.jbrief__section--regional {',
      '  padding:.5rem .7rem; border:1px dashed var(--border,#ccc);',
      '  border-radius:6px; background: color-mix(in oklab, var(--bg2,#f3f4f6) 40%, transparent);',
      '}',
      '.jbrief__section--regional .jbrief__heading::before {',
      '  content:"⌬ "; color:var(--accent,#096e65); font-weight:700;',
      '}',
      '.jbrief__heading { font-size:.92rem; margin:0 0 .4rem; color:var(--text); font-weight:700; }',
      '.jbrief__para { margin:.35rem 0; }',
      '.jbrief__cite { ',
      '  display:inline-block; vertical-align:super; font-size:.66rem;',
      '  font-weight:700; padding:0 4px; margin-left:2px; border-radius:8px;',
      '  background:rgba(99,102,241,.15); color:#3730a3; text-decoration:none;',
      '}',
      '.dark-mode .jbrief__cite { background:rgba(99,102,241,.22); color:#c7d2fe; }',
      '.jbrief__cite:hover { background:rgba(99,102,241,.32); }',
      '.jbrief__pending {',
      '  display:inline-block; vertical-align:super; font-size:.62rem;',
      '  font-weight:700; padding:0 5px; margin-left:3px; border-radius:8px;',
      '  background:rgba(217,119,6,.18); color:#9a3412; cursor:help;',
      '}',
      '.dark-mode .jbrief__pending { background:rgba(217,119,6,.25); color:#fed7aa; }',
      '.jbrief__sources { margin:1rem 0 .25rem; padding-top:.6rem; border-top:1px solid var(--border,#ddd); }',
      '.jbrief__sources-title { font-size:.74rem; font-weight:700; color:var(--muted); margin:0 0 .3rem; text-transform:uppercase; letter-spacing:.04em; }',
      '.jbrief__sources-list { list-style:none; padding:0; margin:0; font-size:.74rem; color:var(--muted); }',
      '.jbrief__sources-list li { margin:.2rem 0; }',
      '.jbrief__sources-list a { color:var(--accent,#096e65); text-decoration:underline dotted; }',
      '.jbrief__kind {',
      '  display:inline-block; font-size:.6rem; font-weight:700; padding:1px 5px;',
      '  border-radius:8px; margin-left:.3rem; vertical-align:middle;',
      '  background:rgba(120,120,120,.15); color:var(--muted);',
      '}',
      '.jbrief__kind--primary { background:rgba(5,150,105,.18); color:#047857; }',
      '.jbrief__kind--search { background:rgba(99,102,241,.15); color:#4338ca; }',
      '.jbrief__meta { font-size:.7rem; color:var(--faint,#888); margin-top:.6rem; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _fetchJson(path) {
    var fetcher = (global.fetchWithBase) ? global.fetchWithBase : fetch.bind(global);
    return fetcher(path).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }

  /**
   * Load the brief for the placeGeoid, falling back to countyFips when
   * the place has no brief on file. Returns the brief object or null.
   */
  function _loadBrief(placeGeoid, countyFips) {
    var attempts = [];
    if (placeGeoid) attempts.push(placeGeoid);
    if (countyFips) attempts.push(countyFips);
    if (!attempts.length) return Promise.resolve(null);
    var chain = Promise.resolve(null);
    attempts.forEach(function (key) {
      chain = chain.then(function (prev) {
        if (prev) return prev;
        return _fetchJson(BASE_PATH + key + '.json');
      });
    });
    return chain;
  }

  function _renderBrief(brief) {
    var sourceById = {};
    (brief.sources || []).forEach(function (s, i) {
      sourceById[s.id] = Object.assign({}, s, { index: i + 1 });
    });

    function _renderCites(cites) {
      if (!cites || !cites.length) return '';
      return cites.map(function (id) {
        var s = sourceById[id];
        if (!s) return '';
        return '<a class="jbrief__cite" href="#jbrief-src-' + _esc(id) +
               '" title="' + _esc(s.label) + '">[' + s.index + ']</a>';
      }).join('');
    }

    function _renderPending() {
      return '<span class="jbrief__pending" ' +
             'title="Source pending — claim is flagged for QA verification">' +
             'src?</span>';
    }

    function _renderSection(sec) {
      var isRegional = /^(coalition-|regional-)/.test(sec.id || '');
      var paras = (sec.paragraphs || []).map(function (p) {
        var citesHtml = _renderCites(p.cites);
        var pendingHtml = (!p.cites || !p.cites.length || p.needs_source) ? _renderPending() : '';
        return '<p class="jbrief__para">' + _esc(p.text) + citesHtml + pendingHtml + '</p>';
      }).join('');
      return '<section class="jbrief__section' +
             (isRegional ? ' jbrief__section--regional' : '') + '">' +
               '<h4 class="jbrief__heading">' + _esc(sec.heading) + '</h4>' +
               paras +
             '</section>';
    }

    var summaryHtml = brief.summary
      ? '<div class="jbrief__summary">' + _esc(brief.summary) + '</div>'
      : '';

    var sectionsHtml = (brief.sections || []).map(_renderSection).join('');

    var sourcesHtml = '';
    if (brief.sources && brief.sources.length) {
      sourcesHtml = '<div class="jbrief__sources">' +
        '<p class="jbrief__sources-title">Sources</p>' +
        '<ol class="jbrief__sources-list">' +
        brief.sources.map(function (s, i) {
          var kindCls = s.kind === 'primary' ? 'jbrief__kind--primary'
                      : s.kind === 'search'  ? 'jbrief__kind--search'
                      : '';
          return '<li id="jbrief-src-' + _esc(s.id) + '">' +
                   '<strong>[' + (i + 1) + ']</strong> ' +
                   '<a href="' + _esc(s.url) + '" target="_blank" rel="noopener">' +
                     _esc(s.label) + '</a>' +
                   '<span class="jbrief__kind ' + kindCls + '">' +
                     _esc(s.kind || '') + '</span>' +
                 '</li>';
        }).join('') +
        '</ol></div>';
    }

    var metaHtml = '<p class="jbrief__meta">Curated ' + _esc(brief.last_curated) +
                   ' by ' + _esc(brief.curator) +
                   ' · scope: ' + _esc(brief.scope) +
                   ' · single-jurisdiction QA' +
                   '</p>';

    return '<div class="jbrief">' + summaryHtml + sectionsHtml + sourcesHtml + metaHtml + '</div>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML =
      '<p style="color:var(--muted);font-size:.85rem">Loading jurisdictional brief…</p>';

    _loadBrief(opts.placeGeoid, opts.countyFips).then(function (brief) {
      if (!brief) {
        container.innerHTML = '';
        if (typeof opts.onMissing === 'function') opts.onMissing();
        return;
      }
      container.innerHTML = _renderBrief(brief);
    });
  }

  global.JurisdictionBrief = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
