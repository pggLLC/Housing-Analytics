/**
 * neighborhood-context.js
 * ES5 IIFE module — window.NeighborhoodContext
 *
 * Loads pre-computed neighborhood/architectural context for all 64 Colorado
 * counties from data/core/neighborhood-context.json and exposes utilities for
 * LIHTC developers to understand design compatibility with surrounding community.
 *
 * Public API:
 *   load()                              → Promise<void>
 *   isLoaded()                          → boolean
 *   getCounty(fips)                     → county context object | null
 *   renderContextCard(containerId, fips)→ void
 */

(function (window) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  var _data    = null;   // full parsed JSON
  var _loading = null;   // in-flight Promise (deduplicate parallel load() calls)
  var _STYLE_ID = 'neighborhood-context-styles';

  // ---------------------------------------------------------------------------
  // CSS injection
  // ---------------------------------------------------------------------------

  function _injectStyles() {
    if (document.getElementById(_STYLE_ID)) return;

    var css = [
      /* Card container */
      '.nc-card {',
      '  background: var(--card, #ffffff);',
      '  border: 1px solid var(--border, #dde1e7);',
      '  border-radius: 10px;',
      '  padding: 20px 24px;',
      '}',

      /* Badge row */
      '.nc-badges {',
      '  display: flex;',
      '  flex-direction: row;',
      '  flex-wrap: wrap;',
      '  gap: 8px;',
      '  margin-bottom: 16px;',
      '}',

      /* Base badge */
      '.nc-badge {',
      '  display: inline-block;',
      '  padding: 4px 10px;',
      '  border-radius: 999px;',
      '  font-size: .75rem;',
      '  font-weight: 700;',
      '  line-height: 1.4;',
      '  background: var(--bg2, #f4f6f9);',
      '  border: 1px solid var(--border, #dde1e7);',
      '  white-space: nowrap;',
      '}',

      /* Form badge — accent border hint */
      '.nc-badge--form {',
      '  border-color: var(--accent, #2563eb);',
      '  color: var(--accent, #2563eb);',
      '}',

      /* Density badge */
      '.nc-badge--density {',
      '  color: var(--muted, #6b7280);',
      '}',

      /* Year built badge */
      '.nc-badge--year {',
      '  color: var(--muted, #6b7280);',
      '}',

      /* Pressure badges */
      '.nc-badge--pressure-low {',
      '  background: #d1fae5;',
      '  border-color: #6ee7b7;',
      '  color: #065f46;',
      '}',
      '.nc-badge--pressure-moderate {',
      '  background: #fef3c7;',
      '  border-color: #fcd34d;',
      '  color: #92400e;',
      '}',
      '.nc-badge--pressure-high {',
      '  background: #fee2e2;',
      '  border-color: #fca5a5;',
      '  color: #991b1b;',
      '}',
      '.nc-badge--pressure-very_high {',
      '  background: #fca5a5;',
      '  border-color: #ef4444;',
      '  color: #7f1d1d;',
      '}',

      /* Design tip callout */
      '.nc-design-tip {',
      '  background: color-mix(in oklab, var(--card, #ffffff) 60%, var(--accent, #2563eb) 40%);',
      '  border-left: 3px solid var(--accent, #2563eb);',
      '  padding: 12px 16px;',
      '  border-radius: 0 6px 6px 0;',
      '  margin: 16px 0;',
      '  font-size: .88rem;',
      '  line-height: 1.55;',
      '}',

      /* Design tip label */
      '.nc-design-tip__label {',
      '  display: block;',
      '  font-size: .7rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: .05em;',
      '  color: var(--accent, #2563eb);',
      '  margin-bottom: 5px;',
      '}',

      /* Section headers inside card */
      '.nc-section-label {',
      '  display: block;',
      '  font-size: .7rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: .05em;',
      '  color: var(--muted, #6b7280);',
      '  margin: 14px 0 4px;',
      '}',

      /* Housing history paragraph */
      '.nc-history {',
      '  font-size: .85rem;',
      '  color: var(--muted, #6b7280);',
      '  line-height: 1.55;',
      '  margin-top: 12px;',
      '}',

      /* Character paragraph */
      '.nc-character {',
      '  font-size: .92rem;',
      '  line-height: 1.6;',
      '  margin: 0;',
      '}',

      /* Placeholder / error state */
      '.nc-placeholder {',
      '  padding: 20px 24px;',
      '  background: var(--bg2, #f4f6f9);',
      '  border-radius: 10px;',
      '  border: 1px dashed var(--border, #dde1e7);',
      '  font-size: .88rem;',
      '  color: var(--muted, #6b7280);',
      '  text-align: center;',
      '}'
    ].join('\n');

    var el = document.createElement('style');
    el.id   = _STYLE_ID;
    el.type = 'text/css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a raw form or era value to a human-readable label.
   */
  function _label(value) {
    var map = {
      // form
      urban_core:     'Urban Core',
      suburban:       'Suburban',
      small_town:     'Small Town',
      rural:          'Rural',
      mountain_resort:'Mountain Resort',
      agricultural:   'Agricultural',
      college_town:   'College Town',
      // era
      historic_core:  'Historic Core',
      postwar:        'Postwar',
      modern_suburb:  'Modern Suburb',
      contemporary:   'Contemporary',
      mixed:          'Mixed Era',
      // density
      very_low:       'Very Low Density',
      low:            'Low Density',
      medium:         'Medium Density',
      high:           'High Density',
      very_high:      'Very High Density',
      // pressure
      low:            'Low Pressure',
      moderate:       'Moderate Pressure',
      high:           'High Pressure',
      very_high:      'Very High Pressure'
    };
    return map[value] || (value ? value.replace(/_/g, ' ') : '—');
  }

  /**
   * Density label (no "Density" suffix — used in badge where space is tight).
   */
  function _densityLabel(value) {
    var map = {
      very_low: 'Very Low Density',
      low:      'Low Density',
      medium:   'Medium Density',
      high:     'High Density',
      very_high:'Very High Density'
    };
    return map[value] || _label(value);
  }

  /**
   * Pressure label text (short).
   */
  function _pressureLabel(value) {
    var map = {
      low:       'Low Housing Pressure',
      moderate:  'Moderate Housing Pressure',
      high:      'High Housing Pressure',
      very_high: 'Very High Housing Pressure'
    };
    return map[value] || (value ? value.replace(/_/g, ' ') : '—');
  }

  /**
   * Safely escape text for injection into innerHTML.
   */
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Form label, splitting compound values like "suburban+small_town" on "+".
   */
  function _formLabel(form) {
    if (!form) return '—';
    return form.split('+').map(function (f) {
      var map = {
        urban_core:     'Urban Core',
        suburban:       'Suburban',
        small_town:     'Small Town',
        rural:          'Rural',
        mountain_resort:'Mountain Resort',
        agricultural:   'Agricultural',
        college_town:   'College Town'
      };
      return map[f.trim()] || f.replace(/_/g, ' ');
    }).join(' / ');
  }

  /**
   * Era label, splitting compound values.
   */
  function _eraLabel(era) {
    if (!era) return '—';
    return era.split('+').map(function (e) {
      var map = {
        historic_core: 'Historic Core',
        postwar:       'Postwar',
        modern_suburb: 'Modern Suburb',
        contemporary:  'Contemporary',
        mixed:         'Mixed Era'
      };
      return map[e.trim()] || e.replace(/_/g, ' ');
    }).join(' / ');
  }

  /**
   * Build the housing-mix pill string.
   */
  function _mixLabel(mix) {
    if (!mix) return '';
    var parts = [];
    if (mix.singleFamily) parts.push(mix.singleFamily + '% SF');
    if (mix.multifamily)  parts.push(mix.multifamily  + '% MF');
    if (mix.mobile)       parts.push(mix.mobile        + '% Mobile');
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Card HTML builder
  // ---------------------------------------------------------------------------

  function _buildCardHTML(county) {
    var formEra    = _esc(_formLabel(county.form)) + ' &middot; ' + _esc(_eraLabel(county.era));
    var density    = _esc(_densityLabel(county.density));
    var pressureCls = 'nc-badge nc-badge--pressure-' + _esc(county.pressureLevel);
    var pressureTxt = _esc(_pressureLabel(county.pressureLevel));
    var rural = county.ruralFlag
      ? '<span class="nc-badge">Rural Eligible</span>'
      : '';
    var yearBadge = county.yearBuiltMedian
      ? '<span class="nc-badge nc-badge--year">Built ~' + _esc(String(county.yearBuiltMedian)) + ' median</span>'
      : '';
    var mixBadge = county.housingMix
      ? '<span class="nc-badge">' + _esc(_mixLabel(county.housingMix)) + '</span>'
      : '';

    return [
      '<div class="nc-card">',

      /* ---- Badge row ---- */
      '  <div class="nc-badges">',
      '    <span class="nc-badge nc-badge--form">' + formEra + '</span>',
      '    <span class="nc-badge nc-badge--density">' + density + '</span>',
      '    <span class="' + pressureCls + '">' + pressureTxt + '</span>',
      yearBadge,
      mixBadge,
      rural,
      '  </div>',

      /* ---- Character ---- */
      '  <span class="nc-section-label">Community Character</span>',
      '  <p class="nc-character">' + _esc(county.character) + '</p>',

      /* ---- Design tip ---- */
      '  <div class="nc-design-tip">',
      '    <span class="nc-design-tip__label">Design Context</span>',
      '    ' + _esc(county.designContext),
      '  </div>',

      /* ---- Housing history ---- */
      '  <span class="nc-section-label">Housing History</span>',
      '  <p class="nc-history">' + _esc(county.housingHistory) + '</p>',

      '</div>'
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Placeholder HTML
  // ---------------------------------------------------------------------------

  function _buildPlaceholderHTML(message) {
    return '<div class="nc-placeholder">' + _esc(message) + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Load the neighborhood context JSON.
   * Idempotent — safe to call multiple times; returns the same Promise if
   * a load is already in flight.
   *
   * @returns {Promise<void>}
   */
  function load() {
    if (_data)    return Promise.resolve();
    if (_loading) return _loading;

    var repoRoot = (window.__REPO_ROOT !== undefined ? window.__REPO_ROOT : '');
    var url = repoRoot + 'data/core/neighborhood-context.json';

    _loading = window.fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error(
            'NeighborhoodContext: failed to load ' + url +
            ' (HTTP ' + res.status + ')'
          );
        }
        return res.json();
      })
      .then(function (json) {
        _data    = json;
        _loading = null;
      })
      .catch(function (err) {
        _loading = null;
        throw err;
      });

    return _loading;
  }

  /**
   * Whether the JSON has been successfully loaded.
   *
   * @returns {boolean}
   */
  function isLoaded() {
    return _data !== null;
  }

  /**
   * Retrieve the context object for a single county.
   *
   * @param  {string} fips  Five-digit FIPS code, e.g. "08031"
   * @returns {object|null}
   */
  function getCounty(fips) {
    if (!_data || !fips) return null;
    return _data.counties[String(fips)] || null;
  }

  /**
   * Render a neighbourhood context card into a DOM container.
   *
   * @param {string} containerId  id of the target element
   * @param {string} fips         Five-digit FIPS code, e.g. "08031"
   */
  function renderContextCard(containerId, fips) {
    _injectStyles();

    var container = document.getElementById(containerId);
    if (!container) {
      console.warn('NeighborhoodContext.renderContextCard: container "' + containerId + '" not found.');
      return;
    }

    if (!_data) {
      container.innerHTML = _buildPlaceholderHTML(
        'Neighborhood context is loading\u2026 Please try again in a moment.'
      );
      return;
    }

    var county = getCounty(fips);
    if (!county) {
      container.innerHTML = _buildPlaceholderHTML(
        'No neighborhood context available for FIPS code \u201c' + fips + '\u201d.'
      );
      return;
    }

    container.innerHTML = _buildCardHTML(county);
  }

  // ---------------------------------------------------------------------------
  // Expose module
  // ---------------------------------------------------------------------------

  window.NeighborhoodContext = {
    load:             load,
    isLoaded:         isLoaded,
    getCounty:        getCounty,
    renderContextCard: renderContextCard
  };

}(window));
