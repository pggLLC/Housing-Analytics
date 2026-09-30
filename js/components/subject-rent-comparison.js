/**
 * js/components/subject-rent-comparison.js
 * ===============================================================
 * Per-AMI-tier rent comparison card. Reads the Subject Project's
 * unit_mix and computes, for each row:
 *
 *   • LIHTC max gross rent  (from county MTSP income limits)
 *   • LIHTC max net rent    (gross − utility allowance − fees)
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

  function _renderEmpty(container, msg) {
    container.innerHTML = '';
    container.appendChild($h('div', { class: 'pma-empty', style: {
      padding: '1rem .5rem', color: 'var(--muted)', fontSize: '.85rem'
    } }, [msg]));
  }

  function render(container) {
    if (!container) return;
    // Invalidate pending work even when this render takes a synchronous early return.
    var generation = (container._subjectRenderGeneration || 0) + 1;
    container._subjectRenderGeneration = generation;
    var SP = global.SubjectProject;
    if (!SP) { _renderEmpty(container, 'SubjectProject module not loaded.'); return; }
    var subject = SP.get();
    if (!subject.county_fips && (subject.unit_mix || []).some(function (r) { return r.ami_tier !== 'market'; })) {
      _renderEmpty(container, 'Pick a county in the Subject Project above to compute LIHTC max rents.');
      return;
    }
    if (!subject.unit_mix || subject.unit_mix.length === 0) {
      _renderEmpty(container, 'Add unit-mix rows in the Subject Project above to compare rents.');
      return;
    }

    // Load CHFA (max rents + income limits) AND HUD (FMR — used as the market
    // benchmark only, not for max-rent computation).
    Promise.all([SP.loadChfa(), SP.loadHud()]).then(function (results) {
      if (container._subjectRenderGeneration !== generation) return;
      var chfa = results[0], hud = results[1];
      var limits = global.ChfaRentLimits;
      var chfaRow = limits.countyRow(chfa, subject.county_fips);
      var useHera = !!subject.use_hera_special;
      var hera = useHera && limits.heraStatus(chfa, subject.county_fips, { useHera: useHera, pisDate: subject.pis_date });
      if (hera && !hera.complete && subject.unit_mix.every(function (r) { return r.ami_tier !== 'market'; })) {
        _renderEmpty(container, limits.unavailableMessage(hera.unavailableReason));
        return;
      }
      var schedule = limits.rentSchedule(subject, { chfaTable: chfa, hudTable: hud });
      var basisCaption = limits.allowanceBasisCaption(subject.utility_allowance_basis, subject.county_fips);
      var tableLimit = schedule.rows.map(function (r) { return r.limit; }).find(function (r) { return r.grossRent != null; });

      container.innerHTML = '';
      var hdr = $h('div', { style: { marginBottom: '.4rem',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '8px' } }, [
        $h('h2', { style: { margin: 0 } }, ['Rent Comparison — Subject vs LIHTC Max vs Market']),
        $h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, [
          'County: ' + (chfaRow ? chfaRow.county_name + ' County' : '—') +
          ' · CHFA ' + (tableLimit ? tableLimit.tableYear : '—') +
          ' · eff ' + (tableLimit ? tableLimit.effectiveDate : '—') +
          (useHera ? ' · HERA Special' : '')
        ])
      ]);
      container.appendChild(hdr);

      container.appendChild($h('p', { style: { margin: '0 0 .55rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'LIHTC max gross rent is read directly from CHFA\'s published table — the ' +
        'authoritative reference for CO LIHTC compliance. "vs FMR" shows the proposed rent ' +
        'as a percent of HUD Fair Market Rent for the matching bedroom — negative means ' +
        'the proposed rent is below market and likely achievable. Rows ',
        $h('strong', {}, ['flagged red']),
        ' have a proposed rent OVER the CHFA max (non-compliant).'
      ]));

      var tableWrap = $h('div', { style: { overflowX: 'auto',
        border: '1px solid var(--border)', borderRadius: '4px' } });
      var t = $h('table', { style: { width: '100%', borderCollapse: 'collapse',
        fontSize: '.78rem' } });
      t.appendChild($h('caption', { 'data-role': 'chfa-table-vintage', style: { textAlign: 'left', padding: '6px' } }, [
        (tableLimit ? 'CHFA ' + (tableLimit.tableYear || '—') + ' · effective ' + (tableLimit.effectiveDate || '—')
          : 'CHFA rent limits unavailable for these rows') + (basisCaption ? ' · ' + basisCaption : '')
      ]));
      var thead = $h('thead', { style: { background: 'var(--card2,#1a1a1a)',
        textTransform: 'uppercase', fontSize: '.66rem', letterSpacing: '.03em',
        color: 'var(--muted)' } }, [
        $h('tr', {}, [
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Bedrooms']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['AMI']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Units']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Proposed gross / market rent']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Util. allow.']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Nonoptional fees']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max gross']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['LIHTC max net']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Headroom']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['HUD FMR']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['vs FMR']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Scheduled contract rent'])
        ])
      ]);
      var tbody = $h('tbody', {});
      t.appendChild(thead); t.appendChild(tbody);

      subject.unit_mix.forEach(function (r, i) {
        var result = schedule.rows[i];
        var market = result.isMarket;
        var maxGross = result.limit.grossRent;
        var reason = result.maxNetReason;
        var fees = result.fees;
        var proposed = result.grossResidentRent;
        var ua = result.utilityAllowance;
        var headroom = result.headroom;
        var over = result.rowReason === 'over_chfa_max';
        var fmrVal = result.fmr;
        var vsFmr = result.vsFmr;
        var count = result.count;

        tbody.appendChild($h('tr', { 'data-market-rate': String(market), 'data-row-reason': result.rowReason || '',
          style: { background: over ? 'rgba(193,69,69,0.07)' : 'transparent' }
        }, [
          $h('td', { style: { padding: '5px 6px' } }, [r.bedrooms === 'efficiency' ? 'Eff' : r.bedrooms]),
          $h('td', { style: { padding: '5px 6px' } }, [market ? 'Market rate' : r.ami_tier + '%']),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [count == null ? '—' : String(count)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: over ? 'var(--bad,#c14545)' : 'var(--text)',
            fontWeight: over ? '600' : '400' } }, [$money(proposed)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' } }, [market ? 'Not deducted' : $money(ua)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' },
            'data-fees-entered': String(result.feesEntered),
            title: market ? 'Market rent is used directly' : result.feesEntered ? 'Required nonoptional fees entered' : 'Fees not entered; $0 used' }, [market ? 'Not deducted' : $money(fees)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [market ? 'Market rate' : $money(maxGross)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' },
            'data-net-rent-unavailable': reason || '',
            title: reason === 'utility_allowance_missing' ? SP.UA_MISSING_REASON : (reason || '') }, [
            result.maxNetRent != null ? $money(result.maxNetRent) :
              limits.unavailableMessage(reason)
          ]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: headroom == null ? 'var(--muted)' : (headroom < 0 ? 'var(--bad,#c14545)' : 'var(--good,#3da670)') } }, [
            headroom == null ? '—' : (headroom >= 0 ? '+' : '') + $money(headroom)
          ]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' } }, [$money(fmrVal)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: vsFmr == null ? 'var(--muted)' : (vsFmr < 0 ? 'var(--good,#3da670)' : 'var(--bad,#c14545)') } }, [
            $pct(vsFmr)
          ]),
          $h('td', { 'data-role': 'scheduled-contract-rent', 'data-row-reason': result.rowReason || '', title: result.rowReason || '' }, [
            result.contractRent == null ? limits.unavailableMessage(result.rowReason) : $money(result.contractRent),
            market && result.marketRentSource ? ' · Source: ' + result.marketRentSource : ''
          ])
        ]));
      });

      tableWrap.appendChild(t);
      container.appendChild(tableWrap);

      // All weighted figures come from the same schedule and the same priced rows.
      var comparison = schedule.comparison;
      function summaryMoney(key, label) {
        return $h('div', { 'data-comparison': key, 'data-value': comparison[key] == null ? '' : String(comparison[key]) },
          [label + ': ' + (comparison[key] == null ? 'unavailable' : $money(comparison[key]))]);
      }
      var summary = $h('div', { 'data-role': 'rent-comparison-summary',
        'data-unavailable-reason': comparison.unavailableReason || '',
        style: { marginTop: '.55rem', padding: '.55rem .7rem', border: '1px solid var(--border)', fontSize: '.78rem' }
      }, [
        $h('strong', {}, ['Unit-weighted averages — priced rows only']),
        $h('p', { 'data-role': 'missing-rent-count', 'data-count': String(schedule.missingRentRows.length) }, [
          schedule.missingRentRows.length + ' row(s) missing a rent; ' + comparison.pricedRows + ' priced row(s).'
        ]),
        summaryMoney('grossResidentRent', 'Proposed gross / market rent'),
        summaryMoney('contractRent', 'Contract rent'),
        summaryMoney('utilityAllowance', 'Utility allowance'),
        summaryMoney('maxGrossRent', 'CHFA max gross (priced restricted rows)'),
        summaryMoney('fmr', 'HUD FMR (same priced rows)'),
        $h('div', { 'data-comparison': 'vsFmr', 'data-value': comparison.vsFmr == null ? '' : String(comparison.vsFmr) }, [
          'Weighted rent advantage vs HUD FMR: ' + (comparison.vsFmr == null ? 'unavailable' : $pct(comparison.vsFmr))
        ])
      ]);
      if (comparison.unavailableReason) summary.appendChild($h('p', {}, [
        limits.unavailableMessage(comparison.unavailableReason) +
        (comparison.unavailableReason === 'unit_count_mismatch' ? ': scheduled ' + schedule.scheduledUnits + ' units; project total ' + schedule.projectUnits : '')
      ]));
      if (schedule.unpricedRows.length) summary.appendChild($h('p', {}, [
        'Complete-project totals unavailable. ' + schedule.unpricedRows.map(function (r) {
          return 'Row ' + r.rowNumber + ': ' + limits.unavailableMessage(r.rowReason);
        }).join('; ')
      ]));
      container.appendChild(summary);

      // Methodology note + source attribution
      container.appendChild($h('p', { style: { marginTop: '.45rem',
        fontSize: '.7rem', color: 'var(--muted)' } }, [
        'LIHTC max gross rent is read directly from CHFA\'s published ' + (chfa && chfa.meta ? chfa.meta.fiscal_year : '—') +
        ' rent tables (no formula — the table is the authority). HERA Special limits apply ' +
        'only to Housing Tax Credit projects placed in service on or before 12.31.2008. ',
        'FMR = HUD-published Fair Market Rent for the county. Sources: ',
        $h('a', { href: (chfa && chfa.meta ? chfa.meta.source_url : ''), target: '_blank', rel: 'noopener' },
          ['CHFA Income & Rent Limits ' + (chfa && chfa.meta ? chfa.meta.fiscal_year : '—')]),
        ' · ',
        $h('a', { href: 'https://www.huduser.gov/portal/datasets/fmr.html', target: '_blank', rel: 'noopener' },
          ['HUD FMR FY' + (hud && hud.meta ? hud.meta.fiscal_year : '2026')])
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
