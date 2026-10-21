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
    '5B4b-pha': { rank: 3, how: 'Bring in a Colorado housing authority as sole or majority co-general partner.' },
    '5B4a-nonprofit': { rank: 3, how: 'A qualifying nonprofit or housing authority as sole general partner.' },
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
  var SPONSOR_LINES = { '5B4a-nonprofit': ['nonprofit', 'pha'], '5B4b-pha': ['pha'] };
  // Lines that only exist for a rehab or an existing tax credit project.
  var CONDITION_LINES = { '5B3c-rehab': ['rehab', 'acquisition/rehab'], '5B3d-preservation': ['existingCredit', 'existing tax credit project'] };
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
  function score(rules, deal, claims) {
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
      if (l.auto === 'nine_percent_required') { line.points = l.points; line.status = 'counted'; line.auto = true; line.note = 'Required for 9% (Threshold #14).'; }
      else if (l.auto === 'mixed_income') {
        var t = mixTotals(mix, deal.election), share = t.total ? t.restricted / t.total : 1;
        line.auto = true; line.note = Math.round(share * 1000) / 10 + '% of units are tax credit units.';
        if (share <= 0.8 + 1e-9) { line.points = l.points; line.status = 'counted'; } else line.status = 'missing';
      } else if (l.points == null) {
        var v = num(claims[l.id]);
        line.possible = null;
        if (v != null && v > 0) { line.points = v; line.status = 'counted'; line.note = 'Points entered from CHFA\'s tier list.'; }
        else line.status = 'needs entry';
      } else if (claims[l.id] && CONDITION_LINES[l.id] && !deal[CONDITION_LINES[l.id][0]]) {
        line.status = 'excluded'; line.note = 'Claimed, but the deal is not marked ' + CONDITION_LINES[l.id][1] + '. Tick it or remove the claim.';
      } else if (claims[l.id] && SPONSOR_LINES[l.id] && deal.sponsor && SPONSOR_LINES[l.id].indexOf(deal.sponsor) === -1) {
        line.status = 'excluded'; line.note = 'Claimed, but the general partner is set to ' + deal.sponsor + '. Change the general partner or remove the claim.';
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
    var list = prop123.jurisdictions;
    var exact = list.filter(function (j) { return j.name.toLowerCase() === q; })[0];
    if (exact) return exact;
    var same = list.filter(function (j) { return bare(j.name) === bare(q); });
    // Denver and Broomfield are filed once as city and county, so "City of Denver" and "Denver County" both mean that record.
    var consolidated = /^(denver|broomfield)$/.test(bare(q));
    if (consolidated) { /* keep the single consolidated record */ }
    else if (/\bcounty\b/.test(q)) same = same.filter(function (j) { return j.kind === 'county'; });
    else if (/\b(city|town)\b/.test(q)) same = same.filter(function (j) { return j.kind !== 'county'; });
    if (same.length > 1) return { ambiguous: same.map(function (j) { return j.name; }) }; // e.g. "Pueblo": the city or the county
    // A bare name can be both a county and a city or town even when only one of them is on DOLA's list ("Alamosa").
    if (!/\b(county|city|town)\b/.test(q)) {
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

  function bare(n) { return String(n).toLowerCase().trim().replace(/^(city and county of|city of|town of|county of)\s+/, '').replace(/\s+county$/, ''); }
  // Census Gazetteer names end in "city", "town" or "CDP" ("Lake City town", "Canon City city").
  function gazName(n) { return String(n).toLowerCase().replace(/\s+(city|town|cdp)$/, ''); }

  // A place not on DOLA's list: a real Colorado county, city or town is "not listed"; anything else stays unresolved.
  function placeRegistry(prop123, place) {
    var q = String(place).toLowerCase(), b = bare(place);
    var county = CO_COUNTIES.some(function (c) { return c.toLowerCase() === b; });
    if (/\bcounty\b/.test(q)) return county ? 'county' : null;
    var hit = (prop123.places || []).filter(function (n) { return gazName(n) === b; });
    if (/\b(city|town)\b/.test(q)) hit = hit.filter(function (n) { return !/ CDP$/.test(n); });
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
      var grant = deal.sponsor === 'nonprofit' || deal.sponsor === 'pha';
      out.lane = 'DOH'; out.kind = grant ? 'grant' : 'cash flow loan at 2%';
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
      var appliesNow = (t.applies === 'rehab' && !!deal.rehab) || (t.applies === 'existing_credit' && !!deal.existingCredit);
      if (a === 'na' && (!t.applies || appliesNow)) a = ''; // only a conditional item whose condition is false can be set aside
      if (!a && t.applies === 'rehab' && !deal.rehab) a = 'na';
      if (!a && t.applies === 'existing_credit' && !deal.existingCredit) a = 'na';
      return { id: t.id, label: t.label, page: t.page, quote: t.quote, answer: a || 'unchecked' };
    });
    return { rows: rows, missing: rows.filter(function (r) { return r.answer === 'missing'; }).length,
      unchecked: rows.filter(function (r) { return r.answer === 'unchecked'; }).length,
      ready: rows.filter(function (r) { return r.answer === 'ready'; }).length,
      na: rows.filter(function (r) { return r.answer === 'na'; }).length };
  }

  function creditCheck(rules, annualCredits) {
    var cap = rules.credit_caps.federal_9pct_annual;
    if (annualCredits == null) return { status: 'unknown', cap: cap };
    return { status: annualCredits > cap ? 'over' : 'ok', cap: cap, value: annualCredits };
  }

  // ── Whole review and summary ──────────────────────────────────────────────
  function review(rules, prop123, v) {
    var deal = v.deal || {};
    var s = score(rules, deal, v.claims);
    var p = prop123Status(prop123, deal.place);
    var lane = gapLane(rules, deal, p);
    var th = thresholdStatus(rules, v.thresholds, deal);
    // Model results describe the exported deal; once the mix or election is edited they no longer apply.
    var stale = !!(v.calculator && v.calculator.stale);
    var eng = stale ? {} : (v.engine || {});
    var credit = creditCheck(rules, num(eng.annualCredits));
    var risks = [];
    if (deal.calcRegime) risks.push({ level: 'yellow', text: 'The Deal Calculator export used ' + deal.calcRegime + ' rent limits, not CHFA LIHTC, so only its unit mix is used here. Set rent limits to CHFA LIHTC and export again for gap, coverage, credit and stress results.' });
    if (deal.calc4) risks.push({ level: 'yellow', text: 'The Deal Calculator export was set to 4%, so only its unit mix is used here. Export the deal at 9% for gap, coverage, credit and stress results.' });
    if (stale) risks.push({ level: 'yellow', text: 'The unit mix or set-aside election differs from the Deal Calculator export, so its gap, coverage, credit and stress results are not shown. Change the deal in the Deal Calculator and export it again.' });
    if (!s.setAside.qualifies) risks.push({ level: 'red', text: 'The unit mix does not meet the ' + ELECTION_LABEL[s.setAside.election] + ': ' + s.setAside.reasons.join('; ') + '. The deal is not eligible for credits.' });
    else if (!s.primaryOk) risks.push({ level: 'red', text: 'No points in a primary criterion, so the deal is not eligible.' });
    if (s.total < s.minimum) risks.push({ level: 'red', text: 'Score ' + pts(s.total) + ' is ' + pts(s.minimum - s.total) + ' points under the ' + s.minimum + ' minimum.' });
    if (th.missing) risks.push({ level: 'red', text: th.missing + ' threshold item' + (th.missing > 1 ? 's are' : ' is') + ' missing; a missing threshold item stops the application.' });
    if (credit.status === 'over') risks.push({ level: 'red', text: 'Annual federal credit ' + money(credit.value) + ' is over the ' + money(credit.cap) + ' cap (QAP 3.L, not adopted).' });
    if (num(eng.fundingGap) > 0) risks.push({ level: 'yellow', text: 'Funding gap of ' + money(num(eng.fundingGap)) + ' after the modeled sources.' });
    lane.flags.forEach(function (f) { risks.push({ level: 'yellow', text: f }); });
    if (!s.needEntered) risks.push({ level: 'yellow', text: 'Housing need points are not entered; the score leaves them out.' });
    if (s.total >= s.minimum && s.margin < 5) risks.push({ level: 'yellow', text: 'Only ' + pts(s.margin) + ' points over the minimum.' });
    if (th.unchecked) risks.push({ level: 'yellow', text: th.unchecked + ' threshold items not checked yet.' });
    var next = s.total < s.minimum && s.addable.length ? s.addable[0] : null;
    return { score: s, prop123: p, lane: lane, thresholds: th, credit: credit, engine: eng, risks: risks,
      next: next ? '+' + next.points + ' point' + (next.points === 1 ? '' : 's') + ': ' + next.how
        : (risks.length ? risks[0].text : 'No red flags. Confirm the unconfirmed items with CHFA.') };
  }

  function summaryLines(r) {
    return [
      'Score: ' + pts(r.score.total) + ' of ' + r.score.minimum + ' needed' + (r.score.meets ? ' (clears it)' : ' (short)') + '.',
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
    ['Annual federal credit', function (v, r) { return money(num(r.engine.annualCredits)); }],
    ['Credit equity', function (v, r) { return money(num(r.engine.creditEquity)); }],
    ['Funding gap', function (v, r) { return money(num(r.engine.fundingGap)); }],
    ['Debt coverage', function (v, r) { var d = num(r.engine.dscr); return d == null ? '—' : d.toFixed(2) + 'x'; }],
    ['Deferred developer fee', function (v, r) { return money(num(r.engine.deferredDeveloperFee)); }],
    ['Threshold items missing', function (v, r) { return String(r.thresholds.missing); }],
    ['Stress tests failed', function (v) {
      if (!v.stress) return 'not run';
      var ran = v.stress.filter(function (t) { return !t.skipped; }), skipped = v.stress.length - ran.length;
      return ran.filter(function (t) { return t.fails; }).length + ' of ' + ran.length + (skipped ? ' (' + skipped + ' not run)' : '');
    }]
  ];

  function compareTable(rules, prop123, versions) {
    var reviews = versions.map(function (v) { return review(rules, prop123, v); });
    var head = '<tr><th scope="col" data-tip="Changed rows are highlighted">Figure</th>' + versions.map(function (v) {
      return '<th scope="col">' + esc(v.label || v.name || 'Version') + '<br><span class="sr-muted">' + esc((v.at || '').slice(0, 16).replace('T', ' ')) + '</span></th>';
    }).join('') + '</tr>';
    var body = COMPARE_ROWS.map(function (row) {
      var cells = versions.map(function (v, i) { return row[1](v, reviews[i]); });
      var differs = cells.some(function (c) { return c !== cells[0]; });
      return '<tr' + (differs ? ' class="sr-diff"' : '') + '><th scope="row">' + esc(row[0]) + '</th>' + cells.map(function (c) { return '<td class="sr-num">' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="sr-scroll"><table class="sr-table" data-no-sort><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
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
    var q = String(snap.url).indexOf('?'), query = q === -1 ? '' : String(snap.url).slice(q + 1);
    var param = function (k) { var m = query.match(new RegExp('(?:^|&)' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : null; };
    // The credit-rate radios share one key: rate-9=0.09 is 9%, rate-9=0.04 is 4%.
    var rate = num(inp['rate-9'] != null ? inp['rate-9'] : param('rate-9'));
    var election = String(inp['minimum-set-aside'] || param('minimum-set-aside') || '40-60');
    if (!ELECTION_LABEL[election]) election = '40-60';
    // The calculator defaults to CHFA LIHTC rents; HOME, Prop 123, other-AMI and market rents are a different model.
    var regime = String(inp['rent-limit-regime'] || param('rent-limit-regime') || 'chfa_lihtc');
    var REGIME_LABEL = { home_high: 'High HOME', home_low: 'Low HOME', prop123: 'Prop 123', ami_formula: 'other AMI-formula', market: 'market-rate' };
    return { mix: mix, engine: engine, query: query, nine: rate != null && rate > 0.06, chfa: regime === 'chfa_lihtc', regime: REGIME_LABEL[regime] || 'non-CHFA', election: election, exportedAt: snap.exportedAt || null };
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
        ids.forEach(function (id) {
          var el = d.getElementById('dc-cost-' + id), v = el && num(el.value);
          if (v) { var nv = Math.round(v * 1.1); delta += nv - v; el.value = String(nv); }
        });
        if (!t || !num(t.value)) return { skip: 'No total development cost entered.' };
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

  function readEngine(w) {
    var o = w.__DealCalc.getOutputRecords(), r = w.__DealCalc.getResult();
    var v = function (k) { return o[k] && typeof o[k].value === 'number' ? o[k].value : null; };
    var why = function (k) { return o[k] && o[k].value == null ? o[k].unavailableReason : null; };
    return { fundingGap: v('fundingGap'), fundingGapReason: why('fundingGap'), dscr: v('dscr'), deferredDeveloperFee: v('deferredDeveloperFee'),
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
        else results.push({ id: STRESS[i - 1].id, label: STRESS[i - 1].label, why: STRESS[i - 1].why, note: note, engine: e });
        if (onProgress) onProgress(i, STRESS.length);
        return step(i + 1);
      });
    }
    return step(0).then(function () {
      // The engine's own coverage tests (rents -10%, vacancy +5 points, operating cost +10%) come with the base run.
      var es = base.engineStress || {};
      [['rent10', 'Rents -10%', 'Rent limits or market rents come in lower.'], ['opex10', 'Operating cost +10%', 'Insurance and utilities keep rising.'], ['vac5', 'Vacancy +5 points', 'Slower lease-up or turnover.']].forEach(function (k) {
        var s = es[k[0]], dscr = s ? num(s.dscr) : null;
        results.push({ id: k[0], label: k[1], why: k[2], note: dscr == null ? 'The calculator did not report coverage for this test (no must-pay debt or income entered).' : 'Debt coverage only (the calculator\'s own stress test); the loan is not resized.',
          engine: { dscr: dscr, fundingGap: null, deferredDeveloperFee: null, paybackYear: null }, coverageOnly: true, skipped: dscr == null });
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
          local.write(o); return d;
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
      '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col" data-tip="What changes in the Deal Calculator for this run">Test</th><th scope="col" class="sr-num" data-tip="Sources still needed after the modeled loan, equity and soft funds">Funding gap</th><th scope="col" class="sr-num" data-tip="Debt coverage ratio: net operating income over must-pay debt service">Coverage</th><th scope="col" class="sr-num" data-tip="Developer fee paid later from cash flow">Deferred fee</th><th scope="col" data-tip="Fails when the gap grows, coverage drops under the CHFA 1.15 minimum, the score falls under 130, or the gap-fund lane changes">Result</th></tr></thead><tbody>' +
      st.tests.map(function (t) {
        var e = t.engine || {};
        return '<tr><td><strong>' + esc(t.label) + '</strong><div class="sr-muted">' + esc(t.why) + (t.note ? ' ' + esc(t.note) : '') + '</div></td>' +
          '<td class="sr-num">' + esc(cell(e.fundingGap, money)) + '</td><td class="sr-num">' + esc(cell(e.dscr, ratio)) + '</td><td class="sr-num">' + esc(cell(e.deferredDeveloperFee, money)) + '</td>' +
          '<td>' + (t.skipped ? '<span class="sr-muted">Not run</span>' : t.fails ? '<span class="sr-flag">Fails: ' + esc(t.fails) + '</span>' : 'Holds') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function sameDeal(d, calc) {
    if (!calc || !calc.mix) return true; // versions saved before the export's mix was kept
    if ((d.election || '40-60') !== (calc.election || '40-60')) return false;
    return tiersOf(d.mix).concat(tiersOf(calc.mix), ['market']).every(function (t) { return (num(d.mix[t]) || 0) === (num(calc.mix[t]) || 0); });
  }

  function mount(doc, rules, prop123, store) {
    var $ = function (id) { return doc.getElementById(id); };
    var state = { nav: 0, deal: null, name: '', parent: '', version: blankVersion(), stress: null, versions: [], picked: {}, cache: {}, hidden: [], baseline: '' };

    function blankVersion() { return { deal: { mix: {}, place: '', election: '40-60', sponsor: 'for-profit', supportive: false, rehab: false, existingCredit: false }, claims: {}, thresholds: {}, documents: [], engine: {}, calculator: null }; }

    // Form → state
    function readForm() {
      var v = state.version, d = v.deal;
      TIERS.concat(['market']).forEach(function (t) { var el = $('sr-mix-' + t); var n = el ? num(el.value) : null; d.mix[t] = n > 0 ? Math.floor(n) : 0; });
      d.place = $('sr-place').value.trim();
      d.sponsor = $('sr-sponsor').value;
      d.election = $('sr-election').value;
      d.supportive = $('sr-supportive').checked;
      d.rehab = $('sr-rehab').checked;
      d.existingCredit = $('sr-existing').checked;
      var ac = num($('sr-credits').value); if (ac != null && ac >= 0) v.engine.annualCredits = ac; else if (!v.calculator) delete v.engine.annualCredits;
      doc.querySelectorAll('[data-claim]').forEach(function (el) {
        var id = el.getAttribute('data-claim');
        var n = num(el.value);
        v.claims[id] = el.type === 'checkbox' ? el.checked : (n > 0 ? Math.floor(n) : null); // whole points, as the form's step=1 asks
        var ref = doc.querySelector('[data-ref="' + id + '"]'); if (ref) v.claims[id + ':ref'] = ref.value.slice(0, 200);
      });
      doc.querySelectorAll('[data-threshold]').forEach(function (el) {
        v.thresholds[el.getAttribute('data-threshold')] = el.value;
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
      $('sr-sponsor').value = d.sponsor || 'for-profit';
      $('sr-election').value = d.election || '40-60';
      $('sr-supportive').checked = !!d.supportive; $('sr-rehab').checked = !!d.rehab; $('sr-existing').checked = !!d.existingCredit;
      $('sr-credits').value = v.engine.annualCredits != null ? v.engine.annualCredits : '';
      $('sr-credits').disabled = !!v.calculator;
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
      $('srCredit').textContent = cr.status === 'unknown' ? 'Annual federal credit not entered.' : 'Annual federal credit ' + money(cr.value) + ' against the ' + money(cr.cap) + ' cap: ' + (cr.status === 'over' ? 'over the cap.' : 'within it.');
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
            var v = started;
            v.deal.mix = c.mix; v.deal.election = c.election; v.deal.calc4 = !c.nine;
            v.deal.calcRegime = c.nine && !c.chfa ? c.regime : null;
            if (c.nine && c.chfa) {
              v.calculator = { query: c.query, exportedAt: c.exportedAt, nine: true, election: c.election, mix: Object.assign({}, c.mix), stale: false };
              v.engine = c.engine;
            } else {
              // A 4% model's credits and financing do not belong beside a 9% score: keep only the unit mix.
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
      if (!state.deal) { $('srVersions').innerHTML = '<p class="sr-muted">Save this deal to start its version list.</p>'; return Promise.resolve(); }
      var deal = state.deal;
      return store.versions(deal).then(function (res) {
        if (state.deal !== deal) return; // another deal was picked while this loaded
        state.versions = res.versions; state.hidden = res.hidden || []; state.baseline = res.baseline || '';
        var show = $('sr-show-hidden').checked;
        var rows = res.versions.filter(function (v) { return show || state.hidden.indexOf(v.v) === -1; });
        $('srVersions').innerHTML = rows.length ? '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col" data-tip="Tick two to four versions to compare">Compare</th><th scope="col" data-tip="Label, when it was saved and who saved it">Version</th><th scope="col" class="sr-num" data-tip="CHFA points when saved">Score</th><th scope="col" data-tip="DOH or OEDIT gap-fund lane when saved">Lane</th><th scope="col" class="sr-num" data-tip="Funding gap when saved">Gap</th><th scope="col" data-tip="Open, star as baseline, or hide">Actions</th></tr></thead><tbody>' +
          rows.map(function (v) {
            var hid = state.hidden.indexOf(v.v) !== -1, base = state.baseline === v.v;
            return '<tr><td><label class="sr-pick-wrap"><input type="checkbox" class="sr-pick" data-v="' + esc(v.v) + '" aria-label="Compare ' + esc(v.label || v.v) + '"' + (state.picked[v.v] ? ' checked' : '') + '></label></td>' +
              '<td><strong>' + esc(v.label || 'Untitled') + '</strong>' + (base ? ' <span class="rw-band">Baseline</span>' : '') + (hid ? ' <span class="sr-muted">(hidden)</span>' : '') +
              '<div class="sr-muted">' + esc((v.at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(v.by || '') + '</div></td>' +
              '<td class="sr-num">' + esc(pts(v.score)) + '</td><td>' + esc(v.lane || '—') + '</td><td class="sr-num">' + esc(money(v.gap)) + '</td>' +
              '<td><button type="button" class="sr-btn" data-act="open" data-v="' + esc(v.v) + '">Open</button> ' +
              (base ? '' : '<button type="button" class="sr-btn" data-act="baseline" data-v="' + esc(v.v) + '">Make baseline</button> ') +
              '<button type="button" class="sr-btn" data-act="' + (hid ? 'unhide' : 'hide') + '" data-v="' + esc(v.v) + '">' + (hid ? 'Unhide' : 'Hide') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="sr-muted">No versions yet.</p>';
      });
    }
    function getVersion(v) {
      var deal = state.deal, key = deal + '/' + v;
      if (state.cache[key]) return Promise.resolve(state.cache[key]);
      return store.get(deal, v).then(function (rec) {
        if (!rec || state.deal !== deal) return null; // dropped if another deal was picked meanwhile
        var data = rec.data || {};
        var out = Object.assign({}, data, { v: rec.v, label: rec.label, name: rec.name, at: rec.at, by: rec.by });
        state.cache[key] = out; return out;
      });
    }
    // Every deal pick or version open bumps state.nav; a slower, earlier request then lands on nothing.
    function openLatest(v) {
      var t = ++state.nav;
      // Resolves false when the version could not be read, so a deal pick can clear the form instead of keeping the old deal.
      return getVersion(v).then(function (rec) { if (t !== state.nav) return true; openVersion(rec); return !!rec; });
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
        if (pick) return openLatest(pick).then(function (ok) { if (!ok && state.deal === deal) { clearForm(); flash('That deal\'s latest version could not be read, so the form was cleared.'); } });
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
      if (act === 'open') openLatest(v);
      else store.meta(state.deal, act, v).then(refreshVersions);
    });

    var compareTok = 0;
    function drawCompare() {
      var tok = ++compareTok; // a later pick or deal change supersedes reads still in flight
      var ids = Object.keys(state.picked).filter(function (k) { return state.picked[k]; });
      if (ids.length < 2) { $('srCompare').innerHTML = '<p class="sr-muted">Tick two to four versions above to compare them. Changed rows are highlighted.</p>'; return; }
      if (ids.length > 4) { $('srCompare').innerHTML = '<p class="sr-flag">Pick four or fewer.</p>'; return; }
      Promise.all(ids.map(getVersion)).then(function (vs) {
        if (tok !== compareTok) return;
        vs = vs.filter(Boolean).sort(function (a, b) { return a.v < b.v ? -1 : 1; });
        $('srCompare').innerHTML = compareTable(rules, prop123, vs);
      });
    }

    $('sr-save').addEventListener('click', function () {
      if (state.loading) { flash('Wait for the deal to finish opening, then save.'); return; }
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
    creditCheck: creditCheck, review: review, summaryLines: summaryLines, compareTable: compareTable, fromCalculatorExport: fromCalculatorExport, sameDeal: sameDeal, setAsideCheck: setAsideCheck, taxCreditNote: taxCreditNote, SET_ASIDE: SET_ASIDE, HARD_COST_IDS: HARD_COST_IDS,
    stressFails: stressFails, amiStress: amiStress, makeStore: makeStore, formHtml: formHtml, STRESS: STRESS, RULES_URL: RULES_URL, API: API };
});
