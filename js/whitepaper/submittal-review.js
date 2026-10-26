/**
 * submittal-review.js — the gated "Submittal review" page: a draft 2027 Round One
 * (federal 9%) application scored against CHFA's QAP, the DOH or OEDIT gap-fund
 * lane under QAP 3.B.9, threshold items, stress tests run through the Deal
 * Calculator itself, and saved versions compared side by side.
 *
 * Reads:
 *   data/policy/chfa-2027-r1-scoring.json   QAP lines, points, pages and quotes
 *                                           (public CHFA text only; status "draft"
 *                                           until CHFA adopts the 2027-28 QAP)
 *   data/policy/prop123_jurisdictions.json  DOLA Prop 123 commitment filings
 *   /api/deals                              saved deals and versions, served only by
 *                                           the private backend (coho-backend). Deal
 *                                           figures never go to this repository.
 *
 * Stress tests load deal-calculator.html in a hidden frame with the saved
 * calculator export's own settings, change one input, and read the engine's
 * results, so the numbers are the calculator's, not a second model.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.SubmittalReview in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubmittalReview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES_URL = 'data/policy/chfa-2027-r1-scoring.json';
  var PROP123_URL = 'data/policy/prop123_jurisdictions.json';
  var PLACES_URL = 'data/co-place-centroids.json'; // 2024 Census Gazetteer: Colorado cities, towns and CDPs
  // Colorado's 64 counties, to tell a county that is not on DOLA's list from a misspelling.
  var CO_COUNTIES = ['Adams', 'Alamosa', 'Arapahoe', 'Archuleta', 'Baca', 'Bent', 'Boulder', 'Broomfield', 'Chaffee', 'Cheyenne', 'Clear Creek', 'Conejos', 'Costilla', 'Crowley', 'Custer', 'Delta', 'Denver', 'Dolores', 'Douglas', 'Eagle', 'El Paso', 'Elbert', 'Fremont', 'Garfield', 'Gilpin', 'Grand', 'Gunnison', 'Hinsdale', 'Huerfano', 'Jackson', 'Jefferson', 'Kiowa', 'Kit Carson', 'La Plata', 'Lake', 'Larimer', 'Las Animas', 'Lincoln', 'Logan', 'Mesa', 'Mineral', 'Moffat', 'Montezuma', 'Montrose', 'Morgan', 'Otero', 'Ouray', 'Park', 'Phillips', 'Pitkin', 'Prowers', 'Pueblo', 'Rio Blanco', 'Rio Grande', 'Routt', 'Saguache', 'San Juan', 'San Miguel', 'Sedgwick', 'Summit', 'Teller', 'Washington', 'Weld', 'Yuma'];
  var API = '/api/deals';
  var LOCAL_KEY = 'coho-submittal-review-local';
  var TIERS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120]; // the Deal Calculator's AMI bands
  var NEAR_LINE = 0.5; // AMI-midpoint points either side of DOH's line that get a flag

  // Our judgement, not CHFA's: how hard each line is to add once a deal is drawn.
  // Policy commitments cost little; site and ownership facts usually cannot change.
  var EFFORT = {
    '5B3e-nosmoking': { rank: 1, how: 'Adopt a whole-property no-smoking policy and attach it.' },
    '5B3h-pets': { rank: 1, how: 'Adopt a pet-inclusive policy within CRS 24-32-735.' },
    '5B6-waitlist': { rank: 1, how: 'Add the housing authority waitlist question to the rental application.' },
    '5B3g-universal': { rank: 2, how: 'Design at least 5% of units as Type A (ANSI A117.1 or UFAS).' },
    '5B2a-priority': { rank: 2, how: 'Cite the local housing needs assessment or plan that names this need.' },
    '5A1d-eli': { rank: 3, how: 'Move units to 30% AMI and line up supportive services at no cost to residents.' },
    '5B4b-pha': { rank: 3, how: 'Make a Colorado housing authority the Applicant, as sole or majority co-general partner.' },
    '5B4a-nonprofit': { rank: 3, how: 'Make a qualifying nonprofit or housing authority the Applicant, as sole general partner.' },
    '5B3f-modular': { rank: 4, how: 'Modular or factory-built construction, with box and delivery detail.' },
    '5B5-homeless': { rank: 4, how: 'Set aside 25% of units for people experiencing homelessness, with services and MOUs.' },
    '5B2b-toc': { rank: 5, how: 'Only if the site is at an existing or planned transit-oriented site.' },
    '5A3-crp': { rank: 5, how: 'Only for a site in a QCT with a community revitalization plan.' },
    '5B3b-nonmetro': { rank: 9, how: 'Set by the county.' },
    '5B3a-mixed': { rank: 4, how: 'Keep tax credit units at 80% or less of all units.' },
    '5B3c-rehab': { rank: 9, how: 'Only for rehab of blighted or historic buildings.' },
    '5B3d-preservation': { rank: 9, how: 'Only for preservation deals.' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function money(v) { return v == null ? '—' : (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function pts(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  // Every AMI tier in a mix: the form's bands plus any other numeric tier an export brought (a schedule can have 90%).
  function tiersOf(mix) {
    var out = TIERS.slice();
    Object.keys(mix || {}).forEach(function (k) { var n = Number(k); if (k !== 'market' && isFinite(n) && n > 0 && out.indexOf(n) === -1) out.push(n); });
    return out.sort(function (a, b) { return a - b; });
  }
  // 5.B.4 points only for the general partner the line names.
  // 5.B.4 asks both that the QAP-defined Applicant qualify and that it hold the general partner role.
  // Line id -> [Applicant types that qualify, Applicant general partner roles that qualify, how the QAP says the role].
  var SPONSOR_LINES = { '5B4a-nonprofit': [['nonprofit', 'pha'], ['sole'], 'the sole general partner'], '5B4b-pha': [['pha'], ['sole', 'majority'], 'a sole or majority-interest co-general partner'] };
  // Lines that only exist for a rehab or an existing tax credit project.
  // Line id -> [deal flags, any one of which qualifies; what to tick].
  var CONDITION_LINES = { '5B3c-rehab': [['rehab'], 'acquisition/rehab'], '5B3d-preservation': [['existingCredit', 'subsidyExpiring'], 'existing tax credit project or rental assistance within three years of expiring'] };
  function conditionMet(id, deal) { return CONDITION_LINES[id][0].some(function (f) { return !!deal[f]; }); }
  var SPLIT_BR = ['studio', '1br', '2br', '3br', '4br'];
  var ELECTION_LABEL = { '20-50': '20-50 election', '40-60': '40-60 election', 'average-income': 'Average Income' };
  // ── Deal facts ────────────────────────────────────────────────────────────
  // Federal minimum set-aside elections, as js/deal-engine.js models them: 70% and 80% designations are
  // tax credit units only under Average Income.
  var SET_ASIDE = {
    '20-50': { minimumShare: 0.20, setAsideCeiling: 50, creditCeiling: 60 },
    '40-60': { minimumShare: 0.40, setAsideCeiling: 60, creditCeiling: 60 },
    'average-income': { minimumShare: 0.40, setAsideCeiling: 80, creditCeiling: 80 }
  };
  function electionOf(e) { return SET_ASIDE[e] ? e : '40-60'; }
  // The form's guidance line, written from SET_ASIDE so the words follow the ceilings.
  function taxCreditNote() {
    var by = {};
    Object.keys(SET_ASIDE).forEach(function (e) { var c = SET_ASIDE[e].creditCeiling; (by[c] = by[c] || []).push(e); });
    return 'Homes by income level (% of area median income). ' + Object.keys(by).sort(function (a, b) { return a - b; }).map(function (c) {
      var names = by[c].map(function (e) { return e === 'average-income' ? 'Average Income' : 'the ' + e; });
      var wf = [70, 80].filter(function (t) { return t > c; });
      return 'Under ' + names.join(' and ') + (by[c].length > 1 || by[c][0] !== 'average-income' ? ' election' + (by[c].length > 1 ? 's' : '') : '') +
        ', units at or under ' + c + '% are tax credit units' + (wf.length ? ' and ' + wf.join('% and ') + '% units count as workforce units' : '') + '.';
    }).join(' ');
  }

  // mix: {30: 6, 40: 12, ..., market: 0}. restricted = tax credit units under the election; workforce = 70%/80%
  // units that are not tax credit units under it; weighted sums AMI over every unit that has one.
  function mixTotals(mix, election) {
    var ceiling = SET_ASIDE[electionOf(election)].creditCeiling;
    var restricted = 0, workforce = 0, weighted = 0, market = num(mix && mix.market) || 0;
    tiersOf(mix).forEach(function (t) {
      var u = num(mix && mix[t]) || 0;
      if (t <= ceiling) restricted += u; else workforce += u;
      weighted += u * t;
    });
    return { restricted: restricted, workforce: workforce, market: market, total: restricted + workforce + market, weighted: weighted, withAmi: restricted + workforce };
  }

  // Does the mix meet its elected federal set-aside? Mirrors evaluateMinimumSetAside in js/deal-engine.js.
  function setAsideCheck(mix, election) {
    var e = electionOf(election), c = SET_ASIDE[e], t = mixTotals(mix, e), inSetAside = 0;
    tiersOf(mix).forEach(function (tier) { if (tier <= c.setAsideCeiling) inSetAside += num(mix && mix[tier]) || 0; });
    var reasons = [];
    if (!t.total || inSetAside / t.total < c.minimumShare) reasons.push('fewer than ' + Math.round(c.minimumShare * 100) + '% of units are at or below ' + c.setAsideCeiling + '% AMI');
    if (e === 'average-income') {
      if (!t.restricted || t.weighted / t.restricted > 60 + 1e-9) reasons.push('the designated average is over 60% AMI');
      if (t.restricted !== t.total) reasons.push('CHFA requires every unit to be designated low-income under Average Income');
    }
    return { election: e, qualifies: !reasons.length, reasons: reasons, share: t.total ? inSetAside / t.total : null };
  }

  // QAP 3.B.9: "the sum of the project's units multiplied by the AMI for each unit divided by the total units."
  // Market units carry no AMI, so with market units there are two readings: over the units that have an AMI, and over
  // total units with market units adding nothing. The lane resolves only when both readings agree.
  function amiMidpoint(mix) {
    var t = mixTotals(mix, 'average-income');
    if (!t.withAmi) return null;
    return { value: t.weighted / t.withAmi, overTotal: t.weighted / t.total, marketUnits: t.market };
  }

  // QAP 5.A.1: the 20-50 table has only the 50% and 40% rows, so 60% units earn no targeting points under it.
  function electionRows(rules, election) {
    var tables = rules.targeting.tables || {};
    return (tables[election] || tables['40-60'] || { rows: [60, 50, 40] }).rows;
  }
  // The Third Draft strikes the 5.A.1 note that capped the 40% row at 60% of low-income units (red strikethrough, printed pp. 41-42).
  function targetingPoints(rules, mix, election) {
    var w = rules.targeting.weights, t = mixTotals(mix, election), allowed = electionRows(rules, election || '40-60');
    if (!t.restricted) return { points: 0, rows: [] };
    var rows = [{ tier: 40, units: 0 }, { tier: 50, units: 0 }, { tier: 60, units: 0 }];
    tiersOf(mix).forEach(function (tier) {
      var u = num(mix[tier]) || 0;
      if (tier <= 40) rows[0].units += u; else if (tier <= 50) rows[1].units += u; else if (tier <= 60) rows[2].units += u;
    });
    var total = 0;
    rows.forEach(function (r) {
      r.share = r.units / t.restricted; r.inTable = allowed.indexOf(r.tier) !== -1;
      r.weight = r.inTable ? w[r.tier] : 0; r.points = r.share * r.weight; total += r.points;
    });
    return { points: total, rows: rows, restricted: t.restricted, election: election || '40-60' };
  }

  // Both readings of the Third Draft's "Up to" bands; the lower one counts.
  function eliPoints(rules, mix) {
    var t = mixTotals(mix);
    var eli = tiersOf(mix).reduce(function (s, tier) { return tier <= 30 ? s + (num(mix && mix[tier]) || 0) : s; }, 0);
    var share = t.total ? eli / t.total : 0;
    var bands = rules.eli_targeting.bands;
    var atLeast = 0, upTo = 0;
    bands.forEach(function (b) { if (share >= b.share - 1e-9) atLeast = b.points; });
    if (share > 0) {
      upTo = bands[bands.length - 1].points;
      for (var i = 0; i < bands.length; i++) if (share <= bands[i].share + 1e-9) { upTo = bands[i].points; break; }
    }
    return { share: share, units: eli, points: Math.min(atLeast, upTo), atLeast: atLeast, upTo: upTo, differs: atLeast !== upTo };
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  // deal: {mix, nine: true}; claims: {<line id>: true, '5B1-need': <points>, '5A1-lowest-ami': true, '5A1d-eli': true}
  // thresholds (optional): the Threshold answers; a missing 25-year election (T14) withholds the extended-use points.
  function score(rules, deal, claims, thresholds) {
    claims = claims || {};
    var mix = deal.mix || {};
    var lines = [];
    var tp = targetingPoints(rules, mix, deal.election);
    var tg = rules.targeting;
    lines.push({ id: '5A1-targeting', group: 'primary', label: tg.label, possible: tg.weights['40'], points: tp.points,
      status: tp.points > 0 ? 'counted' : 'missing', auto: true, section: tg.section, page: tg.page, quote: tg.quote,
      note: ELECTION_LABEL[tp.election || '40-60'] + ' table: ' + tp.rows.map(function (r) { return r.units + ' at ' + (r.tier === 40 ? '40% or below' : r.tier + '%') + ' = ' + pts(r.points) + (r.inTable === false && r.units ? ' (no row in this table)' : ''); }).join('; ') });
    var lb = tg.lowest_ami_bonus;
    lines.push({ id: lb.id, group: 'primary', label: lb.label, possible: lb.points, points: claims[lb.id] ? lb.points : 0,
      status: claims[lb.id] ? 'counted' : 'not claimed', section: tg.section, page: lb.page, quote: lb.quote, unconfirmed: lb.unconfirmed });

    var e = eliPoints(rules, mix), el = rules.eli_targeting;
    var homelessClaimed = !!claims['5B5-homeless'];
    var eliLine = { id: el.id, group: 'primary', label: el.label, possible: 15, points: 0, section: el.section, page: el.page,
      quote: el.quote, unconfirmed: e.differs ? el.unconfirmed + ' This deal: ' + Math.round(e.share * 1000) / 10 + '% of units, ' +
        e.atLeast + ' points read as "at least", ' + e.upTo + ' read as "up to".' : null,
      note: e.units + ' units at 30% AMI or below (' + Math.round(e.share * 1000) / 10 + '% of all units); needs ' + el.needs + '.' };
    if (!e.points) eliLine.status = 'missing';
    else if (!claims[el.id]) eliLine.status = 'not claimed';
    else { eliLine.points = e.points; eliLine.status = 'counted'; }
    lines.push(eliLine);

    rules.lines.forEach(function (l) {
      var line = { id: l.id, group: l.group, label: l.label, possible: l.points, points: 0, section: l.section, page: l.page,
        quote: l.quote, unconfirmed: l.unconfirmed || null, change: l.change_note || null };
      if (l.auto === 'nine_percent_required') {
        line.auto = true;
        if (thresholds && thresholds.T14 === 'missing') { line.status = 'missing'; line.note = 'Threshold #14 (the 25-year extended-use election) is marked missing, so these points are not counted.'; }
        else { line.points = l.points; line.status = 'counted'; line.note = 'Required for 9% (Threshold #14).'; }
      }
      else if (l.auto === 'mixed_income') {
        var t = mixTotals(mix, deal.election), share = t.total ? t.restricted / t.total : 1;
        line.auto = true; line.note = Math.round(share * 1000) / 10 + '% of units are tax credit units.';
        if (share <= 0.8 + 1e-9) { line.points = l.points; line.status = 'counted'; } else line.status = 'missing';
      } else if (l.points == null) {
        var v = num(claims[l.id]);
        line.possible = null;
        if (v != null && v > 0) { line.points = v; line.status = 'counted'; line.note = 'Points entered from CHFA\'s tier list.'; }
        else line.status = 'needs entry';
      } else if (claims[l.id] && CONDITION_LINES[l.id] && !conditionMet(l.id, deal)) {
        line.status = 'excluded'; line.note = 'Claimed, but the deal is not marked ' + CONDITION_LINES[l.id][1] + '. Tick it or remove the claim.';
      } else if (claims[l.id] && SPONSOR_LINES[l.id] && !deal.applicant) {
        line.status = 'excluded'; line.note = 'Claimed, but the Applicant type is not entered; 5.B.4 asks the Applicant itself to qualify. Enter it.';
      } else if (claims[l.id] && SPONSOR_LINES[l.id] && SPONSOR_LINES[l.id][0].indexOf(deal.applicant) === -1) {
        line.status = 'excluded'; line.note = 'Claimed, but the Applicant is set to ' + deal.applicant + '. Change the Applicant or remove the claim.';
      } else if (claims[l.id] && SPONSOR_LINES[l.id] && SPONSOR_LINES[l.id][1].indexOf(deal.gpRole) === -1) {
        line.status = 'excluded'; line.note = 'Claimed, but 5.B.4 needs the Applicant itself to be ' + SPONSOR_LINES[l.id][2] + (deal.gpRole ? '; its role is set otherwise.' : '; enter the Applicant\'s general partner role.');
      } else if (claims[l.id]) { line.points = l.points; line.status = 'counted'; }
      else line.status = 'not claimed';
      lines.push(line);
    });

    // 5.A.1(d) and 5.B.5 cannot both count: keep the larger.
    var eliL = lines.filter(function (l) { return l.id === '5A1d-eli'; })[0];
    var homL = lines.filter(function (l) { return l.id === '5B5-homeless'; })[0];
    if (eliL && homL && eliL.status === 'counted' && homelessClaimed) {
      var drop = homL.points >= eliL.points ? eliL : homL;
      drop.status = 'excluded'; drop.note = 'Cannot be claimed with ' + (drop === eliL ? '5.B.5' : '5.A.1(d)') + '; the larger one counts.';
      drop.points = 0;
    }
    // 5.B.4 a and b: one sponsor, one line (keep the larger).
    var npL = lines.filter(function (l) { return l.id === '5B4a-nonprofit'; })[0];
    var phaL = lines.filter(function (l) { return l.id === '5B4b-pha'; })[0];
    if (npL && phaL && npL.status === 'counted' && phaL.status === 'counted') {
      npL.status = 'excluded'; npL.points = 0; npL.note = 'Counted once: the housing authority line (7) is larger.';
    }

    var total = lines.reduce(function (s, l) { return s + (l.points || 0); }, 0);
    var eu = lines.filter(function (l) { return l.id === '5A2-extended-use'; })[0];
    var sa = setAsideCheck(mix, deal.election);
    var primaryOk = tp.points > 0 && !!(eu && eu.points > 0) && sa.qualifies;
    var min = rules.minimum_score.points;
    var addable = lines.filter(function (l) { return (l.status === 'not claimed' || (l.status === 'missing' && EFFORT[l.id])) && l.possible; })
      .filter(function (l) { return EFFORT[l.id] && EFFORT[l.id].rank < 9; })
      .map(function (l) { return { id: l.id, label: l.label, points: l.possible, how: EFFORT[l.id].how, rank: EFFORT[l.id].rank }; })
      .sort(function (a, b) { return a.rank - b.rank || b.points - a.points; });
    return { lines: lines, total: total, minimum: min, margin: total - min, meets: primaryOk && total >= min, primaryOk: primaryOk, setAside: sa,
      addable: addable, needEntered: lines.some(function (l) { return l.id === '5B1-need' && l.status === 'counted'; }) };
  }

  // ── Prop 123 and the 3.B.9 gap-fund lane ──────────────────────────────────
  function findJurisdiction(prop123, place) {
    var q = String(place || '').trim().toLowerCase();
    if (!q || !prop123 || !Array.isArray(prop123.jurisdictions)) return null;
    var list = withNewFilings(prop123);
    var exact = list.filter(function (j) { return j.name.toLowerCase() === q; })[0];
    if (exact) return exact;
    var same = list.filter(function (j) { return bare(j.name) === bare(q); });
    // Denver and Broomfield are filed once as city and county, so "City of Denver" and "Denver County" both mean that record.
    var consolidated = /^(denver|broomfield)$/.test(bare(q));
    if (consolidated) { /* keep the single consolidated record */ }
    else if (/\bcounty\b/.test(q)) same = same.filter(function (j) { return j.kind === 'county'; });
    else if (muniForm(q)) same = same.filter(function (j) { return j.kind !== 'county'; });
    if (same.length > 1) return { ambiguous: same.map(function (j) { return j.name; }) }; // e.g. "Pueblo": the city or the county
    // A bare name can be both a county and a city or town even when only one of them is on DOLA's list ("Alamosa").
    if (!/\bcounty\b/.test(q) && !muniForm(q)) {
      var b = bare(q);
      var isCounty = CO_COUNTIES.some(function (c) { return c.toLowerCase() === b; });
      var isPlace = (prop123.places || []).some(function (n) { return !/ CDP$/.test(n) && gazName(n) === b; });
      if (isCounty && isPlace && b !== 'denver' && b !== 'broomfield') { // the two consolidated city and counties are one place
        var title = b.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        return { ambiguous: [title + ' County', 'the city or town of ' + title] };
      }
    }
    return same[0] || null;
  }

  // A 2027-2029 filing from a place with no first-cycle record (Moffat, Stratton) still counts as filed.
  function withNewFilings(prop123) {
    var list = prop123.jurisdictions, have = {};
    list.forEach(function (j) { have[j.name.toLowerCase()] = true; });
    var extra = ((prop123.next_cycle || {}).filings || []).filter(function (f) { return f && f.name && !have[f.name.toLowerCase()]; })
      .map(function (f) { return { name: f.name, kind: /\bcounty\b/i.test(f.name) && !/^city and county of/i.test(f.name) ? 'county' : 'municipality', status: 'new filing', next_cycle: { submitted: f.submitted } }; });
    return extra.length ? list.concat(extra) : list;
  }

  // Only a legal form ("City of Lamar", "Town of Lyons") marks a municipality; "Colorado City" and "Lake City" are proper names.
  function muniForm(q) { return /^(city and county of|city of|town of)\s/.test(String(q).toLowerCase().trim()); }
  // DOLA files Central City under its legal name, "City of Central".
  function bare(n) { return String(n).toLowerCase().trim().replace(/^(city and county of|city of|town of|county of)\s+/, '').replace(/\s+county$/, '').replace(/^central city$/, 'central'); }
  // Census Gazetteer names end in "city", "town" or "CDP" ("Lake City town", "Canon City city").
  function gazName(n) { return String(n).toLowerCase().replace(/\s+(city|town|cdp)$/, ''); }

  // A place not on DOLA's list: a real Colorado county, city or town is "not listed"; anything else stays unresolved.
  function placeRegistry(prop123, place) {
    var q = String(place).toLowerCase(), b = bare(place);
    var county = CO_COUNTIES.some(function (c) { return c.toLowerCase() === b; });
    if (/\bcounty\b/.test(q)) return county ? 'county' : null;
    var hit = (prop123.places || []).filter(function (n) { return gazName(n) === b; });
    if (muniForm(q)) hit = hit.filter(function (n) { return !/ CDP$/.test(n); });
    if (hit.some(function (n) { return !/ CDP$/.test(n); })) return 'municipality';
    if (hit.length) return 'cdp';
    return county ? 'county' : null;
  }

  // 'yes' = filed for 2027-2029; 'to-confirm' = on DOLA's list without a 2027-2029 filing yet; 'no' = not on the list.
  function prop123Status(prop123, place) {
    if (!prop123 || !Array.isArray(prop123.jurisdictions)) return { status: 'unknown', text: 'DOLA\'s Prop 123 list did not load, so OEDIT eligibility is not known. Reload the page.' };
    if (!String(place || '').trim()) return { status: 'missing', text: 'Enter the town or county to check DOLA\'s Prop 123 list.' };
    var j = findJurisdiction(prop123, place);
    if (j && j.ambiguous) return { status: 'ambiguous', text: '"' + place + '" could be ' + j.ambiguous.join(' or ') + '. Enter which one.' };
    if (!j) {
      var kind = placeRegistry(prop123, place);
      if (kind === 'cdp') return { status: 'unmatched', text: '"' + place + '" is an unincorporated place; enter its county.' };
      if (!kind) return { status: 'unmatched', text: '"' + place + '" does not match a Colorado county, city or town' + (prop123.places ? '' : ' (the Census place list did not load)') + '. Check the spelling.' };
    }
    if (!j) return { status: 'no', text: 'Not on DOLA\'s Prop 123 commitment list (as of ' + (prop123.updated || 'the last refresh') + ').' };
    if (j.next_cycle && j.next_cycle.submitted) {
      return { status: 'yes', name: j.name, text: j.name + ' filed its 2027-2029 Prop 123 commitment on ' + j.next_cycle.submitted + '.' };
    }
    var due = prop123.next_cycle && prop123.next_cycle.filing_deadline;
    return { status: 'to-confirm', name: j.name, text: j.name + ' has a first-cycle commitment (' + j.status + ') but no 2027-2029 filing on DOLA\'s list yet' + (due ? '; filings are due ' + due : '') + '.' };
  }

  // deal: {mix, supportive, sponsor: 'for-profit'|'nonprofit'|'pha'}; p123: prop123Status() result
  function gapLane(rules, deal, p123) {
    var g = rules.gap_pilot, mp = amiMidpoint(deal.mix || {}), t = mixTotals(deal.mix || {});
    var units = t.total;
    var out = { midpoint: mp ? mp.value : null, units: units, flags: [], quotes: [] };
    if (!units) { out.lane = 'unknown'; out.text = 'Enter the unit mix to test the gap-fund lane.'; return out; }
    var under = function (x) { return x <= g.doh.midpoint_max + 1e-9; };
    if (!mp && !deal.supportive) {
      out.lane = 'unknown'; out.text = 'Enter units by AMI tier to test the gap-fund lane; market-rate units alone have no AMI midpoint.';
      return out;
    }
    var split = mp && mp.marketUnits && under(mp.value) !== under(mp.overTotal);
    if (split && !deal.supportive) {
      out.lane = 'unknown';
      out.text = 'DOH or OEDIT: not known until CHFA says how market-rate units count in the AMI midpoint.';
      out.flags.push('The AMI midpoint is ' + mp.value.toFixed(2) + '% over the ' + mixTotals(deal.mix, 'average-income').withAmi + ' units that have an AMI and ' + mp.overTotal.toFixed(2) + '% over all ' + units + ' units; DOH\'s ' + g.doh.midpoint_max + '% line falls between them. Ask CHFA.');
      return out;
    }
    var dohEligible = !!deal.supportive || (mp && under(mp.value));
    if (mp && Math.abs(mp.value - g.doh.midpoint_max) <= NEAR_LINE) {
      out.flags.push('The AMI midpoint (' + mp.value.toFixed(2) + '%) is within half a point of DOH\'s ' + g.doh.midpoint_max + '% line. ' + g.doh.unconfirmed);
    }
    if (mp && mp.marketUnits) out.flags.push('The midpoint leaves out market-rate units (' + mp.overTotal.toFixed(2) + '% if they count as zero over total units); both readings give the same lane. Confirm with CHFA.');
    if (dohEligible) {
      // DOH's terms follow the QAP-defined Applicant, which need not be the general partner.
      var ap = deal.applicant;
      out.lane = 'DOH'; out.kind = ap === 'nonprofit' || ap === 'pha' ? 'grant' : ap === 'for-profit' ? 'cash flow loan at 2%' : 'grant or 2% cash flow loan';
      if (!ap) out.flags.push('DOH gives a grant to a nonprofit or housing authority Applicant and a 2% cash flow loan to a for-profit one. Enter the Applicant type to settle which.');
      out.perUnit = g.doh.per_unit; out.cap = g.doh.max;
      out.why = deal.supportive && !(mp && mp.value <= g.doh.midpoint_max) ? 'Supportive housing application.' : 'AMI midpoint ' + mp.value.toFixed(2) + '% is at or under ' + g.doh.midpoint_max + '%.';
      out.quotes = [g.doh.eligibility_quote, g.doh.terms_quote];
    } else if (!p123 || p123.status === 'unknown') {
      out.lane = 'unknown'; out.text = 'OEDIT or DOH fallback: not known until DOLA\'s Prop 123 list loads.';
      out.flags.push(p123 ? p123.text : 'Prop 123 status not known.');
      return out;
    } else if (p123.status === 'ambiguous' || p123.status === 'missing' || p123.status === 'unmatched') {
      out.lane = 'unknown'; out.text = 'OEDIT or DOH fallback: not known until ' + (p123.status === 'missing' ? 'the town or county is entered.' : p123.status === 'ambiguous' ? 'the place names the city or town or the county.' : 'the place matches a Colorado county, city or town.');
      out.flags.push(p123.text);
      return out;
    } else if (p123.status === 'to-confirm') {
      out.lane = 'unknown'; out.text = 'OEDIT or DOH fallback: not known until ' + (p123.name || 'the jurisdiction') + ' files a 2027-2029 Prop 123 commitment.';
      out.flags.push('OEDIT needs a Prop 123 eligible jurisdiction. ' + p123.text);
      return out;
    } else if (p123.status === 'yes') {
      out.lane = 'OEDIT'; out.kind = 'Prop 123 concessionary loan, 2.5%, 40-year, must-pay';
      out.perUnit = g.oedit.per_unit; out.cap = g.oedit.max;
      out.why = 'AMI midpoint ' + mp.value.toFixed(2) + '% is over DOH\'s ' + g.doh.midpoint_max + '% line, and ' + p123.text;
      out.quotes = [g.oedit.eligibility_quote];
    } else {
      out.lane = 'DOH fallback'; out.kind = 'loan, 2.5%, 40-year, must-pay';
      out.perUnit = g.doh.per_unit; out.cap = g.doh.max;
      out.why = 'Over DOH\'s midpoint line and outside a Prop 123 jurisdiction.';
      out.flags.push(g.doh_fallback.unconfirmed);
      out.quotes = [g.doh_fallback.quote];
    }
    out.amount = Math.min(units * out.perUnit, out.cap);
    out.capped = units * out.perUnit > out.cap;
    out.text = out.lane + ' ' + out.kind + ': ' + money(out.amount) + (out.capped ? ' (capped at ' + money(out.cap) + ')' : ' (' + money(out.perUnit) + ' x ' + units + ' homes)');
    out.mustPay = /must-pay/.test(out.kind);
    return out;
  }

  // One unit moved up to the next band (from the highest occupied tier under 60%, imported tiers included), for the AMI stress test.
  function bumpOneUnit(mix) {
    var out = {}; Object.keys(mix || {}).forEach(function (k) { out[k] = mix[k]; });
    var cands = tiersOf(out).filter(function (t) { return t < 60 && (num(out[t]) || 0) > 0; });
    if (!cands.length) return null;
    var f = cands[cands.length - 1], next = TIERS.filter(function (t) { return t > f; })[0];
    out[f] = (num(out[f]) || 0) - 1; out[next] = (num(out[next]) || 0) + 1;
    return { mix: out, from: f, to: next };
  }

  function thresholdStatus(rules, answers, deal) {
    answers = answers || {};
    var rows = rules.thresholds.map(function (t) {
      var a = answers[t.id] || '';
      var appliesNow = conditionHolds(t.applies, deal);
      if (a === 'na' && (!t.applies || appliesNow)) a = ''; // only a conditional item whose condition is false can be set aside
      if (t.applies && !appliesNow) a = 'na'; // and once its condition is false, an earlier answer no longer counts
      return { id: t.id, label: t.label, page: t.page, quote: t.quote, answer: a || 'unchecked' };
    });
    return { rows: rows, missing: rows.filter(function (r) { return r.answer === 'missing'; }).length,
      unchecked: rows.filter(function (r) { return r.answer === 'unchecked'; }).length,
      ready: rows.filter(function (r) { return r.answer === 'ready'; }).length,
      na: rows.filter(function (r) { return r.answer === 'na'; }).length };
  }

  // 3.L caps a project at $1.7M with the 3.B.9 pilot; 3.L.1 allows $1.8M if pilot gap funds are not available.
  // Which applies is not known until CHFA says, so a request between the two is flagged, not called over.
  // The cap is also per Applicant, Affiliate or Turn-key Project Developer: other active applications count against it.
  // Until those are entered (0 if none), only the per-project check is made and the applicant check stays open.
  function conditionHolds(cond, deal) {
    return (cond === 'rehab' && !!deal.rehab) || (cond === 'existing_credit' && !!deal.existingCredit) || (cond === 'state_credit' && num(deal.stateCredits) > 0);
  }
  function creditCheck(rules, annualCredits, otherActive) {
    var cc = rules.credit_caps, cap = cc.federal_9pct_annual;
    var alt = cc.without_pilot ? cc.without_pilot.federal_9pct_annual : cap;
    var known = otherActive != null && otherActive >= 0;
    if (annualCredits == null) return { status: 'unknown', cap: cap, altCap: alt, applicantKnown: known };
    var total = annualCredits + (known ? otherActive : 0);
    var status = total <= cap ? 'ok' : total <= alt ? 'depends' : 'over';
    return { status: status, cap: status === 'over' ? alt : cap, altCap: alt, value: annualCredits, total: total, other: known ? otherActive : null, applicantKnown: known };
  }

  // 3.L pairs a fixed amount of standard state credit, if requested: $650,000 with the pilot, $600,000 under 3.L.1.
  // Which one applies turns on whether pilot gap funds are available, which is not known yet, so either fixed amount
  // is 'depends' (basis says which case it fits) and anything else is 'off'.
  function stateCreditCheck(rules, amount) {
    var cc = rules.credit_caps, fixed = cc.state_standard_with_9pct_annual;
    var alt = cc.without_pilot ? cc.without_pilot.state_standard_with_9pct_annual : fixed;
    if (amount == null || amount === 0) return { status: 'none', fixed: fixed, altFixed: alt };
    var basis = amount === fixed ? 'pilot' : amount === alt ? 'no_pilot' : null;
    return { status: basis ? 'depends' : 'off', basis: basis, fixed: fixed, altFixed: alt, value: amount };
  }

  // ── Whole review and summary ──────────────────────────────────────────────
  function review(rules, prop123, v) {
    var deal = v.deal || {};
    var s = score(rules, deal, v.claims, v.thresholds);
    var p = prop123Status(prop123, deal.place);
    var lane = gapLane(rules, deal, p);
    var th = thresholdStatus(rules, v.thresholds, deal);
    // Model results describe the exported deal; once the mix or election is edited they no longer apply.
    var stale = !!(v.calculator && v.calculator.stale);
    var eng = stale ? {} : (v.engine || {});
    // The cap applies to the credit requested, not the calculator's modeled capacity. Versions saved before the request
    // had its own field kept a typed request in engine.annualCredits.
    var requested = deal.creditRequested !== undefined ? deal.creditRequested : (v.calculator ? null : (v.engine || {}).annualCredits);
    var credit = creditCheck(rules, num(requested), num(deal.otherActiveCredits));
    var risks = [];
    if (deal.calcRegime) risks.push({ level: 'yellow', text: 'The Deal Calculator export used ' + deal.calcRegime + ' rent limits, not CHFA LIHTC, so only its unit mix is used here. Set rent limits to CHFA LIHTC and export again for gap, coverage, credit and stress results.' });
    if (deal.calc4) risks.push({ level: 'yellow', text: 'The Deal Calculator export was set to 4%, so only its unit mix is used here. Export the deal at 9% for gap, coverage, credit and stress results.' });
    if (stale) risks.push({ level: 'yellow', text: 'The unit mix or set-aside election differs from the Deal Calculator export, so its gap, coverage, credit and stress results are not shown. Change the deal in the Deal Calculator and export it again.' });
    if (!s.setAside.qualifies) risks.push({ level: 'red', text: 'The unit mix does not meet the ' + ELECTION_LABEL[s.setAside.election] + ': ' + s.setAside.reasons.join('; ') + '. The deal is not eligible for credits.' });
    else if (!s.primaryOk) risks.push({ level: 'red', text: 'No points in a primary criterion, so the deal is not eligible.' });
    if (s.total < s.minimum) risks.push({ level: 'red', text: 'Score ' + pts(s.total) + ' is ' + pts(s.minimum - s.total) + ' points under the ' + s.minimum + ' minimum.' });
    if (th.missing) risks.push({ level: 'red', text: th.missing + ' threshold item' + (th.missing > 1 ? 's are' : ' is') + ' missing; a missing threshold item stops the application.' });
    var stateCr = stateCreditCheck(rules, num(deal.stateCredits));
    if (stateCr.status === 'off') risks.push({ level: 'red', text: 'Standard state credit ' + money(stateCr.value) + ' is not the fixed amount CHFA pairs with a 9% application: ' + money(stateCr.fixed) + ' with the 3.B.9 pilot, or ' + money(stateCr.altFixed) + ' if pilot gap funds are not available (QAP 3.L and 3.L.1, not adopted).' });
    if (stateCr.status === 'depends') risks.push({ level: 'yellow', text: stateCr.basis === 'pilot'
      ? 'Standard state credit ' + money(stateCr.value) + ' is the amount paired with the 3.B.9 pilot; if pilot gap funds are not available it is ' + money(stateCr.altFixed) + ' (QAP 3.L and 3.L.1, not adopted). Confirm with CHFA which applies.'
      : 'Standard state credit ' + money(stateCr.value) + ' is the amount under 3.L.1, which applies only if pilot gap funds are not available; with the pilot it is ' + money(stateCr.fixed) + ' (QAP 3.L, not adopted). Confirm with CHFA which applies.' });
    var creditWhat = credit.other ? 'Annual federal credit ' + money(credit.value) + ' plus ' + money(credit.other) + ' in other active applications (' + money(credit.total) + ')' : 'Annual federal credit ' + money(credit.value);
    if (credit.status === 'over') risks.push({ level: 'red', text: creditWhat + ' is over the ' + money(credit.cap) + ' cap (QAP 3.L, not adopted).' });
    if (credit.status === 'depends') risks.push({ level: 'yellow', text: creditWhat + ' is over the ' + money(credit.cap) + ' cap that applies with the 3.B.9 gap-fund pilot but within the ' + money(credit.altCap) + ' cap if pilot gap funds are not available (QAP 3.L and 3.L.1, not adopted).' });
    if (credit.status !== 'unknown' && credit.status !== 'over' && !credit.applicantKnown) risks.push({ level: 'yellow', text: 'The credit cap also counts other active applications by the same applicant, affiliate or turn-key developer (QAP 3.L). Enter their requested credit, or 0 if none, to check it.' });
    if (num(eng.fundingGap) > 0) risks.push({ level: 'yellow', text: 'Funding gap of ' + money(num(eng.fundingGap)) + ' after the modeled sources.' });
    lane.flags.forEach(function (f) { risks.push({ level: 'yellow', text: f }); });
    if (!s.needEntered) risks.push({ level: 'yellow', text: 'Housing need points are not entered; the score leaves them out.' });
    if (s.total >= s.minimum && s.margin < 5) risks.push({ level: 'yellow', text: 'Only ' + pts(s.margin) + ' points over the minimum.' });
    if (th.unchecked) risks.push({ level: 'yellow', text: th.unchecked + ' threshold items not checked yet.' });
    var next = s.total < s.minimum && s.addable.length ? s.addable[0] : null;
    return { score: s, prop123: p, lane: lane, thresholds: th, credit: credit, stateCredit: stateCr, engine: eng, risks: risks,
      next: next ? '+' + next.points + ' point' + (next.points === 1 ? '' : 's') + ': ' + next.how
        : (risks.length ? risks[0].text : 'No red flags. Confirm the unconfirmed items with CHFA.') };
  }

  function summaryLines(r) {
    return [
      'Score: ' + pts(r.score.total) + ' of ' + r.score.minimum + ' needed' + (r.score.meets ? ' (clears it)'
        : !r.score.setAside.qualifies ? ' (not eligible: the unit mix misses its set-aside election)'
        : !r.score.primaryOk ? ' (not eligible: no primary criterion points)' : ' (short)') + '.',
      'Gap funds: ' + r.lane.text + '.',
      'Funding gap: ' + (num(r.engine.fundingGap) == null ? 'not run' : money(num(r.engine.fundingGap))) + '.',
      'Biggest risk: ' + (r.risks[0] ? r.risks[0].text : 'none found.'),
      'Next fix: ' + r.next
    ];
  }

  var COMPARE_ROWS = [
    ['Homes', function (v, r) { return r.lane.units || '—'; }],
    ['AMI midpoint', function (v, r) { return r.lane.midpoint == null ? '—' : r.lane.midpoint.toFixed(2) + '%'; }],
    ['CHFA score', function (v, r) { return pts(r.score.total); }],
    ['Points over or under 130', function (v, r) { return (r.score.margin >= 0 ? '+' : '') + pts(r.score.margin); }],
    ['Gap-fund lane', function (v, r) { return r.lane.lane || '—'; }],
    ['Gap-fund amount', function (v, r) { return money(r.lane.amount); }],
    ['Total cost', function (v, r) { return money(num(r.engine.totalDevelopmentCost)); }],
    ['Cost per home', function (v, r) { var t = num(r.engine.totalDevelopmentCost); return t != null && r.lane.units ? money(t / r.lane.units) : '—'; }],
    // The request, not the calculator's modeled capacity; a blank request shows as a dash.
    ['Annual federal credit requested', function (v, r) { return money(r.credit.value); }],
    ['Modeled credit capacity', function (v, r) { return v.calculator ? money(num(r.engine.annualCredits)) : '—'; }],
    ['Credit equity', function (v, r) { return money(num(r.engine.creditEquity)); }],
    ['Funding gap', function (v, r) { return money(num(r.engine.fundingGap)); }],
    ['Weakest must-pay debt coverage', function (v, r) { var d = num(r.engine.dscr); return d == null ? '—' : d.toFixed(2) + 'x'; }],
    ['Deferred developer fee', function (v, r) { return money(num(r.engine.deferredDeveloperFee)); }],
    ['Threshold items missing', function (v, r) { return String(r.thresholds.missing); }],
    ['Stress tests failed', function (v) {
      if (!v.stress) return 'not run';
      var ran = v.stress.filter(function (t) { return !t.skipped; }), skipped = v.stress.length - ran.length;
      // A run without a 15-year coverage check was only partly evaluated.
      var partial = ran.filter(function (t) { return !t.fails && !t.scoreOnly && (t.yearOneOnly || (t.engine || {}).dscr == null); }).length;
      var notes = [];
      if (partial) notes.push(partial + ' without a 15-year coverage check');
      if (skipped) notes.push(skipped + ' not run');
      return ran.filter(function (t) { return t.fails; }).length + ' of ' + ran.length + (notes.length ? ' (' + notes.join('; ') + ')' : '');
    }]
  ];

  // v.n is the version's number in its deal, oldest first (v1, v2, ...), when the caller knows it.
  function versionName(v) { return (v.n ? 'v' + v.n + ' · ' : '') + (v.label || v.name || 'Version'); }
  function signed(d) { return (d < 0 ? '-' : '+') + money(Math.abs(d)); }

  // One plain line per later version: what moved the funding gap against the first one ticked.
  // Gap = total cost - sources, so the change in sources is the change in cost less the change in gap. The engine
  // reports a surplus as a $0 gap, so when either gap is $0 the sources change can't be worked out and is left out.
  // A stale calculator result (unit mix or election changed since the export) counts as no result, as in review().
  function changeLines(versions) {
    var stale = function (v) { return !!(v.calculator && v.calculator.stale); };
    var eng = function (v) { return stale(v) ? {} : (v.engine || {}); };
    // The headers carry the labels, so the line names versions by number alone when it can.
    var tag = function (x) { return x.n ? 'v' + x.n : (x.label || x.name || 'Version'); };
    var first = versions[0], g0 = num(eng(first).fundingGap), t0 = num(eng(first).totalDevelopmentCost);
    return versions.slice(1).map(function (v) {
      var e = eng(v), g = num(e.fundingGap), t = num(e.totalDevelopmentCost), who = tag(v) + ' against ' + tag(first) + ': ';
      if (g == null || g0 == null) {
        var gone = g == null ? v : first;
        var why = stale(gone) ? 'its unit mix or election changed after the Deal Calculator export; export it again' : eng(gone).fundingGapReason;
        return who + 'no funding gap to compare, because ' + tag(gone) + ' has none' + (why ? ' (' + why + ')' : '') + '.';
      }
      var parts = [];
      if (t != null && t0 != null) {
        var dt = t - t0;
        parts.push(dt ? 'total cost ' + signed(dt) : 'total cost unchanged');
        if (g > 0 && g0 > 0) {
          var ds = dt - (g - g0), ce = num(e.creditEquity), ce0 = num(eng(first).creditEquity);
          parts.push(ds ? 'sources ' + signed(ds) + (ce != null && ce0 != null && ce !== ce0 ? ' (credit equity ' + signed(ce - ce0) + ')' : '') : 'sources unchanged');
        }
      }
      var dg = g - g0;
      var line = who + (parts.length ? parts.join(', ') + ', so ' : '') + (dg ? 'the funding gap ' + (dg > 0 ? 'rose ' : 'fell ') + money(Math.abs(dg)) + '.' : 'the funding gap did not change.');
      return line + (g > 0 && g0 > 0 ? '' : ' A $0 gap means sources cover the cost, so the change in sources is not shown.');
    });
  }

  function compareTable(rules, prop123, versions) {
    var reviews = versions.map(function (v) { return review(rules, prop123, v); });
    var head = '<tr><th scope="col" data-tip="Changed rows are highlighted">Figure</th>' + versions.map(function (v) {
      return '<th scope="col">' + esc(versionName(v)) + '<br><span class="sr-muted">' + esc((v.at || '').slice(0, 16).replace('T', ' ')) + '</span></th>';
    }).join('') + '</tr>';
    var body = COMPARE_ROWS.map(function (row) {
      var cells = versions.map(function (v, i) { return row[1](v, reviews[i]); });
      var differs = cells.some(function (c) { return c !== cells[0]; });
      return '<tr' + (differs ? ' class="sr-diff"' : '') + '><th scope="row">' + esc(row[0]) + '</th>' + cells.map(function (c) { return '<td class="sr-num">' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var lines = changeLines(versions);
    return (lines.length ? '<div class="sr-changes"><h4>What changed</h4>' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' : '') +
      '<div class="sr-scroll"><table class="sr-table" data-no-sort><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  // ── Scenario history ──────────────────────────────────────────────────────
  // Every saved version of a deal, oldest first, with what moved the funding gap from the version before it.
  // versions: full saved records, oldest first, each with n (its number in the deal) and baseline/hidden flags.
  function historyModel(rules, prop123, versions) {
    var rows = versions.map(function (v, i) {
      var r = review(rules, prop123, v), e = r.engine || {};
      return { n: v.n, label: v.label || v.name || 'Untitled', at: v.at || '', by: v.by || '', baseline: !!v.baseline, hidden: !!v.hidden,
        stale: !!(v.calculator && v.calculator.stale), totalCost: num(e.totalDevelopmentCost), credit: v.calculator ? num(e.annualCredits) : null,
        creditEquity: num(e.creditEquity), gap: num(e.fundingGap), score: r.score.total, lane: r.lane.lane || '',
        change: i ? changeLines([versions[i - 1], v])[0] : '' };
    });
    var overall = versions.length > 1 ? changeLines([versions[0], versions[versions.length - 1]])[0] : '';
    return { rows: rows, overall: overall };
  }

  function historyHtml(m) {
    if (!m.rows.length) return '<p class="sr-muted">No versions yet.</p>';
    var fig = function (k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; };
    return (m.overall ? '<p class="sr-hist-overall"><strong>Overall:</strong> ' + esc(m.overall) + '</p>' : '') +
      '<ol class="sr-hist">' + m.rows.map(function (r) {
        return '<li><div class="sr-hist-head"><strong>' + esc('v' + r.n + ' · ' + r.label) + '</strong>' +
          (r.baseline ? ' <span class="rw-band">Baseline</span>' : '') + (r.hidden ? ' <span class="sr-muted">(hidden)</span>' : '') +
          '<div class="sr-muted">' + esc(r.at.slice(0, 16).replace('T', ' ')) + (r.by ? ' · ' + esc(r.by) : '') + '</div></div>' +
          '<dl class="sr-hist-figs">' + fig('Total cost', money(r.totalCost)) + fig('Modeled credit', money(r.credit)) + fig('Credit equity', money(r.creditEquity)) +
          fig('Funding gap', money(r.gap)) + fig('CHFA score', pts(r.score)) + fig('Gap-fund lane', r.lane || '—') + '</dl>' +
          (r.change ? '<p class="sr-hist-change">' + esc(r.change) + '</p>' : '<p class="sr-muted">First version.</p>') +
          (r.stale ? '<p class="sr-flag">The unit mix or election changed after the Deal Calculator export, so its model results are not shown.</p>' : '') + '</li>';
      }).join('') + '</ol>';
  }

  // A spreadsheet cell that starts with = + - @ could run as a formula, so text cells get a leading apostrophe.
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    var t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function historyCsv(m) {
    var head = ['Version', 'Label', 'Saved', 'Saved by', 'Total cost', 'Modeled annual credit', 'Credit equity', 'Funding gap', 'CHFA score', 'Gap-fund lane', 'What changed from the version before'];
    return [head].concat(m.rows.map(function (r) {
      return ['v' + r.n, r.label, r.at, r.by, r.totalCost, r.credit, r.creditEquity, r.gap, r.score, r.lane, r.change];
    })).map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  // A page of its own to print or save as PDF: the deal name, when it was built, the history.
  function historyPage(dealName, m, builtAt) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc('Scenario history: ' + dealName) + '</title><style>' +
      'body{font:15px/1.5 system-ui,sans-serif;color:#111;background:#fff;max-width:820px;margin:24px auto;padding:0 16px}' +
      'h1{font-size:1.3rem;margin:0 0 .25rem}.sr-muted{color:#555;font-size:.85rem}.sr-flag{color:#a11}' +
      '.sr-hist{list-style:none;padding:0}.sr-hist li{border:1px solid #ccc;border-radius:8px;padding:.6rem .8rem;margin:0 0 .6rem;break-inside:avoid}' +
      '.sr-hist-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.2rem .8rem;margin:.4rem 0}.sr-hist-figs dt{font-size:.8rem;color:#555}.sr-hist-figs dd{margin:0;font-variant-numeric:tabular-nums}' +
      '.sr-hist-overall{border-left:3px solid #0a6b5c;padding-left:.6rem}.rw-band{font-size:.75rem;border:1px solid #0a6b5c;border-radius:9999px;padding:0 6px}' +
      '</style></head><body><h1>' + esc('Scenario history: ' + dealName) + '</h1>' +
      '<p class="sr-muted">Built ' + esc(builtAt) + ' from the versions saved on the member site. Figures are the Deal Calculator\'s at the time each version was saved; a screening estimate, not underwriting.</p>' +
      historyHtml(m) + '</body></html>';
  }

  // ── Calculator export ─────────────────────────────────────────────────────
  // Reads a Deal Calculator "Export JSON" file: inputs carry units-<tier> without the dc- prefix.
  function fromCalculatorExport(snap) {
    if (!snap || typeof snap !== 'object' || !snap.inputs || !snap.url) return null;
    // An ownership-mode export leaves out the rental rate and AMI tiers, so it has no tax credit unit mix to read.
    if (snap.dealMode === 'ownership') return { error: 'That export is a for-sale (ownership) deal. Switch the Deal Calculator to rental, set the AMI tiers, and export again.' };
    var mix = {}, inp = snap.inputs, sched = snap.rentSchedule;
    var fromSchedule = !!(sched && sched.mode === 'schedule' && Array.isArray(sched.rows) && sched.rows.length);
    // A Market Analysis rent schedule replaces the manual grid in the engine, so its rows are the deal.
    if (fromSchedule) {
      sched.rows.forEach(function (r) {
        var u = num(r && r.units); if (!(u > 0)) return;
        var t = num(r && r.tier), key = r.tier === 'market' || !(t > 0) ? 'market' : t;
        mix[key] = (mix[key] || 0) + u;
      });
    } else
    // Same precedence as js/deal-engine.js: a tier counts only when ticked, and a bedroom split replaces the tier total.
    TIERS.forEach(function (t) {
      var on = inp['chk-' + t];
      if (on != null && (on === false || String(on) === '0' || String(on) === 'false')) return;
      var split = SPLIT_BR.reduce(function (s, br) { var n = num(inp['units-' + t + '-' + br]); return s + (n > 0 ? Math.floor(n) : 0); }, 0);
      var raw = num(inp['units-' + t]), u = split > 0 ? split : (raw > 0 ? Math.floor(raw) : 0);
      if (u) mix[t] = u;
    });
    var units = num(inp.units); units = units != null && units >= 0 ? Math.floor(units) : null; // whole homes only
    var restricted = TIERS.reduce(function (s, t) { return s + (mix[t] || 0); }, 0);
    // The calculator treats more tier units than total homes as a unit-mix error; so does the review.
    if (!fromSchedule && units != null && restricted > units) return { error: 'The export has ' + restricted + ' homes in AMI tiers but ' + units + ' total homes. Fix the unit mix in the Deal Calculator and export it again.' };
    if (!fromSchedule && units != null && units > restricted) mix.market = units - restricted;
    var o = snap.outputs || {};
    var engine = {};
    ['fundingGap', 'dscr', 'deferredDeveloperFee', 'annualCredits', 'creditEquity', 'totalDevelopmentCost', 'stateCreditEquity', 'firstMortgage'].forEach(function (k) {
      engine[k] = o[k] && typeof o[k].value === 'number' ? o[k].value : null;
      if (o[k] && o[k].value == null && o[k].unavailableReason) engine[k + 'Reason'] = o[k].unavailableReason;
    });
    var cov = mustPayCoverage(function (k) { return o[k] && typeof o[k].value === 'number' ? o[k].value : null; }, snap.debtCoverage);
    engine.dscr = cov.dscr; engine.dscrYear = cov.dscrYear;
    if (cov.dscr != null) delete engine.dscrReason; else engine.dscrReason = cov.dscrReason;
    var q = String(snap.url).indexOf('?'), query = q === -1 ? '' : String(snap.url).slice(q + 1);
    var param = function (k) { var m = query.match(new RegExp('(?:^|&)' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : null; };
    // The credit-rate radios share one key: rate-9=0.09 is 9%, rate-9=0.04 is 4%.
    var rate = num(inp['rate-9'] != null ? inp['rate-9'] : param('rate-9'));
    var election = String(inp['minimum-set-aside'] || param('minimum-set-aside') || '40-60');
    if (!ELECTION_LABEL[election]) election = '40-60';
    // The calculator defaults to CHFA LIHTC rents; HOME, Prop 123, other-AMI and market rents are a different model.
    var regime = String(inp['rent-limit-regime'] || param('rent-limit-regime') || 'chfa_lihtc');
    var REGIME_LABEL = { home_high: 'High HOME', home_low: 'Low HOME', prop123: 'Prop 123', ami_formula: 'other AMI-formula', market: 'market-rate' };
    // A blank request stays unknown: the calculator fills its output with modeled capacity, which is not a request.
    var req = num(inp['credit-requested'] != null ? inp['credit-requested'] : param('credit-requested'));
    var st = num(inp['state-annual'] != null ? inp['state-annual'] : param('state-annual'));
    return { mix: mix, engine: engine, requested: req != null && req >= 0 ? req : null, stateAnnual: st != null && st >= 0 ? st : null, query: query, nine: rate != null && rate > 0.06, chfa: regime === 'chfa_lihtc', regime: REGIME_LABEL[regime] || 'non-CHFA', election: election, exportedAt: snap.exportedAt || null };
  }

  // ── Stress tests (browser only) ───────────────────────────────────────────
  // DOH's starred hard-cost lines; js/deal-cost-basis.js holds the list (read from the calculator frame when loaded).
  var HARD_COST_IDS = ['building_acquisition', 'off_site', 'site_work', 'demolition', 'permits', 'tap_fees', 'structures',
    'general_requirements', 'overhead_profit', 'contractor_contingency', 'owner_contingency'];
  var STRESS = [
    { id: 'cost10', label: 'Hard cost +10%', why: 'The usual reason a gap opens after award.',
      apply: function (d, w) {
        var delta = 0, t = d.getElementById('dc-tdc');
        var ids = (w && w.DealCostBasis && w.DealCostBasis.HARD_COST_IDS) || HARD_COST_IDS;
        if (!t || !num(t.value)) return { skip: 'No total development cost entered.' };
        var itemizedHard = ids.some(function (id) { var el = d.getElementById('dc-cost-' + id); return el && num(el.value) > 0; });
        if (itemizedHard) {
          // Cost nobody itemized could be hard, land or soft (js/deal-cost-basis.js), so a partly itemized budget cannot
          // be given an honest hard-cost +10%.
          var r = w && w.__DealCalc && w.__DealCalc.getResult(), su = r && r.costBasis && r.costBasis.summary;
          var ni = su && !su.reason ? num(su.notItemized) : null;
          if (ni == null) return { skip: 'The calculator could not say how much of Total Development Cost is itemized, so hard cost +10% was not run.' };
          if (ni > 0.5) return { skip: money(ni) + ' of Total Development Cost is not itemized and could be hard, land or soft cost. Itemize all of it and run again.' };
        }
        ids.forEach(function (id) {
          var el = d.getElementById('dc-cost-' + id), v = el && num(el.value);
          if (v) { var nv = Math.round(v * 1.1); delta += nv - v; el.value = String(nv); }
        });
        // Itemized lines may not exceed Total Development Cost, so the total moves with them.
        if (delta) { t.value = String(num(t.value) + delta); return null; }
        t.value = String(Math.round(num(t.value) * 1.1));
        return 'No itemized hard costs, so total cost +10%.';
      } },
    { id: 'rate15', label: 'Loan rate +1.5 points', why: 'Permanent loan sizing.',
      apply: function (d) { var el = d.getElementById('dc-rate'); if (el && num(el.value) != null) el.value = String(num(el.value) + 1.5); else return { skip: 'No loan rate entered.' }; return null; } },
    { id: 'equity05', label: 'Equity price -$0.05', why: 'Investor pricing moves before closing.',
      apply: function (d, w) {
        var el = d.getElementById('dc-equity-price'); var base = el && num(el.value);
        if (base == null) { var r = w.__DealCalc.getResult(); base = r && num(r.equityPrice); }
        if (!el || base == null) return { skip: 'No equity price entered or modeled.' };
        el.value = String(Math.round((base - 0.05) * 1000) / 1000); return null;
      } }
  ];

  function loadFrame(doc, query, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var f = doc.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:absolute;width:1200px;height:900px;left:-10000px;top:0;border:0;visibility:hidden';
      f.src = 'deal-calculator.html' + (query ? '?' + query : '');
      var t0 = Date.now(), last = '', same = 0;
      function poll() {
        try {
          var w = f.contentWindow, dc = w && w.__DealCalc;
          if (dc && dc.getResult && dc.getResult()) {
            var o = JSON.stringify(dc.getOutputRecords());
            same = o === last ? same + 1 : 0; last = o;
            if (same >= 4) return resolve(f);
          }
        } catch (e) { return reject(e); }
        if (Date.now() - t0 > (timeoutMs || 45000)) return reject(new Error('The Deal Calculator did not finish loading.'));
        setTimeout(poll, 400);
      }
      f.addEventListener('load', function () { setTimeout(poll, 400); });
      doc.body.appendChild(f);
    });
  }

  // CHFA's coverage minimum runs through the initial 15-year period, so coverage is the weakest all-must-pay year of a
  // fully measured 15-year schedule. A shorter forecast, a gap in it, or no schedule leaves coverage unavailable.
  function mustPayCoverage(rec, coverage) {
    var years = coverage && Array.isArray(coverage.years) ? coverage.years.filter(function (y) { return num(y.year) != null && num(y.year) <= 15; }) : [];
    if (!years.length) return { dscr: null, dscrYear: null, dscrReason: 'The Deal Calculator gave no year-by-year debt coverage; CHFA\'s minimum applies through year 15. Set a 15-year pro forma and export again.' };
    var measured = years.filter(function (y) { return num(y.allMustPayCoverage) != null; });
    if (years.length < 15 || measured.length < 15) {
      return { dscr: null, dscrYear: null, dscrReason: years.length < 15
        ? 'The pro forma runs ' + years.length + ' years; CHFA\'s coverage minimum applies through year 15. Set the pro forma to 15 years or more and export again.'
        : 'Debt coverage is not measured in ' + (15 - measured.length) + ' of the first 15 years, so the 15-year minimum cannot be checked.' };
    }
    var low = measured.reduce(function (a, b) { return num(b.allMustPayCoverage) < num(a.allMustPayCoverage) ? b : a; });
    return { dscr: num(low.allMustPayCoverage), dscrYear: num(low.year), dscrReason: null };
  }

  function readEngine(w) {
    var o = w.__DealCalc.getOutputRecords(), r = w.__DealCalc.getResult();
    var v = function (k) { return o[k] && typeof o[k].value === 'number' ? o[k].value : null; };
    var why = function (k) { return o[k] && o[k].value == null ? o[k].unavailableReason : null; };
    var cov = mustPayCoverage(v, r && r.coverage);
    return { fundingGap: v('fundingGap'), fundingGapReason: why('fundingGap'), dscr: cov.dscr, dscrYear: cov.dscrYear, dscrReason: cov.dscrReason, deferredDeveloperFee: v('deferredDeveloperFee'),
      annualCredits: v('annualCredits'), creditEquity: v('creditEquity'), totalDevelopmentCost: v('totalDevelopmentCost'),
      paybackYear: r && r.exit && num(r.exit.dfYr), engineStress: r && r.stress ? r.stress : null };
  }

  function runStress(doc, query, rules, prop123, version, onProgress) {
    var results = [], base;
    function step(i) {
      if (i > STRESS.length) return Promise.resolve();
      return loadFrame(doc, query).then(function (f) {
        var w = f.contentWindow, d = w.document, note = null;
        if (i > 0) {
          note = STRESS[i - 1].apply(d, w);
          if (note && note.skip) {
            f.remove();
            results.push({ id: STRESS[i - 1].id, label: STRESS[i - 1].label, why: STRESS[i - 1].why, note: note.skip, engine: {}, skipped: true });
            if (onProgress) onProgress(i, STRESS.length);
            return step(i + 1);
          }
          w.__DealCalc.recalculate();
        }
        var e = readEngine(w);
        f.remove();
        if (i === 0) base = e;
        else if (e.fundingGap == null && e.dscr == null) {
          // Nothing to judge: the calculator could not work out a gap or coverage for this run.
          var reason = e.fundingGapReason || e.dscrReason;
          results.push({ id: STRESS[i - 1].id, label: STRESS[i - 1].label, why: STRESS[i - 1].why, engine: e, skipped: true,
            note: 'The calculator could not compute a funding gap or coverage for this test' + (reason ? ': ' + reason : '.') });
        } else results.push({ id: STRESS[i - 1].id, label: STRESS[i - 1].label, why: STRESS[i - 1].why, note: note, engine: e });
        if (onProgress) onProgress(i, STRESS.length);
        return step(i + 1);
      });
    }
    return step(0).then(function () {
      // The engine's own coverage tests (rents -10%, vacancy +5 points, operating cost +10%) come with the base run. They
      // stress year one only, so a pass says nothing about years 2-15; a year-one shortfall still fails.
      var es = base.engineStress || {};
      [['rent10', 'Rents -10%', 'Rent limits or market rents come in lower.'], ['opex10', 'Operating cost +10%', 'Insurance and utilities keep rising.'], ['vac5', 'Vacancy +5 points', 'Slower lease-up or turnover.']].forEach(function (k) {
        var s = es[k[0]], dscr = s ? num(s.dscr) : null;
        results.push({ id: k[0], label: k[1], why: k[2], note: dscr == null ? 'The calculator did not report coverage for this test (no must-pay debt or income entered).' : 'Year-one debt coverage only (the calculator\'s own stress test); years 2-15 are not tested and the loan is not resized.',
          engine: { dscr: dscr, dscrYear: dscr == null ? null : 1, fundingGap: null, deferredDeveloperFee: null, paybackYear: null }, coverageOnly: true, yearOneOnly: true, skipped: dscr == null });
      });
      results.forEach(function (t) { t.fails = t.skipped ? '' : stressFails(rules, t, base); });
      return { base: base, tests: results };
    });
  }

  // The AMI test needs no engine run, so it is worked out from the version as it stands.
  function amiStress(rules, prop123, version) {
    var bump = bumpOneUnit((version.deal || {}).mix || {});
    if (!bump) return null;
    var v2 = JSON.parse(JSON.stringify(version)); v2.deal.mix = bump.mix;
    var r1 = review(rules, prop123, version), r2 = review(rules, prop123, v2);
    var t = { id: 'ami1', label: 'One unit from ' + bump.from + '% to ' + bump.to + '% AMI', why: 'Shows whether the gap-fund lane or targeting points flip.',
      note: 'Score ' + pts(r1.score.total) + ' → ' + pts(r2.score.total) + '; midpoint ' + (r1.lane.midpoint || 0).toFixed(2) + '% → ' + (r2.lane.midpoint || 0).toFixed(2) + '%; lane ' + r1.lane.lane + ' → ' + r2.lane.lane + '.',
      engine: { fundingGap: null, dscr: null }, scoreBefore: r1.score.total, scoreAfter: r2.score.total, laneAfter: r2.lane.lane, laneBefore: r1.lane.lane, scoreOnly: true,
      setAsideBefore: r1.score.setAside.qualifies, setAsideAfter: r2.score.setAside.qualifies };
    t.fails = stressFails(rules, t, {});
    return t;
  }

  function stressFails(rules, t, base) {
    var why = [], min = rules.minimum_score.points;
    var e = t.engine || {};
    if (e.fundingGap != null && base.fundingGap != null && e.fundingGap > Math.max(0, base.fundingGap)) why.push('gap opens to ' + money(e.fundingGap));
    var dcr = rules.underwriting.dcr_min; // QAP: "Minimum 1.15 to 1.0 for all amortized debt"
    if (e.dscr != null && e.dscr < dcr) why.push('coverage ' + e.dscr.toFixed(2) + 'x is under CHFA\'s ' + dcr.toFixed(2) + 'x minimum');
    if (t.scoreAfter != null && t.scoreBefore >= min && t.scoreAfter < min) why.push('score falls under ' + min);
    if (t.laneAfter && t.laneAfter !== t.laneBefore) why.push('lane flips to ' + t.laneAfter);
    if (t.setAsideBefore && t.setAsideAfter === false) why.push('the unit mix no longer meets its set-aside election');
    return why.length ? why.join('; ') : '';
  }

  // ── Storage: the private backend, or this device when the backend is absent ──
  function makeStore(fetchFn, storage) {
    var local = {
      read: function () { try { return JSON.parse(storage.getItem(LOCAL_KEY) || '{}'); } catch (e) { return {}; } },
      // A failed write (storage full or blocked) throws, so the save is reported as not saved.
      write: function (o) {
        try { storage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch (e) { throw new Error('this browser would not keep it (storage full or blocked)'); }
      }
    };
    var mode = null; // 'server' or 'device'
    function api(path, opts) {
      return fetchFn(API + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {})).then(function (r) {
        if (!r.ok) throw new Error('Save service answered ' + r.status);
        return r.json();
      });
    }
    function detect() {
      if (mode) return Promise.resolve(mode);
      return api('').then(function (j) { mode = j && j.deals ? 'server' : 'device'; return mode; }, function () { mode = 'device'; return mode; });
    }
    function stamp() { var d = new Date(); return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + Math.random().toString(16).slice(2, 8).padEnd(6, '0'); }
    return {
      mode: function () { return mode; },
      deals: function () {
        return detect().then(function (m) {
          if (m === 'server') return api('').then(function (j) { return j.deals; });
          var o = local.read();
          return Object.keys(o).map(function (id) { var vs = o[id].versions || []; return { id: id, name: o[id].name, versions: vs.length, latest: vs[0] || null }; });
        });
      },
      versions: function (deal) {
        return detect().then(function (m) {
          if (m === 'server') return api('?deal=' + encodeURIComponent(deal));
          var d = local.read()[deal] || { versions: [] };
          return { deal: deal, versions: d.versions.map(function (v) { return { v: v.v, name: v.name, label: v.label, by: v.by, at: v.at, score: v.score, gap: v.gap, lane: v.lane }; }), baseline: d.baseline || '', hidden: d.hidden || [] };
        });
      },
      get: function (deal, v) {
        return detect().then(function (m) {
          if (m === 'server') return api('?deal=' + encodeURIComponent(deal) + '&v=' + encodeURIComponent(v));
          var d = local.read()[deal]; var hit = d && d.versions.filter(function (x) { return x.v === v; })[0];
          return hit || null;
        });
      },
      save: function (body) {
        return detect().then(function (m) {
          if (m === 'server') return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          var o = local.read();
          var id = body.deal || (String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deal') + '-' + Math.random().toString(16).slice(2, 8);
          var d = o[id] || (o[id] = { name: body.name, versions: [], baseline: '', hidden: [] });
          d.name = body.name; // the latest save names the deal, so a rename sticks
          var meta = { v: stamp(), name: body.name, label: body.label || '', by: 'this device', at: new Date().toISOString(),
            score: body.summary && body.summary.score, gap: body.summary && body.summary.gap, lane: body.summary && body.summary.lane };
          d.versions.unshift(Object.assign({}, meta, { deal: id, parent: body.parent || '', data: body.data }));
          local.write(o);
          return { deal: id, v: meta.v, meta: meta };
        });
      },
      meta: function (deal, action, v) {
        return detect().then(function (m) {
          var body = { deal: deal }; body[action] = v;
          if (m === 'server') return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          var o = local.read(), d = o[deal]; if (!d) return null;
          if (action === 'baseline') d.baseline = v;
          if (action === 'hide' && d.hidden.indexOf(v) === -1) d.hidden.push(v);
          if (action === 'unhide') d.hidden = d.hidden.filter(function (x) { return x !== v; });
          if (action === 'purge') {
            d.versions = d.versions.filter(function (x) { return x.v !== v; });
            d.hidden = d.hidden.filter(function (x) { return x !== v; });
            if (d.baseline === v) d.baseline = '';
          }
          local.write(o); return d;
        });
      },
      // The whole deal for good. The server deletes a very large deal in rounds and says {more}.
      removeDeal: function (deal) {
        return detect().then(function (m) {
          if (m === 'server') {
            var round = function (n) {
              return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteDeal: deal }) }).then(function (j) {
                if (j && j.more) { if (n >= 100) throw new Error('the deal is only partly deleted; try again to finish'); return round(n + 1); }
                return j;
              });
            };
            return round(1);
          }
          var o = local.read(); delete o[deal]; local.write(o); return { ok: true };
        });
      }
    };
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  function statHtml(r) {
    var s = r.score, l = r.lane, th = r.thresholds, g = num(r.engine.fundingGap);
    var tile = function (v, label, cls) { return '<div class="rw-stat' + (cls ? ' ' + cls : '') + '"><div class="rw-stat-v">' + v + '</div>' + label + '</div>'; };
    return tile(esc(pts(s.total)) + '<span class="sr-of"> / ' + s.minimum + '</span>', s.meets ? 'CHFA points: clears the 9% minimum.' : (s.primaryOk ? 'CHFA points: ' + esc(pts(-s.margin)) + ' short of the 9% minimum.' : (s.setAside.qualifies ? 'CHFA points: no primary criterion points yet.' : 'CHFA points: the unit mix misses its set-aside election.')), s.meets ? 'sr-ok' : 'sr-bad') +
      tile(esc(l.lane === 'unknown' ? '—' : money(l.amount)), esc(l.lane === 'unknown' ? l.text : 'Gap funds: ' + l.lane + ' ' + l.kind + '.'), l.flags.length ? 'sr-warn' : '') +
      tile(String(th.missing) + '<span class="sr-of"> missing</span>', 'Threshold items: ' + th.ready + ' ready, ' + th.unchecked + ' not checked' + (th.na ? ', ' + th.na + ' do not apply' : '') + '.', th.missing ? 'sr-bad' : (th.unchecked ? 'sr-warn' : 'sr-ok')) +
      tile(g == null ? '—' : esc(money(g)), g == null ? 'Funding gap: load a Deal Calculator export to see it.' : 'Funding gap after modeled sources.', g > 0 ? 'sr-warn' : '');
  }

  function linesTableHtml(r) {
    var label = { counted: 'Counted', 'not claimed': 'Not claimed', missing: 'Not earned', excluded: 'Not counted', 'needs entry': 'Enter points' };
    return '<div class="sr-scroll"><table class="sr-table" data-no-sort><thead><tr><th scope="col" data-tip="One scoring item from QAP Section 5, with CHFA wording">Scoring line</th><th scope="col" class="sr-num" data-tip="Points this draft earns on the line">Points</th><th scope="col" class="sr-num" data-tip="Most the line can earn">Possible</th><th scope="col" data-tip="Counted, not claimed, not earned, or not counted because another line excludes it">Status</th></tr></thead><tbody>' +
      r.score.lines.map(function (l) {
        return '<tr><td><strong>' + esc(l.label) + '</strong> <span class="sr-muted">QAP ' + esc(l.section) + ', p. ' + esc(l.page) + '</span>' +
          (l.note ? '<div class="sr-muted">' + esc(l.note) + '</div>' : '') +
          '<div class="rw-quote">"' + esc(l.quote) + '"</div>' +
          (l.change ? '<div class="sr-muted">Change in the draft: ' + esc(l.change) + '</div>' : '') +
          (l.unconfirmed ? '<div class="sr-flag">Unconfirmed: ' + esc(l.unconfirmed) + '</div>' : '') + '</td>' +
          '<td class="sr-num">' + esc(pts(l.points)) + '</td><td class="sr-num">' + esc(l.possible == null ? 'tier' : pts(l.possible)) + '</td><td>' + esc(label[l.status] || l.status) + '</td></tr>';
      }).join('') + '<tr class="sr-total"><td>Total</td><td class="sr-num">' + esc(pts(r.score.total)) + '</td><td class="sr-num">' + r.score.minimum + ' needed</td><td></td></tr></tbody></table></div>';
  }

  function stressHtml(rules, st) {
    if (!st) return '<p>Run the tests to see them here.</p>';
    var b = st.base;
    var cell = function (v, f) { return v == null ? '—' : f(v); };
    var ratio = function (x) { return x.toFixed(2) + 'x'; };
    return '<p class="sr-muted">Base run: gap ' + esc(cell(b.fundingGap, money)) + (b.fundingGap == null && b.fundingGapReason ? ' (' + esc(b.fundingGapReason) + ')' : '') +
      ', coverage ' + esc(cell(b.dscr, ratio)) + ', deferred fee ' + esc(cell(b.deferredDeveloperFee, money)) + '.</p>' +
      '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col" data-tip="What changes in the Deal Calculator for this run">Test</th><th scope="col" class="sr-num" data-tip="Sources still needed after the modeled loan, equity and soft funds">Funding gap</th><th scope="col" class="sr-num" data-tip="Weakest debt coverage in years 1 to 15: net operating income over all must-pay debt service">Coverage</th><th scope="col" class="sr-num" data-tip="Developer fee paid later from cash flow">Deferred fee</th><th scope="col" data-tip="Fails when the gap grows, coverage drops under the CHFA 1.15 minimum, the score falls under 130, or the gap-fund lane changes">Result</th></tr></thead><tbody>' +
      st.tests.map(function (t) {
        var e = t.engine || {};
        return '<tr><td><strong>' + esc(t.label) + '</strong><div class="sr-muted">' + esc(t.why) + (t.note ? ' ' + esc(t.note) : '') + '</div></td>' +
          '<td class="sr-num">' + esc(cell(e.fundingGap, money)) + '</td><td class="sr-num">' + esc(cell(e.dscr, ratio)) + (e.dscr != null && e.dscrYear ? ' <span class="sr-muted">(yr ' + esc(String(e.dscrYear)) + ')</span>' : '') + '</td><td class="sr-num">' + esc(cell(e.deferredDeveloperFee, money)) + '</td>' +
          '<td>' + (t.skipped ? '<span class="sr-muted">Not run</span>' : t.fails ? '<span class="sr-flag">Fails: ' + esc(t.fails) + '</span>' : (t.yearOneOnly ? 'Holds in year one; later years not tested' : !t.scoreOnly && (t.engine || {}).dscr == null ? 'Holds; coverage not checked' : 'Holds')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function sameDeal(d, calc) {
    if (!calc || !calc.mix) return true; // versions saved before the export's mix was kept
    if ((d.election || '40-60') !== (calc.election || '40-60')) return false;
    return tiersOf(d.mix).concat(tiersOf(calc.mix), ['market']).every(function (t) { return (num(d.mix[t]) || 0) === (num(calc.mix[t]) || 0); });
  }

  function mount(doc, rules, prop123, store) {
    var $ = function (id) { return doc.getElementById(id); };
    var state = { nav: 0, deal: null, name: '', parent: '', version: blankVersion(), stress: null, versions: [], picked: {}, cache: {}, hidden: [], baseline: '', gone: {} };

    function blankVersion() { return { deal: { mix: {}, place: '', election: '40-60', applicant: '', gpRole: '', supportive: false, rehab: false, existingCredit: false, subsidyExpiring: false, otherActiveCredits: null, stateCredits: null, creditRequested: null }, claims: {}, thresholds: {}, documents: [], engine: {}, calculator: null }; }

    // Form → state
    function readForm() {
      var v = state.version, d = v.deal;
      TIERS.concat(['market']).forEach(function (t) { var el = $('sr-mix-' + t); var n = el ? num(el.value) : null; d.mix[t] = n > 0 ? Math.floor(n) : 0; });
      d.place = $('sr-place').value.trim();
      d.gpRole = $('sr-gp-role').value;
      d.applicant = $('sr-applicant').value;
      d.election = $('sr-election').value;
      d.supportive = $('sr-supportive').checked;
      d.rehab = $('sr-rehab').checked;
      d.existingCredit = $('sr-existing').checked;
      d.subsidyExpiring = $('sr-subsidy-expiring').checked;
      var oc = num($('sr-other-credits').value); d.otherActiveCredits = oc != null && oc >= 0 ? oc : null;
      if (!v.calculator) {
        var ac = num($('sr-credits').value); d.creditRequested = ac != null && ac >= 0 ? ac : null;
        var sc = num($('sr-state-credits').value); d.stateCredits = sc != null && sc >= 0 ? sc : null;
      }
      doc.querySelectorAll('[data-claim]').forEach(function (el) {
        var id = el.getAttribute('data-claim');
        var n = num(el.value);
        v.claims[id] = el.type === 'checkbox' ? el.checked : (n > 0 ? Math.floor(n) : null); // whole points, as the form's step=1 asks
        var ref = doc.querySelector('[data-ref="' + id + '"]'); if (ref) v.claims[id + ':ref'] = ref.value.slice(0, 200);
      });
      doc.querySelectorAll('[data-threshold]').forEach(function (el) {
        var tid = el.getAttribute('data-threshold'), rule = rules.thresholds.filter(function (t) { return t.id === tid; })[0];
        var applies = rule && conditionHolds(rule.applies, d);
        if (el.value === 'na' && rule && (!rule.applies || applies)) el.value = ''; // "Does not apply" no longer holds once its condition is ticked
        v.thresholds[tid] = el.value;
        var ref = doc.querySelector('[data-tref="' + el.getAttribute('data-threshold') + '"]'); if (ref) v.thresholds[el.getAttribute('data-threshold') + ':ref'] = ref.value.slice(0, 200);
      });
    }
    function extraTierNote(mix) {
      var extra = tiersOf(mix).filter(function (t) { return TIERS.indexOf(t) === -1 && num(mix[t]) > 0; });
      return extra.length ? ' Also in the export, not editable here: ' + extra.map(function (t) { return mix[t] + ' at ' + t + '% AMI'; }).join(', ') + '.' : '';
    }
    function writeForm() {
      var v = state.version, d = v.deal;
      TIERS.concat(['market']).forEach(function (t) { var el = $('sr-mix-' + t); if (el) el.value = d.mix[t] ? d.mix[t] : ''; });
      $('sr-place').value = d.place || '';
      $('sr-gp-role').value = d.gpRole || '';
      $('sr-applicant').value = d.applicant || '';
      $('sr-election').value = d.election || '40-60';
      $('sr-supportive').checked = !!d.supportive; $('sr-rehab').checked = !!d.rehab; $('sr-existing').checked = !!d.existingCredit; $('sr-subsidy-expiring').checked = !!d.subsidyExpiring;
      $('sr-other-credits').value = d.otherActiveCredits != null ? d.otherActiveCredits : '';
      $('sr-state-credits').value = d.stateCredits != null ? d.stateCredits : '';
      var req = d.creditRequested !== undefined ? d.creditRequested : (v.calculator ? null : v.engine.annualCredits);
      $('sr-credits').value = req != null ? req : '';
      $('sr-credits').disabled = !!v.calculator; $('sr-state-credits').disabled = !!v.calculator; // both come from the export
      doc.querySelectorAll('[data-claim]').forEach(function (el) {
        var id = el.getAttribute('data-claim'), c = v.claims[id];
        if (el.type === 'checkbox') el.checked = !!c; else el.value = c == null ? '' : c;
        var ref = doc.querySelector('[data-ref="' + id + '"]'); if (ref) ref.value = v.claims[id + ':ref'] || '';
      });
      doc.querySelectorAll('[data-threshold]').forEach(function (el) {
        var id = el.getAttribute('data-threshold'); el.value = v.thresholds[id] || '';
        var ref = doc.querySelector('[data-tref="' + id + '"]'); if (ref) ref.value = v.thresholds[id + ':ref'] || '';
      });
      $('sr-docs').innerHTML = v.documents.length ? v.documents.map(function (f) { return '<li>' + esc(f.name) + ' <span class="sr-muted">(' + Math.round(f.size / 1024) + ' KB, fingerprint ' + esc(f.sha256.slice(0, 12)) + '…, not stored)</span></li>'; }).join('') : '<li class="sr-muted">None yet.</li>';
      $('sr-calc-status').textContent = v.calculator ? 'Deal Calculator export loaded' + (v.calculator.exportedAt ? ' (exported ' + v.calculator.exportedAt.slice(0, 10) + ')' : '') + '. Unit mix and model results come from it.' + extraTierNote(d.mix) : 'No Deal Calculator export loaded. Type the unit mix below; stress tests need an export.';
      setStressButton();
    }
    function setStressButton() {
      var v = state.version;
      $('sr-stress-run').disabled = !v.calculator || !!v.calculator.stale;
    }

    function draw() {
      var r = review(rules, prop123, state.version);
      $('srStats').innerHTML = statHtml(r);
      $('srNext').innerHTML = '<strong>Fix first:</strong> ' + esc(r.next);
      $('srRisks').innerHTML = r.risks.length ? r.risks.map(function (x) { return '<li class="sr-' + x.level + '">' + esc(x.text) + '</li>'; }).join('') : '<li>No flags.</li>';
      $('srAdd').innerHTML = r.score.addable.length ? r.score.addable.slice(0, 6).map(function (a) { return '<li><strong>' + (a.id === '5A1d-eli' ? 'up to +' : '+') + a.points + '</strong> ' + esc(a.how) + '</li>'; }).join('') : '<li>Nothing easy left to add.</li>';
      $('srLines').innerHTML = linesTableHtml(r);
      var l = r.lane;
      $('srLane').innerHTML = '<p><strong>' + esc(l.text) + '</strong></p>' + (l.why ? '<p>' + esc(l.why) + '</p>' : '') +
        '<p class="sr-muted">' + esc(r.prop123.text) + '</p>' +
        (l.flags.length ? '<ul>' + l.flags.map(function (f) { return '<li class="sr-flag">' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
        l.quotes.map(function (q) { return '<div class="rw-quote">"' + esc(q) + '" (QAP 3.B.9, p. ' + rules.gap_pilot.page + ')</div>'; }).join('') +
        (l.mustPay ? '<p class="sr-muted">This lane is a must-pay loan, so it reduces debt coverage. Put it in the Deal Calculator as a must-pay tranche to see the effect.</p>' : '');
      var cr = r.credit;
      $('srCredit').textContent = cr.status === 'unknown' ? 'Annual federal credit not entered.' : (cr.status === 'depends' ? 'Annual federal credit ' + money(cr.total) + (cr.other ? ' with other active applications' : '') + ': over the ' + money(cr.cap) + ' pilot cap, within the ' + money(cr.altCap) + ' cap if pilot gap funds are not available.'
        : 'Annual federal credit ' + money(cr.total) + (cr.other ? ' with other active applications' : '') + ' against the ' + money(cr.cap) + ' cap: ' + (cr.status === 'over' ? 'over the cap.' : 'within it.')) +
        (cr.status !== 'unknown' && !cr.applicantKnown ? ' Other active applications not entered yet.' : '');
      $('srSummary').innerHTML = summaryLines(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      var shown = state.stress ? { base: state.stress.base, tests: state.stress.tests.filter(function (t) { return t.id !== 'ami1'; }) } : null;
      var ami = state.stress ? amiStress(rules, prop123, state.version) : null;
      if (ami) shown.tests.push(ami);
      $('srStress').innerHTML = stressHtml(rules, shown);
      state.shownStress = shown;
      return r;
    }

    // The engine runs depend only on the calculator export: claims and thresholds keep them, but an
    // edited unit mix or election no longer matches the exported deal, so its results are set aside.
    function onChange() {
      readForm();
      var c = state.version.calculator;
      if (c) {
        var stale = !sameDeal(state.version.deal, c);
        if (stale && !c.stale) state.stress = null;
        c.stale = stale; setStressButton();
      }
      draw();
    }

    // Uploads: a calculator export fills the deal; any other file is fingerprinted, never stored.
    $('sr-file').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files || []);
      files.forEach(function (file) {
        var started = state.version;
        if (/\.json$/i.test(file.name)) {
          file.text().then(function (t) {
            if (state.version !== started) { flash(file.name + ' was not imported: another deal or version was opened while it was read. Add it again.'); return; }
            var snap; try { snap = JSON.parse(t); } catch (e) { snap = null; }
            var c = fromCalculatorExport(snap);
            if (!c) { flash('That JSON is not a Deal Calculator export.'); return; }
            if (c.error) { flash(c.error); return; }
            var v = started, hadCalc = !!v.calculator;
            v.deal.mix = c.mix; v.deal.election = c.election; v.deal.calc4 = !c.nine;
            v.deal.calcRegime = c.nine && !c.chfa ? c.regime : null;
            if (c.nine && c.chfa) {
              v.calculator = { query: c.query, exportedAt: c.exportedAt, nine: true, election: c.election, mix: Object.assign({}, c.mix), stale: false };
              v.engine = c.engine;
              v.deal.creditRequested = c.requested; v.deal.stateCredits = c.stateAnnual;
            } else {
              // A 4% model's credits and financing do not belong beside a 9% score: keep only the unit mix.
              // Credits imported with an earlier 9% export described that model; typed ones stay.
              if (hadCalc) { v.deal.creditRequested = null; v.deal.stateCredits = null; }
              v.calculator = null; v.engine = {};
              flash(c.nine ? 'This export uses ' + c.regime + ' rent limits, not CHFA LIHTC, so only its unit mix was used. Set rent limits to CHFA LIHTC and export again for gap, coverage, credit and stress results.'
                : 'This export is set to 4%, so only its unit mix was used. Export the deal at 9% for gap, coverage, credit and stress results.');
            }
            writeForm(); state.stress = null; draw();
          });
        } else {
          file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (h) {
            if (state.version !== started) { flash(file.name + ' was not recorded: another deal or version was opened while it was read. Add it again.'); return; }
            var hex = Array.prototype.map.call(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
            started.documents.push({ name: file.name.slice(0, 160), size: file.size, sha256: hex, added: new Date().toISOString().slice(0, 10) });
            writeForm();
            flash(file.name + ' recorded by name and fingerprint. Type its figures and page numbers into the form; the file itself is not kept.');
          });
        }
      });
      ev.target.value = '';
    });

    doc.getElementById('srForm').addEventListener('input', onChange);
    doc.getElementById('srForm').addEventListener('change', onChange);

    $('sr-stress-run').addEventListener('click', function () {
      var v = state.version; if (!v.calculator) return;
      readForm();
      var btn = $('sr-stress-run'); btn.disabled = true;
      $('srStress').innerHTML = '<p>Running the Deal Calculator… 0 of ' + (STRESS.length + 1) + '</p>';
      var calc = v.calculator;
      // A run belongs to the version and export it started on; an edit or another version while it runs discards it.
      var current = function () { return state.version === v && v.calculator === calc && !calc.stale; };
      runStress(doc, calc.query, rules, prop123, v, function (i, n) { if (current()) $('srStress').innerHTML = '<p>Running the Deal Calculator… ' + (i + 1) + ' of ' + (n + 1) + '</p>'; })
        .then(function (st) { if (!current()) { draw(); return; } state.stress = st; v.engine = Object.assign({}, v.engine, { fundingGap: st.base.fundingGap, dscr: st.base.dscr, deferredDeveloperFee: st.base.deferredDeveloperFee, annualCredits: st.base.annualCredits, creditEquity: st.base.creditEquity, totalDevelopmentCost: st.base.totalDevelopmentCost }); draw(); })
        .catch(function (e) { if (current()) $('srStress').innerHTML = '<p class="sr-flag">' + esc(e.message) + '</p>'; })
        .then(function () { setStressButton(); });
    });

    // Saving and versions
    function refreshDeals(selectId) {
      var nav = state.nav;
      return store.deals().then(function (deals) {
        $('sr-deal').innerHTML = '<option value="">New deal</option>' + deals.map(function (d) {
          return '<option value="' + esc(d.id) + '">' + esc(d.name) + ' (' + d.versions + ' version' + (d.versions === 1 ? '' : 's') + ')</option>';
        }).join('');
        // A deal picked while the list loaded wins over the one this refresh was asked to show.
        $('sr-deal').value = (state.nav === nav && selectId) || state.deal || '';
        $('srStore').textContent = store.mode() === 'server' ? 'Saved to your own login on the developer site; teammates do not see your deals. A save never overwrites an earlier version.' : 'The save service is not reachable, so versions are kept on this device only.';
      });
    }
    function refreshVersions() {
      clearHistory(); // the last deal's history must not stay on screen or export while another loads
      $('sr-delete-deal').hidden = !state.deal;
      if (!state.deal) { $('srVersions').innerHTML = '<p class="sr-muted">Save this deal to start its version list.</p>'; drawHistory(); return Promise.resolve(); }
      var deal = state.deal;
      return store.versions(deal).then(function (res) {
        if (state.deal !== deal) return; // another deal was picked while this loaded
        state.versions = res.versions; state.hidden = res.hidden || []; state.baseline = res.baseline || '';
        // Newest first from the server; number them oldest first, hidden ones included, so a number never shifts.
        state.num = {}; res.versions.forEach(function (v, i) { state.num[v.v] = res.versions.length - i; });
        var show = $('sr-show-hidden').checked;
        var rows = res.versions.filter(function (v) { return show || state.hidden.indexOf(v.v) === -1; });
        $('srVersions').innerHTML = rows.length ? '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col" data-tip="Tick two to four versions to compare">Compare</th><th scope="col" data-tip="Label, when it was saved and who saved it">Version</th><th scope="col" class="sr-num" data-tip="CHFA points when saved">Score</th><th scope="col" data-tip="DOH or OEDIT gap-fund lane when saved">Lane</th><th scope="col" class="sr-num" data-tip="Funding gap when saved">Gap</th><th scope="col" data-tip="Open, star as baseline, hide (kept, off the list) or delete for good">Actions</th></tr></thead><tbody>' +
          rows.map(function (v) {
            var hid = state.hidden.indexOf(v.v) !== -1, base = state.baseline === v.v;
            return '<tr><td><label class="sr-pick-wrap"><input type="checkbox" class="sr-pick" data-v="' + esc(v.v) + '" aria-label="Compare ' + esc(v.label || v.v) + '"' + (state.picked[v.v] ? ' checked' : '') + '></label></td>' +
              '<td><strong>' + esc('v' + state.num[v.v] + ' · ' + (v.label || 'Untitled')) + '</strong>' + (base ? ' <span class="rw-band">Baseline</span>' : '') + (hid ? ' <span class="sr-muted">(hidden)</span>' : '') +
              '<div class="sr-muted">' + esc((v.at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(v.by || '') + '</div></td>' +
              '<td class="sr-num">' + esc(pts(v.score)) + '</td><td>' + esc(v.lane || '—') + '</td><td class="sr-num">' + esc(money(v.gap)) + '</td>' +
              '<td><button type="button" class="sr-btn" data-act="open" data-v="' + esc(v.v) + '">Open</button> ' +
              (base ? '' : '<button type="button" class="sr-btn" data-act="baseline" data-v="' + esc(v.v) + '">Make baseline</button> ') +
              '<button type="button" class="sr-btn" data-act="' + (hid ? 'unhide' : 'hide') + '" data-v="' + esc(v.v) + '">' + (hid ? 'Unhide' : 'Hide') + '</button> ' +
              '<button type="button" class="sr-btn" data-act="purge" data-v="' + esc(v.v) + '" aria-label="Delete v' + state.num[v.v] + ' for good">Delete</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="sr-muted">No versions yet.</p>';
        drawHistory();
      });
    }
    // The latest HISTORY_MAX versions, read in full (cached), oldest first; hidden ones only when shown above.
    var HISTORY_MAX = 40, historyTok = 0, lastHistory = null;
    function clearHistory() {
      historyTok++; lastHistory = null; $('sr-hist-print').disabled = $('sr-hist-csv').disabled = true;
    }
    function drawHistory() {
      clearHistory();
      var tok = historyTok, deal = state.deal;
      if (!deal) { $('srHistory').innerHTML = '<p class="sr-muted">Pick a saved deal to see how its scenarios developed.</p>'; return; }
      var show = $('sr-show-hidden').checked;
      var list = state.versions.filter(function (v) { return show || state.hidden.indexOf(v.v) === -1; }).slice(0, HISTORY_MAX).reverse();
      if (!list.length) { $('srHistory').innerHTML = '<p class="sr-muted">No versions yet.</p>'; return; }
      $('srHistory').innerHTML = '<p class="sr-muted">Reading ' + list.length + ' version' + (list.length === 1 ? '' : 's') + '…</p>';
      Promise.all(list.map(function (x) { return getVersion(x.v); })).then(function (vs) {
        if (tok !== historyTok || state.deal !== deal) return;
        if (vs.some(function (x) { return !x; })) { $('srHistory').innerHTML = '<p class="sr-flag">A version could not be read, so there is no history. Reload and try again.</p>'; return; }
        var m = historyModel(rules, prop123, vs.map(function (x) {
          return Object.assign({}, x, { n: state.num[x.v], baseline: state.baseline === x.v, hidden: state.hidden.indexOf(x.v) !== -1 });
        }));
        m.name = vs[vs.length - 1].name || 'Saved deal'; // the latest save names the deal
        lastHistory = m;
        $('srHistory').innerHTML = (state.versions.length > HISTORY_MAX ? '<p class="sr-muted">Showing the latest ' + HISTORY_MAX + ' of ' + state.versions.length + ' versions.</p>' : '') + historyHtml(m);
        $('sr-hist-print').disabled = $('sr-hist-csv').disabled = false;
      }, function () { if (tok === historyTok) $('srHistory').innerHTML = '<p class="sr-flag">A version could not be read, so there is no history. Reload and try again.</p>'; });
    }
    function historyFile() { return (lastHistory.name || 'deal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deal'; }
    function download(name, type, text) {
      var url = URL.createObjectURL(new Blob([text], { type: type }));
      var a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    $('sr-hist-csv').addEventListener('click', function () {
      if (lastHistory) download('scenario-history-' + historyFile() + '.csv', 'text/csv;charset=utf-8', historyCsv(lastHistory));
    });
    $('sr-hist-print').addEventListener('click', function () {
      if (!lastHistory) return;
      // Its own page, so the browser's Print or Save as PDF takes the history alone.
      var html = historyPage(lastHistory.name, lastHistory, new Date().toLocaleString());
      var w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
      if (!w) download('scenario-history-' + historyFile() + '.html', 'text/html', html);
    });
    function getVersion(v) {
      var deal = state.deal, key = deal + '/' + v;
      if (state.cache[key]) return Promise.resolve(state.cache[key]);
      return store.get(deal, v).then(function (rec) {
        if (!rec || state.deal !== deal) return null; // dropped if another deal was picked meanwhile
        if (state.gone[key]) return null; // deleted while this read was out: never opened or cached
        var data = rec.data || {};
        var out = Object.assign({}, data, { v: rec.v, label: rec.label, name: rec.name, at: rec.at, by: rec.by });
        state.cache[key] = out; return out;
      });
    }
    // Every deal pick or version open bumps state.nav; a slower, earlier request then lands on nothing.
    function openLatest(v) {
      var t = ++state.nav;
      // Resolves false when the version could not be read, so a deal pick can clear the form instead of keeping the old deal.
      state.opening = t; // Save waits for the version being opened
      var done = function () { if (state.opening === t) state.opening = 0; };
      return getVersion(v).then(function (rec) { done(); if (t !== state.nav) return true; openVersion(rec); return !!rec; },
        function (e) { done(); throw e; });
    }

    function clearForm() { state.version = blankVersion(); state.stress = null; state.parent = ''; $('sr-label').value = ''; writeForm(); draw(); }

    $('sr-deal').addEventListener('change', function () {
      state.nav++;
      state.deal = $('sr-deal').value || null; state.picked = {}; state.parent = '';
      state.loading = !!state.deal; // no saving until this deal's version has opened
      drawCompare();
      var opt = $('sr-deal').selectedOptions[0];
      $('sr-name').value = state.deal ? opt.textContent.replace(/ \(\d+ versions?\)$/, '') : '';
      if (!state.deal) clearForm();
      var deal = state.deal;
      refreshVersions().then(function () {
        if (!deal || state.deal !== deal) return;
        var first = state.versions.filter(function (v) { return state.hidden.indexOf(v.v) === -1; })[0];
        var pick = state.baseline && state.versions.some(function (v) { return v.v === state.baseline; }) ? state.baseline : first && first.v;
        if (pick) return openLatest(pick).then(function (ok) { if (!ok && state.deal === deal) { clearForm(); if (!state.gone[deal + '/' + pick]) flash('That deal\'s latest version could not be read, so the form was cleared.'); } });
        clearForm(); // no version to open: never leave the previous deal's figures under this one
      }).catch(function (e) {
        if (state.deal !== deal) return;
        clearForm(); flash('Could not load that deal: ' + e.message + '. The form was cleared so the other deal\'s figures are not saved under it.');
      }).then(function () { if (state.deal === deal) state.loading = false; });
    });
    $('sr-show-hidden').addEventListener('change', refreshVersions);

    function openVersion(rec) {
      if (!rec) return;
      var v = blankVersion();
      ['deal', 'claims', 'thresholds', 'documents', 'engine', 'calculator'].forEach(function (k) { if (rec[k] != null) v[k] = JSON.parse(JSON.stringify(rec[k])); });
      state.version = v; state.stress = rec.stress ? { base: rec.stressBase || {}, tests: rec.stress } : null; state.parent = rec.v;
      $('sr-label').value = '';
      writeForm(); draw();
      flash('Opened "' + (rec.label || 'Untitled') + '". Changes save as a new version.');
    }

    $('srVersions').addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('sr-pick')) { state.picked[t.getAttribute('data-v')] = t.checked; drawCompare(); return; }
      var act = t.getAttribute && t.getAttribute('data-act'); if (!act) return;
      var v = t.getAttribute('data-v');
      if (act === 'open') {
        openLatest(v).then(function (ok) { if (!ok && !state.gone[state.deal + '/' + v]) flash('That version did not open; the page still shows the one before it. Try Open again.'); },
          function () { flash('That version did not open; the page still shows the one before it. Try Open again.'); });
      }
      else if (act === 'purge') {
        var deal = state.deal, row = state.versions.filter(function (x) { return x.v === v; })[0] || {};
        var what = 'v' + state.num[v] + ' · ' + (row.label || 'Untitled');
        if (!ask('Delete ' + what + ' for good? It cannot be brought back. Hide takes a version off the list and keeps it.')) return;
        store.meta(deal, 'purge', v).then(function () {
          state.gone[deal + '/' + v] = true; delete state.cache[deal + '/' + v];
          flash('Deleted ' + what + '. The versions left are numbered again.');
          // Another deal picked while this ran stays picked; only its count in the picker changes.
          if (state.deal !== deal) return refreshDeals(state.deal || '');
          delete state.picked[v];
          if (state.parent === v) state.parent = ''; // the next save is not a child of a version that is gone
          // Renumber first, so the comparison names its versions the way the list does.
          return refreshDeals(deal).then(refreshVersions).then(drawCompare);
        }, function (e) { flash(what + ' was not deleted: ' + e.message + '.'); });
      }
      else store.meta(state.deal, act, v).then(refreshVersions);
    });
    // A browser that blocks dialogs answers no, so nothing is deleted without a yes.
    function ask(q) { var w = doc.defaultView; try { return !!(w && w.confirm && w.confirm(q)); } catch (e) { return false; } }
    $('sr-delete-deal').addEventListener('click', function () {
      var deal = state.deal; if (!deal) return;
      var name = $('sr-name').value.trim() || 'this deal', n = state.versions.length;
      if (!ask('Delete "' + name + '" for good: all ' + n + ' version' + (n === 1 ? '' : 's') + ', and its market research in Deal workbook? It cannot be brought back.')) return;
      var btn = $('sr-delete-deal'); btn.disabled = true;
      store.removeDeal(deal).then(function () {
        if (state.deal === deal) { state.nav++; state.deal = null; state.picked = {}; state.cache = {}; state.versions = []; $('sr-name').value = ''; clearForm(); drawCompare(); }
        flash('Deleted "' + name + '" and all its versions.');
        return refreshDeals('').then(refreshVersions);
      }, function (e) { flash('"' + name + '" was not deleted: ' + e.message + '. Try again to finish.'); })
        .then(function () { btn.disabled = false; });
    });

    var compareTok = 0;
    function drawCompare() {
      var tok = ++compareTok; // a later pick or deal change supersedes reads still in flight
      var ids = Object.keys(state.picked).filter(function (k) { return state.picked[k]; });
      if (ids.length < 2) { $('srCompare').innerHTML = '<p class="sr-muted">Tick two to four versions above to compare them. Changed rows are highlighted.</p>'; return; }
      if (ids.length > 4) { $('srCompare').innerHTML = '<p class="sr-flag">Pick four or fewer.</p>'; return; }
      var failed = '<p class="sr-flag">One of the ticked versions could not be read, so there is no comparison. Untick it or try again.</p>';
      Promise.all(ids.map(getVersion)).then(function (vs) {
        if (tok !== compareTok) return;
        if (vs.some(function (x) { return !x; })) { $('srCompare').innerHTML = failed; return; }
        vs = vs.sort(function (a, b) { return a.v < b.v ? -1 : 1; }).map(function (x) { return Object.assign({}, x, { n: (state.num || {})[x.v] }); });
        $('srCompare').innerHTML = compareTable(rules, prop123, vs);
      }, function () { if (tok === compareTok) $('srCompare').innerHTML = failed; });
    }

    $('sr-save').addEventListener('click', function () {
      if (state.loading || state.opening) { flash('Wait for the deal to finish opening, then save.'); return; }
      readForm();
      var name = $('sr-name').value.trim();
      if (!name) { flash('Give the deal a name first.'); $('sr-name').focus(); return; }
      var r = draw();
      var data = JSON.parse(JSON.stringify(state.version));
      if (state.shownStress) { data.stress = state.shownStress.tests; data.stressBase = state.shownStress.base; }
      data.review = { score: r.score.total, meets: r.score.meets, lane: r.lane.lane, laneAmount: r.lane.amount, midpoint: r.lane.midpoint, summary: summaryLines(r), rules: rules.id, rulesStatus: rules.status, rulesChecked: rules.checked_at };
      var btn = $('sr-save'); btn.disabled = true;
      var nav = state.nav, ver = state.version;
      store.save({ deal: state.deal || undefined, name: name, label: $('sr-label').value.trim() || 'Version', parent: state.parent || undefined, data: data,
        summary: { score: Math.round(r.score.total * 100) / 100, gap: num(r.engine.fundingGap), lane: r.lane.lane } })
        .then(function (res) {
          state.cache[res.deal + '/' + res.v] = Object.assign({}, data, { v: res.v, label: res.meta.label, name: name, at: res.meta.at, by: res.meta.by });
          if (state.nav !== nav || state.version !== ver) { flash('Saved "' + name + '" as a new version.'); return refreshDeals(state.deal); } // another deal or version is open now
          state.deal = res.deal; state.parent = res.v;
          flash('Saved as a new version.');
          return refreshDeals(res.deal).then(function () {
            return refreshVersions().then(function () {
              // KV lists can lag a few seconds behind a write; show the new version straight away.
              if (!state.versions.some(function (x) { return x.v === res.v; })) {
                state.versions.unshift(Object.assign({ v: res.v }, res.meta));
                $('srVersions').insertAdjacentHTML('afterbegin', '<p class="sr-muted">Just saved: ' + esc(res.meta.label) + '. It appears in the list within a minute.</p>');
              }
            });
          });
        })
        .catch(function (e) { flash('Not saved: ' + e.message); })
        .then(function () { btn.disabled = false; });
    });

    var flashTimer;
    function flash(msg) { var el = $('srFlash'); el.textContent = msg; clearTimeout(flashTimer); flashTimer = setTimeout(function () { el.textContent = ''; }, 9000); }

    if ($('sr-mix-note')) $('sr-mix-note').textContent = taxCreditNote();
    $('srAsOf').textContent = 'QAP 2027-28 Third Draft (not adopted), checked ' + rules.checked_at;
    writeForm(); draw(); refreshDeals(); refreshVersions(); drawCompare();
  }

  // Builds the claim and threshold inputs from the rules file, so the form cannot drift from it.
  function formHtml(rules) {
    var claim = function (id, label, pointsText, extra) {
      return '<div class="sr-claim"><label><input type="checkbox" data-claim="' + esc(id) + '"> ' + esc(label) + ' <span class="sr-muted">(' + esc(pointsText) + ')</span></label>' +
        (extra || '') + '<input type="text" class="sr-ref" data-ref="' + esc(id) + '" placeholder="Document and page" aria-label="Document and page for ' + esc(label) + '"></div>';
    };
    var html = claim(rules.targeting.lowest_ami_bonus.id, rules.targeting.lowest_ami_bonus.label, '+' + rules.targeting.lowest_ami_bonus.points) +
      claim(rules.eli_targeting.id, rules.eli_targeting.label + ', with services', '5 to 15, from the unit mix');
    rules.lines.forEach(function (l) {
      if (l.auto) return;
      if (l.points == null) {
        html += '<div class="sr-claim"><label>' + esc(l.label) + ' <input type="number" min="0" step="1" inputmode="numeric" data-claim="' + esc(l.id) + '" class="sr-small" aria-label="Points for ' + esc(l.label) + '"> <span class="sr-muted">points from CHFA\'s tier list</span></label>' +
          '<input type="text" class="sr-ref" data-ref="' + esc(l.id) + '" placeholder="Document and page" aria-label="Document and page for ' + esc(l.label) + '"></div>';
      } else html += claim(l.id, l.label, '+' + l.points);
    });
    var th = rules.thresholds.map(function (t) {
      return '<div class="sr-claim"><label for="sr-t-' + esc(t.id) + '">' + esc(t.id.replace('T', '#')) + ' ' + esc(t.label) + '</label>' +
        '<select id="sr-t-' + esc(t.id) + '" data-threshold="' + esc(t.id) + '"><option value="">Not checked</option><option value="ready">Ready</option><option value="missing">Missing</option>' + (t.applies ? '<option value="na">Does not apply</option>' : '') + '</select>' +
        '<input type="text" class="sr-ref" data-tref="' + esc(t.id) + '" placeholder="Document and page" aria-label="Document and page for threshold ' + esc(t.id) + '"></div>';
    }).join('');
    return { claims: html, thresholds: th };
  }

  function start(doc) {
    if (!doc.getElementById('srMain')) return; // loaded on another page for fromCalculatorExport (member-calculator.js)
    var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get(RULES_URL), get(PROP123_URL), get(PLACES_URL)]).then(function (res) {
      if (res[1] && res[2] && res[2].byGeoid) res[1].places = Object.keys(res[2].byGeoid).map(function (k) { return res[2].byGeoid[k].name; });
      if (!res[0]) { doc.getElementById('srMain').innerHTML = '<p>The scoring rules did not load.</p>'; return; }
      var f = formHtml(res[0]);
      doc.getElementById('srClaims').innerHTML = f.claims;
      doc.getElementById('srThresholds').innerHTML = f.thresholds;
      // Blocked storage: reads find nothing and writes throw, so a device save reports "Not saved".
      var storage; try { storage = window.localStorage; } catch (e) { storage = { getItem: function () { return null; }, setItem: function () { throw new Error('storage blocked'); } }; }
      mount(doc, res[0], res[1], makeStore(fetch.bind(window), storage));
    });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(document); });
    else start(document);
  }

  return { esc: esc, mixTotals: mixTotals, amiMidpoint: amiMidpoint, targetingPoints: targetingPoints, eliPoints: eliPoints, score: score,
    findJurisdiction: findJurisdiction, prop123Status: prop123Status, gapLane: gapLane, bumpOneUnit: bumpOneUnit, thresholdStatus: thresholdStatus,
    mustPayCoverage: mustPayCoverage, creditCheck: creditCheck, stateCreditCheck: stateCreditCheck, review: review, summaryLines: summaryLines, compareTable: compareTable, changeLines: changeLines, historyModel: historyModel, historyHtml: historyHtml, historyCsv: historyCsv, historyPage: historyPage, fromCalculatorExport: fromCalculatorExport, sameDeal: sameDeal, setAsideCheck: setAsideCheck, taxCreditNote: taxCreditNote, SET_ASIDE: SET_ASIDE, HARD_COST_IDS: HARD_COST_IDS,
    stressFails: stressFails, amiStress: amiStress, makeStore: makeStore, formHtml: formHtml, mount: mount, STRESS: STRESS, RULES_URL: RULES_URL, API: API };
});
