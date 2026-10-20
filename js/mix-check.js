/**
 * mix-check.js — two checks every "ideal deal" recommendation on the site shares.
 *
 * 1. needNotes(): the full range of rental need, not only the homes-short counts.
 *    The ≤30/≤50/≤60% AMI shortfalls are cumulative (households minus homes priced
 *    for them) and can read 0 at a band whose renters still pay too much, because
 *    higher-income households occupy the cheaper homes. HUD CHAS cost burden by
 *    band (31–50, 51–80, 81–100% AMI) shows that need directly. The notes also test
 *    70–80% AMI units under income averaging against current rents, name the
 *    middle-income (80–120% AMI) route, and say the 20-year need is not split by
 *    income.
 *
 * 2. pencil(): does a rent tier, or a mix of them, pay its own operating costs for
 *    the 15-year pro forma CHFA underwrites? It uses only CHFA's minimum pro forma
 *    assumptions from data/policy/lihtc-underwriting-rules.json (vacancy, rent and
 *    expense growth, operating cost per unit, replacement reserve, debt coverage),
 *    each quoted from the Qualified Allocation Plan. It assumes the owner pays
 *    utilities, so a unit's rent is its full CHFA two-bedroom limit; with tenant-paid
 *    utilities the rent is lower by the utility allowance, so results are a ceiling.
 *    It sizes no loan: it reports the debt service the net income can carry at
 *    CHFA's minimum coverage in the weakest year, and the subsidy a tier needs.
 *
 * Pure, no DOM. An unknown input gives null with a reason, never 0.
 * Exposed as window.MixCheck and module.exports.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MixCheck = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var YEARS = 15;
  var TIERS = ['30', '40', '50', '60', '70', '80'];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function int(v) { return Math.round(v).toLocaleString('en-US'); }
  function money(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function pct(v) { return Math.round(v) + '%'; }

  // ------------------------------------------------------------ need notes

  // bands: [{ key: '31to50'|'51to80'|'81to100', label, households, burdenedPct (0–100) }]
  function burdenByBand(bands) {
    var out = {};
    (bands || []).forEach(function (b) {
      var h = num(b && b.households), p = num(b && b.burdenedPct);
      if (!b || ['31to50', '51to80', '81to100'].indexOf(b.key) === -1 || h === null || p === null) return;
      out[b.key] = { label: b.label, households: h, pct: p, burdened: Math.round(h * p / 100) };
    });
    return Object.keys(out).length ? out : null;
  }
  // A band counts when at least 25 households and a fifth of its renters are burdened.
  function material(b) { return !!b && b.burdened >= 25 && b.pct >= 20; }
  function rangeText(r) { return r.low === r.high ? money(r.low) : money(r.low) + '–' + money(r.high); }

  /**
   * opts: { burden (from burdenByBand), gap50 (cumulative ≤50% shortfall or null),
   *   lim70, lim80 (CHFA two-bedroom limits), rentRange: { low, high } of current rents
   *   for a recently leased home (FMR, Zillow, Apartment List; not ACS median),
   *   ruralResort (bool), mihtc: { name } or null, need20yr (number or null) }
   * Returns { notes: [string], workforce: object|null }.
   */
  function needNotes(opts) {
    var o = opts || {}, notes = [], burden = o.burden || null;
    var b3150 = burden && burden['31to50'];
    var gap50 = num(o.gap50);
    if (material(b3150) && gap50 !== null && gap50 < b3150.burdened) {
      notes.push(int(b3150.burdened) + ' renter households at 31–50% AMI (' + pct(b3150.pct) + ') pay more than 30% of income, though only ' + int(gap50) + ' homes are counted short at or below 50% AMI. Homes priced for this band exist, but higher-income renters occupy many of them, so the need here is real and 40–50% AMI units serve it.');
    }
    var b5180 = burden && burden['51to80'];
    if (material(b5180)) {
      var lim70 = num(o.lim70), lim80 = num(o.lim80), ask = o.rentRange || null;
      var lead = int(b5180.burdened) + ' renter households at 51–80% AMI (' + pct(b5180.pct) + ') pay more than 30% of income. Income averaging allows 70% and 80% AMI units if the average across units stays at or below 60%. ';
      var lims = 'The CHFA two-bedroom limits are ' + (lim70 === null ? 'not available' : money(lim70)) + ' at 70% and ' + (lim80 === null ? 'not available' : money(lim80)) + ' at 80%';
      if (!ask || lim70 === null) {
        notes.push(lead + 'No current rent is on file to test whether such units would lease.');
      } else if (lim80 !== null && lim80 <= ask.low) {
        notes.push(lead + lims + ', at or below every current rent measure here (' + rangeText(ask) + '), so 70–80% units should lease and serve this band.');
      } else if (lim70 > ask.high) {
        notes.push(lead + lims + ', above every current rent measure here (' + rangeText(ask) + '), so higher-band tax-credit units would not lease; these renters need homes below market, which takes deeper units or rental subsidy.');
      } else {
        notes.push(lead + lims + ', inside the range of current rent measures here (' + rangeText(ask) + '). Whether they lease depends on the site; the market study has to test it before 70–80% units go in the mix.');
      }
    }
    var b81 = burden && burden['81to100'];
    var workforce = null;
    if (material(b81) || o.ruralResort) {
      var m = o.mihtc || null;
      workforce = { burdened: b81 ? b81.burdened : null, pct: b81 ? b81.pct : null, ruralResort: !!o.ruralResort, program: m };
      notes.push((material(b81) ? int(b81.burdened) + ' renter households at 81–100% AMI (' + pct(b81.pct) + ') pay more than 30% of income. ' : 'This is a rural resort county, where workforce need runs above 80% AMI. ') +
        'Federal tax credits stop at 80% AMI. ' + (m ? 'The state ' + m.name + ' covers 80–120% AMI' + (o.ruralResort ? ' (up to 140% in rural resort counties such as this one)' : '') + ' as a separate deal; ' : 'A middle-income deal needs its own funding; ') +
        'the Deal Calculator does not size it yet.');
    }
    var n20 = num(o.need20yr);
    if (n20 !== null) {
      notes.push(n20 < 0
        ? 'The 20-year figure is a surplus of ' + int(Math.abs(n20)) + ' homes, because projected households fall here. It is one total, not split by income, so it does not set the mix.'
        : 'The 20-year need (' + int(n20) + ' homes) is one total, not split by income, and counts today\u2019s in-commuters who would move closer as well as resident growth, so it does not set the mix.');
    }
    return { notes: notes, workforce: workforce };
  }

  // Current rents a new unit competes with, from a list of { kind, rent } where kind is
  // 'fmr2br', 'zori' or 'apartmentList2br'. ACS median gross rent is left out on purpose.
  function rentRange(list) {
    var v = (list || []).map(function (r) { return num(r && r.rent); }).filter(function (x) { return x !== null && x > 0; });
    return v.length ? { low: Math.min.apply(null, v), high: Math.max.apply(null, v) } : null;
  }

  // ------------------------------------------------------------ pencil

  // The CHFA minimum pro forma assumptions, or { ok: false } with the missing rule named.
  // opts.senior picks the senior replacement reserve. A rule on file whose figure is
  // missing counts as missing, so the check never runs on $0 or 0%.
  function assumptions(rulesFile, opts) {
    var r = (rulesFile && rulesFile.rules) || {};
    var senior = !!(opts && opts.senior);
    function adopted(id) { return r[id] && r[id].status === 'adopted' && r[id].source ? r[id] : null; }
    var need = {
      vacancy: adopted('pro_forma_vacancy'), rentGrowth: adopted('pro_forma_rent_growth'),
      expGrowth: adopted('pro_forma_expense_growth'), pupa: adopted('pupa_minimum'),
      reserve: adopted('replacement_reserve_minimum'), dscr: adopted('min_debt_coverage')
    };
    var missing = Object.keys(need).filter(function (k) { return !need[k]; });
    if (missing.length) return { ok: false, reason: 'CHFA underwriting rule not on file: ' + missing.join(', ') };
    var a = {
      ok: true,
      vacancy: num(need.vacancy.rate), rentGrowth: num(need.rentGrowth.rate), expGrowth: num(need.expGrowth.rate),
      opex: num(need.pupa.per_unit_annual),
      reserve: num(senior ? need.reserve.senior_per_unit_annual : need.reserve.family_per_unit_annual),
      dscr: num(need.dscr.min_coverage),
      senior: senior,
      source: ((rulesFile.sources || {})[need.pupa.source] || {}).title || need.pupa.source
    };
    var bad = ['vacancy', 'rentGrowth', 'expGrowth', 'opex', 'reserve', 'dscr'].filter(function (k) {
      return a[k] === null || a[k] < 0 || (k === 'dscr' && a[k] === 0) || (k === 'vacancy' && a[k] >= 1);
    });
    if (bad.length) return { ok: false, reason: 'CHFA underwriting rule has no usable figure: ' + bad.join(', ') };
    return a;
  }

  // Per-unit net operating income for each year 1..15 at a monthly rent.
  function noiPath(rent, a) {
    var out = [];
    for (var y = 1; y <= YEARS; y++) {
      var egi = rent * 12 * (1 - a.vacancy) * Math.pow(1 + a.rentGrowth, y - 1);
      // Operating costs grow; the replacement reserve is its own flat CHFA minimum.
      var cost = a.opex * Math.pow(1 + a.expGrowth, y - 1) + a.reserve;
      out.push(egi - cost);
    }
    return out;
  }
  function summarizePath(path, a) {
    var weakest = Math.min.apply(null, path);
    var firstShort = null;
    for (var i = 0; i < path.length; i++) if (path[i] < 0) { firstShort = i + 1; break; }
    return {
      noi1: path[0], noi15: path[path.length - 1],
      // Must-pay debt service the weakest year can carry at CHFA's minimum coverage.
      debtServiceCapacity: weakest > 0 ? weakest / a.dscr : 0,
      firstShortYear: firstShort,
      subsidy15: path[path.length - 1] < 0 ? -path[path.length - 1] : 0
    };
  }
  // Highest yearly operating cost per unit (year-1 dollars, before the flat reserve) a
  // rent can bear and still break even in every year to 15. Costs grow faster than
  // rents, so the last year binds.
  function breakevenCost(rent, a) {
    var egi1 = rent * 12 * (1 - a.vacancy);
    var worst = Infinity;
    for (var y = 1; y <= YEARS; y++) worst = Math.min(worst, (egi1 * Math.pow(1 + a.rentGrowth, y - 1) - a.reserve) / Math.pow(1 + a.expGrowth, y - 1));
    return worst;
  }

  /**
   * pencil({ limits: { '30': rent2br, ... }, units: { '30': n, ... } optional, homes optional, rules, senior })
   * homes: [{ tier, bedrooms, rent, units }] prices the mix by bedroom size and wins over units.
   * Returns { ok, reason?, tiers: [{ tier, rent, noi1, noi15, debtServiceCapacity, firstShortYear, subsidy15 }],
   *   mix: { units, noi1, noi15, debtServiceCapacity, firstShortYear, subsidy15 } | null, assumptions }.
   * Figures are per unit per year; mix figures are for the whole mix.
   */
  function pencil(opts) {
    var o = opts || {};
    var a = assumptions(o.rules, { senior: o.senior });
    if (!a.ok) return { ok: false, reason: a.reason, tiers: [], mix: null, assumptions: null };
    var limits = o.limits || {};
    var tiers = TIERS.filter(function (t) { return num(limits[t]) !== null && num(limits[t]) > 0; }).map(function (t) {
      var s = summarizePath(noiPath(num(limits[t]), a), a);
      s.tier = t; s.rent = num(limits[t]); s.breakevenCost = breakevenCost(s.rent, a);
      return s;
    });
    if (!tiers.length) return { ok: false, reason: 'No CHFA rent limits on file for this county.', tiers: [], mix: null, assumptions: a };
    var mix = null;
    var units = o.units || null;
    if (o.homes) {
      // Homes priced at their own bedroom-size limit: [{ tier, bedrooms, rent, units }].
      var hTotal = 0, hPath = null, hUnpriced = [];
      o.homes.forEach(function (h) {
        var n = num(h && h.units);
        if (n === null || n <= 0) return;
        var rent = num(h.rent);
        if (rent === null || rent <= 0) { hUnpriced.push(h.tier + '% AMI ' + h.bedrooms); return; }
        hTotal += n;
        var hp = noiPath(rent, a).map(function (x) { return x * n; });
        hPath = hPath ? hPath.map(function (x, i) { return x + hp[i]; }) : hp;
      });
      if (hUnpriced.length) mix = { reason: 'No CHFA rent limit for ' + hUnpriced.join(', ') + ' homes.' };
      else if (hPath) { mix = summarizePath(hPath, a); mix.units = hTotal; mix.byBedroom = true; }
    } else if (units) {
      var total = 0, path = null, unpriced = [];
      Object.keys(units).forEach(function (t) {
        var n = num(units[t]);
        if (n === null || n <= 0) return;
        var rent = num(limits[t]);
        if (rent === null) { unpriced.push(t); return; }
        total += n;
        var p = noiPath(rent, a).map(function (x) { return x * n; });
        path = path ? path.map(function (x, i) { return x + p[i]; }) : p;
      });
      if (path && !unpriced.length) {
        mix = summarizePath(path, a);
        mix.units = total;
      } else if (unpriced.length) {
        mix = { reason: 'No CHFA rent limit for ' + unpriced.map(function (t) { return t + '%'; }).join(', ') + ' AMI units.' };
      }
    }
    return { ok: true, tiers: tiers, mix: mix, assumptions: a };
  }

  // One plain sentence on a pencil result for a mix, or null.
  function mixSentence(p) {
    if (!p || !p.ok || !p.mix || p.mix.reason) return p && p.mix && p.mix.reason ? p.mix.reason : null;
    var m = p.mix;
    if (m.firstShortYear === 1) return 'At CHFA\'s minimum underwriting assumptions this mix does not cover its own operating costs even in year 1 (' + money(m.noi1) + ' net operating income); it needs rental subsidy or operating support before any loan.';
    if (m.firstShortYear) return 'This mix covers its operating costs at first (' + money(m.noi1) + ' net operating income in year 1) but runs short in year ' + m.firstShortYear + ' as costs grow faster than rents, and is ' + money(m.subsidy15) + ' short by year 15. It needs rental subsidy or an operating reserve, and it can carry no must-pay loan.';
    return 'At CHFA\'s minimum underwriting assumptions this mix nets ' + money(m.noi1) + ' in year 1 and ' + money(m.noi15) + ' in year 15, enough to carry about ' + money(m.debtServiceCapacity) + ' a year of must-pay debt service at ' + p.assumptions.dscr.toFixed(2) + ' coverage through year 15.';
  }

  // One line per tier, for a short table or list.
  function tierLine(t) {
    if (t.firstShortYear === 1) return t.tier + '% AMI (' + money(t.rent) + '): short from year 1 by ' + money(-t.noi1) + ' a unit; needs subsidy.';
    if (t.firstShortYear) return t.tier + '% AMI (' + money(t.rent) + '): covers costs until year ' + (t.firstShortYear - 1) + ', then needs ' + money(t.subsidy15) + ' a unit by year 15.';
    return t.tier + '% AMI (' + money(t.rent) + '): ' + money(t.noi1) + ' a unit in year 1, ' + money(t.noi15) + ' in year 15; carries about ' + money(t.debtServiceCapacity) + ' a unit of yearly debt service.';
  }

  function assumptionsLine(a, opts) {
    if (!a) return '';
    var rentNote = opts && opts.byBedroom
      ? ' The mix is priced at each bedroom size\'s limit and the tiers at the two-bedroom limit, with the owner paying utilities, so these figures are a ceiling.'
      : ' Rent is the two-bedroom limit with the owner paying utilities, so these figures are a ceiling.';
    return 'CHFA minimum pro forma assumptions (' + a.source + '): ' + Math.round(a.vacancy * 100) + '% vacancy, rents +' + Math.round(a.rentGrowth * 100) + '% and costs +' + Math.round(a.expGrowth * 100) + '% a year, ' +
      money(a.opex) + ' operating cost plus ' + money(a.reserve) + (a.senior ? ' senior' : '') + ' replacement reserve per unit per year (the reserve held flat), ' + a.dscr.toFixed(2) + ' minimum debt coverage over 15 years.' + rentNote;
  }

  return {
    YEARS: YEARS, TIERS: TIERS,
    burdenByBand: burdenByBand, material: material, needNotes: needNotes, rentRange: rentRange,
    assumptions: assumptions, pencil: pencil, breakevenCost: breakevenCost, mixSentence: mixSentence, tierLine: tierLine, assumptionsLine: assumptionsLine
  };
}));
