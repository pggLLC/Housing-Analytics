/**
 * agency-funding-model.js — the numbers behind the agency funding view (js/agency-funding.js).
 *
 * Pure functions, no DOM: the page and test/agency-funding.test.mjs both call
 * them. Every award comes from a file that quotes its source:
 *   - CHFA tax credits and OEDIT Prop 123 awards: data/policy/funding-awards/
 *     ledger.json (scripts/funding/build_funding_awards.py, each award PDF
 *     checked against the total it prints), with the cleaned names and the row
 *     as printed from award-rows.json when that file has the row.
 *   - DOLA Division of Housing awards: data/policy/funding-awards/
 *     dola-awards.json, read by hand from DOLA's announcements, each with the
 *     sentence it rests on.
 *
 * The three agencies award different things, so they are never added together
 * as money: CHFA awards tax credits (stated per year), OEDIT and DOLA award
 * grants and loans (dollars). The one measure all three report is homes, so
 * "All agencies" is measured in homes.
 */
(function (global) {
  'use strict';

  var AGENCIES = {
    CHFA: {
      label: 'CHFA',
      name: 'Colorado Housing and Finance Authority',
      plain: 'CHFA is the state housing finance agency. It hands out federal and state housing tax credits, which developers sell to investors to pay for building affordable rentals.',
      measure: 'credits',
    },
    OEDIT: {
      label: 'OEDIT',
      name: 'Office of Economic Development and International Trade',
      plain: 'OEDIT is the state economic development office. It runs the voter-approved Prop 123 fund (with CHFA doing the paperwork), which buys land and lends to or invests in new affordable homes.',
      measure: 'dollars',
    },
    DOLA: {
      label: 'DOLA',
      name: 'Department of Local Affairs, Division of Housing',
      plain: 'DOLA\'s Division of Housing makes grants and loans to build and keep affordable homes, approved by the State Housing Board, and runs the local part of Prop 123. Its Division of Local Government also gives towns and counties grants for housing projects (marked DLG).',
      measure: 'dollars',
    },
  };

  var HELD_BACK = ['cc3bcd0', '83f603b9'];
  function heldBackHash(s) {
    var h = 0x811c9dc5;
    for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }
  function heldBack(text) {
    // Rows held back from public lists by a standing data rule. The two name
    // words are matched by hash so the rule names nothing; otherwise this is
    // the same test as an unanchored, case-blind "A\s+B\s+(phase\s+)?(ii|2)\b".
    // Only A-Z fold to lower case, as in a non-Unicode /i pattern.
    var t = String(text || '').split(/\s+/);
    var low = function (x) { return x.replace(/[A-Z]/g, function (c) { return c.toLowerCase(); }); };
    var a = HELD_BACK[0], b = HELD_BACK[1];
    var tail = /^(ii|2)(?![a-z0-9_])/i;
    for (var i = 0; i + 2 < t.length; i++) {
      if (t[i].length < 6 || heldBackHash(low(t[i].slice(-6))) !== a || heldBackHash(low(t[i + 1])) !== b) continue;
      if (tail.test(t[i + 2]) || (/^phase$/i.test(t[i + 2]) && i + 3 < t.length && tail.test(t[i + 3]))) return true;
    }
    return false;
  }

  function isExcluded(name) {
    return heldBack(name);
  }

  function agencyOf(raw) {
    var a = String(raw || '').toUpperCase();
    if (a.indexOf('OEDIT') !== -1 || a.indexOf('PROP 123') !== -1) return 'OEDIT';
    if (a.indexOf('DOLA') !== -1 || a.indexOf('DIVISION OF HOUSING') !== -1) return 'DOLA';
    if (a.indexOf('CHFA') !== -1) return 'CHFA';
    return null;
  }

  // The four Prop 123 fund programs, as the selection lists name them.
  // Concessionary debt is loans; the others are not, so they are never mixed.
  var OEDIT_KINDS = {
    loans: { label: 'Loans', head: 'OEDIT loans $', tip: 'Prop 123 Concessionary Debt: below-market loans to affordable rental projects, in dollars.' },
    equity: { label: 'Equity', head: 'OEDIT equity $', tip: 'Prop 123 Equity: money invested in a project for a share of it, in dollars.' },
    land: { label: 'Land banking', head: 'OEDIT land $', tip: 'Prop 123 Land Banking: grants and forgivable loans to buy land for affordable homes, in dollars.' },
    modular: { label: 'Modular factories', head: 'OEDIT modular $', tip: 'Prop 123 Modular Finance: money for factories that build homes, not for a housing site, in dollars.' },
  };

  function oeditKind(program) {
    var p = String(program || '');
    if (/concessionary|debt/i.test(p)) return 'loans';
    if (/equity/i.test(p)) return 'equity';
    if (/land/i.test(p)) return 'land';
    if (/modular/i.test(p)) return 'modular';
    return null;
  }

  function num(v) {
    // Absence stays null: Number(null) is 0, and 0 is a real amount.
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function sumOrNull(values) {
    var total = null;
    values.forEach(function (v) { if (v !== null) total = (total || 0) + v; });
    return total;
  }

  // "Gorman & Company, LLC", "Gorman & Company, Inc." and "Gorman & Company"
  // are one developer. Legal suffixes, punctuation and a trailing acronym in
  // brackets do not tell developers apart; anything else does.
  // Only a trailing legal form is dropped: "Gorman & Company, LLC" becomes
  // "gorman and company", not "gorman and".
  var SUFFIX = / (llc|lllp|llp|lp|l p|ltd|inc|incorporated|corp|corporation)$/;
  function developerKey(name) {
    if (!name) return null;
    var s = String(name).toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\u00c0-\u024f ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    var prev;
    do { prev = s; s = s.replace(SUFFIX, '').trim(); } while (s !== prev);
    s = s.replace(/^the /, '').trim();
    return s || null;
  }

  function yearLabel(a) {
    return a.fiscalYear ? 'FY' + String(a.fiscalYear).replace(/^FY\s*/i, '') : (a.year ? String(a.year) : '');
  }

  /**
   * One record per award, whichever agency made it.
   * opts: { ledger, documents, rows, dola, aliases, counties }
   *   counties: { '08001': { name: 'Adams', population: 530225 }, ... }
   */
  function normalise(opts) {
    var counties = opts.counties || {};
    var docs = {};
    ((opts.documents && opts.documents.documents) || []).forEach(function (d) { docs[d.file] = d; });
    var rowsByKey = {};
    ((opts.rows && opts.rows.rows) || []).forEach(function (r) { rowsByKey[r.key] = r; });
    var aliases = (opts.aliases && opts.aliases.developers) || {};
    var checked = opts.ledger && opts.ledger.meta && opts.ledger.meta.generated_at;
    var out = [];
    var keys = ledgerKeys((opts.ledger && opts.ledger.awards) || []);

    ((opts.ledger && opts.ledger.awards) || []).forEach(function (r, i) {
      var agency = agencyOf(r.agency);
      if (!agency) return;
      var clean = rowsByKey[keys[i]] || null;
      var name = clean && clean.name ? clean.name : r.name;
      if (isExcluded(name) || isExcluded(r.name)) return;
      var doc = docs[r.source_file] || {};
      var credits = agency === 'CHFA'
        ? sumOrNull([num(r.federal_credit), num(r.state_credit), num(r.toc_credit), num(r.mihtc_credit)])
        : null;
      var awarded = num(r.amount_awarded);
      var requested = num(r.amount_requested);
      var dollars = agency === 'CHFA' ? null : (awarded !== null ? awarded : requested);
      out.push(finish({
        id: 'L' + i,
        agency: agency,
        program: r.program,
        year: num(r.year),
        fiscalYear: r.fiscal_year || null,
        name: name || null,
        developerRaw: clean && clean.name ? clean.sponsor : r.sponsor,
        // An owner column can print a partnership formed for the one project, so it is shown as an owner.
        developerRole: clean && clean.name && /owner/i.test(clean.sponsor_heading || '') ? 'owner' : null,
        town: clean && clean.name ? clean.location : r.location,
        countyFips: r.county_fips || null,
        dollars: dollars,
        dollarsBasis: agency === 'CHFA' ? null : (awarded !== null ? 'awarded' : (requested !== null ? 'requested' : null)),
        credits: credits,
        // Bonds are a loan to the project, not credits or grants, so they are kept apart.
        bonds: agency === 'CHFA' ? num(r.bond_amount) : null,
        oeditKind: agency === 'OEDIT' ? oeditKind(r.program) : null,
        federalCredit: num(r.federal_credit),
        stateCredit: num(r.state_credit),
        homes: num(r.restricted_units) !== null ? num(r.restricted_units) : num(r.total_units),
        homesEstimated: /land banking/i.test(r.program || ''),
        sourceTitle: shortSource(agency, r, doc),
        sourceUrl: r.source_url || doc.url || null,
        sourceChecked: checked || null,
        quote: clean ? clean.quote : null,
        confirmed: r.reconciled === true,
      }, counties, aliases));
    });

    ((opts.dola && opts.dola.awards) || []).forEach(function (r, i) {
      if (isExcluded(r.name)) return;
      out.push(finish({
        id: 'D' + i,
        agency: 'DOLA',
        program: r.program || null,
        year: num(r.year) !== null ? num(r.year) : (r.announced ? Number(String(r.announced).slice(0, 4)) : null),
        fiscalYear: null,
        name: r.name || null,
        developerRaw: r.grantee || null,
        town: r.town || null,
        countyFips: r.county_fips || null,
        dollars: num(r.amount),
        dollarsBasis: num(r.amount) !== null ? (r.amount_basis === 'requested' ? 'requested' : 'awarded') : null,
        credits: null,
        bonds: null,
        oeditKind: null,
        homes: num(r.homes),
        homesEstimated: false,
        sourceTitle: r.source_title || 'DOLA announcement',
        sourceUrl: r.source_url || null,
        sourceChecked: r.announced || null,
        sourceDated: true,
        quote: r.quote || null,
        confirmed: r.confirmed === true,
      }, counties, aliases));
    });
    return out;
  }

  // "CHFA 2026 Round One award report", not the PDF's three-line heading.
  var ROUND = { 1: 'Round One', 2: 'Round Two', 3: 'Round Three' };
  function shortSource(agency, r, doc) {
    if (agency === 'OEDIT') {
      return 'Prop 123 ' + String(r.program || '').replace(/^Prop 123 /, '') + ' list' + (r.fiscal_year ? ', ' + r.fiscal_year : '');
    }
    var y = doc.year || r.year;
    if (/MIHTC/.test(r.program || '')) return 'CHFA ' + (y || '') + ' middle-income credit award report';
    if (!doc.year && /4%/.test(r.program || '')) return 'CHFA federal 4% credit award list';
    return 'CHFA ' + (y || '') + (doc.round || r.round ? ' ' + (ROUND[doc.round || r.round] || 'Round ' + (doc.round || r.round)) : '') + ' award report';
  }

  function ledgerKey(r) {
    // Stable across re-parses of the same PDF: the file, the project as the
    // parser read it, and the amount the row carries.
    var amount = r.amount_awarded != null ? r.amount_awarded
      : r.amount_requested != null ? r.amount_requested
      : r.federal_credit != null ? r.federal_credit
      : r.mihtc_credit != null ? r.mihtc_credit : '';
    var units = r.restricted_units != null ? r.restricted_units : r.total_units;
    return [r.source_file, amount, units == null ? '' : units].join('|');
  }

  // Awards that share file, amount and units get a counter in ledger order.
  // Must equal ledger_keys() in scripts/funding/build_award_rows.py.
  function ledgerKeys(awards) {
    var seen = {};
    return awards.map(function (r) {
      var b = ledgerKey(r);
      seen[b] = (seen[b] || 0) + 1;
      return b + '#' + seen[b];
    });
  }

  function finish(a, counties, aliases) {
    var c = a.countyFips && counties[a.countyFips];
    a.county = c ? c.name + ' County' : null;
    var key = developerKey(a.developerRaw);
    var alias = key && aliases[key];
    a.developerKey = alias ? alias.key : key;
    a.developer = alias ? alias.name : (a.developerRaw || null);
    a.yearLabel = yearLabel(a);
    return a;
  }

  function filter(awards, f) {
    f = f || {};
    return awards.filter(function (a) {
      if (f.agency && f.agency !== 'ALL' && a.agency !== f.agency) return false;
      if (f.from != null && (a.year === null || a.year < f.from)) return false;
      if (f.to != null && (a.year === null || a.year > f.to)) return false;
      if (f.county && a.countyFips !== f.county) return false;
      if (f.town && (a.town || '').toLowerCase() !== String(f.town).toLowerCase()) return false;
      if (f.developer && a.developerKey !== f.developer) return false;
      return true;
    });
  }

  function summarise(awards) {
    var s = { awards: awards.length, dollars: null, credits: null, bonds: null, homes: null, homesEstimated: false, byAgency: {} };
    awards.forEach(function (a) {
      if (a.dollars !== null) s.dollars = (s.dollars || 0) + a.dollars;
      if (a.credits !== null) s.credits = (s.credits || 0) + a.credits;
      if (a.bonds) s.bonds = (s.bonds || 0) + a.bonds;
      if (a.homes !== null) s.homes = (s.homes || 0) + a.homes;
      if (a.homes !== null && a.homesEstimated) s.homesEstimated = true;
      var b = s.byAgency[a.agency] || (s.byAgency[a.agency] = { awards: 0, dollars: null, credits: null, bonds: null, homes: null, byKind: {} });
      b.awards += 1;
      if (a.dollars !== null) b.dollars = (b.dollars || 0) + a.dollars;
      if (a.credits !== null) b.credits = (b.credits || 0) + a.credits;
      if (a.bonds) b.bonds = (b.bonds || 0) + a.bonds;
      if (a.oeditKind && a.dollars !== null) b.byKind[a.oeditKind] = (b.byKind[a.oeditKind] || 0) + a.dollars;
      if (a.homes !== null) b.homes = (b.homes || 0) + a.homes;
    });
    return s;
  }

  // The headline number for the chosen agency: money for one agency, homes
  // for all three together.
  function measureOf(summary, agency) {
    if (!agency || agency === 'ALL') return summary.homes;
    return AGENCIES[agency].measure === 'credits' ? summary.credits : summary.dollars;
  }

  var GROUPS = {
    county: function (a) { return a.countyFips ? { key: a.countyFips, label: a.county } : { key: '_none', label: 'Statewide, several counties, or no place printed' }; },
    town: function (a) { return a.town ? { key: a.town.toLowerCase(), label: a.town } : { key: '_none', label: 'No town printed' }; },
    developer: function (a) { return a.developerKey ? { key: a.developerKey, label: a.developer } : { key: '_none', label: 'Not named on the award list' }; },
    agency: function (a) { return { key: a.agency, label: AGENCIES[a.agency].label }; },
  };

  function group(awards, by) {
    var pick = GROUPS[by] || GROUPS.county;
    var map = {};
    var order = [];
    awards.forEach(function (a) {
      var g = pick(a);
      if (!map[g.key]) { map[g.key] = { key: g.key, label: g.label, awards: [] }; order.push(g.key); }
      map[g.key].awards.push(a);
    });
    return order.map(function (k) {
      var g = map[k];
      var s = summarise(g.awards);
      g.summary = s;
      return g;
    });
  }

  // The flow diagram: which program paid for the homes (left) and the region
  // of the county printed on the award (right). Measured in homes, the one
  // thing every agency prints, so credits and dollars are never added.
  // DOLA prints many program names; they fold into three groups.
  var PROGRAMS = [
    { key: 'chfa-4', agency: 'CHFA', label: '4% tax credits', test: /4%/ },
    { key: 'chfa-9', agency: 'CHFA', label: '9% tax credits', test: /9%/ },
    { key: 'chfa-mi', agency: 'CHFA', label: 'Middle-income tax credits', test: /MIHTC|middle/i },
    { key: 'chfa-other', agency: 'CHFA', label: 'Other CHFA tax credits', test: /./ },
    { key: 'oedit-land', agency: 'OEDIT', label: 'Prop 123 land banking', test: /land bank/i },
    { key: 'oedit-debt', agency: 'OEDIT', label: 'Prop 123 low-interest loans', test: /concessionary|debt/i },
    { key: 'oedit-modular', agency: 'OEDIT', label: 'Prop 123 modular', test: /modular/i },
    { key: 'oedit-equity', agency: 'OEDIT', label: 'Prop 123 equity', test: /equity/i },
    { key: 'oedit-other', agency: 'OEDIT', label: 'Other Prop 123 fund awards', test: /./ },
    { key: 'dola-state', agency: 'DOLA', label: 'State grants and loans', test: null },
    { key: 'dola-123', agency: 'DOLA', label: 'Prop 123 support fund', test: /prop\s*123|AHOP/i },
    { key: 'dola-federal', agency: 'DOLA', label: 'Federal grants', long: 'Federal HOME, CDBG and Housing Trust Fund grants', test: /\((federal)\)|^HOME\b|CDBG|Housing Trust Fund/ },
    { key: 'dola-local', agency: 'DOLA', label: 'Local government grants', long: 'Division of Local Government grants to towns and counties for housing projects', test: /^DLG\b/ },
  ];
  var NO_REGION = { key: '_none', label: 'No single county printed' };

  function programOf(a) {
    var p = String(a.program || '');
    var own = PROGRAMS.filter(function (g) { return g.agency === a.agency; });
    if (a.agency === 'DOLA') {
      // Federal first: "HOME (federal)" is not a homeownership program.
      var fed = own.filter(function (g) { return g.key === 'dola-federal'; })[0];
      if (fed.test.test(p)) return fed;
      var local = own.filter(function (g) { return g.key === 'dola-local'; })[0];
      if (local.test.test(p)) return local;
      var p123 = own.filter(function (g) { return g.key === 'dola-123'; })[0];
      return p123.test.test(p) ? p123 : own.filter(function (g) { return g.key === 'dola-state'; })[0];
    }
    for (var i = 0; i < own.length; i++) if (own[i].test.test(p)) return own[i];
    return null;
  }

  // regionOf: county FIPS -> region label. Awards with no home count are
  // counted, not drawn, so a reader sees how many are missing.
  function flows(awards, regionOf, regionOrder) {
    var left = {}, right = {}, links = {};
    var out = { left: [], right: [], links: [], homes: 0, withoutHomes: 0, estimated: false };
    awards.forEach(function (a) {
      if (a.homes === null || a.homes <= 0) { out.withoutHomes += 1; return; }
      var g = programOf(a);
      if (!g) { out.withoutHomes += 1; return; }
      var rLabel = a.countyFips && regionOf[a.countyFips];
      var r = rLabel ? { key: rLabel, label: rLabel } : NO_REGION;
      if (!left[g.key]) left[g.key] = { key: g.key, label: g.label, agency: g.agency, homes: 0, estimated: false };
      if (!right[r.key]) right[r.key] = { key: r.key, label: r.label, homes: 0 };
      var lk = g.key + '>' + r.key;
      if (!links[lk]) links[lk] = { from: g.key, to: r.key, agency: g.agency, homes: 0 };
      left[g.key].homes += a.homes;
      right[r.key].homes += a.homes;
      links[lk].homes += a.homes;
      if (a.homesEstimated) { left[g.key].estimated = true; out.estimated = true; }
      out.homes += a.homes;
    });
    // Programs in a fixed order, grouped by agency; regions largest first,
    // with "no single county" last.
    out.left = PROGRAMS.filter(function (g) { return left[g.key]; }).map(function (g) { return left[g.key]; });
    var order = regionOrder || [];
    out.right = Object.keys(right).map(function (k) { return right[k]; }).sort(function (x, y) {
      return (x.key === '_none') - (y.key === '_none') || y.homes - x.homes || order.indexOf(x.key) - order.indexOf(y.key);
    });
    var li = {}, ri = {};
    out.left.forEach(function (n, i) { li[n.key] = i; });
    out.right.forEach(function (n, i) { ri[n.key] = i; });
    out.links = Object.keys(links).map(function (k) { return links[k]; }).sort(function (x, y) {
      return li[x.from] - li[y.from] || ri[x.to] - ri[y.to];
    });
    return out;
  }

  function perResident(value, population) {
    if (value === null || !population || population <= 0) return null;
    return value / population;
  }

  function csv(awards) {
    var head = ['Agency', 'Program', 'Year', 'Project', 'Developer', 'Town', 'County',
      'Grant or loan dollars', 'Dollar basis', 'Prop 123 program type', 'Tax credits per year', 'Bond amount (CHFA 4% report)', 'Homes', 'Homes estimated',
      'Checked against the PDF total', 'Source', 'Source link', 'Source quote'];
    var lines = [head];
    awards.forEach(function (a) {
      lines.push([a.agency, a.program, a.yearLabel, a.name, a.developer, a.town, a.county,
        a.dollars, a.dollarsBasis, a.oeditKind ? OEDIT_KINDS[a.oeditKind].label : null, a.credits, a.bonds, a.homes, a.homesEstimated ? 'yes' : 'no',
        a.confirmed ? 'yes' : 'no', a.sourceTitle, a.sourceUrl, a.quote]);
    });
    return lines.map(function (row) {
      return row.map(function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  var api = {
    AGENCIES: AGENCIES,
    OEDIT_KINDS: OEDIT_KINDS,
    oeditKind: oeditKind,
    isExcluded: isExcluded,
    agencyOf: agencyOf,
    developerKey: developerKey,
    ledgerKey: ledgerKey,
    ledgerKeys: ledgerKeys,
    normalise: normalise,
    filter: filter,
    summarise: summarise,
    measureOf: measureOf,
    group: group,
    perResident: perResident,
    PROGRAMS: PROGRAMS,
    programOf: programOf,
    flows: flows,
    csv: csv,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AgencyFundingModel = api;
})(typeof window !== 'undefined' ? window : this);
