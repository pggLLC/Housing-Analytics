/**
 * js/where-to-build.js
 * Scoring for the gated "Where Should I Build?" page (developer-where.html).
 *
 * Every town, community and county in the HNA ranking is scored on factors
 * the reader weights. Each factor earns 0–10 points by a written rule (RULES
 * below, printed on the page) or is "not yet checked" (points null).
 *
 *   score      = sum(weight × points) / sum(weight × 10), over checked factors, × 100
 *                + signals (up to +10) − red flags (down to −30), held to 0–100
 *   confidence = the share of the total weight that rests on checked factors:
 *                High ≥ 80%, Medium 50–79%, Low < 50%
 *   tier       = Target ≥ 70 and not Low; Promising ≥ 50; Monitor ≥ 35
 *
 * "Not yet checked" is never a zero: it leaves the factor out of the score and
 * lowers confidence instead, and Low confidence keeps a place out of Target.
 *
 * Inputs (all already on the site; see FACTORS[].source):
 *   ranking   data/hna/ranking-index.json
 *   prop123   data/policy/prop123_jurisdictions.json
 *   awards    data/policy/prop123-land-banking-awards.json
 *   lbStatus  data/policy/prop123-land-banking-status.json (optional)
 *   hud       data/hud-fmr-income-limits.json
 *   context   data/policy/where-to-build-context.json (county votes, parks)
 *   support, fees, funds, coverage   read through js/local-support-data.js
 *
 * No DOM, no fetch, no clock: the caller passes `today`, so the page and the
 * tests get the same answer for the same date.
 */
