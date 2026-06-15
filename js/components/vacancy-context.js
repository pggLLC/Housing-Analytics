/**
 * js/components/vacancy-context.js
 * ===============================================================
 * Renders a vacancy-rate context card on the PMA page.
 *
 * Data landscape for Colorado vacancy:
 *   • Census ACS B25004 (5-year estimates) — best FREE machine-readable
 *     source. Tract-level, annual, ~18 mo lag. Already cached in
 *     data/market/acs_tract_metrics_co.json (1,447 CO tracts, 2023 vintage).
 *     We use this as the primary value below.
 *   • Colorado Division of Housing (DOH) + CHFA quarterly Multi-Family
 *     Vacancy & Rent Survey — historically the gold standard. DOH sponsorship
 *     ended Q2 2020; the survey is now run by 1876 Analytics for CHFA and
 *     published as quarterly PDFs (paid / restricted distribution).
 *     We can't pull it programmatically but we link to it.
 *   • DOLA historical regional series (data.colorado.gov / Socrata) —
 *     publicly downloadable but stops at 2015. Useful only as historical
 *     trend context, not current-state vacancy.
 *   • State Demography Office (SDO) — housing stock + population time-
 *     series; not a vacancy survey but provides denominator data for
 *     deriving vacancy at the county level when ACS coverage is thin.
 *
 * The card surfaces:
 *   1) the buffer-weighted ACS B25004 vacancy rate (the headline figure)
 *   2) per-tract breakdown for the same buffer
 *   3) a small "where this comes from" strip with outbound links to the
 *      three other sources so users can escalate to professional data
 *      when the public-data view isn't enough
 *
 * Mount target: id="pmaVacancyContextMount"
 * Inputs: bufferTracts (array of GEOIDs) — provided by the PMA pipeline.
 */
