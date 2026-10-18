/**
 * acs-reliability.js
 * Responsibility: the Census margin of error and reliability tier of an ACS
 *   figure, read from data/hna/acs-reliability.json, which
 *   scripts/hna/build_acs_reliability.py builds from the published margins.
 * Dependencies: window.resolveAssetUrl, window.fetchWithTimeout (both optional)
 * Exposes: window.ACSReliability
 *
 * Each entry in the file is the published estimate a page stores (e), its 90%
 * margin of error (m), the ACS year (y) and series (s) the estimate came from,
 * and a tier (t): good (CV 15% or less), fair (15-30%), use_with_caution
 * (over 30%) or zero_in_sample. A margin belongs to a number only when the
 * number shown equals e, so forValue() returns nothing for any other number,
 * such as a Zillow-based home value or a figure fetched live.
 *
 * A 1-year figure (a geography of 65,000 or more) also has `five`: the ACS
 * 5-year estimate ending the same year, with its own margin and tier, which
 * fiveYear() puts beside it with the difference.
 */
(function () {
  'use strict';

  const PATH = 'data/hna/acs-reliability.json';
  // Stored percentages and minutes carry one decimal, and the rent-burden
  // figure is the sum of two of them, so equality is within half a tenth.
  const TOLERANCE = 0.051;
  const TIER_LABEL = {
    good: 'good',
    fair: 'fair',
    use_with_caution: 'use with caution',
    zero_in_sample: 'none in the survey sample',
  };

  let _file = null;
  let _loading = null;

  /** Fetch the file once. Resolves to the file, or null when it cannot load. */
  function load() {
    if (_file) return Promise.resolve(_file);
    if (_loading) return _loading;
    const url = typeof window.resolveAssetUrl === 'function' ? window.resolveAssetUrl(PATH) : PATH;
    const get = typeof window.fetchWithTimeout === 'function'
      ? window.fetchWithTimeout(url, { cache: 'no-store' }, 20000)
      : window.fetch(url, { cache: 'no-store' });
    _loading = Promise.resolve(get)
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        _file = d && d.geos ? d : null;
        return _file;
      })
      .catch(() => null)
      .then((d) => {
        _loading = null;
        return d;
      });
    return _loading;
  }

  function entry(geoid, field) {
    if (!_file || !geoid) return null;
    const g = _file.geos[String(geoid)];
    return (g && g[field]) || null;
  }

  /** The entry for this figure when `value` is the estimate it describes. */
  function forValue(geoid, field, value) {
    const e = entry(geoid, field);
    if (!e || e.e == null || value == null || !Number.isFinite(Number(value))) return null;
    return Math.abs(Number(value) - Number(e.e)) < TOLERANCE ? e : null;
  }

  function _fmt(n, unit) {
    const v = Math.abs(Number(n));
    if (unit === 'money') return '$' + Math.round(v).toLocaleString('en-US');
    if (unit === 'pct') return v.toFixed(1) + ' pts';
    if (unit === 'min') return v.toFixed(1) + ' min';
    return Math.round(v).toLocaleString('en-US');
  }

  function _fmtValue(n, unit) {
    if (unit === 'money') return '$' + Math.round(n).toLocaleString('en-US');
    if (unit === 'pct') return n.toFixed(1) + '%';
    if (unit === 'min') return n.toFixed(1) + ' min';
    return Math.round(n).toLocaleString('en-US');
  }

  /**
   * The Census 90% range of a figure, clipped at 0 and, for a percentage, at
   * 100, as the Census Bureau advises for a margin larger than its estimate.
   */
  function range(e, unit) {
    if (!e || e.e == null || e.m == null) return null;
    let lo = Math.max(0, e.e - e.m);
    let hi = e.e + e.m;
    if (unit === 'pct') hi = Math.min(100, hi);
    return { lo, hi, text: _fmtValue(lo, unit) + ' to ' + _fmtValue(hi, unit) };
  }

  /**
   * Plain text for the source line: the margin, then the tier when it is not
   * good. Returns '' when the figure has no sampling error (a total controlled
   * to the Census population estimates).
   */
  function describe(e, unit) {
    if (!e) return '';
    if (e.m == null) return 'margin not published';
    if (Number(e.m) === 0) return '';
    const moe = '±' + _fmt(e.m, unit);
    if (e.t === 'zero_in_sample') return 'none in the survey sample (' + moe + ')';
    if (e.t === 'fair') return moe + ' · fair';
    if (e.t === 'use_with_caution') {
      const r = range(e, unit);
      return moe + ' · use with caution' + (r ? ' (Census range ' + r.text + ')' : '');
    }
    return moe;
  }

  /**
   * The tier for a coefficient of variation, by the rule the file is built
   * with (scripts/hna/build_acs_reliability.py tier_for): good at 15% or less,
   * fair to 30%, use with caution above that.
   */
  function tierForCv(cv) {
    if (cv == null || !Number.isFinite(Number(cv))) return null;
    if (cv <= 0.15) return 'good';
    if (cv <= 0.30) return 'fair';
    return 'use_with_caution';
  }

  /**
   * For a 1-year figure, its 5-year twin, the series every smaller geography
   * has: "5-year 2020–2024: $1,781 ±$22 · this figure is $89 higher". The two
   * cover different periods, so the gap is partly change over time; it is not
   * a significance test. '' when the entry has no twin.
   */
  function fiveYear(e, unit) {
    const f = e && e.five;
    if (!f || f.e == null || f.y == null || e.e == null) return '';
    const margin = describe(f, unit);
    const diff = Number(e.e) - Number(f.e);
    const gap = Math.abs(diff) < TOLERANCE
      ? 'same as this figure'
      : 'this figure is ' + _fmt(diff, unit) + (diff > 0 ? ' higher' : ' lower');
    return '5-year ' + (f.y - 4) + '–' + f.y + ': ' + _fmtValue(Number(f.e), unit)
      + (margin ? ' ' + margin : '') + ' · ' + gap;
  }

  /** "5-year" or "1-year" for an entry's series. */
  function seriesLabel(e) {
    if (!e || !e.s) return '';
    return e.s === 'acs1' ? '1-year' : '5-year';
  }

  window.ACSReliability = {
    PATH,
    TIER_LABEL,
    load,
    entry,
    forValue,
    range,
    describe,
    fiveYear,
    tierForCv,
    seriesLabel,
    // Tests replace the loaded file without a fetch.
    _setFile(d) { _file = d && d.geos ? d : null; _loading = null; },
  };
})();
