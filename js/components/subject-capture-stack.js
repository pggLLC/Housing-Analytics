/**
 * js/components/subject-capture-stack.js
 * ===============================================================
 * Demand & Capture stack (CHFA method) — anchored to the Subject Project.
 *
 * For each AMI tier in subject.unit_mix:
 *   • Qualifying renter HHs in the county  — from data/co_ami_gap_by_county.json
 *     (cumulative HHs ≤ AMI tier per HUD limits).
 *   • Subject units at that tier
 *   • Capture rate = Subject_units / qualifying_HHs × 100%
 *
 * Also computes overall (portfolio) capture rate folding in the
 * in-migration assumption from Subject Project.
 *
 * CHFA convention: capture < 25% per tier is generally fundable;
 * 25–35% is borderline; > 35% is a red flag for the underwriter.
 *
 * This is screening-grade, not study-grade. The card surfaces what
 * it can NOT do (under-construction unit deduction, household-size
 * decomposition, tract-level granularity) so the user knows when to
 * commission a full study.
 *
 * Mount target: id="subjectCaptureStackMount".
 */
(function (global) {
  'use strict';
  if (global.SubjectCaptureStack) return;

  var AMI_GAP_URL = 'data/co_ami_gap_by_county.json';

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

  function $fmt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }
  function $pct(n) {
    if (n == null || isNaN(n)) return '—';
    return n.toFixed(1) + '%';
  }

  var _gapCache = null;
  function loadGap() {
    if (_gapCache) return _gapCache;
    _gapCache = fetch(AMI_GAP_URL).then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return _gapCache;
  }

  function _findCounty(gap, fips) {
    if (!gap || !gap.counties) return null;
    fips = String(fips).padStart(5, '0');
    return gap.counties.find(function (c) { return c.fips === fips; }) || null;
  }

  function _renderEmpty(container, msg) {
    container.innerHTML = '';
    container.appendChild($h('div', { class: 'pma-empty', style: {
      padding: '1rem .5rem', color: 'var(--muted)', fontSize: '.85rem'
    } }, [msg]));
  }

  function _captureLabel(rate) {
    if (rate == null) return { color: 'var(--muted)', label: '—' };
    if (rate < 10) return { color: 'var(--good,#3da670)', label: 'Strong demand depth' };
    if (rate < 25) return { color: 'var(--good,#3da670)', label: 'Within CHFA range' };
    if (rate < 35) return { color: 'var(--warn,#d9a93b)', label: 'Borderline — sensitivity test' };
    return { color: 'var(--bad,#c14545)', label: 'Saturation risk' };
  }

  function render(container) {
    if (!container) return;
    var SP = global.SubjectProject;
    if (!SP) { _renderEmpty(container, 'SubjectProject not loaded.'); return; }
    var subject = SP.get();
    if (!subject.county_fips) {
      _renderEmpty(container, 'Pick a county in the Subject Project above to compute demand.');
      return;
    }
    if (!subject.unit_mix || subject.unit_mix.length === 0) {
      _renderEmpty(container, 'Add unit-mix rows in the Subject Project above to compute capture rates.');
      return;
    }

    loadGap().then(function (gap) {
      if (!gap) { _renderEmpty(container, 'Could not load AMI-gap data.'); return; }
      var countyRow = _findCounty(gap, subject.county_fips);
      if (!countyRow) {
        _renderEmpty(container, 'No AMI-gap data for the selected county yet.');
        return;
      }
      var hhByTier = countyRow.households_le_ami_pct || {};
      var unitsByTier = countyRow.units_priced_affordable_le_ami_pct || {};

      container.innerHTML = '';
      container.appendChild($h('h2', { style: { margin: '0 0 .25rem' } }, [
        'Demand & Capture Stack (CHFA-style)'
      ]));
      container.appendChild($h('p', { style: { margin: '0 0 .55rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'Per AMI tier in the Subject Project, the capture rate = ',
        $h('em', {}, ['Subject units']),
        ' ÷ ',
        $h('em', {}, ['cumulative qualifying renter HHs ≤ that AMI']),
        '. Rates are CHFA-method but screening-grade — see footnote for limitations.'
      ]));

      // Tally subject units per tier
      var subjectByTier = {};
      subject.unit_mix.forEach(function (r) {
        var t = +r.ami_tier;
        if (!t) return;
        subjectByTier[t] = (subjectByTier[t] || 0) + (+r.count || 0);
      });

      // In-migration adjustment: if 0%, demand = PMA HHs only; if 10%, increase
      // qualifying-HH pool by 10% to reflect renters moving in.
      var inMig = (subject.in_migration_pct == null) ? 0 : +subject.in_migration_pct;
      if (isNaN(inMig)) inMig = 0;
      var inMigFactor = 1 + (inMig / 100);

      var tableWrap = $h('div', { style: { overflowX: 'auto',
        border: '1px solid var(--border)', borderRadius: '4px' } });
      var t = $h('table', { style: { width: '100%', borderCollapse: 'collapse',
        fontSize: '.78rem' } });
      var thead = $h('thead', { style: { background: 'var(--card2,#1a1a1a)',
        textTransform: 'uppercase', fontSize: '.66rem', letterSpacing: '.03em',
        color: 'var(--muted)' } }, [
        $h('tr', {}, [
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['AMI tier']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Subject units']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Qualifying renter HHs (cum.)']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Existing affordable units (cum.)']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Capture rate']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Verdict'])
        ])
      ]);
      var tbody = $h('tbody', {});

      var allTiers = [30, 40, 50, 60, 70, 80];
      var grandSubject = 0, grandHh = 0;
      var rowsRendered = 0;
      allTiers.forEach(function (tier) {
        var nUnits = subjectByTier[tier] || 0;
        if (nUnits === 0) return;  // only show tiers with Subject units
        rowsRendered++;
        var hh = +hhByTier[tier] || null;
        var hhAdj = hh != null ? Math.round(hh * inMigFactor) : null;
        var existing = +unitsByTier[tier] || null;
        var rate = (hhAdj && hhAdj > 0) ? (nUnits / hhAdj) * 100 : null;
        var verdict = _captureLabel(rate);
        grandSubject += nUnits;
        // Portfolio-rate denominator: the cumulative HH count at the HIGHEST
        // Subject AMI tier. Cumulative ≤AMI counts grow monotonically with
        // tier, so Math.max() over the tiers we iterate IS that value. This
        // is the correct pool because a HH that qualifies for the lowest
        // tier (e.g. ≤30% AMI) also qualifies for any higher-AMI Subject
        // unit; only HHs above the highest Subject AMI are ineligible.
        if (hhAdj) grandHh = Math.max(grandHh, hhAdj);

        tbody.appendChild($h('tr', {}, [
          $h('td', { style: { padding: '5px 6px' } }, [tier + '% AMI']),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [String(nUnits)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [$fmt(hhAdj)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' } }, [$fmt(existing)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: verdict.color, fontWeight: '600' } }, [$pct(rate)]),
          $h('td', { style: { padding: '5px 6px', color: verdict.color } }, [verdict.label])
        ]));
      });

      t.appendChild(thead); t.appendChild(tbody);
      tableWrap.appendChild(t);
      container.appendChild(tableWrap);

      // Portfolio summary
      var portfolioRate = (grandHh > 0) ? (grandSubject / grandHh) * 100 : null;
      var port = _captureLabel(portfolioRate);
      container.appendChild($h('div', { style: {
        marginTop: '.55rem', padding: '.55rem .7rem',
        background: 'var(--card2,#1a1a1a)', border: '1px solid var(--border)',
        borderRadius: '4px', fontSize: '.82rem', lineHeight: '1.55'
      } }, [
        $h('div', {}, [
          $h('strong', {}, ['Portfolio capture rate: ']),
          $h('span', { style: { color: port.color, fontWeight: '600' } }, [$pct(portfolioRate)]),
          ' · ',
          $h('span', { style: { color: port.color } }, [port.label])
        ]),
        $h('div', { style: { marginTop: '.2rem', color: 'var(--muted)', fontSize: '.74rem' } }, [
          'Inputs: ' + grandSubject + ' Subject units against ' + $fmt(grandHh) +
          ' qualifying renter HHs (county-level, in-migration ' + inMig + '%). ' +
          'Tiers below 25% are within CHFA range; 25–35% is borderline; ≥35% is saturation risk.'
        ])
      ]));

      // Limitations
      container.appendChild($h('div', { style: { marginTop: '.5rem',
        padding: '.55rem .7rem', borderLeft: '3px solid var(--border)',
        background: 'var(--bg,#111)', borderRadius: '0 4px 4px 0',
        color: 'var(--muted)', fontSize: '.74rem', lineHeight: '1.55' } }, [
        $h('strong', { style: { color: 'var(--text)' } }, ['Screening-grade caveats. ']),
        'County-level qualifying HHs (not PMA-tract-level). ',
        'Cumulative ≤ AMI tier, not the tier-interval band — overstates demand depth at higher AMI bands. ',
        'Existing-affordable count includes naturally affordable units (ACS-reported low rent), ',
        'not just LIHTC-restricted; the actual LIHTC supply is in the LIHTC Supply in Buffer card. ',
        'Does not deduct under-construction pipeline units. ',
        'CHFA-graded studies use PMA-tract qualifying HHs by HH size and net out the pipeline — ',
        'see the "When to commission a professional market study" card below.'
      ]));

      if (rowsRendered === 0) {
        _renderEmpty(container, 'No AMI tiers in the Subject Project unit mix yet.');
        return;
      }
    });
  }

  var _mounted = null;
  function attach(container) {
    _mounted = container;
    render(container);
    if (global.SubjectProject && global.SubjectProject.subscribe) {
      global.SubjectProject.subscribe(function () { if (_mounted) render(_mounted); });
    }
  }

  global.SubjectCaptureStack = { attach: attach, render: render };
})(window);
