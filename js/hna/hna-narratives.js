/**
 * hna-narratives.js
 * Responsibility: Narrative text builders and copy generation.
 * Dependencies: window.HNAUtils, window.HNAState, window.PlaceChas (optional)
 * Exposes: window.HNANarratives
 *
 * F215 — Executive-summary narrative. Replaces the single placeholder
 * paragraph at the top of the HNA with a 4-paragraph data-derived
 * narrative built from values already in the loaded profile, CHAS,
 * and ranking-index. Mirrors the structure professional HNAs
 * (Points Consulting, Root Policy Research) use to lead each
 * jurisdiction-level report:
 *   1. Where this jurisdiction sits + headline cost-burden framing
 *   2. Deep-need concentration vs broad distribution
 *   3. Income / rent / home-value math at the 30%-rule line
 *   4. 20-year projection + supply implications
 *
 * Template-driven, not free-form. Variables flow from data; the
 * phrasing is a small library of pre-written sentence pieces so
 * every jurisdiction reads consistently and stays data-correct on
 * the next CHAS/ACS refresh.
 */
(function () {
  'use strict';

  // ── Comparator constants ─────────────────────────────────────────
  // CO/US renter burden anchors. CO from HUD CHAS 2018–2022 state row
  // (verified at data/hna/chas_affordability_gap.json.state.summary).
  // US from ACS 2023 5-year B25070 published estimate. These shift
  // slowly enough that a quarterly refresh is sufficient.
  var CO_RENTER_CB30 = 47.2;  // %
  var CO_RENTER_CB50 = 23.4;  // %
  var US_RENTER_CB30 = 46.9;  // %

  // ── Light HTML escape ─────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _fmtMoney(n) {
    if (n == null || !isFinite(n)) return null;
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function _fmtInt(n) {
    if (n == null || !isFinite(n)) return null;
    return Math.round(n).toLocaleString('en-US');
  }
  function _fmtPct(n, digits) {
    if (n == null || !isFinite(n)) return null;
    return n.toFixed(digits != null ? digits : 1) + '%';
  }

  // ── Data assembly ─────────────────────────────────────────────────
  // Pulls every field the four paragraphs need from the already-loaded
  // profile + CHAS + (optional) ranking-index. Returns null when there's
  // not enough data to build anything useful.
  function _gatherContext(profile, label) {
    if (!profile) return null;
    var safeNum = window.HNAUtils && window.HNAUtils.safeNum
      ? window.HNAUtils.safeNum
      : function (v) { var n = Number(v); return Number.isFinite(n) ? n : null; };

    var ctx = {
      label: label || profile.NAME || 'this jurisdiction',
      geoType: profile._geoType || null,
      geoid: profile._geoid || null,
      // ACS core
      pop: safeNum(profile.DP05_0001E),
      medianRent: safeNum(profile.DP04_0134E),
      medianHomeVal: safeNum(profile.DP04_0089E),
      medianIncome: safeNum(profile.DP03_0062E),
      avgHhSize: safeNum(profile.DP02_0016E),
      pctRenter: safeNum(profile.DP04_0047PE),
      pctSfDetached: null,
      pctMultifamily: null,
    };

    // Structure-type share — DP04_0007E (SF det) / sum of structure units
    var sfDet = safeNum(profile.DP04_0007E) || 0;
    var sfAtt = safeNum(profile.DP04_0008E) || 0;
    var u5to9 = safeNum(profile.DP04_0011E) || 0;
    var u10to19 = safeNum(profile.DP04_0012E) || 0;
    var u20plus = safeNum(profile.DP04_0013E) || 0;
    var structTotal = sfDet + sfAtt + (safeNum(profile.DP04_0009E) || 0)
                    + (safeNum(profile.DP04_0010E) || 0)
                    + u5to9 + u10to19 + u20plus
                    + (safeNum(profile.DP04_0014E) || 0);
    if (structTotal > 0) {
      ctx.pctSfDetached = +((sfDet / structTotal) * 100).toFixed(1);
      ctx.pctMultifamily = +(((u5to9 + u10to19 + u20plus) / structTotal) * 100).toFixed(1);
    }

    // CHAS — pull renter cb30 + cb50 from place-CHAS (preferred for
    // place/cdp) or county-CHAS fallback. Same priority chain the
    // burden charts use.
    var renterCb30 = null, renterCb50 = null, ownerCb30 = null;
    var ami30Total = null, ami30Burdened = null;  // for "deep-need" framing
    var isPlace = ctx.geoType === 'place' || ctx.geoType === 'cdp';
    var contextCounty = null;
    // F222 — track whether burden figures came from place-CHAS (true) or
    // were silently sourced from the parent county (false). null for
    // counties (the selected geog IS the county; not a fallback). Drives
    // the disclosure note in _renderDisclosure() below.
    var chasSourceIsPlace = null;
    var chasFallbackCountyName = null;

    try {
      var state = window.HNAState && window.HNAState.state;
      contextCounty = (state && state.contextCounty) || null;

      if (isPlace && window.PlaceChas && typeof window.PlaceChas.lookup === 'function') {
        var place = window.PlaceChas.lookup(ctx.geoid);
        if (place && place.summary) {
          if (place.summary.renter_cb30_share != null) renterCb30 = +place.summary.renter_cb30_share * 100;
          if (place.summary.renter_cb50_share != null) renterCb50 = +place.summary.renter_cb50_share * 100;
          if (place.summary.owner_cb30_share  != null) ownerCb30  = +place.summary.owner_cb30_share  * 100;
          if (renterCb30 != null) chasSourceIsPlace = true; // F222
        }
        // Deep-need: <=30% AMI tier burden share
        var rba = place && place.renter_hh_by_ami;
        if (rba && rba.lte30) {
          ami30Total = +rba.lte30.total || null;
          var cb30Field = rba.lte30.cost_burdened_30pct != null
            ? rba.lte30.cost_burdened_30pct
            : rba.lte30.cost_burdened;
          ami30Burdened = +cb30Field || null;
        }
      }

      // County fallback
      if (renterCb30 == null) {
        var chas = state && state.chasData;
        var fips = (ctx.geoid && ctx.geoid.length === 5)
          ? ctx.geoid
          : contextCounty;
        var countyRec = chas && fips ? (chas.counties || {})[fips] : null;
        if (countyRec && countyRec.summary) {
          if (countyRec.summary.pct_renter_cb30 != null) renterCb30 = +countyRec.summary.pct_renter_cb30 * 100;
          if (countyRec.summary.pct_renter_cb50 != null) renterCb50 = +countyRec.summary.pct_renter_cb50 * 100;
          if (countyRec.summary.pct_owner_cb30  != null) ownerCb30  = +countyRec.summary.pct_owner_cb30  * 100;
          // F222 — record the fallback. Only flag for a real fallback
          // (place was the selected geog, county data filled the gap);
          // for a county-selected geog, chasSourceIsPlace stays null.
          if (renterCb30 != null && isPlace) {
            chasSourceIsPlace = false;
            try {
              var countyEntry = _rankingEntryFor(fips);
              if (countyEntry && countyEntry.name) chasFallbackCountyName = countyEntry.name;
            } catch (_) { /* best-effort */ }
          }
        }
        var crba = countyRec && countyRec.renter_hh_by_ami;
        if (crba && crba.lte30 && ami30Total == null) {
          ami30Total = +crba.lte30.total || null;
          var cb30FieldC = crba.lte30.cost_burdened_30pct != null
            ? crba.lte30.cost_burdened_30pct
            : crba.lte30.cost_burdened;
          ami30Burdened = +cb30FieldC || null;
        }
      }
    } catch (_) { /* CHAS optional */ }

    ctx.renterCb30 = renterCb30;
    ctx.renterCb50 = renterCb50;
    ctx.ownerCb30  = ownerCb30;
    ctx.ami30BurdenPct = (ami30Total && ami30Burdened && ami30Total > 0)
      ? +((ami30Burdened / ami30Total) * 100).toFixed(1)
      : null;
    ctx.chasSourceIsPlace = chasSourceIsPlace;        // F222
    ctx.chasFallbackCountyName = chasFallbackCountyName; // F222

    // FHFA HPI 10-yr change + 20-yr projection from the ranking-index cache
    ctx.hpiChange10y = null;
    ctx.pop20yr = null;
    ctx.containingCountyName = null;
    try {
      var entry = _rankingEntryFor(ctx.geoid);
      if (entry && entry.metrics) {
        if (entry.metrics.population_projection_20yr != null) ctx.pop20yr = +entry.metrics.population_projection_20yr;
        if (entry.metrics.fhfa_hpi_change_10y != null)        ctx.hpiChange10y = +entry.metrics.fhfa_hpi_change_10y;
        if (entry.containingCounty)                            ctx.containingCountyFips = entry.containingCounty;
      }
      if (ctx.containingCountyFips) {
        var countyEntry = _rankingEntryFor(ctx.containingCountyFips);
        if (countyEntry && countyEntry.name) ctx.containingCountyName = countyEntry.name;
        if (countyEntry && countyEntry.metrics && ctx.hpiChange10y == null
            && countyEntry.metrics.fhfa_hpi_change_10y != null) {
          ctx.hpiChange10y = +countyEntry.metrics.fhfa_hpi_change_10y;
        }
      }
    } catch (_) { /* ranking-index optional */ }

    return ctx;
  }

  // ── Ranking-index cache ──────────────────────────────────────────
  // Same pattern as F210 (hna-export.js): eagerly fetch ranking-index
  // at module init, cache as geoid→entry. Two-second window is plenty
  // since users have to pick a jurisdiction before the narrative runs.
  var _rankingCache = null;
  var _rankingPromise = null;
  function _loadRanking() {
    if (_rankingCache || _rankingPromise) return _rankingPromise;
    _rankingPromise = fetch('data/hna/ranking-index.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return null;
        var rows = Array.isArray(j.rankings) ? j.rankings
                  : (j.rankings && typeof j.rankings === 'object' ? Object.values(j.rankings) : []);
        var map = Object.create(null);
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i]; if (r && r.geoid) map[r.geoid] = r;
        }
        _rankingCache = map;
        return map;
      })
      .catch(function () { return null; });
    return _rankingPromise;
  }
  function _rankingEntryFor(geoid) {
    if (!geoid) return null;
    if (window.HNARanking && window.HNARanking._get) {
      var st = window.HNARanking._get();
      if (st && st.allEntries) {
        for (var i = 0; i < st.allEntries.length; i++) {
          if (st.allEntries[i].geoid === geoid) return st.allEntries[i];
        }
      }
    }
    return _rankingCache ? _rankingCache[geoid] : null;
  }
  try { _loadRanking(); } catch (_) { /* non-fatal */ }

  // ── Phrasing helpers ─────────────────────────────────────────────
  function _sizeBand(pop) {
    if (pop == null) return null;
    if (pop <  1500)  return 'small';
    if (pop <  5000)  return 'small-to-mid-sized';
    if (pop < 25000)  return 'mid-sized';
    if (pop < 75000)  return 'mid-to-large';
    return 'large';
  }
  // Strip the parenthetical suffix the geo-config labels carry
  // ("Fruita (city)" → "Fruita"). Keeps the narrative voice clean.
  function _stripSuffix(label) {
    return String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || label || '';
  }
  // 'a / an' agreement for the percentage growth phrase. Reads the
  // leading digit of the displayed string (not the rounded value) so
  // "8.9%" picks up vowel-sound "an" instead of being rounded to "9"
  // and falling back to "a". 8, 11, 18, 80–89 + 11xx are vowel-sound.
  function _aOrAn(numStr) {
    if (numStr == null) return 'a';
    var s = String(numStr).replace(/^[\s$+-]*/, '');  // strip leading whitespace / signs
    return /^(8|11|18)/.test(s) ? 'an' : 'a';
  }
  function _juris(geoType, label) {
    if (geoType === 'county') return 'county';
    if (geoType === 'cdp')    return 'CDP (unincorporated community)';
    if (geoType === 'place') {
      var l = (label || '').toLowerCase();
      if (l.indexOf('town') !== -1) return 'town';
      if (l.indexOf('city') !== -1) return 'city';
      return 'place';
    }
    return 'jurisdiction';
  }
  function _compareBurden(local, anchor) {
    if (local == null || anchor == null) return { word: 'comparable to', delta: 0 };
    var d = local - anchor;
    if (d <= -10)  return { word: 'well below',  delta: d };
    if (d <= -4)   return { word: 'below',       delta: d };
    if (d <  4)    return { word: 'close to',    delta: d };
    if (d <  10)   return { word: 'above',       delta: d };
    return            { word: 'well above',  delta: d };
  }

  // ── Paragraph builders ──────────────────────────────────────────
  //
  // F215b — Lead with the acute finding, not the comparator.
  //
  // The original paragraph 1 opened with "renter burden X% sits well
  // below Colorado" — which reads like a status report from a place
  // that's solved housing. For most CO jurisdictions, even a sub-CO-
  // average headline rate masks an acute concentration of need at the
  // bottom income tier (Fruita: 98% of ≤30% AMI are cost-burdened
  // while the headline runs 36%). An HNA is supposed to motivate
  // action — burying the deep-need finding inside paragraph 2 made
  // the page read as reassurance instead of evidence.
  //
  // New structure:
  //   Para 1 = jurisdiction + LEAD WITH THE MOST ACUTE SIGNAL
  //   Para 2 = comparator + severe burden + owner side (the context
  //            that frames why the headline rate doesn't tell the
  //            whole story)
  //   Para 3 / 4 = unchanged
  //
  // "Most acute signal" picks (in order): deep-need rate ≥60% →
  // severe renter burden ≥25% → overall burden materially above CO →
  // factual baseline.

  function _pickAcuteLead(ctx) {
    if (ctx.ami30BurdenPct != null && ctx.ami30BurdenPct >= 60) {
      var rate = _fmtPct(ctx.ami30BurdenPct, 0);
      var framing = ctx.ami30BurdenPct >= 85
        ? 'Nearly all of the lowest-income renters carry cost burden'
        : ctx.ami30BurdenPct >= 70
          ? 'The lowest-income renters bear the deepest burden'
          : 'The affordability stress is sharpest at the bottom of the income distribution';
      return '<strong>' + framing + ' — ' + rate +
        ' of renter households earning ≤30% AMI are cost-burdened</strong>, ' +
        'a workforce-housing pattern that headline averages tend to obscure.';
    }
    if (ctx.renterCb50 != null && ctx.renterCb50 >= 25) {
      return '<strong>Severe renter cost burden is widespread — ' + _fmtPct(ctx.renterCb50) +
        ' of renters pay 50% or more of their income on rent</strong>, ' +
        'meaning a quarter of the renter base is choosing between housing and other basic needs.';
    }
    if (ctx.renterCb30 != null && ctx.renterCb30 >= CO_RENTER_CB30 + 5) {
      return '<strong>Renter cost burden runs materially above the Colorado average — ' +
        _fmtPct(ctx.renterCb30) + ' vs ' + _fmtPct(CO_RENTER_CB30) + ' statewide</strong>, ' +
        'a sign the local market has tightened faster than wages have moved.';
    }
    if (ctx.renterCb30 != null) {
      return 'Renter cost burden sits at ' + _fmtPct(ctx.renterCb30) +
        ' overall — close to the Colorado average (' + _fmtPct(CO_RENTER_CB30) + '), ' +
        'though that headline can mask sharper stress at the lowest income tiers.';
    }
    return null;
  }

  function _para1Headline(ctx) {
    var size = _sizeBand(ctx.pop);
    var juris = _juris(ctx.geoType, ctx.label);
    var countyClause = (ctx.containingCountyName && ctx.geoType !== 'county')
      ? ' in ' + _esc(ctx.containingCountyName)
      : '';
    var popClause = ctx.pop != null ? ' (pop. ' + _fmtInt(ctx.pop) + ')' : '';
    var sizeWord = size ? size + ' ' : '';
    var lead = _pickAcuteLead(ctx);
    if (!lead) return null;
    return '<p><strong>' + _esc(_stripSuffix(ctx.label)) + ' is a ' + sizeWord + juris +
           countyClause + popClause + '.</strong> ' + lead + '</p>';
  }

  function _para2DeepNeed(ctx) {
    // Now serves as the "context" paragraph that frames the headline
    // rate + adds the severe + owner-side dimensions. Reframes the
    // comparator without making it the headline.
    var lines = [];
    if (ctx.renterCb30 != null) {
      var cmpCo = _compareBurden(ctx.renterCb30, CO_RENTER_CB30);
      var cmpUs = _compareBurden(ctx.renterCb30, US_RENTER_CB30);
      // Phrase comparators as context, not as accomplishment.
      var coFrag, usFrag;
      if (cmpCo.delta < -4)      coFrag = 'lower than the Colorado average';
      else if (cmpCo.delta > 4)  coFrag = 'higher than the Colorado average';
      else                       coFrag = 'in line with the Colorado average';
      if (cmpUs.delta < -4)      usFrag = 'and lower than the U.S. average';
      else if (cmpUs.delta > 4)  usFrag = 'and higher than the U.S. average';
      else                       usFrag = 'and in line with the U.S. average';
      var suffix = ctx.ami30BurdenPct != null && ctx.ami30BurdenPct >= 60
        ? ' — but as the lead finding shows, that headline obscures the concentration of stress at the lowest income band.'
        : ', though averages can hide concentrated need at lower income bands.';
      lines.push('Overall renter burden runs at ' + _fmtPct(ctx.renterCb30) +
        ', ' + coFrag + ' (' + _fmtPct(CO_RENTER_CB30) + ') ' +
        usFrag + ' (' + _fmtPct(US_RENTER_CB30) + ')' + suffix);
    }
    if (ctx.renterCb50 != null) {
      // Only add the severe row when the LEAD wasn't the severe-burden
      // framing (otherwise we'd repeat ourselves).
      var ledWithSevere = ctx.ami30BurdenPct == null || ctx.ami30BurdenPct < 60;
      if (!ledWithSevere || ctx.renterCb50 < 25) {
        lines.push(
          'Severe renter burden (paying ≥50% of income on rent) runs at ' +
          _fmtPct(ctx.renterCb50) + ' locally vs ' + _fmtPct(CO_RENTER_CB50) + ' statewide.'
        );
      }
    }
    if (ctx.ownerCb30 != null) {
      lines.push(
        'On the owner side, ' + _fmtPct(ctx.ownerCb30) +
        ' of homeowners spend at least 30% of income on housing costs (mortgage + tax + insurance + utilities).'
      );
    }
    if (!lines.length) return null;
    return '<p>' + lines.join(' ') + '</p>';
  }

  function _para3IncomeMath(ctx) {
    var parts = [];
    if (ctx.medianRent != null) {
      var incomeNeededRent = Math.round(ctx.medianRent * 12 / 0.30);
      var rentVsIncome = '';
      if (ctx.medianIncome != null && incomeNeededRent != null) {
        var diff = ctx.medianIncome - incomeNeededRent;
        if (diff > 0) rentVsIncome = ' — below the local median household income of ' + _fmtMoney(ctx.medianIncome) + '.';
        else          rentVsIncome = ' — above the local median household income of ' + _fmtMoney(ctx.medianIncome) +
                                     ', a ' + _fmtMoney(Math.abs(diff)) + ' gap.';
      }
      parts.push(
        '<strong>Median rent ' + _fmtMoney(ctx.medianRent) + '/month</strong> requires an annual household income of ' +
        _fmtMoney(incomeNeededRent) + ' to stay under the 30% rule' + rentVsIncome
      );
    }
    if (ctx.medianHomeVal != null) {
      // Mortgage rule of thumb: 30-yr fixed at ~7%, 20% down, taxes+ins ~28% of PITI.
      // Income needed ≈ home value × 0.20 (~payment per $100K) / 0.30. Keep simple.
      var incomeNeededHome = Math.round(ctx.medianHomeVal * 0.20);
      var homeClause = '';
      if (ctx.medianIncome != null) {
        var diff2 = incomeNeededHome - ctx.medianIncome;
        homeClause = diff2 > 0
          ? ', roughly ' + _fmtMoney(diff2) + ' above the local median.'
          : ', within reach of the local median.';
      } else {
        homeClause = '.';
      }
      parts.push(
        '<strong>Median home value ' + _fmtMoney(ctx.medianHomeVal) + ' (ACS 2020–2024)</strong> ' +
        'requires roughly ' + _fmtMoney(incomeNeededHome) + ' in income to afford the mortgage at current rates' +
        homeClause
      );
    }
    // FHFA caveat — the ACS 2020-2024 home value lags the live market.
    // When 10-year HPI change > 50%, surface it as a stale-vintage warning.
    if (ctx.hpiChange10y != null && ctx.hpiChange10y > 0.5 && ctx.medianHomeVal != null) {
      var hpiPct = (ctx.hpiChange10y * 100).toFixed(0);
      parts.push(
        '<em>Caveat:</em> ACS lags the live market by 2–3 years; FHFA reports county-level home prices ' +
        'rose ' + hpiPct + '% over the past decade, so the current market median is materially above the ACS figure.'
      );
    }
    if (!parts.length) return null;
    return '<p>' + parts.join(' ') + '</p>';
  }

  function _para4Forward(ctx) {
    if (ctx.pop == null && ctx.pop20yr == null) return null;
    var parts = [];
    if (ctx.pop != null && ctx.pop20yr != null && ctx.avgHhSize) {
      var deltaPop = ctx.pop20yr - ctx.pop;
      var deltaHh = Math.round(deltaPop / ctx.avgHhSize);
      var pctGrowth = ((deltaPop / ctx.pop) * 100).toFixed(1);
      var direction = deltaPop > 0 ? 'growth' : 'contraction';
      parts.push(
        '<strong>20-year population projection of ' + _fmtInt(ctx.pop20yr) + '</strong> implies ' +
        (deltaPop > 0 ? 'roughly ' : 'a net loss of ~') + _fmtInt(Math.abs(deltaHh)) + ' ' +
        (deltaPop > 0 ? 'new' : 'fewer') + ' households at current average household size (' + ctx.avgHhSize.toFixed(2) + '), ' +
        _aOrAn(pctGrowth) + ' ' + pctGrowth + '% ' + direction + ' from today.'
      );
    }
    if (ctx.pctSfDetached != null && ctx.pctMultifamily != null) {
      // Sentence templates differ per dominance tier so verb agreement
      // stays clean (no "is leans single-family" combos).
      var dominanceSentence = ctx.pctSfDetached >= 70
        ? 'Local housing stock is single-family-dominant'
        : ctx.pctSfDetached >= 50
          ? 'Local housing stock leans single-family'
          : 'Local housing stock is relatively diversified';
      parts.push(
        dominanceSentence + ' (' + _fmtPct(ctx.pctSfDetached) +
        ' single-family detached, ' + _fmtPct(ctx.pctMultifamily) + ' multifamily 5+ units), ' +
        'so meeting projected demand without density shift or infill is mechanically constrained.'
      );
    }
    if (!parts.length) return null;
    return '<p>' + parts.join(' ') + '</p>';
  }

  // F222 — Disclose when CHAS burden figures came from a county
  // fallback rather than the selected place. The renter_cb*/owner_cb*
  // and AMI-tier rates that drive the rest of the narrative are
  // structurally county-sourced in that case; render a one-line
  // italicized note so the reader doesn't read place-level commentary
  // off county-level figures.
  function _renderDisclosure(ctx) {
    if (ctx.chasSourceIsPlace !== false) return null; // null OR true → no note
    var county;
    if (ctx.chasFallbackCountyName) {
      // Ranking-index names already include "County" (e.g., "Garfield County"),
      // so don't double-append. Other shapes like "Garfield" need the suffix.
      var raw = ctx.chasFallbackCountyName;
      county = /county\s*$/i.test(raw) ? _esc(raw) : _esc(raw) + ' County';
    } else {
      county = 'the parent county';
    }
    return '<p class="hna-narrative-disclosure" style="font-size:.85em;color:var(--muted);font-style:italic;margin:.25rem 0 .75rem">' +
      '<strong>Note:</strong> Place-level cost-burden data is unavailable for ' +
      _esc(_stripSuffix(ctx.label)) + '; burden figures below reference ' + county +
      ' (HUD CHAS does not publish for sub-county geographies under reliability thresholds).' +
      '</p>';
  }

  // ── Public ───────────────────────────────────────────────────────
  function buildExecutiveSummary(profile, label) {
    var ctx = _gatherContext(profile, label);
    if (!ctx) return null;
    var paras = [
      _renderDisclosure(ctx), // F222 — top of narrative, before headline
      _para1Headline(ctx),
      _para2DeepNeed(ctx),
      _para3IncomeMath(ctx),
      _para4Forward(ctx),
    ].filter(Boolean);
    if (!paras.length) return null;
    // Wrap so callers can innerHTML directly. Marker class lets CSS
    // style the templated narrative distinctly from the generic
    // placeholder text it replaces.
    return '<div class="hna-narrative-html">' + paras.join('') + '</div>';
  }

  window.HNANarratives = {
    buildExecutiveSummary: buildExecutiveSummary,
    // F215 — also expose context + ranking cache for debug/testing.
    _internals: { gatherContext: _gatherContext, loadRanking: _loadRanking, rankingEntryFor: _rankingEntryFor },
    // Legacy passthroughs (preserved from earlier stub) — keep so any
    // code that imported window.HNANarratives.* didn't break.
    lihtcSourceInfo: function(source) { return window.HNAUtils && window.HNAUtils.lihtcSourceInfo ? window.HNAUtils.lihtcSourceInfo(source) : null; },
    lihtcPopupHtml: function(p, source) { return window.HNAUtils && window.HNAUtils.lihtcPopupHtml ? window.HNAUtils.lihtcPopupHtml(p, source) : null; },
    generateComplianceReport: function(rows) { return window.HNAUtils && window.HNAUtils.generateComplianceReport ? window.HNAUtils.generateComplianceReport(rows) : null; },
  };
})();
