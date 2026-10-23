/**
 * town-questions.js — the questions to ask a town, for the Jurisdiction Report.
 *
 * Two lists:
 *  - standard questions, asked of every town, each tied to the CHFA QAP threshold or
 *    scoring line that makes the answer matter (data/policy/chfa-2027-r1-scoring.json);
 *  - pointed questions, each set off by one signal in this place's own data, and
 *    printed with the figure that set it off and the file it came from.
 *
 * The wording lives in the private question bank (coho-backend
 * gated/data/jurisdiction-briefs/_town-questions.json), served on the gated site only.
 * This module holds the signals: what in the data fires a question. Without the bank
 * the report says the questions load on the gated site.
 *
 * Every figure comes from the report model built by jurisdiction-whitepaper.js; a
 * signal whose data is missing does not fire (unknown is never read as zero).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TownQuestions = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_POINTED = 8;
  var DROUGHT_YEARS = 6;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function int(v) { return Math.round(v).toLocaleString('en-US'); }
  function money(v) { return '$' + int(v); }
  function pct(v) { return Math.round(v) + '%'; }

  // Each signal reads the model and returns null (does not fire) or the values the
  // question's wording may use, the evidence line printed under it, and its source.
  var SIGNALS = {
    tax_credit_drought: function (m, today) {
      var props = m.lihtc.properties || [];
      var last = m.lihtc.latestAwardYear;
      var year = Number(today.slice(0, 4));
      if (!props.length && last === null) {
        // Projects mapped inside the boundary contradict an empty name-matched list:
        // the record is unclear, not empty, so no question is raised.
        if (m.lihtc.inBoundary === null || m.lihtc.inBoundary === undefined || m.lihtc.inBoundary > 0) return null;
        return { vars: { lastYear: 'never' }, evidence: 'No CHFA tax-credit property is recorded or mapped in ' + m.lihtc.scopeLabel + '.', source: [m.lihtc.sources[0], m.need.rankingSource].filter(Boolean).join('; ') };
      }
      if (last !== null && year - last >= DROUGHT_YEARS) {
        return { vars: { lastYear: String(last), years: String(year - last) }, evidence: 'Latest tax-credit award here: ' + last + ', ' + (year - last) + ' years ago.', source: m.need.rankingSource };
      }
      return null;
    },
    unfunded_application: function (m) {
      var apps = (m.lihtc.applications || []).filter(function (a) { return a.outcome === 'not_awarded' && a.name; });
      if (!apps.length) return null;
      var a = apps[0];
      return {
        vars: { project: a.name, year: String(a.year), round: a.round_label || String(a.year) },
        evidence: apps.length + ' application' + (apps.length === 1 ? '' : 's') + ' here not funded; latest ' + a.name + ' (' + (a.round_label || a.year) + ').',
        source: 'data/jurisdiction-briefs/_lihtc-applications.json (CHFA applicant reports)'
      };
    },
    rent_above_market: function (m) {
      var r = m.deal.rentCheck;
      if (!r || r.limit60 === null) return null;
      var over = [], sources = [m.rents.limitsSource];
      if (r.fmr !== null && r.limit60 > r.fmr) { over.push('HUD fair market rent ' + money(r.fmr)); sources.push(m.rents.fmrSource); }
      if (r.median !== null && r.limit60 > r.median) { over.push('median gross rent ' + money(r.median)); sources.push(m.need.rankingSource); }
      if (!over.length) return null;
      return {
        vars: { limit60: money(r.limit60), properties: String((m.lihtc.properties || []).length) },
        evidence: 'CHFA 60% AMI two-bedroom limit ' + money(r.limit60) + ' is above ' + over.join(' and ') + '.',
        source: sources.filter(Boolean).join('; ')
      };
    },
    deep_gap: function (m) {
      var n = m.need;
      if (n.gap30 === null || n.gap60 === null || !(n.gap30 > 0) || !(n.gap60 < n.gap30)) return null;
      return {
        vars: { gap30: int(n.gap30), gap60: int(n.gap60) },
        evidence: int(n.gap30) + ' rental homes short at or below 30% AMI against ' + int(n.gap60) + ' at or below 60%.',
        source: n.rankingSource
      };
    },
    burden_without_gap: function (m) {
      var n = m.need;
      if (n.gap50 === null || n.gap60 === null) return null;
      var hit = (n.bands || []).filter(function (b) {
        // Only the 31-50% band has a matching shortage measure (gap50); nothing here
        // measures supply at 80% AMI, so the 51-80% band is never compared.
        return b.key === '31to50' && n.gap50 === 0 && num(b.burdenedPct) !== null && b.burdenedPct >= 50;
      })[0];
      if (!hit) return null;
      return {
        vars: { band: hit.label, burdened: pct(hit.burdenedPct) },
        evidence: pct(hit.burdenedPct) + ' of renters at ' + hit.label + ' pay over 30% of income, though no homes are counted short for them.',
        source: [n.chasSource, n.rankingSource].filter(Boolean).join('; ')
      };
    },
    // A census-designated place has no government of its own; its county's filing applies.
    prop123_not_filed: function (m) {
      var cdp = m.kind === 'cdp';
      if (cdp ? m.prop123.countyRecord : m.prop123.record) return null;
      return { vars: {}, evidence: 'No Prop 123 commitment for ' + (cdp ? m.countyName : m.name) + ' on DOLA\'s list (updated ' + (m.prop123.updated || 'date not recorded') + ').', source: m.prop123.source };
    },
    prop123_no_fast_track: function (m) {
      var p = m.kind === 'cdp' ? m.prop123.countyRecord : m.prop123.record;
      if (!p || p.fast_track !== false) return null;
      return { vars: { status: String(p.status || '') }, evidence: 'Prop 123 commitment ' + (p.status || 'on file') + ', filed ' + (p.filing_date || 'date not recorded') + '; no fast-track process on DOLA\'s list.', source: m.prop123.source };
    },
    no_local_money: function (m) {
      if (m.policy.funds.length || m.policy.fees.length) return null;
      return { vars: {}, evidence: 'No local housing fund or fee relief is on file for ' + m.name + ' or its county.', source: m.policy.sources.join(', ') };
    },
    land_banked: function (m) {
      var lb = m.prop123.landBanking;
      var a = lb && lb.awards && lb.awards[0];
      if (!a) return null;
      return {
        vars: { project: a.project || 'the banked site', sponsor: a.sponsor || 'the award holder', round: a.round || '' },
        evidence: lb.awards.length + ' Prop 123 land banking award' + (lb.awards.length === 1 ? '' : 's') + ' here; ' + (a.project || 'project not named') + (a.sponsor ? ', to ' + a.sponsor : '') + (a.round ? ' (' + a.round + ')' : '') + '.',
        source: lb.source
      };
    },
    qct_partial: function (m) {
      var q = m.need.qctSharePct, d = m.need.ddaSharePct;
      if (q === null || d === null || !(q > 0 && q < 100) || d >= 99) return null;
      return { vars: { qct: pct(q) }, evidence: pct(q) + ' of the area is in a Qualified Census Tract; no area-wide DDA.', source: m.need.rankingSource };
    },
    no_partner: function (m) {
      var L = m.landscape;
      var agencies = L.research ? L.research.groups.filter(function (g) { return g.key === 'agencies' && g.items.length; }).length : 0;
      var C = m.contacts || {};
      var known = (C.orgs || []).some(function (o) { return o.role === 'Housing authority' || o.role === 'Housing lead'; }) || (C.partners || []).length;
      if (L.authorities.length || L.stewards.length || agencies || known) return null;
      return { vars: {}, evidence: 'No housing authority, regional nonprofit or local housing agency is on file for this area.', source: L.sources.filter(Boolean).join(', ') };
    },
    senior_growth: function (m) {
      var g = m.need.seniorGrowthPp;
      if (g === null || g < 5) return null;
      return { vars: { points: g.toFixed(1) }, evidence: 'The senior share of residents is projected to rise ' + g.toFixed(1) + ' percentage points.', source: m.need.rankingSource };
    },
    seasonal_homes: function (m) {
      var s = m.need.seasonalSharePct;
      if (s === null || s < 40) return null;
      return { vars: { share: pct(s) }, evidence: pct(s) + ' of vacant homes are held for seasonal or occasional use.', source: m.need.rankingSource };
    },
    commuters: function (m) {
      var c = m.need.inCommuters, jobs = m.need.lowWageJobs;
      if (c === null || c < 500) return null;
      return {
        vars: { inCommuters: int(c), jobs: jobs !== null ? int(jobs) : 'local' },
        evidence: int(c) + ' workers commute in' + (jobs !== null ? '; ' + int(jobs) + ' low-wage jobs are based here' : '') + '.',
        source: m.need.rankingSource
      };
    }
  };

  function fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, function (all, k) { return vars[k] !== undefined ? vars[k] : all; });
  }

  // The named person for a role, from the researched contacts: matched on the
  // contact's role, never a state agency's staff (bank.exclude), and someone at this
  // town or county before anyone else.
  function contactFor(role, bank, contacts, placeName, kind) {
    var r = bank.roles && bank.roles[role];
    if (!r || !r.match) return null;
    var re, ex = null;
    try { re = new RegExp(r.match, 'i'); if (bank.exclude) ex = new RegExp(bank.exclude, 'i'); } catch (e) { return null; }
    var hits = (contacts || []).filter(function (c) {
      var text = String(c.role || '') + ' ' + String(c.org || '');
      return re.test(String(c.role || '')) && !(ex && ex.test(text));
    });
    // At this jurisdiction: the org names the place, and a town's contact is not the county's.
    var place = String(placeName || '').toLowerCase();
    function here(c) {
      var org = String(c.org || '').toLowerCase();
      // Denver and Broomfield are consolidated: "City and County of X" is the place itself.
      return !!place && org.indexOf(place) !== -1 && (kind === 'county' || !/county/.test(org.replace('city and county of ' + place, '')));
    }
    // A role marked local (manager, planner, board) is asked only of this jurisdiction's own staff.
    if (r.local) hits = hits.filter(here);
    hits.sort(function (a, b) { return (here(a) ? 0 : 1) - (here(b) ? 0 : 1); });
    var hit = hits[0];
    return hit ? { name: hit.name, role: hit.role || null, org: hit.org || null, url: hit.source_url, quote: hit.source_quote } : null;
  }

  // The QAP line or threshold a standard question rests on, quoted from the scoring file.
  function qapRef(id, scoring) {
    if (!id || !scoring) return null;
    var all = (scoring.thresholds || []).concat(scoring.lines || []);
    var hit = all.filter(function (x) { return x.id === id; })[0];
    if (!hit) return null;
    return {
      id: id, label: hit.label, page: hit.page || null, section: hit.section || (/^T\d+$/.test(id) ? 'Threshold ' + id.slice(1) : null), quote: hit.quote,
      draft: scoring.status === 'draft', title: (scoring.source || {}).title || null, url: (scoring.source || {}).url || null
    };
  }

  /**
   * build(model, bank, scoring, today) -> { standard, pointed, firedNotShown, bankChecked } | { missing: true }
   * bank: the private question bank; scoring: the CHFA QAP scoring file.
   */
  function build(m, bank, scoring, today) {
    if (!bank || !Array.isArray(bank.standard) || !Array.isArray(bank.pointed)) return { missing: true };
    var roles = bank.roles || {};
    // A census-designated place has no government of its own: its county is asked.
    var cdp = m.kind === 'cdp';
    var govName = cdp ? m.countyName : m.name, govKind = cdp ? 'county' : m.kind;
    // A CDP rarely has its own contact file; its county's researched contacts are in related.
    var contacts = ((m.contacts && m.contacts.researched) || []).concat(cdp ? [].concat.apply([], ((m.contacts && m.contacts.related) || []).map(function (f) { return f.contacts || []; })) : []);
    var vars = { name: govName, county: m.countyName };
    function who(role) {
      return { role: role, roleLabel: (roles[role] && roles[role].label) || role, contact: contactFor(role, bank, contacts, govName, govKind) };
    }
    var standard = bank.standard.map(function (q) {
      return Object.assign(who(q.role), { id: q.id, ask: fill(q.ask, vars), why: q.why || null, qap: qapRef(q.qap, scoring) });
    });
    var fired = [];
    bank.pointed.forEach(function (q) {
      var fn = SIGNALS[q.signal];
      if (!fn) return;
      var s = fn(m, today || m.generated);
      if (!s) return;
      var v = Object.assign({}, vars, s.vars);
      fired.push(Object.assign(who(q.role), { id: q.id, signal: q.signal, ask: fill(q.ask, v), why: q.why || null, evidence: s.evidence, source: s.source }));
    });
    return { standard: standard, pointed: fired.slice(0, MAX_POINTED), firedNotShown: Math.max(0, fired.length - MAX_POINTED), bankChecked: bank.checked || null };
  }

  return { build: build, SIGNALS: SIGNALS, MAX_POINTED: MAX_POINTED, contactFor: contactFor };
}));
