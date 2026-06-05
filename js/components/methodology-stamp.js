/**
 * methodology-stamp.js — F250 (P2-7): Methodology version stamp helper.
 *
 * Every score the site publishes should carry a methodology version
 * (e.g. "v2.4-2026-04-22") so a user who saved a ranking last month
 * can see if and how it would change today. This module renders a
 * compact pill next to scores + a tooltip with the most recent change.
 *
 * Public API
 * ----------
 *   MethodologyStamp.init() → Promise resolving when version data loads
 *   MethodologyStamp.versionFor(moduleKey) → string ("v2.4-2026-04-22") or null
 *   MethodologyStamp.changeLogFor(moduleKey) → array of {version, what_changed}
 *   MethodologyStamp.render(moduleKey, options) → HTML string for an inline pill
 *
 * Module keys:
 *   opportunity_finder, housing_needs_scorecard, ami_gap,
 *   market_capture_advantage, pma_site_score, deal_calculator,
 *   pab_allocation
 *
 * Usage
 * -----
 *   await MethodologyStamp.init();
 *   var html = MethodologyStamp.render('opportunity_finder', { inline: true });
 *   document.getElementById('ofScoreLabel').insertAdjacentHTML('beforeend', ' ' + html);
 */
(function () {
  'use strict';

  var DATA_PATH = 'data/policy/methodology-version.json';
  var _state = { loaded: false, loading: null, data: null };

  function init() {
    if (_state.loaded) return Promise.resolve(_state.data);
    if (_state.loading) return _state.loading;
    _state.loading = fetch(DATA_PATH, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        _state.data = j;
        _state.loaded = true;
        return j;
      })
      .catch(function (err) {
        console.warn('[MethodologyStamp] failed to load version data:', err);
        _state.loaded = true;
        return null;
      });
    return _state.loading;
  }

  function _moduleFor(moduleKey) {
    if (!_state.data || !_state.data.modules) return null;
    return _state.data.modules[moduleKey] || null;
  }

  function versionFor(moduleKey) {
    var mod = _moduleFor(moduleKey);
    return mod && mod.current_version ? mod.current_version : null;
  }

  function changeLogFor(moduleKey) {
    var mod = _moduleFor(moduleKey);
    return (mod && Array.isArray(mod.change_log)) ? mod.change_log : [];
  }

  function _escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render(moduleKey, options) {
    var opts = options || {};
    var version = versionFor(moduleKey);
    if (!version) return '';
    var changeLog = changeLogFor(moduleKey);
    var latest = changeLog.length ? changeLog[0] : null;
    var tooltip = 'Methodology ' + version;
    if (latest && latest.what_changed) {
      tooltip += ' — last change: ' + latest.what_changed;
    }

    var style = 'display:inline-block;padding:1px 6px;border-radius:3px;' +
      'font-size:.66rem;font-weight:600;line-height:1.3;letter-spacing:.02em;' +
      'background:var(--surface-2,#1e293b);color:var(--muted,#94a3b8);' +
      'border:1px solid var(--border,#334155);font-family:ui-monospace,monospace;';
    if (opts.inline) style += 'margin-left:.4rem;vertical-align:middle;';

    return '<span class="methodology-stamp" style="' + style + '" ' +
      'title="' + _escHtml(tooltip) + '">' +
      _escHtml(version) +
    '</span>';
  }

  window.MethodologyStamp = {
    init: init,
    versionFor: versionFor,
    changeLogFor: changeLogFor,
    render: render
  };
}());
