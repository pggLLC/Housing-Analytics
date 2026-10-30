/**
 * js/hna/hna-market-call.js
 * =========================
 * One line on the Housing Needs Assessment's market section: the market call
 * for the geography the report is showing, from data/market/market-direction.json,
 * linked to the Deep Dive's Market Direction tab where every county and town is.
 *
 *   [data-market-call]   filled with the call, the signals that decided it,
 *                        this year's permits against last year's, and, for a
 *                        town, its county's call.
 *
 * Which geography: HNAState.state.current, announced by hna-controller.js as
 * `hna:geography-changed` (the same source js/components/place-deals-limits.js
 * reads). A combined or regional view covers several places and has no single
 * call, so the line stays hidden; so does statewide.
 *
 * A missing reading is said with the file's reason, never shown as a number.
 * The call names match the tab's (js/market-direction.js CALLS); the test
 * test/hna-market-call.test.js holds them together.
 */
(function (global) {
  'use strict';
  if (global.HnaMarketCall) return;

  var FILE = 'data/market/market-direction.json';
  var TAB = 'colorado-deep-dive.html#tab-direction';
  var LABELS = {
    emerging: 'Emerging',
    steady: 'Steady',
    softening: 'Softening',
    falling_demand: 'Falling demand',
    second_home_shift: 'Second-home shift',
    not_enough_data: 'Not enough data'
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var loading = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
  function label(c) { return LABELS[c] || c; }
  function sentence(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function load() {
    if (loading) return loading;
    var url = global.resolveAssetUrl ? global.resolveAssetUrl(FILE) : FILE;
    loading = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(FILE + ' returned ' + r.status);
      return r.json();
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  // The signals behind a call, as the tab says them: "falling: permits, price".
  function why(basis) {
    if (!basis) return '';
    if (basis.indexOf(':') < 0) return sentence(basis);
    var parts = basis.split('; ').filter(function (p) { return !/: none$/.test(p); });
    return parts.length ? sentence(parts.join('; ')) : 'Nothing rising or falling';
  }

  function permits(p, through) {
    if (!p || !p.ytd || !p.prior_ytd || !isNum(p.ytd.total) || !isNum(p.prior_ytd.total)) {
      return 'This year so far: no permit reading (' + ((p && p.unavailable_reason) || 'not in the Census monthly permit files') + ').';
    }
    var m = through ? Number(String(through).split('-')[1]) : NaN;
    var y = through ? Number(String(through).split('-')[0]) : NaN;
    var span = isNum(m) && isNum(y) ? ' January–' + MONTHS[m - 1] + ' ' + y : ' this year to date';
    return 'This year so far, which the call does not use: ' + fmtInt(p.ytd.total) + ' homes permitted' + span + ', against ' + fmtInt(p.prior_ytd.total) + ' a year earlier.';
  }

  // { kind: 'county'|'place', geoid } for the geography on screen, or null.
  function target() {
    var hna = global.HNAState;
    var cur = hna && hna.state && hna.state.current;
    if (!cur || !cur.geoid) return null;
    if (cur.geoType === 'county') return { kind: 'county', geoid: String(cur.geoid).padStart(5, '0').slice(-5) };
    if (cur.geoType === 'place' || cur.geoType === 'cdp') return { kind: 'place', geoid: String(cur.geoid) };
    return null;
  }

  // The line for one geography, or null when the file has no record for it.
  function lineFor(d, t) {
    var rec = t.kind === 'county' ? d.counties[t.geoid] : d.places[t.geoid];
    if (!rec) return null;
    var through = d.meta && d.meta.sources && d.meta.sources.permits_ytd && d.meta.sources.permits_ytd.through;
    var head = rec.call === 'not_enough_data'
      ? 'Market direction: <strong>not enough data to call</strong> (' + esc(rec.call_basis || 'no reason given') + ').'
      : 'Market direction: <strong>' + esc(label(rec.call)) + '</strong>. ' + esc(why(rec.call_basis)) + '.';
    var parts = [head, esc(permits(rec.permits_ytd, through))];
    if (t.kind === 'place') {
      var county = d.counties[rec.county_fips];
      if (county) parts.push('Its county, ' + esc(county.name) + ', is ' + esc(label(county.call).toLowerCase()) + '.');
    }
    parts.push('<a href="' + TAB + '">See every county and town’s call</a>');
    return parts.join(' ');
  }

  var seq = 0;
  function render() {
    var mounts = document.querySelectorAll('[data-market-call]');
    if (!mounts.length) return;
    var t = target();
    var mine = ++seq;
    var hide = function () { Array.prototype.forEach.call(mounts, function (m) { m.hidden = true; m.innerHTML = ''; }); };
    if (!t) { hide(); return; }
    load().then(function (d) {
      if (mine !== seq) return;
      var html = lineFor(d, t);
      if (!html) { hide(); return; }
      Array.prototype.forEach.call(mounts, function (m) { m.innerHTML = html; m.hidden = false; });
    }).catch(function () { if (mine === seq) hide(); });
  }

  var lastKey = null;
  function onChange() {
    var t = target();
    var key = t ? t.kind + '|' + t.geoid : '';
    if (key === lastKey) return;
    lastKey = key;
    render();
  }

  function start() {
    if (!document.querySelector('[data-market-call]')) return;
    document.addEventListener('hna:geography-changed', onChange);
    onChange();
  }

  global.HnaMarketCall = { render: render, _lineFor: lineFor, _labels: LABELS, _why: why };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : this);
