/**
 * hna-section-takeaways.js
 *
 * F216 — Layer 2 of the data-derived narrative work. Each section on
 * the HNA opens with a 1–2 sentence takeaway that surfaces what THIS
 * jurisdiction's data actually shows — not a generic chart caption.
 *
 * Mirrors the F211 hna-dev-context module: matches h2 nodes by text or
 * id, looks up a builder, builds a sentence from the loaded profile +
 * CHAS + ranking-index, and injects an aside under the existing intro
 * <p>. Idempotent — re-running the inject pass doesn't duplicate the
 * takeaways.
 *
 * Dependencies: window.HNAState, window.PlaceChas (optional),
 * window.HNANarratives (for the shared ranking-index cache).
 * Exposes: window.HnaSectionTakeaways
 *
 * Style: takeaways are short, declarative, data-bound, and never
 * lead with the comparator (same rule as F215b — surface the acute
 * finding for THIS jurisdiction, don't bury it).
 */
(function () {
  'use strict';

  // ── Shared helpers ───────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _safeNum(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  function _fmtPct(n, d) { if (n == null || !isFinite(n)) return null; return n.toFixed(d != null ? d : 1) + '%'; }
  function _fmtMoney(n) { if (n == null || !isFinite(n)) return null; return '$' + Math.round(n).toLocaleString('en-US'); }
  function _fmtInt(n)   { if (n == null || !isFinite(n)) return null; return Math.round(n).toLocaleString('en-US'); }

  // ── Context assembly ────────────────────────────────────────────
  // Returns a single object holding every field the takeaways need,
  // pulled from globals that are already populated by the HNA
  // controller. Returns null when there's no profile yet.
  function _gatherCtx() {
    var st = window.HNAState && window.HNAState.state;
    if (!st) return null;
    var profile = st.lastProfile;
    if (!profile) return null;
    var ctx = {
      profile: profile,
      geoid: profile._geoid || null,
      geoType: profile._geoType || null,
      label: (st.lastLabel) || null,
      contextCounty: st.contextCounty || null,
      chas: st.chasData || null,
    };
    // Pre-compute the most-cited values so each takeaway is a one-liner.
    var p = profile;
    ctx.pop          = _safeNum(p.DP05_0001E);
    ctx.medianRent   = _safeNum(p.DP04_0134E);
    ctx.medianHome   = _safeNum(p.DP04_0089E);
    ctx.medianHhInc  = _safeNum(p.DP03_0062E);
    ctx.pctOwner     = _safeNum(p.DP04_0046PE);
    ctx.pctRenter    = _safeNum(p.DP04_0047PE);
    ctx.avgHhSize    = _safeNum(p.DP02_0016E);

    // Structure mix
    var sfDet = _safeNum(p.DP04_0007E) || 0;
    var sfAtt = _safeNum(p.DP04_0008E) || 0;
    var u2    = _safeNum(p.DP04_0009E) || 0;
    var u34   = _safeNum(p.DP04_0010E) || 0;
    var u59   = _safeNum(p.DP04_0011E) || 0;
    var u1019 = _safeNum(p.DP04_0012E) || 0;
    var u20p  = _safeNum(p.DP04_0013E) || 0;
    var mh    = _safeNum(p.DP04_0014E) || 0;
    var totalStruct = sfDet + sfAtt + u2 + u34 + u59 + u1019 + u20p + mh;
    ctx.pctSfDetached = totalStruct ? +((sfDet / totalStruct) * 100).toFixed(1) : null;
    ctx.pctMultifamily = totalStruct ? +(((u59 + u1019 + u20p) / totalStruct) * 100).toFixed(1) : null;

    // Bedrooms
    var br0 = _safeNum(p.DP04_0039E) || 0;
    var br1 = _safeNum(p.DP04_0040E) || 0;
    var br2 = _safeNum(p.DP04_0041E) || 0;
    var br3 = _safeNum(p.DP04_0042E) || 0;
    var br4 = _safeNum(p.DP04_0043E) || 0;
    var br5 = _safeNum(p.DP04_0044E) || 0;
    ctx.bedroomTotal = br0 + br1 + br2 + br3 + br4 + br5;
    if (ctx.bedroomTotal > 0) {
      ctx.pct3plus = +(((br3 + br4 + br5) / ctx.bedroomTotal) * 100).toFixed(1);
      ctx.pct1bed  = +((br1 / ctx.bedroomTotal) * 100).toFixed(1);
      ctx.pct2bed  = +((br2 / ctx.bedroomTotal) * 100).toFixed(1);
    }

    // Senior / under-18 share (DP05)
    var pop65 = _safeNum(p.DP05_0024E);
    if (pop65 != null && ctx.pop) ctx.pct65plus = +((pop65 / ctx.pop) * 100).toFixed(1);

    // CHAS cost-burden bits
    var renterCb30 = null, renterCb50 = null, ownerCb30 = null;
    var ami30Total = null, ami30Burdened = null;
    var ami50Total = null, ami50Burdened = null;
    var ami80Total = null, ami80Burdened = null;
    var isPlace = ctx.geoType === 'place' || ctx.geoType === 'cdp';
    // F222 — mirror narratives' fallback flag. true = place file used,
    // false = silent county fallback for a selected place, null = county
    // is the selected geog (no fallback to disclose).
    var chasSourceIsPlace = null;
    if (isPlace && window.PlaceChas && typeof window.PlaceChas.lookup === 'function') {
      var place = window.PlaceChas.lookup(ctx.geoid);
      var s = place && place.summary;
      if (s) {
        if (s.renter_cb30_share != null) renterCb30 = s.renter_cb30_share * 100;
        if (s.renter_cb50_share != null) renterCb50 = s.renter_cb50_share * 100;
        if (s.owner_cb30_share  != null) ownerCb30  = s.owner_cb30_share * 100;
        if (renterCb30 != null) chasSourceIsPlace = true; // F222
      }
      var rba = place && place.renter_hh_by_ami;
      if (rba) {
        function _tier(b) {
          if (!b) return null;
          var t = +b.total || null;
          var c = +(b.cost_burdened_30pct != null ? b.cost_burdened_30pct : b.cost_burdened) || null;
          return { total: t, burdened: c };
        }
        var t30 = _tier(rba.lte30);   if (t30) { ami30Total = t30.total; ami30Burdened = t30.burdened; }
        var t50 = _tier(rba['31to50']); if (t50) { ami50Total = t50.total; ami50Burdened = t50.burdened; }
        var t80 = _tier(rba['51to80']); if (t80) { ami80Total = t80.total; ami80Burdened = t80.burdened; }
      }
    }
    if (renterCb30 == null) {
      var fips = (ctx.geoid && ctx.geoid.length === 5) ? ctx.geoid : ctx.contextCounty;
      var rec = ctx.chas && fips ? (ctx.chas.counties || {})[fips] : null;
      if (rec && rec.summary) {
        if (rec.summary.pct_renter_cb30 != null) renterCb30 = rec.summary.pct_renter_cb30 * 100;
        if (rec.summary.pct_renter_cb50 != null) renterCb50 = rec.summary.pct_renter_cb50 * 100;
        if (rec.summary.pct_owner_cb30  != null) ownerCb30  = rec.summary.pct_owner_cb30 * 100;
        if (renterCb30 != null && isPlace) chasSourceIsPlace = false; // F222 — silent fallback
      }
      var crba = rec && rec.renter_hh_by_ami;
      if (crba) {
        var c30 = crba.lte30, c50 = crba['31to50'], c80 = crba['51to80'];
        if (c30) {
          ami30Total = +c30.total || ami30Total;
          ami30Burdened = +(c30.cost_burdened_30pct != null ? c30.cost_burdened_30pct : c30.cost_burdened) || ami30Burdened;
        }
        if (c50) {
          ami50Total = +c50.total || ami50Total;
          ami50Burdened = +(c50.cost_burdened_30pct != null ? c50.cost_burdened_30pct : c50.cost_burdened) || ami50Burdened;
        }
        if (c80) {
          ami80Total = +c80.total || ami80Total;
          ami80Burdened = +(c80.cost_burdened_30pct != null ? c80.cost_burdened_30pct : c80.cost_burdened) || ami80Burdened;
        }
      }
    }
    ctx.renterCb30 = renterCb30;
    ctx.renterCb50 = renterCb50;
    ctx.ownerCb30  = ownerCb30;
    ctx.ami30BurdenPct = (ami30Total && ami30Burdened) ? +((ami30Burdened / ami30Total) * 100).toFixed(1) : null;
    ctx.ami50BurdenPct = (ami50Total && ami50Burdened) ? +((ami50Burdened / ami50Total) * 100).toFixed(1) : null;
    ctx.ami80BurdenPct = (ami80Total && ami80Burdened) ? +((ami80Burdened / ami80Total) * 100).toFixed(1) : null;
    ctx.chasSourceIsPlace = chasSourceIsPlace; // F222

    // Ranking-index — population projection + FHFA HPI 10y
    try {
      var entry = _rankingEntry(ctx.geoid);
      var m = entry && entry.metrics;
      if (m) {
        if (m.population_projection_20yr != null) ctx.pop20yr = +m.population_projection_20yr;
        if (m.fhfa_hpi_change_10y != null)        ctx.hpiChange10y = +m.fhfa_hpi_change_10y;
        if (m.housing_gap_units != null)          ctx.housingGap = +m.housing_gap_units;
        if (m.ami_gap_30pct != null)              ctx.amiGap30 = +m.ami_gap_30pct;
        if (m.ami_gap_50pct != null)              ctx.amiGap50 = +m.ami_gap_50pct;
        if (m.in_commuters != null)               ctx.inCommuters = +m.in_commuters;
        if (m.commute_ratio != null)              ctx.commuteRatio = +m.commute_ratio;
      }
    } catch (_) { /* ranking optional */ }

    return ctx;
  }

  function _rankingEntry(geoid) {
    if (!geoid) return null;
    if (window.HNANarratives && window.HNANarratives._internals
        && window.HNANarratives._internals.rankingEntryFor) {
      return window.HNANarratives._internals.rankingEntryFor(geoid);
    }
    if (window.HNARanking && window.HNARanking._get) {
      var st = window.HNARanking._get();
      if (st && st.allEntries) {
        for (var i = 0; i < st.allEntries.length; i++) {
          if (st.allEntries[i].geoid === geoid) return st.allEntries[i];
        }
      }
    }
    return null;
  }

  // ── Per-section takeaway builders ───────────────────────────────
  // Each returns either an HTML string or null when there's not enough
  // data to say something meaningful. Always lead with the acute finding
  // for THIS jurisdiction; comparators ride along as supporting context.
  var TAKEAWAYS = {
    // Tenure (owner / renter) — F223 renamed key from 'Owner/renter mix'
    // to 'Owner/renter shares' to match the actual h2 text on the page.
    // The old key was dead — it matched no h2.
    'Owner/renter shares': function (c) {
      if (c.pctOwner == null) return null;
      var renterFraming = c.pctRenter >= 50
        ? 'a renter-majority market'
        : c.pctRenter >= 30
          ? 'a meaningful renter base'
          : 'a small renter base in a tight ownership market';
      return '<strong>' + _fmtPct(c.pctOwner) + ' owner-occupied, ' +
        _fmtPct(c.pctRenter) + ' renter-occupied</strong> — ' + renterFraming +
        (c.renterCb30 != null
          ? ', with ' + _fmtPct(c.renterCb30, 0) + ' of renters cost-burdened.'
          : '.');
    },

    // Home value distribution / median home value
    'Home value': function (c) {
      if (c.medianHome == null) return null;
      var caveat = '';
      if (c.hpiChange10y != null && c.hpiChange10y > 0.5) {
        var hpi = (c.hpiChange10y * 100).toFixed(0);
        caveat = ' County-level FHFA HPI shows home prices rose ' + hpi + '% over the last decade, so today\'s market median runs materially above this ACS figure.';
      }
      var incomeNeeded = Math.round(c.medianHome * 0.20);
      var gapClause = '';
      if (c.medianHhInc != null) {
        var diff = incomeNeeded - c.medianHhInc;
        gapClause = diff > 0
          ? ', requiring ' + _fmtMoney(incomeNeeded) + ' in income (about ' + _fmtMoney(Math.abs(diff)) + ' above the local median)'
          : ', within reach of the local median income';
      }
      return '<strong>Median home value ' + _fmtMoney(c.medianHome) + ' (ACS 2020–2024)</strong>' + gapClause + '.' + caveat;
    },

    // Income distribution
    'Household Income': function (c) {
      if (c.medianHhInc == null) return null;
      var amiHook = '';
      if (c.ami30BurdenPct != null && c.ami30BurdenPct >= 60) {
        // F230 — first reference to AMI in the takeaways; gloss inline so a
        // reader who landed on this section without context still understands.
        amiHook = ' Cost burden is highly concentrated at the bottom: ' + _fmtPct(c.ami30BurdenPct, 0) +
          ' of renter households earning ≤30% of Area Median Income (AMI) carry burden.';
      }
      return '<strong>Median household income ' + _fmtMoney(c.medianHhInc) + '.</strong>' + amiHook;
    },

    // Bedroom mix
    'Bedroom Mix': function (c) {
      if (c.pct3plus == null) return null;
      var framing = c.pct3plus >= 50
        ? 'a family-oriented bedroom mix'
        : c.pct3plus >= 35
          ? 'a balanced mix of small and family-sized units'
          : 'a stock that leans small, with limited family-sized units';
      return '<strong>' + framing + '</strong> — ' + _fmtPct(c.pct3plus) +
        ' of units have 3+ bedrooms; ' + _fmtPct(c.pct1bed) + ' are 1-bedroom.';
    },

    // Housing stock structure
    'Housing stock': function (c) {
      if (c.pctSfDetached == null) return null;
      var lead = c.pctSfDetached >= 70
        ? 'a single-family-dominant housing stock'
        : c.pctSfDetached >= 50
          ? 'a housing stock that leans single-family'
          : 'a relatively diversified housing stock';
      return '<strong>' + lead + '</strong> — ' + _fmtPct(c.pctSfDetached) +
        ' single-family detached, ' + _fmtPct(c.pctMultifamily) + ' multifamily 5+ units.';
    },

    // Rent burden distribution (DP04 GRAPI bins)
    'Rent burden distribution': function (c) {
      if (c.renterCb30 == null) return null;
      var leadFraming = c.ami30BurdenPct != null && c.ami30BurdenPct >= 60
        ? 'concentrated stress at the lowest income tier (' + _fmtPct(c.ami30BurdenPct, 0) +
          ' of ≤30% AMI renters carry burden)'
        : (c.renterCb50 != null && c.renterCb50 >= 25
            ? 'a widespread severe-burden problem'
            : 'a renter market where some share carries burden across all income bands');
      return '<strong>' + _fmtPct(c.renterCb30) + ' of renters are cost-burdened</strong>' +
        (c.renterCb50 != null ? ' (' + _fmtPct(c.renterCb50) + ' severely)' : '') +
        ', with ' + leadFraming + '.';
    },

    // Cost burden by AMI tier (HUD CHAS)
    'Cost burden by AMI tier': function (c) {
      if (c.ami30BurdenPct == null) return null;
      var lines = [];
      lines.push('<strong>' + _fmtPct(c.ami30BurdenPct, 0) + ' of ≤30% AMI households are cost-burdened</strong>');
      if (c.ami50BurdenPct != null) lines.push(_fmtPct(c.ami50BurdenPct, 0) + ' at 30–50% AMI');
      if (c.ami80BurdenPct != null) lines.push(_fmtPct(c.ami80BurdenPct, 0) + ' at 50–80% AMI');
      var trail = lines.length > 1
        ? ', falling to ' + lines.slice(1).join(' and ')
        : '';
      return lines[0] + trail + ' — affordability stress concentrates sharply at the lowest income tiers.';
    },

    // 20-year outlook / population projection
    '20-year outlook': function (c) {
      if (c.pop == null || c.pop20yr == null) return null;
      var hh = c.avgHhSize || 2.45;
      var deltaPop = c.pop20yr - c.pop;
      var deltaHh = Math.round(deltaPop / hh);
      var pctG = ((deltaPop / c.pop) * 100).toFixed(1);
      var direction = deltaPop > 0 ? 'growth' : 'contraction';
      var pressure = deltaPop > 0 && c.pctSfDetached != null && c.pctSfDetached >= 70
        ? ' Filling that demand on the current single-family-dominant stock would require either density shift or sustained infill.'
        : '';
      return '<strong>Projected to ' + (deltaPop > 0 ? 'add ' : 'lose ') +
        _fmtInt(Math.abs(deltaPop)) + ' residents (' + pctG + '% ' + direction + ')</strong> ' +
        'over 20 years — about ' + _fmtInt(Math.abs(deltaHh)) +
        ' ' + (deltaPop > 0 ? 'new' : 'fewer') + ' households at current household size.' + pressure;
    },

    // Senior growth pressure
    'Senior growth': function (c) {
      if (c.pct65plus == null) return null;
      var framing = c.pct65plus >= 25
        ? 'a fast-aging community where senior housing demand is already a structural pressure'
        : c.pct65plus >= 18
          ? 'an above-average senior share that compounds senior housing demand over time'
          : 'a relatively young community where senior housing demand will grow but isn\'t the dominant pressure yet';
      return '<strong>' + _fmtPct(c.pct65plus) + ' of residents are 65+</strong> — ' + framing + '.';
    },

    // Age of housing stock (year-built distribution)
    'Age of Housing Stock': function (c) {
      var p = c.profile || {};
      var pre1960 = (_safeNum(p.DP04_0023E)||0) + (_safeNum(p.DP04_0024E)||0)
                  + (_safeNum(p.DP04_0025E)||0) + (_safeNum(p.DP04_0026E)||0);
      var post2010 = (_safeNum(p.DP04_0017E)||0) + (_safeNum(p.DP04_0018E)||0);
      var totalAge = pre1960 + post2010
                   + (_safeNum(p.DP04_0019E)||0) + (_safeNum(p.DP04_0020E)||0)
                   + (_safeNum(p.DP04_0021E)||0) + (_safeNum(p.DP04_0022E)||0);
      if (!totalAge) return null;
      var pctPre1960 = (pre1960 / totalAge) * 100;
      var pctPost2010 = (post2010 / totalAge) * 100;
      var framing = pctPre1960 >= 30
        ? 'an older stock with notable pre-1960 inventory'
        : pctPost2010 >= 30
          ? 'a relatively young stock with substantial post-2010 construction'
          : 'a stock built mostly during the mid-to-late 20th century';
      return '<strong>' + framing + '</strong> — ' + _fmtPct(pctPre1960) + ' of units pre-date 1960; ' +
        _fmtPct(pctPost2010) + ' were built since 2010.';
    },

    // AMI gap / Housing need summary
    'Housing need summary': function (c) {
      if (c.amiGap30 == null && c.amiGap50 == null) return null;
      var parts = [];
      if (c.amiGap30 != null) parts.push(_fmtInt(c.amiGap30) + ' units short at ≤30% AMI');
      if (c.amiGap50 != null) parts.push(_fmtInt(c.amiGap50) + ' at ≤50%');
      return '<strong>Documented affordability gap: ' + parts.join(', ') + '.</strong> ' +
        'These are the unit counts a project, voucher allocation, or preservation deal would size against.';
    },

    // F223 — Owner Housing Cost Burden (matches h2 "Owner Housing Cost Burden").
    // The renter side gets two takeaways via "Rent burden distribution" + "Cost
    // burden by AMI tier"; the owner side previously had none.
    'Owner Housing Cost Burden': function (c) {
      if (c.ownerCb30 == null) return null;
      var framing = c.ownerCb30 >= 35
        ? 'a heavy homeowner cost-burden load'
        : c.ownerCb30 >= 25
          ? 'a meaningful homeowner cost-burden load'
          : 'a relatively contained homeowner cost-burden picture';
      return '<strong>' + _fmtPct(c.ownerCb30) + ' of homeowners spend ≥30% of income on housing</strong> — ' +
        framing + '. Driven by mortgage + taxes + insurance + utilities — preservation programs and ' +
        'property-tax relief move this number more than new construction does.';
    },

    // F223 — Homeownership affordability (matches h2 "Homeownership affordability").
    // Same input as 'Home value' but framed around the buyer-affordability gap
    // rather than the value distribution. Both can fire on the same page when
    // the h2s are distinct, but only one per chart-card (idempotence guard).
    'Homeownership affordability': function (c) {
      if (c.medianHome == null || c.medianHhInc == null) return null;
      // 20% down / 30-yr / ~7% / PITI rule of thumb — income to afford = home value * 0.20
      // (rough proxy; matches the figure shown in the section)
      var incomeNeeded = Math.round(c.medianHome * 0.20);
      var ratio = (incomeNeeded / c.medianHhInc);
      var gap = incomeNeeded - c.medianHhInc;
      var framing = ratio >= 1.5
        ? 'sharply out of reach at the local median'
        : ratio >= 1.15
          ? 'meaningfully out of reach at the local median'
          : ratio >= 0.9
            ? 'within reach but tight for median earners'
            : 'attainable for median earners';
      var gapClause = gap > 0
        ? ' — about ' + _fmtMoney(Math.abs(gap)) + ' above the local median household income of ' + _fmtMoney(c.medianHhInc)
        : ' — comfortably below the local median household income of ' + _fmtMoney(c.medianHhInc);
      return '<strong>Buying at the median requires ~' + _fmtMoney(incomeNeeded) + ' in income</strong>' +
        gapClause + '. That gap is ' + framing + '.';
    },

    // F223 — Housing Gap & Affordability Analysis (matches that h2). The
    // 'Housing need summary' key already uses amiGap30/50 from the ranking
    // index; this key uses the total housing gap (units short across all
    // tiers) when that field is populated. Different framing — total scale
    // vs the per-tier breakdown above it.
    'Housing Gap': function (c) {
      if (c.housingGap == null && c.amiGap30 == null) return null;
      if (c.housingGap != null) {
        var hh = c.avgHhSize || 2.45;
        var ppl = Math.round(c.housingGap * hh);
        return '<strong>Documented housing gap: ' + _fmtInt(c.housingGap) +
          ' units short</strong> — roughly ' + _fmtInt(ppl) + ' residents at current ' +
          'household size. This is the floor a credible production target sizes against.';
      }
      // Fall back to AMI-tier gap if total isn't published.
      return '<strong>' + _fmtInt(c.amiGap30) + ' units short at ≤30% AMI</strong> — the deepest-need ' +
        'tier where LIHTC + project-based vouchers carry the most weight.';
    },
  };

  // ── Match an h2 to a takeaway key ───────────────────────────────
  // Prefer the longest matching key. F211's matcher returned the first
  // hit, which caused "Age of Housing Stock" to incorrectly bind to
  // the shorter "Housing stock" key. Scoring by key length resolves
  // that without expanding the match surface.
  function _matchKey(h2) {
    var id = (h2.id || '').toLowerCase();
    var text = (h2.textContent || '').toLowerCase();
    var best = null;
    for (var key in TAKEAWAYS) {
      if (!Object.prototype.hasOwnProperty.call(TAKEAWAYS, key)) continue;
      var k = key.toLowerCase();
      var hit = false;
      if (id === k) hit = true;
      else if (id && id.indexOf(k) !== -1) hit = true;
      else if (text && text.indexOf(k) !== -1) hit = true;
      if (hit && (!best || k.length > best.length)) {
        best = { key: key, length: k.length };
      }
    }
    return best ? best.key : null;
  }

  // ── Inject ──────────────────────────────────────────────────────
  function _injectAll() {
    var ctx = _gatherCtx();
    if (!ctx) return 0;
    var nodes = document.querySelectorAll('main h2');
    var injected = 0;
    for (var i = 0; i < nodes.length; i++) {
      var h2 = nodes[i];
      var card = h2.closest('.chart-card');
      if (!card) continue;
      if (card.querySelector('.hna-section-takeaway')) continue; // idempotent
      var key = _matchKey(h2);
      if (!key) continue;
      var builder = TAKEAWAYS[key];
      var html;
      try { html = builder(ctx); } catch (_) { html = null; }
      if (!html) continue;
      var aside = document.createElement('aside');
      aside.className = 'hna-section-takeaway';
      aside.setAttribute('role', 'note');
      aside.style.cssText =
        'margin:.4rem 0 .7rem;padding:.55rem .8rem;border-left:3px solid var(--accent);' +
        'background:color-mix(in oklab,var(--accent) 6%,var(--card) 94%);' +
        'border-radius:0 6px 6px 0;font-size:.9rem;line-height:1.5';
      aside.innerHTML = '<span style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;display:block;margin-bottom:.2rem">For this jurisdiction</span>' + html;
      // Insert after the existing intro <p> when present; otherwise right after the h2.
      var intro = card.querySelector('h2 + p');
      if (intro && intro.parentNode) {
        intro.parentNode.insertBefore(aside, intro.nextSibling);
      } else {
        h2.parentNode.insertBefore(aside, h2.nextSibling);
      }
      injected++;
    }
    return injected;
  }

  // F226 — Robust auto-fire. The previous 0/750/2500ms schedule missed
  // on slow connections (mobile, throttled, or just slow data fetch):
  // _gatherCtx() returns null until the ranking-index + ACS profile are
  // populated, and on a cold load those can take 3-8 seconds. After the
  // 2500ms fire missed, no more attempts ran — page loaded with zero
  // takeaways even though manually calling inject() returned 14.
  //
  // Strategy:
  //   1. Run inject() immediately + at 0.75/2.5/5/10s as escalating
  //      retries that cover ~95% of load conditions.
  //   2. After the last retry, install a MutationObserver that watches
  //      <main> for chart-cards being added (the scenario projections
  //      panel, special-needs panel, and post-CHAS-load injections all
  //      mutate main). When new cards arrive, run inject() again.
  //   3. Once any inject returns ≥10 (the "happy path" threshold —
  //      we have 14 keys, so >=10 means data + DOM are both ready),
  //      stop scheduling retries. The MutationObserver still runs for
  //      dynamically added sections.
  var _injectAttempts = 0;
  var _maxInjected = 0;
  var _observer = null;
  function _tryInject() {
    var n = _injectAll();
    _injectAttempts++;
    if (n > _maxInjected) _maxInjected = n;
    return n;
  }
  function _installObserver() {
    if (_observer || typeof MutationObserver === 'undefined') return;
    var main = document.querySelector('main');
    if (!main) return;
    var pending = false;
    _observer = new MutationObserver(function () {
      // Debounce — mutations come in bursts; one debounced run covers them.
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; _tryInject(); }, 200);
    });
    _observer.observe(main, { childList: true, subtree: true });
  }
  function _init() {
    _tryInject();
    setTimeout(_tryInject, 750);
    setTimeout(_tryInject, 2500);
    // F226 — extended retries for slow loads + observer install.
    setTimeout(function () {
      if (_maxInjected < 10) _tryInject();
      _installObserver();
    }, 5000);
    setTimeout(function () { if (_maxInjected < 10) _tryInject(); }, 10000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Expose so the HNA controller can re-run after data updates.
  window.HnaSectionTakeaways = { inject: _injectAll, takeaways: TAKEAWAYS, gatherCtx: _gatherCtx };
})();
