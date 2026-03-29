// js/data-review-hub.js
// Main controller for data-review-hub.html.
// Integrates DataSourceInventory, DataQuality, DataFreshnessMonitor,
// DataSourceDiscovery, and DiscoveryUIHandler into a unified tabbed experience.

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  var state = {
    activeTab:      'overview',
    filterStatus:   'all',
    filterCategory: 'all',
    filterFormat:   'all',
    filterFreq:     'all',
    searchQuery:    '',
    sources:        [],
    freshnessReport: null
  };

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
    requestAnimationFrame(function () { el.setAttribute('aria-live', 'polite'); });
  }

  function resolveUrl(p) {
    return typeof window.resolveAssetUrl === 'function'
      ? window.resolveAssetUrl(p) : p;
  }

  // ── Tab navigation ────────────────────────────────────────────────────────

  function initTabs() {
    var tabs = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', onTabClick);
    }
  }

  function onTabClick(e) {
    var key = e.currentTarget.dataset.tab;
    switchTab(key);
  }

  function switchTab(key) {
    state.activeTab = key;
    var tabs    = document.querySelectorAll('[data-tab]');
    var panels  = document.querySelectorAll('[data-panel]');

    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var active = t.dataset.tab === key;
      t.classList.toggle('drh-tab--active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.setAttribute('tabindex', active ? '0' : '-1');
    }

    for (var j = 0; j < panels.length; j++) {
      var p = panels[j];
      p.hidden = p.dataset.panel !== key;
    }

    announce('Showing ' + key + ' panel.');
  }

  // ── Filter sidebar ────────────────────────────────────────────────────────

  function initFilters() {
    // Status
    delegateFilter('drhStatusFilters', 'status');
    // Format
    delegateFilter('drhFormatFilters', 'format');
    // Frequency
    delegateFilter('drhFreqFilters', 'freq');

    // Search
    var search = document.getElementById('drhSearch');
    if (search) {
      search.addEventListener('input', function () {
        state.searchQuery = search.value.trim().toLowerCase();
        renderSourcesGrid();
      });
    }
  }

  function delegateFilter(containerId, filterKey) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.drh-filter-btn');
      if (!btn) return;
      var btns = container.querySelectorAll('.drh-filter-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.remove('active');
        btns[i].setAttribute('aria-pressed', 'false');
      }
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state['filter' + filterKey.charAt(0).toUpperCase() + filterKey.slice(1)] = btn.dataset.value;
      renderSourcesGrid();
    });
  }

  // ── Category filter buttons (dynamic) ────────────────────────────────────

  function buildCategoryFilters(sources) {
    var container = document.getElementById('drhCategoryFilters');
    if (!container) return;

    var cats = {};
    for (var i = 0; i < sources.length; i++) {
      var c = sources[i].category || 'Uncategorized';
      cats[c] = (cats[c] || 0) + 1;
    }

    var html = '<button class="drh-filter-btn active" data-value="all" ' +
                 'aria-pressed="true">All Categories</button>';
    var keys = Object.keys(cats).sort();
    for (var j = 0; j < keys.length; j++) {
      html += '<button class="drh-filter-btn" data-value="' + _esc(keys[j]) + '" ' +
               'aria-pressed="false">' + _esc(keys[j]) + ' <small>(' + cats[keys[j]] + ')</small></button>';
    }
    container.innerHTML = html;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.drh-filter-btn');
      if (!btn) return;
      var btns = container.querySelectorAll('.drh-filter-btn');
      for (var k = 0; k < btns.length; k++) {
        btns[k].classList.remove('active');
        btns[k].setAttribute('aria-pressed', 'false');
      }
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.filterCategory = btn.dataset.value;
      renderSourcesGrid();
    });
  }

  // ── Source filtering ──────────────────────────────────────────────────────

  function filterSources(sources) {
    return sources.filter(function (s) {
      if (state.filterStatus !== 'all' && s.status !== state.filterStatus) return false;
      if (state.filterCategory !== 'all' && s.category !== state.filterCategory) return false;
      if (state.filterFormat !== 'all') {
        var fmt = (s.format || '').toLowerCase();
        if (fmt !== state.filterFormat.toLowerCase()) return false;
      }
      if (state.filterFreq !== 'all') {
        var freq = (s.updateFrequency || '').toLowerCase();
        if (!freq.startsWith(state.filterFreq.toLowerCase())) return false;
      }
      if (state.searchQuery) {
        var haystack = [s.name, s.category, s.description, s.provider,
                        (s.tags || []).join(' ')].join(' ').toLowerCase();
        if (haystack.indexOf(state.searchQuery) === -1) return false;
      }
      return true;
    });
  }

  // ── Source grid renderer ──────────────────────────────────────────────────

  function statusBadge(status) {
    var map = {
      current: '<span class="drh-badge drh-badge--ok">✅ Current</span>',
      aging:   '<span class="drh-badge drh-badge--warn">⚠ Aging</span>',
      stale:   '<span class="drh-badge drh-badge--bad">🔴 Stale</span>',
      unknown: '<span class="drh-badge drh-badge--muted">❓ Unknown</span>'
    };
    return map[status] || map.unknown;
  }

  function renderSourceCard(s) {
    var whereUsedHtml = '';
    if (s.whereUsed && s.whereUsed.length) {
      whereUsedHtml = '<div class="drh-card-where">' +
        '<strong>Used in:</strong> ' +
        s.whereUsed.slice(0, 3).map(function (u) { return _esc(u); }).join(', ') +
        (s.whereUsed.length > 3 ? '… +' + (s.whereUsed.length - 3) + ' more' : '') +
      '</div>';
    }

    var sourceLink = s.url
      ? '<a class="drh-card-link" href="' + _esc(s.url) + '" target="_blank" rel="noopener">View source ↗</a>'
      : '';

    var freshScore = s.freshnessScore !== null && s.freshnessScore !== undefined
      ? '<div class="drh-freshness-bar" role="meter" aria-valuenow="' + s.freshnessScore +
          '" aria-valuemin="0" aria-valuemax="100" aria-label="Freshness ' + s.freshnessScore + '%">' +
          '<div class="drh-freshness-fill" style="width:' + s.freshnessScore + '%"></div>' +
        '</div>'
      : '';

    return '<article class="drh-source-card" data-id="' + _esc(s.id) + '">' +
      '<div class="drh-card-header">' +
        '<h3 class="drh-card-name">' + _esc(s.name) + '</h3>' +
        statusBadge(s.status) +
      '</div>' +
      '<div class="drh-card-meta">' +
        '<span class="drh-card-chip">' + _esc(s.category || 'Uncategorized') + '</span>' +
        '<span class="drh-card-chip">' + _esc(s.format || '') + '</span>' +
        (s.geoUnit ? '<span class="drh-card-chip">📍 ' + _esc(s.geoUnit) + '</span>' : '') +
      '</div>' +
      '<dl class="drh-card-dl">' +
        '<dt>Features</dt><dd>' + (s.features || '—') + '</dd>' +
        '<dt>Last updated</dt><dd>' + _esc(s.lastUpdated || '—') + '</dd>' +
        '<dt>Frequency</dt><dd>' + _esc(s.updateFrequency || '—') + '</dd>' +
        '<dt>Provider</dt><dd>' + _esc(s.provider || '—') + '</dd>' +
      '</dl>' +
      (s.description ? '<p class="drh-card-desc">' + _esc(s.description) + '</p>' : '') +
      freshScore +
      whereUsedHtml +
      '<div class="drh-card-actions">' +
        '<button class="drh-btn drh-btn--sm drh-metadata-btn" data-id="' + _esc(s.id) + '" type="button">Metadata</button>' +
        sourceLink +
      '</div>' +
    '</article>';
  }

  function renderSourcesGrid() {
    var grid = document.getElementById('drhSourcesGrid');
    if (!grid) return;

    var filtered = filterSources(state.sources);
    if (!filtered.length) {
      grid.innerHTML = '<div class="drh-empty"><span style="font-size:2rem">🔍</span><p>No data sources match the current filters.</p></div>';
      updateResultCount(0);
      return;
    }

    grid.innerHTML = filtered.map(renderSourceCard).join('');
    updateResultCount(filtered.length);
    wireMetadataButtons(grid);
  }

  function updateResultCount(count) {
    var el = document.getElementById('drhResultCount');
    if (el) el.textContent = count + ' source' + (count === 1 ? '' : 's');
  }

  // ── Metadata modal ────────────────────────────────────────────────────────

  function wireMetadataButtons(container) {
    var btns = container.querySelectorAll('.drh-metadata-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        var id = e.currentTarget.dataset.id;
        var src = state.sources.find(function (s) { return s.id === id; });
        if (src) openMetadataModal(src);
      });
    }
  }

  function openMetadataModal(src) {
    var modal = document.getElementById('drhModal');
    var body  = document.getElementById('drhModalBody');
    if (!modal || !body) return;

    var rows = [
      ['Name',            src.name],
      ['Category',        src.category],
      ['Format',          src.format],
      ['Provider',        src.provider],
      ['Coverage',        src.coverage],
      ['Geographic Unit', src.geoUnit],
      ['Features',        src.features],
      ['Last Updated',    src.lastUpdated],
      ['Update Frequency', src.updateFrequency],
      ['Status',          src.status],
      ['Freshness Score', src.freshnessScore !== null ? src.freshnessScore + '%' : '—'],
      ['Local File',      src.localFile],
      ['Source URL',      src.url ? '<a href="' + _esc(src.url) + '" target="_blank" rel="noopener">' + _esc(src.url) + '</a>' : '—'],
      ['Tags',            (src.tags || []).join(', ') || '—'],
      ['Description',     src.description]
    ];

    var tableRows = rows.map(function (r) {
      return '<tr><th scope="row">' + _esc(r[0]) + '</th>' +
             '<td>' + (r[1] !== null && r[1] !== undefined ? r[1] : '—') + '</td></tr>';
    }).join('');

    var whereUsedHtml = '';
    if (src.whereUsed && src.whereUsed.length) {
      whereUsedHtml = '<h3 style="margin-top:1rem;font-size:.95rem;">Where Used</h3><ul>' +
        src.whereUsed.map(function (u) { return '<li>' + _esc(u) + '</li>'; }).join('') +
      '</ul>';
    }

    var altHtml = '';
    if (src.alternatives && src.alternatives.length) {
      altHtml = '<h3 style="margin-top:1rem;font-size:.95rem;">Alternative Sources</h3><ul>' +
        src.alternatives.map(function (a) {
          return '<li><a href="' + _esc(a.url || '#') + '" target="_blank" rel="noopener">' +
            _esc(a.title) + '</a> — ' + _esc(a.description) + '</li>';
        }).join('') + '</ul>';
    }

    body.innerHTML = '<table class="drh-modal-table"><tbody>' + tableRows + '</tbody></table>' +
      whereUsedHtml + altHtml;

    var title = modal.querySelector('#drhModalTitle');
    if (title) title.textContent = src.name + ' — Metadata';

    modal.removeAttribute('hidden');
    modal.querySelector('.drh-modal-close').focus();
    announce('Metadata opened for ' + src.name);
  }

  function closeModal() {
    var modal = document.getElementById('drhModal');
    if (modal) modal.setAttribute('hidden', '');
    announce('Metadata closed.');
  }

  function initModal() {
    var closeBtn = document.querySelector('.drh-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var overlay = document.getElementById('drhModalOverlay');
    if (overlay) overlay.addEventListener('click', closeModal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  function renderStats(sources) {
    var counts = { current: 0, aging: 0, stale: 0, unknown: 0 };
    for (var i = 0; i < sources.length; i++) {
      counts[sources[i].status] = (counts[sources[i].status] || 0) + 1;
    }

    function set(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    }
    set('drhStatTotal',   sources.length);
    set('drhStatCurrent', counts.current || 0);
    set('drhStatAging',   counts.aging   || 0);
    set('drhStatStale',   counts.stale   || 0);
  }

  // ── Quality panel (Data Status merged) ───────────────────────────────────

  function initQualityPanel() {
    if (!window.DataQuality) return;

    var grid = document.getElementById('drhQualityGrid');
    var tbody = document.getElementById('drhQualityTable');
    var summary = document.getElementById('drhQualitySummary');
    if (!grid || !tbody || !summary) return;

    function _esc2(s) { return _esc(s); }

    function relTime(ms) {
      if (ms == null) return '—';
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's ago';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    }

    function renderCard(r) {
      var cls = r.ok ? 'ok' : (r.critical ? 'error' : 'warn');
      var div = document.createElement('div');
      div.className = 'drh-status-card drh-status-card--' + cls;
      div.innerHTML =
        '<div class="drh-status-icon">' + (r.ok ? '✅' : '⚠️') + '</div>' +
        '<div class="drh-status-label">' + _esc2(r.label) + '</div>' +
        '<div class="drh-status-detail">' +
          (r.featureCount > 0 ? r.featureCount + ' records' : '') +
          (r.message ? '<br>' + _esc2(r.message) : '') +
        '</div>' +
        '<div class="drh-status-age">' + relTime(r.cacheAge) + '</div>';
      return div;
    }

    function renderRow(r) {
      var cls = r.ok ? 'badge-ok' : (r.critical ? 'badge-error' : 'badge-warn');
      var lbl = r.ok ? '✅ OK' : (r.critical ? '⚠ Error' : '⚠ Warn');
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + _esc2(r.label) + '</td>' +
        '<td><span class="' + cls + '">' + lbl + '</span></td>' +
        '<td>' + (r.featureCount > 0 ? r.featureCount : '—') + '</td>' +
        '<td>' + relTime(r.cacheAge) + '</td>' +
        '<td style="color:var(--muted)">' + _esc2(r.message || '') + '</td>';
      return tr;
    }

    function runQualityCheck() {
      summary.className = 'drh-quality-summary ok';
      summary.textContent = '⏳ Running data validation…';
      grid.innerHTML = '<div class="drh-status-card drh-status-card--loading"><div class="drh-status-icon">⏳</div><div class="drh-status-label">Loading…</div></div>';

      window.DataQuality.runAll().then(function (reports) {
        var allOk = reports.every(function (r) { return r.ok; });
        var anyCrit = reports.some(function (r) { return !r.ok && r.critical; });
        if (anyCrit) {
          summary.className = 'drh-quality-summary error';
          summary.textContent = '⚠ One or more critical datasets are unavailable.';
        } else if (!allOk) {
          summary.className = 'drh-quality-summary warn';
          summary.textContent = '⚠ Some datasets have warnings.';
        } else {
          summary.className = 'drh-quality-summary ok';
          summary.textContent = '✅ All datasets validated successfully.';
        }

        grid.innerHTML = '';
        var tBody = tbody;
        tBody.innerHTML = '';
        reports.forEach(function (r) {
          grid.appendChild(renderCard(r));
          tBody.appendChild(renderRow(r));
        });

        var ts = document.getElementById('drhQualityTimestamp');
        if (ts) ts.textContent = 'Last checked: ' + new Date().toLocaleTimeString();
        announce(summary.textContent);
      });
    }

    runQualityCheck();

    var btn = document.getElementById('drhQualityRefresh');
    if (btn) btn.addEventListener('click', runQualityCheck);
  }

  // ── Overview stats from freshness report ─────────────────────────────────

  function renderOverview(report) {
    if (!report) return;
    var sum = report.summary || {};
    function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    set('drhOvTotal',   sum.total   || '—');
    set('drhOvCurrent', (sum.counts && sum.counts.current) || 0);
    set('drhOvAging',   (sum.counts && sum.counts.aging)   || 0);
    set('drhOvStale',   (sum.counts && sum.counts.stale)   || 0);
    set('drhOvFresh',   sum.avgFreshness !== null ? sum.avgFreshness + '%' : '—');
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function initExports() {
    var csvBtn  = document.getElementById('drhExportCsv');
    var jsonBtn = document.getElementById('drhExportJson');
    var mdBtn   = document.getElementById('drhExportMd');

    function download(content, name, type) {
      var blob = new Blob([content], { type: type });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download  = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    if (csvBtn) {
      csvBtn.addEventListener('click', function () {
        var headers = ['id', 'name', 'category', 'format', 'status',
                       'lastUpdated', 'updateFrequency', 'features', 'provider', 'url'];
        var rows = [headers.join(',')];
        state.sources.forEach(function (s) {
          rows.push(headers.map(function (h) {
            var v = s[h] != null ? String(s[h]) : '';
            return '"' + v.replace(/"/g, '""') + '"';
          }).join(','));
        });
        download(rows.join('\n'), 'data-sources-audit.csv', 'text/csv');
        announce('CSV exported.');
      });
    }

    if (jsonBtn) {
      jsonBtn.addEventListener('click', function () {
        download(JSON.stringify(state.sources, null, 2), 'data-sources-audit.json', 'application/json');
        announce('JSON exported.');
      });
    }

    if (mdBtn && window.DataFreshnessMonitor) {
      mdBtn.addEventListener('click', function () {
        if (state.freshnessReport) {
          window.DataFreshnessMonitor.downloadMarkdownReport(state.freshnessReport);
          announce('Freshness report downloaded.');
        }
      });
    }
  }

  // ── Load sources and boot ─────────────────────────────────────────────────

  function loadSources() {
    if (!window.DataSourceInventory) {
      console.warn('[DataReviewHub] DataSourceInventory not loaded.');
      return Promise.resolve([]);
    }

    var inv = window.DataSourceInventory;
    var sources = inv.getSources();

    // Merge freshness data if available (status + freshnessScore are already computed by getSources())
    return Promise.resolve(sources.map(function (s) {
      return Object.assign({}, s, {
        whereUsed: s.whereUsed || guessWhereUsed(s)
      });
    }));
  }

  function guessWhereUsed(s) {
    var map = {
      'lihtc':      ['LIHTC Dashboard', 'Compliance Dashboard', 'Market Analysis'],
      'chfa':       ['LIHTC Dashboard', 'CHFA Portfolio'],
      'fred':       ['Economic Dashboard', 'Colorado Market'],
      'census':     ['Housing Needs Assessment', 'Colorado Deep Dive'],
      'hud':        ['LIHTC Dashboard', 'Housing Needs Assessment'],
      'ami':        ['Housing Needs Assessment', 'Compliance Dashboard'],
      'car':        ['Colorado Market', 'Economic Dashboard'],
      'boundaries': ['All Maps'],
      'amenity':    ['Market Analysis'],
      'nhpd':       ['Preservation Dashboard']
    };
    var tags = (s.tags || []).join(' ').toLowerCase() + ' ' + (s.id || '').toLowerCase();
    var uses = [];
    for (var key in map) {
      if (tags.indexOf(key) !== -1) {
        map[key].forEach(function (u) {
          if (uses.indexOf(u) === -1) uses.push(u);
        });
      }
    }
    return uses;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    initTabs();
    initFilters();
    initModal();
    initExports();
    initQualityPanel();

    loadSources().then(function (sources) {
      state.sources = sources;
      renderStats(sources);
      buildCategoryFilters(sources);
      renderSourcesGrid();

      // Run freshness monitor
      if (window.DataFreshnessMonitor) {
        window.DataFreshnessMonitor.runFreshnessCheck().then(function (report) {
          state.freshnessReport = report;
          renderOverview(report);
        });
      }

      // Discovery module init
      if (window.DiscoveryUIHandler) {
        window.DiscoveryUIHandler.init();
      }
    });

    // Set timestamp
    var ts = document.getElementById('drhTimestamp');
    if (ts) ts.textContent = 'Loaded: ' + new Date().toLocaleString();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DataReviewHub = { switchTab: switchTab };

}());
