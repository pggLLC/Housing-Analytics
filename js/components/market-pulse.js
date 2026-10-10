/**
 * js/components/market-pulse.js
 * ==============================
 * The Insights page's Risk Indicators and Rates & Deadlines cards, read from
 * the data files that workflows (or a tracked hand capture) keep current:
 *
 *   data/fred-data.json                              daily (fetch-fred-data.yml)
 *   data/market/aamd-denver-vacancy.json             quarterly, by hand; the
 *                                                    market-rents workflow opens
 *                                                    an issue when AAMD publishes
 *   data/market/colorado-foreclosure-performance.json quarterly (FHFA NMDB)
 *   data/chfa-qap-calendar.json                      weekly (chfa-qap-watch.yml)
 *
 * The pure helpers are exported so tests can check the page against the files.
 * A value that is missing stays null and renders as "Value unavailable"; it is
 * never coerced to 0 (AGENTS.md, "An unmeasurable quantity is null").
 */
(function (global) {
  'use strict';
  if (global.MarketPulse) return;

  var URLS = {
    fred: 'data/fred-data.json',
    vacancy: 'data/market/aamd-denver-vacancy.json',
    foreclosure: 'data/market/colorado-foreclosure-performance.json',
    calendar: 'data/chfa-qap-calendar.json'
  };

  var RATES = [
    { id: 'DGS10', label: '10-yr Treasury' },
    { id: 'SOFR', label: 'SOFR' },
    { id: 'MORTGAGE30US', label: '30-yr mortgage' }
  ];

  // Categories in the CHFA calendar a developer has to act on. Awards and
  // board approvals are announcements, not deadlines.
  var DEADLINE_CATEGORY = /deadline|loi|comment/;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function toNumber(v) {
    if (v == null || v === '' || v === '.') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function fmtDay(s) {
    var t = parseDay(s);
    if (t == null) return null;
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  function fmtMonth(s) {
    var t = parseDay(s);
    if (t == null) return null;
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /** Latest observation of a FRED series with a numeric value, or null. */
  function latest(series) {
    var obs = series && series.observations;
    if (!obs || !obs.length) return null;
    for (var i = obs.length - 1; i >= 0; i--) {
      var v = toNumber(obs[i].value);
      if (v != null && parseDay(obs[i].date) != null) return { date: obs[i].date, value: v };
    }
    return null;
  }

  /**
   * The observation on or before `days` days before `at`, or null when the
   * series does not reach back that far.
   */
  function before(series, at, days) {
    var obs = series && series.observations;
    var t = parseDay(at);
    if (!obs || t == null) return null;
    var cutoff = t - days * 86400000;
    for (var i = obs.length - 1; i >= 0; i--) {
      var d = parseDay(obs[i].date);
      var v = toNumber(obs[i].value);
      if (d != null && d <= cutoff && v != null) return { date: obs[i].date, value: v };
    }
    return null;
  }

  /** Rows for the rates table: latest value, its date, and the 1-year change in basis points. */
  function rates(fred) {
    var s = (fred && fred.series) || {};
    return RATES.map(function (r) {
      var now = latest(s[r.id]);
      var then = now ? before(s[r.id], now.date, 365) : null;
      return {
        id: r.id,
        label: r.label,
        value: now ? now.value : null,
        date: now ? now.date : null,
        changeBps: now && then ? Math.round((now.value - then.value) * 100) : null
      };
    });
  }

  /**
   * The next `n` CHFA deadlines on or after `today` (YYYY-MM-DD). Decided by
   * date, not by the file's hand-set status, so a date that has passed drops
   * off even if nobody flipped it to "past".
   */
  function nextDeadlines(calendar, today, n) {
    var t = parseDay(today);
    if (t == null) return [];
    return ((calendar && calendar.events) || [])
      .filter(function (e) {
        var d = parseDay(e.date);
        return d != null && d >= t && DEADLINE_CATEGORY.test(e.category || '');
      })
      .sort(function (a, b) { return parseDay(a.date) - parseDay(b.date); })
      .slice(0, n || 3)
      .map(function (e) {
        return {
          id: e.id,
          name: e.name,
          date: e.date,
          days: Math.round((parseDay(e.date) - t) / 86400000),
          draft: e.qap_status === 'draft',
          url: e.url || null
        };
      });
  }

  /** The three Risk Indicators rows. Each value is null when its file lacks it. */
  function risk(fred, vacancy, foreclosure) {
    var cour = latest(fred && fred.series && fred.series.COUR);
    var metro = vacancy && vacancy.metro;
    var vmeta = (vacancy && vacancy.meta) || {};
    var fsum = (foreclosure && foreclosure.summary) || {};
    var fmeta = (foreclosure && foreclosure.meta) || {};
    var fNow = toNumber(fsum.latest_foreclosure_process_pct);
    var fPeak = toNumber(fsum.peak_foreclosure_process_pct);
    return {
      unemployment: {
        value: cour ? cour.value : null,
        period: cour ? fmtMonth(cour.date) : null,
        bar: cour ? Math.min(100, cour.value * 10) : null
      },
      vacancy: {
        value: metro ? toNumber(metro.stabilized_vacancy_pct) : null,
        priorQuarter: metro ? toNumber(metro.stabilized_vacancy_prior_quarter_pct) : null,
        yearAgo: metro ? toNumber(metro.stabilized_vacancy_year_ago_pct) : null,
        vintage: vmeta.vintage || null,
        sourceUrl: vmeta.source_url || null,
        bar: metro && toNumber(metro.stabilized_vacancy_pct) != null
          ? Math.min(100, toNumber(metro.stabilized_vacancy_pct) * 10) : null
      },
      foreclosure: {
        value: fNow,
        seriousDelinquency: toNumber(fsum.latest_serious_delinquency_pct),
        peak: fPeak,
        peakPeriod: fsum.peak_foreclosure_process_period || null,
        period: fsum.latest_period || fmeta.data_through || null,
        sourceUrl: fmeta.source_landing_url || fmeta.source_url || null,
        // Share of the 2010 peak: 0 is a real reading here only when the
        // file says 0, never when a field is missing.
        bar: fNow != null && fPeak != null && fPeak > 0 ? Math.min(100, fNow / fPeak * 100) : null
      }
    };
  }

  // ---- rendering --------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pct(v, digits) { return v == null ? 'Value unavailable' : v.toFixed(digits == null ? 1 : digits) + '%'; }
  function bps(v) {
    if (v == null) return '—';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' bp';
  }
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function setHtml(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
  function setBar(id, width) {
    var el = document.getElementById(id);
    if (el) el.style.width = (width == null ? 0 : width).toFixed(0) + '%';
  }

  function renderRisk(r) {
    setText('insightsRiskUnemp', pct(r.unemployment.value));
    setBar('insightsRiskUnempBar', r.unemployment.bar);
    setText('insightsRiskUnempBasis', r.unemployment.period
      ? r.unemployment.period + ', Colorado statewide, seasonally adjusted'
      : 'Colorado statewide rate unavailable');

    var v = r.vacancy;
    setText('insightsRiskVacancy', pct(v.value));
    setBar('insightsRiskVacancyBar', v.bar);
    var vb = [];
    if (v.vintage) vb.push(v.vintage.replace('-', ' '));
    vb.push('stabilized, metro');
    if (v.priorQuarter != null) vb.push(pct(v.priorQuarter) + ' last quarter');
    if (v.yearAgo != null) vb.push(pct(v.yearAgo) + ' a year ago');
    setText('insightsRiskVacancyBasis', vb.join(' · '));
    var vl = document.getElementById('insightsRiskVacancySource');
    if (vl && v.sourceUrl) vl.setAttribute('href', v.sourceUrl);

    var f = r.foreclosure;
    setText('insightsRiskForeclosure', pct(f.value));
    setBar('insightsRiskForeclosureBar', f.bar);
    var fb = [];
    if (f.period) fb.push(f.period.replace(/(\d{4})Q(\d)/, '$1 Q$2'));
    fb.push('of loans in foreclosure');
    if (f.seriousDelinquency != null) fb.push(pct(f.seriousDelinquency) + ' seriously delinquent');
    if (f.peak != null && f.peakPeriod) fb.push('peak ' + pct(f.peak) + ' in ' + f.peakPeriod.replace(/(\d{4})Q(\d)/, '$1 Q$2'));
    setText('insightsRiskForeclosureBasis', fb.join(' · '));
  }

  function renderRates(rows) {
    setHtml('insightsRatesRows', rows.map(function (r) {
      return '<tr data-rate="' + esc(r.id) + '"><td>' + esc(r.label) + '</td>' +
        '<td style="font-weight:700;color:var(--accent);">' + pct(r.value, 2) + '</td>' +
        '<td>' + bps(r.changeBps) + '</td>' +
        '<td>' + esc(fmtDay(r.date) || '—') + '</td></tr>';
    }).join(''));
  }

  function renderDeadlines(list) {
    if (!list.length) {
      setHtml('insightsDeadlines', '<li>No upcoming CHFA deadlines are in the calendar file.</li>');
      return;
    }
    setHtml('insightsDeadlines', list.map(function (e) {
      var name = e.url
        ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.name) + '</a>'
        : esc(e.name);
      return '<li data-deadline="' + esc(e.id) + '"><strong>' + esc(fmtDay(e.date)) + '</strong> · ' +
        e.days + (e.days === 1 ? ' day' : ' days') + '<br>' + name +
        (e.draft ? ' <span style="color:var(--warn);font-weight:700;">DRAFT QAP</span>' : '') + '</li>';
    }).join(''));
  }

  function todayIso() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function load(fetchImpl) {
    var f = fetchImpl || (global.fetch && global.fetch.bind(global));
    var get = function (path) {
      var url = typeof global.resolveAssetUrl === 'function' ? global.resolveAssetUrl(path) : path;
      return f(url, { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    };
    return Promise.all([get(URLS.fred), get(URLS.vacancy), get(URLS.foreclosure), get(URLS.calendar)])
      .then(function (d) { return { fred: d[0], vacancy: d[1], foreclosure: d[2], calendar: d[3] }; });
  }

  function attach(opts) {
    var today = (opts && opts.today) || todayIso();
    return load(opts && opts.fetch).then(function (d) {
      renderRisk(risk(d.fred, d.vacancy, d.foreclosure));
      renderRates(rates(d.fred));
      renderDeadlines(nextDeadlines(d.calendar, today, 3));
      return d;
    });
  }

  global.MarketPulse = {
    URLS: URLS,
    latest: latest,
    before: before,
    rates: rates,
    nextDeadlines: nextDeadlines,
    risk: risk,
    load: load,
    attach: attach
  };
})(typeof window !== 'undefined' ? window : globalThis);
