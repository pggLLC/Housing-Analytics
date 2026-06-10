/* F207a — CHAS rent-burden reliability module.
 *
 * Public API exposed as window.RentBurdenReliability. Reads the static
 * crosscheck file produced by scripts/build_rent_burden_crosscheck.mjs
 * (F207b — not yet built) and computes a confidence score per the
 * spec.
 *
 * Until the crosscheck file lands, this module degrades gracefully —
 * computeReliability() returns { combined: 'insufficient',
 * data_source: 'chas_only', notes: [...] } so consumers can still
 * surface a "CHAS baseline (cross-check pending)" badge without
 * exploding.
 *
 * Per the spec's QA review (Claude 2026-06-09):
 *   - ACS 5-year is the DEFINITIONAL cross-check (same vintage as CHAS)
 *   - ACS 1-year is the FRESHNESS check (the only genuinely newer source)
 *   - Two separate signals; never folded into a single divergence test
 *   - CHR (when v2 lands) is all-tenure, never adjacent to renter rate
 *   - MOE softens divergence flags by one tier when ranges overlap
 *
 * Public API:
 *   await RentBurdenReliability.loadSources()       // → registry
 *   await RentBurdenReliability.loadCrosscheck()    // → crosscheck or null
 *   await RentBurdenReliability.computeReliability({ geoid, geoType, metric })
 *     // → { definitional, freshness, combined, flags[], notes[],
 *     //     chas: {rate, denominator, vintage}, acs5: {...},
 *     //     acs1: {rate, vintage, geography, isProxy, proxyKind, moe},
 *     //     data_source }
 *   RentBurdenReliability.confidenceBadge(reliability, { compact })
 *     // → HTML string for inline use
 */
