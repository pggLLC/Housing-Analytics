/**
 * js/components/method-footer.js — F134
 * ======================================
 * Shared "Source · Vintage · Method · Confidence" footer for any
 * analytic card on the site. Closes the most common scrutiny question
 * ("where did this number come from?") inline, without forcing the
 * user into a separate methodology doc.
 *
 * Usage:
 *   container.insertAdjacentHTML('beforeend', MethodFooter.html({
 *     source:    'CHFA LIHTC + HUD MF + USDA RD',
 *     sourceUrl: 'https://co.chfainfo.com/find-a-tax-credit-property',
 *     vintage:   '2026-06',
 *     method:    'Union of 4 sources, deduped by (name, city)',
 *     confidence:'high'        // 'high' | 'med' | 'low' (optional)
 *   }));
 *
 *   // Multi-source variant — for cards drawing from several feeds:
 *   MethodFooter.html({
 *     sources: [
 *       { label: 'ACS 5-yr DP04', url: 'https://data.census.gov/...' },
 *       { label: 'HUD CHAS 2017-21', url: 'https://www.huduser.gov/portal/datasets/cp.html' }
 *     ],
 *     vintage: '2023 (5-yr) + 2017-21 (CHAS)',
 *     method:  'Area-weighted aggregation from tract → place',
 *     confidence: 'med'
 *   });
 *
 * Conventions:
 *   - `confidence` semantics:
 *       high — directly from named source; calculation is verifiable + cited.
 *       med  — derived from named source via documented methodology with
 *              non-trivial assumptions (e.g. area weighting, scaling factors).
 *       low  — heuristic or sample-size sensitive (small-N ACS, single-year
 *              survey, scaled from larger geography without ground truth).
 *   - All fields optional except either `source` or `sources`.
 *   - The footer renders compactly (~30px tall) and is theme-aware.
 */
(function (global) {
  'use strict';
  if (global.MethodFooter) return;

  function _ensureStyles() {
    if (document.getElementById('mf-styles')) return;
    var st = document.createElement('style');
    st.id = 'mf-styles';
    st.textContent = [
      '.mf-footer {',
      '  display:flex; flex-wrap:wrap; align-items:center; gap:.4rem .8rem;',
      '  margin-top:.6rem; padding:.45rem .65rem;',
      '  background: color-mix(in oklab, var(--bg2, #f3f4f6) 70%, transparent);',
      '  border:1px solid var(--border, rgba(0,0,0,.08));',
      '  border-radius:6px;',
      '  font-size:.74rem; line-height:1.4;',
      '  color: var(--muted, #475569);',
      '}',
      '.mf-label { font-weight:700; color: var(--text, inherit); opacity:.75; margin-right:.15rem; }',
      '.mf-value a { color: inherit; text-decoration: underline dotted; text-underline-offset: 2px; }',
      '.mf-value a:hover { text-decoration: underline; }',
      '.mf-badge {',
      '  display:inline-flex; align-items:center; gap:.25rem;',
      '  padding:1px 7px; border-radius:10px;',
      '  font-size:.66rem; font-weight:700; letter-spacing:.03em; text-transform:uppercase;',
      '  cursor:help;',
      '}',
      '.mf-badge--high { background:rgba(16,185,129,.15); color:#047857; border:1px solid rgba(16,185,129,.4); }',
      '.mf-badge--med  { background:rgba(245,158,11,.15); color:#b45309; border:1px solid rgba(245,158,11,.4); }',
      '.mf-badge--low  { background:rgba(239,68,68,.15);  color:#b91c1c; border:1px solid rgba(239,68,68,.4); }',
      '.dark-mode .mf-badge--high { background:rgba(16,185,129,.18); color:#34d399; }',
      '.dark-mode .mf-badge--med  { background:rgba(245,158,11,.18); color:#fbbf24; }',
      '.dark-mode .mf-badge--low  { background:rgba(239,68,68,.18);  color:#fca5a5; }',
      '.mf-method { width:100%; opacity:.85; }',
      '.mf-method strong { font-weight:700; opacity:.75; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _sourceHtml(opts) {
    if (Array.isArray(opts.sources) && opts.sources.length) {
      return opts.sources.map(function (s) {
        return s.url
          ? '<a href="' + _esc(s.url) + '" target="_blank" rel="noopener">' + _esc(s.label) + '</a>'
          : _esc(s.label);
      }).join(' · ');
    }
    if (opts.source) {
      return opts.sourceUrl
        ? '<a href="' + _esc(opts.sourceUrl) + '" target="_blank" rel="noopener">' + _esc(opts.source) + '</a>'
        : _esc(opts.source);
    }
    return '';
  }

  function _confidenceHtml(c) {
    if (!c) return '';
    var sym = String(c).toLowerCase();
    var labels = { high: 'High', med: 'Medium', low: 'Low' };
    var titles = {
      high: 'Directly from named source — calculation is verifiable + cited',
      med:  'Derived from named source via documented methodology with non-trivial assumptions',
      low:  'Heuristic or sample-size sensitive (small-N, scaled from larger geography, etc.)'
    };
    if (!labels[sym]) return '';
    return '<span class="mf-badge mf-badge--' + sym + '" title="' + _esc(titles[sym]) + '">' +
             '<span aria-hidden="true">●</span> ' + _esc(labels[sym]) + ' confidence' +
           '</span>';
  }

  function html(opts) {
    _ensureStyles();
    opts = opts || {};
    var src   = _sourceHtml(opts);
    var conf  = _confidenceHtml(opts.confidence);
    var parts = ['<div class="mf-footer" role="note" aria-label="Methodology + source">'];
    if (src) {
      parts.push(
        '<span><span class="mf-label">Source:</span><span class="mf-value">' + src + '</span></span>'
      );
    }
    if (opts.vintage) {
      parts.push(
        '<span><span class="mf-label">Vintage:</span><span class="mf-value">' + _esc(opts.vintage) + '</span></span>'
      );
    }
    if (conf) parts.push(conf);
    if (opts.method) {
      parts.push(
        '<span class="mf-method"><strong>Method:</strong> ' + _esc(opts.method) + '</span>'
      );
    }
    parts.push('</div>');
    return parts.join('');
  }

  // Convenience: attach the footer to a parent node directly.
  function attach(parent, opts) {
    if (!parent) return;
    parent.insertAdjacentHTML('beforeend', html(opts));
  }

  global.MethodFooter = { html: html, attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
