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
      '.jbrief__cite:hover { background:rgba(99,102,241,.32); }',
      '.jbrief__pending {',
      '  display:inline-block; vertical-align:super; font-size:.62rem;',
      '  font-weight:700; padding:0 5px; margin-left:3px; border-radius:8px;',
      '  background:rgba(217,119,6,.18); color:#9a3412; cursor:help;',
      '}',
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
      '.jbrief__kind--primary   { background:rgba(5,150,105,.18); color:#047857; }',
      '.jbrief__kind--secondary { background:rgba(37,99,235,.16);  color:#1d4ed8; }',
      '.jbrief__kind--press     { background:rgba(217,119,6,.16);  color:#92400e; }',
      '.jbrief__kind--search    { background:rgba(99,102,241,.15); color:#4338ca; }',
      // Dark-mode overrides — site uses OS preference (prefers-color-scheme:
      // dark) for the base theme AND an html.dark-mode class for the manual
      // toggle. Cover both so cite badges + kind chips have adequate contrast
      // on near-black backgrounds (#08121e) instead of dark-on-dark blue text.
      '@media (prefers-color-scheme: dark) {',
      '  .jbrief__cite          { background:rgba(165,180,252,.22); color:#e0e7ff; }',
      '  .jbrief__cite:hover    { background:rgba(165,180,252,.34); }',
      '  .jbrief__pending       { background:rgba(251,191,36,.22);  color:#fde68a; }',
      '  .jbrief__kind          { background:rgba(203,213,225,.16); color:rgba(226,232,240,.92); }',
      '  .jbrief__kind--primary { background:rgba(52,211,153,.22);  color:#6ee7b7; }',
      '  .jbrief__kind--secondary { background:rgba(96,165,250,.22); color:#bfdbfe; }',
      '  .jbrief__kind--press   { background:rgba(251,191,36,.22);  color:#fde68a; }',
      '  .jbrief__kind--search  { background:rgba(165,180,252,.22); color:#c7d2fe; }',
      '}',
      'html.dark-mode .jbrief__cite          { background:rgba(165,180,252,.22); color:#e0e7ff; }',
      'html.dark-mode .jbrief__cite:hover    { background:rgba(165,180,252,.34); }',
      'html.dark-mode .jbrief__pending       { background:rgba(251,191,36,.22);  color:#fde68a; }',
      'html.dark-mode .jbrief__kind          { background:rgba(203,213,225,.16); color:rgba(226,232,240,.92); }',
      'html.dark-mode .jbrief__kind--primary { background:rgba(52,211,153,.22);  color:#6ee7b7; }',
      'html.dark-mode .jbrief__kind--secondary { background:rgba(96,165,250,.22); color:#bfdbfe; }',
      'html.dark-mode .jbrief__kind--press   { background:rgba(251,191,36,.22);  color:#fde68a; }',
      'html.dark-mode .jbrief__kind--search  { background:rgba(165,180,252,.22); color:#c7d2fe; }',
      '.jbrief__meta { font-size:.7rem; color:var(--faint,#888); margin-top:.6rem; }',
      '.jbrief__missing {',
      '  border:1px dashed var(--border,#ccc); border-radius:6px;',
      '  padding:.85rem 1rem; background:color-mix(in oklab, var(--bg2,#f3f4f6) 35%, transparent);',
      '  font-size:.86rem; color:var(--muted); line-height:1.55;',
      '}',
      '.jbrief__missing-title { font-weight:700; color:var(--text); margin:0 0 .35rem; font-size:.95rem; }',
      '.jbrief__missing-cli {',
      '  display:block; margin:.55rem 0 .65rem; padding:.5rem .65rem;',
      '  background:var(--bg2,#0f172a); color:var(--text,#e2e8f0);',
      '  border-radius:4px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      '  font-size:.78rem; user-select:all; white-space:pre-wrap; word-break:break-all;',
      '}',
      '.dark-mode .jbrief__missing-cli { background:#0b1220; }',
      '.jbrief__missing-actions { display:flex; flex-wrap:wrap; gap:.45rem; margin-top:.4rem; }',
      '.jbrief__missing-btn {',
      '  appearance:none; border:1px solid var(--border,#cbd5e1);',
      '  background:var(--card,#ffffff); color:var(--text);',
      '  padding:.4rem .75rem; border-radius:6px; font-size:.78rem; font-weight:600;',
      '  cursor:pointer; text-decoration:none; display:inline-block;',
      '}',
      '.jbrief__missing-btn:hover { background:var(--accent-dim, rgba(99,102,241,.08)); }',
      '.jbrief__missing-btn--primary {',
      '  background:var(--accent,#096e65); border-color:var(--accent,#096e65); color:#fff;',
      '}',
      '.jbrief__missing-btn--primary:hover { filter:brightness(1.08); }',
      '.jbrief__missing-feedback { display:inline-block; font-size:.74rem; color:var(--muted); margin-left:.5rem; }',
      // Header strip: last-verified date + freshness chip + Update button.
      '.jbrief__header {',
      '  display:flex; align-items:center; justify-content:space-between;',
      '  gap:.75rem; flex-wrap:wrap; margin:0 0 .85rem;',
      '  padding:.5rem .65rem; border-radius:6px;',
      '  background:color-mix(in oklab, var(--bg2,#f3f4f6) 45%, transparent);',
      '  border:1px solid var(--border,#e2e8f0);',
      '}',
      '.jbrief__header-left { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }',
      '.jbrief__freshness {',
      '  display:inline-flex; align-items:center; gap:.4rem;',
      '  font-size:.78rem; color:var(--text);',
      '}',
      '.jbrief__freshness strong { font-weight:700; color:var(--text); }',
      '.jbrief__freshness-age { color:var(--muted); font-size:.74rem; }',
      '.jbrief__freshness-dot {',
      '  display:inline-block; width:8px; height:8px; border-radius:50%;',
      '  background:var(--muted,#94a3b8);',
      '}',
      '.jbrief__freshness--fresh  .jbrief__freshness-dot { background:#16a34a; box-shadow:0 0 0 2px rgba(22,163,74,.18); }',
      '.jbrief__freshness--aging  .jbrief__freshness-dot { background:#d97706; box-shadow:0 0 0 2px rgba(217,119,6,.18); }',
      '.jbrief__freshness--stale  .jbrief__freshness-dot { background:#dc2626; box-shadow:0 0 0 2px rgba(220,38,38,.18); }',
      '.jbrief__freshness--stale strong { color:#b91c1c; }',
      '.dark-mode .jbrief__freshness--stale strong { color:#fca5a5; }',
      '.jbrief__update-btn {',
      '  display:inline-flex; align-items:center; gap:.3rem;',
      '  padding:.35rem .7rem; border-radius:6px;',
      '  border:1px solid var(--border,#cbd5e1); background:var(--card,#fff);',
      '  color:var(--text); font-size:.78rem; font-weight:600;',
      '  text-decoration:none; cursor:pointer; white-space:nowrap;',
      '}',
      '.jbrief__update-btn:hover {',
      '  background:var(--accent-dim, rgba(99,102,241,.08));',
      '  border-color:var(--accent,#096e65);',
      '}'
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

    // Header strip: "Last verified" date + "↻ Update brief" button. The
    // update button mirrors the missing-brief affordance — opens a
    // prefilled GitHub issue asking the curator to re-research the brief.
    // The curator never overwrites a verified brief with an auto-stub; the
    // refresh goes through human research + PR.
    var lastCurated = brief.last_curated || '';
    var curator = brief.curator || '';
    var ageDays = null;
    try {
      if (lastCurated) {
        var ts = Date.parse(lastCurated);
        if (!isNaN(ts)) ageDays = Math.floor((Date.now() - ts) / 86400000);
      }
    } catch (_) {}
    var freshnessClass = '';
    if (ageDays !== null) {
      if (ageDays > 90)      freshnessClass = ' jbrief__freshness--stale';
      else if (ageDays > 30) freshnessClass = ' jbrief__freshness--aging';
      else                   freshnessClass = ' jbrief__freshness--fresh';
    }
    var ageLabel = ageDays === null ? 'unknown'
                 : ageDays === 0 ? 'today'
                 : ageDays === 1 ? '1 day ago'
                 : ageDays + ' days ago';
    var updateIssueTitle = 'briefs: refresh ' + (brief.jurisdiction || ('GEOID ' + brief.geoid)) +
                           ' (' + (brief.geoid || '?') + ')';
    var updateIssueBody = encodeURIComponent(
      'The published brief for ' + (brief.jurisdiction || ('GEOID ' + brief.geoid)) +
      ' (GEOID ' + (brief.geoid || '?') + ') was last verified on ' + lastCurated +
      (ageDays !== null ? ' (' + ageLabel + ').' : '.') + '\n\n' +
      'Please re-research and confirm or update each claim against current primary / ' +
      'secondary / press sources. Common things to check on a refresh:\n\n' +
      '- New CHFA Housing Tax Credit award rounds (most recent R1 + R2)\n' +
      '- Ballot measures / referenda passed since the last refresh\n' +
      '- New council resolutions, ordinances, or housing-strategic-plan updates\n' +
      '- Changes to coalition memberships or PHA contracts\n\n' +
      'When done, bump `last_curated` to today and land in a PR.'
    );
    var updateHref = 'https://github.com/pggLLC/Housing-Analytics/issues/new' +
      '?title=' + encodeURIComponent(updateIssueTitle) +
      '&body=' + updateIssueBody +
      '&labels=' + encodeURIComponent('briefs,refresh');
    var headerHtml =
      '<div class="jbrief__header">' +
        '<div class="jbrief__header-left">' +
          '<span class="jbrief__freshness' + freshnessClass + '">' +
            '<span class="jbrief__freshness-dot" aria-hidden="true"></span>' +
            'Last verified <strong>' + _esc(lastCurated || 'unknown') + '</strong>' +
            (curator ? ' by ' + _esc(curator) : '') +
            (ageDays !== null ? ' <span class="jbrief__freshness-age">(' + _esc(ageLabel) + ')</span>' : '') +
          '</span>' +
        '</div>' +
        '<a class="jbrief__update-btn" href="' + _esc(updateHref) + '" target="_blank" rel="noopener noreferrer" ' +
            'title="Open a GitHub issue requesting a research refresh">' +
          '↻ Update brief' +
        '</a>' +
      '</div>';

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
          var kindCls = s.kind === 'primary'   ? 'jbrief__kind--primary'
                      : s.kind === 'secondary' ? 'jbrief__kind--secondary'
                      : s.kind === 'press'     ? 'jbrief__kind--press'
                      : s.kind === 'search'    ? 'jbrief__kind--search'
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

    // Footer meta — date is now in the header strip; this stays for the
    // scope + QA badge so the user knows what kind of brief they're seeing.
    var metaHtml = '<p class="jbrief__meta">scope: ' + _esc(brief.scope) +
                   ' · single-jurisdiction QA' +
                   '</p>';

    return '<div class="jbrief">' + headerHtml + summaryHtml + sectionsHtml + sourcesHtml + metaHtml + '</div>';
  }

  // Auth note: the brief renderer itself has NO auth gate. The component
  // is only loaded on indibuild-brief.html, which is protected by
  // js/indibuild-gate.js (the salida2026 password). The `published === true`
  // check below stays — unpublished skeletons never reach the user UI even
  // for authenticated visitors.

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Build the "no brief yet — draft one" affordance. Shown when there's no
  // published brief on file for either the place GEOID or the containing
  // county. Surfaces the CLI command for the curator drafter and a
  // GitHub-issue link that prefills jurisdiction + GEOID.
  function _renderMissingAffordance(opts) {
    var geoid = opts.placeGeoid || opts.countyFips || '';
    var label = opts.jurisdictionLabel || ('GEOID ' + (geoid || 'unknown'));
    var cli = 'python3 scripts/draft-jurisdiction-brief.py --geoid ' + geoid;
    var issueTitle = 'briefs: draft ' + label + ' (' + geoid + ')';
    var issueBody = encodeURIComponent(
      'No curated jurisdictional housing-history brief on file for ' +
      label + ' (GEOID ' + geoid + ').\n\n' +
      'Run the drafter to scaffold a `published: false` skeleton, then ' +
      'replace the kind:search sources with verified primary / secondary / ' +
      'press deep links:\n\n```\n' + cli + '\n```'
    );
    var repoBase = (opts.issueRepo || 'pggLLC/Housing-Analytics');
    var issueHref = 'https://github.com/' + repoBase + '/issues/new' +
      '?title=' + encodeURIComponent(issueTitle) +
      '&body=' + issueBody +
      '&labels=' + encodeURIComponent('briefs,curation');
    return (
      '<div class="jbrief__missing" role="status">' +
        '<p class="jbrief__missing-title">No curated brief yet for ' + _esc(label) + '</p>' +
        '<p style="margin:.1rem 0 .25rem">' +
          'Draft a starter skeleton (counties + places ≥ 2,000 pop are in scope; ' +
          'CDPs are out of scope per the curation rules).' +
        '</p>' +
        '<code class="jbrief__missing-cli" id="jbrief-missing-cli" data-cli="' + _esc(cli) + '">' +
          _esc(cli) +
        '</code>' +
        '<div class="jbrief__missing-actions">' +
          '<button type="button" class="jbrief__missing-btn jbrief__missing-btn--primary" data-action="copy-cli">' +
            'Copy command' +
          '</button>' +
          '<a class="jbrief__missing-btn" href="' + _esc(issueHref) + '" target="_blank" rel="noopener noreferrer">' +
            'Open GitHub issue ↗' +
          '</a>' +
          '<span class="jbrief__missing-feedback" id="jbrief-missing-feedback" hidden></span>' +
        '</div>' +
        '<p style="font-size:.74rem;color:var(--muted);margin:.55rem 0 0">' +
          'The drafter writes <code>data/jurisdiction-briefs/' + _esc(geoid) +
          '.json</code> as a <code>published: false</code> skeleton. Verify each claim against a ' +
          'primary / secondary / press source, replace the kind:search URLs, and flip <code>published: true</code> ' +
          'to publish.' +
        '</p>' +
      '</div>'
    );
  }

  // Wire the "Copy command" button in a freshly-rendered missing affordance.
  function _wireMissingActions(container) {
    var copyBtn = container.querySelector('[data-action="copy-cli"]');
    var cliEl   = container.querySelector('#jbrief-missing-cli');
    var fb      = container.querySelector('#jbrief-missing-feedback');
    if (!copyBtn || !cliEl) return;
    copyBtn.addEventListener('click', function () {
      var text = cliEl.getAttribute('data-cli') || cliEl.textContent;
      function _flash(msg) {
        if (!fb) return;
        fb.textContent = msg;
        fb.hidden = false;
        setTimeout(function () { fb.hidden = true; }, 2400);
      }
      try {
        if (global.navigator && global.navigator.clipboard) {
          global.navigator.clipboard.writeText(text).then(
            function () { _flash('Copied — paste into your terminal'); },
            function () { _flash('Copy blocked — select the command manually'); }
          );
          return;
        }
      } catch (_) {}
      // Fallback: select the text in the <code> so the user can ⌘C
      try {
        var range = document.createRange();
        range.selectNodeContents(cliEl);
        var sel = global.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        _flash('Selected — press ⌘/Ctrl+C to copy');
      } catch (e) { _flash('Select the command above to copy'); }
    });
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML =
      '<p style="color:var(--muted);font-size:.85rem">Loading jurisdictional brief…</p>';

    _loadBrief(opts.placeGeoid, opts.countyFips).then(function (brief) {
      // Treat unpublished and missing the same way from a UI perspective.
      // `allowDraft: true` is an opt-in for internal QA workflows that want
      // to preview unverified drafts.
      var hasBrief = brief && (brief.published === true || opts.allowDraft);
      if (!hasBrief) {
        // Two paths when no brief is on file:
        //  - showFallback=true: render an in-place "draft one" affordance.
        //    Default for indibuild-brief.html so the curator can act.
        //  - showFallback=false: clear the container and call onMissing()
        //    so the caller can hide the wrapping card. Older callers that
        //    want the previous hide-the-card behavior keep getting it.
        if (opts.showFallback) {
          container.innerHTML = _renderMissingAffordance(opts);
          _wireMissingActions(container);
        } else {
          container.innerHTML = '';
          if (typeof opts.onMissing === 'function') opts.onMissing();
        }
        return;
      }
      container.innerHTML = _renderBrief(brief);
    });
  }

  global.JurisdictionBrief = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
