/**
 * js/components/data-vintage-badge.js
 *
 * Auto-renders a "Data as of …" vintage badge on any element marked with
 *   data-vintage-source="relative/path/to/file.json"
 *   [data-vintage-sla-days="16"]   (optional; default 30)
 *   [data-vintage-label="custom prefix"]  (optional; default "Data as of")
 *
 * Pulls the in-file timestamp field the freshness-check script uses
 * (updated / generated / generatedAt / metadata.generated / meta.generated)
 * so the UI signal and the CI signal agree on what "fresh" means.
 *
 * Switches to a stale-data warning banner appearance when the file's age
 * exceeds the declared SLA — mirrors the condition under which
 * data-freshness-check.yml would open a tracking issue. Complements #663
 * (detector) + #664 (alert issue) with a user-facing signal.
 *
 * Closes a slice of #659.
 *
 * Exposes window.DataVintageBadge for imperative use.
 */
(function () {
  'use strict';

  var DEFAULT_SLA_DAYS = 30;
  var SELECTOR = '[data-vintage-source]';

  // Same field-probe order as scripts/audit/data-freshness-check.mjs
  var TIMESTAMP_FIELDS  = ['updated', 'generated', 'generatedAt', 'last_updated', 'lastUpdated', 'timestamp'];
  var TIMESTAMP_PARENTS = ['metadata', 'meta'];

  function findTimestamp(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < TIMESTAMP_FIELDS.length; i++) {
      var k = TIMESTAMP_FIELDS[i];
      if (typeof obj[k] === 'string' && !isNaN(Date.parse(obj[k]))) {
        return { source: k, value: obj[k] };
      }
    }
    for (var j = 0; j < TIMESTAMP_PARENTS.length; j++) {
      var p = obj[TIMESTAMP_PARENTS[j]];
      if (p && typeof p === 'object') {
        for (var m = 0; m < TIMESTAMP_FIELDS.length; m++) {
          var kk = TIMESTAMP_FIELDS[m];
          if (typeof p[kk] === 'string' && !isNaN(Date.parse(p[kk]))) {
            return { source: TIMESTAMP_PARENTS[j] + '.' + kk, value: p[kk] };
          }
        }
      }
    }
    return null;
  }

  function formatAge(days) {
    if (days < 1)   return 'today';
    if (days < 2)   return 'yesterday';
    if (days < 14)  return Math.floor(days) + ' days ago';
    if (days < 60)  return Math.floor(days / 7) + ' weeks ago';
    return Math.floor(days / 30) + ' months ago';
  }

  function formatIsoDate(iso) {
    // Accept YYYY-MM-DD or full ISO; return just the date portion.
    return String(iso || '').slice(0, 10);
  }

  /**
   * Render the badge into `target`. If `target` already has one, replace it.
   * @param {HTMLElement} target
   * @param {{ updated: string, sla: number, source: string, label: string }} info
   */
  function renderBadge(target, info) {
    var existing = target.querySelector('.data-vintage-badge');
    if (existing) existing.remove();

    var ts = new Date(info.updated);
    var ageDays = (Date.now() - ts.getTime()) / 86_400_000;
    var isStale = info.sla > 0 && ageDays > info.sla;

    var badge = document.createElement('div');
    badge.className = 'data-vintage-badge' + (isStale ? ' data-vintage-badge--stale' : '');
    badge.setAttribute('role', isStale ? 'status' : 'note');
    badge.setAttribute('aria-live', isStale ? 'polite' : 'off');

    var icon = isStale ? '\u26A0' : '\u25CF';  // warning triangle vs filled circle
    var prefix = isStale ? 'Stale data — ' : (info.label || 'Data as of') + ' ';
    var dateText = formatIsoDate(info.updated);
    var ageText  = formatAge(ageDays);

    var iconEl = document.createElement('span');
    iconEl.className = 'data-vintage-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    var textEl = document.createElement('span');
    textEl.className = 'data-vintage-text';
    textEl.appendChild(document.createTextNode(prefix));

    var strongEl = document.createElement('strong');
    strongEl.textContent = dateText;
    textEl.appendChild(strongEl);
    textEl.appendChild(document.createTextNode(' '));

    var ageEl = document.createElement('span');
    ageEl.className = 'data-vintage-age';
    ageEl.textContent = '(' + ageText + ')';
    textEl.appendChild(ageEl);

    var sourceEl = document.createElement('span');
    sourceEl.className = 'data-vintage-source';
    sourceEl.setAttribute('title', 'Source field: ' + info.source);
    sourceEl.textContent = isStale ? ' · refresh cadence exceeded' : '';

    badge.appendChild(iconEl);
    badge.appendChild(textEl);
    badge.appendChild(sourceEl);

    // If the target itself is a flow element (heading, hero, section),
    // append the badge. If it's a chart-card or stat container, prepend so
    // the badge reads above the numbers.
    if (target.classList && (target.classList.contains('chart-card') || target.classList.contains('stat-card'))) {
      target.insertBefore(badge, target.firstChild);
    } else {
      target.appendChild(badge);
    }
  }

  /**
   * Scan the document for [data-vintage-source] and attach a badge to each.
   * Safe to call multiple times; each call replaces the existing badge.
   */
  function scan() {
    var els = document.querySelectorAll(SELECTOR);
    els.forEach(function (el) {
      var src = el.getAttribute('data-vintage-source');
      if (!src) return;
      var sla   = parseInt(el.getAttribute('data-vintage-sla-days'), 10);
      if (!isFinite(sla) || sla <= 0) sla = DEFAULT_SLA_DAYS;
      var label = el.getAttribute('data-vintage-label') || 'Data as of';

      var fetcher = (typeof window.safeFetchJSON === 'function')
        ? window.safeFetchJSON
        : function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };

      fetcher(src).then(function (data) {
        var ts = findTimestamp(data);
        if (!ts) {
          // No in-file timestamp — skip rather than render a misleading badge.
          return;
        }
        renderBadge(el, {
          updated: ts.value,
          source:  ts.source,
          sla:     sla,
          label:   label,
        });
      }).catch(function () {
        // Silent on fetch failure — we don't want a blocked resource to
        // mask a functional page with a scary-looking error badge.
      });
    });
  }

  function init() {
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DataVintageBadge = { scan: scan, renderBadge: renderBadge };
})();
