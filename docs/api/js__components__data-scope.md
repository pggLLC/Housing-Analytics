# `js/components/data-scope.js`

data-scope.js — F248 (P0-3): Defensive helper for place-vs-county masking.

Why this exists
---------------
The "panel reads county data and labels it as place data when no
place-level data exists" bug has appeared in 6+ spots over the past
year (F30 / F55 / F60 / F223 / F226 / F236). Each fix patched one
panel. The pattern keeps coming back when new panels are added
because the place-vs-county logic is open-coded at every callsite.

This module gives every renderer a single shared API:

  window.DataScope.lookup(dataset, placeGeoid, countyFips, options)
    → { value, scope, scaledFrom, isFallback, confidence }

The `scope` field is the source of truth. Callers MUST surface it to
the user when scope === 'county' or scope === 'scaled' (i.e. when
the value is NOT a direct place-level measurement).

Public API
----------
  DataScope.lookup(dataset, placeGeoid, countyFips, options)
    dataset: object keyed by either placeGeoid or countyFips
    placeGeoid: 7-digit place GEOID, or null/undefined if county-level only
    countyFips: 5-digit county FIPS for fallback
    options:
      - lowConfidenceField: name of the boolean field that means
          "this place-level entry exists but is low-confidence —
          prefer the county fallback". Default: 'low_confidence'.
      - countyOnly: set true if you KNOW this dataset has no
          place-level entries (e.g. CHAS county aggregates) so the
          helper skips the place lookup and stamps scope='county'.
    returns: { value, scope, scaledFrom, isFallback, confidence }
      value: the data record (or null if neither place nor county had it)
      scope: 'place' | 'county' | 'scaled' | null
      scaledFrom: when scope='scaled', the county FIPS the value was scaled from
      isFallback: true if we returned county data when caller asked for place
      confidence: 'high' | 'medium' | 'low' | null

  DataScope.scopeBadge(scope, options)
    Returns an HTML string for a small disclosure pill:
    - scope='place'   → '' (no pill — direct measurement is the
                           expected default; no disclosure needed)
    - scope='county'  → '<span class="ds-pill ds-pill--warn">via county</span>'
    - scope='scaled'  → '<span class="ds-pill ds-pill--warn">scaled from county</span>'
    options:
      - countyName: optional county label to include in the pill
      - inline: render a smaller inline pill instead of block

  DataScope.guardCountyOnly(dataset)
    Returns true if the given dataset has no place-level entries (only
    5-digit FIPS keys). Useful at module init to assert assumptions.

  DataScope.surfaceMissingScope(callerName)
    Logs a console warning when a caller forgot to surface the scope
    to the user. Used by the lint helper.

Usage example
-------------
  var lookup = window.DataScope.lookup(
    state.chasByFips,
    op.placeGeoid,
    op.containingCounty,
    { countyOnly: true }  // chasByFips is county-keyed only
  );
  if (lookup.value) {
    panel.innerHTML = renderCostBurden(lookup.value) +
                      window.DataScope.scopeBadge(lookup.scope,
                        { countyName: op.countyName });
  }

Migration plan
--------------
The existing OF `needCompositeFor()` pattern (returns {composite, source})
is the prototype this module generalizes. New callers should use
DataScope.lookup() directly. The OF helper will be migrated to use it
in a follow-up commit once we've proven the API on 2-3 new callsites.

_No documented symbols — module has a file-header comment only._
