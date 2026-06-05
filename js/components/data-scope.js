/**
 * data-scope.js — F248 (P0-3): Defensive helper for place-vs-county masking.
 *
 * Why this exists
 * ---------------
 * The "panel reads county data and labels it as place data when no
 * place-level data exists" bug has appeared in 6+ spots over the past
 * year (F30 / F55 / F60 / F223 / F226 / F236). Each fix patched one
 * panel. The pattern keeps coming back when new panels are added
 * because the place-vs-county logic is open-coded at every callsite.
 *
 * This module gives every renderer a single shared API:
 *
 *   window.DataScope.lookup(dataset, placeGeoid, countyFips, options)
 *     → { value, scope, scaledFrom, isFallback, confidence }
 *
 * The `scope` field is the source of truth. Callers MUST surface it to
 * the user when scope === 'county' or scope === 'scaled' (i.e. when
 * the value is NOT a direct place-level measurement).
 *
 * Public API
 * ----------
 *   DataScope.lookup(dataset, placeGeoid, countyFips, options)
 *     dataset: object keyed by either placeGeoid or countyFips
 *     placeGeoid: 7-digit place GEOID, or null/undefined if county-level only
 *     countyFips: 5-digit county FIPS for fallback
 *     options:
 *       - lowConfidenceField: name of the boolean field that means
 *           "this place-level entry exists but is low-confidence —
 *           prefer the county fallback". Default: 'low_confidence'.
 *       - countyOnly: set true if you KNOW this dataset has no
 *           place-level entries (e.g. CHAS county aggregates) so the
 *           helper skips the place lookup and stamps scope='county'.
 *     returns: { value, scope, scaledFrom, isFallback, confidence }
 *       value: the data record (or null if neither place nor county had it)
 *       scope: 'place' | 'county' | 'scaled' | null
 *       scaledFrom: when scope='scaled', the county FIPS the value was scaled from
 *       isFallback: true if we returned county data when caller asked for place
 *       confidence: 'high' | 'medium' | 'low' | null
 *
 *   DataScope.scopeBadge(scope, options)
 *     Returns an HTML string for a small disclosure pill:
 *     - scope='place'   → '' (no pill — direct measurement is the
 *                            expected default; no disclosure needed)
 *     - scope='county'  → '<span class="ds-pill ds-pill--warn">via county</span>'
 *     - scope='scaled'  → '<span class="ds-pill ds-pill--warn">scaled from county</span>'
 *     options:
 *       - countyName: optional county label to include in the pill
 *       - inline: render a smaller inline pill instead of block
 *
 *   DataScope.guardCountyOnly(dataset)
 *     Returns true if the given dataset has no place-level entries (only
 *     5-digit FIPS keys). Useful at module init to assert assumptions.
 *
 *   DataScope.surfaceMissingScope(callerName)
 *     Logs a console warning when a caller forgot to surface the scope
 *     to the user. Used by the lint helper.
 *
 * Usage example
 * -------------
 *   var lookup = window.DataScope.lookup(
 *     state.chasByFips,
 *     op.placeGeoid,
 *     op.containingCounty,
 *     { countyOnly: true }  // chasByFips is county-keyed only
 *   );
 *   if (lookup.value) {
 *     panel.innerHTML = renderCostBurden(lookup.value) +
 *                       window.DataScope.scopeBadge(lookup.scope,
 *                         { countyName: op.countyName });
 *   }
 *
 * Migration plan
 * --------------
 * The existing OF `needCompositeFor()` pattern (returns {composite, source})
 * is the prototype this module generalizes. New callers should use
 * DataScope.lookup() directly. The OF helper will be migrated to use it
 * in a follow-up commit once we've proven the API on 2-3 new callsites.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    lowConfidenceField: 'low_confidence',
    countyOnly: false
  };

  function _confidenceFromScope(scope, record) {
    if (scope === 'place') {
      if (record && record._confidence) return record._confidence;
      return 'high';
    }
    if (scope === 'county') return 'medium';
    if (scope === 'scaled') return 'low';
    return null;
  }

  function lookup(dataset, placeGeoid, countyFips, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    if (!dataset || typeof dataset !== 'object') {
      return { value: null, scope: null, scaledFrom: null, isFallback: false, confidence: null };
    }

    // Caller asserts this dataset is county-only — skip the place lookup.
    if (!opts.countyOnly && placeGeoid) {
      var placeRec = dataset[placeGeoid];
      if (placeRec && !placeRec[opts.lowConfidenceField]) {
        return {
          value: placeRec,
          scope: 'place',
          scaledFrom: null,
          isFallback: false,
          confidence: _confidenceFromScope('place', placeRec)
        };
      }
    }

    if (countyFips) {
      var countyRec = dataset[countyFips];
      if (countyRec) {
        var scope = opts.countyOnly ? 'county' : (placeGeoid ? 'county' : 'county');
        // If the caller requested a place-level read but we returned county
        // data, this is a fallback the user MUST be told about.
        var isFallback = !!placeGeoid && !opts.countyOnly;
        return {
          value: countyRec,
          scope: scope,
          scaledFrom: null,
          isFallback: isFallback,
          confidence: _confidenceFromScope(scope, countyRec)
        };
      }
    }

    return { value: null, scope: null, scaledFrom: null, isFallback: false, confidence: null };
  }

  function scopeBadge(scope, options) {
    var opts = options || {};
    if (!scope || scope === 'place') return '';

    var styleBase = 'display:inline-block;padding:1px 6px;border-radius:3px;font-size:.68rem;' +
      'font-weight:600;line-height:1.3;letter-spacing:.02em;background:var(--warn-dim,#3f2a1a);' +
      'color:var(--warn,#fbbf24);border:1px solid var(--warn,#fbbf24);';
    if (opts.inline) styleBase += 'margin-left:.4rem;';
    else styleBase += 'margin:.2rem 0;';

    var countyLabel = opts.countyName
      ? ' (' + String(opts.countyName).replace(/\s+County$/i, '') + ')'
      : '';

    var labelMap = {
      county:  'via county' + countyLabel,
      scaled:  'scaled from county' + countyLabel
    };
    var tooltipMap = {
      county:  'No direct place-level data for this jurisdiction — showing the containing county\'s value. ' +
               'Small towns often inherit their county\'s value because Census privacy rules suppress place-level estimates.',
      scaled:  'No direct place-level data for this jurisdiction — value was scaled from the containing county by population share. ' +
               'Treat as approximate.'
    };

    return '<span class="ds-pill ds-pill--' + scope + '" style="' + styleBase + '" ' +
      'title="' + (tooltipMap[scope] || '') + '">' +
      (labelMap[scope] || scope) +
    '</span>';
  }

  function guardCountyOnly(dataset) {
    if (!dataset || typeof dataset !== 'object') return false;
    var keys = Object.keys(dataset);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      // 7-digit GEOID means it's a place-level entry
      if (keys[i].length === 7) return false;
    }
    return true;
  }

  var _missingScopeWarned = {};
  function surfaceMissingScope(callerName) {
    if (_missingScopeWarned[callerName]) return;
    _missingScopeWarned[callerName] = true;
    console.warn('[DataScope] ' + callerName + ' looked up data but did not call scopeBadge(). ' +
      'Users won\'t know whether they\'re seeing place or county data. ' +
      'Either add a scopeBadge() call or pass {silent: true} to acknowledge.');
  }

  window.DataScope = {
    lookup: lookup,
    scopeBadge: scopeBadge,
    guardCountyOnly: guardCountyOnly,
    surfaceMissingScope: surfaceMissingScope
  };
}());
