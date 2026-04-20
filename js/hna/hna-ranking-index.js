/**
 * js/hna/hna-ranking-index.js
 * HNA Comparative Ranking Page — data loading, sort, filter, search, export.
 *
 * Exposes: window.HNARanking
 * Dependencies: js/fetch-helper.js (window.fetchWithTimeout or fetch)
 *              js/utils/data-quality.js (window.DataQuality)
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  const DATA_PATH      = 'data/hna/ranking-index.json';
  const SCORECARD_PATH = 'data/policy/housing-policy-scorecard.json';
  const HNA_PAGE       = 'housing-needs-assessment.html';

  const DEFAULT_METRIC = 'overall_need_score';
  const DEFAULT_SORT_DIR = 'desc';
  const PAGE_SIZE = 100; // rows rendered per batch

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  let _allEntries     = [];   // full ranked list from JSON
  let _filteredEntries = [];  // after search/filter
  let _sortMetric     = DEFAULT_METRIC;
  let _sortDir        = DEFAULT_SORT_DIR; // 'asc' | 'desc'
  let _filterType     = '';   // '' | 'county' | 'place' | 'cdp'
  let _filterRegion   = '';   // '' | region name
  let _searchText     = '';
  let _selectedGeoid  = '';
  let _metadata       = {};
  let _metricsConfig  = [];
  let _scorecardData  = {};   // housing-policy-scorecard.json scores
  let _econData       = {};   // co-county-economic-indicators.json — keyed by county name
  let _renderedCount  = 0;

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  async function load() {
    const fetcher = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : (u) => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

    const [data, scorecard, econ] = await Promise.all([
      fetcher(DATA_PATH),
      fetcher(SCORECARD_PATH).catch(() => ({ scores: {} })),
      fetcher('data/co-county-economic-indicators.json').catch(() => null),
    ]);
    _allEntries    = data.rankings || [];
    _metadata      = data.metadata || {};
    _metricsConfig = data.metrics  || [];
    _scorecardData = (scorecard && scorecard.scores) || {};
    _econData      = (econ && econ.counties) || {};

    _filteredEntries = _allEntries.slice();
    return data;
  }

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  function sortEntries(entries, metric, dir) {
    return [...entries].sort((a, b) => {
      // Sentinel values (-666666666, NaN, Infinity) are normalized to null
      // by DataQuality.sanitizeNumber and rendered as '—' in the UI table.
      // Null entries sort to the bottom regardless of sort direction.
      const _sanitize = (_dq && _dq.sanitizeNumber) || (v => (v === null || v === undefined ? null : +v));
      // Commitment score comes from scorecard, not entry.metrics
      if (metric === 'commitment_score') {
        const scA = _scorecardData[a.geoid];
        const scB = _scorecardData[b.geoid];
        const av = scA ? scA.totalScore : -Infinity;
        const bv = scB ? scB.totalScore : -Infinity;
        return dir === 'asc' ? av - bv : bv - av;
      }
      // Unemployment rate comes from econ data, not entry.metrics
      if (metric === 'unemployment_rate') {
        const econLookup = (entry) => {
          if (entry.type !== 'county') return null;
          const cName = entry.name.replace(/\s+County$/i, '').trim();
          const cData = _econData[cName];
          return cData ? cData.unemployment_rate : null;
        };
        const av = econLookup(a) ?? Infinity; // nulls sort to bottom for asc
        const bv = econLookup(b) ?? Infinity;
        return dir === 'asc' ? av - bv : bv - av;
      }
      const av = _sanitize(a.metrics[metric]) ?? -Infinity;
      const bv = _sanitize(b.metrics[metric]) ?? -Infinity;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }

  // -------------------------------------------------------------------------
  // Filter helpers
  // -------------------------------------------------------------------------

  function applyFilters() {
    let result = _allEntries.slice();

    if (_filterType) {
      result = result.filter(e => e.type === _filterType);
    }
    if (_filterRegion) {
      result = result.filter(e => e.region === _filterRegion);
    }
    if (_searchText) {
      const q = _searchText.toLowerCase();
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.geoid.includes(q) ||
        e.region.toLowerCase().includes(q)
      );
    }

    _filteredEntries = sortEntries(result, _sortMetric, _sortDir);
    _renderedCount = 0;
  }

  // -------------------------------------------------------------------------
  // Quick-access presets
  // -------------------------------------------------------------------------

  const QUICK_PRESETS = {
    all:         () => { _filterType = ''; _filterRegion = ''; _searchText = ''; },
    top10:       () => { _filterType = ''; _filterRegion = ''; _searchText = ''; _sortMetric = 'overall_need_score'; _sortDir = 'desc'; },
    counties:    () => { _filterType = 'county'; },
    places:      () => { _filterType = 'place'; },
    cdps:        () => { _filterType = 'cdp'; },
    frontRange:  () => { _filterRegion = 'Front Range'; },
    mountains:   () => { _filterRegion = 'Mountains'; },
    westernSlope:() => { _filterRegion = 'Western Slope'; },
  };

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  // Use shared DataQuality utility when available; otherwise fall back to
  // the inline guard so the page works even if the utility script is absent.
  const _dq = (typeof window !== 'undefined' && window.DataQuality) || null;

  function fmt(val, unit) {
    // Delegate to DataQuality.formatMetric when available (handles sentinel
    // values such as -666666666 in addition to null/undefined/NaN).
    if (_dq) return _dq.formatMetric(val, unit === 'percent' ? 'percent' : unit === 'dollars' ? 'dollars' : 'integer');
    if (val === null || val === undefined) return '—';
    if (unit === 'percent') return `${(+val).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    if (unit === 'dollars') return `$${(+val).toLocaleString('en-US')}`;
    if (unit === 'score') return `${(+val).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    return (+val).toLocaleString('en-US');
  }

  function rankBadgeClass(rank, total) {
    const pct = (rank / total) * 100;
    if (pct <= 20) return 'top20';
    if (pct <= 40) return 'top40';
    if (pct <= 60) return 'top60';
    if (pct <= 80) return 'top80';
    return 'bot20';
  }

  function typeLabel(type) {
    const map = { county: 'County', place: 'Incorporated Place', cdp: 'CDP' };
    return map[type] || type;
  }

  function hnaLink(entry) {
    const params = new URLSearchParams({
      geoType: entry.type === 'county' ? 'county' : entry.type === 'place' ? 'place' : 'cdp',
      geoid: entry.geoid,
    });
    return `${HNA_PAGE}?${params.toString()}`;
  }

  function getMetricUnit(metricId) {
    const m = _metricsConfig.find(x => x.id === metricId);
    return m ? m.unit : 'units';
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  const METRIC_COLUMNS = [
    { id: 'overall_need_score',         label: 'Overall Need\nScore',       mobileLabel: 'Need Score',       tip: 'Composite index (0-100): 50% unit gap at 30% AMI, 30% cost-burden rate, 20% in-commuter pressure' },
    { id: 'commitment_score',           label: 'Housing\nCommitment',       mobileLabel: 'Commitment', isScorecard: true, tip: 'Policy commitment scorecard: housing authority, inclusionary zoning, Prop 123, housing plans, etc.' },
    { id: 'housing_gap_units',          label: 'Units Needed\n(30% AMI)',   mobileLabel: 'Units Needed',     tip: 'Estimated deficit of affordable rental units at 30% of Area Median Income (HUD CHAS data)' },
    { id: 'pct_cost_burdened',          label: '% Rent\nBurdened',          mobileLabel: '% Rent Burdened',  tip: 'Share of renter households paying 30%+ of income on housing costs (ACS GRAPI)' },
    { id: 'in_commuters',               label: 'In-Commuters',              mobileLabel: 'In-Commuters',     tip: 'Workers employed here but living elsewhere — a demand signal for local housing (LEHD LODES)' },
    { id: 'population',                 label: 'Population',                mobileLabel: 'Population',       tip: 'Total resident population (ACS 2024 5-year estimates)' },
    { id: 'median_hh_income',           label: 'Median HH\nIncome',         mobileLabel: 'Median Income',    tip: 'Median household income in dollars (ACS 2024). Higher income areas may still have affordability gaps.' },
    { id: 'pct_renters',                label: '% Renters',                 mobileLabel: '% Renters',        tip: 'Share of occupied housing units that are renter-occupied (ACS 2024 tenure data)' },
    { id: 'unemployment_rate',          label: 'Unemp.\nRate',              mobileLabel: 'Unemp. Rate', isEcon: true, tip: 'Unemployment rate from BLS LAUS (counties only). Lower values indicate a healthier labour market.' },
  ];

  function renderRow(entry, total) {
    const tr = document.createElement('tr');
    tr.className = 'hca-tr' + (_selectedGeoid === entry.geoid ? ' highlighted' : '');
    tr.dataset.geoid = entry.geoid;
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-selected', _selectedGeoid === entry.geoid ? 'true' : 'false');

    const badgeClass = rankBadgeClass(entry.rank, total);
    const typeClass  = `hca-type-${entry.type}`;

    const dqBadge = entry.hasIncompleteData
      ? `<span class="hca-dq-badge" title="This geography has incomplete data for some metrics (${entry.nullCriticalMetrics} of 5 critical fields missing)" aria-label="Incomplete data">⚠️</span>`
      : '';
    const pop = entry.metrics && entry.metrics.population;
    const smallGeoBadge = (pop && pop > 0 && pop < 5000)
      ? `<span class="hca-dq-badge" title="Population ${Math.round(pop).toLocaleString()} — ACS estimates for geographies under 5,000 may have high margins of error (30-50%)" aria-label="Small geography" style="cursor:help;">📊</span>`
      : '';

    tr.innerHTML = [
      `<td class="hca-td hca-td-num" data-label="Rank"><span class="hca-rank ${badgeClass}">#${entry.rank}</span></td>`,
      `<td class="hca-td hca-td-name" data-label="Name"><a class="hca-hna-link" href="${hnaLink(entry)}" title="Open full HNA for ${entry.name}">${entry.name}</a>${dqBadge}${smallGeoBadge}</td>`,
      `<td class="hca-td" data-label="Type"><span class="hca-type-badge ${typeClass}">${typeLabel(entry.type)}</span></td>`,
      `<td class="hca-td" data-label="Region">${entry.region || '—'}</td>`,
      ...METRIC_COLUMNS.map(col => {
        if (col.isScorecard) {
          const sc = _scorecardData[entry.geoid];
          if (!sc || sc.knownDimensions < 1) {
            return `<td class="hca-td hca-td-num" data-label="${col.mobileLabel}"><span class="hca-commit-badge hca-commit-none" title="Insufficient data">—</span></td>`;
          }
          const cls = sc.totalScore >= 4 ? 'hca-commit-high' : sc.totalScore >= 2 ? 'hca-commit-mid' : 'hca-commit-low';
          return `<td class="hca-td hca-td-num" data-label="${col.mobileLabel}"><span class="hca-commit-badge ${cls}" title="${sc.totalScore} of ${sc.knownDimensions} housing commitment dimensions confirmed">${sc.totalScore}/${sc.knownDimensions}</span></td>`;
        }
        if (col.isEcon) {
          // Unemployment rate: only available for county-type entries; look up by county name
          if (entry.type !== 'county') {
            return `<td class="hca-td hca-td-num" data-label="${col.mobileLabel}" title="County-level data only">—</td>`;
          }
          // County name in entry is like "Adams County"; strip " County" for the key
          const cName = entry.name.replace(/\s+County$/i, '').trim();
          const cData = _econData[cName];
          const ur = cData ? cData[col.id] : null;
          const urStr = ur != null ? ur.toFixed(1) + '%' : '—';
          return `<td class="hca-td hca-td-num" data-label="${col.mobileLabel}">${urStr}</td>`;
        }
        const val = entry.metrics[col.id];
        const unit = getMetricUnit(col.id);
        return `<td class="hca-td hca-td-num" data-label="${col.mobileLabel}">${fmt(val, unit)}</td>`;
      }),
      `<td class="hca-td" data-label="HNA"><a class="hca-hna-link" href="${hnaLink(entry)}">Open HNA →</a></td>`,
    ].join('');

    tr.addEventListener('click', () => selectEntry(entry));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') selectEntry(entry); });

    return tr;
  }

  function renderTableHeader(tbody, thead) {
    const thFixed = [
      { id: 'rank',   label: 'Rank',   sortable: false },
      { id: 'name',   label: 'Geography', sortable: false },
      { id: 'type',   label: 'Type',   sortable: false },
      { id: 'region', label: 'Region', sortable: false },
    ];
    const thMetrics = METRIC_COLUMNS.map(col => ({
      id: col.id,
      label: col.label.replace(/\n/g, ' '),
      sortable: true,
      tip: col.tip || '',
    }));
    const thLink = { id: 'link', label: '', sortable: false };

    const allCols = [...thFixed, ...thMetrics, thLink];
    if (!thead) return;

    const tr = thead.querySelector('tr') || document.createElement('tr');
    tr.innerHTML = allCols.map(col => {
      if (!col.sortable) return `<th class="hca-th" scope="col">${col.label}</th>`;
      const isActive = _sortMetric === col.id;
      const dir = isActive ? _sortDir : '';
      const tipAttr = col.tip ? ` title="${col.tip}"` : '';
      return `<th class="hca-th sortable ${isActive ? 'sort-' + dir : ''}" scope="col" data-metric="${col.id}" tabindex="0" role="columnheader" aria-sort="${isActive ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}"${tipAttr}>
        ${col.label}<span class="sort-icon" aria-hidden="true"></span>
      </th>`;
    }).join('');
    if (!thead.contains(tr)) thead.appendChild(tr);
  }

  function renderRows(tbody, total) {
    const fragment = document.createDocumentFragment();
    const batch = _filteredEntries.slice(_renderedCount, _renderedCount + PAGE_SIZE);
    batch.forEach(e => fragment.appendChild(renderRow(e, total)));
    tbody.appendChild(fragment);
    _renderedCount += batch.length;
  }

  function rerenderTable() {
    const tbody = document.getElementById('hcaTableBody');
    const thead = document.getElementById('hcaTableHead');
    const countEl = document.getElementById('hcaResultsCount');
    if (!tbody) return;

    tbody.innerHTML = '';
    _renderedCount = 0;

    renderTableHeader(tbody, thead);

    const total = _allEntries.length;
    const filtered = _filteredEntries.length;

    if (filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="hca-empty">No results match your filters. Try broadening your search.</td></tr>';
    } else {
      renderRows(tbody, total);
    }

    if (countEl) {
      countEl.textContent = filtered < total
        ? `Showing ${filtered.toLocaleString()} of ${total.toLocaleString()} geographies`
        : `${total.toLocaleString()} geographies`;
    }
  }

  // -------------------------------------------------------------------------
  // Detail panel
  // -------------------------------------------------------------------------

  function selectEntry(entry) {
    _selectedGeoid = _selectedGeoid === entry.geoid ? '' : entry.geoid;
    updateDetailPanel(entry);
    // Refresh highlighted row styling
    document.querySelectorAll('.hca-tr').forEach(row => {
      const isSelected = row.dataset.geoid === _selectedGeoid;
      row.classList.toggle('highlighted', isSelected);
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
    if (_selectedGeoid) {
      const row = document.querySelector(`.hca-tr[data-geoid="${_selectedGeoid}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    announce(_selectedGeoid ? `${entry.name} selected. Rank #${entry.rank}.` : 'Selection cleared.');
  }

  const SCORECARD_LABELS = {
    has_hna: 'Housing Needs Assessment',
    prop123_committed: 'Proposition 123 Committed',
    has_housing_authority: 'Housing Authority',
    has_housing_nonprofits: 'Housing Nonprofits',
    has_comp_plan: 'Housing in Comprehensive Plan',
    has_iz_ordinance: 'Zoning Incentives / IZ Ordinance',
    has_local_funding: 'Affordable Housing Funding',
  };

  function renderScorecardDetail(geoid) {
    const sc = _scorecardData[geoid];
    if (!sc || sc.knownDimensions < 1) {
      return '<div class="hca-scorecard-panel"><h4>Housing Policy Commitment</h4><p style="color:var(--muted);font-size:.85rem">No policy data available for this jurisdiction yet.</p></div>';
    }
    const items = Object.entries(sc.dimensions).map(function (pair) {
      const id = pair[0], val = pair[1];
      const label = SCORECARD_LABELS[id] || id;
      if (val === true)  return '<div class="hca-sc-item hca-sc-yes"><span class="hca-sc-icon">✓</span> ' + label + '</div>';
      if (val === false) return '<div class="hca-sc-item hca-sc-no"><span class="hca-sc-icon">✗</span> ' + label + '</div>';
      return '<div class="hca-sc-item hca-sc-unknown"><span class="hca-sc-icon">?</span> ' + label + '</div>';
    }).join('');
    const summary = sc.totalScore + ' of ' + sc.knownDimensions + ' commitment dimensions confirmed';
    var cta = sc.knownDimensions < 7
      ? '<p style="margin-top:.5rem;font-size:.78rem;color:var(--muted)">Know more about this jurisdiction\'s housing policies? <a href="https://github.com/pggLLC/Housing-Analytics/issues/new?title=Housing+policy+data+for+' + encodeURIComponent(sc.name || '') + '&labels=data-contribution" target="_blank" rel="noopener" style="color:var(--accent)">Submit data</a></p>'
      : '';
    return '<div class="hca-scorecard-panel"><h4>Housing Policy Commitment</h4><div class="hca-scorecard-grid">' + items + '</div><div class="hca-scorecard-summary">' + summary + '</div>' + cta + '</div>';
  }

  function updateDetailPanel(entry) {
    const panel = document.getElementById('hcaDetailPanel');
    if (!panel) return;

    if (!_selectedGeoid) {
      panel.classList.remove('visible');
      return;
    }

    const total = _allEntries.length;
    const metrics = entry.metrics;

    // Build missing AMI tiers display
    const missingTiers = Array.isArray(metrics.missing_ami_tiers) ? metrics.missing_ami_tiers : [];
    const missingTiersHtml = missingTiers.length > 0
      ? missingTiers.map(t => `<span class="hca-ami-missing-badge">${t}</span>`).join(' ')
      : '<span style="color:var(--muted);font-size:.83rem">None — market coverage adequate across tiers</span>';

    // Data-quality flags — which fields on this entry are downscaled from
    // county-level sources rather than measured at this geography directly
    const approxFields = (entry.dataQuality && Array.isArray(entry.dataQuality.approximated_fields))
      ? entry.dataQuality.approximated_fields : [];
    const hasApprox = approxFields.length > 0;
    const approxNoticeHtml = hasApprox ? `
      <div class="hca-detail-approx-note" role="note" style="margin-top:.75rem;padding:.6rem .8rem;border-radius:var(--radius);background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.3);color:var(--text);font-size:.78rem;line-height:1.5;">
        <strong>Approximation:</strong> CHAS cost-burden tiers, AMI gap counts, in-commuters, and the 20-year projection for this ${typeLabel(entry.type).toLowerCase()} are scaled from its containing county. Actual values at this geography may differ — particularly if the ${typeLabel(entry.type).toLowerCase()}'s renter AMI mix or commute pattern diverges from the county as a whole. Cost-burden % and rent are from this geography's own ACS data.
      </div>` : '';

    // Demographic cost-burden stratification (CHAS)
    const hasDemog = metrics.pct_burdened_lte30 > 0 || metrics.pct_burdened_31to50 > 0 || metrics.pct_burdened_51to80 > 0;
    const demogHtml = hasDemog ? `
      <div class="hca-detail-demog">
        <div class="hca-detail-demog-label">Cost-burden by AMI tier (CHAS)${hasApprox ? ' <span style="color:var(--muted);font-weight:400;font-size:.78rem;">(county-approx)</span>' : ''}</div>
        <div class="hca-detail-demog-row">
          <span class="hca-detail-demog-tier">≤30% AMI</span>
          <div class="hca-detail-demog-bar-wrap" aria-label="${fmt(metrics.pct_burdened_lte30,'percent')} of renters at ≤30% AMI are cost-burdened">
            <div class="hca-detail-demog-bar" style="width:${Math.min(metrics.pct_burdened_lte30,100)}%;background:var(--bad,#ef4444)"></div>
          </div>
          <span class="hca-detail-demog-val">${fmt(metrics.pct_burdened_lte30,'percent')}</span>
        </div>
        <div class="hca-detail-demog-row">
          <span class="hca-detail-demog-tier">31–50% AMI</span>
          <div class="hca-detail-demog-bar-wrap" aria-label="${fmt(metrics.pct_burdened_31to50,'percent')} of renters at 31–50% AMI are cost-burdened">
            <div class="hca-detail-demog-bar" style="width:${Math.min(metrics.pct_burdened_31to50,100)}%;background:var(--warn,#d97706)"></div>
          </div>
          <span class="hca-detail-demog-val">${fmt(metrics.pct_burdened_31to50,'percent')}</span>
        </div>
        <div class="hca-detail-demog-row">
          <span class="hca-detail-demog-tier">51–80% AMI</span>
          <div class="hca-detail-demog-bar-wrap" aria-label="${fmt(metrics.pct_burdened_51to80,'percent')} of renters at 51–80% AMI are cost-burdened">
            <div class="hca-detail-demog-bar" style="width:${Math.min(metrics.pct_burdened_51to80,100)}%;background:var(--chart-3,#f59e0b)"></div>
          </div>
          <span class="hca-detail-demog-val">${fmt(metrics.pct_burdened_51to80,'percent')}</span>
        </div>
      </div>` : '';

    panel.innerHTML = `
      <button class="hca-detail-close" id="hcaDetailClose" aria-label="Close detail panel">✕</button>
      <div class="hca-detail-title">${entry.name} <span class="hca-type-badge hca-type-${entry.type}" style="vertical-align:middle;">${typeLabel(entry.type)}</span></div>
      <div class="hca-detail-stats">
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">#${entry.rank}</span>
          <span class="hca-detail-stat-label">Statewide Rank</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.overall_need_score,'score')}</span>
          <span class="hca-detail-stat-label">Overall Need Score</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.housing_gap_units, 'units')}</span>
          <span class="hca-detail-stat-label">Units Needed (30% AMI)</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.ami_gap_50pct, 'units')}</span>
          <span class="hca-detail-stat-label">Units Needed (50% AMI)</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.ami_gap_60pct, 'units')}</span>
          <span class="hca-detail-stat-label">Units Needed (60% AMI)</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.pct_cost_burdened, 'percent')}</span>
          <span class="hca-detail-stat-label">% Rent Burdened</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.in_commuters, 'units')}</span>
          <span class="hca-detail-stat-label">In-Commuters</span>
        </div>
        <div class="hca-detail-stat">
          <span class="hca-detail-stat-val">${fmt(metrics.commute_ratio, 'percent')}</span>
          <span class="hca-detail-stat-label">In-Commute Ratio</span>
        </div>
      </div>
      <div class="hca-pct-bar-wrap">
        <span>Overall need intensity</span>
        <div class="hca-pct-bar"><div class="hca-pct-fill" style="width:${entry.percentileRank}%"></div></div>
        <span>${entry.percentileRank.toFixed(0)}th pctile</span>
      </div>
      <div class="hca-detail-missing-ami">
        <div class="hca-detail-missing-label">Underserved rental AMI tiers (coverage &lt;75%)</div>
        <div class="hca-detail-missing-tiers">${missingTiersHtml}</div>
      </div>
      ${demogHtml}
      ${approxNoticeHtml}
      ${renderScorecardDetail(entry.geoid)}
      <a class="hca-detail-link" href="${hnaLink(entry)}">Open full HNA for ${entry.name} →</a>
    `;
    panel.classList.add('visible');

    document.getElementById('hcaDetailClose').addEventListener('click', () => {
      _selectedGeoid = '';
      panel.classList.remove('visible');
      document.querySelectorAll('.hca-tr').forEach(row => {
        row.classList.remove('highlighted');
        row.setAttribute('aria-selected', 'false');
      });
    });
  }

  // -------------------------------------------------------------------------
  // Live-region announcer
  // -------------------------------------------------------------------------

  function announce(msg) {
    const el = document.getElementById('hcaLiveRegion');
    if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
    if (typeof window.__announceUpdate === 'function') window.__announceUpdate(msg);
  }

  // -------------------------------------------------------------------------
  // KPI cards
  // -------------------------------------------------------------------------

  function renderKpis(meta) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('hcaKpiCounties', (meta.totalCounties || 0).toLocaleString());
    set('hcaKpiPlaces',   (meta.totalPlaces   || 0).toLocaleString());
    set('hcaKpiCDPs',     (meta.totalCDPs     || 0).toLocaleString());
    set('hcaKpiTotal',    (meta.totalEntries  || 0).toLocaleString());
    const ts = document.getElementById('hcaDataTimestamp');
    if (ts && meta.generatedAt) {
      ts.textContent = `Data as of ${meta.generatedAt.split('T')[0]}`;
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  function exportCSV() {
    const headers = [
      'Rank', 'GEOID', 'Name', 'Type', 'Region',
      'Overall Need Score',
      'Housing Gap Units (30% AMI)',
      'Units Needed (50% AMI)',
      'Units Needed (60% AMI)',
      'Pct Cost Burdened',
      'Pct Burdened (<=30% AMI)',
      'Pct Burdened (31-50% AMI)',
      'Pct Burdened (51-80% AMI)',
      'Missing AMI Tiers',
      'In-Commuters',
      'In-Commute Ratio (%)',
      'Population',
      'Median HH Income',
      'Population Projection 20yr',
      'Pct Renters',
      'Gross Rent Median',
      'Percentile Rank',
      'Median Comparison',
      'Commitment Score',
      'Commitment Known Dims',
      'Has HNA',
      'Prop 123 Committed',
      'Has Housing Authority',
      'Has Housing Nonprofits',
      'Has Comp Plan',
      'Has IZ Ordinance',
      'Has Local Funding',
    ];

    const rows = _filteredEntries.map(e => {
      const sc = _scorecardData[e.geoid] || {};
      const dims = sc.dimensions || {};
      const boolStr = v => v === true ? 'Yes' : v === false ? 'No' : '';
      return [
        e.rank,
        e.geoid,
        e.name,
        e.type,
        e.region,
        e.metrics.overall_need_score,
        e.metrics.housing_gap_units,
        e.metrics.ami_gap_50pct,
        e.metrics.ami_gap_60pct,
        e.metrics.pct_cost_burdened,
        e.metrics.pct_burdened_lte30,
        e.metrics.pct_burdened_31to50,
        e.metrics.pct_burdened_51to80,
        Array.isArray(e.metrics.missing_ami_tiers) ? e.metrics.missing_ami_tiers.join('; ') : '',
        e.metrics.in_commuters,
        e.metrics.commute_ratio,
        e.metrics.population,
        e.metrics.median_hh_income,
        e.metrics.population_projection_20yr,
        e.metrics.pct_renters,
        e.metrics.gross_rent_median,
        e.percentileRank,
        e.medianComparison,
        sc.totalScore ?? '',
        sc.knownDimensions ?? '',
        boolStr(dims.has_hna),
        boolStr(dims.prop123_committed),
        boolStr(dims.has_housing_authority),
        boolStr(dims.has_housing_nonprofits),
        boolStr(dims.has_comp_plan),
        boolStr(dims.has_iz_ordinance),
        boolStr(dims.has_local_funding),
      ];
    });

    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `hna-comparative-ranking-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    announce('CSV download started.');
  }

  // -------------------------------------------------------------------------
  // Infinite scroll helper
  // -------------------------------------------------------------------------

  function setupInfiniteScroll() {
    const wrap = document.getElementById('hcaTableWrap');
    if (!wrap) return;
    wrap.addEventListener('scroll', () => {
      if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 80) {
        if (_renderedCount < _filteredEntries.length) {
          const tbody = document.getElementById('hcaTableBody');
          if (tbody) renderRows(tbody, _allEntries.length);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // UI wiring
  // -------------------------------------------------------------------------

  function wireControls() {
    // Search
    const searchEl = document.getElementById('hcaSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        _searchText = searchEl.value.trim();
        applyFilters();
        rerenderTable();
        announce(`${_filteredEntries.length} results`);
      });
    }

    // Type filter
    const typeEl = document.getElementById('hcaFilterType');
    if (typeEl) {
      typeEl.addEventListener('change', () => {
        _filterType = typeEl.value;
        applyFilters();
        rerenderTable();
        announce(`Filtered to ${typeEl.options[typeEl.selectedIndex].text}. ${_filteredEntries.length} results.`);
      });
    }

    // Region filter
    const regionEl = document.getElementById('hcaFilterRegion');
    if (regionEl) {
      regionEl.addEventListener('change', () => {
        _filterRegion = regionEl.value;
        applyFilters();
        rerenderTable();
        announce(`Region filter: ${regionEl.options[regionEl.selectedIndex].text}. ${_filteredEntries.length} results.`);
      });
    }

    // Metric filter (sort by)
    const metricEl = document.getElementById('hcaSortMetric');
    if (metricEl) {
      metricEl.addEventListener('change', () => {
        _sortMetric = metricEl.value;
        applyFilters();
        rerenderTable();
        announce(`Sorted by ${metricEl.options[metricEl.selectedIndex].text}.`);
      });
    }

    // Column header sort
    const thead = document.getElementById('hcaTableHead');
    if (thead) {
      thead.addEventListener('click', (e) => {
        const th = e.target.closest('.hca-th.sortable');
        if (!th) return;
        const metric = th.dataset.metric;
        if (_sortMetric === metric) {
          _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          _sortMetric = metric;
          _sortDir = 'desc';
        }
        applyFilters();
        rerenderTable();
        announce(`Sorted by ${metric}, ${_sortDir === 'desc' ? 'highest first' : 'lowest first'}.`);
      });
      thead.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.target.click();
        }
      });
    }

    // Export
    const exportEl = document.getElementById('hcaExportBtn');
    if (exportEl) exportEl.addEventListener('click', exportCSV);

    // Quick presets
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = QUICK_PRESETS[btn.dataset.preset];
        if (!preset) return;
        preset();
        applyFilters();
        rerenderTable();
        // Update active state
        document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Sync selects
        const te = document.getElementById('hcaFilterType');
        const re = document.getElementById('hcaFilterRegion');
        if (te) te.value = _filterType;
        if (re) re.value = _filterRegion;
        announce(`View: ${btn.textContent.trim()}. ${_filteredEntries.length} results.`);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Scorecard coverage dashboard
  // -------------------------------------------------------------------------

  function renderScorecardCoverage() {
    const panel = document.getElementById('hcaScorecardCoverage');
    const bars  = document.getElementById('hcaCoverageBars');
    if (!panel || !bars || !Object.keys(_scorecardData).length) return;

    const total = Object.keys(_scorecardData).length;
    const dims = [
      { id: 'prop123_committed',     label: 'Prop 123 Committed' },
      { id: 'has_housing_authority',  label: 'Housing Authority' },
      { id: 'has_housing_nonprofits', label: 'Housing Nonprofits' },
      { id: 'has_hna',               label: 'Housing Needs Assessment' },
      { id: 'has_comp_plan',         label: 'Comprehensive Plan' },
      { id: 'has_iz_ordinance',      label: 'IZ Ordinance' },
      { id: 'has_local_funding',     label: 'Local Funding' },
    ];

    bars.innerHTML = dims.map(function (d) {
      var known = 0;
      for (var geoid in _scorecardData) {
        var v = _scorecardData[geoid].dimensions[d.id];
        if (v !== null && v !== undefined) known++;
      }
      var pct = Math.round(known / total * 100);
      return '<div class="hca-cov-row">' +
        '<span class="hca-cov-label">' + d.label + '</span>' +
        '<div class="hca-cov-bar-wrap"><div class="hca-cov-bar" style="width:' + pct + '%"></div></div>' +
        '<span class="hca-cov-pct">' + pct + '%</span>' +
        '</div>';
    }).join('');

    panel.style.display = '';
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  async function init() {
    const tbody = document.getElementById('hcaTableBody');
    if (!tbody) return;

    try {
      const data = await load();
      renderKpis(_metadata);
      applyFilters();
      rerenderTable();
      wireControls();
      setupInfiniteScroll();
      renderScorecardCoverage();
      announce(`Loaded ${_allEntries.length} geographies.`);
    } catch (err) {
      console.error('[HNARanking] Failed to load ranking data:', err);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="12" class="hca-empty">
          Unable to load ranking data. <a href="${DATA_PATH}">Try loading directly</a>.
        </td></tr>`;
      }
      announce('Error loading ranking data.');
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  window.HNARanking = {
    init,
    load,
    sortEntries,
    applyFilters,
    exportCSV,
    getScorecardData: function () { return _scorecardData; },
    // Exposed for testing
    _get: () => ({
      allEntries:      _allEntries,
      filteredEntries: _filteredEntries,
      sortMetric:      _sortMetric,
      sortDir:         _sortDir,
      filterType:      _filterType,
      filterRegion:    _filterRegion,
      searchText:      _searchText,
      metadata:        _metadata,
    }),
    _set: (overrides) => {
      if (overrides.allEntries  !== undefined) _allEntries      = overrides.allEntries;
      if (overrides.sortMetric  !== undefined) _sortMetric      = overrides.sortMetric;
      if (overrides.sortDir     !== undefined) _sortDir         = overrides.sortDir;
      if (overrides.filterType  !== undefined) _filterType      = overrides.filterType;
      if (overrides.filterRegion !== undefined) _filterRegion   = overrides.filterRegion;
      if (overrides.searchText  !== undefined) _searchText      = overrides.searchText;
      if (overrides.metadata    !== undefined) _metadata        = overrides.metadata;
    },
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
