/**
 * funding-fit.js — which programs in the developer funding guide fit a project.
 *
 * Reads the `fit` tags on each program in data/policy/co-developer-funding-guide.json
 * (deal type, project type, geography, role). Every tag rests on words quoted in the
 * program's own record (fit.basis; test/funding-fit.test.js holds that), so this
 * screens for eligibility and never ranks programs as better or worse.
 *
 * Used by the Developer Funding tab (colorado-deep-dive.html#tab-funding), the
 * Opportunity Finder's jurisdiction panel and Compare, so all three agree on what
 * "fits" means. Exposed as window.FundingFit and module.exports.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FundingFit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXECUTIONS = [
    ['9%', '9% housing tax credit (competitive)'],
    ['4%', '4% housing tax credit with bonds'],
    ['rental', 'Rental without LIHTC'],
    ['for-sale', 'For-sale homes']
  ];
  var PROJECT_TYPES = [
    ['new-construction', 'New construction'],
    ['acq-rehab', 'Acquisition and rehab'],
    ['preservation', 'Preservation or refinance'],
    ['supportive', 'Supportive housing'],
    ['land', 'Land acquisition'],
    ['predevelopment', 'Predevelopment']
  ];

  // A program's status says whether a developer can apply now.
  var AVAILABILITY = {
    open: 'open', rolling: 'open',
    rounds: 'scheduled', annual: 'scheduled',
    closed: 'closed', ended: 'closed'
  };
  var AVAILABILITY_LABELS = {
    open: 'Taking applications',
    scheduled: 'Next round published',
    closed: 'Closed or ended',
    check: 'No round published; ask the administrator'
  };
  // Open and scheduled rounds sort together, in guide order (tax credits first).
  var AVAILABILITY_ORDER = { open: 0, scheduled: 0, check: 1, closed: 2 };

  var SCOPE_NOTES = {
    rural: 'Eligible rural areas only: check the USDA eligibility map for the site.',
    'designated-areas': 'Designated areas only: check the program map for the site.',
    'non-entitlement': 'Balance of state: for places that do not receive their own HUD allocation.',
    'prop123-committed': 'The jurisdiction must have filed a Proposition 123 commitment.'
  };

  function availability(program) {
    return AVAILABILITY[program && program.status] || 'check';
  }

  function isOpenOrScheduled(program) {
    var a = availability(program);
    return a === 'open' || a === 'scheduled';
  }

  function labelOf(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === value) return list[i][1];
    return null;
  }

  function pad5(c) {
    var s = c == null ? '' : String(c).trim();
    return /^\d{1,5}$/.test(s) ? ('00000' + s).slice(-5) : null;
  }

  /**
   * Does one program fit a query?
   * @param {Object} program  a guide program with a `fit` object
   * @param {Object} q        { execution (one deal type, or a list meaning "any of these"), projectType,
   *                            county (5-digit FIPS), place (7-digit GEOID, optional), openOnly, includeSupport }
   * @returns {{ fits: boolean, notes: string[] }}
   */
  function match(program, q) {
    q = q || {};
    var f = program && program.fit;
    if (!f) return { fits: false, notes: [] };
    var notes = [];
    if (f.role === 'support' && !q.includeSupport) return { fits: false, notes: notes };
    if (q.execution) {
      var wanted = Array.isArray(q.execution) ? q.execution : [q.execution];
      var offered = f.execution || [];
      if (!wanted.some(function (e) { return offered.indexOf(e) !== -1; })) return { fits: false, notes: notes };
    }
    var types = f.project_types || [];
    if (q.projectType && types.length && types.indexOf(q.projectType) === -1) return { fits: false, notes: notes };
    if (q.openOnly && !isOpenOrScheduled(program)) return { fits: false, notes: notes };
    var geo = f.geography || {};
    var county = pad5(q.county);
    if (geo.scope === 'local') {
      if (county && (geo.counties || []).indexOf(county) === -1) return { fits: false, notes: notes };
      // A city's fund does not reach a different town in the same county.
      var place = q.place == null ? '' : String(q.place);
      if (/^\d{7}$/.test(place) && (geo.places || []).length && geo.places.indexOf(place) === -1) return { fits: false, notes: notes };
      if (geo.label) notes.push(geo.label + '.');
    } else if (SCOPE_NOTES[geo.scope]) {
      notes.push(SCOPE_NOTES[geo.scope]);
    }
    if (f.role === 'rental-assistance') notes.push('Rental assistance for the units, not development capital.');
    return { fits: true, notes: notes };
  }

  /** Programs that fit: open or scheduled first, then the rest; ties keep guide order. */
  function select(guide, q) {
    var programs = (guide && guide.programs) || [];
    return programs.map(function (p, i) { return { program: p, i: i, m: match(p, q) }; })
      .filter(function (r) { return r.m.fits; })
      .sort(function (a, b) {
        var d = AVAILABILITY_ORDER[availability(a.program)] - AVAILABILITY_ORDER[availability(b.program)];
        return d || a.i - b.i;
      })
      .map(function (r) { return { program: r.program, notes: r.m.notes, availability: availability(r.program) }; });
  }

  /** The guide link for a query, so another page can open the tab already filtered.
   *  The tab's finder picks one deal type, so a list ("either credit") is left out of the link. */
  function guideUrl(q, base) {
    q = q || {};
    var parts = [];
    if (q.execution && !Array.isArray(q.execution)) parts.push('exec=' + encodeURIComponent(q.execution));
    if (q.projectType) parts.push('type=' + encodeURIComponent(q.projectType));
    if (pad5(q.county)) parts.push('county=' + pad5(q.county));
    if (q.openOnly) parts.push('open=1');
    if (q.includeSupport) parts.push('support=1');
    if (q.program) parts.push('program=' + encodeURIComponent(q.program));
    return (base || 'colorado-deep-dive.html') + (parts.length ? '?' + parts.join('&') : '') + '#tab-funding';
  }

  /** Read a query back from a URL search string (the inverse of guideUrl). */
  function parseQuery(search) {
    var out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = '';
      // A malformed escape (?exec=%) drops that parameter instead of throwing.
      try { v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { return; }
      if (k === 'exec' && labelOf(EXECUTIONS, v)) out.execution = v;
      else if (k === 'type' && labelOf(PROJECT_TYPES, v)) out.projectType = v;
      else if (k === 'county' && pad5(v)) out.county = pad5(v);
      else if (k === 'open' && v === '1') out.openOnly = true;
      else if (k === 'support' && v === '1') out.includeSupport = true;
      else if (k === 'program' && /^[a-z0-9-]+$/.test(v)) out.program = v;
    });
    return out;
  }

  return {
    EXECUTIONS: EXECUTIONS,
    PROJECT_TYPES: PROJECT_TYPES,
    AVAILABILITY_LABELS: AVAILABILITY_LABELS,
    SCOPE_NOTES: SCOPE_NOTES,
    availability: availability,
    isOpenOrScheduled: isOpenOrScheduled,
    executionLabel: function (v) {
      if (Array.isArray(v)) return v.map(function (x) { return labelOf(EXECUTIONS, x); }).filter(Boolean).join(' or ') || null;
      return labelOf(EXECUTIONS, v);
    },
    projectTypeLabel: function (v) { return labelOf(PROJECT_TYPES, v); },
    match: match,
    select: select,
    guideUrl: guideUrl,
    parseQuery: parseQuery
  };
}));