(function (root, factory) {
  'use strict';
  var LSD = (root && root.LocalSupportData) ||
    (typeof module === 'object' && module.exports && typeof require === 'function' ? require('./local-support-data.js') : null);
  var api = factory(LSD);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhereToBuild = api;
}(typeof window !== 'undefined' ? window : this, function (LSD) {
  'use strict';

  // The six regions every COHO page uses (DOLA planning regions folded
  // together; scripts/hna/build_ranking_index.py REGIONS, pinned by
  // test/region-membership.test.js).
  var REGIONS = {
    'Front Range':    ['08001', '08005', '08013', '08014', '08019', '08031', '08035', '08041', '08059', '08069', '08101', '08123'],
    'Western Slope':  ['08029', '08045', '08051', '08053', '08077', '08081', '08085', '08091', '08103', '08113'],
    'Mountains':      ['08015', '08027', '08037', '08043', '08047', '08049', '08057', '08065', '08093', '08097', '08107', '08117', '08119'],
    'Eastern Plains': ['08009', '08011', '08017', '08025', '08039', '08055', '08061', '08063', '08071', '08073', '08075', '08087',
                       '08089', '08095', '08099', '08115', '08121', '08125'],
    'San Luis Valley':['08003', '08021', '08023', '08079', '08105', '08109'],
    'Southwest':      ['08007', '08033', '08067', '08083', '08111']
  };

  var GROUPS = [
    { id: 'build', label: 'Easy to build', weight: 4, factors: ['prop123', 'approvals'],
      tip: 'A Prop 123 fast-track commitment and recent council or planning commission approvals of income-restricted homes.' },
    { id: 'money', label: 'Incentives and local money', weight: 4, factors: ['incentives', 'localFund', 'basisBoost'],
      tip: 'Fee waivers and land-use incentives, a dedicated local housing fund, and the federal basis boost.' },
    { id: 'land', label: 'Land opportunities', weight: 3, factors: ['landBank'],
      tip: 'Prop 123 land-banking land, scored highest where no developer is on record yet.' },
    { id: 'need', label: 'Housing need', weight: 3, factors: ['need'],
      tip: 'The HNA overall need score.' },
    { id: 'rents', label: 'Rents that carry the deal', weight: 2, factors: ['rentCushion'],
      tip: 'How far HUD\'s Fair Market Rent sits above the 60% AMI rent cap.' },
    { id: 'rec', label: 'Recreation and services', weight: 2, factors: ['parks', 'amenities'],
      tip: 'Parks nearby, and grocery, health care, schools and transit within reach.' },
    { id: 'vote', label: 'Voters backed housing money', weight: 2, factors: ['prop123Vote'],
      tip: 'The county\'s yes share on Proposition 123 in 2022.' },
    { id: 'lean', label: '2024 presidential vote', weight: 0, factors: ['presVote'],
      tip: 'The county\'s 2024 two-party presidential vote share. Off unless you turn it up.' }
  ];

  var PRESETS = {
    mix: { label: 'Balanced', weights: { build: 4, money: 4, land: 3, need: 3, rents: 2, rec: 2, vote: 2, lean: 0 } },
    rural9: { label: '9% in a smaller town', weights: { build: 3, money: 3, land: 4, need: 4, rents: 2, rec: 1, vote: 1, lean: 0 } },
    metro4: { label: '4% bond deal in a metro', weights: { build: 3, money: 5, land: 2, need: 3, rents: 4, rec: 2, vote: 1, lean: 0 } }
  };

  var SRC = {
    dola: { label: 'DOLA Prop 123 commitment filings and fast-track list', url: 'https://cdola.colorado.gov/commitment-filings' },
    support: { label: 'Council and planning commission records (local-support.json)', url: 'data/policy/local-support.json' },
    fees: { label: 'Local fee reductions and land-use incentives (fee-reductions.json)', url: 'data/policy/fee-reductions.json' },
    funds: { label: 'Local housing funds, taxes and linkage fees (local-housing-funds.json)', url: 'data/policy/local-housing-funds.json' },
    hna: { label: 'HNA ranking index (ACS 5-year, CHAS, LODES, HUD QCT/DDA, amenities)', url: 'data/hna/ranking-index.json' },
    lb: { label: 'Prop 123 Land Banking awards (CHFA for OEDIT)', url: 'https://coloradoaffordablehousingfinancingfund.com/land-banking/' },
    hud: { label: 'HUD Fair Market Rents and Income Limits', url: 'https://www.huduser.gov/portal/datasets/fmr.html' },
    parks: { label: 'OpenStreetMap parks (parks_co.geojson)', url: 'data/amenities/parks_co.geojson' }
  };

  // The rule behind each factor's points, printed in the page's Methods box.
  var FACTORS = {
    prop123: { label: 'Prop 123 commitment', source: SRC.dola,
      rule: 'Fast-track adopted: 10. Commitment filed: 6. Not on DOLA\'s list: 0. A Census community uses its county\'s filing.' },
    approvals: { label: 'Recent approvals', source: SRC.support,
      rule: 'A council or planning commission approval of income-restricted homes in the last 36 months: 10. Records read, none found: 0. Not read yet: not checked.' },
    incentives: { label: 'Fee and land-use incentives', source: SRC.fees,
      rule: 'A standing fee waiver or reduction, or an adopted land-use incentive: 10. Read, none found: 0. Not read yet: not checked. Inclusionary zoning is a requirement, so it does not count.' },
    localFund: { label: 'Local housing money', source: SRC.funds,
      rule: 'Its own dedicated fund, tax or linkage fee: 10. Only a county one: 6. Read, none found: 0. Not read yet: not checked.' },
    basisBoost: { label: 'Basis boost (QCT/DDA)', source: SRC.hna,
      rule: 'The HNA ranking\'s QCT/DDA score, 0 to 100, divided by 10.' },
    landBank: { label: 'Land-bank land', source: SRC.lb,
      rule: 'Best Prop 123 land-bank award in the place: seeking a developer or no public next step found: 10; no later state funding on record: 8; development partner chosen: 5; applied for building money: 4; building money awarded: 2; no award: 0.' },
    need: { label: 'Housing need', source: SRC.hna,
      rule: 'The HNA overall need score, 0 to 100, divided by 10.' },
    rentCushion: { label: 'Rent cushion', source: SRC.hud,
      rule: 'The county\'s 60% AMI two-bedroom rent cap as a share of HUD\'s two-bedroom Fair Market Rent: 90% or less: 10; up to 100%: 7; up to 110%: 4; above 110%: 1.' },
    parks: { label: 'Parks nearby', source: SRC.parks,
      rule: 'Towns: 2 points per park within 5 miles, up to 10. Counties: 1 point per 3 parks inside the county line, up to 10. City parks only: trails and public lands are not counted yet.' },
    amenities: { label: 'Services within reach', source: SRC.hna,
      rule: 'The HNA amenity access score (grocery, health care, schools, transit), 0 to 100, divided by 10.' },
    prop123Vote: { label: 'Prop 123 vote (2022)', source: null,
      rule: 'County yes share: 30% or less: 0, 70% or more: 10, in a straight line between. Every town in a county shows its county\'s result.' },
    presVote: { label: '2024 presidential vote', source: null,
      rule: 'County two-party share for the Harris/Walz ticket: 20% or less: 0, 80% or more: 10, in a straight line between.' }
  };

  var RULES = {
    signal: 'A signal is a dated public event in the last 12 months: a Prop 123 fast-track adopted, a local housing fund adopted, an approval of income-restricted homes, or land-bank land seeking a developer (dated by the public notice of the search). Each is worth up to +5, fading to 0 over 12 months; signals add at most +10.',
    flag: 'A red flag is a recorded denial of income-restricted homes by a council or planning commission in the last 36 months. Each subtracts 15, at most 30. Only records already read are counted; most places have not been read yet.',
    confidence: 'Confidence is the share of your total weight that rests on checked factors: High 80% or more, Medium 50 to 79%, Low under 50%.',
    tiers: 'Target: 70 or more and not Low confidence. Promising: 50 to 69, or 70+ with Low confidence. Monitor: 35 to 49.'
  };

  var CONSOLIDATED = { '0820000': '08031', '0809280': '08014' };

  function prop123Key(name) {
    return String(name || '').toLowerCase().trim().replace(/^(city and county|city|town) of /, '');
  }

  /** "Cañon City (city)" / "City of Canon City" / "Mt. Crested Butte" → one key. */
  function nameKey(name) {
    return prop123Key(String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, ''))
      .replace(/\s*\((city|town|cdp|city and county|consolidated city)\)\s*$/, '')
      .replace(/\s+(county|cdp)$/, '')
      .replace(/^mt\.? /, 'mount ').replace(/\./g, '').replace(/\s+/g, ' ').trim()
      .replace(/^central$/, 'central city');
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Files each factor rests on (the HNA ranking is required for any score at all).
  var NEEDS = { prop123: ['prop123'], approvals: ['support'], incentives: ['fees', 'coverage'], localFund: ['funds', 'coverage'],
    landBank: ['awards', 'lbStatus'], rentCushion: ['hud'], parks: ['context'], prop123Vote: ['context'], presVote: ['context'] };
  var DOC_FILES = { prop123: 'prop123_jurisdictions.json', support: 'local-support.json', fees: 'fee-reductions.json', funds: 'local-housing-funds.json',
    coverage: 'incentive-coverage.json', awards: 'prop123-land-banking-awards.json', lbStatus: 'prop123-land-banking-status.json', hud: 'hud-fmr-income-limits.json', context: 'where-to-build-context.json' };
  // Status dates may be YYYY or YYYY-MM; read them as the earliest day they allow, so a signal never looks newer than its source.
  function fullDate(d) {
    d = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    if (/^\d{4}-\d{2}$/.test(d)) return d + '-01';
    if (/^\d{4}$/.test(d)) return d + '-01-01';
    return null;
  }

  var LB_POINTS = { seeking: 10, none_found: 10, none: 8, partner: 5, applied: 4, not_funded: 4, financed: 2 };
  var LB_PHRASE = {
    seeking: 'land-bank land seeking a developer',
    none_found: 'land-bank land with no public next step',
    none: 'land-bank land with no later state funding',
    partner: 'land-bank land with a partner chosen',
    applied: 'land-bank land with an application in',
    not_funded: 'land-bank land with an application in',
    financed: 'land-bank land already funded to build'
  };

  /**
   * Build the scoring model once from the loaded files.
   * Returns { places, meta }; each place carries its factors already evaluated.
   */
  function build(docs, today) {
    docs = docs || {};
    var rankings = (docs.ranking && docs.ranking.rankings) || [];
    var byGeoid = {};
    rankings.forEach(function (r) { byGeoid[r.geoid] = r; });

    // Prop 123: municipalities and counties by name key.
    var p123 = { municipality: {}, county: {} };
    var p123List = (docs.prop123 && (docs.prop123.jurisdictions || docs.prop123.list)) || [];
    p123List.forEach(function (p) {
      var kind = p.kind === 'county' ? 'county' : 'municipality';
      p123[kind][nameKey(p.jurisdiction || p.name)] = p;
    });
    function prop123For(r) {
      var countyGeoid = r.type === 'county' ? r.geoid : r.containingCounty;
      if (r.type === 'place' && !CONSOLIDATED[r.geoid]) {
        return { rec: p123.municipality[nameKey(r.name)] || null, via: null };
      }
      // A Census community that has since incorporated (Keystone, 2024) files as a town.
      if (r.type === 'cdp' && p123.municipality[nameKey(r.name)]) {
        return { rec: p123.municipality[nameKey(r.name)], via: null };
      }
      var c = byGeoid[CONSOLIDATED[r.geoid] || countyGeoid];
      var rec = c ? p123.county[nameKey(c.name)] || null : null;
      return { rec: rec, via: r.type === 'cdp' && c ? c.name : null };
    }

    // Land banking: awards by place and county.
    var status = (docs.lbStatus && docs.lbStatus.status) || null;
    var lbByPlace = {}, lbByCounty = {};
    ((docs.awards && docs.awards.awards) || []).forEach(function (a) {
      (a.places || []).forEach(function (p) { (lbByPlace[p.geoid] = lbByPlace[p.geoid] || []).push(a); });
      (a.county_fips || []).forEach(function (c) { (lbByCounty[c] = lbByCounty[c] || []).push(a); });
    });

    var hudByCounty = {};
    ((docs.hud && docs.hud.counties) || []).forEach(function (c) { hudByCounty[c.fips] = c; });

    var ctx = docs.context || {};
    var votes = ctx.votes || {};
    var p123Votes = (votes.prop123_2022 && votes.prop123_2022.counties) || {};
    var presVotes = (votes.president_2024 && votes.president_2024.counties) || {};
    var parks = ctx.parks || { places: {}, counties: {} };

    var local = LSD ? LSD.build({ support: docs.support, fees: docs.fees, funds: docs.funds, coverage: docs.coverage }) : null;
    var coverage = {};
    ((docs.coverage && docs.coverage.jurisdictions) || []).forEach(function (row) { coverage[row.geoid] = row; });

    var places = rankings.map(function (r) {
      var countyGeoid = r.type === 'county' ? r.geoid : r.containingCounty;
      var county = byGeoid[countyGeoid] || null;
      var m = r.metrics || {};
      var f = {};
      var signals = [];
      var flags = [];

      // ---- Prop 123 commitment
      var pp = prop123For(r);
      var via = pp.via ? ' (through ' + pp.via + ')' : '';
      if (pp.rec && pp.rec.fast_track) {
        f.prop123 = { points: 10, value: 'Fast-track adopted ' + (pp.rec.fast_track_adopted || '') + via, date: pp.rec.fast_track_adopted || pp.rec.filing_date,
          good: 'a fast-track Prop 123 commitment' };
        if (pp.rec.fast_track_adopted && !pp.via) addSignal(signals, today, pp.rec.fast_track_adopted, 'Prop 123 fast-track adopted', SRC.dola.url);
      } else if (pp.rec) {
        f.prop123 = { points: 6, value: 'Commitment filed ' + (pp.rec.filing_date || '') + ', no fast-track' + via, date: pp.rec.filing_date,
          good: 'a Prop 123 commitment', weak: 'no Prop 123 fast-track' };
      } else {
        f.prop123 = { points: 0, value: 'Not on DOLA\'s commitment list' + via, weak: 'no Prop 123 commitment' };
      }

      // ---- Local support: approvals, incentives, funds, denials
      var prof = local ? local.profile(r.geoid, today, { kind: r.type, county: countyGeoid }) : null;
      var subject = prof ? prof.subjectGeoid : r.geoid;
      var cov = coverage[subject] || coverage[CONSOLIDATED[subject]] || null;
      var viaLocal = prof && prof.inheritsFrom && county ? ' (through ' + county.name + ')' : '';
      if (prof && prof.parts.council.counted.length) {
        var a0 = prof.parts.council.counted.slice().sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })[0];
        f.approvals = { points: 10, value: a0.title + ' (' + a0.date + ')' + viaLocal, date: a0.date, url: a0.source && a0.source.url,
          good: 'recent approvals of income-restricted homes' };
        prof.parts.council.counted.forEach(function (i) {
          var d = LSD.earliestDay(i.date);
          if (d) addSignal(signals, today, d, 'Approved: ' + i.title, i.source && i.source.url);
        });
      } else if (prof && prof.parts.council.state === 'none_found') {
        f.approvals = { points: 0, value: 'Records read, no approval in the last 36 months' + viaLocal, date: prof.checked,
          weak: 'no recent approvals on record' };
      } else {
        f.approvals = { points: null, value: 'Not yet checked' };
      }
      if (prof) {
        prof.denials.forEach(function (i) {
          flags.push({ date: i.date, text: i.title + (i.body ? ' (' + i.body + ')' : ''), url: i.source && i.source.url });
        });
      }

      var counted = prof ? prof.parts.incentives.counted.concat(prof.parts.incentives.creditedInCivic) : [];
      var feeLu = counted.filter(function (i) { return i.scope !== 'funds'; });
      var fundsOwn = counted.filter(function (i) { return i.scope === 'funds'; });
      var res = (cov && cov.result_by_scope) || {};
      if (feeLu.length) {
        f.incentives = { points: 10, value: feeLu.slice(0, 3).map(function (i) { return LSD.incentiveLabel(i); }).join('; ') + viaLocal,
          good: feeLu.length > 1 ? 'fee and land-use incentives' : 'a ' + LSD.incentiveLabel(feeLu[0]) };
      } else if (res.fees === 'none_found' && res.land_use === 'none_found') {
        f.incentives = { points: 0, value: 'Read ' + (cov.checked || '') + ', none found', date: cov.checked, weak: 'no fee or land-use incentives found' };
      } else {
        f.incentives = { points: null, value: res.fees === 'unreadable' || res.land_use === 'unreadable' ? 'Not yet checked (official source unreadable)' : 'Not yet checked' };
      }

      var countyFunds = [];
      if (r.type !== 'county' && local && countyGeoid) {
        var cp = local.profile(countyGeoid, today, {});
        countyFunds = cp.parts.incentives.counted.filter(function (i) { return i.scope === 'funds'; });
      }
      if (fundsOwn.length && viaLocal) {
        // A CDP's profile is its county's, so the fund is the county's: county rule, 6 points.
        f.localFund = { points: 6, value: LSD.incentiveLabel(fundsOwn[0]) + (fundsOwn[0].record.adopted ? ', adopted ' + fundsOwn[0].record.adopted : '') + viaLocal,
          date: fundsOwn[0].record.adopted, good: 'county housing money' };
      } else if (fundsOwn.length) {
        var fr = fundsOwn[0].record;
        f.localFund = { points: 10, value: LSD.incentiveLabel(fundsOwn[0]) + (fr.adopted ? ', adopted ' + fr.adopted : '') + viaLocal, date: fr.adopted,
          good: 'a dedicated local ' + LSD.incentiveLabel(fundsOwn[0]) };
        fundsOwn.forEach(function (i) {
          if (i.record.adopted) addSignal(signals, today, i.record.adopted, 'Local housing money adopted: ' + LSD.incentiveLabel(i), SRC.funds.url);
        });
      } else if (countyFunds.length) {
        f.localFund = { points: 6, value: county.name + ': ' + LSD.incentiveLabel(countyFunds[0]), date: countyFunds[0].record.adopted,
          good: 'county housing money' };
      } else if (res.funds === 'none_found') {
        f.localFund = { points: 0, value: 'Read ' + (cov.checked || '') + ', none found', date: cov.checked, weak: 'no dedicated local housing money found' };
      } else {
        f.localFund = { points: null, value: 'Not yet checked' };
      }

      // ---- HNA ranking measures
      f.basisBoost = metricFactor(m.qct_dda_score, function (v) {
        return v >= 100 ? 'Whole area in a DDA or QCT (score 100)' : 'QCT/DDA score ' + Math.round(v);
      }, 'the federal basis boost', 'no basis boost');
      f.need = metricFactor(m.overall_need_score, function (v) {
        return 'Need score ' + Math.round(v) + (m.workforce_gap_units != null ? '; workforce gap ' + fmt(Math.round(m.workforce_gap_units)) + ' homes' : '');
      }, 'high housing need', 'lower housing need');
      f.amenities = metricFactor(m.amenity_access_score, function (v) { return 'Amenity access score ' + Math.round(v); },
        'services within reach', 'few services nearby');

      // ---- Land banking
      var lbAwards = r.type === 'county' ? (lbByCounty[r.geoid] || []) : (lbByPlace[r.geoid] || []);
      if (lbAwards.length) {
        var best = null, scoredAwards = [];
        lbAwards.forEach(function (a) {
          var s = status && status[a.id] ? status[a.id].status : null;
          var pts = s ? (LB_POINTS[s] != null ? LB_POINTS[s] : 7) : 7;
          scoredAwards.push({ id: a.id, status: s, points: pts });
          if (!best || pts > best.pts) best = { a: a, s: s, pts: pts };
          if (s === 'seeking') {
            // Date the signal from the dated public source that shows the search, never the
            // refresh date, so a re-check cannot make an old search look new. No dated source, no signal.
            var dated = (status[a.id].sources || []).filter(function (x) { return x && fullDate(x.date) && x.url; })
              .sort(function (x, y) { return fullDate(x.date) < fullDate(y.date) ? 1 : -1; })[0];
            if (dated) addSignal(signals, today, fullDate(dated.date), 'Land-bank land seeking a developer: ' + (a.show_project || a.project), dated.url);
          }
        });
        var lbl = best.s ? (status[best.a.id].label || best.s) : 'status not loaded';
        f.landBank = { points: best.pts, value: lbAwards.length + ' award' + (lbAwards.length > 1 ? 's' : '') + '; best: ' + (best.a.show_project || best.a.project) + ' (' + lbl + ')',
          url: best.a.source_url, good: best.s ? LB_PHRASE[best.s] : 'state land-bank land', weak: best.pts <= 4 ? LB_PHRASE[best.s] : null,
          awards: scoredAwards,
          // The award document shows the land; the status sources show what happened next.
          evidence: best.s ? (status[best.a.id].sources || []).filter(function (x) { return x && x.url; }) : [] };
      } else {
        f.landBank = { points: 0, value: 'No Prop 123 land-bank award', weak: 'no state land-bank land' };
      }

      // ---- Rents: 60% AMI 2BR cap vs HUD 2BR FMR (county)
      var hud = hudByCounty[countyGeoid];
      var cap = hud && hud.affordable_rents_60pct && hud.affordable_rents_60pct.rent_60pct_3person;
      if (cap && cap.pct_of_fmr != null) {
        var p = cap.pct_of_fmr;
        f.rentCushion = { points: p <= 90 ? 10 : p <= 100 ? 7 : p <= 110 ? 4 : 1,
          value: '60% cap $' + fmt(cap.gross_rent) + ' is ' + Math.round(p) + '% of the $' + fmt(cap.fmr_amount) + ' Fair Market Rent' + (m.gross_rent_median ? '; ACS median rent $' + fmt(m.gross_rent_median) : ''),
          good: 'market rents above the 60% cap', weak: p > 100 ? 'market rents below the 60% cap' : 'rents near the 60% cap' };
      } else {
        f.rentCushion = { points: null, value: 'No HUD figure for the county' };
      }

      // ---- Parks
      var nParks = r.type === 'county' ? (parks.counties || {})[r.geoid] : (parks.places || {})[r.geoid];
      if (nParks != null) {
        var pk = r.type === 'county' ? Math.min(10, Math.floor(nParks / 3)) : Math.min(10, nParks * 2);
        f.parks = { points: pk, value: fmt(nParks) + (r.type === 'county' ? ' parks inside the county' : ' parks within 5 miles'),
          good: 'parks nearby', weak: 'few parks nearby' };
      } else {
        f.parks = { points: null, value: 'No park count' };
      }

      // ---- County votes
      var v1 = p123Votes[countyGeoid];
      f.prop123Vote = v1
        ? { points: round1(clamp((v1.yes_share - 0.30) / 0.40 * 10, 0, 10)), value: (county ? county.name : 'County') + ' voted ' + pct(v1.yes_share) + ' yes (' + fmt(v1.yes) + ' to ' + fmt(v1.no) + ')',
            url: votes.prop123_2022.source_url, quote: v1.source_line, good: 'strong local votes for Prop 123', weak: 'a weak local vote for Prop 123' }
        : { points: null, value: 'No county result' };
      var v2 = presVotes[countyGeoid];
      f.presVote = v2
        ? { points: round1(clamp((v2.two_party_harris_share - 0.20) / 0.60 * 10, 0, 10)), value: (county ? county.name : 'County') + ': ' + pct(v2.two_party_harris_share) + ' of the two-party vote for Harris/Walz',
            url: votes.president_2024.source_url, quote: v2.source_line, good: 'a more liberal-leaning county vote', weak: 'a more conservative-leaning county vote' }
        : { points: null, value: 'No county result' };

      return {
        geoid: r.geoid, name: r.name, type: r.type, region: r.region || regionFor(countyGeoid),
        countyGeoid: countyGeoid, countyName: county ? county.name : null,
        population: m.population != null ? m.population : null,
        factors: f, signals: signals, flags: flags
      };
    });

    // A file that failed to load leaves its factors "not checked", never a zero for every place.
    var missing = Object.keys(NEEDS).reduce(function (acc, id) {
      NEEDS[id].forEach(function (k) { if (!docs[k] && acc.indexOf(k) < 0) acc.push(k); });
      return acc;
    }, []);
    if (missing.length) places.forEach(function (pl) {
      Object.keys(NEEDS).forEach(function (id) {
        var gone = NEEDS[id].filter(function (k) { return !docs[k]; });
        if (gone.length) pl.factors[id] = { points: null, value: 'Not scored: ' + gone.map(function (k) { return DOC_FILES[k]; }).join(', ') + ' did not load' };
      });
      if (!docs.support) pl.flags = [];
    });
    return { places: places, today: today, missing: missing.map(function (k) { return DOC_FILES[k]; }) };
  }

  function metricFactor(v, text, good, weak) {
    if (v == null || !Number.isFinite(Number(v))) return { points: null, value: 'No figure' };
    return { points: round1(clamp(Number(v) / 10, 0, 10)), value: text(Number(v)), good: good, weak: weak };
  }

  function addSignal(list, today, date, text, url) {
    var d = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    var age = dayDiff(d, today);
    if (age < 0 || age >= 365) return;
    var pts = round1(5 * (1 - age / 365));
    if (pts <= 0) return;   // a signal that has faded to 0 is no longer a signal
    list.push({ date: d, text: text, url: url || null, points: pts });
  }

  function regionFor(countyGeoid) {
    for (var k in REGIONS) if (REGIONS[k].indexOf(countyGeoid) !== -1) return k;
    return 'other';
  }

  function defaultWeights() {
    var w = {};
    GROUPS.forEach(function (g) { w[g.id] = g.weight; });
    return w;
  }

  /** Score one place under the reader's group weights (0–5 each). */
  function score(place, weights) {
    weights = weights || defaultWeights();
    var num = 0, den = 0, total = 0, checkedW = 0, nChecked = 0, nFactors = 0;
    var parts = [];
    GROUPS.forEach(function (g) {
      var gw = Number(weights[g.id]) || 0;
      g.factors.forEach(function (id) {
        var fw = gw / g.factors.length;
        var fac = place.factors[id];
        if (fw <= 0) { parts.push({ id: id, group: g.id, weight: 0, factor: fac }); return; }
        nFactors++;
        total += fw;
        if (fac.points != null) {
          num += fw * fac.points;
          den += fw * 10;
          checkedW += fw;
          nChecked++;
        }
        parts.push({ id: id, group: g.id, weight: fw, factor: fac });
      });
    });
    var base = den > 0 ? (num / den) * 100 : 0;
    var signalPts = Math.min(10, place.signals.reduce(function (s, x) { return s + x.points; }, 0));
    var flagPts = Math.min(30, place.flags.length * 15);
    // The total is summed from the operands as printed (each to a tenth), then rounded to a whole number,
    // so the row's arithmetic reconciles under any weights.
    var exact = round1(clamp(round1(base) + round1(signalPts) - flagPts, 0, 100));
    var value = Math.round(exact);
    var share = total > 0 ? checkedW / total : 0;
    var confidence = share >= 0.8 ? 'High' : share >= 0.5 ? 'Medium' : 'Low';
    // Each part's pull on the score: points above (or below) the midpoint, times its weight share.
    parts.forEach(function (p) {
      p.contribution = p.weight > 0 && p.factor.points != null && den > 0 ? (p.weight * p.factor.points / den) * 100 : 0;
      p.max = p.weight > 0 && den > 0 && p.factor.points != null ? (p.weight * 10 / den) * 100 : 0;
    });
    var out = { score: value, base: round1(base), exact: exact, signalPoints: round1(signalPts), flagPoints: flagPts,
      confidence: confidence, checkedShare: share, nChecked: nChecked, nFactors: nFactors, parts: parts };
    out.tier = tierFor(value, confidence);
    out.reason = reason(place, out);
    return out;
  }

  function tierFor(value, confidence) {
    if (value >= 70 && confidence !== 'Low') return 1;
    if (value >= 50) return 2;
    if (value >= 35) return 3;
    return null;
  }

  /** One plain sentence: what lifts the score, what holds it back, how much was checked. */
  function reason(place, s) {
    var live = s.parts.filter(function (p) { return p.weight > 0 && p.factor.points != null; });
    var ups = live.filter(function (p) { return p.factor.points >= 7 && p.factor.good; })
      .sort(function (a, b) { return b.weight * b.factor.points - a.weight * a.factor.points; });
    var downs = live.filter(function (p) { return p.factor.points <= 3 && p.factor.weak; })
      .sort(function (a, b) { return b.weight * (10 - b.factor.points) - a.weight * (10 - a.factor.points); });
    var bits = [];
    if (ups.length) bits.push('Lifted by ' + join(ups.slice(0, 2).map(function (p) { return p.factor.good; })));
    if (downs.length) bits.push((ups.length ? 'held back by ' : 'Held back by ') + downs[0].factor.weak);
    if (!bits.length) bits.push('No factor stands out either way');
    var tail = [];
    if (s.signalPoints > 0) tail.push(place.signals.length + ' recent signal' + (place.signals.length > 1 ? 's' : '') + ' (+' + s.signalPoints + ')');
    if (s.flagPoints > 0) tail.push(place.flags.length + ' red flag' + (place.flags.length > 1 ? 's' : '') + ' (−' + s.flagPoints + ')');
    tail.push(s.nChecked + ' of ' + s.nFactors + ' factors checked');
    return bits.join('; ') + '; ' + tail.join('; ') + '.';
  }

  function join(list) {
    return list.length < 2 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  return {
    fullDate: fullDate,
    REGIONS: REGIONS,
    GROUPS: GROUPS,
    FACTORS: FACTORS,
    PRESETS: PRESETS,
    RULES: RULES,
    prop123Key: prop123Key,
    nameKey: nameKey,
    build: build,
    score: score,
    tierFor: tierFor,
    defaultWeights: defaultWeights,
    regionFor: regionFor
  };
}));
