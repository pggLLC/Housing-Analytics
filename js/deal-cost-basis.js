/** Itemized development costs, eligible basis, fee tests and credit limits (#2160).
 * Pure functions, no DOM. Rules come from data/policy/lihtc-underwriting-rules.json;
 * a rule is applied only when it is adopted and cites a source in that file.
 * An unknown figure is null with a reason, never 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealCostBasis = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var RULE_NOT_SOURCED = 'rule not sourced';
  var GROUPS = Object.freeze([
    ['acquisition', 'Acquisition'],
    ['contract', 'Contractor contract'],
    ['owner_hard', 'Owner hard-cost allowances'],
    ['soft', 'Soft costs'],
    ['fees', 'Developer and consultant fees'],
    ['reserves', 'Reserves']
  ].map(function (g) { return Object.freeze({ id: g[0], label: g[1] }); }));
  var CONTINGENCY_KINDS = Object.freeze({
    contractor_contingency: 'Contractor contingency',
    escalation: 'Escalation allowance',
    owner_contingency: 'Owner hard-cost contingency',
    soft_contingency: 'Soft-cost contingency'
  });
  // One row per line a practitioner's budget usually carries. "group" places a
  // line in exactly one subtotal, so the contractor contract is a subset of the
  // uses, never added on top of them.
  var LINE_TEMPLATE = Object.freeze([
    ['land', 'Land', 'acquisition', 'ineligible'],
    ['building_acquisition', 'Existing building purchase', 'acquisition', 'eligible'],
    ['site_work', 'Site work', 'contract', 'eligible'],
    ['structures', 'Building construction', 'contract', 'eligible'],
    ['general_requirements', 'General requirements', 'contract', 'eligible'],
    ['overhead', 'Contractor overhead', 'contract', 'eligible'],
    ['profit', 'Contractor profit', 'contract', 'eligible'],
    ['bonds', 'Payment and performance bonds', 'contract', 'eligible'],
    ['insurance', "Builder's risk insurance", 'contract', 'eligible'],
    ['contractor_contingency', 'Contractor contingency', 'contract', 'eligible'],
    ['owner_contingency', 'Owner hard-cost contingency', 'owner_hard', 'eligible'],
    ['escalation', 'Escalation allowance', 'owner_hard', 'eligible'],
    ['design', 'Architecture and engineering', 'soft', 'eligible'],
    ['permits', 'Permits and impact fees', 'soft', 'eligible'],
    ['financing', 'Financing, legal and other soft costs', 'soft', 'partial'],
    ['soft_contingency', 'Soft-cost contingency', 'soft', 'eligible'],
    ['developer_fee', 'Developer fee', 'fees', 'eligible'],
    ['consultant_fee', 'Development consultant fee', 'fees', 'eligible'],
    ['reserves', 'Operating and replacement reserves', 'reserves', 'ineligible']
  ].map(function (l) { return Object.freeze({ id: l[0], label: l[1], group: l[2], basis: l[3] }); }));

  // INVENTED example budget, totalling the calculator's default $20,000,000.
  // It is a starting point to overwrite, not a typical or real project.
  var EXAMPLE_BUDGET = Object.freeze({
    land: 1000000, building_acquisition: null, site_work: 1000000, structures: 10400000,
    general_requirements: 600000, overhead: 250000, profit: 500000, bonds: 120000, insurance: 130000,
    contractor_contingency: 500000, owner_contingency: 400000, escalation: 200000,
    design: 700000, permits: 400000, financing: 1200000, soft_contingency: 200000,
    developer_fee: 1900000, consultant_fee: null, reserves: 500000
  });
  var EXAMPLE_PARTIAL = Object.freeze({ financing: 900000 });

  function exampleLines() {
    return LINE_TEMPLATE.map(function (t) {
      var line = { id: t.id, label: t.label, group: t.group, basis: t.basis, amount: EXAMPLE_BUDGET[t.id] };
      if (t.basis === 'partial') line.eligibleAmount = EXAMPLE_PARTIAL[t.id];
      if (CONTINGENCY_KINDS[t.id]) line.used = line.amount == null ? null : 0;
      return line;
    });
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  /** Status of one rule: applied only when adopted and its source exists. */
  function ruleStatus(rules, key) {
    var file = rules || {};
    var rule = file.rules && file.rules[key];
    var draft = (file.drafts && file.drafts[key]) || null;
    if (!rule) return { key: key, applied: false, rule: null, draft: draft, reason: RULE_NOT_SOURCED };
    var source = rule.source && file.sources && file.sources[rule.source];
    if (!source) return { key: key, applied: false, rule: rule, draft: draft, reason: RULE_NOT_SOURCED };
    if (rule.status !== 'adopted') return { key: key, applied: false, rule: rule, draft: draft,
      reason: 'Draft rule: shown, not applied.' };
    return { key: key, applied: true, rule: rule, draft: draft, reason: null,
      citation: source.title + ', ' + rule.location };
  }

  /** Totals for itemized lines. tdc is the entered total development cost. */
  function summarizeCosts(lines, tdc) {
    var out = { itemized: 0, eligible: 0, ineligible: 0, acquisitionEligible: 0, contract: 0,
      notItemized: null, tdc: null, groups: {}, contingencies: [], byId: {}, eligibleById: {}, reason: null, lineCount: 0 };
    GROUPS.forEach(function (g) { out.groups[g.id] = 0; });
    (lines || []).forEach(function (line) {
      if (out.reason) return;
      var amount = num(line.amount);
      if (amount === null) return; // a blank line carries no cost
      if (!Number.isFinite(amount) || amount < 0) { out.reason = 'Enter a cost of $0 or more for ' + line.label + '.'; return; }
      var eligiblePart;
      if (line.basis === 'eligible') eligiblePart = amount;
      else if (line.basis === 'ineligible') eligiblePart = 0;
      else if (line.basis === 'partial') {
        eligiblePart = num(line.eligibleAmount);
        if (eligiblePart === null || !Number.isFinite(eligiblePart) || eligiblePart < 0) {
          out.reason = 'Enter the eligible part of ' + line.label + '.'; return;
        }
        if (eligiblePart > amount) { out.reason = 'The eligible part of ' + line.label + ' is more than its cost.'; return; }
      } else { out.reason = 'Choose eligible, ineligible or partly eligible for ' + line.label + '.'; return; }
      out.lineCount++;
      out.itemized += amount;
      out.eligible += eligiblePart;
      out.ineligible += amount - eligiblePart;
      if (line.id === 'building_acquisition') out.acquisitionEligible += eligiblePart;
      if (out.groups[line.group] === undefined) { out.reason = 'Unknown cost group for ' + line.label + '.'; return; }
      out.groups[line.group] += amount;
      if (line.group === 'contract') out.contract += amount;
      out.byId[line.id] = (out.byId[line.id] || 0) + amount;
      out.eligibleById[line.id] = (out.eligibleById[line.id] || 0) + eligiblePart;
      if (CONTINGENCY_KINDS[line.id]) {
        var used = num(line.used);
        var row = { id: line.id, label: CONTINGENCY_KINDS[line.id], original: amount, used: null, remaining: null, reason: null };
        if (used === null || !Number.isFinite(used) || used < 0) row.reason = 'Enter the amount proposed for use so far.';
        else { row.used = used; row.remaining = amount - used; if (used > amount) row.reason = 'Proposed use is more than the original amount.'; }
        out.contingencies.push(row);
      }
    });
    var total = num(tdc);
    if (!out.reason && out.lineCount === 0) out.reason = 'Itemize development costs to calculate eligible basis.';
    if (!out.reason) {
      if (total === null || !Number.isFinite(total) || total <= 0) out.reason = 'Enter Total Development Cost.';
      else if (out.itemized > total + 0.5) {
        out.reason = 'Itemized costs (' + money(out.itemized) + ') are more than Total Development Cost (' + money(total) + ').';
      } else {
        out.tdc = total;
        out.notItemized = total - out.itemized;
        out.ineligible += out.notItemized; // costs nobody itemized cannot be shown to be eligible
      }
    }
    if (out.reason) { out.eligible = null; out.ineligible = null; out.notItemized = null; out.tdc = null; }
    return out;
  }

  /** Grant reduction by source type (26 U.S.C. 42(d)(5)(A)). */
  function grantBasisReduction(tranches, rules) {
    var status = ruleStatus(rules, 'grant_basis_treatment');
    var out = { reduction: 0, rows: [], reason: null, status: status };
    (tranches || []).forEach(function (t) {
      var amount = num(t.amount);
      if (t.mode !== 'grant' || amount === null || amount === 0) return;
      if (!Number.isFinite(amount) || amount < 0) { out.reason = out.reason || 'Enter each grant as an amount of $0 or more.'; return; }
      var type = t.fundSource === 'federal' ? 'federal_grant' : t.fundSource === 'nonfederal' ? 'nonfederal_grant' : null;
      var row = { id: t.id, program: t.program, amount: amount, sourceType: type, reducesBasis: null };
      if (!type) { out.reason = out.reason || 'Say whether each grant contains federal money; a federally funded grant reduces eligible basis.'; }
      else if (!status.applied) { out.reason = out.reason || 'Grant treatment: ' + status.reason + '.'; }
      else {
        row.reducesBasis = !!status.rule.by_source_type[type].reduces_basis;
        if (row.reducesBasis) out.reduction += amount;
      }
      out.rows.push(row);
    });
    if (out.reason) out.reduction = null;
    return out;
  }

  function tierFor(tiers, units) {
    return (tiers || []).find(function (t) {
      return units >= t.min_units && (t.max_units === null || units <= t.max_units);
    }) || null;
  }

  /** CHFA builder's profit and overhead limit, QAP 3.M.3. */
  function contractorFeeTest(args) {
    var status = ruleStatus(args.rules, 'contractor_fee_limit');
    var byId = args.byId || {};
    var fee = (byId.overhead || 0) + (byId.profit || 0);
    var base = (byId.structures || 0) + (byId.site_work || 0) + (byId.contractor_contingency || 0);
    var out = { status: status, fee: fee, base: base, limitPct: null, limit: null, excess: null, passes: null, reason: null };
    if (!status.applied) { out.reason = status.reason; return out; }
    if (!(byId.overhead > 0 || byId.profit > 0)) { out.reason = 'Contractor overhead and profit are not itemized.'; return out; }
    if (!(base > 0)) { out.reason = 'Itemize building construction, site work and contractor contingency.'; return out; }
    var tier = tierFor(status.rule.tiers, args.units);
    if (!tier) { out.reason = 'Enter the number of units.'; return out; }
    out.limitPct = args.identityOfInterest ? tier.with_identity_of_interest : tier.without_identity_of_interest;
    out.limit = base * out.limitPct;
    out.excess = Math.max(0, fee - out.limit);
    out.passes = fee <= out.limit + 0.5;
    return out;
  }

  /** CHFA's base for the developer fee limit, QAP 3.M.3. */
  function developerFeeBase(summary, contractorTest, specialPopulations) {
    if (!summary || summary.tdc === null) return { base: null, reason: (summary && summary.reason) || 'Itemize development costs.' };
    // Costs nobody itemized could be land, acquisition, fees or reserves, which come
    // off the base; assuming none of them would raise the limit, so the base is unknown.
    if (summary.notItemized > 0.5) {
      return { base: null, reason: 'Itemize the remaining ' + '$' + Math.round(summary.notItemized).toLocaleString('en-US')
        + ' of Total Development Cost, so CHFA\'s fee base (which leaves out land, half of acquisition, fees and reserves) is known.' };
    }
    var byId = summary.byId;
    var excess = contractorTest && contractorTest.excess !== null ? contractorTest.excess : 0;
    var note = contractorTest && contractorTest.excess === null
      ? 'Contractor fee not tested (' + contractorTest.reason.replace(/\.$/, '') + '), so no excess contractor fee is subtracted.' : null;
    // Half of acquisition comes off the base, except for projects serving people
    // experiencing homelessness or special populations (QAP 3.M.3).
    var acquisitionOff = specialPopulations ? 0 : 0.5 * (byId.building_acquisition || 0);
    var base = summary.tdc - excess - (byId.land || 0) - acquisitionOff
      - (byId.developer_fee || 0) - (byId.consultant_fee || 0) - (byId.reserves || 0);
    return { base: base, reason: null, note: note, acquisitionSubtracted: acquisitionOff };
  }

  /** Aggregate developer plus consultant fee, tested before deferral. */
  function developerFeeTest(args) {
    var status = ruleStatus(args.rules, 'developer_fee_limit');
    var dev = num(args.developerFee), consultant = num(args.consultantFee);
    var out = { status: status, fee: null, base: num(args.base), limitPct: null, limit: null, excess: null, passes: null,
      reason: null, testedBeforeDeferral: true };
    if (!status.applied) { out.reason = status.reason; return out; }
    if (dev === null && consultant === null) { out.reason = 'Enter the developer fee.'; return out; }
    out.fee = (dev || 0) + (consultant || 0);
    if (out.base === null || !Number.isFinite(out.base) || out.base <= 0) {
      out.reason = args.baseReason || 'The fee base is not available.'; return out;
    }
    var tier = tierFor(status.rule.tiers, args.units);
    if (!tier) { out.reason = 'Enter the number of units.'; return out; }
    out.limitPct = tier.pct;
    out.limit = out.base * tier.pct;
    out.excess = Math.max(0, out.fee - out.limit);
    out.passes = out.fee <= out.limit + 0.5;
    return out;
  }

  /** The part of an over-limit fee that sits in basis. CHFA limits the fees in
   * calculating credit, and a reduction in fees reduces eligible basis (QAP 3.M.3). */
  function feeExcessInBasis(summary, contractorTest, developerTest) {
    var e = (summary && summary.eligibleById) || {};
    var out = { contractor: 0, developer: 0, total: 0 };
    if (contractorTest && contractorTest.excess > 0) {
      out.contractor = Math.min(contractorTest.excess, (e.overhead || 0) + (e.profit || 0));
    }
    if (developerTest && developerTest.excess > 0) {
      out.developer = Math.min(developerTest.excess, (e.developer_fee || 0) + (e.consultant_fee || 0));
    }
    out.total = out.contractor + out.developer;
    return out;
  }

  /** CHFA Method Two: the credit the funding gap needs, QAP 3.M.1. */
  function gapCredit(args) {
    var status = ruleStatus(args.rules, 'credit_reservation_methods');
    var out = { status: status, gap: null, credit: null, reason: null };
    if (!status.applied) { out.reason = status.reason; return out; }
    var tdc = num(args.tdc), other = num(args.otherSources), price = num(args.price);
    if (tdc === null || !Number.isFinite(tdc) || tdc <= 0) { out.reason = 'Enter Total Development Cost.'; return out; }
    if (other === null || !Number.isFinite(other)) { out.reason = args.otherReason || 'Sources other than credit equity are not available.'; return out; }
    if (price === null || !Number.isFinite(price) || price <= 0) { out.reason = 'Enter the credit price.'; return out; }
    out.gap = tdc - other;
    out.credit = Math.max(0, out.gap) / price / status.rule.gap_years;
    return out;
  }

  /** Eligible basis to annual credit, with the boost, applicable fraction and CHFA limits. */
  function basisAndCredit(args) {
    var rules = args.rules;
    var out = { eligibleBasis: null, grantReduction: null, afterGrant: null, boost: { applied: false, multiplier: 1, reason: null },
      feeReduction: 0, boostedBasis: null, unitFraction: null, floorFraction: null, applicableFraction: null, qualifiedBasis: null,
      acquisitionQualified: null, acquisitionRate: null, calculatedCredit: null,
      cap: { applied: false, amount: null, reason: null, binding: false },
      gapMethod: { applied: false, credit: null, gap: null, reason: null, binding: false },
      costLimitMethod: { checked: false, reason: null },
      capacity: null, requested: null, awarded: null, creditForEquity: null, creditForEquityBasis: null,
      flags: [], reasons: {} };
    function stop(key, reason) { out.reasons[key] = reason; return out; }

    if (args.eligibleCost === null || !Number.isFinite(args.eligibleCost)) return stop('eligibleBasis', args.costReason || 'Itemize development costs.');
    out.eligibleBasis = args.eligibleCost;
    if (args.grantReduction === null || !Number.isFinite(args.grantReduction)) return stop('afterGrant', args.grantReason || 'Grant treatment is unknown.');
    out.grantReduction = args.grantReduction;
    out.feeReduction = Math.max(0, num(args.feeExcess) || 0);
    out.afterGrant = Math.max(0, out.eligibleBasis - out.feeReduction - out.grantReduction);
    // Fees are never acquisition basis. With no input saying which costs a grant
    // financed, a federal grant is spread over acquisition and other basis in
    // proportion, so neither bucket is charged first (Method One prices them apart).
    var acqCost = Math.min(Math.max(0, args.acquisitionEligible || 0), out.eligibleBasis);
    var otherCost = Math.max(0, out.eligibleBasis - acqCost - out.feeReduction);
    var grantOnAcq = acqCost + otherCost > 0 ? out.grantReduction * acqCost / (acqCost + otherCost) : 0;
    out.grantOnAcquisition = acqCost > 0 && out.grantReduction > 0 ? grantOnAcq : 0;

    var boost = ruleStatus(rules, 'basis_boost');
    var designation = args.designation || 'none';
    var evidence = typeof args.evidence === 'string' ? args.evidence.trim() : '';
    var d = boost.rule && boost.rule.designations && boost.rule.designations[designation];
    if (designation === 'none') out.boost.reason = 'No QCT, DDA, SADDA or CHFA designation selected.';
    else if (!boost.applied) out.boost.reason = 'Basis boost: ' + boost.reason + '.';
    else if (!d) out.boost.reason = 'Unknown designation.';
    else if (d.credit_types.indexOf(String(args.creditType)) === -1) out.boost.reason = d.label + ' applies only to ' + d.credit_types.join('% and ') + '% credits.';
    else if (!evidence) out.boost.reason = 'Add the evidence for the ' + d.label + ' designation (HUD map or list, or CHFA letter).';
    else {
      // CHFA awards "up to" 30%; its boost is the percentage in CHFA's letter (QAP 3.M.2).
      var multiplier = boost.rule.multiplier;
      var pct = num(args.awardedBoostPct);
      if (d.needs_awarded_percent) {
        if (pct === null || !Number.isFinite(pct) || pct <= 0) out.boost.reason = 'Enter the boost percentage in CHFA\'s letter.';
        else if (pct / 100 + 1 > d.max_multiplier + 1e-9) out.boost.reason = 'CHFA awards a boost of up to ' + Math.round((d.max_multiplier - 1) * 100) + '%.';
        else multiplier = 1 + pct / 100;
      }
      if (!out.boost.reason) { out.boost.applied = true; out.boost.multiplier = multiplier; out.boost.citation = boost.citation; out.boost.designation = d.label; }
    }
    // One boost, never on acquisition basis, and never above eligible cost x 130%.
    var acquisition = Math.min(out.afterGrant, Math.max(0, acqCost - grantOnAcq));
    var boostable = out.afterGrant - acquisition;
    out.boostedBasis = boostable * out.boost.multiplier + acquisition;
    var ceiling = out.eligibleBasis * (out.boost.applied ? out.boost.multiplier : 1);
    if (out.boostedBasis > ceiling) out.boostedBasis = ceiling;

    var units = args.units, lowIncomeUnits = args.lowIncomeUnits;
    if (!(lowIncomeUnits > 0)) units = units > 0 ? units : 1; // no low-income unit: the fraction is 0, not unknown
    if (!(units > 0)) return stop('applicableFraction', 'Enter the number of units.');
    out.unitFraction = Math.min(1, Math.max(0, lowIncomeUnits / units));
    if (out.unitFraction === 1) out.floorFraction = 1; // every residential unit is low-income
    else if (out.unitFraction === 0) out.floorFraction = 0; // no low-income unit, no low-income floor space
    else {
      var resSf = num(args.residentialSf), liSf = num(args.lowIncomeSf);
      if (resSf === null || liSf === null || !Number.isFinite(resSf) || !Number.isFinite(liSf) || resSf <= 0 || liSf < 0) {
        return stop('applicableFraction', 'Enter the floor space of the restricted units and of all residential units; the law uses the lower of the unit and floor-space fractions.');
      }
      if (liSf > resSf) return stop('applicableFraction', 'Restricted floor space is more than residential floor space.');
      out.floorFraction = liSf / resSf;
    }
    out.applicableFraction = Math.min(out.unitFraction, out.floorFraction);
    out.qualifiedBasis = out.boostedBasis * out.applicableFraction;
    // Acquisition basis earns the acquisition rate; on a 9% deal that is CHFA's
    // 4% floor, not 9% (QAP 3.M.1, Method One).
    out.acquisitionQualified = acquisition * out.applicableFraction;
    out.acquisitionRate = args.creditRate;
    if (out.acquisitionQualified > 0 && String(args.creditType) === '9') {
      var acqRule = ruleStatus(rules, 'acquisition_credit_rate');
      if (!acqRule.applied) return stop('acquisitionRate', 'Acquisition credit rate: ' + acqRule.reason + '.');
      // The QAP sets a floor; with no applicable-percentage input, the floor applies.
      out.acquisitionRate = Math.max(acqRule.rule.floor, num(args.acquisitionApr) || 0);
      out.acquisitionCitation = acqRule.citation;
    }
    out.calculatedCredit = out.acquisitionQualified * out.acquisitionRate
      + (out.qualifiedBasis - out.acquisitionQualified) * args.creditRate;

    var capKey = String(args.creditType) === '9' ? 'credit_cap_federal_9pct' : null;
    out.capacity = out.calculatedCredit;
    if (!capKey) out.cap.reason = 'CHFA sets no per-project federal limit for 4% credits with private activity bonds.';
    else {
      var cap = ruleStatus(rules, capKey);
      if (!cap.applied) out.cap.reason = cap.reason;
      else {
        out.cap.applied = true;
        out.cap.amount = cap.rule.annual_cap;
        out.cap.citation = cap.citation;
        if (out.calculatedCredit > cap.rule.annual_cap) {
          out.capacity = cap.rule.annual_cap;
          out.cap.binding = true;
          out.cap.reason = 'Capped at ' + money(cap.rule.annual_cap) + ': CHFA accepts no more federal 9% credit a year for one project (' + cap.citation + ').';
        }
      }
    }
    // CHFA reserves the smallest of Method One (above), Method Two (the gap)
    // and Method Three (cost basis limits, not published outside the Excel application).
    var methods = ruleStatus(rules, 'credit_reservation_methods');
    out.costLimitMethod.reason = methods.applied ? methods.rule.cost_basis_limit_reason : 'Credit reservation methods: ' + methods.reason + '.';
    var gm = args.gapCredit;
    if (!methods.applied) out.gapMethod.reason = out.costLimitMethod.reason;
    else if (!gm) out.gapMethod.reason = 'The funding gap is not calculated yet.';
    else if (gm.credit === null) out.gapMethod.reason = gm.reason;
    else {
      out.gapMethod.applied = true; out.gapMethod.credit = gm.credit; out.gapMethod.gap = gm.gap; out.gapMethod.citation = methods.citation;
      if (gm.credit < out.capacity - 0.5) {
        out.capacity = gm.credit;
        out.gapMethod.binding = true;
        out.cap.binding = false;
        out.gapMethod.reason = 'Limited to ' + money(gm.credit) + ': CHFA reserves no more than the gap calculation, ' + money(Math.max(0, gm.gap))
          + ' of uses not covered by other sources, divided by the credit price and 10 years (' + methods.citation + ').';
      }
    }
    var requested = num(args.requested), awarded = num(args.awarded);
    if (requested !== null && (!Number.isFinite(requested) || requested < 0)) return stop('requested', 'Enter a credit request of $0 or more.');
    if (awarded !== null && (!Number.isFinite(awarded) || awarded < 0)) return stop('awarded', 'Enter a credit award of $0 or more.');
    out.requested = requested; out.awarded = awarded;
    if (requested === null) out.reasons.requested = 'No request entered.';
    if (awarded === null) out.reasons.awarded = 'No award entered.';
    if (requested !== null && requested > out.capacity + 0.5) out.flags.push('The request is more than the credit capacity.');
    if (awarded !== null && requested !== null && awarded > requested + 0.5) out.flags.push('The award is more than the request.');
    if (awarded !== null) { out.creditForEquity = awarded; out.creditForEquityBasis = 'awarded'; }
    else if (requested !== null) { out.creditForEquity = Math.min(requested, out.capacity); out.creditForEquityBasis = 'requested'; }
    else { out.creditForEquity = out.capacity; out.creditForEquityBasis = 'capacity'; }
    return out;
  }

  /** CHFA's minimum and high debt-coverage tests over the rule's forecast years. */
  function underwritingCheck(args) {
    var years = (args.years || []).filter(function (r) { return Number.isFinite(r && r.allMustPayCoverage); });
    var min = ruleStatus(args.rules, 'min_debt_coverage');
    var high = ruleStatus(args.rules, 'high_coverage_credit_reduction');
    var out = { minimum: { status: min, lowest: null, passes: null, reason: null },
      high: { status: high, firstYear: null, exceeds: null, reason: null } };
    if (!min.applied) out.minimum.reason = min.reason;
    else if (years.length < min.rule.forecast_years) {
      out.minimum.reason = 'The forecast measures ' + years.length + ' years of coverage on must-pay debt; CHFA tests ' + min.rule.forecast_years + '.';
    } else {
      out.minimum.lowest = Math.min.apply(null, years.slice(0, min.rule.forecast_years).map(function (r) { return r.allMustPayCoverage; }));
      out.minimum.passes = out.minimum.lowest >= min.rule.min_coverage;
    }
    if (!high.applied) out.high.reason = high.reason;
    else if (!years.length) out.high.reason = 'Coverage on must-pay debt is not available.';
    else { out.high.firstYear = years[0].allMustPayCoverage; out.high.exceeds = out.high.firstYear > high.rule.threshold; }
    return out;
  }

  // Each CHFA state credit application and the capped streams it allows (QAP 3.L).
  // Round Two accepts accelerated credit and pairs standard credit with it.
  var STATE_CREDIT_PATHS = Object.freeze({
    with_9pct: { federal: '9', streams: [['annual', 'credit_cap_state_with_9pct', 'Standard state credit']] },
    round_two: { federal: '4', streams: [['annual', 'credit_cap_state_round_two_accelerated', 'Accelerated state credit'],
      ['standardAnnual', 'credit_cap_state_round_two_standard', 'Paired standard state credit']] },
    bond_fall: { federal: '4', streams: [['annual', 'credit_cap_state_with_4pct', 'State credit']] }
  });

  /** State credit equity, kept apart from federal equity, with CHFA's annual limits.
   * Each stream is an annual amount over the six-year allocation (QAP 3.P.1). */
  function stateCredit(args) {
    var annual = num(args.annual), standard = num(args.standardAnnual), price = num(args.price);
    var out = { entered: annual !== null || standard !== null, annual: annual, standardAnnual: standard, allowedAnnual: null,
      streams: [], years: null, price: price, equity: null, cap: null, capReason: null, reason: null };
    if (!out.entered) { out.reason = 'No state credit entered.'; return out; }
    var term = ruleStatus(args.rules, 'state_credit_term');
    if (!term.applied) { out.reason = 'State credit term: ' + term.reason + '.'; return out; }
    out.years = term.rule.years; out.termCitation = term.citation;
    if (price === null || !Number.isFinite(price) || price <= 0 || price > 1.5) { out.reason = 'Enter the state credit price per dollar of credit.'; return out; }
    var path = args.path || (String(args.creditType) === '9' ? 'with_9pct' : null);
    var def = STATE_CREDIT_PATHS[path];
    if (!def) { out.reason = path ? 'Unknown state credit application.' : 'Choose which CHFA state credit application this is; each has its own limit.'; return out; }
    if (def.federal !== String(args.creditType)) {
      out.reason = 'This state credit application goes with federal ' + def.federal + '% credits, and this deal uses ' + args.creditType + '%.'; return out;
    }
    out.path = path;
    if (standard !== null && !def.streams.some(function (st) { return st[0] === 'standardAnnual'; })) {
      out.reason = 'Only Round Two pairs a separate standard state credit; clear the paired amount or choose Round Two.'; return out;
    }
    var allowed = 0, notes = [];
    for (var i = 0; i < def.streams.length; i++) {
      var st = def.streams[i], amount = num(args[st[0]]);
      if (amount === null) continue;
      if (!Number.isFinite(amount) || amount < 0) { out.reason = 'Enter an annual ' + st[2].toLowerCase() + ' of $0 or more.'; return out; }
      var cap = ruleStatus(args.rules, st[1]);
      var row = { label: st[2], annual: amount, allowedAnnual: amount, cap: null, capReason: null };
      if (!cap.applied) row.capReason = st[2] + ' limit: ' + cap.reason + '.';
      else {
        var units = num(args.units);
        if (cap.rule.annual_cap_per_unit && (units === null || !Number.isFinite(units) || units <= 0)) {
          out.reason = 'Enter the number of units; this state credit limit is set per unit.'; return out;
        }
        row.cap = cap.rule.annual_cap_per_unit ? Math.min(cap.rule.annual_cap, cap.rule.annual_cap_per_unit * units) : cap.rule.annual_cap;
        if (amount > row.cap) { row.allowedAnnual = row.cap; row.capReason = st[2] + ' capped at ' + money(row.cap) + ' a year (' + cap.citation + ').'; }
      }
      if (row.capReason) notes.push(row.capReason);
      out.streams.push(row);
      allowed += row.allowedAnnual;
    }
    out.allowedAnnual = allowed;
    out.cap = out.streams.length === 1 ? out.streams[0].cap : null;
    out.capReason = notes.length ? notes.join(' ') : null;
    out.equity = allowed * out.years * price;
    return out;
  }

  /** One source's equity pay-in schedule: closing, construction completion, stabilization. */
  function payIn(total, pcts) {
    var keys = ['closing', 'completion', 'stabilization'];
    var values = keys.map(function (k) { return num(pcts && pcts[k]); });
    var out = { total: total, installments: null, reason: null };
    if (values.every(function (v) { return v === null; })) { out.reason = 'Pay-in schedule not entered.'; return out; }
    if (values.some(function (v) { return v === null || !Number.isFinite(v) || v < 0; })) { out.reason = 'Enter a percentage for every installment.'; return out; }
    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    if (Math.abs(sum - 100) > 0.01) { out.reason = 'Installments add up to ' + (Math.round(sum * 100) / 100) + '%, not 100%.'; return out; }
    if (total === null || !Number.isFinite(total)) { out.reason = 'Equity for this source is not available.'; return out; }
    out.installments = keys.map(function (k, i) { return { stage: k, pct: values[i], amount: total * values[i] / 100 }; });
    return out;
  }

  /** Cost per SF for the contractor contract and the total, each with its scope. */
  function costPerSf(args) {
    var gross = num(args.grossSf), residential = num(args.residentialSf);
    function per(amount, sf, scope, area) {
      var reason = null;
      if (amount === null || !Number.isFinite(amount) || amount <= 0) reason = scope === 'contract' ? 'Itemize the contractor contract.' : 'Enter Total Development Cost.';
      else if (sf === null || !Number.isFinite(sf) || sf <= 0) reason = 'Enter ' + area + ' square feet.';
      return { scope: scope, area: area, value: reason ? null : amount / sf, reason: reason };
    }
    return {
      contractPerGrossSf: per(num(args.contract), gross, 'contract', 'gross'),
      contractPerResidentialSf: per(num(args.contract), residential, 'contract', 'residential'),
      totalPerGrossSf: per(num(args.total), gross, 'total', 'gross'),
      totalPerResidentialSf: per(num(args.total), residential, 'total', 'residential')
    };
  }

  return {
    RULE_NOT_SOURCED: RULE_NOT_SOURCED, GROUPS: GROUPS, LINE_TEMPLATE: LINE_TEMPLATE,
    CONTINGENCY_KINDS: CONTINGENCY_KINDS, exampleLines: exampleLines, ruleStatus: ruleStatus,
    summarizeCosts: summarizeCosts, grantBasisReduction: grantBasisReduction,
    contractorFeeTest: contractorFeeTest, developerFeeBase: developerFeeBase, developerFeeTest: developerFeeTest,
    feeExcessInBasis: feeExcessInBasis, gapCredit: gapCredit, STATE_CREDIT_PATHS: STATE_CREDIT_PATHS,
    basisAndCredit: basisAndCredit, underwritingCheck: underwritingCheck, stateCredit: stateCredit,
    payIn: payIn, costPerSf: costPerSf
  };
});
