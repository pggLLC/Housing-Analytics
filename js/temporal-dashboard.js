// js/temporal-dashboard.js
// Temporal status visualizations for the Data Sources Dashboard.
// Depends on: js/data-source-inventory.js

(function () {
  'use strict';

  var MS_PER_DAY = 86400000;

  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function daysUntil(dateStr, maxAgeDays) {
    if (!dateStr || !maxAgeDays) return null;
    var updated = new Date(dateStr).getTime();
    if (isNaN(updated)) return null;
    var nextDue = updated + maxAgeDays * MS_PER_DAY;
    return Math.ceil((nextDue - Date.now()) / MS_PER_DAY);
  }

  function statusClass(status) {
    var map = { current: 'status-current', aging: 'status-aging', stale: 'status-stale' };
    return map[status] || '';
  }

  function badgeHtml(status) {
    var labels = { current: '✅ CURRENT', aging: '⚠️ AGING', stale: '🔴 STALE', unknown: '❓ UNKNOWN' };
    return '<span class="dd-badge dd-badge--' + esc(status) + '">' + (labels[status] || '?') + '</span>';
  }

  function gaugeHtml(score, status) {
    if (score === null || score === undefined) return '<span class="dd-gauge-pct" style="color:var(--text-secondary,#888)">—</span>';
    var cls = score >= 70 ? 'fresh' : score >= 40 ? 'aging' : 'stale';
    return '<div class="dd-gauge-wrap" title="' + score + '% fresh">' +
      '<div class="dd-gauge-bar"><div class="dd-gauge-fill ' + cls + '" style="width:' + score + '%"></div></div>' +
      '<span class="dd-gauge-pct">' + score + '%</span>' +
      '</div>';
  }

  // ── Timeline Cards ──────────────────────────────────────────────
  function renderTimeline(containerEl, sources) {
    if (!containerEl) return;
    var sorted = sources.slice().sort(function (a, b) {
      var da = a.daysSinceUpdate, db = b.daysSinceUpdate;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da; // most stale first
    });
    var html = '<div class="dd-timeline" role="list">';
    sorted.forEach(function (s) {
      var until = daysUntil(s.lastUpdated, s.maxAgeDays);
      var countdownText = '';
      if (until !== null) {
        if (until < 0) {
          countdownText = '<div class="dd-countdown" style="color:#c62828">⏰ ' + Math.abs(until) + ' days overdue</div>';
        } else if (until <= 7) {
          countdownText = '<div class="dd-countdown" style="color:#f57c00">⏳ Due in ' + until + ' day' + (until === 1 ? '' : 's') + '</div>';
        } else if (until <= 30) {
          countdownText = '<div class="dd-countdown">📅 Due in ' + until + ' days</div>';
        }
      }
      html += '<div class="dd-timeline-card ' + statusClass(s.status) + '" role="listitem">' +
        '<div class="dd-timeline-name">' + esc(s.name) + '</div>' +
        '<div class="dd-timeline-meta">' + esc(s.category) + ' · ' + esc(s.updateFrequency) + '</div>' +
        '<div class="dd-timeline-meta" style="margin-top:.15rem">Last updated: ' +
          (s.lastUpdated ? esc(s.lastUpdated) : '—') + '</div>' +
        badgeHtml(s.status) +
        countdownText +
        '</div>';
    });
    html += '</div>';
    containerEl.innerHTML = html;
  }

  // ── 30-Day Update Schedule (Heat Map) ───────────────────────────
  function renderUpdateSchedule(containerEl, sources) {
    if (!containerEl) return;
    var today = new Date();
    var days = [];
    for (var i = 0; i < 30; i++) {
      var d = new Date(today.getTime() + i * MS_PER_DAY);
      days.push(d);
    }

    // Build a map of day-index → sources due
    var dayMap = {};
    days.forEach(function (d, i) { dayMap[i] = []; });
    sources.forEach(function (s) {
      if (!s.lastUpdated || !s.maxAgeDays) return;
      var until = daysUntil(s.lastUpdated, s.maxAgeDays);
      if (until !== null && until >= 0 && until < 30) {
        dayMap[until] = dayMap[until] || [];
        dayMap[until].push(s);
      }
    });

    var html = '<div style="overflow-x:auto"><table class="dd-matrix-table" aria-label="30-day update schedule">' +
      '<thead><tr>';
    days.forEach(function (d, i) {
      var label = (d.getMonth() + 1) + '/' + d.getDate();
      var isToday = i === 0;
      html += '<th style="' + (isToday ? 'background:var(--accent-light,#e6f0ef);' : '') + '">' + label + '</th>';
    });
    html += '</tr></thead><tbody><tr>';
    days.forEach(function (d, i) {
      var count = dayMap[i].length;
      var bg = count === 0 ? '' : count >= 3 ? 'background:#c8e6c9' : 'background:#fff9c4';
      var title = count ? dayMap[i].map(function (s) { return s.name; }).join(', ') : '';
      html += '<td style="text-align:center;' + bg + '" title="' + esc(title) + '">' +
        (count > 0 ? count : '') + '</td>';
    });
    html += '</tr></tbody></table></div>' +
      '<p style="font-size:.75rem;color:var(--text-secondary,#888);margin-top:.4rem">Numbers indicate sources due for update that day.</p>';

    containerEl.innerHTML = html;
  }

  // ── Activity Feed ────────────────────────────────────────────────
  function renderActivityFeed(containerEl, sources) {
    if (!containerEl) return;
    var recent = sources.filter(function (s) { return s.lastUpdated; })
      .sort(function (a, b) { return new Date(b.lastUpdated) - new Date(a.lastUpdated); })
      .slice(0, 15);

    var html = '<ul class="dd-feed" aria-label="Recent data updates">';
    recent.forEach(function (s) {
      var dotClass = s.status === 'stale' ? 'dd-feed-dot--error' :
                     s.status === 'aging' ? 'dd-feed-dot--warn' : 'dd-feed-dot--ok';
      html += '<li class="dd-feed-item">' +
        '<span class="dd-feed-dot ' + dotClass + '" aria-hidden="true"></span>' +
        '<div>' +
          '<div class="dd-feed-text">' + esc(s.name) + ' updated</div>' +
          '<div class="dd-feed-time">' + esc(s.lastUpdated) + ' · ' + esc(s.category) + '</div>' +
        '</div>' +
        '</li>';
    });
    html += '</ul>';
    containerEl.innerHTML = html;
  }

  // ── Freshness Overview ──────────────────────────────────────────
  function renderFreshnessOverview(containerEl, sources) {
    if (!containerEl) return;
    var cats = {};
    sources.forEach(function (s) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s);
    });

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem">';
    Object.keys(cats).sort().forEach(function (cat) {
      var catSources = cats[cat];
      var withScore = catSources.filter(function (s) { return s.freshnessScore !== null; });
      var avg = withScore.length
        ? Math.round(withScore.reduce(function (a, s) { return a + s.freshnessScore; }, 0) / withScore.length)
        : null;
      var staleCount = catSources.filter(function (s) { return s.status === 'stale'; }).length;
      var statusCls = staleCount > 0 ? 'dd-badge--stale' : avg !== null && avg < 50 ? 'dd-badge--aging' : 'dd-badge--current';

      html += '<div class="dd-stat-card">' +
        '<div class="dd-stat-label">' + esc(cat) + '</div>' +
        '<div style="margin:.2rem 0">' +
          (avg !== null ? gaugeHtml(avg, '') : '<span style="color:var(--text-secondary,#888)">No data</span>') +
        '</div>' +
        '<div class="dd-stat-sub">' + catSources.length + ' source' + (catSources.length !== 1 ? 's' : '') +
          (staleCount > 0 ? ' · <span style="color:#c62828">' + staleCount + ' stale</span>' : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
    containerEl.innerHTML = html;
  }

  // ── Public API ───────────────────────────────────────────────────
  window.TemporalDashboard = {
    renderTimeline: renderTimeline,
    renderUpdateSchedule: renderUpdateSchedule,
    renderActivityFeed: renderActivityFeed,
    renderFreshnessOverview: renderFreshnessOverview,
    badgeHtml: badgeHtml,
    gaugeHtml: gaugeHtml
  };

})();
