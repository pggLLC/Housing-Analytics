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
  // The Colorado Division of Housing's Housing Development Analysis spreadsheet,
  // Development Costs tab: its nine categories and line names, in its order.
  var GROUPS = Object.freeze([
    ['acquisition', 'Acquisition'],
    ['site', 'Site improvements'],
    ['construction', 'Construction'],
    ['professional', 'Professional fees'],
    ['construction_finance', 'Construction finance'],
    ['permanent_finance', 'Permanent finance and syndication'],
    ['soft', 'Soft costs'],
    ['fees', 'Developer fee'],
    ['reserves', 'Reserves']
  ].map(function (g) { return Object.freeze({ id: g[0], label: g[1] }); }));
  var CONTINGENCY_KINDS = Object.freeze({
    contractor_contingency: 'Contractor contingency',
    owner_contingency: 'Owner hard-cost contingency',
    soft_contingency: 'Soft-cost contingency'
  });
  // Lines that can never be in eligible basis, so the page offers no choice.
  var RESERVES_NOTE = 'Reserves are cash held for operations, not depreciable building property, so they are never in eligible basis.';
  var NEVER_IN_BASIS = Object.freeze({
    land: 'Land is never in eligible basis: eligible basis is the building\'s adjusted basis (26 U.S.C. 42(d)(1)).',
    reserves: RESERVES_NOTE, debt_service_reserve: RESERVES_NOTE, lease_up_reserve: RESERVES_NOTE,
    replacement_reserve: RESERVES_NOTE, reserve_other: RESERVES_NOTE
  });
  // One row per DOH line. "group" places a line in exactly one category. The basis
  // column is only the starting choice, which the user can change; "partial" lines
  // ask for the part in basis, because what they hold differs from deal to deal.
  var LINE_TEMPLATE = Object.freeze([
    ['land', 'Land', 'acquisition', 'ineligible'],
    ['building_acquisition', 'Existing structures', 'acquisition', 'eligible'],
    ['off_site', 'Off-site infrastructure', 'site', 'ineligible'],
    ['site_work', 'On-site infrastructure', 'site', 'eligible'],
    ['demolition', 'Demolition', 'site', 'ineligible'],
    ['permits', 'Building permit fees', 'construction', 'eligible'],
    ['tap_fees', 'Tap fees and impact fees', 'construction', 'eligible'],
    ['structures', 'Construction / rehabilitation', 'construction', 'eligible'],
    ['general_requirements', 'General requirements', 'construction', 'eligible'],
    ['overhead_profit', 'Contractor overhead & profit', 'construction', 'eligible'],
    ['contractor_contingency', 'Contractor construction contingency', 'construction', 'eligible'],
    ['owner_contingency', 'Owner hard-cost contingency', 'construction', 'eligible'],
    ['ffe', 'Furniture, fixtures and equipment (FFE)', 'construction', 'eligible'],
    ['construction_other', 'Other construction costs, such as escalation', 'construction', 'partial'],
    ['design', 'Architect fees', 'professional', 'eligible'],
    ['engineering', 'Engineering fees', 'professional', 'eligible'],
    ['re_attorney', 'Real estate attorney fees', 'professional', 'partial'],
    ['surveys', 'Surveys', 'professional', 'eligible'],
    ['green_design', 'Green planning and design fees', 'professional', 'eligible'],
    ['professional_other', 'Other professional fees', 'professional', 'partial'],
    ['insurance', 'Construction insurance', 'construction_finance', 'eligible'],
    ['bonds', 'Construction performance and payment bonds', 'construction_finance', 'eligible'],
    ['construction_loan_fee', 'Construction loan origination fee', 'construction_finance', 'eligible'],
    ['construction_interest', 'Construction interest', 'construction_finance', 'partial'],
    ['construction_attorney', 'Construction loan attorney fees', 'construction_finance', 'eligible'],
    ['construction_title', 'Construction title and recording', 'construction_finance', 'partial'],
    ['construction_taxes', 'Taxes during construction', 'construction_finance', 'eligible'],
    ['inspection_fees', 'Inspection fees and power/telecom fees', 'construction_finance', 'eligible'],
    ['construction_finance_other', 'Other construction finance costs', 'construction_finance', 'partial'],
    ['perm_loan_fees', 'Permanent loan fees and expenses', 'permanent_finance', 'ineligible'],
    ['perm_attorney', 'Permanent loan attorney fees', 'permanent_finance', 'ineligible'],
    ['perm_title', 'Permanent loan title and recording', 'permanent_finance', 'ineligible'],
    ['perm_other', 'Other permanent finance and syndication costs', 'permanent_finance', 'ineligible'],
    ['appraisal_market', 'Appraisals and market study', 'soft', 'eligible'],
    ['environmental', 'Environmental reports', 'soft', 'eligible'],
    ['geotechnical', 'Geotechnical and soils tests', 'soft', 'eligible'],
    ['capital_needs', 'Capital needs assessment', 'soft', 'eligible'],
    ['temp_relocation', 'Temporary relocation', 'soft', 'ineligible'],
    ['perm_relocation', 'Permanent relocation', 'soft', 'ineligible'],
    ['tax_credit_fees', 'Tax credit fees', 'soft', 'ineligible'],
    ['marketing', 'Marketing', 'soft', 'ineligible'],
    ['soft_contingency', 'Soft-cost contingency', 'soft', 'eligible'],
    ['cost_certification', 'Cost certification', 'soft', 'eligible'],
    ['soft_other', 'Other soft costs', 'soft', 'partial'],
    ['developer_fee', 'Developer fee', 'fees', 'eligible'],
    ['consultant_fee', 'Development consultant fee', 'fees', 'eligible'],
    ['admin_fee', 'Administration fee', 'fees', 'eligible'],
    ['reserves', 'Operating reserve', 'reserves', 'ineligible'],
    ['debt_service_reserve', 'Debt service reserve', 'reserves', 'ineligible'],
    ['lease_up_reserve', 'Lease-up reserve', 'reserves', 'ineligible'],
    ['replacement_reserve', 'Replacement reserve', 'reserves', 'ineligible'],
    ['reserve_other', 'Other reserves', 'reserves', 'ineligible']
  ].map(function (l) { return Object.freeze({ id: l[0], label: l[1], group: l[2], basis: l[3] }); }));

  // Lines the CHFA rules and DOH's per-unit figures read.
  // CHFA's builder's profit and overhead base: "new structures or rehabilitation,
  // onsite work, contingency and accessory structures" (QAP 3.M.3).
  var CONTRACTOR_FEE_IDS = Object.freeze(['overhead_profit']);
  var CONTRACTOR_BASE_IDS = Object.freeze(['structures', 'site_work', 'contractor_contingency']);
  // DOH's developer fee subtotal ("maximum developer fee") holds the developer,
  // consultant and administration fees; CHFA limits the developer plus consultant
  // fee, so the administration fee is counted with them.
  // CHFA's fee limit tests the developer fee plus the consultant fee (lihtc-underwriting-rules.json);
  // DOH's fee share also counts its administration fee.
  var DEVELOPER_FEE_IDS = Object.freeze(['developer_fee', 'consultant_fee']);
  var DOH_FEE_IDS = Object.freeze(['developer_fee', 'consultant_fee', 'admin_fee']);
  var RESERVE_IDS = Object.freeze(['reserves', 'debt_service_reserve', 'lease_up_reserve', 'replacement_reserve', 'reserve_other']);
  // The contractor's contract: site work, construction, general requirements, overhead and profit, contingency.
  var CONTRACT_IDS = Object.freeze(['off_site', 'site_work', 'demolition', 'structures', 'general_requirements', 'overhead_profit', 'contractor_contingency']);
  // DOH stars these lines as "costs included in hard cost evaluation". Its unstarred "Other" lines are not.
  var HARD_COST_IDS = Object.freeze(['building_acquisition', 'off_site', 'site_work', 'demolition', 'permits', 'tap_fees', 'structures',
    'general_requirements', 'overhead_profit', 'contractor_contingency', 'owner_contingency']);
  function sumIds(byId, ids) {
    return ids.reduce(function (total, id) { return total + ((byId && byId[id]) || 0); }, 0);
  }

  // Lines before the DOH layout, so saved links and exports still load. Each old
  // line goes to the DOH line that holds the same cost; two old lines may share one.
  var LEGACY_LINES = Object.freeze({
    overhead: 'overhead_profit', profit: 'overhead_profit', financing: 'soft_other',
    // DOH has no escalation row; an escalation allowance is one of its "Other (Devo specify)" construction costs.
    escalation: 'construction_other'
  });
  // Old lines that held more than the DOH line now using their id: "Architecture and engineering"
  // and "Operating and replacement reserves". (Old "Permits and impact fees" stays on Building
  // permit fees: DOH's two lines for it are both starred hard costs with the same basis.)
  var LEGACY_COMBINED_LINES = Object.freeze({ design: 'professional_other', reserves: 'reserve_other' });
  // Every line id before the DOH layout. An old link names these and no others, so a DOH
  // line outside this list was not in the saved budget and must not keep its example amount.
  var PRE_DOH_IDS = Object.freeze(['land', 'building_acquisition', 'site_work', 'structures', 'general_requirements',
    'overhead', 'profit', 'bonds', 'insurance', 'contractor_contingency', 'owner_contingency', 'escalation', 'design',
    'permits', 'financing', 'soft_contingency', 'developer_fee', 'consultant_fee', 'reserves']);

  // INVENTED example budget, totalling the calculator's default $20,000,000.
  // It is a starting point to overwrite, not a typical or real project.
  var EXAMPLE_BUDGET = Object.freeze({
    land: 1000000, site_work: 1000000, structures: 10400000,
    general_requirements: 600000, overhead_profit: 750000, contractor_contingency: 500000,
    owner_contingency: 400000, construction_other: 200000, permits: 400000,
    design: 700000, insurance: 130000, bonds: 120000,
    construction_loan_fee: 150000, construction_interest: 450000, construction_taxes: 100000, inspection_fees: 50000,
    perm_loan_fees: 100000, appraisal_market: 50000, environmental: 50000, geotechnical: 50000, tax_credit_fees: 100000, marketing: 50000,
    soft_contingency: 200000, cost_certification: 50000,
    developer_fee: 1900000, reserves: 500000
  });
  var EXAMPLE_PARTIAL = Object.freeze({ construction_interest: 400000, construction_other: 200000 });

  function exampleLines() {
    return LINE_TEMPLATE.map(function (t) {
      var line = { id: t.id, label: t.label, group: t.group, basis: t.basis, amount: EXAMPLE_BUDGET[t.id] == null ? null : EXAMPLE_BUDGET[t.id] };
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
  // QAP 3.L sets CHFA's credit limits per project AND per applicant (with affiliates), so
  // requests in the applicant's other active applications use up the same limit.
  // Two CHFA conditions the calculator has no inputs for yet; it says so beside the figures they limit.
  var BOND_TEST_NOTE = 'Assumes the tax-exempt bonds meet the aggregate basis test. Otherwise CHFA allows 4% credit only on the share of eligible basis the bonds finance (CHFA 2025-2026 QAP, PDF page 54). Not checked here.';
  var REHAB_MINIMUM_NOTE = 'CHFA also requires rehabilitation hard costs, not counting acquisition or soft costs, above the greater of 20% of the building\'s adjusted basis or $20,000 per unit (CHFA 2025-2026 QAP, PDF page 35). Not checked here.';
  var APPLICANT_LIMIT_NOTE = 'CHFA\'s limits apply per project and per applicant, with its affiliates, so credit requested in their other active CHFA applications leaves less for this one. These figures assume there are none.';

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
      // Land is never in eligible basis, whatever the selector says: eligible basis
      // is the adjusted basis of the building (26 U.S.C. 42(d)(1)).
      if (NEVER_IN_BASIS[line.id]) eligiblePart = 0;
      else if (line.basis === 'eligible') eligiblePart = amount;
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
      if (CONTRACT_IDS.indexOf(line.id) !== -1) out.contract += amount;
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
    var fee = sumIds(byId, CONTRACTOR_FEE_IDS);
    var base = sumIds(byId, CONTRACTOR_BASE_IDS);
    var out = { status: status, fee: fee, base: base, limitPct: null, limit: null, excess: null, passes: null, reason: null };
    if (!status.applied) { out.reason = status.reason; return out; }
    if (!(fee > 0)) { out.reason = 'Contractor overhead and profit are not itemized.'; return out; }
    if (!(base > 0)) { out.reason = 'Itemize construction or rehabilitation, on-site infrastructure and the contractor contingency.'; return out; }
    var tier = tierFor(status.rule.tiers, args.units);
    if (!tier) { out.reason = 'Enter the number of units.'; return out; }
    out.limitPct = args.identityOfInterest ? tier.with_identity_of_interest : tier.without_identity_of_interest;
    out.limit = base * out.limitPct;
    out.excess = Math.max(0, fee - out.limit);
    out.passes = fee <= out.limit + 0.5;
    return out;
  }

  // Without its sourced rule a fee is untested whatever its amount.
  function contractorUntested(t) {
    return !!(t && t.excess === null && t.fee > 0);
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
    // An over-limit contractor fee comes off the base; untested, the base is unknown.
    if (contractorUntested(contractorTest)) {
      return { base: null, reason: 'The contractor fee could not be tested against CHFA\'s limit (' + String(contractorTest.reason || '').replace(/\.$/, '')
        + '), so the developer fee base is unknown.' };
    }
    var byId = summary.byId;
    var excess = contractorTest && contractorTest.excess !== null ? contractorTest.excess : 0;
    var note = contractorTest && contractorTest.excess === null
      ? 'Contractor fee not tested (' + contractorTest.reason.replace(/\.$/, '') + '), so no excess contractor fee is subtracted.' : null;
    // Half of acquisition comes off the base, except for projects serving people
    // experiencing homelessness or special populations (QAP 3.M.3).
    var acquisitionOff = specialPopulations ? 0 : 0.5 * (byId.building_acquisition || 0);
    var base = summary.tdc - excess - (byId.land || 0) - acquisitionOff
      - sumIds(byId, DEVELOPER_FEE_IDS) - sumIds(byId, RESERVE_IDS);
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
    var out = { contractor: 0, developer: 0, total: 0, reason: null };
    // A fee the limit could not be tested on may still be over it; while any of
    // it sits in basis, the reduction is unknown, not $0.
    if (contractorUntested(contractorTest) && sumIds(e, CONTRACTOR_FEE_IDS) > 0) {
      return { contractor: null, developer: null, total: null,
        reason: 'The contractor fee could not be tested against CHFA\'s limit (' + String(contractorTest.reason || '').replace(/\.$/, '') + '), so the fee to take out of basis is unknown.' };
    }
    var feeInBasis = sumIds(e, DEVELOPER_FEE_IDS);
    var developerUntested = developerTest && developerTest.excess === null
      && (!developerTest.status || !developerTest.status.applied || developerTest.fee !== null);
    if (developerUntested && feeInBasis > 0) {
      return { contractor: null, developer: null, total: null,
        reason: 'The developer fee could not be tested against CHFA\'s limit (' + String(developerTest.reason || '').replace(/\.$/, '') + '), so the fee to take out of basis is unknown.' };
    }
    // The excess comes off basis only as far as it falls on in-basis fees. When the
    // paired fees are partly outside basis, nothing says which part was over, so the
    // reduction is a range; unless that range is one figure, it is unknown.
    var b = (summary && summary.byId) || {};
    function inBasisPart(excess, inBasis, total, label) {
      var outside = Math.max(0, total - inBasis);
      var low = Math.max(0, excess - outside), high = Math.min(excess, inBasis);
      if (high - low > 0.5) {
        out.reason = 'The ' + label + ' over CHFA\'s limit could come from fees in basis or outside it, so the reduction in basis is somewhere from '
          + money(low) + ' to ' + money(high) + '; put all of those fees in or out of basis to settle it.';
        return null;
      }
      return high;
    }
    if (contractorTest && contractorTest.excess > 0) {
      out.contractor = inBasisPart(contractorTest.excess, sumIds(e, CONTRACTOR_FEE_IDS), sumIds(b, CONTRACTOR_FEE_IDS), 'contractor fee');
    }
    if (developerTest && developerTest.excess > 0) {
      out.developer = inBasisPart(developerTest.excess, feeInBasis, sumIds(b, DEVELOPER_FEE_IDS), 'developer fee');
    }
    if (out.contractor === null || out.developer === null) { out.contractor = null; out.developer = null; out.total = null; return out; }
    out.total = out.contractor + out.developer;
    return out;
  }

  /** DOH's developer fee measure: the fee subtotal as a share of total cost less
   * that fee, reserves and acquisition. Shown beside CHFA's limit; it limits nothing. */
  function dohDeveloperFeeShare(summary) {
    if (!summary || summary.tdc === null) return { value: null, reason: (summary && summary.reason) || 'Itemize development costs.' };
    if (summary.notItemized > 0.5) return { value: null, reason: 'Itemize all of Total Development Cost, so the costs DOH leaves out are known.' };
    var b = summary.byId, fee = sumIds(b, DOH_FEE_IDS);
    var base = summary.tdc - fee - sumIds(b, RESERVE_IDS) - (b.land || 0) - (b.building_acquisition || 0);
    if (!(fee > 0)) return { value: null, reason: 'Enter the developer fee.' };
    if (!(base > 0)) return { value: null, reason: 'Total cost less the fee, reserves and acquisition is not above $0.' };
    return { value: fee / base, fee: fee, base: base, reason: null };
  }

  /** Saved fields from before the DOH layout, as the DOH lines they now belong to.
   * read(key) gives a saved value ("cost-overhead", "cost-overhead-basis", ...) or
   * null. Old lines that now share a line add together; if their basis choices
   * differ, the shared line becomes partly in basis with the sum of their parts.
   * A line already saved under its new name wins. */
  function legacyCostFields(read) {
    var out = {};
    var templateIds = LINE_TEMPLATE.map(function (t) { return t.id; });
    // An old link names lines the DOH layout no longer has, and none of the lines it added.
    var legacy = PRE_DOH_IDS.some(function (id) { return templateIds.indexOf(id) === -1 && read('cost-' + id) !== null; })
      && !LINE_TEMPLATE.some(function (t) { return PRE_DOH_IDS.indexOf(t.id) === -1 && read('cost-' + t.id) !== null; });
    var sources = {};
    Object.keys(LEGACY_LINES).forEach(function (old) { sources[old] = LEGACY_LINES[old]; });
    // Old combined lines whose id DOH reuses for a narrower item move to that category's Other line.
    if (legacy) Object.keys(LEGACY_COMBINED_LINES).forEach(function (old) { sources[old] = LEGACY_COMBINED_LINES[old]; });
    var targets = {};
    Object.keys(sources).forEach(function (old) { (targets[sources[old]] = targets[sources[old]] || []).push(old); });
    Object.keys(targets).forEach(function (target) {
      if (read('cost-' + target) !== null) return;
      var amount = 0, eligible = 0, any = false, bases = {}, unknownPart = false;
      targets[target].forEach(function (old) {
        var raw = read('cost-' + old);
        if (raw === null || raw === '') return;
        var a = num(raw);
        if (a === null || !Number.isFinite(a)) { unknownPart = true; return; }
        var basis = read('cost-' + old + '-basis') || 'eligible';
        any = true; amount += a; bases[basis] = true;
        if (basis === 'eligible') eligible += a;
        else if (basis === 'partial') {
          var e = num(read('cost-' + old + '-eligible'));
          if (e === null || !Number.isFinite(e)) unknownPart = true; else eligible += e;
        }
      });
      if (!any) return;
      var kinds = Object.keys(bases);
      out['cost-' + target] = String(amount);
      if (kinds.length === 1 && kinds[0] !== 'partial') out['cost-' + target + '-basis'] = kinds[0];
      else {
        out['cost-' + target + '-basis'] = 'partial';
        // An unknown part stays unknown: the line then asks for it.
        out['cost-' + target + '-eligible'] = unknownPart ? '' : String(eligible);
      }
    });
    if (legacy) {
      // A moved combined line leaves its old id, which now means the narrower DOH item, empty.
      // Its basis goes back to the DOH line's default, so a later entry is not judged by the old line's choice.
      Object.keys(LEGACY_COMBINED_LINES).forEach(function (old) {
        var t = LINE_TEMPLATE.filter(function (l) { return l.id === old; })[0];
        out['cost-' + old] = ''; out['cost-' + old + '-eligible'] = ''; out['cost-' + old + '-basis'] = t.basis;
      });
      // DOH lines the old link could not name had no cost in it, whatever the example says,
      // and no eligible part either.
      LINE_TEMPLATE.forEach(function (t) {
        if (PRE_DOH_IDS.indexOf(t.id) !== -1 || read('cost-' + t.id) !== null || out['cost-' + t.id]) return;
        out['cost-' + t.id] = '';
        if (!out['cost-' + t.id + '-eligible']) out['cost-' + t.id + '-eligible'] = '';
      });
    }
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

  /**
   * CHFA Method Three (QAP 3.M.1), from the limits in CHFA's 2027 Common
   * Application workbook (data/policy/chfa-common-app-tables.json; the tables
   * exist nowhere else). As the workbook calculates it (Calculations rows
   * 497-516): limit per unit = TRUNC(zone factor x base limit for the bedroom
   * count and building type); adjusted eligible basis = the sum over units;
   * x 1.3 for a QCT or DDA, x applicable fraction, x the credit rate.
   * The workbook follows a draft QAP, so the result is a check shown beside
   * the capacity, never a change to it.
   */
  var BEDROOM_ROWS = { efficiency: '0 bedroom', '0BR': '0 bedroom', '1BR': '1 bedroom', '2BR': '2 bedroom',
    '3BR': '3 bedroom', '4BR': '4 bedroom', '5BR': '5 bedroom' };
  function costBasisLimitCheck(args) {
    var t = args.tables;
    var out = { checked: false, draft: true, credit: null, adjustedEligibleBasis: null, zone: null, factor: null,
      perUnit: null, lower: false, reason: null, source: null };
    if (!t || !t.basis_limit_per_unit_base || !t.counties) { out.reason = 'CHFA\'s 2027 workbook limits did not load.'; return out; }
    out.source = (t.source && t.source.title ? t.source.title.replace(/ Instructions$/, '') : 'CHFA Common Application') + ', draft 2027-28 QAP';
    var county = args.countyFips && t.counties[String(args.countyFips).padStart(5, '0')];
    if (!county) { out.reason = 'Select a county: CHFA\'s limits depend on the county\'s zone.'; return out; }
    var column = args.buildingType === 'elevator' ? 'elevator' : args.buildingType === 'walk_up' ? 'walk_up' : null;
    if (!column) { out.reason = 'Choose elevator or walk-up: CHFA\'s limits differ by building type.'; return out; }
    var units = num(args.units);
    var byRow = {}, counted = 0;
    (args.rows || []).forEach(function (r) {
      var key = BEDROOM_ROWS[r && r.bedrooms];
      var n = num(r && r.units);
      if (!key || n === null || !(n > 0)) return;
      byRow[key] = (byRow[key] || 0) + n;
      counted += n;
    });
    if (!(units > 0) || Math.abs(counted - units) > 0.5) {
      out.reason = 'CHFA\'s limits are per unit by bedroom count; ' + Math.round(counted) + ' of ' + (units > 0 ? Math.round(units) : 0) + ' units have a bedroom count.';
      return out;
    }
    if (!Number.isFinite(args.applicableFraction) || !Number.isFinite(args.creditRate)) {
      out.reason = 'Method Three needs the applicable fraction and the credit rate.'; return out;
    }
    out.zone = county.zone;
    out.factor = t.zone_factor && t.zone_factor[String(county.zone)];
    if (!Number.isFinite(out.factor)) { out.reason = 'CHFA\'s zone factor for ' + county.name + ' County is missing.'; return out; }
    out.perUnit = {};
    var adjusted = 0;
    Object.keys(byRow).forEach(function (key) {
      var base = t.basis_limit_per_unit_base[key] && t.basis_limit_per_unit_base[key][column];
      var limit = Math.trunc(out.factor * base);
      out.perUnit[key] = limit;
      adjusted += limit * byRow[key];
    });
    out.adjustedEligibleBasis = adjusted;
    var boost = args.hudBoost ? 1.3 : 1;
    out.credit = adjusted * boost * args.applicableFraction * args.creditRate;
    out.checked = true;
    out.lower = Number.isFinite(args.capacity) && out.credit < args.capacity - 0.5;
    out.reason = county.name + ' County is CHFA zone ' + county.zone + ' (factor ' + out.factor + '). '
      + Object.keys(out.perUnit).map(function (k) { return k.replace(' bedroom', ' BR') + ' ' + money(out.perUnit[k]); }).join(', ')
      + ' per unit, ' + (column === 'elevator' ? 'elevator' : 'walk-up') + (args.hudBoost ? ', x 1.3 for the QCT or DDA' : '')
      + '. From ' + out.source + '; not adopted, so it does not change the capacity.';
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
    // An entered award is the award whatever the basis calculation can show, so
    // a stop still carries it (an invalid entry is rejected below instead).
    function stop(key, reason) {
      out.reasons[key] = reason;
      var entered = num(args.awarded);
      if (key !== 'awarded' && entered !== null && Number.isFinite(entered) && entered >= 0) {
        out.awarded = entered; out.creditForEquity = entered; out.creditForEquityBasis = 'awarded';
      }
      return out;
    }

    if (args.invalidReason) return stop('eligibleBasis', args.invalidReason);

    if (args.eligibleCost === null || !Number.isFinite(args.eligibleCost)) return stop('eligibleBasis', args.costReason || 'Itemize development costs.');
    out.eligibleBasis = args.eligibleCost;
    if (args.grantReduction === null || !Number.isFinite(args.grantReduction)) return stop('afterGrant', args.grantReason || 'Grant treatment is unknown.');
    out.grantReduction = args.grantReduction;
    if (args.feeExcess === null) return stop('afterGrant', args.feeReason || 'The fee to take out of basis is unknown.');
    out.feeReduction = Math.max(0, num(args.feeExcess) || 0);
    // A federal grant reduces basis only by what it paid for in basis (42(d)(5)(A));
    // a grant spent on land, reserves or fees CHFA already takes out of basis does
    // not. Where the deal has such costs, the user says how much of the grant went there.
    out.grantOutsideBasis = 0;
    var ineligibleCost = num(args.ineligibleCost);
    var outsideCost = (ineligibleCost !== null && ineligibleCost > 0 ? ineligibleCost : 0) + out.feeReduction;
    if (out.grantReduction > 0 && outsideCost > 0) {
      var outside = num(args.grantOutsideBasis);
      if (outside === null) {
        return stop('afterGrant', 'Enter how much of the federal grant paid for costs outside eligible basis, such as land, reserves or fees above CHFA\'s limits ($0 if none): a federal grant reduces basis only by what it paid for in basis (26 U.S.C. 42(d)(5)(A)).');
      }
      var maxOutside = Math.min(out.grantReduction, outsideCost);
      if (!Number.isFinite(outside) || outside < 0 || outside > maxOutside + 0.5) {
        return stop('afterGrant', 'Enter a federal grant amount for costs outside eligible basis between $0 and ' + money(maxOutside) + '.');
      }
      out.grantOutsideBasis = Math.min(outside, maxOutside);
      out.grantReduction -= out.grantOutsideBasis;
    }
    out.afterGrant = Math.max(0, out.eligibleBasis - out.feeReduction - out.grantReduction);
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
    // Fees are never acquisition basis. A federal grant reduces the basis it financed.
    // Where it went changes the credit when acquisition and other basis are priced
    // differently: on a 9% deal (4% vs 9% rates) or under a boost (which skips
    // acquisition basis). There the split must be entered; otherwise it cannot change
    // the credit, and the grant is spread over both in proportion.
    var acqCost = Math.min(Math.max(0, args.acquisitionEligible || 0), out.eligibleBasis);
    var otherCost = Math.max(0, out.eligibleBasis - acqCost - out.feeReduction);
    var grantOnAcq = acqCost + otherCost > 0 ? out.grantReduction * acqCost / (acqCost + otherCost) : 0;
    out.grantSplitEntered = false;
    var enteredOnAcq = num(args.grantOnAcquisition);
    var splitMatters = String(args.creditType) === '9' || out.boost.applied;
    if (out.grantReduction > 0 && acqCost > 0 && otherCost > 0 && (splitMatters || (enteredOnAcq !== null && !args.acquisitionQualifies))) {
      if (enteredOnAcq === null) {
        return stop('afterGrant', 'Enter how much of the federal grant paid for the building purchase: '
          + (String(args.creditType) === '9' ? 'on a 9% deal acquisition basis earns the 4% rate and the rest earns 9%' : 'the basis boost does not apply to acquisition basis')
          + ', so where the grant went changes the credit.');
      }
      if (!Number.isFinite(enteredOnAcq) || enteredOnAcq < 0 || enteredOnAcq > Math.min(out.grantReduction, acqCost) + 0.5) {
        return stop('afterGrant', 'Enter a federal grant amount for the building purchase between $0 and ' + money(Math.min(out.grantReduction, acqCost)) + '.');
      }
      if (out.grantReduction - enteredOnAcq > otherCost + 0.5) {
        return stop('afterGrant', 'The federal grant left for other costs is more than their basis; enter more of it against the building purchase.');
      }
      grantOnAcq = enteredOnAcq;
      out.grantSplitEntered = true;
    }
    out.grantOnAcquisition = acqCost > 0 && out.grantReduction > 0 ? grantOnAcq : 0;
    // An existing building's purchase price is basis only when the purchase meets
    // 26 U.S.C. 42(d)(2): bought from an unrelated party, and last placed in service
    // ten or more years ago, with a rehabilitation that earns its own credit under
    // 42(e) (42(d)(2)(B)(iv)). The user confirms that; nothing here can check it.
    // A purchase a federal grant paid for in full leaves no acquisition basis to confirm.
    if (acqCost - grantOnAcq > 0.5 && !args.acquisitionQualifies) {
      return stop('eligibleBasis', 'Confirm the building purchase meets 26 U.S.C. 42(d)(2) (bought from an unrelated party, not placed in service during the ten years before purchase, and rehabilitated enough to earn a credit under 42(e)), or take the purchase out of basis'
        + (out.grantReduction > 0 ? ', or enter the federal grant that paid for it if the grant covered all of it' : '') + '.');
    }

    // One boost, never on acquisition basis, and never above eligible cost x 130%.
    var acquisition = Math.min(out.afterGrant, Math.max(0, acqCost - grantOnAcq));
    var boostable = out.afterGrant - acquisition;
    out.boostedBasis = boostable * out.boost.multiplier + acquisition;
    var ceiling = out.eligibleBasis * (out.boost.applied ? out.boost.multiplier : 1);
    if (out.boostedBasis > ceiling) out.boostedBasis = ceiling;

    var units = args.units, lowIncomeUnits = args.lowIncomeUnits;
    // The unit count comes first: with it unknown, even zero low-income units give no fraction.
    if (!(units > 0)) return stop('applicableFraction', 'Enter the number of units.');
    if (!(lowIncomeUnits >= 0)) return stop('applicableFraction', 'Enter how many units are LIHTC units.');
    out.unitFraction = Math.min(1, Math.max(0, lowIncomeUnits / units));
    if (out.unitFraction === 1) out.floorFraction = 1; // every residential unit is low-income
    else if (out.unitFraction === 0) out.floorFraction = 0; // no low-income unit, no low-income floor space
    else {
      var resSf = num(args.residentialSf), liSf = num(args.lowIncomeSf);
      if (resSf === null || liSf === null || !Number.isFinite(resSf) || !Number.isFinite(liSf) || resSf <= 0 || liSf <= 0) {
        return stop('applicableFraction', 'Enter the floor space of the restricted units and of all residential units; the law uses the lower of the unit and floor-space fractions.');
      }
      if (liSf > resSf) return stop('applicableFraction', 'Restricted floor space is more than residential floor space.');
      out.floorFraction = liSf / resSf;
    }
    var fractionRule = ruleStatus(rules, 'applicable_fraction');
    if (!fractionRule.applied) return stop('applicableFraction', 'Applicable fraction: ' + fractionRule.reason + '.');
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
      if (!cap.applied) {
        // The 9% limit is required; without it the capacity could be overstated.
        out.cap.reason = cap.reason;
        out.capacity = null;
        out.reasons.capacity = 'Credit capacity needs CHFA\'s federal 9% limit, which is unavailable: ' + cap.reason + '.';
      }
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
    if (!methods.applied) {
      // Without the sourced reservation rule, Method Two is unknown and could be lower.
      out.gapMethod.reason = out.costLimitMethod.reason;
      out.capacity = null;
      out.reasons.capacity = 'Credit capacity needs CHFA\'s reservation rule, which is unavailable: ' + out.costLimitMethod.reason;
    }
    else if (!gm) out.gapMethod.reason = 'The funding gap is not calculated yet.';
    else if (gm.credit === null) {
      // Method Two could be lower than Method One, so without it the capacity is unknown.
      out.gapMethod.reason = gm.reason;
      out.capacity = null;
      out.reasons.capacity = 'Credit capacity needs CHFA\'s gap calculation, which cannot run yet: ' + gm.reason;
    } else {
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
    if (requested !== null && out.capacity !== null && requested > out.capacity + 0.5) out.flags.push('The request is more than the credit capacity.');
    if (awarded !== null && requested !== null && awarded > requested + 0.5) out.flags.push('The award is more than the request.');
    if (awarded !== null) { out.creditForEquity = awarded; out.creditForEquityBasis = 'awarded'; }
    else if (out.capacity === null) { out.creditForEquity = null; out.creditForEquityBasis = null; }
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
      streams: [], years: null, price: price, grossEquity: null, fees: null, equity: null, cap: null, capReason: null, reason: null };
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
    // CHFA pairs the standard credit with an accelerated award (QAP 3.L), so it never stands alone.
    if (path === 'round_two' && standard !== null && !(annual !== null && Number.isFinite(annual) && annual > 0)) {
      out.reason = 'Round Two pairs the standard state credit with an accelerated award; enter the accelerated amount too.'; return out;
    }
    var allowed = 0, notes = [];
    for (var i = 0; i < def.streams.length; i++) {
      var st = def.streams[i], amount = num(args[st[0]]);
      if (amount === null) continue;
      if (!Number.isFinite(amount) || amount < 0) { out.reason = 'Enter an annual ' + st[2].toLowerCase() + ' of $0 or more.'; return out; }
      var cap = ruleStatus(args.rules, st[1]);
      var row = { label: st[2], annual: amount, allowedAnnual: amount, cap: null, capReason: null };
      // Without its sourced limit the allowed amount is unknown, so no equity.
      if (!cap.applied) { out.reason = st[2] + ' limit: ' + cap.reason + '.'; return out; }
      if (cap.rule.fixed_annual) {
        // A fixed pairing is that amount or none (QAP 3.L), not a ceiling.
        if (amount !== cap.rule.fixed_annual) {
          out.reason = 'CHFA pairs a fixed ' + money(cap.rule.fixed_annual) + ' of ' + st[2].toLowerCase() + ' a year with this application (' +
            cap.citation + '); enter ' + money(cap.rule.fixed_annual) + ', or clear the state credit.'; return out;
        }
        row.cap = cap.rule.fixed_annual;
      } else {
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
    // CHFA sizes the state credit with a three-test calculation (QAP 3.M.2) that is not
    // modeled here, so only an awarded amount is a source.
    if (!args.awarded) {
      out.reason = 'A proposed state credit is not a source yet: CHFA sizes it with a three-test calculation (QAP 3.M.2) this calculator does not model. Tick "CHFA has awarded this state credit" once it is awarded, or clear it.';
      return out;
    }
    // Investor fees on the state credit come out of its equity; a blank field is no fees.
    var fees = num(args.fees);
    if (fees !== null && (!Number.isFinite(fees) || fees < 0)) { out.reason = 'Enter state credit investor fees of $0 or more.'; return out; }
    out.grossEquity = allowed * out.years * price;
    if (fees !== null && fees > out.grossEquity) {
      out.reason = 'State credit investor fees of ' + money(fees) + ' are more than its ' + money(out.grossEquity) + ' of equity.'; return out;
    }
    out.fees = fees === null ? 0 : fees;
    out.equity = out.grossEquity - out.fees;
    return out;
  }

  // Credits whose eligibility turns on where the site is or a designation it holds:
  // unknown until the evidence is entered, never shown as eligible by default.
  var ADDED_CREDIT_KINDS = Object.freeze({
    tz: { label: 'Transit Zone credit', needsEvidence: true },
    designation: { label: 'Location- or designation-based credit', needsEvidence: true },
    other: { label: 'Other credit', needsEvidence: false }
  });

  /** A credit added to the stack: its gross equity, and the net new equity it brings
   * after the credit it displaces, any cut to the federal award, and its investor fees.
   * Substituting for a credit creates no new cash, so only the net changes the stack. */
  function addedCredit(args) {
    var kind = ADDED_CREDIT_KINDS[args.kind] ? args.kind : null;
    var out = { entered: !!kind, kind: kind, label: kind ? ADDED_CREDIT_KINDS[kind].label : null, eligibility: null,
      annual: num(args.annual), years: num(args.years), price: num(args.price), fees: num(args.fees),
      programYear: num(args.programYear), mode: args.mode || null, displaces: null,
      gross: null, displaced: null, resizedFederal: null, netBeforeFees: null, net: null,
      awardReduction: null, reason: null };
    if (!kind) { out.reason = args.kind ? 'Unknown added credit.' : 'No added credit entered.'; return out; }
    // A possible award reduction is flagged only from a cited rule.
    var reduction = ruleStatus(args.rules, 'added_credit_award_reduction');
    out.awardReduction = reduction.applied
      ? { sourced: true, text: 'Possible: ' + (reduction.rule.effect || 'the allocator may reduce another award') + '.', citation: reduction.citation }
      : { sourced: false, text: RULE_NOT_SOURCED, citation: null };
    var evidence = String(args.evidence || '').trim();
    out.eligibility = !ADDED_CREDIT_KINDS[kind].needsEvidence ? 'not location-based' : evidence ? 'evidence entered' : 'unknown';
    out.evidence = evidence || null;
    // A Transit Zone credit also needs the site inside a zone on the Market Analysis map.
    if (kind === 'tz' && args.inZone !== true) {
      out.eligibility = args.inZone === false ? 'not in a zone' : 'unknown';
      out.reason = args.inZone === false
        ? 'Market Analysis does not place this site in a Transit Zone, so the Transit Zone credit does not apply.'
        : 'Transit Zone credit eligibility unknown: the site has not been checked against OEDIT\'s Transit Zone map. Use this calculator on the Market Analysis page, which checks the site, and enter the evidence.';
      return out;
    }
    if (out.eligibility === 'unknown') {
      out.reason = out.label + ' eligibility unknown: enter the evidence that the site qualifies (the designation, map or letter).'; return out;
    }
    var a = out.annual, y = out.years, p = out.price;
    if (a === null || !Number.isFinite(a) || a <= 0) { out.reason = 'Enter the annual ' + out.label.toLowerCase() + '.'; return out; }
    if (y === null || !Number.isFinite(y) || y <= 0 || Math.round(y) !== y) { out.reason = 'Enter the whole number of years the ' + out.label.toLowerCase() + ' is claimed.'; return out; }
    if (p === null || !Number.isFinite(p) || p <= 0 || p > 1.5) { out.reason = 'Enter the investor price per $1 of ' + out.label.toLowerCase() + '.'; return out; }
    out.gross = a * y * p;
    if (out.mode !== 'supplement' && out.mode !== 'substitute') {
      out.reason = 'Choose whether the ' + out.label.toLowerCase() + ' adds to the other credits or replaces part of one.'; return out;
    }
    out.displaced = 0;
    if (out.mode === 'substitute') {
      var d = args.displaced || {};
      out.displaces = d.label || null;
      if (!d.label) { out.reason = 'Choose which credit the ' + out.label.toLowerCase() + ' replaces.'; out.displaced = null; return out; }
      if (d.reason) { out.reason = 'Displaced ' + d.label.toLowerCase() + ': ' + d.reason; out.displaced = null; return out; }
      var da = num(d.annual);
      if (da === null || !Number.isFinite(da) || da <= 0) { out.reason = 'Enter the annual ' + d.label.toLowerCase() + ' it replaces.'; out.displaced = null; return out; }
      if (d.maxAnnual !== null && d.maxAnnual !== undefined && da > d.maxAnnual) {
        out.reason = 'It cannot replace more ' + d.label.toLowerCase() + ' than the ' + money(d.maxAnnual) + ' a year in this deal.'; out.displaced = null; return out;
      }
      // netShare: the part of the replaced credit's equity left after its own investor fees.
      out.displaced = da * d.years * d.price * (typeof d.netShare === 'number' ? d.netShare : 1);
    }
    var cut = num(args.federalCut && args.federalCut.annual);
    if (cut === null) cut = 0; // no cut entered: the federal award stands as entered
    if (!Number.isFinite(cut) || cut < 0) { out.reason = 'Enter a federal credit reduction of $0 or more a year.'; return out; }
    if (cut > 0) {
      var fedMax = args.federalCut.maxAnnual;
      if (fedMax === null || fedMax === undefined) { out.reason = 'The federal credit is not available, so a cut to it cannot be priced.'; return out; }
      // A cut comes out of what is left after any federal credit this one replaces.
      var replacedFed = out.mode === 'substitute' && args.displaced && args.displaced.federal ? num(args.displaced.annual) : 0;
      if (cut + replacedFed > fedMax) {
        out.reason = 'The federal credit cut' + (replacedFed ? ' plus the federal credit replaced' : '') + ' is more than the ' + money(fedMax) + ' a year of federal credit in this deal.'; return out;
      }
    }
    out.resizedFederal = cut * args.federalCut.years * args.federalCut.price;
    out.netBeforeFees = out.gross - out.displaced - out.resizedFederal;
    if (out.fees === null || !Number.isFinite(out.fees) || out.fees < 0) { out.reason = 'Enter the investor fees on the ' + out.label.toLowerCase() + ' ($0 if none).'; return out; }
    if (out.fees > out.gross) { out.reason = out.label + ' investor fees of ' + money(out.fees) + ' are more than its ' + money(out.gross) + ' of equity.'; return out; }
    out.net = out.netBeforeFees - out.fees;
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

  function pctText(r) { return (Math.round(r * 1000) / 10).toFixed(1) + '%'; }

  // The aggregate basis the bond test uses is the building's whole basis plus its land.
  var AGGREGATE_BASIS_NOTE = 'Aggregate basis here is the cost in eligible basis, before any boost or grant reduction, plus land: a screening estimate. Bond counsel measures the building\'s full basis and its land.';

  /** The tax-exempt bond aggregate basis test for 4% credits (26 U.S.C. 42(h)(4)(B)).
   * args: creditType, bondAmount, issuedAfter2025 ('yes' | 'no' | ''), eligibleCost,
   * land, costReason, constructionLoan, rules. The bonds must finance the building
   * and land, so an amount above the construction loan entered is flagged. */
  function bondTest(args) {
    var out = { applies: String(args.creditType) === '4', checked: false, bondAmount: null, aggregateBasis: null, ratio: null,
      threshold: null, passes: null, minimumBonds: null, basisCushion: null, citation: null, reason: null, flags: [], note: AGGREGATE_BASIS_NOTE };
    if (!out.applies) { out.reason = 'Only 4% credits with tax-exempt bonds need the bond test.'; return out; }
    var bonds = num(args.bondAmount);
    if (bonds === null) { out.reason = BOND_TEST_NOTE; return out; }
    if (!Number.isFinite(bonds) || bonds < 0) { out.reason = 'Enter the tax-exempt bond amount, $0 or more.'; return out; }
    out.bondAmount = bonds;
    var rule = ruleStatus(args.rules, 'bond_aggregate_basis_test');
    if (!rule.applied) { out.reason = 'Bond test: ' + rule.reason + '.'; return out; }
    out.citation = rule.citation;
    if (args.costReason) { out.reason = 'The bond test needs itemized costs: ' + args.costReason; return out; }
    var eligible = num(args.eligibleCost), land = num(args.land);
    if (eligible === null || !Number.isFinite(eligible) || eligible <= 0) { out.reason = 'Itemize the development costs in eligible basis; the bond test is measured on them and the land.'; return out; }
    // Land is part of the test's denominator: unknown land is unknown, never $0.
    if (land === null || !Number.isFinite(land) || land < 0) { out.reason = 'Itemize the Land line (enter 0 for donated land); the bond test is measured on building plus land.'; return out; }
    out.aggregateBasis = eligible + land;
    out.ratio = bonds / out.aggregateBasis;
    var issued = args.issuedAfter2025 === 'yes' ? true : args.issuedAfter2025 === 'no' ? false : null;
    var high = rule.rule.threshold_pct / 100, low = rule.rule.post_2025_threshold_pct / 100, floor = rule.rule.post_2025_issue_min_pct / 100;
    if (issued === null) {
      // Without the issue date only the 50% route is known; the 25% route needs a post-2025 issue.
      if (out.ratio >= high) { out.threshold = high; out.passes = true; }
      else {
        out.reason = 'Say whether the bonds are from an issue dated after December 31, 2025. The test is 50% of aggregate basis, or 25% when post-2025 bonds finance at least 5% of it (' + rule.citation + '). At ' + pctText(out.ratio)
          + ' the bonds ' + (out.ratio >= low ? 'pass only the 25% route.' : 'pass neither route.');
        out.checked = true;
        return out;
      }
    } else {
      out.threshold = issued && out.ratio >= floor ? low : high;
      out.passes = out.ratio >= out.threshold;
    }
    out.checked = true;
    out.minimumBonds = out.threshold * out.aggregateBasis;
    // How much more basis the bonds entered could carry before the test fails (negative: short).
    out.basisCushion = bonds / out.threshold - out.aggregateBasis;
    var loan = num(args.constructionLoan);
    if (loan === null) out.flags.push('Enter the construction loan: the bond proceeds have to finance the building and land, so they belong in the construction financing.');
    else if (Number.isFinite(loan) && bonds > loan + 0.5) out.flags.push('The bonds (' + money(bonds) + ') are more than the construction loan entered (' + money(loan) + '); bond proceeds have to finance the building and land.');
    return out;
  }

  /** Construction interest cross-check: loan x rate x months x average share drawn,
   * against the budgeted construction interest line. */
  function constructionInterestCheck(args) {
    var out = { estimate: null, budget: null, shortfall: null, passes: null, reason: null };
    var loan = num(args.loan), rate = num(args.ratePct), months = num(args.months), draw = num(args.drawPct);
    if ([loan, rate, months, draw].every(function (v) { return v === null; })) { out.reason = 'Enter the construction loan, rate, months and average share drawn to check the interest budget.'; return out; }
    if (loan === null || !Number.isFinite(loan) || loan <= 0) { out.reason = 'Enter the construction loan amount.'; return out; }
    if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 20) { out.reason = 'Enter a construction loan rate from 0% to 20%.'; return out; }
    if (months === null || !Number.isInteger(months) || months < 1 || months > 60) { out.reason = 'Enter construction loan months from 1 to 60.'; return out; }
    if (draw === null || !Number.isFinite(draw) || draw <= 0 || draw > 100) { out.reason = 'Enter the average share of the loan drawn, above 0% and up to 100%.'; return out; }
    out.estimate = loan * rate / 100 * months / 12 * draw / 100;
    var budget = num(args.budget);
    if (budget === null) { out.reason = 'Itemize the Construction interest line to compare it with the estimate.'; return out; }
    out.budget = budget;
    out.shortfall = Math.max(0, out.estimate - budget);
    out.passes = budget >= out.estimate - 0.5;
    return out;
  }

  /** CHFA's minimum operating reserve (QAP 4.A): months of operating expenses plus months of debt service. */
  function operatingReserveCheck(args) {
    var rule = ruleStatus(args.rules, 'operating_reserve_minimum');
    var out = { reserve: null, minimum: null, months: null, passes: null, citation: rule.citation || null, reason: null };
    if (!rule.applied) { out.reason = 'Operating reserve minimum: ' + rule.reason + '.'; return out; }
    var reserve = num(args.reserve), expenses = num(args.annualExpenses), ds = num(args.annualDebtService);
    if (reserve === null) { out.reason = 'Itemize the Operating reserve line to check CHFA\'s minimum.'; return out; }
    if (expenses === null || !Number.isFinite(expenses) || ds === null || !Number.isFinite(ds)) { out.reason = 'Operating expenses or debt service for year 1 are unavailable.'; return out; }
    out.reserve = reserve;
    out.minimum = expenses * rule.rule.expense_months / 12 + ds * rule.rule.debt_service_months / 12;
    var monthly = (expenses + ds) / 12;
    out.months = monthly > 0 ? reserve / monthly : null;
    out.passes = reserve >= out.minimum - 0.5;
    return out;
  }

  /** CHFA reviews whether cash flow repays the deferred developer fee within its
   * 15-year pro forma (QAP 2.B). rows: the projection's deferredFeePaid by year. */
  function deferredFeeRepayment(args) {
    var rule = ruleStatus(args.rules, 'deferred_fee_repayment_review');
    var out = { fee: null, paid: null, owed: null, yearRepaid: null, years: null, passes: null, citation: rule.citation || null, reason: null };
    if (!rule.applied) { out.reason = 'Deferred fee review: ' + rule.reason + '.'; return out; }
    var fee = num(args.deferredFee);
    if (fee === null || !Number.isFinite(fee)) { out.reason = 'The deferred developer fee is unavailable.'; return out; }
    out.fee = Math.max(0, fee); out.years = rule.rule.forecast_years;
    if (out.fee === 0) { out.paid = 0; out.owed = 0; out.passes = true; return out; }
    var rows = (args.rows || []).slice(0, out.years);
    if (rows.length < out.years) { out.reason = 'The cash flow forecast has ' + rows.length + ' years; CHFA reviews ' + out.years + '.'; return out; }
    var paid = 0;
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i] && rows[i].deferredFeePaid;
      if (!Number.isFinite(p)) { out.reason = 'Cash flow for year ' + (i + 1) + ' is unavailable, so the fee repayment is unknown.'; return out; }
      paid += p;
      if (out.yearRepaid === null && paid >= out.fee - 0.5) out.yearRepaid = i + 1;
    }
    out.paid = paid; out.owed = Math.max(0, out.fee - paid);
    out.passes = out.owed < 0.5;
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
    // DOH's hard, land and soft cost per unit and per square foot of the units.
    var units = num(args.units), byId = args.byId || null, total = num(args.total);
    var parts = null, notItemized = num(args.notItemized), partsReason = args.costReason || 'Itemize development costs.';
    // Cost nobody itemized could be hard, land or soft, so no split is shown until it is all itemized.
    if (notItemized !== null && notItemized > 0.5) partsReason = 'Itemize all of Total Development Cost to split it into hard, land and soft cost.';
    else if (byId && total !== null && Number.isFinite(total) && total > 0) {
      var hard = sumIds(byId, HARD_COST_IDS), land = byId.land || 0;
      parts = { hard: hard, land: land, soft: total - hard - land };
    }
    function share(kind, divisor, label) {
      if (!parts) return { value: null, reason: partsReason };
      if (divisor === null || !Number.isFinite(divisor) || divisor <= 0) return { value: null, reason: 'Enter ' + label + '.' };
      return { value: parts[kind] / divisor, reason: null };
    }
    return {
      units: units !== null && Number.isFinite(units) && units > 0 ? units : null,
      residentialSf: residential !== null && Number.isFinite(residential) && residential > 0 ? residential : null,
      hardPerUnit: share('hard', units, 'the number of units'), landPerUnit: share('land', units, 'the number of units'),
      softPerUnit: share('soft', units, 'the number of units'),
      hardPerSf: share('hard', residential, 'residential square feet'), landPerSf: share('land', residential, 'residential square feet'),
      softPerSf: share('soft', residential, 'residential square feet'),
      contractPerGrossSf: per(num(args.contract), gross, 'contract', 'gross'),
      contractPerResidentialSf: per(num(args.contract), residential, 'contract', 'residential'),
      totalPerGrossSf: per(num(args.total), gross, 'total', 'gross'),
      totalPerResidentialSf: per(num(args.total), residential, 'total', 'residential')
    };
  }

  return {
    RULE_NOT_SOURCED: RULE_NOT_SOURCED, APPLICANT_LIMIT_NOTE: APPLICANT_LIMIT_NOTE, BOND_TEST_NOTE: BOND_TEST_NOTE, REHAB_MINIMUM_NOTE: REHAB_MINIMUM_NOTE, GROUPS: GROUPS, LINE_TEMPLATE: LINE_TEMPLATE, NEVER_IN_BASIS: NEVER_IN_BASIS,
    CONTINGENCY_KINDS: CONTINGENCY_KINDS, exampleLines: exampleLines, ruleStatus: ruleStatus,
    summarizeCosts: summarizeCosts, grantBasisReduction: grantBasisReduction,
    contractorFeeTest: contractorFeeTest, developerFeeBase: developerFeeBase, developerFeeTest: developerFeeTest,
    feeExcessInBasis: feeExcessInBasis, gapCredit: gapCredit, STATE_CREDIT_PATHS: STATE_CREDIT_PATHS,
    basisAndCredit: basisAndCredit, costBasisLimitCheck: costBasisLimitCheck, underwritingCheck: underwritingCheck, stateCredit: stateCredit, addedCredit: addedCredit, ADDED_CREDIT_KINDS: ADDED_CREDIT_KINDS,
    payIn: payIn, costPerSf: costPerSf, bondTest: bondTest, constructionInterestCheck: constructionInterestCheck,
    operatingReserveCheck: operatingReserveCheck, deferredFeeRepayment: deferredFeeRepayment, AGGREGATE_BASIS_NOTE: AGGREGATE_BASIS_NOTE, dohDeveloperFeeShare: dohDeveloperFeeShare, legacyCostFields: legacyCostFields,
    LEGACY_LINES: LEGACY_LINES, CONTRACTOR_FEE_IDS: CONTRACTOR_FEE_IDS, CONTRACTOR_BASE_IDS: CONTRACTOR_BASE_IDS,
    DEVELOPER_FEE_IDS: DEVELOPER_FEE_IDS, DOH_FEE_IDS: DOH_FEE_IDS, PRE_DOH_IDS: PRE_DOH_IDS, LEGACY_COMBINED_LINES: LEGACY_COMBINED_LINES, RESERVE_IDS: RESERVE_IDS, CONTRACT_IDS: CONTRACT_IDS, HARD_COST_IDS: HARD_COST_IDS, sumIds: sumIds
  };
});
