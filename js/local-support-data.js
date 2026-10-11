/**
 * js/local-support-data.js
 * Local support for affordable housing: the evidence a jurisdiction has
 * planned for it and voted for it, and the small Opportunity Finder bonus
 * that evidence earns.
 *
 * It reads three hand-verified files:
 *   data/policy/local-support.json        adopted plans and council / commission votes
 *   data/policy/fee-reductions.json       fee relief (entries) and land-use incentives (land_use)
 *   data/policy/local-housing-funds.json  dedicated funds, taxes, linkage fees, land tools
 * and data/policy/incentive-coverage.json for who was checked for incentives.
 *
 * The bonus is up to +6 points, in three parts of 2 (BONUS_PARTS):
 *   plans       an adopted plan or HNA with affordable-housing goals, within 5 years
 *   incentives  a standing fee reduction, a land-use incentive or a dedicated fund
 *   council     a recorded approval by the governing body or planning commission, within 3 years
 * A part with no counted evidence adds 0. A jurisdiction nobody has checked
 * therefore scores exactly what it scored before: unknown is never a penalty,
 * and never a reward. Denials are shown, not scored.
 *
 * Nothing counts twice. Inclusionary zoning and the Prop 123 filing are never
 * counted here: the Civic component scores both. A plan is not counted when
 * Civic already credits the place with an HNA or comprehensive plan, and a
 * local fund is not counted when Civic already credits local funding; that
 * evidence is still listed, marked as credited in Civic.
 *
 * No DOM, no fetch, no clock: the caller passes `today`, so the page and the
 * tests get the same answer for the same date.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LocalSupportData = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var POINTS_PER_PART = 2;
  var BONUS_PARTS = ['plans', 'incentives', 'council'];
  var MAX_BONUS = POINTS_PER_PART * BONUS_PARTS.length;
  var PLAN_WINDOW_YEARS = 5;
  var ACTION_WINDOW_MONTHS = 36;

  // Fee measures that lower what a project pays to build. A deferral is still
  // owed, and a utility-rate discount is an operating cost, so neither counts.
  var COUNTED_FEE_MEASURES = { waived: true, reduced: true, reimbursed: true };
  // Counted by Civic already (has_iz_ordinance).
  var EXCLUDED_LAND_USE = { inclusionary_zoning: true };
  var APPROVAL_OUTCOMES = { approved: true, adopted: true, recommended_approval: true };

  var PART_LABELS = {
    plans: 'Adopted housing plan',
    incentives: 'Incentives and local funding',
    council: 'Council and planning commission record'
  };

  var TYPE_LABELS = {
    housing_needs_assessment: 'Housing needs assessment',
    housing_plan: 'Housing plan or strategy',
    comp_plan_housing: 'Comprehensive plan housing goals',
    project_approval: 'Affordable project approval',
    rezoning_approval: 'Rezoning for affordable housing',
    land_contribution: 'Land contributed for affordable housing',
    funding_award: 'Local funding award',
    fee_waiver_approval: 'Fee waiver approval',
    housing_policy_adoption: 'Housing policy adopted',
    commission_recommendation: 'Planning commission recommendation',
    denial: 'Affordable project denied'
  };

  // City-and-county governments are one jurisdiction with two geoids.
  var CONSOLIDATED = { '08031': '0820000', '08014': '0809280' };
  function canonicalGeoid(geoid) { return CONSOLIDATED[geoid] || geoid; }

  /** 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' → the EARLIEST day it could mean, so a vague date never counts as more recent than it is. */
  function earliestDay(date) {
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(date || '');
    if (!m) return null;
    return m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01');
  }

  function shiftDate(today, years, months) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
    if (!m) throw new Error('today must be YYYY-MM-DD, got ' + today);
    var total = Number(m[1]) * 12 + (Number(m[2]) - 1) - years * 12 - months;
    var y = Math.floor(total / 12);
    var mo = (total % 12) + 1;
    return String(y) + '-' + (mo < 10 ? '0' : '') + mo + '-' + m[3];
  }

  function notOverdue(record, today) {
    return !record.review_by || record.review_by >= today;
  }

  function index(list, keyFn) {
    var by = new Map();
    (list || []).forEach(function (r) {
      var k = canonicalGeoid(keyFn(r));
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    });
    return by;
  }

  /** Incentive records that count toward the bonus, each with a short label. */
  function countedIncentives(fees, landUse, funds, today) {
    var out = [];
    fees.forEach(function (r) {
      if (r.kind !== 'program' || !COUNTED_FEE_MEASURES[r.measure] || !notOverdue(r, today)) return;
      out.push({ scope: 'fees', record: r });
    });
    landUse.forEach(function (r) {
      if (r.status !== 'adopted' || EXCLUDED_LAND_USE[r.measure] || !notOverdue(r, today)) return;
      out.push({ scope: 'land_use', record: r });
    });
    funds.forEach(function (r) {
      if (r.status !== 'adopted' || !notOverdue(r, today)) return;
      out.push({ scope: 'funds', record: r });
    });
    return out;
  }

  /**
   * Build the model once.
   * docs: { support, fees, funds, coverage }
   */
  function build(docs) {
    docs = docs || {};
    var support = new Map();
    ((docs.support && docs.support.jurisdictions) || []).forEach(function (row) {
      support.set(canonicalGeoid(row.geoid), row);
    });
    var fees = index(docs.fees && docs.fees.entries, function (r) { return r.geoid; });
    var landUse = index(docs.fees && docs.fees.land_use, function (r) { return r.geoid; });
    var funds = index(docs.funds && docs.funds.entries, function (r) { return r.geoid; });
    var coverage = new Map();
    ((docs.coverage && docs.coverage.jurisdictions) || []).forEach(function (row) {
      coverage.set(canonicalGeoid(row.geoid), row);
    });

    /**
     * One jurisdiction's local-support profile on `today`.
     * opts.kind 'cdp' + opts.county: a CDP has no government of its own, so its county's record applies.
     * opts.civic: the place's Civic Readiness dimensions (housing-policy-scorecard.json). Evidence
     *   Civic already credits is listed but not counted again: the plans part when Civic has
     *   has_hna or has_comp_plan true, and fund records when it has has_local_funding true.
     */
    function profile(geoid, today, opts) {
      opts = opts || {};
      var subject = canonicalGeoid(opts.kind === 'cdp' && opts.county ? opts.county : geoid);
      var row = support.get(subject) || null;
      var planCutoff = shiftDate(today, PLAN_WINDOW_YEARS, 0);
      var actionCutoff = shiftDate(today, 0, ACTION_WINDOW_MONTHS);
      var rowCurrent = !!row && notOverdue(row, today);
      var items = (row && row.items) || [];

      function scopeState(scope, has) {
        if (!row) return 'not_checked';
        if (!rowCurrent) return 'overdue';
        if (has) return 'records';
        var r = row.result_by_scope && row.result_by_scope[scope];
        return r === 'unreadable' ? 'unreadable' : (r === 'none_found' || r === 'records' ? 'none_found' : 'not_checked');
      }

      var plans = items.filter(function (i) { return i.kind === 'plan'; });
      var actions = items.filter(function (i) { return i.kind === 'action'; });
      var countedPlans = rowCurrent ? plans.filter(function (i) {
        var d = earliestDay(i.date);
        return d && d >= planCutoff && APPROVAL_OUTCOMES[i.outcome];
      }) : [];
      var countedActions = rowCurrent ? actions.filter(function (i) {
        var d = earliestDay(i.date);
        return d && d >= actionCutoff && i.type !== 'denial' && APPROVAL_OUTCOMES[i.outcome];
      }) : [];
      var denials = actions.filter(function (i) {
        var d = earliestDay(i.date);
        return (i.type === 'denial' || i.outcome === 'denied' || i.outcome === 'recommended_denial') && d && d >= actionCutoff;
      });

      var civic = opts.civic || {};
      var plansInCivic = civic.has_hna === true || civic.has_comp_plan === true;
      var fundsInCivic = civic.has_local_funding === true;
      var allIncentives = countedIncentives(
        fees.get(subject) || [], landUse.get(subject) || [], funds.get(subject) || [], today);
      var incentives = fundsInCivic
        ? allIncentives.filter(function (i) { return i.scope !== 'funds'; })
        : allIncentives;
      var creditedInCivic = allIncentives.filter(function (i) { return incentives.indexOf(i) === -1; });
      var cov = coverage.get(subject);
      var incentiveState;
      if (incentives.length) incentiveState = 'records';
      else if (creditedInCivic.length) incentiveState = 'in_civic';
      else if (!cov) incentiveState = 'not_checked';
      else {
        var res = cov.result_by_scope || {};
        var vals = ['fees', 'land_use', 'funds'].map(function (s) { return res[s]; });
        incentiveState = vals.every(function (v) { return v === 'none_found'; }) ? 'none_found'
          : vals.some(function (v) { return v === 'unreadable'; }) ? 'unreadable' : 'not_checked';
      }

      var parts = {
        plans: { label: PART_LABELS.plans,
                 state: countedPlans.length && plansInCivic ? 'in_civic' : scopeState('plans', plans.length > 0),
                 counted: plansInCivic ? [] : countedPlans,
                 creditedInCivic: plansInCivic ? countedPlans : [],
                 points: countedPlans.length && !plansInCivic ? POINTS_PER_PART : 0 },
        incentives: { label: PART_LABELS.incentives, state: incentiveState,
                      counted: incentives, creditedInCivic: creditedInCivic,
                      points: incentives.length ? POINTS_PER_PART : 0 },
        council: { label: PART_LABELS.council, state: scopeState('council', actions.length > 0),
                   counted: countedActions, creditedInCivic: [],
                   points: countedActions.length ? POINTS_PER_PART : 0 }
      };
      var bonus = BONUS_PARTS.reduce(function (s, k) { return s + parts[k].points; }, 0);
      return {
        geoid: geoid,
        subjectGeoid: subject,
        inheritsFrom: subject !== canonicalGeoid(geoid) ? subject : null,
        checked: row ? row.checked : null,
        reviewBy: row ? row.review_by : null,
        parts: parts,
        plans: plans,
        actions: actions,
        denials: denials,
        bonus: bonus,
        anyChecked: !!row || !!cov || allIncentives.length > 0
      };
    }

    return { profile: profile, rows: support };
  }

  // Plain labels for incentive records come from the Local Housing Incentives
  // module, so a tool is named the same way on both pages.
  function incentiveLabels() {
    if (typeof window !== 'undefined' && window.LocalIncentivesData) return window.LocalIncentivesData;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./local-incentives-data.js'); } catch (e) { return null; }
    }
    return null;
  }

  /** "reduced building permit fees", "density bonus", "housing trust fund". */
  function incentiveLabel(item) {
    var r = item.record;
    var lib = incentiveLabels() || {};
    function lower(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
    if (item.scope === 'fees') {
      return String(r.measure) + ' ' + String(r.fee_category || 'development').replace(/_/g, ' ') + ' fees';
    }
    var labels = (item.scope === 'land_use' ? lib.LAND_USE_LABELS : lib.FUND_TOOL_LABELS) || {};
    var key = item.scope === 'land_use' ? r.measure : r.tool;
    return lower(labels[key] || String(key).replace(/_/g, ' '));
  }

  /** Add the bonus to a 0–100 composite without passing 100. A null score stays null. */
  function applyBonus(score, bonus) {
    if (!Number.isFinite(score)) return null;
    return Math.min(100, score + (Number.isFinite(bonus) ? bonus : 0));
  }

  return {
    build: build,
    applyBonus: applyBonus,
    incentiveLabel: incentiveLabel,
    earliestDay: earliestDay,
    shiftDate: shiftDate,
    MAX_BONUS: MAX_BONUS,
    POINTS_PER_PART: POINTS_PER_PART,
    BONUS_PARTS: BONUS_PARTS,
    PLAN_WINDOW_YEARS: PLAN_WINDOW_YEARS,
    ACTION_WINDOW_MONTHS: ACTION_WINDOW_MONTHS,
    PART_LABELS: PART_LABELS,
    TYPE_LABELS: TYPE_LABELS
  };
}));
