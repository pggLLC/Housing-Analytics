/**
 * js/components/subject-rent-comparison.js
 * ===============================================================
 * Per-AMI-tier rent comparison card. Reads the Subject Project's
 * unit_mix and computes, for each row:
 *
 *   • LIHTC max gross rent  (from county MTSP income limits)
 *   • LIHTC max net rent    (gross − utility allowance)
 *   • Proposed gross rent   (as entered)
 *   • Headroom              (max − proposed) — negative means OVER MAX
 *   • Rent advantage vs HUD FMR  (proposed − FMR for matching bedroom)
 *     — only available where FMR is published (Eff/1BR/2BR/3BR/4BR).
 *
 * The "rent advantage" surfaces whether the LIHTC-restricted rent is
 * meaningfully below market — the headline finding in any CHFA-graded
 * market study. Negative % = below FMR = market-achievable.
 *
 * Mount target: any container with id="subjectRentComparisonMount".
 * Refreshes automatically when SubjectProject.subscribe fires.
 */
(function (global) {
  'use strict';
  if (global.SubjectRentComparison) return;

  function $h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.keys(attrs[k]).forEach(function (sk) { el.style[sk] = attrs[k][sk]; });
      } else if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function $money(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function $pct(n) {
    if (n == null || isNaN(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }

  var BR_TO_FMR_KEY = {
    'efficiency': 'efficiency',
    '1BR': 'one_br',
    '2BR': 'two_br',
    '3BR': 'three_br',
    '4BR': 'four_br'
  };

  function _countyRow(hud, fips) {
    if (!hud || !fips) return null;
    fips = String(fips).padStart(5, '0');
    return (hud.counties || []).find(function (c) { return c.fips === fips; }) || null;
  }

  function _renderEmpty(container, msg) {
    container.innerHTML = '';
    container.appendChild($h('div', { class: 'pma-empty', style: {
      padding: '1rem .5rem', color: 'var(--muted)', fontSize: '.85rem'
    } }, [msg]));
  }

  function render(container) {
    if (!container) return;
    var SP = global.SubjectProject;
    if (!SP) { _renderEmpty(container, 'SubjectProject module not loaded.'); return; }
    var subject = SP.get();
    if (!subject.county_fips) {
      _renderEmpty(container, 'Pick a county in the Subject Project above to compute LIHTC max rents.');
      return;
    }
    if (!subject.unit_mix || subject.unit_mix.length === 0) {
      _renderEmpty(container, 'Add unit-mix rows in the Subject Project above to compare rents.');
      return;
    }

    SP.loadHud().then(function (hud) {
      if (!hud) { _renderEmpty(container, 'Could not load HUD income limits.'); return; }
      var countyRow = _countyRow(hud, subject.county_fips);
      var fmr = countyRow ? countyRow.fmr : null;

      container.innerHTML = '';
      var hdr = $h('div', { style: { marginBottom: '.4rem',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '8px' } }, [
        $h('h2', { style: { margin: 0 } }, ['Rent Comparison — Subject vs LIHTC Max vs Market']),
        $h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, [
          'County: ' + (countyRow ? countyRow.county_name : '—') +
          ' · MTSP FY' + (hud.meta ? hud.meta.fiscal_year : '—') +
          ' · As of ' + (hud.meta && hud.meta.generated ? String(hud.meta.generated).slice(0,10) : '—')
        ])
      ]);
      container.appendChild(hdr);

      container.appendChild($h('p', { style: { margin: '0 0 .55rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'LIHTC max gross is the IRS §42 ceiling. "vs FMR" shows the proposed rent ' +
        'as a percent of HUD Fair Market Rent for the matching bedroom — negative ' +
        'means the proposed rent is below market and likely achievable. Rows ',
        $h('strong', {}, ['flagged red']),
        ' have a proposed rent OVER the LIHTC max (non-compliant).'
      ]));

      var tableWrap = $h('div', { style: { overflowX: 'auto',
        border: '1px solid var(--border)', borderRadius: '4px' } });
      var t = $h('table', { style: { width: '100%', borderCollapse: 'collapse',
        fontSize: '.78rem' } });
      var thead = $h('thead', { style: { background: 'var(--card2,#1a1a1a)',
        textTransform: 'uppercase', fontSize: '.66rem', letterSpacing: '.03em',
        color: 'var(--muted)' } }, [
        $h('tr', {}, [
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Bedrooms']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['AMI']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Units']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Proposed gross']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Util. allow.']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max gross']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Headroom']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['HUD FMR']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['vs FMR'])
        ])
      ]);
      var tbody = $h('tbody', {});
      t.appendChild(thead); t.appendChild(tbody);

      var totalUnits = 0, sumProposed = 0, sumLihtcCap = 0, overMax = 0;
      var sumFmr = 0, countWithFmr = 0;

      subject.unit_mix.forEach(function (r) {
        var lihtc = SP.computeLihtcMaxRent(hud, subject.county_fips, r.ami_tier, r.bedrooms);
        var maxGross = lihtc ? lihtc.gross_rent : null;
        var proposed = +r.proposed_gross_rent || null;
        var ua = +r.utility_allowance || 0;
        var headroom = (maxGross != null && proposed != null) ? maxGross - proposed : null;
        var over = (maxGross != null && proposed != null && proposed > maxGross);
        var fmrKey = BR_TO_FMR_KEY[r.bedrooms];
        var fmrVal = (fmr && fmrKey && fmr[fmrKey] != null) ? +fmr[fmrKey] : null;
        var vsFmr = (proposed != null && fmrVal) ? ((proposed - fmrVal) / fmrVal) * 100 : null;
        var count = +r.count || 0;

        totalUnits += count;
        if (proposed != null) sumProposed += proposed * count;
        if (maxGross != null) sumLihtcCap += maxGross * count;
        if (fmrVal != null) { sumFmr += fmrVal * count; countWithFmr += count; }
        if (over) overMax += count;

        tbody.appendChild($h('tr', {
          style: { background: over ? 'rgba(193,69,69,0.07)' : 'transparent' }
        }, [
          $h('td', { style: { padding: '5px 6px' } }, [r.bedrooms === 'efficiency' ? 'Eff' : r.bedrooms]),
          $h('td', { style: { padding: '5px 6px' } }, [r.ami_tier + '%']),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [String(count)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: over ? 'var(--bad,#c14545)' : 'var(--text)',
            fontWeight: over ? '600' : '400' } }, [$money(proposed)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' } }, [$money(ua || null)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [$money(maxGross)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: headroom == null ? 'var(--muted)' : (headroom < 0 ? 'var(--bad,#c14545)' : 'var(--good,#3da670)') } }, [
            headroom == null ? '—' : (headroom >= 0 ? '+' : '') + $money(headroom).replace('$', '$')
          ]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' } }, [$money(fmrVal)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: vsFmr == null ? 'var(--muted)' : (vsFmr < 0 ? 'var(--good,#3da670)' : 'var(--bad,#c14545)') } }, [
            $pct(vsFmr)
          ])
        ]));
      });

      tableWrap.appendChild(t);
      container.appendChild(tableWrap);

      // Summary strip
      var avgProposed = totalUnits ? sumProposed / totalUnits : null;
      var avgLihtc    = totalUnits ? sumLihtcCap / totalUnits : null;
      var avgFmr      = countWithFmr ? sumFmr / countWithFmr : null;
      var overallVsFmr = (avgProposed != null && avgFmr) ?
        ((avgProposed - avgFmr) / avgFmr) * 100 : null;

      container.appendChild($h('div', { style: {
        marginTop: '.55rem', padding: '.55rem .7rem',
        background: 'var(--card2,#1a1a1a)', border: '1px solid var(--border)',
        borderRadius: '4px', fontSize: '.78rem', lineHeight: '1.55'
      } }, [
        $h('div', {}, [
          $h('strong', {}, ['Portfolio averages — ']),
          'Proposed: ', $money(avgProposed), ' · ',
          'LIHTC max: ', $money(avgLihtc), ' · ',
          'HUD FMR: ', $money(avgFmr)
        ]),
        overallVsFmr != null ? $h('div', { style: { marginTop: '.25rem',
          color: overallVsFmr < 0 ? 'var(--good,#3da670)' : 'var(--bad,#c14545)' } }, [
          'Weighted rent advantage vs HUD FMR: ', $pct(overallVsFmr),
          overallVsFmr < 0 ? ' — proposed rent is below market on average (market-achievable).'
                           : ' — proposed rent is at or above market. Re-test demand.'
        ]) : null,
        overMax > 0 ? $h('div', { style: { marginTop: '.25rem', color: 'var(--bad,#c14545)',
          fontWeight: '600' } }, [
          '⚠ ' + overMax + ' unit' + (overMax === 1 ? '' : 's') +
          ' priced over LIHTC max — non-compliant. Lower proposed rent or change AMI tier.'
        ]) : null
      ]));

      // Methodology note + source attribution
      container.appendChild($h('p', { style: { marginTop: '.45rem',
        fontSize: '.7rem', color: 'var(--muted)' } }, [
        'LIHTC max gross = 30% × MTSP income limit ÷ 12, with imputed family size by bedroom ',
        '(Eff=1.0, 1BR=1.5, 2BR=3.0, 3BR=4.5, 4BR=6.0). FMR = HUD published FMR for the county. ',
        'Source: ',
        $h('a', { href: 'https://www.huduser.gov/portal/datasets/mtsp.html', target: '_blank', rel: 'noopener' }, ['HUD MTSP']),
        ' · ',
        $h('a', { href: 'https://www.huduser.gov/portal/datasets/fmr.html', target: '_blank', rel: 'noopener' }, ['HUD FMR'])
      ]));
    });
  }

  // Subscribe to changes from Subject Project
  var _mounted = null;
  function attach(container) {
    _mounted = container;
    render(container);
    if (global.SubjectProject && global.SubjectProject.subscribe) {
      global.SubjectProject.subscribe(function () {
        if (_mounted) render(_mounted);
      });
    }
  }

  global.SubjectRentComparison = { attach: attach, render: render };

})(window);
