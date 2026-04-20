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
    module.exports = factory();
  } else {
    root.LegislativeTracker = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
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

  /* ── Bill database ───────────────────────────────────────────────── */

  var BILLS = [
    {
      id:          'HR6644',
      title:       'Housing for the 21st Century Act',
      shortTitle:  'H.R. 6644',
      stage:       STAGES.CONFERENCE,
      houseVote:   '390-9',
      targetPassage: 'Q2 2026',
      lastUpdated: '2026-04-03',
      summary:     'Sweeping bipartisan housing reform incorporating 43 individual bills, ' +
                   'including AHCIA LIHTC improvements, FHA limit increases, and NEPA streamlining. ' +
                   'Conference committee is reconciling House and Senate versions; final vote expected Q2 2026.',
      lihtcImpact: {
        score:       9,
        description: 'Direct LIHTC credit amount increase (+12.5%), expanded basis boost eligibility, ' +
                     'FHA limit increases improving 4% deal feasibility.',
        provisions:  [
          'AHCIA: 12.5% increase in LIHTC credit allocation',
          'FHA multifamily loan limit increases',
          'NEPA streamlining (3–6 month savings)',
          'Income averaging expansion'
        ]
      },
      craImpact: {
        score:       7,
        description: 'Expands CRA credit for LIHTC investments, broadens eligible institution types.',
        provisions:  [
          'LIHTC investments receive enhanced CRA examination weight',
          'Credit union CRA-equivalent provisions included'
        ]
      },
      tags: ['LIHTC', 'CRA', 'FHA', 'NEPA', 'bipartisan']
    },
    {
      id:          'AHCIA',
      title:       'Affordable Housing Credit Improvement Act',
      shortTitle:  'AHCIA 2025',
      stage:       STAGES.CONFERENCE,
      lastUpdated: '2026-04-03',
      summary:     'Standalone bill incorporated into H.R. 6644. Increases LIHTC allocations, ' +
                   'expands income averaging, and improves 4% credit feasibility. ' +
                   'Key provisions being finalized in conference committee.',
      lihtcImpact: {
        score:       10,
        description: 'Core LIHTC improvement legislation — largest credit enhancement in a decade.',
        provisions:  [
          '12.5% increase in state LIHTC ceiling',
          'Income averaging election for mixed-income projects',
          'Right of first refusal expansion',
          'Rural and native area set-asides'
        ]
      },
      craImpact: null,
      tags: ['LIHTC', 'income-averaging', 'rural']
    },
    {
      id:          'ROAD',
      title:       'Revitalizing Opportunities for America\'s Development Act',
      shortTitle:  'ROAD Act',
      stage:       STAGES.SENATE_COMMITTEE,
      lastUpdated: '2026-03-22',
      summary:     'Senate companion to H.R. 6644. Referred to Senate Banking Committee with rural housing ' +
                   'provisions and community development focus. Expected to advance after conference reconciliation.',
      lihtcImpact: {
        score:       7,
        description: 'Complements AHCIA with rural set-asides and community development area targeting.',
        provisions:  [
          'Enhanced rural LIHTC targeting',
          'Community development financial institution (CDFI) integration',
          'Opportunity zone and LIHTC coordination'
        ]
      },
      craImpact: {
        score:       8,
        description: 'Significant CRA modernization provisions for bank and credit union participation.',
        provisions:  [
          'CRA credit for rural LIHTC equity',
          'Credit union CRA equivalency framework',
          'Digital banking CRA assessment guidance'
        ]
      },
      tags: ['CRA', 'rural', 'CDFI', 'Senate']
    },
    {
      id:          'CRA-MOD',
      title:       'Community Reinvestment Act Modernization Provisions',
      shortTitle:  'CRA Modernization',
      stage:       STAGES.CONFERENCE,
      lastUpdated: '2026-04-01',
      summary:     'Embedded CRA reform provisions across H.R. 6644 and ROAD Act. ' +
                   'Expands CRA to insurance companies and FinTech lenders for LIHTC investments. ' +
                   'Conference committee finalizing scope of institution coverage.',
      lihtcImpact: {
        score:       8,
        description: 'Expands investor base for LIHTC equity by broadening CRA incentives to non-bank entities.',
        provisions:  [
          'Insurance company LIHTC investments receive CRA-equivalent credit',
          'FinTech lenders included in CRA assessment',
          'LIHTC equity counts double in CRA examination'
        ]
      },
      craImpact: {
        score:       10,
        description: 'Most significant CRA reform since 1977 — expands eligible institutions and updates digital banking rules.',
        provisions:  [
          'All financial institutions with >$10B AUM subject to CRA',
          'Insurance company CRA-like requirements',
          'Digital banking geographic assessment update',
          'Enhanced examination weighting for LIHTC investments'
        ]
      },
      tags: ['CRA', 'insurance', 'fintech', 'investor-base']
    }
  ];

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
    return [
      { date: '2025-09-12', event: 'AHCIA 2025 introduced in House and Senate', billId: 'AHCIA', stage: STAGES.INTRODUCED },
      { date: '2025-11-05', event: 'H.R. 6644 introduced incorporating 43 bills', billId: 'HR6644', stage: STAGES.INTRODUCED },
      { date: '2026-01-15', event: 'ROAD Act introduced in Senate', billId: 'ROAD', stage: STAGES.INTRODUCED },
      { date: '2026-01-28', event: 'H.R. 6644 passes House Financial Services Committee', billId: 'HR6644', stage: STAGES.COMMITTEE },
      { date: '2026-02-09', event: 'H.R. 6644 passes House 390-9 — strongest housing vote in a decade', billId: 'HR6644', stage: STAGES.HOUSE_PASSED },
      { date: '2026-02-15', event: 'Conference committee convened to reconcile H.R. 6644 and ROAD Act', billId: 'HR6644', stage: STAGES.CONFERENCE },
      { date: '2026-04-03', event: 'Conference committee continues markup; LIHTC 12.5% increase retained in draft report', billId: 'HR6644', stage: STAGES.CONFERENCE },
      { date: '2026-Q2',    event: 'Target: Conference report released and final vote expected', billId: 'HR6644', stage: STAGES.ENROLLED, projected: true },
      { date: '2026-Q3',    event: 'Target: President signature and implementation begins', billId: 'HR6644', stage: STAGES.SIGNED, projected: true }
    ];
  }

  /* ── Constants exposed for testing ──────────────────────────────── */

  return {
    STAGES:                  STAGES,
    STAGE_ORDER:             STAGE_ORDER,
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
