/*
  prop123-historical-tracker.js
  Phase 3 — Historical Prop 123 compliance tracking helpers.

  Provides:
    - getHistoricalAffordableData(geoType, geoid)
    - calculateComplianceTrajectory(baseline, actuals, currentYear)
    - getDolaFilingDeadlines()
    - renderHistoricalComplianceChart(canvasId, baseline, actuals, currentYear)
    - renderDolaFilingStatus(containerId)

  Exposes helpers on window.Prop123Tracker for use by housing-needs-assessment.js
  and compliance-dashboard.js.
*/

(function () {
  'use strict';

  // Prop 123 constants
  // 2023 is the baseline year. The 2024–2026 cycle's goal is 3% of the
  // baseline per year in new or newly affordable homes — simple, not
  // compound (C.R.S. § 29-32-105(1)(a)). From 2027 HB26-1313 sets the goal
  // from building permits, so no target here runs past 2026.
  const PROP123_EFFECTIVE_YEAR = 2023;
  const PROP123_GROWTH_RATE    = 0.03;
  const PROP123_FIRST_CYCLE_END = 2026;

  // Commitments are due November 1 before the cycle they cover
  // (C.R.S. § 29-32-105(1)(d)): Nov 1, 2026 for 2027–2029, or Nov 1, 2027
  // or 2028 to join part-way. Month is 1-based here.
  const DOLA_FILING_MONTH = 11;  // November
  const DOLA_FILING_DAY   = 1;

  /** Target stock `i` years after the baseline year, capped at the cycle's 3 years. */
  function cycleTarget(baseline, i) {
    return Math.round(baseline * (1 + PROP123_GROWTH_RATE * Math.max(0, Math.min(i, PROP123_FIRST_CYCLE_END - PROP123_EFFECTIVE_YEAR))));
  }

  /**
   * Return a synthetic historical dataset for a geography.
   * In production this would load from cached ACS snapshots; here we return
   * the best available estimate from available data plus null placeholders for
   * future reporting years.
   *
   * @param {string} geoType  - 'county' | 'place' | 'cdp'
   * @param {string} geoid    - FIPS / place code
   * @param {number} baseline - baseline60Ami count from calculateBaseline()
   * @returns {{ years: number[], actuals: (number|null)[] }}
   */
  function getHistoricalAffordableData(geoType, geoid, baseline) {
    const today       = new Date();
    const currentYear = today.getFullYear();

    // Build year range: PROP123_EFFECTIVE_YEAR → current year
    const years   = [];
    const actuals = [];

    for (let y = PROP123_EFFECTIVE_YEAR; y <= Math.min(currentYear, PROP123_FIRST_CYCLE_END); y++) {
      years.push(y);
      if (y === PROP123_EFFECTIVE_YEAR) {
        // Baseline year — actual equals the baseline by definition
        actuals.push(typeof baseline === 'number' && baseline > 0 ? baseline : null);
      } else {
        // Subsequent years: try to load from user-supplied overrides stored in
        // sessionStorage (key: `prop123_actual_${geoid}_${y}`), otherwise null.
        const stored = (typeof sessionStorage !== 'undefined')
          ? sessionStorage.getItem('prop123_actual_' + geoid + '_' + y)
          : null;
        actuals.push(stored !== null ? Number(stored) : null);
      }
    }

    return { years, actuals };
  }

  /**
   * Compare actual affordable-unit counts against the 2024–2026 goal.
   *
   * @param {number}          baseline    - Baseline unit count (year 0)
   * @param {(number|null)[]} actuals     - Array of actual unit counts per year (index 0 = baseline year)
   * @param {number}          currentYear - e.g. 2026
   * @returns {{
   *   onTrack: boolean|null,
   *   yearsAhead: number,
   *   yearsOffTargetCount: number,
   *   gapAtCurrentYear: number,
   *   trendLine: number[],
   *   targets: number[]
   * }}
   */
  function calculateComplianceTrajectory(baseline, actuals, currentYear) {
    if (!Number.isFinite(baseline) || baseline <= 0) {
      return { onTrack: null, yearsAhead: 0, yearsOffTargetCount: 0, gapAtCurrentYear: 0, trendLine: [], targets: [] };
    }

    const startYear    = PROP123_EFFECTIVE_YEAR;
    const totalYears   = Math.min(currentYear, PROP123_FIRST_CYCLE_END) - startYear + 1;
    const targets      = [];
    const trendLine    = [];
    let yearsOffCount  = 0;
    let lastKnownActual = baseline;
    let lastKnownIdx    = 0;

    for (let i = 0; i < totalYears; i++) {
      const target = cycleTarget(baseline, i);
      targets.push(target);

      const actual = (actuals && i < actuals.length) ? actuals[i] : null;
      if (actual !== null && Number.isFinite(actual)) {
        lastKnownActual = actual;
        lastKnownIdx    = i;
        trendLine.push(actual);
        if (actual < target) yearsOffCount++;
      } else {
        trendLine.push(null);
      }
    }

    const latestTarget = targets[totalYears - 1];
    const gapAtCurrentYear = latestTarget - lastKnownActual;
    const onTrack = gapAtCurrentYear <= 0;

    // yearsAhead: how many years' worth of the goal (3% of the baseline
    // each) has been banked beyond the target (negative means behind)
    const yearStep   = baseline * PROP123_GROWTH_RATE;
    const yearsAhead = gapAtCurrentYear <= 0
      ? Math.floor(-gapAtCurrentYear / yearStep)
      : -Math.ceil(gapAtCurrentYear / yearStep);

    return {
      onTrack,
      yearsAhead,
      yearsOffTargetCount: yearsOffCount,
      gapAtCurrentYear,
      trendLine,
      targets,
    };
  }

  /**
   * Return the next Prop 123 commitment deadline (November 1).
   *
   * @param {Date} [now] - override for testing; defaults to today
   * @returns {{
   *   nextDeadline: string,      // ISO date "YYYY-MM-DD"
   *   filed: boolean,            // always false (runtime has no filing registry access)
   *   filingYear: number,        // first year the commitment filed by this deadline covers
   *   daysUntilDeadline: number
   * }}
   */
  function getDolaFilingDeadlines(now) {
    const today = now || new Date();
    const year  = today.getFullYear();

    // A commitment filed by Nov 1 covers the cycle (or the rest of it)
    // from the next Jan 1. Past this year's Nov 1, the next is next year's.
    const deadlineThisYear = new Date(year, DOLA_FILING_MONTH - 1, DOLA_FILING_DAY);
    const todayMidnight    = new Date(year, today.getMonth(), today.getDate());
    const isPastDeadline   = todayMidnight > deadlineThisYear;

    const deadlineYear   = isPastDeadline ? year + 1 : year;
    const filingYear     = deadlineYear + 1;
    const nextDeadline   = new Date(deadlineYear, DOLA_FILING_MONTH - 1, DOLA_FILING_DAY);
    const msPerDay       = 1000 * 60 * 60 * 24;
    const daysUntil      = Math.ceil((nextDeadline - todayMidnight) / msPerDay);

    const pad = (n) => String(n).padStart(2, '0');
    const isoDate = `${deadlineYear}-${pad(DOLA_FILING_MONTH)}-${pad(DOLA_FILING_DAY)}`;

    return {
      nextDeadline: isoDate,
      filed: false,
      filingYear,
      daysUntilDeadline: daysUntil,
    };
  }

  /**
   * Render the historical compliance line chart onto a <canvas> element.
   * Requires Chart.js to be loaded on the page.
   *
   * @param {string}  canvasId
   * @param {number}  baseline
   * @param {{years: number[], actuals: (number|null)[]}} historicalData
   * @param {number}  currentYear
   */
  function renderHistoricalComplianceChart(canvasId, baseline, historicalData, currentYear) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;

    const { years, actuals } = historicalData;
    const trajectory = calculateComplianceTrajectory(baseline, actuals, currentYear);
    const { targets, trendLine } = trajectory;

    // Extend labels to the end of the 2024–2026 cycle; HB26-1313 sets
    // later goals from building permits, so none is projected past it.
    const labels       = [...years];
    const targetSeries = [...targets];
    for (let futureYear = currentYear + 1; futureYear <= PROP123_FIRST_CYCLE_END; futureYear++) {
      labels.push(futureYear);
      targetSeries.push(cycleTarget(baseline, futureYear - PROP123_EFFECTIVE_YEAR));
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const tickColor = isDark ? '#9ca3af' : '#6b7280';

    // Destroy previous instance if present
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    new window.Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Goal (3% of baseline per year, 2024–2026)',
            data: targetSeries,
            borderColor: '#ef4444',
            backgroundColor: 'transparent',
            borderDash: [6, 3],
            pointRadius: 0,
            tension: 0.1,
          },
          {
            label: 'Actual Units',
            data: [...trendLine, ...Array(labels.length - trendLine.length).fill(null)],
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.12)',
            fill: false,
            pointRadius: 4,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: tickColor } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: {
            beginAtZero: false,
            ticks: { color: tickColor },
            grid:  { color: gridColor },
          },
        },
      },
    });
  }

  /**
   * Render the DOLA filing deadline status badge into a container element.
   *
   * @param {string} containerId - ID of the container element
   */
  function renderDolaFilingStatus(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const info     = getDolaFilingDeadlines();
    const urgency  = info.daysUntilDeadline <= 30 ? 'urgent' : 'normal';
    const icon     = info.filed ? '✅' : (urgency === 'urgent' ? '⚠️' : '📋');
    const statusTx = info.filed
      ? `Filed ${info.filingYear}`
      : `Due ${info.nextDeadline} (${info.daysUntilDeadline} days)`;

    el.innerHTML = '';
    const badge = document.createElement('div');
    badge.className = 'dola-filing-badge dola-filing-' + (info.filed ? 'filed' : urgency);
    const iconSpan = document.createElement('span');
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icon + ' ';
    const textSpan = document.createElement('span');
    textSpan.textContent = `Prop 123 commitment covering ${info.filingYear} on: ${statusTx}`;
    badge.appendChild(iconSpan);
    badge.appendChild(textSpan);
    el.appendChild(badge);
  }

  // Expose on window for use by other scripts
  window.Prop123Tracker = {
    getHistoricalAffordableData,
    calculateComplianceTrajectory,
    getDolaFilingDeadlines,
    renderHistoricalComplianceChart,
    renderDolaFilingStatus,
    PROP123_EFFECTIVE_YEAR,
    PROP123_GROWTH_RATE,
    PROP123_FIRST_CYCLE_END,
    DOLA_FILING_MONTH,
    DOLA_FILING_DAY,
  };
})();