(function (global) {
  'use strict';
  if (global.VacancyContext) return;

  var DATA_URL = 'data/market/acs_tract_metrics_co.json';

  var _cache = null;
  function _load() {
    if (_cache) return _cache;
    _cache = fetch(DATA_URL)
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return _cache;
  }

  function $h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.keys(attrs[k]).forEach(function (sk) { el.style[sk] = attrs[k][sk]; });
      } else if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function _fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  function _verdict(rate) {
    if (rate == null) return { color: 'var(--muted)', label: '—' };
    if (rate < 0.03) return { color: 'var(--bad)',  label: 'Very tight (<3%) — typical lease-up risk LOW; rent-push risk HIGH' };
    if (rate < 0.05) return { color: 'var(--warn)', label: 'Tight (3-5%) — healthy demand, expect competitive lease-up' };
    if (rate < 0.08) return { color: 'var(--good)', label: 'Balanced (5-8%) — typical Colorado LIHTC underwriting range' };
    return { color: 'var(--warn)', label: 'Soft (>8%) — verify before underwriting; check ACS sample size' };
  }

  function _renderEmpty(container, msg) {
    container.innerHTML = '';
    container.appendChild($h('div', { class: 'pma-empty', style: {
      padding: '1rem .5rem', color: 'var(--muted)', fontSize: '.85rem'
    } }, [msg]));
  }

  /**
   * @param {HTMLElement} container - mount point
   * @param {Object} opts
   * @param {Array<string>} opts.bufferTracts - GEOIDs in the PMA buffer
   * @param {Object} [opts.weightsByTract] - optional polygon-clip share per tract
   */
  function render(container, opts) {
    if (!container) return;
    opts = opts || {};
    var bufferTracts = (opts.bufferTracts || []).map(function (g) { return String(g); });
    if (!bufferTracts.length) {
      _renderEmpty(container, 'Place a site marker above to see ACS vacancy context for the PMA tracts.');
      return;
    }

    _load().then(function (data) {
      if (!data || !data.tracts) {
        _renderEmpty(container, 'Could not load ACS tract metrics (data/market/acs_tract_metrics_co.json).');
        return;
      }

      var byGeoid = {};
      data.tracts.forEach(function (t) { byGeoid[String(t.geoid)] = t; });

      var rows = bufferTracts.map(function (g) {
        var t = byGeoid[g];
        if (!t) return null;
        var w = (opts.weightsByTract && opts.weightsByTract[g]) || 1;
        return { geoid: g, rate: t.vacancy_rate, total_hh: t.total_hh, vacant: t.vacant, weight: w };
      }).filter(Boolean);

      if (!rows.length) {
        _renderEmpty(container, 'No ACS vacancy records found for the ' + bufferTracts.length + ' tract' +
          (bufferTracts.length === 1 ? '' : 's') + ' in the buffer.');
        return;
      }

      // Compute weighted vacancy — weight by (total_hh + vacant) × buffer share
      var num = 0, den = 0;
      rows.forEach(function (r) {
        var stock = (+r.total_hh || 0) + (+r.vacant || 0);
        if (stock <= 0 || r.rate == null) return;
        num += r.rate * stock * r.weight;
        den += stock * r.weight;
      });
      var weightedRate = den > 0 ? (num / den) : null;
      var v = _verdict(weightedRate);

      container.innerHTML = '';

      // Header
      container.appendChild($h('div', { style: {
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '8px', marginBottom: '.4rem'
      } }, [
        $h('h2', { style: { margin: 0 } }, ['Vacancy Context (PMA buffer)']),
        $h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, [
          'ACS B25004 5-yr · vintage ' + (data.meta && data.meta.vintage ? data.meta.vintage : '—')
        ])
      ]));

      // Headline
      container.appendChild($h('div', { style: {
        padding: '.5rem .7rem', background: 'var(--card2,#1a1a1a)',
        border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '.5rem'
      } }, [
        $h('div', {}, [
          $h('strong', { style: { fontSize: '1.05rem' } }, [_fmtPct(weightedRate)]),
          $h('span', { style: { marginLeft: '.4rem', color: 'var(--muted)', fontSize: '.8rem' } }, [
            '· weighted across ' + rows.length + ' tract' + (rows.length === 1 ? '' : 's')
          ])
        ]),
        $h('div', { style: { marginTop: '.2rem', color: v.color, fontSize: '.85rem', fontWeight: '500' } },
          [v.label])
      ]));

      // Per-tract breakdown
      var tableWrap = $h('div', { style: { overflowX: 'auto',
        border: '1px solid var(--border)', borderRadius: '4px' } });
      var t = $h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' } });
      t.appendChild($h('thead', { style: { background: 'var(--card2,#1a1a1a)',
        textTransform: 'uppercase', fontSize: '.66rem', letterSpacing: '.03em',
        color: 'var(--muted)' } }, [
        $h('tr', {}, [
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Tract GEOID']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Vacancy rate']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Vacant units']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Occupied HHs'])
        ])
      ]));
      var tbody = $h('tbody', {});
      rows.sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); }).forEach(function (r) {
        tbody.appendChild($h('tr', {}, [
          $h('td', { style: { padding: '5px 6px', fontFamily: 'var(--font-mono, monospace)' } }, [r.geoid]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [_fmtPct(r.rate)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [r.vacant != null ? String(r.vacant) : '—']),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [r.total_hh != null ? String(r.total_hh) : '—'])
        ]));
      });
      t.appendChild(tbody);
      tableWrap.appendChild(t);
      container.appendChild(tableWrap);

      // Source landscape — outbound links
      container.appendChild($h('div', { style: { marginTop: '.6rem', padding: '.55rem .7rem',
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '4px',
        fontSize: '.74rem', color: 'var(--text)', lineHeight: '1.55' } }, [
        $h('strong', {}, ['Vacancy data landscape. ']),
        'ACS B25004 (above) is the best public per-tract series for CO. ' +
        'For the authoritative current multifamily figure, the ',
        $h('a', { href: 'https://www.chfainfo.com/rental-housing/colorado-statewide-apartment-survey',
          target: '_blank', rel: 'noopener', style: { color: 'var(--link)' } },
          ['Colorado Statewide Apartment Survey']),
        ' (CHFA / 1876 Analytics, quarterly) replaced the DOH-sponsored ',
        $h('a', { href: 'https://doh.colorado.gov/vacancy-and-rent-surveys',
          target: '_blank', rel: 'noopener', style: { color: 'var(--link)' } },
          ['DOH Vacancy & Rent Surveys']),
        ' after Q2 2020 and is paid PDF. For long-run housing-stock context, the ',
        $h('a', { href: 'https://demography.dola.colorado.gov/housing/',
          target: '_blank', rel: 'noopener', style: { color: 'var(--link)' } },
          ['State Demography Office']),
        ' publishes county-level housing-unit estimates and projections. ',
        $h('a', { href: 'https://data.colorado.gov/Local-Aggregation/Vacancies-by-Age-of-Building-for-Colorado-2016/2p2k-iq7f',
          target: '_blank', rel: 'noopener', style: { color: 'var(--link)' } },
          ['DOLA historicals (2006-2015)']),
        ' on data.colorado.gov are too dated for current underwriting but useful for trend context.'
      ]));
    });
  }

  global.VacancyContext = { render: render, load: _load };
})(window);
