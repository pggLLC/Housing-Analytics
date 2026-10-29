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
 * A second line, "capture with relocation", grows the county pool only by a
 * share documented at comparable Colorado projects measured at the county
 * line (data/market/relocation-comparables.json, low end of the range),
 * capped at the county's lower-paid workers who commute in 20-60 miles
 * (data/market/commute-strength.json). No comparable on file, no number.
 *
 * The pool here is county renters at or under each tier, without CHFA's
 * rent floor or household-size fit, so the card shows the share with no
 * CHFA verdict. The 85% line from CHFA's 2027-28 draft QAP is applied in
 * the Market Analysis simulator to the CHFA-rule count.
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
  var COMPS_URL = 'data/market/relocation-comparables.json';
  var COMMUTE_URL = 'data/market/commute-strength.json';

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

  var _compsCache = null, _commuteCache = null;
  function _loadJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function loadRelocation() {
    if (!_compsCache) _compsCache = _loadJson(COMPS_URL);
    if (!_commuteCache) _commuteCache = _loadJson(COMMUTE_URL);
    return Promise.all([_compsCache, _commuteCache]);
  }

  // Pure: the relocation line for one county. baseHh is the portfolio pool
  // before the manual in-migration input, so the two never stack.
  function relocationLine(fips, units, baseHh, comps, commute) {
    fips = String(fips).padStart(5, '0');
    var rows = ((comps && comps.comparables) || []).filter(function (c) { return c.county_fips === fips; });
    var county = rows.filter(function (c) { return c.measure === 'outside_county'; });
    var cc = commute && commute.counties ? commute.counties[fips] : null;
    var pool = cc && cc.far_low != null ? +cc.far_low : null;
    var out = { evidence: rows, used: null, share: null, added: null, cap: pool,
      capped: false, rate: null, baseRate: (baseHh > 0) ? units / baseHh * 100 : null };
    if (!county.length || !(baseHh > 0)) return out;
    // Lowest documented share across county-line comparables.
    var used = county.reduce(function (a, b) { return (+b.share_low < +a.share_low) ? b : a; });
    var s = +used.share_low / 100;
    if (!(s > 0 && s < 1)) return out;
    var added = baseHh * s / (1 - s);
    if (pool != null && added > pool) { added = pool; out.capped = true; }
    out.used = used; out.share = +used.share_low; out.added = Math.round(added);
    out.rate = units / (baseHh + out.added) * 100;
    return out;
  }

  function _relocationBox(box, fips, units, baseHh, comps, commute) {
    var r = relocationLine(fips, units, baseHh, comps, commute);
    box.innerHTML = '';
    box.appendChild($h('div', {}, [
      $h('strong', {}, ['Capture with relocation: ']),
      r.rate == null ? $h('span', { 'data-relocation-rate': 'none' }, ['no number'])
        : $h('span', { 'data-relocation-rate': r.rate.toFixed(1), style: { fontWeight: '600' } }, [$pct(r.rate)]),
      ' · without relocation ' + $pct(r.baseRate)
    ]));
    var note;
    if (r.used) {
      note = 'Adds ' + $fmt(r.added) + ' households, using the low end (' + r.share + '%) of tenants from outside the county at ' +
        r.used.property + '. ' + (r.capped ? 'Capped at ' : 'The cap is ') + $fmt(r.cap) +
        ' lower-paid workers who commute 20 to 60 miles into the county (LODES 2023). Use this line as a range check, not the base case.';
    } else {
      note = 'No comparable evidence of tenants relocating from outside this county is on file, so no relocation number is shown. CHFA allows in-migration only when comparable projects demonstrate it.' +
        (r.cap != null ? ' For context, ' + $fmt(r.cap) + ' lower-paid workers commute 20 to 60 miles into the county (LODES 2023).' : '');
    }
    box.appendChild($h('div', { style: { marginTop: '.2rem', color: 'var(--muted)', fontSize: '.74rem' } }, [note]));
    r.evidence.forEach(function (c) {
      box.appendChild($h('div', { 'data-relocation-comp': c.id, style: { marginTop: '.3rem', fontSize: '.74rem', color: 'var(--muted)' } }, [
        c.property + ' (' + c.round + ', ' + (c.measure === 'outside_county' ? 'from outside the county' : 'from outside its market area, shown for context only') + '): “' + c.quote + '” ',
        $h('a', { href: c.source_url + '#page=' + c.pdf_page, target: '_blank', rel: 'noopener' }, [c.source_title + ', p. ' + c.pdf_page])
      ]));
    });
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
    // County renters at or under the tier, with no rent floor or size fit:
    // not CHFA's qualified pool, so no CHFA verdict here. The simulator
    // applies the 85% check (CHFA 2027-28 draft QAP) to the CHFA-rule count.
    return { color: 'var(--muted)', label: 'County share, not the CHFA check' };
  }

  function _marketRows(container, rows) {
    rows.filter(function (r) { return r.ami_tier === 'market'; }).forEach(function (r) {
      container.appendChild($h('p', { 'data-market-rate': 'true' }, [
        (r.bedrooms || 'Bedroom unavailable') + ' · ' + (r.count == null ? 'Count unavailable' : r.count + ' units') +
        ' · Market rate — excluded from restricted demand and income limits.'
      ]));
    });
  }

  function render(container) {
    if (!container) return;
    // Invalidate pending work even when this render takes a synchronous early return.
    var generation = (container._subjectRenderGeneration || 0) + 1;
    container._subjectRenderGeneration = generation;
    var SP = global.SubjectProject;
    if (!SP) { _renderEmpty(container, 'SubjectProject not loaded.'); return; }
    var subject = SP.get();
    var marketRows = (subject.unit_mix || []).filter(function (r) { return r.ami_tier === 'market'; });
    if (marketRows.length && marketRows.length === subject.unit_mix.length) {
      container.innerHTML = '';
      _marketRows(container, marketRows);
      return;
    }
    if (!subject.county_fips) {
      _renderEmpty(container, 'Pick a county in the Subject Project above to compute demand.');
      _marketRows(container, marketRows);
      return;
    }
    if (!subject.unit_mix || subject.unit_mix.length === 0) {
      _renderEmpty(container, 'Add unit-mix rows in the Subject Project above to compute capture rates.');
      return;
    }

    loadGap().then(function (gap) {
      if (container._subjectRenderGeneration !== generation) return;
      if (!gap) { _renderEmpty(container, 'Could not load AMI-gap data.'); _marketRows(container, marketRows); return; }
      var countyRow = _findCounty(gap, subject.county_fips);
      if (!countyRow) {
        _renderEmpty(container, 'No AMI-gap data for the selected county yet.');
        _marketRows(container, marketRows);
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
        if (r.ami_tier === 'market') return;
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
      var grandSubject = 0, grandHh = 0, grandHhBase = 0;
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
        if (hh) grandHhBase = Math.max(grandHhBase, hh);

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

      _marketRows(container, marketRows);

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
          'This share uses county renters at or under each tier, not CHFA\'s qualified pool; the capture simulator applies the 85% check from CHFA\'s 2027-28 draft QAP.'
        ])
      ]));

      var relocBox = $h('div', { 'data-relocation-line': 'true', style: {
        marginTop: '.45rem', padding: '.55rem .7rem',
        background: 'var(--card2,#1a1a1a)', border: '1px solid var(--border)',
        borderRadius: '4px', fontSize: '.82rem', lineHeight: '1.55'
      } }, ['Loading relocation evidence…']);
      container.appendChild(relocBox);
      loadRelocation().then(function (res) {
        if (container._subjectRenderGeneration !== generation) return;
        _relocationBox(relocBox, subject.county_fips, grandSubject, grandHhBase, res[0], res[1]);
      });

      // Limitations
      container.appendChild($h('div', { style: { marginTop: '.5rem',
        padding: '.55rem .7rem', borderLeft: '3px solid var(--border)',
        background: 'var(--bg,#111)', borderRadius: '0 4px 4px 0',
        color: 'var(--muted)', fontSize: '.74rem', lineHeight: '1.55' } }, [
        $h('strong', { style: { color: 'var(--text)' } }, ['Screening-grade caveats. ']),
        'County-level qualifying HHs (not PMA-tract-level). ',
        'Cumulative ≤ AMI tier, not the tier-interval band — overstates demand depth at higher AMI bands. ',
        'Existing-affordable count includes naturally affordable units (ACS-reported low rent), ',
        'not just LIHTC-restricted; the restricted and assisted supply is in the Existing affordable supply in buffer card. ',
        'Does not deduct under-construction pipeline units. ',
        'CHFA-graded studies use PMA-tract qualifying HHs by HH size and net out the pipeline — ',
        'see the "When to commission a professional market study" card below.'
      ]));

      if (rowsRendered === 0 && marketRows.length === 0) {
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

  global.SubjectCaptureStack = { attach: attach, render: render, relocationLine: relocationLine };
})(window);
