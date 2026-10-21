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
  var API = '/api/deals';
  var LOCAL_KEY = 'coho-submittal-review-local';
  var TIERS = [20, 30, 40, 50, 60, 70, 80];
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

  // ── Deal facts ────────────────────────────────────────────────────────────
  // mix: {30: 6, 40: 12, ..., market: 0}. Every unit at or under 80% AMI is rent-restricted.
  function mixTotals(mix) {
    var restricted = 0, weighted = 0, market = num(mix && mix.market) || 0;
    TIERS.forEach(function (t) {
      var u = num(mix && mix[t]) || 0;
      restricted += u; weighted += u * t;
    });
    return { restricted: restricted, market: market, total: restricted + market, weighted: weighted };
  }

  // QAP 3.B.9: "the sum of the project's units multiplied by the AMI for each unit divided by the total units."
  // Market units carry no AMI, so the midpoint is over the income-restricted units, and a deal with market units is flagged.
  function amiMidpoint(mix) {
    var t = mixTotals(mix);
    if (!t.restricted) return null;
    return { value: t.weighted / t.restricted, marketUnits: t.market };
  }

  function targetingPoints(rules, mix) {
    var w = rules.targeting.weights, t = mixTotals(mix);
    if (!t.restricted) return { points: 0, rows: [] };
    var rows = [{ tier: 40, units: 0 }, { tier: 50, units: 0 }, { tier: 60, units: 0 }];
    TIERS.forEach(function (tier) {
      var u = num(mix[tier]) || 0;
      if (tier <= 40) rows[0].units += u; else if (tier <= 50) rows[1].units += u; else if (tier <= 60) rows[2].units += u;
    });
    var total = 0;
    rows.forEach(function (r) { r.share = r.units / t.restricted; r.weight = w[r.tier]; r.points = r.share * r.weight; total += r.points; });
    return { points: total, rows: rows, restricted: t.restricted };
  }

  // Both readings of the Third Draft's "Up to" bands; the lower one counts.
  function eliPoints(rules, mix) {
    var t = mixTotals(mix);
    var eli = (num(mix && mix[20]) || 0) + (num(mix && mix[30]) || 0);
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
    var tp = targetingPoints(rules, mix);
    var tg = rules.targeting;
    lines.push({ id: '5A1-targeting', group: 'primary', label: tg.label, possible: tg.weights['40'], points: tp.points,
      status: tp.points > 0 ? 'counted' : 'missing', auto: true, section: tg.section, page: tg.page, quote: tg.quote,
      note: tp.rows.map(function (r) { return r.units + ' at ' + (r.tier === 40 ? '40% or below' : r.tier + '%') + ' = ' + pts(r.points); }).join('; ') });
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
        var t = mixTotals(mix), share = t.total ? t.restricted / t.total : 1;
        line.auto = true; line.note = Math.round(share * 1000) / 10 + '% of units are tax credit units.';
        if (share <= 0.8 + 1e-9) { line.points = l.points; line.status = 'counted'; } else line.status = 'missing';
      } else if (l.points == null) {
        var v = num(claims[l.id]);
        line.possible = null;
        if (v != null && v > 0) { line.points = v; line.status = 'counted'; line.note = 'Points entered from CHFA\'s tier list.'; }
        else line.status = 'needs entry';
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
    var primaryOk = tp.points > 0 && !!(eu && eu.points > 0);
    var min = rules.minimum_score.points;
    var addable = lines.filter(function (l) { return (l.status === 'not claimed' || (l.status === 'missing' && EFFORT[l.id])) && l.possible; })
      .filter(function (l) { return EFFORT[l.id] && EFFORT[l.id].rank < 9; })
      .map(function (l) { return { id: l.id, label: l.label, points: l.possible, how: EFFORT[l.id].how, rank: EFFORT[l.id].rank }; })
      .sort(function (a, b) { return a.rank - b.rank || b.points - a.points; });
    return { lines: lines, total: total, minimum: min, margin: total - min, meets: primaryOk && total >= min, primaryOk: primaryOk,
      addable: addable, needEntered: lines.some(function (l) { return l.id === '5B1-need' && l.status === 'counted'; }) };
  }

  // ── Prop 123 and the 3.B.9 gap-fund lane ──────────────────────────────────
  function findJurisdiction(prop123, place) {
    var q = String(place || '').trim().toLowerCase();
    if (!q || !prop123 || !Array.isArray(prop123.jurisdictions)) return null;
    var list = prop123.jurisdictions;
    var bare = function (n) { return String(n).toLowerCase().replace(/^(city and county of|city of|town of|county of)\s+/, '').replace(/\s+county$/, ''); };
    var exact = list.filter(function (j) { return j.name.toLowerCase() === q; })[0];
    return exact || list.filter(function (j) { return bare(j.name) === bare(q) && (/county/i.test(q) === (j.kind === 'county')); })[0] ||
      list.filter(function (j) { return bare(j.name) === bare(q); })[0] || null;
  }

  // 'yes' = filed for 2027-2029; 'to-confirm' = on DOLA's list without a 2027-2029 filing yet; 'no' = not on the list.
  function prop123Status(prop123, place) {
    var j = findJurisdiction(prop123, place);
    if (!j) return { status: 'no', text: 'Not on DOLA\'s Prop 123 commitment list (as of ' + ((prop123 && prop123.updated) || 'the last refresh') + ').' };
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
    var dohEligible = !!deal.supportive || (mp && mp.value <= g.doh.midpoint_max + 1e-9);
    if (mp && Math.abs(mp.value - g.doh.midpoint_max) <= NEAR_LINE) {
      out.flags.push('The AMI midpoint (' + mp.value.toFixed(2) + '%) is within half a point of DOH\'s ' + g.doh.midpoint_max + '% line. ' + g.doh.unconfirmed);
    }
    if (mp && mp.marketUnits) out.flags.push('Market-rate units are left out of the midpoint; CHFA\'s wording divides by total units. Ask CHFA.');
    if (dohEligible) {
      var grant = deal.sponsor === 'nonprofit' || deal.sponsor === 'pha';
      out.lane = 'DOH'; out.kind = grant ? 'grant' : 'cash flow loan at 2%';
      out.perUnit = g.doh.per_unit; out.cap = g.doh.max;
      out.why = deal.supportive && !(mp && mp.value <= g.doh.midpoint_max) ? 'Supportive housing application.' : 'AMI midpoint ' + mp.value.toFixed(2) + '% is at or under ' + g.doh.midpoint_max + '%.';
      out.quotes = [g.doh.eligibility_quote, g.doh.terms_quote];
    } else if (p123 && p123.status !== 'no') {
      out.lane = 'OEDIT'; out.kind = 'Prop 123 concessionary loan, 2.5%, 40-year, must-pay';
      out.perUnit = g.oedit.per_unit; out.cap = g.oedit.max;
      out.why = 'AMI midpoint ' + mp.value.toFixed(2) + '% is over DOH\'s ' + g.doh.midpoint_max + '% line, and ' + p123.text;
      if (p123.status === 'to-confirm') out.flags.push('OEDIT needs a Prop 123 eligible jurisdiction. ' + p123.text);
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

  // One unit moved up one tier (the highest-share tier under 60%), for the AMI stress test.
  function bumpOneUnit(mix) {
    var out = {}; Object.keys(mix || {}).forEach(function (k) { out[k] = mix[k]; });
    var cands = TIERS.filter(function (t) { return t >= 30 && t < 60 && (num(out[t]) || 0) > 0; });
    if (!cands.length) return null;
    var f = cands[cands.length - 1], next = TIERS[TIERS.indexOf(f) + 1];
    out[f] = (num(out[f]) || 0) - 1; out[next] = (num(out[next]) || 0) + 1;
    return { mix: out, from: f, to: next };
  }

  function thresholdStatus(rules, answers, deal) {
    answers = answers || {};
    var rows = rules.thresholds.map(function (t) {
      var a = answers[t.id] || '';
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
    var eng = v.engine || {};
    var credit = creditCheck(rules, num(eng.annualCredits));
    var risks = [];
    if (!s.primaryOk) risks.push({ level: 'red', text: 'No points in a primary criterion, so the deal is not eligible.' });
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
    ['Stress tests failed', function (v) { return v.stress ? String(v.stress.filter(function (t) { return t.fails; }).length) + ' of ' + v.stress.length : 'not run'; }]
  ];

  function compareTable(rules, prop123, versions) {
    var reviews = versions.map(function (v) { return review(rules, prop123, v); });
    var head = '<tr><th scope="col">Figure</th>' + versions.map(function (v) {
      return '<th scope="col">' + esc(v.label || v.name || 'Version') + '<br><span class="sr-muted">' + esc((v.at || '').slice(0, 16).replace('T', ' ')) + '</span></th>';
    }).join('') + '</tr>';
    var body = COMPARE_ROWS.map(function (row) {
      var cells = versions.map(function (v, i) { return row[1](v, reviews[i]); });
      var differs = cells.some(function (c) { return c !== cells[0]; });
      return '<tr' + (differs ? ' class="sr-diff"' : '') + '><th scope="row">' + esc(row[0]) + '</th>' + cells.map(function (c) { return '<td class="sr-num">' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="sr-scroll"><table class="sr-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  // ── Calculator export ─────────────────────────────────────────────────────
  // Reads a Deal Calculator "Export JSON" file: inputs carry units-<tier> without the dc- prefix.
  function fromCalculatorExport(snap) {
    if (!snap || typeof snap !== 'object' || !snap.inputs || !snap.url) return null;
    var mix = {}, inp = snap.inputs;
    TIERS.forEach(function (t) { var u = num(inp['units-' + t]); if (u) mix[t] = u; });
    var units = num(inp.units);
    var restricted = TIERS.reduce(function (s, t) { return s + (mix[t] || 0); }, 0);
    if (units != null && units > restricted) mix.market = units - restricted;
    var o = snap.outputs || {};
    var engine = {};
    ['fundingGap', 'dscr', 'deferredDeveloperFee', 'annualCredits', 'creditEquity', 'totalDevelopmentCost', 'stateCreditEquity', 'firstMortgage'].forEach(function (k) {
      engine[k] = o[k] && typeof o[k].value === 'number' ? o[k].value : null;
      if (o[k] && o[k].value == null && o[k].unavailableReason) engine[k + 'Reason'] = o[k].unavailableReason;
    });
    var q = String(snap.url).indexOf('?');
    return { mix: mix, engine: engine, query: q === -1 ? '' : String(snap.url).slice(q + 1), nine: /(^|&)rate-9=/.test(String(snap.url).slice(q + 1)), exportedAt: snap.exportedAt || null };
  }

  // ── Stress tests (browser only) ───────────────────────────────────────────
  var HARD_COST_IDS = ['building_acquisition', 'off_site', 'site_work', 'demolition', 'permits', 'tap_fees', 'structures'];
  var STRESS = [
    { id: 'cost10', label: 'Hard cost +10%', why: 'The usual reason a gap opens after award.',
      apply: function (d) {
        var delta = 0, t = d.getElementById('dc-tdc');
        HARD_COST_IDS.forEach(function (id) {
          var el = d.getElementById('dc-cost-' + id), v = el && num(el.value);
          if (v) { var nv = Math.round(v * 1.1); delta += nv - v; el.value = String(nv); }
        });
        if (!t || !num(t.value)) return 'No total development cost entered.';
        // Itemized lines may not exceed Total Development Cost, so the total moves with them.
        if (delta) { t.value = String(num(t.value) + delta); return null; }
        t.value = String(Math.round(num(t.value) * 1.1));
        return 'No itemized hard costs, so total cost +10%.';
      } },
    { id: 'rate15', label: 'Loan rate +1.5 points', why: 'Permanent loan sizing.',
      apply: function (d) { var el = d.getElementById('dc-rate'); if (el && num(el.value) != null) el.value = String(num(el.value) + 1.5); else return 'No loan rate entered.'; return null; } },
    { id: 'equity05', label: 'Equity price -$0.05', why: 'Investor pricing moves before closing.',
      apply: function (d, w) {
        var el = d.getElementById('dc-equity-price'); var base = el && num(el.value);
        if (base == null) { var r = w.__DealCalc.getResult(); base = r && num(r.equityPrice); }
        if (el && base != null) el.value = String(Math.round((base - 0.05) * 1000) / 1000); return null;
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
        var s = es[k[0]];
        results.push({ id: k[0], label: k[1], why: k[2], note: 'Debt coverage only (the calculator\'s own stress test); the loan is not resized.',
          engine: { dscr: s ? num(s.dscr) : null, fundingGap: null, deferredDeveloperFee: null, paybackYear: null }, coverageOnly: true });
      });
      results.forEach(function (t) { t.fails = stressFails(rules, t, base); });
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
      engine: { fundingGap: null, dscr: null }, scoreBefore: r1.score.total, scoreAfter: r2.score.total, laneAfter: r2.lane.lane, laneBefore: r1.lane.lane, scoreOnly: true };
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
    return why.length ? why.join('; ') : '';
  }

  // ── Storage: the private backend, or this device when the backend is absent ──
  function makeStore(fetchFn, storage) {
    var local = {
      read: function () { try { return JSON.parse(storage.getItem(LOCAL_KEY) || '{}'); } catch (e) { return {}; } },
      write: function (o) { try { storage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch (e) { /* storage full or blocked */ } }
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
    return tile(esc(pts(s.total)) + '<span class="sr-of"> / ' + s.minimum + '</span>', s.meets ? 'CHFA points: clears the 9% minimum.' : (s.primaryOk ? 'CHFA points: ' + esc(pts(-s.margin)) + ' short of the 9% minimum.' : 'CHFA points: no primary criterion points yet.'), s.meets ? 'sr-ok' : 'sr-bad') +
      tile(esc(l.lane === 'unknown' ? '—' : money(l.amount)), esc(l.lane === 'unknown' ? l.text : 'Gap funds: ' + l.lane + ' ' + l.kind + '.'), l.flags.length ? 'sr-warn' : '') +
      tile(String(th.missing) + '<span class="sr-of"> missing</span>', 'Threshold items: ' + th.ready + ' ready, ' + th.unchecked + ' not checked' + (th.na ? ', ' + th.na + ' do not apply' : '') + '.', th.missing ? 'sr-bad' : (th.unchecked ? 'sr-warn' : 'sr-ok')) +
      tile(g == null ? '—' : esc(money(g)), g == null ? 'Funding gap: load a Deal Calculator export to see it.' : 'Funding gap after modeled sources.', g > 0 ? 'sr-warn' : '');
  }

  function linesTableHtml(r) {
    var label = { counted: 'Counted', 'not claimed': 'Not claimed', missing: 'Not earned', excluded: 'Not counted', 'needs entry': 'Enter points' };
    return '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col">Scoring line</th><th scope="col" class="sr-num">Points</th><th scope="col" class="sr-num">Possible</th><th scope="col">Status</th></tr></thead><tbody>' +
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
      '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col">Test</th><th scope="col" class="sr-num">Funding gap</th><th scope="col" class="sr-num">Coverage</th><th scope="col" class="sr-num">Deferred fee</th><th scope="col">Result</th></tr></thead><tbody>' +
      st.tests.map(function (t) {
        var e = t.engine || {};
        return '<tr><td><strong>' + esc(t.label) + '</strong><div class="sr-muted">' + esc(t.why) + (t.note ? ' ' + esc(t.note) : '') + '</div></td>' +
          '<td class="sr-num">' + esc(cell(e.fundingGap, money)) + '</td><td class="sr-num">' + esc(cell(e.dscr, ratio)) + '</td><td class="sr-num">' + esc(cell(e.deferredDeveloperFee, money)) + '</td>' +
          '<td>' + (t.fails ? '<span class="sr-flag">Fails: ' + esc(t.fails) + '</span>' : 'Holds') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function mount(doc, rules, prop123, store) {
    var $ = function (id) { return doc.getElementById(id); };
    var state = { deal: null, name: '', parent: '', version: blankVersion(), stress: null, versions: [], picked: {}, cache: {}, hidden: [], baseline: '' };

    function blankVersion() { return { deal: { mix: {}, place: '', sponsor: 'for-profit', supportive: false, rehab: false, existingCredit: false }, claims: {}, thresholds: {}, documents: [], engine: {}, calculator: null }; }

    // Form → state
    function readForm() {
      var v = state.version, d = v.deal;
      TIERS.concat(['market']).forEach(function (t) { var el = $('sr-mix-' + t); d.mix[t] = el ? (num(el.value) || 0) : 0; });
      d.place = $('sr-place').value.trim();
      d.sponsor = $('sr-sponsor').value;
      d.supportive = $('sr-supportive').checked;
      d.rehab = $('sr-rehab').checked;
      d.existingCredit = $('sr-existing').checked;
      var ac = num($('sr-credits').value); if (ac != null) v.engine.annualCredits = ac; else if (!v.calculator) delete v.engine.annualCredits;
      doc.querySelectorAll('[data-claim]').forEach(function (el) {
        var id = el.getAttribute('data-claim');
        v.claims[id] = el.type === 'checkbox' ? el.checked : num(el.value);
        var ref = doc.querySelector('[data-ref="' + id + '"]'); if (ref) v.claims[id + ':ref'] = ref.value.slice(0, 200);
      });
      doc.querySelectorAll('[data-threshold]').forEach(function (el) {
        v.thresholds[el.getAttribute('data-threshold')] = el.value;
        var ref = doc.querySelector('[data-tref="' + el.getAttribute('data-threshold') + '"]'); if (ref) v.thresholds[el.getAttribute('data-threshold') + ':ref'] = ref.value.slice(0, 200);
      });
    }
    function writeForm() {
      var v = state.version, d = v.deal;
      TIERS.concat(['market']).forEach(function (t) { var el = $('sr-mix-' + t); if (el) el.value = d.mix[t] ? d.mix[t] : ''; });
      $('sr-place').value = d.place || '';
      $('sr-sponsor').value = d.sponsor || 'for-profit';
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
      $('sr-calc-status').textContent = v.calculator ? 'Deal Calculator export loaded' + (v.calculator.exportedAt ? ' (exported ' + v.calculator.exportedAt.slice(0, 10) + ')' : '') + '. Unit mix and model results come from it.' : 'No Deal Calculator export loaded. Type the unit mix below; stress tests need an export.';
      $('sr-stress-run').disabled = !v.calculator;
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

    // The engine runs depend only on the calculator export, so a form change keeps them.
    function onChange() { readForm(); draw(); }

    // Uploads: a calculator export fills the deal; any other file is fingerprinted, never stored.
    $('sr-file').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files || []);
      files.forEach(function (file) {
        if (/\.json$/i.test(file.name)) {
          file.text().then(function (t) {
            var snap; try { snap = JSON.parse(t); } catch (e) { snap = null; }
            var c = fromCalculatorExport(snap);
            if (!c) { flash('That JSON is not a Deal Calculator export.'); return; }
            var v = state.version;
            v.calculator = { query: c.query, exportedAt: c.exportedAt, nine: c.nine };
            v.engine = c.engine; v.deal.mix = c.mix;
            if (!c.nine) flash('This export is set to 4%. The score is for a 9% Round One application.');
            writeForm(); state.stress = null; draw();
          });
        } else {
          file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (h) {
            var hex = Array.prototype.map.call(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
            state.version.documents.push({ name: file.name.slice(0, 160), size: file.size, sha256: hex, added: new Date().toISOString().slice(0, 10) });
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
      runStress(doc, v.calculator.query, rules, prop123, v, function (i, n) { $('srStress').innerHTML = '<p>Running the Deal Calculator… ' + (i + 1) + ' of ' + (n + 1) + '</p>'; })
        .then(function (st) { state.stress = st; v.engine = Object.assign({}, v.engine, { fundingGap: st.base.fundingGap, dscr: st.base.dscr, deferredDeveloperFee: st.base.deferredDeveloperFee, annualCredits: st.base.annualCredits, creditEquity: st.base.creditEquity, totalDevelopmentCost: st.base.totalDevelopmentCost }); draw(); })
        .catch(function (e) { $('srStress').innerHTML = '<p class="sr-flag">' + esc(e.message) + '</p>'; })
        .then(function () { btn.disabled = false; });
    });

    // Saving and versions
    function refreshDeals(selectId) {
      return store.deals().then(function (deals) {
        $('sr-deal').innerHTML = '<option value="">New deal</option>' + deals.map(function (d) {
          return '<option value="' + esc(d.id) + '">' + esc(d.name) + ' (' + d.versions + ' version' + (d.versions === 1 ? '' : 's') + ')</option>';
        }).join('');
        if (selectId) $('sr-deal').value = selectId;
        $('srStore').textContent = store.mode() === 'server' ? 'Saved on the developer site for everyone signed in. A save never overwrites an earlier version.' : 'The save service is not reachable, so versions are kept on this device only.';
      });
    }
    function refreshVersions() {
      if (!state.deal) { $('srVersions').innerHTML = '<p class="sr-muted">Save this deal to start its version list.</p>'; return Promise.resolve(); }
      return store.versions(state.deal).then(function (res) {
        state.versions = res.versions; state.hidden = res.hidden || []; state.baseline = res.baseline || '';
        var show = $('sr-show-hidden').checked;
        var rows = res.versions.filter(function (v) { return show || state.hidden.indexOf(v.v) === -1; });
        $('srVersions').innerHTML = rows.length ? '<div class="sr-scroll"><table class="sr-table"><thead><tr><th scope="col">Compare</th><th scope="col">Version</th><th scope="col" class="sr-num">Score</th><th scope="col">Lane</th><th scope="col" class="sr-num">Gap</th><th scope="col">Actions</th></tr></thead><tbody>' +
          rows.map(function (v) {
            var hid = state.hidden.indexOf(v.v) !== -1, base = state.baseline === v.v;
            return '<tr><td><input type="checkbox" class="sr-pick" data-v="' + esc(v.v) + '" aria-label="Compare ' + esc(v.label || v.v) + '"' + (state.picked[v.v] ? ' checked' : '') + '></td>' +
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
      if (state.cache[v]) return Promise.resolve(state.cache[v]);
      return store.get(state.deal, v).then(function (rec) {
        if (!rec) return null;
        var data = rec.data || {};
        var out = Object.assign({}, data, { v: rec.v, label: rec.label, name: rec.name, at: rec.at, by: rec.by });
        state.cache[v] = out; return out;
      });
    }

    $('sr-deal').addEventListener('change', function () {
      state.deal = $('sr-deal').value || null; state.picked = {}; state.parent = '';
      var opt = $('sr-deal').selectedOptions[0];
      $('sr-name').value = state.deal ? opt.textContent.replace(/ \(\d+ versions?\)$/, '') : '';
      refreshVersions().then(function () {
        var first = state.versions.filter(function (v) { return state.hidden.indexOf(v.v) === -1; })[0];
        var pick = state.baseline && state.versions.some(function (v) { return v.v === state.baseline; }) ? state.baseline : first && first.v;
        if (pick) return getVersion(pick).then(openVersion);
      });
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
      if (act === 'open') getVersion(v).then(openVersion);
      else store.meta(state.deal, act, v).then(refreshVersions);
    });

    function drawCompare() {
      var ids = Object.keys(state.picked).filter(function (k) { return state.picked[k]; });
      if (ids.length < 2) { $('srCompare').innerHTML = '<p class="sr-muted">Tick two to four versions above to compare them. Changed rows are highlighted.</p>'; return; }
      if (ids.length > 4) { $('srCompare').innerHTML = '<p class="sr-flag">Pick four or fewer.</p>'; return; }
      Promise.all(ids.map(getVersion)).then(function (vs) {
        vs = vs.filter(Boolean).sort(function (a, b) { return a.v < b.v ? -1 : 1; });
        $('srCompare').innerHTML = compareTable(rules, prop123, vs);
      });
    }

    $('sr-save').addEventListener('click', function () {
      readForm();
      var name = $('sr-name').value.trim();
      if (!name) { flash('Give the deal a name first.'); $('sr-name').focus(); return; }
      var r = draw();
      var data = JSON.parse(JSON.stringify(state.version));
      if (state.shownStress) { data.stress = state.shownStress.tests; data.stressBase = state.shownStress.base; }
      data.review = { score: r.score.total, meets: r.score.meets, lane: r.lane.lane, laneAmount: r.lane.amount, midpoint: r.lane.midpoint, summary: summaryLines(r), rules: rules.id, rulesStatus: rules.status, rulesChecked: rules.checked_at };
      var btn = $('sr-save'); btn.disabled = true;
      store.save({ deal: state.deal || undefined, name: name, label: $('sr-label').value.trim() || 'Version', parent: state.parent || undefined, data: data,
        summary: { score: Math.round(r.score.total * 100) / 100, gap: num(r.engine.fundingGap), lane: r.lane.lane } })
        .then(function (res) {
          state.deal = res.deal; state.parent = res.v;
          state.cache[res.v] = Object.assign({}, data, { v: res.v, label: res.meta.label, name: name, at: res.meta.at, by: res.meta.by });
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
        '<select id="sr-t-' + esc(t.id) + '" data-threshold="' + esc(t.id) + '"><option value="">Not checked</option><option value="ready">Ready</option><option value="missing">Missing</option><option value="na">Does not apply</option></select>' +
        '<input type="text" class="sr-ref" data-tref="' + esc(t.id) + '" placeholder="Document and page" aria-label="Document and page for threshold ' + esc(t.id) + '"></div>';
    }).join('');
    return { claims: html, thresholds: th };
  }

  function start(doc) {
    var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get(RULES_URL), get(PROP123_URL)]).then(function (res) {
      if (!res[0]) { doc.getElementById('srMain').innerHTML = '<p>The scoring rules did not load.</p>'; return; }
      var f = formHtml(res[0]);
      doc.getElementById('srClaims').innerHTML = f.claims;
      doc.getElementById('srThresholds').innerHTML = f.thresholds;
      var storage; try { storage = window.localStorage; } catch (e) { storage = { getItem: function () { return null; }, setItem: function () {} }; }
      mount(doc, res[0], res[1], makeStore(fetch.bind(window), storage));
    });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(document); });
    else start(document);
  }

  return { esc: esc, mixTotals: mixTotals, amiMidpoint: amiMidpoint, targetingPoints: targetingPoints, eliPoints: eliPoints, score: score,
    findJurisdiction: findJurisdiction, prop123Status: prop123Status, gapLane: gapLane, bumpOneUnit: bumpOneUnit, thresholdStatus: thresholdStatus,
    creditCheck: creditCheck, review: review, summaryLines: summaryLines, compareTable: compareTable, fromCalculatorExport: fromCalculatorExport,
    stressFails: stressFails, amiStress: amiStress, makeStore: makeStore, formHtml: formHtml, STRESS: STRESS, RULES_URL: RULES_URL, API: API };
});
