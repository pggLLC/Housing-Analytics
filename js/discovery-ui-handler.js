// js/discovery-ui-handler.js
// Wires discovery and freshness data into the data-review-hub.html UI.
// Requires: data-source-discovery.js, data-source-updater.js,
//           data-freshness-monitor.js, data-source-inventory.js
// Exposed as window.DiscoveryUIHandler.

(function () {
  'use strict';

  // ── Utility ──────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function announce(msg) {
    var el = document.getElementById('drhLiveRegion');
    if (!el) return;
    el.setAttribute('aria-live', 'off');
    el.textContent = msg;
    requestAnimationFrame(function () {
      el.setAttribute('aria-live', 'polite');
    });
  }

  // ── Monitoring status badge ───────────────────────────────────────────────

  /**
   * Render the monitoring status badge in #drhMonitorBadge.
   * @param {object|null} report — result from DataSourceDiscovery.getLastReport()
   * @param {number}       pendingCount
   */
  function renderMonitorBadge(report, pendingCount) {
    var el = document.getElementById('drhMonitorBadge');
    if (!el) return;

    var scanTs   = report ? report.scanTimestamp : null;
    var scanDate = scanTs
      ? new Date(scanTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Never';

    el.innerHTML =
      '<span class="drh-badge-item" title="Last scan">' +
        '<span class="drh-badge-icon">🔍</span> ' +
        'Last scan: <strong>' + _esc(scanDate) + '</strong>' +
      '</span>' +
      '<span class="drh-badge-sep">·</span>' +
      '<span class="drh-badge-item" title="Scan frequency">' +
        '<span class="drh-badge-icon">⏱</span> Daily' +
      '</span>' +
      '<span class="drh-badge-sep">·</span>' +
      '<span class="drh-badge-item drh-badge-pending" title="Pending review items">' +
        '<span class="drh-badge-icon">🔔</span> ' +
        'Pending: <strong>' + pendingCount + '</strong>' +
      '</span>' +
      '<span class="drh-badge-sep">·</span>' +
      '<a class="drh-badge-link" href="#tab-discovery" onclick="window.DiscoveryUIHandler.switchToDiscovery()">View discoveries →</a>';
  }

  // ── Pending discovery tab ─────────────────────────────────────────────────

  /**
   * Render the "Pending Discovery" tab content from a discovery report.
   * @param {object} report
   */
  function renderPendingTab(report) {
    var container = document.getElementById('drhPendingList');
    if (!container) return;

    var newSources = (report && report.newSources) || [];
    if (!newSources.length) {
      container.innerHTML =
        '<div class="drh-empty">' +
          '<span style="font-size:2rem">✅</span>' +
          '<p>No unregistered data sources detected. All discovered files are in the manifest.</p>' +
        '</div>';
      announce('No pending discoveries found.');
      return;
    }

    container.innerHTML = '';
    for (var i = 0; i < newSources.length; i++) {
      container.appendChild(buildPendingCard(newSources[i], i));
    }
    announce(newSources.length + ' pending discoveries found.');
  }

  function buildPendingCard(src, idx) {
    var card = document.createElement('div');
    card.className = 'drh-pending-card';
    card.dataset.path = src.path;

    var whereUsedList = window.DataSourceUpdater
      ? window.DataSourceUpdater.whereUsed(src.path)
      : [];

    card.innerHTML =
      '<div class="drh-pending-header">' +
        '<span class="drh-pending-path">' + _esc(src.path) + '</span>' +
        '<span class="drh-badge drh-badge--warn">Pending Review</span>' +
      '</div>' +
      '<div class="drh-pending-meta">' +
        '<div class="drh-meta-field">' +
          '<label>Suggested Name</label>' +
          '<input type="text" class="drh-input" id="pend-name-' + idx + '" value="' + _esc(src.suggestedName) + '" />' +
        '</div>' +
        '<div class="drh-meta-field">' +
          '<label>Description</label>' +
          '<input type="text" class="drh-input" id="pend-desc-' + idx + '" value="' + _esc(src.suggestedDesc) + '" />' +
        '</div>' +
        '<div class="drh-meta-field">' +
          '<label>Est. Frequency</label>' +
          '<select class="drh-input" id="pend-freq-' + idx + '">' +
            buildFreqOptions(src.suggestedFreq) +
          '</select>' +
        '</div>' +
        (src.hash ? '<div class="drh-meta-field drh-meta-hash"><label>File Hash</label><code>' + _esc(src.hash) + '</code></div>' : '') +
        (whereUsedList.length
          ? '<div class="drh-meta-field"><label>Detected Usage</label><ul class="drh-usage-list">' +
              whereUsedList.map(function (u) { return '<li>' + _esc(u) + '</li>'; }).join('') +
            '</ul></div>'
          : '') +
      '</div>' +
      '<div class="drh-pending-actions">' +
        '<button class="drh-btn drh-btn--primary drh-approve-btn" data-path="' + _esc(src.path) + '" type="button">' +
          '✅ Approve &amp; Download Patch' +
        '</button>' +
        '<button class="drh-btn drh-dismiss-btn" data-path="' + _esc(src.path) + '" type="button">' +
          'Dismiss' +
        '</button>' +
      '</div>';

    // Wire approve button
    var approveBtn = card.querySelector('.drh-approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', function () {
        handleApprove(src, card);
      });
    }

    // Wire dismiss button
    var dismissBtn = card.querySelector('.drh-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        card.style.opacity = '0';
        card.style.transition = 'opacity .3s';
        setTimeout(function () { card.remove(); }, 300);
        announce('Dismissed: ' + src.path);
      });
    }

    return card;
  }

  function buildFreqOptions(selected) {
    var opts = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual', 'Unknown'];
    return opts.map(function (o) {
      return '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
  }

  function handleApprove(src, card) {
    if (!window.DataSourceUpdater) {
      announce('DataSourceUpdater not loaded.');
      return;
    }
    var entry = window.DataSourceUpdater.buildEntry(src, {
      _approved:  true,
      approved_by: 'hub-admin',
      approved_ts: new Date().toISOString()
    });

    window.DataSourceUpdater.generatePatch([entry]).then(function (patched) {
      window.DataSourceUpdater.downloadPatch(patched);
      card.querySelector('.drh-approve-btn').disabled = true;
      card.querySelector('.drh-approve-btn').textContent = '✅ Approved — Patch Downloaded';
      announce('Approved and patch downloaded for: ' + src.path);
    });
  }

  // ── Admin panel ─────────────────────────────────────────────────────────

  /**
   * Wire the manual scan trigger button.
   */
  function wireAdminPanel() {
    var triggerBtn = document.getElementById('drhTriggerScan');
    if (!triggerBtn || !window.DataSourceDiscovery) return;

    triggerBtn.addEventListener('click', function () {
      triggerBtn.disabled = true;
      triggerBtn.textContent = '🔍 Scanning…';
      announce('Discovery scan started…');

      window.DataSourceDiscovery.runDiscovery().then(function (report) {
        renderPendingTab(report);
        renderMonitorBadge(report, (report.newSources || []).length);
        triggerBtn.disabled = false;
        triggerBtn.textContent = '🔍 Run Scan Now';
        announce('Scan complete: ' + (report.newSources || []).length + ' new sources found.');
      }).catch(function (err) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = '🔍 Run Scan Now';
        announce('Scan failed: ' + err.message);
      });
    });
  }

  // ── Tab switcher helper ──────────────────────────────────────────────────

  function switchToDiscovery() {
    var tab = document.querySelector('[data-tab="discovery"]');
    if (tab) tab.click();
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    var cached = window.DataSourceDiscovery
      ? window.DataSourceDiscovery.getLastReport()
      : null;

    var pendingCount = cached ? (cached.newSources || []).length : 0;
    renderMonitorBadge(cached, pendingCount);

    if (cached) {
      renderPendingTab(cached);
    }

    wireAdminPanel();

    // Update pending badge count in tab label
    var tabLabel = document.getElementById('drhPendingCount');
    if (tabLabel) tabLabel.textContent = pendingCount ? ' (' + pendingCount + ')' : '';
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.DiscoveryUIHandler = {
    init:               init,
    renderPendingTab:   renderPendingTab,
    renderMonitorBadge: renderMonitorBadge,
    switchToDiscovery:  switchToDiscovery
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
