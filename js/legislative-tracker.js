/**
 * js/legislative-tracker.js
 * Legislative Bill Status Tracker — Phase 3 (Epic #444)
 *
 * Tracks status and impact of key affordable housing bills:
 *   - H.R. 6644 (Housing for the 21st Century Act)
 *   - AHCIA (Affordable Housing Credit Improvement Act)
 *   - S.XXXX (Senate ROAD Act)
 *   - CRA Modernization provisions
 *
 * Provides:
 *   - Bill status data with stage/timeline annotations
 *   - Impact scoring for LIHTC demand and investor base
 *   - CRA targeting signals by census tract category
 *   - Structured data for dashboard rendering
 *
 * Exposed as window.LegislativeTracker (browser) and module.exports (Node/test).
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore next */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.LegislativeTracker = factory(root);
  }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ── Bill stage constants ────────────────────────────────────────── */

  var STAGES = {
    INTRODUCED:        'Introduced',
    COMMITTEE:         'In Committee',
    HOUSE_PASSED:      'Passed House',
    SENATE_COMMITTEE:  'Senate Committee',
    SENATE_PASSED:     'Passed Senate',
    CONFERENCE:        'Conference Committee',
    ENROLLED:          'Enrolled / Sent to President',
    SIGNED:            'Signed into Law',
    FAILED:            'Failed / Died in Committee'
  };

  var STAGE_ORDER = [
    STAGES.INTRODUCED,
    STAGES.COMMITTEE,
    STAGES.HOUSE_PASSED,
    STAGES.SENATE_COMMITTEE,
    STAGES.SENATE_PASSED,
    STAGES.CONFERENCE,
    STAGES.ENROLLED,
    STAGES.SIGNED
  ];

  /* ── Data-backed watchlist ───────────────────────────────────────── */

  var BILLS = [];

  function _stageFromStatus(status) {
    if (status === 'enacted') return STAGES.SIGNED;
    if (status === 'proposed' || status === 'rule-pending') return STAGES.COMMITTEE;
    if (status === 'phased-out' || status === 'expired') return STAGES.FAILED;
    return STAGES.INTRODUCED;
  }

  function _scoreForScope(scope, status) {
    if (status === 'expired') return 0;
    if (scope === 'lihtc') return status === 'enacted' ? 8 : 6;
    if (scope === 'cra') return status === 'proposed' ? 5 : 7;
    if (scope === 'nmtc' || scope === 'htc' || scope === 'itc-ptc') return status === 'enacted' ? 6 : 4;
    if (scope === 'homebuyer') return status === 'proposed' ? 4 : 3;
    return 2;
  }

  function _tagsForEntry(entry) {
    var tags = [];
    if (entry.scope) tags.push(String(entry.scope).toUpperCase());
    if (entry.status) tags.push(entry.status);
    if (/lihtc/i.test(entry.title || '')) tags.push('LIHTC');
    if (/cra/i.test(entry.title || '')) tags.push('CRA');
    if (/home|buyer|neighborhood/i.test(entry.title || '')) tags.push('homebuyer');
    return tags.filter(function (tag, idx) { return tags.indexOf(tag) === idx; });
  }

  function _impactForEntry(entry, scope) {
    var score = _scoreForScope(scope, entry.status);
    var impact = {
      score: score,
      description: entry.pricing_impact || '',
      provisions: [
        entry.title,
        entry.source_note || entry.source_url
      ].filter(Boolean)
    };
    if (scope === 'lihtc') return { lihtcImpact: impact, craImpact: null };
    if (scope === 'cra') return { lihtcImpact: null, craImpact: impact };
    return { lihtcImpact: impact, craImpact: null };
  }

  function _normalizeEntry(entry) {
    var stage = _stageFromStatus(entry.status);
    var scope = entry.scope || 'tax-credit';
    var impacts = _impactForEntry(entry, scope);
    return Object.assign({
      id: entry.id,
      title: entry.title,
      shortTitle: entry.id,
      stage: stage,
      effectiveDate: entry.effective_date || null,
      sunsetDate: entry.sunset_date || null,
      lastUpdated: entry.last_verified || entry.effective_date || null,
      summary: entry.pricing_impact || '',
      sourceUrl: entry.source_url || null,
      sourceNote: entry.source_note || null,
      tags: _tagsForEntry(entry)
    }, impacts);
  }

  function setLegislationData(doc) {
    var entries = doc && Array.isArray(doc.entries) ? doc.entries : [];
    BILLS = entries.map(_normalizeEntry).filter(function (entry) {
      return entry.id && entry.title;
    });
    return getAllBills();
  }

  function loadLegislationData(url, fetchImpl) {
    var fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    var target = url || 'data/policy/tax-credit-legislation.json';
    if (!fetcher) return Promise.resolve(getAllBills());
    return fetcher(target)
      .then(function (r) { return r && r.ok !== false && typeof r.json === 'function' ? r.json() : null; })
      .then(function (doc) { return doc ? setLegislationData(doc) : getAllBills(); })
      .catch(function () { return getAllBills(); });
  }

  /* ── Impact scoring helpers ──────────────────────────────────────── */

  function _stageProgress(stage) {
    var idx = STAGE_ORDER.indexOf(stage);
    if (idx === -1) return 0;
    return Math.round((idx / (STAGE_ORDER.length - 1)) * 100);
  }

  function _passageProbability(bill) {
    var progress = _stageProgress(bill.stage);
    // Conference committee = ~80% passage probability for bipartisan bills
    if (bill.stage === STAGES.CONFERENCE)        return bill.houseVote ? 85 : 70;
    if (bill.stage === STAGES.ENROLLED)          return 98;
    if (bill.stage === STAGES.SIGNED)            return 100;
    if (bill.stage === STAGES.FAILED)            return 0;
    if (bill.stage === STAGES.SENATE_PASSED)     return 90;
    if (bill.stage === STAGES.HOUSE_PASSED)      return 65;
    if (bill.stage === STAGES.SENATE_COMMITTEE)  return 55;
    if (bill.stage === STAGES.COMMITTEE)         return 35;
    return 20; // Introduced
  }

  function _combinedImpactScore(bill) {
    var lihtc = bill.lihtcImpact ? bill.lihtcImpact.score : 0;
    var cra   = bill.craImpact   ? bill.craImpact.score   : 0;
    return Math.round((lihtc + cra) / (bill.lihtcImpact && bill.craImpact ? 2 : 1));
  }

  /* ── CRA targeting by tract type ────────────────────────────────── */

  var CRA_TRACT_TARGETS = {
    lmi: {
      label:       'Low-to-Moderate Income Tract',
      craWeight:   'high',
      description: 'Investments in LMI census tracts receive maximum CRA examination credit. ' +
                   'LIHTC projects here have highest CRA motivation for bank equity.',
      lihtcSynergy: 'very-high'
    },
    distressed: {
      label:       'Distressed or Underserved Tract',
      craWeight:   'high',
      description: 'Distressed tracts receive enhanced CRA credit. Often overlap with QCT/DDA designations.',
      lihtcSynergy: 'high'
    },
    rural: {
      label:       'Rural Tract',
      craWeight:   'moderate',
      description: 'Rural tracts receive CRA credit under community development definition. ' +
                   'ROAD Act provisions enhance credit for rural LIHTC.',
      lihtcSynergy: 'moderate'
    },
    opportunity_zone: {
      label:       'Opportunity Zone',
      craWeight:   'moderate',
      description: 'OZ tracts may receive CRA credit for qualifying investments. ' +
                   'Dual CRA+OZ benefit possible for LIHTC projects.',
      lihtcSynergy: 'moderate-high'
    },
    non_lmi: {
      label:       'Non-LMI Tract',
      craWeight:   'low',
      description: 'Non-LMI tracts receive limited CRA credit. LIHTC projects here depend on ' +
                   'community development purpose for CRA examination credit.',
      lihtcSynergy: 'low'
    }
  };

  /* ── Public API ──────────────────────────────────────────────────── */

  /**
   * Get all bills with computed status fields.
   * @returns {Object[]} Array of bill objects with computed fields
   */
  function getAllBills() {
    return BILLS.map(function (bill) {
      return Object.assign({}, bill, {
        stageProgress:       _stageProgress(bill.stage),
        passageProbability:  _passageProbability(bill),
        combinedImpactScore: _combinedImpactScore(bill)
      });
    });
  }

  /**
   * Get a single bill by ID.
   * @param {string} id — Bill ID (e.g. 'HR6644', 'AHCIA')
   * @returns {Object|null}
   */
  function getBill(id) {
    var bills = getAllBills();
    for (var i = 0; i < bills.length; i++) {
      if (bills[i].id === id) return bills[i];
    }
    return null;
  }

  /**
   * Get bills filtered by tag.
   * @param {string} tag — Tag to filter by (e.g. 'LIHTC', 'CRA')
   * @returns {Object[]}
   */
  function getBillsByTag(tag) {
    return getAllBills().filter(function (b) {
      return b.tags && b.tags.indexOf(tag) !== -1;
    });
  }

  /**
   * Compute aggregate LIHTC and CRA market impact across all active bills.
   * @returns {Object} Aggregate impact summary
   */
  function getMarketImpactSummary() {
    var bills       = getAllBills();
    var activeBills = bills.filter(function (b) { return b.stage !== STAGES.FAILED; });

    var totalLihtcScore = 0;
    var totalCraScore   = 0;
    var lihtcProvisions = [];
    var craProvisions   = [];
    var count = 0;

    activeBills.forEach(function (bill) {
      var prob = bill.passageProbability / 100;
      if (bill.lihtcImpact) {
        totalLihtcScore += bill.lihtcImpact.score * prob;
        bill.lihtcImpact.provisions.forEach(function (p) { lihtcProvisions.push(p); });
      }
      if (bill.craImpact) {
        totalCraScore += bill.craImpact.score * prob;
        bill.craImpact.provisions.forEach(function (p) { craProvisions.push(p); });
      }
      count++;
    });

    return {
      activeBillCount:          count,
      weightedLihtcImpactScore: Math.round(totalLihtcScore * 10) / 10,
      weightedCraImpactScore:   Math.round(totalCraScore * 10) / 10,
      keyLihtcProvisions:       lihtcProvisions,
      keyCraProvisions:         craProvisions,
      marketOutlook:            totalLihtcScore >= 6
        ? 'Favorable — significant LIHTC expansion likely if legislation passes'
        : 'Moderate — incremental improvements expected'
    };
  }

  /**
   * Get CRA tract targeting analysis for a given tract type.
   * @param {string} tractType — One of: lmi, distressed, rural, opportunity_zone, non_lmi
   * @returns {Object|null}
   */
  function getCraTractTargeting(tractType) {
    return CRA_TRACT_TARGETS[tractType] || null;
  }

  /**
   * Get legislative timeline events sorted chronologically.
   * @returns {Object[]} Timeline entries
   */
  function getLegislativeTimeline() {
    return getAllBills().map(function (bill) {
      return {
        date: bill.effectiveDate || bill.lastUpdated || 'VERIFY',
        event: bill.title + ' - ' + bill.stage,
        billId: bill.id,
        stage: bill.stage,
        sourceUrl: bill.sourceUrl || null
      };
    }).sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }

  /* ── Constants exposed for testing ──────────────────────────────── */

  return {
    STAGES:                  STAGES,
    STAGE_ORDER:             STAGE_ORDER,
    setLegislationData:      setLegislationData,
    loadLegislationData:     loadLegislationData,
    getAllBills:              getAllBills,
    getBill:                 getBill,
    getBillsByTag:           getBillsByTag,
    getMarketImpactSummary:  getMarketImpactSummary,
    getCraTractTargeting:    getCraTractTargeting,
    getLegislativeTimeline:  getLegislativeTimeline,
    _stageProgress:          _stageProgress,
    _passageProbability:     _passageProbability
  };
}));