(function () {
  'use strict';

  // ── Constants from data/metadata/rent_burden_sources.json ──
  // Loaded lazily; default thresholds match the spec's hard-coded
  // recommendations so the module works even before the registry fetch
  // resolves.
  var DEFAULT_THRESHOLDS = {
    definitional: { consistent: 5, moderate: 10 },
    freshness:    { stable: 5,     moderate: 10 },
    moe:          { high_ratio: 0.30 },
    small_denom:  100,
  };

  var _registryCache = null;
  function loadSources() {
    if (_registryCache) return _registryCache;
    _registryCache = fetch('data/metadata/rent_burden_sources.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return _registryCache;
  }

  var _crosscheckCache = null;
  function loadCrosscheck() {
    if (_crosscheckCache) return _crosscheckCache;
    _crosscheckCache = fetch('data/processed/rent_burden_crosscheck.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return _crosscheckCache;
  }

  // ── Math helpers ──

  // Difference in percentage points. Rates are 0–1 fractions; result
  // is in 0–100 pp space.
  function _pp(a, b) {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
    return Math.abs(a - b) * 100;
  }

  // Compute proportion MOE per Census recommendation.
  // p   = numerator / denom (subset relationship, so numerator ⊆ denom)
  // moe_p = (1/denom) * sqrt( moe_num^2 - p^2 * moe_denom^2 )
  // Fallback to RATIO formula when the radicand goes negative
  // (small denominators, near-1 proportions).
  function _propMoe(num, denom, moeNum, moeDenom) {
    if (denom == null || denom <= 0) return null;
    var p = num / denom;
    var radicandPropor = moeNum * moeNum - p * p * moeDenom * moeDenom;
    var radicand = radicandPropor >= 0
      ? radicandPropor
      : (moeNum * moeNum + p * p * moeDenom * moeDenom);
    return Math.sqrt(radicand) / denom;
  }

  // Range-overlap check used by the MOE softening rule.
  function _rangesOverlap(a, aMoe, b, bMoe) {
    if (a == null || b == null) return false;
    var aLo = a - (aMoe || 0), aHi = a + (aMoe || 0);
    var bLo = b - (bMoe || 0), bHi = b + (bMoe || 0);
    return aLo <= bHi && bLo <= aHi;
  }

  // ── Definitional consistency (CHAS vs same-vintage ACS 5-yr) ──
  // Returns { tier: 'high'|'medium'|'low'|null, gap_pp, flags[] }
  function _scoreDefinitional(chas, acs5, thresholds) {
    var th = thresholds.definitional;
    if (!chas || !acs5 || chas.rate == null || acs5.rate == null) {
      return { tier: null, gap_pp: null, flags: [] };
    }
    var gap = _pp(chas.rate, acs5.rate);
    var moeOverlap = _rangesOverlap(chas.rate, chas.moe, acs5.rate, acs5.moe);

    if (gap < th.consistent) {
      return { tier: 'high', gap_pp: gap, flags: ['directionally_consistent', 'vintage_overlap_not_freshness'] };
    }
    if (gap < th.moderate) {
      // 5-10pp — likely the HUD adjusted-income/no-cash-rent definitional gap.
      var flags = ['definitional_difference_expected', 'vintage_overlap_not_freshness'];
      var tier = moeOverlap ? 'high' : 'medium';
      if (moeOverlap) flags.push('moe_overlap_softens_divergence');
      return { tier: tier, gap_pp: gap, flags: flags };
    }
    // >10pp at same vintage = data-quality / definitional concern.
    var matFlags = ['materially_divergent', 'vintage_overlap_not_freshness'];
    if (moeOverlap) matFlags.push('moe_overlap_softens_divergence');
    return {
      tier: moeOverlap ? 'medium' : 'low',
      gap_pp: gap,
      flags: matFlags,
      divergence_reason: 'definitional',
    };
  }

  // ── Freshness movement (CHAS vs ACS 1-yr direct OR regional proxy) ──
  function _scoreFreshness(chas, acs1, thresholds) {
    var th = thresholds.freshness;
    if (!chas || chas.rate == null) {
      return { tier: null, gap_pp: null, flags: [] };
    }
    if (!acs1 || acs1.rate == null) {
      return {
        tier: 'insufficient',
        gap_pp: null,
        flags: ['stale_but_granular'],
        note: 'No newer ACS 1-year available for this geography; cannot detect market movement since 2022 baseline.',
      };
    }
    var gap = _pp(chas.rate, acs1.rate);
    var moeOverlap = _rangesOverlap(chas.rate, chas.moe, acs1.rate, acs1.moe);
    var baseFlags = acs1.isProxy
      ? ['current_but_regional', 'proxy_geography_used']
      : ['direct_geography_match'];

    if (gap < th.stable) {
      return { tier: 'high', gap_pp: gap, flags: baseFlags.concat(['directionally_consistent']) };
    }
    if (gap < th.moderate) {
      var modFlags = baseFlags.slice();
      if (moeOverlap) modFlags.push('moe_overlap_softens_divergence');
      return { tier: moeOverlap ? 'high' : 'medium', gap_pp: gap, flags: modFlags };
    }
    var matFlags = baseFlags.concat(['materially_divergent']);
    if (moeOverlap) matFlags.push('moe_overlap_softens_divergence');
    return {
      tier: moeOverlap ? 'medium' : 'low',
      gap_pp: gap,
      flags: matFlags,
      divergence_reason: 'freshness/market',
    };
  }

  // ── MOE / denominator side-flags ──
  function _qualityFlags(rec, thresholds) {
    var flags = [];
    if (rec && rec.moe != null && rec.rate != null && rec.rate > 0) {
      if (rec.moe / rec.rate > thresholds.moe.high_ratio) {
        flags.push('high_margin_of_error');
      }
    }
    if (rec && rec.denominator != null && rec.denominator < thresholds.small_denom) {
      flags.push('denominator_small');
    }
    if (!rec || rec.rate == null) flags.push('suppressed_or_missing');
    return flags;
  }

  // ── Combined confidence ──
  // Returns 'high' | 'medium' | 'low' | 'insufficient'
  function _combine(definitional, freshness, qualityFlags) {
    if (!definitional || definitional.tier == null) return 'insufficient';
    if (freshness && freshness.tier === 'low') return 'low';
    if (qualityFlags.indexOf('high_margin_of_error') !== -1)  return 'low';
    if (qualityFlags.indexOf('denominator_small') !== -1)     return 'low';
    if (qualityFlags.indexOf('suppressed_or_missing') !== -1) return 'insufficient';
    if (definitional.tier === 'high' && freshness && freshness.tier === 'high') return 'high';
    if (definitional.tier === 'high' && freshness && freshness.tier === 'medium') return 'medium';
    if (definitional.tier === 'medium') return 'medium';
    if (definitional.tier === 'low') return 'low';
    // Freshness check is the only one that resolved (no ACS5):
    if (freshness && freshness.tier === 'high') return 'medium';
    return 'medium';
  }

  // ── Public computeReliability ──
  function computeReliability(opts) {
    opts = opts || {};
    var geoid = opts.geoid;
    var geoType = opts.geoType || (geoid && geoid.length === 5 ? 'county' : 'place');
    var metric = opts.metric || 'renter_cb30';
    return Promise.all([loadSources(), loadCrosscheck()]).then(function (parts) {
      var sources = parts[0];
      var crosscheck = parts[1];
      var th = (sources && sources.scoring_thresholds) || DEFAULT_THRESHOLDS;
      // Map sources file's thresholds into our internal shape.
      var thresholds = th.consistent_pp
        ? DEFAULT_THRESHOLDS
        : {
          definitional: {
            consistent: (th.definitional_consistency && th.definitional_consistency.consistent_pp) || DEFAULT_THRESHOLDS.definitional.consistent,
            moderate:   (th.definitional_consistency && th.definitional_consistency.moderate_pp)   || DEFAULT_THRESHOLDS.definitional.moderate,
          },
          freshness: {
            stable:   (th.freshness_movement && th.freshness_movement.stable_pp)   || DEFAULT_THRESHOLDS.freshness.stable,
            moderate: (th.freshness_movement && th.freshness_movement.moderate_pp) || DEFAULT_THRESHOLDS.freshness.moderate,
          },
          moe: { high_ratio: (th.moe_softening && th.moe_softening.high_moe_flag_ratio) || DEFAULT_THRESHOLDS.moe.high_ratio },
          small_denom: (th.small_denominator && th.small_denominator.min_denominator) || DEFAULT_THRESHOLDS.small_denom,
        };

      // No crosscheck yet — degrade gracefully.
      if (!crosscheck) {
        return {
          combined: 'insufficient',
          data_source: 'chas_only',
          notes: ['Cross-check data not yet generated. Reliability scoring activates when scripts/build_rent_burden_crosscheck.mjs runs (F207b).'],
          flags: ['stale_but_granular'],
        };
      }

      var entry = (crosscheck.geos || {})[geoid];
      if (!entry || !entry[metric]) {
        return {
          combined: 'insufficient',
          data_source: 'crosscheck_loaded_but_geoid_missing',
          notes: ['No cross-check record for geoid ' + geoid + ' / metric ' + metric + '. May be too small for ACS 1-year + insufficient population for ACS 5-year.'],
          flags: ['suppressed_or_missing'],
        };
      }

      var m = entry[metric];
      var defScore  = _scoreDefinitional(m.chas, m.acs5, thresholds);
      var freshScore = _scoreFreshness(m.chas, m.acs1, thresholds);
      var qFlags    = []
        .concat(_qualityFlags(m.chas, thresholds))
        .concat(_qualityFlags(m.acs5, thresholds))
        .concat(_qualityFlags(m.acs1, thresholds));
      var combined = _combine(defScore, freshScore, qFlags);

      var allFlags = (defScore.flags || []).concat(freshScore.flags || []).concat(qFlags);
      // dedupe
      var seen = {};
      var flags = [];
      for (var i = 0; i < allFlags.length; i++) {
        if (!seen[allFlags[i]]) { seen[allFlags[i]] = true; flags.push(allFlags[i]); }
      }

      return {
        geoid: geoid,
        geoType: geoType,
        metric: metric,
        chas: m.chas,
        acs5: m.acs5,
        acs1: m.acs1,
        definitional: defScore,
        freshness: freshScore,
        combined: combined,
        flags: flags,
        notes: _composeNotes(defScore, freshScore, m, flags),
        data_source: 'full_crosscheck',
      };
    });
  }

  function _composeNotes(defScore, freshScore, rec, flags) {
    var notes = [];
    if (defScore.tier === 'high') notes.push('Same-vintage ACS 5-year confirms the CHAS definition (within ' + (defScore.gap_pp || 0).toFixed(1) + 'pp).');
    if (defScore.tier === 'medium' && flags.indexOf('definitional_difference_expected') !== -1) {
      notes.push('5–10pp gap vs same-vintage ACS 5-year is the expected HUD adjusted-income / no-cash-rent definitional difference — not a data-quality concern.');
    }
    if (defScore.tier === 'low' && defScore.divergence_reason === 'definitional') {
      notes.push('Definitional divergence > 10pp at same vintage. Investigate tenure / denominator / suppression before trusting the CHAS rate.');
    }
    if (freshScore.tier === 'insufficient') {
      notes.push('No newer ACS 1-year available for this geography. CHAS 2018–2022 is the only signal — directional only.');
    }
    if (freshScore.tier === 'high') {
      notes.push('Newer ACS 1-year ' + (rec.acs1 && rec.acs1.isProxy ? '(regional proxy)' : '(direct geography)') + ' confirms the direction of CHAS burden.');
    }
    if (freshScore.tier === 'medium') {
      notes.push('Some movement since CHAS (5–10pp gap vs ACS 1-year' + (rec.acs1 && rec.acs1.isProxy ? ' regional proxy' : '') + '). Treat as directional, not precise.');
    }
    if (freshScore.tier === 'low' && freshScore.divergence_reason === 'freshness/market') {
      notes.push('Newer ACS 1-year shows market has moved materially (' + (freshScore.gap_pp || 0).toFixed(1) + 'pp gap). CHAS baseline may understate current burden.');
    }
    if (flags.indexOf('high_margin_of_error') !== -1) notes.push('High margin of error — point estimate uncertain.');
    if (flags.indexOf('denominator_small') !== -1) notes.push('Small denominator (<100 households) — proceed with caution.');
    return notes;
  }

  // ── Confidence badge HTML ──
  function confidenceBadge(reliability, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var combined = reliability && reliability.combined ? reliability.combined : 'insufficient';
    var palette = {
      high:         { label: 'High confidence',         color: '#16a34a', bg: '#16a34a18' },
      medium:       { label: 'Medium confidence',       color: '#f59e0b', bg: '#f59e0b18' },
      low:          { label: 'Low confidence',          color: '#dc2626', bg: '#dc262618' },
      insufficient: { label: 'CHAS baseline only',      color: '#64748b', bg: '#64748b18' },
    };
    var p = palette[combined] || palette.insufficient;
    var tip = _tooltipText(reliability);
    var safeTip = String(tip || '').replace(/"/g, '&quot;');
    var style = 'display:inline-flex;align-items:center;gap:4px;padding:1px 7px;' +
                'border-radius:9px;font-size:' + (compact ? '9.5px' : '10.5px') +
                ';font-weight:600;cursor:help;background:' + p.bg +
                ';color:' + p.color + ';border:1px solid ' + p.color + '40;white-space:nowrap';
    var dot = '<span style="width:6px;height:6px;border-radius:50%;background:' + p.color + '" aria-hidden="true"></span>';
    return '<span class="rbr-confidence-badge" title="' + safeTip + '" style="' + style + '" tabindex="0" role="note">' +
             dot + (compact ? combined : p.label) +
           '</span>';
  }

  function _tooltipText(reliability) {
    if (!reliability) return 'Rent-burden reliability check not yet run.';
    var parts = [];
    if (reliability.notes && reliability.notes.length) {
      parts = parts.concat(reliability.notes);
    } else {
      parts.push('Baseline: HUD CHAS 2018–2022. Cross-check pending.');
    }
    if (reliability.flags && reliability.flags.length) {
      parts.push('Flags: ' + reliability.flags.join(', ') + '.');
    }
    return parts.join(' ');
  }

  // ── Expose ──
  window.RentBurdenReliability = {
    loadSources: loadSources,
    loadCrosscheck: loadCrosscheck,
    computeReliability: computeReliability,
    confidenceBadge: confidenceBadge,
    // Exposed for tests / debugging
    _internals: {
      pp: _pp,
      propMoe: _propMoe,
      rangesOverlap: _rangesOverlap,
      scoreDefinitional: _scoreDefinitional,
      scoreFreshness: _scoreFreshness,
      qualityFlags: _qualityFlags,
      combine: _combine,
      composeNotes: _composeNotes,
    },
  };
})();
