/**
 * js/soft-funding-tracker.js
 * Live Soft-Funding Tracker — Phase 2.1
 *
 * Displays current program availability, deadlines, and competitiveness
 * for soft-funding programs (CHFA HTF, DOLA HTF, HOME, local trust funds).
 * Data is manually updated quarterly from public program announcements.
 *
 * Non-goals:
 *   - Does NOT guarantee funds will be available — verify with program administrators
 *   - Does NOT pre-apply or submit applications
 *   - Does NOT perform real-time API calls — all data is from local JSON
 *
 * Usage:
 *   SoftFundingTracker.load(softFundingData).then(function () {
 *     var result = SoftFundingTracker.check('08013', 2026);
 *   });
 *
 * Exposed as window.SoftFundingTracker (browser) and module.exports (Node).
 *
 * @typedef {Object} FundingCheckResult
 * @property {number|null}  available       — published remaining dollars, or unknown
 * @property {string}       program         — program name
 * @property {string|null}  deadline        — ISO date string or null
 * @property {number|null}  daysRemaining   — calendar days to deadline
 * @property {string}       competitiveness — 'high'|'moderate'|'low'
 * @property {string}       narrative       — human-readable summary
 * @property {number|null}  confidence      — 0–1 likelihood estimate, unknown without a balance
 * @property {string|null}  warning         — warning message or null
 * @property {Array<Object>} programs       — all matching programs for this county
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SoftFundingTracker = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────── */
  var _programs   = {};
  var _lastUpdated = null;
  var _loaded     = false;

  /* ── Helpers ─────────────────────────────────────────────────────── */

  /** Days between now and a deadline string (YYYY-MM-DD). */
  function _daysToDeadline(deadlineStr, refDate) {
    if (!deadlineStr) return null;
    var deadline = new Date(deadlineStr + 'T00:00:00Z');
    var now = refDate ? new Date(refDate) : new Date();
    var diff = deadline - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  // An unpublished balance cannot become measured exhaustion or a scored input.
  function _amount(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null;
  }

  function _compareAvailability(a, b) {
    var left = _amount(a);
    var right = _amount(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return right - left;
  }

  /** Build confidence score from availability and deadline proximity. */
  function _computeConfidence(prog) {
    if (!prog || _amount(prog.available) === null) return null;
    var capacity = _amount(prog.capacity);
    var awarded = _amount(prog.awarded);
    var utilization = capacity > 0 && awarded !== null ? awarded / capacity : null;
    var avail = prog.available;

    var conf = 0.85;
    // Reduce if nearly exhausted
    if (utilization > 0.85) conf -= 0.3;
    else if (utilization > 0.70) conf -= 0.15;

    // Reduce if no funds available
    if (avail <= 0) conf = 0.05;

    // Reduce if deadline is very close
    var days = _daysToDeadline(prog.deadline);
    if (days !== null && days < 30) conf -= 0.2;
    else if (days !== null && days < 60) conf -= 0.1;

    return Math.max(0, Math.min(1, parseFloat(conf.toFixed(2))));
  }

  /** Format dollar amount for display. */
  function _fmtDollars(n) {
    if (_amount(n) === null) return 'Balance not published';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }

  /** Build narrative for a matched program. */
  function _buildNarrative(prog, days) {
    if (_amount(prog.available) === null) {
      return prog.name + ': Balance not published; verify with the program administrator.';
    }
    var parts = [prog.name + ' has ' + _fmtDollars(prog.available) + ' remaining'];
    if (days !== null && days > 0) {
      parts.push('deadline in ' + days + ' day' + (days !== 1 ? 's' : ''));
    } else if (days !== null && days <= 0) {
      parts.push('⚠️ deadline may have passed');
    }
    if (prog.available <= 0) {
      return prog.name + ': No funds currently available. Watch for next allocation.';
    }
    return parts.join('; ') + '.';
  }

  /* ── Program matching ────────────────────────────────────────────── */

  /**
   * Find programs available for a given county FIPS.
   * "All" county programs are always included.
   */
  function _matchPrograms(countyFips) {
    var fips = typeof countyFips === 'string' ? countyFips.padStart(5, '0') : null;
    var results = [];
    Object.keys(_programs).forEach(function (key) {
      var prog = _programs[key];
      if (prog.status === 'closed') return;
      if (prog.county === 'All' || prog.county === fips) {
        results.push({ key: key, program: prog });
      }
    });
    return results;
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Load soft-funding program data.
   * @param {Object} fundingData — parsed soft-funding-status.json
   * @returns {Promise<void>}
   */
  function load(fundingData) {
    if (fundingData && fundingData.programs) {
      _programs = fundingData.programs;
    }
    if (fundingData && fundingData.lastUpdated) {
      _lastUpdated = fundingData.lastUpdated;
    }
    _loaded = true;
    return Promise.resolve();
  }

  /**
   * Check soft funding availability for a county and year.
   *
   * @param {string} countyFips  - 5-digit FIPS (e.g. '08013')
   * @param {number} [year]      - Target fiscal year (defaults to current year)
   * @param {number} [projectNeed] - Estimated project soft funding need ($)
   * @returns {FundingCheckResult}
   */
  function check(countyFips, year, projectNeed) {
    var matches = _matchPrograms(countyFips);

    if (!matches.length) {
      return {
        available:      null,
        unavailableReason: 'no_programs_found',
        program:        'No programs found',
        deadline:       null,
        daysRemaining:  null,
        competitiveness:'low',
        narrative:      'No active soft-funding programs identified for this county.',
        confidence:     null,
        warning:        'Verify with CHFA and local housing office.',
        programs:       []
      };
    }

    // Sort: prefer county-specific, then by availability
    matches.sort(function (a, b) {
      var aSpecific = a.program.county !== 'All' ? 1 : 0;
      var bSpecific = b.program.county !== 'All' ? 1 : 0;
      if (bSpecific !== aSpecific) return bSpecific - aSpecific;
      return _compareAvailability(a.program.available, b.program.available);
    });

    var best   = matches[0].program;
    var days   = _daysToDeadline(best.deadline);
    var conf   = _computeConfidence(best);
    var narrative = _buildNarrative(best, days);

    // Warning conditions
    var warning = best.warning || null;
    if (!warning && _amount(best.available) === 0) {
      warning = 'No funds currently available in this program.';
    }
    if (!warning && days !== null && days < 45) {
      warning = 'Deadline approaching — ' + days + ' days remaining.';
    }

    // Project need check
    if (typeof projectNeed === 'number' && projectNeed > 0 && best.available > 0) {
      if (projectNeed > best.available) {
        warning = (warning ? warning + ' ' : '') +
          'Your estimated need (' + _fmtDollars(projectNeed) + ') exceeds current availability.';
      }
    }

    var allPrograms = matches.map(function (m) {
      return {
        key:           m.key,
        name:          m.program.name,
        available:     _amount(m.program.available),
        unavailableReason: _amount(m.program.available) === null ? 'balance_not_published' : null,
        deadline:      m.program.deadline || null,
        daysRemaining: _daysToDeadline(m.program.deadline),
        competitiveness: m.program.competitiveness || 'moderate',
        maxPerProject: m.program.maxPerProject || null,
        warning:       m.program.warning || null,
        confidence:    _computeConfidence(m.program)
      };
    });

    return {
      available:      _amount(best.available),
      unavailableReason: _amount(best.available) === null ? 'balance_not_published' : null,
      program:        best.name,
      deadline:       best.deadline || null,
      daysRemaining:  days,
      competitiveness: best.competitiveness || 'moderate',
      narrative:      narrative,
      confidence:     conf,
      warning:        warning,
      lastUpdated:    _lastUpdated,
      programs:       allPrograms
    };
  }

  /**
   * Returns the last updated date string.
   * @returns {string|null}
   */
  function getLastUpdated() {
    return _lastUpdated;
  }

  /**
   * Returns true if data has been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return _loaded;
  }

  /* ── Extended API: execution-type filtering ────────────────────── */

  /**
   * Return all eligible programs for a county + execution type (9%, 4%, non-LIHTC).
   * Filters out exhausted market-source placeholders and volume-cap entries
   * unless specifically requested.
   *
   * @param {string} countyFips    — 5-digit FIPS
   * @param {string} executionType — '9%' | '4%' | 'non-LIHTC'
   * @param {Object} [opts]
   * @param {boolean} [opts.includeMarket]   — include OZ, NMTC, TIF (default false)
   * @param {boolean} [opts.includeVolumeCap] — include PAB row (default false)
   * @returns {Array<Object>} sorted by available descending
   */
  function getEligiblePrograms(countyFips, executionType, opts) {
    opts = opts || {};
    var fips = typeof countyFips === 'string' ? countyFips.padStart(5, '0') : null;
    var results = [];

    Object.keys(_programs).forEach(function (key) {
      var prog = _programs[key];

      // Closed rounds are catalog history, not currently eligible sources.
      if (prog.status === 'closed') return;

      // County match
      if (prog.county !== 'All' && prog.county !== 'Selected' && prog.county !== fips) return;

      // Execution type match
      var eligible = prog.eligibleExecution || [];
      if (executionType && eligible.indexOf(executionType) === -1) return;

      // Skip market sources unless requested
      if (prog.isMarketSource && !opts.includeMarket) return;

      // Skip volume cap unless requested
      if (prog.isVolumeCap && !opts.includeVolumeCap) return;

      var days = _daysToDeadline(prog.deadline);
      results.push({
        key:              key,
        name:             prog.name,
        available:        _amount(prog.available),
        unavailableReason: _amount(prog.available) === null ? 'balance_not_published' : null,
        awarded:          _amount(prog.awarded),
        capacity:         _amount(prog.capacity),
        maxPerProject:    prog.maxPerProject || null,
        deadline:         prog.deadline || null,
        daysRemaining:    days,
        competitiveness:  prog.competitiveness || 'moderate',
        adminEntity:      prog.adminEntity || null,
        amiTargeting:     prog.amiTargeting || null,
        warning:          prog.warning || null,
        note:             prog.note || null,
        confidence:       _computeConfidence(prog),
        contactUrl:       prog.contactUrl || null,
        description:      prog.description || '',
        restrictions:     Array.isArray(prog.restrictions) ? prog.restrictions.slice() : []
      });
    });

    // Sort: available funds descending, then by deadline proximity
    results.sort(function (a, b) {
      return _compareAvailability(a.available, b.available);
    });

    return results;
  }

  /**
   * Return PAB volume cap status for the current year.
   * @returns {Object|null}
   */
  function getPabStatus() {
    var pab = _programs['PAB-CO'];
    if (!pab) return null;
    return {
      totalCap:     _amount(pab.capacity),
      committed:    _amount(pab.awarded),
      remaining:    _amount(pab.available),
      pctCommitted: _amount(pab.capacity) > 0 && _amount(pab.awarded) !== null
        ? Math.round(pab.awarded / pab.capacity * 100) : null,
      unavailableReason: _amount(pab.available) === null ? 'balance_not_published' : null,
      warning:      pab.warning || null,
      deadline:     pab.deadline || null
    };
  }

  /**
   * Compute total eligible soft funding for a county + execution type.
   * Sums available amounts from all matching programs (excluding market & volume cap).
   *
   * @param {string} countyFips
   * @param {string} executionType
   * @returns {{total: number|null, programCount: number, programs: Array, unavailableReason: string|null}}
   */
  function sumEligible(countyFips, executionType) {
    var progs = getEligiblePrograms(countyFips, executionType);
    var reason = !progs.length ? 'no_programs_found'
      : progs.some(function (p) { return p.available === null; }) ? 'balance_not_published' : null;
    var total = reason ? null : progs.reduce(function (sum, p) { return sum + p.available; }, 0);
    return {
      total: total,
      unavailableReason: reason,
      programCount: progs.length,
      programs: progs
    };
  }

  return {
    load:                 load,
    check:                check,
    getLastUpdated:       getLastUpdated,
    isLoaded:             isLoaded,
    getEligiblePrograms:  getEligiblePrograms,
    getPabStatus:         getPabStatus,
    sumEligible:          sumEligible,
    /* Exposed for testing */
    _daysToDeadline:      _daysToDeadline,
    _computeConfidence:   _computeConfidence,
    _fmtDollars:          _fmtDollars
  };
}));
