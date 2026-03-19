/**
 * js/hna/hna-narratives.js
 * Responsibility: Text generation for compliance timelines, jurisdiction status, and report copy blocks.
 * Dependencies: window.__HNA_STATE (constants via _S)
 * Exposes: window.__HNA_NARRATIVES (calculateFastTrackTimeline, getJurisdictionComplianceStatus, generateComplianceReport)
 */
(function () {
  'use strict';
  var _S = window.__HNA_STATE;

  function calculateFastTrackTimeline(projectUnits, ami_pct, jurisdiction_type) {
    const units  = Number(projectUnits);
    const ami    = Number(ami_pct);

    // Standard local review cycle (per HB 22-1093 legislative findings, 180–365 days)
    const standardDays  = 270;  // median estimate
    // HB 22-1093 expedited timeline (45–90 days)
    const fastTrackDays = 60;   // typical with complete application

    const conditions = [];
    let eligible = true;

    if (!Number.isFinite(ami) || ami > 60) {
      eligible = false;
      conditions.push('Project must serve households at 60% AMI or below');
    } else {
      conditions.push('✅ 60% AMI or below — meets income targeting requirement');
    }

    if (!Number.isFinite(units) || units < 1) {
      eligible = false;
      conditions.push('At least 1 affordable unit required');
    } else {
      conditions.push(`✅ ${units} unit(s) proposed`);
    }

    // Only counties/municipalities that have filed a Prop 123 commitment are eligible
    const eligibleTypes = ['county', 'place'];
    if (!eligibleTypes.includes(jurisdiction_type)) {
      eligible = false;
      conditions.push('Jurisdiction must be a county or incorporated municipality with a filed commitment');
    } else {
      conditions.push('✅ Eligible jurisdiction type (' + jurisdiction_type + ')');
    }

    conditions.push('Must provide proper advance notice to DOLA (per statute)');
    conditions.push('Must comply with DOLA expedited process guidance');

    const savedDays   = standardDays - fastTrackDays;
    const savedMonths = Math.round(savedDays / 30);
    const savings     = savedMonths + ' month' + (savedMonths !== 1 ? 's' : '');

    return { standardDays, fastTrackDays, timelineSavings: savings, eligible, conditions };
  }

  /**
   * Get jurisdiction-level compliance status (single geography).
   * Delegates to Prop123Tracker if loaded, otherwise computes inline.
   *
   * @param {string} geoid
   * @param {string} geoType
   * @param {object|null} profile - ACS profile
   * @returns {{
   *   baseline: number|null,
   *   current: number|null,
   *   target: number|null,
   *   pctComplete: number|null,
   *   status: string,
   *   lastFiled: string|null
   * }}
   */
  function getJurisdictionComplianceStatus(geoid, geoType, profile) {
    const baselineData = window.__HNA_UTILS.calculateBaseline(profile);
    if (!baselineData) {
      return { baseline: null, current: null, target: null, pctComplete: null, status: 'no-data', lastFiled: null };
    }

    const baseline    = baselineData.baseline60Ami;
    const currentYear = new Date().getFullYear();
    const yearsIn     = currentYear - 2023;
    const target      = Math.round(baseline * Math.pow(1 + _S.PROP123_GROWTH_RATE, yearsIn));

    // Check for user-supplied actuals in sessionStorage
    const storedKey = 'prop123_actual_' + geoid + '_' + currentYear;
    const stored    = (typeof sessionStorage !== 'undefined')
      ? sessionStorage.getItem(storedKey)
      : null;
    const current   = stored !== null ? Number(stored) : baseline; // fallback: assume at baseline
    const pct       = target > 0 ? Math.round((current / target) * 100) : null;

    let status;
    if (pct === null) {
      status = 'no-data';
    } else if (current >= target) {
      status = 'on-track';
    } else if (current >= target * 0.90) {
      status = 'at-risk';
    } else {
      status = 'off-track';
    }

    return { baseline, current, target, pctComplete: pct, status, lastFiled: null };
  }

  /**
   * Generate a CSV string for compliance report across a list of jurisdiction objects.
   * Each item: { geoid, name, population, baseline, current, target, status, lastFiled }
   *
   * @param {object[]} rows
   * @returns {string} CSV content
   */
  function generateComplianceReport(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const headers = ['geoid', 'name', 'population', 'baseline', 'current', 'target', 'pct_complete', 'status', 'last_filed'];
    const escape  = (v) => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const lines = [headers.join(',')];
    rows.forEach((r) => {
      lines.push([
        r.geoid, r.name, r.population,
        r.baseline, r.current, r.target,
        r.pctComplete, r.status, r.lastFiled,
      ].map(escape).join(','));
    });
    return lines.join('\n');
  }

  window.__HNA_NARRATIVES = {
    calculateFastTrackTimeline: calculateFastTrackTimeline,
    getJurisdictionComplianceStatus: getJurisdictionComplianceStatus,
    generateComplianceReport: generateComplianceReport,
  };

})();
