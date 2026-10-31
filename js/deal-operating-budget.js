/** Operating budget and other income in the Division of Housing layout (DOH PR 2).
 * Pure functions, no DOM. Every line is a dollar amount per unit per year, the
 * figure DOH's sheet reports as P.U.P.A. ("per unit per annum") expenses.
 * Real estate taxes and the replacement reserve stay on their own inputs
 * (dc-prop-tax, dc-rep-reserve), because the tax exemption applies to taxes
 * alone and the reserve is required separately; the page shows both inside
 * DOH's "Other expenses" group. An unknown figure is null with a reason, never 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealOperatingBudget = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // The Colorado Division of Housing's Housing Development Analysis spreadsheet,
  // Operating Pro Forma tab: its four expense groups and line names, in its order.
  var GROUPS = Object.freeze([
    ['administrative', 'Administrative expenses'],
    ['operating', 'Operating expenses'],
    ['maintenance', 'Maintenance expenses'],
    ['other', 'Other expenses']
  ].map(function (g) { return Object.freeze({ id: g[0], label: g[1] }); }));

  // Lines held on separate inputs but shown in DOH's "Other expenses" group,
  // each placed before the line it precedes on DOH's sheet: Real Estate Taxes,
  // Property Insurance, Replacement Reserve, Other.
  var SEPARATE_LINES = Object.freeze([
    Object.freeze({ id: 'real_estate_taxes', label: 'Real estate taxes', group: 'other', input: 'dc-prop-tax', before: 'insurance' }),
    Object.freeze({ id: 'replacement_reserve', label: 'Replacement reserve', group: 'other', input: 'dc-rep-reserve', before: 'other_other' })
  ]);

  var LINE_TEMPLATE = Object.freeze([
    ['management_fee', 'Management fee', 'administrative'],
    ['admin_salaries', 'Salaries and benefits', 'administrative'],
    ['legal_accounting', 'Legal and accounting', 'administrative'],
    ['advertising', 'Advertising', 'administrative'],
    ['office_supplies', 'Office supplies', 'administrative'],
    ['telephone', 'Telephone', 'administrative'],
    ['audit', 'Audit', 'administrative'],
    ['admin_other', 'Administrative, Other', 'administrative'],
    ['utilities', 'Utilities', 'operating'],
    ['trash', 'Trash removal', 'operating'],
    ['operating_other', 'Operating, Other', 'operating'],
    ['maint_supplies', 'Maintenance supplies', 'maintenance'],
    ['maint_contracts', 'Maintenance salaries, repairs and contracts', 'maintenance'],
    ['extermination', 'Extermination', 'maintenance'],
    ['grounds', 'Grounds, including snow removal', 'maintenance'],
    ['maint_other', 'Maintenance, Other', 'maintenance'],
    ['insurance', 'Property insurance', 'other'],
    ['other_other', 'Other expenses, Other', 'other']
  ].map(function (l) { return Object.freeze({ id: l[0], label: l[1], group: l[2] }); }));

  // DOH's other income lines, added to rent before vacancy as in DOH's sheet.
  var INCOME_TEMPLATE = Object.freeze([
    ['parking', 'Parking income'],
    ['laundry', 'Laundry income'],
    ['fees', 'Vending, application and late fees']
  ].map(function (l) { return Object.freeze({ id: l[0], label: l[1] }); }));

  // INVENTED example, per unit per year. It totals $5,400 ($450 a month), the
  // single operating figure the calculator used before, so every result the
  // example produced is unchanged. It is not a benchmark.
  var EXAMPLE_BUDGET = Object.freeze({
    management_fee: 700, admin_salaries: 600, legal_accounting: 150, advertising: 50,
    office_supplies: 75, telephone: 75, audit: 100, admin_other: 0,
    utilities: 1100, trash: 150, operating_other: 0,
    maint_supplies: 250, maint_contracts: 900, extermination: 50, grounds: 200, maint_other: 0,
    insurance: 1000, other_other: 0
  });
  var EXAMPLE_INCOME = Object.freeze({ parking: 0, laundry: 0, fees: 0 });

  function exampleLines() {
    return LINE_TEMPLATE.map(function (t) {
      return { id: t.id, label: t.label, group: t.group, amount: EXAMPLE_BUDGET[t.id] };
    });
  }
  function exampleIncome() {
    return INCOME_TEMPLATE.map(function (t) { return { id: t.id, label: t.label, amount: EXAMPLE_INCOME[t.id] }; });
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Totals per unit per year. A blank line is nothing budgeted on that line;
   * an all-blank budget is unknown, never $0 of expenses. */
  function summarizeOperating(lines, income) {
    var out = { perUnitYear: null, perUnitMonth: null, otherIncomePerUnitYear: null,
      groups: {}, byId: {}, incomeById: {}, lineCount: 0, reason: null };
    GROUPS.forEach(function (g) { out.groups[g.id] = 0; });
    var total = 0;
    (lines || []).forEach(function (line) {
      if (out.reason) return;
      var amount = num(line.amount);
      if (amount === null) return;
      if (!Number.isFinite(amount) || amount < 0) { out.reason = 'Enter $0 or more per unit per year for ' + line.label + '.'; return; }
      if (out.groups[line.group] === undefined) { out.reason = 'Unknown expense group for ' + line.label + '.'; return; }
      out.groups[line.group] += amount;
      out.byId[line.id] = amount;
      out.lineCount++;
      total += amount;
    });
    if (!out.reason && out.lineCount === 0) out.reason = 'Enter the operating budget: at least one expense line per unit per year.';
    var otherIncome = 0;
    (income || []).forEach(function (line) {
      if (out.reason) return;
      var amount = num(line.amount);
      if (amount === null) return; // a blank income line is no income from that source
      if (!Number.isFinite(amount) || amount < 0) { out.reason = 'Enter $0 or more per unit per year for ' + line.label + '.'; return; }
      out.incomeById[line.id] = amount;
      otherIncome += amount;
    });
    if (out.reason) { out.groups = {}; out.byId = {}; out.incomeById = {}; return out; }
    out.perUnitYear = total;
    out.perUnitMonth = total / 12;
    out.otherIncomePerUnitYear = otherIncome;
    return out;
  }

  /** DOH's P.U.P.A. expenses: every expense line plus taxes and the reserve. */
  function pupaExpenses(summary, propTaxPerUnit, repReservePerUnit) {
    if (!summary || summary.reason) return { value: null, reason: summary ? summary.reason : 'Operating budget is unavailable.' };
    var tax = num(propTaxPerUnit), reserve = num(repReservePerUnit);
    if (tax === null || !Number.isFinite(tax) || tax < 0) return { value: null, reason: 'Enter the annual property tax per unit.' };
    if (reserve === null || !Number.isFinite(reserve) || reserve < 0) return { value: null, reason: 'Enter the annual replacement reserve per unit.' };
    return { value: summary.perUnitYear + tax + reserve, reason: null };
  }

  /** Old share links carried one figure, dc-opex, in dollars per unit per MONTH.
   * A link with it and no DOH line loads it, times 12, into "Other expenses,
   * Other" and empties every other line and income source, so the example's
   * lines are not added on top and every result is unchanged. */
  function legacyOperatingFields(read) {
    var get = typeof read === 'function' ? read : function (key) { return read && read[key] !== undefined ? read[key] : null; };
    var out = {};
    var old = get('opex');
    if (old === null) return out;
    var hasDoh = LINE_TEMPLATE.some(function (t) { return get('op-' + t.id) !== null; })
      || INCOME_TEMPLATE.some(function (t) { return get('op-income-' + t.id) !== null; });
    if (hasDoh) return out;
    var n = num(old);
    LINE_TEMPLATE.forEach(function (t) { out['op-' + t.id] = ''; });
    INCOME_TEMPLATE.forEach(function (t) { out['op-income-' + t.id] = ''; });
    // A blank or unreadable old figure stays blank, so the budget reads as unknown.
    out['op-other_other'] = n === null || !Number.isFinite(n) || n < 0 ? '' : String(n * 12);
    return out;
  }

  /** The provenance record an old link carried for dc-opex moves with its value.
   * A figure the sender entered stays the sender's on every line the old figure
   * now fills or empties; an untouched old default is left to the lines' own
   * labels, because it was the old invented figure. Returns a new map. */
  function legacyOperatingProvenance(map, legacyFields) {
    if (!map || typeof map !== 'object' || !map.fields || !Array.isArray(map.fields['dc-opex'])) return map;
    var out = JSON.parse(JSON.stringify(map));
    var entry = out.fields['dc-opex'];
    delete out.fields['dc-opex'];
    var keys = Object.keys(legacyFields || {});
    if (!keys.length || entry[0] !== 'yours') return out;
    var monthly = num(entry[1]);
    keys.forEach(function (key) {
      if (out.fields['dc-' + key]) return;
      var original = key === 'op-other_other' && monthly !== null && Number.isFinite(monthly) ? String(monthly * 12) : '';
      out.fields['dc-' + key] = [entry[0], original, entry[2], null];
    });
    return out;
  }

  /** An expense target someone hands you, set beside the expenses the calculator uses.
   * The target never replaces the expenses: a target below them is reported as its own
   * line, with the year-1 coverage it would show, so a plug cannot hide in the total.
   * args: targetPerUnitYear, usedAnnual (operating expenses used, a year), units, noi,
   * mustPayDebtService (year 1). */
  function expenseTargetCheck(args) {
    var out = { entered: false, target: null, used: null, difference: null, below: null, coverageAtTarget: null, coverageUsed: null, reason: null };
    var target = num(args.targetPerUnitYear);
    if (target === null) { out.reason = 'No expense target entered.'; return out; }
    out.entered = true;
    if (!Number.isFinite(target) || target < 0) { out.reason = 'Enter an expense target of $0 or more per unit per year.'; return out; }
    var units = num(args.units), used = num(args.usedAnnual);
    if (units === null || !Number.isFinite(units) || units <= 0) { out.reason = 'Enter the number of units.'; return out; }
    if (used === null || !Number.isFinite(used)) { out.reason = 'Operating expenses are unavailable.'; return out; }
    out.target = target; out.used = used / units;
    out.difference = out.used - target;
    out.below = out.difference > 0.5;
    var noi = num(args.noi), ds = num(args.mustPayDebtService);
    if (noi !== null && Number.isFinite(noi) && ds !== null && Number.isFinite(ds) && ds > 0) {
      out.coverageUsed = noi / ds;
      out.coverageAtTarget = (noi + out.difference * units) / ds;
    }
    return out;
  }

  return {
    GROUPS: GROUPS, LINE_TEMPLATE: LINE_TEMPLATE, INCOME_TEMPLATE: INCOME_TEMPLATE, SEPARATE_LINES: SEPARATE_LINES,
    EXAMPLE_BUDGET: EXAMPLE_BUDGET, EXAMPLE_INCOME: EXAMPLE_INCOME,
    exampleLines: exampleLines, exampleIncome: exampleIncome,
    summarizeOperating: summarizeOperating, pupaExpenses: pupaExpenses,
    legacyOperatingFields: legacyOperatingFields, legacyOperatingProvenance: legacyOperatingProvenance,
    expenseTargetCheck: expenseTargetCheck
  };
});
