/**
 * js/components/subject-income-eligibility.js
 * ===============================================================
 * Income-eligibility table: per AMI tier × bedroom × household size,
 * shows the income BAND a renter must fall into to qualify for the
 * Subject's units.
 *
 *   Max eligible income = HUD MTSP income limit (tier × HH size)
 *   Min eligible income = proposed_gross_rent × 12 ÷ 0.40
 *     (CHFA / NCHMA convention — rent burden ≤ 40% at the floor;
 *      i.e. a renter's annual income must be at least 2.5× their
 *      annual gross rent for them to "qualify down" without burden.)
 *
 * Output is a grid grouped by bedroom, showing the income window
 * per AMI tier as $low – $high. Surfaces a warning when min > max
 * (impossible band — no eligible renters at that rent + AMI tier).
 *
 * Mount target: any container with id="subjectIncomeEligibilityMount".
 */
(function (global) {
  'use strict';
  if (global.SubjectIncomeEligibility) return;

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

  // Imputed HH size by bedroom — IRS §42 standard.
  var BR_HH_INT = { 'efficiency': 1, '1BR': 2, '2BR': 3, '3BR': 4, '4BR': 6 };

  function _renderEmpty(container, msg) {
    container.innerHTML = '';
    container.appendChild($h('div', { class: 'pma-empty', style: {
      padding: '1rem .5rem', color: 'var(--muted)', fontSize: '.85rem'
    } }, [msg]));
  }

  function render(container) {
    if (!container) return;
    var SP = global.SubjectProject;
    if (!SP) { _renderEmpty(container, 'SubjectProject not loaded.'); return; }
    var subject = SP.get();
    if (!subject.county_fips) {
      _renderEmpty(container, 'Pick a county in the Subject Project above to compute income limits.');
      return;
    }
    if (!subject.unit_mix || subject.unit_mix.length === 0) {
      _renderEmpty(container, 'Add unit-mix rows in the Subject Project above to compute eligible income bands.');
      return;
    }
    SP.loadHud().then(function (hud) {
      if (!hud) { _renderEmpty(container, 'Could not load HUD income limits.'); return; }

      container.innerHTML = '';
      container.appendChild($h('h2', { style: { margin: '0 0 .25rem' } }, [
        'Income-eligibility window — by unit'
      ]));
      container.appendChild($h('p', { style: { margin: '0 0 .55rem', fontSize: '.82rem',
        color: 'var(--text)', lineHeight: '1.5' } }, [
        'For each unit, the income range a renter must fall into to qualify. ',
        'Max = HUD MTSP income limit at the AMI tier × imputed HH size. ',
        'Min = proposed annual rent ÷ 0.40 (CHFA 40% rent-burden floor).'
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
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['HH size']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Proposed gross rent']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Min income (40% burden)']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Max income (HUD)']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'right' } }, ['Window width']),
          $h('th', { style: { padding: '6px 6px', textAlign: 'left' } }, ['Status'])
        ])
      ]);
      var tbody = $h('tbody', {});

      var impossibleCount = 0;

      subject.unit_mix.forEach(function (r) {
        var hh = BR_HH_INT[r.bedrooms] || 4;
        var max = SP.computeIncomeLimit(hud, subject.county_fips, r.ami_tier, hh);
        var proposed = +r.proposed_gross_rent || null;
        var min = (proposed != null) ? Math.round(proposed * 12 / 0.40) : null;
        var width = (max != null && min != null) ? max - min : null;
        var impossible = (max != null && min != null && min > max);
        if (impossible) impossibleCount += (+r.count || 0);

        var status, statusColor;
        if (max == null) { status = 'No HUD data'; statusColor = 'var(--muted)'; }
        else if (proposed == null) { status = 'Enter proposed rent'; statusColor = 'var(--muted)'; }
        else if (impossible) { status = 'Impossible band (min > max)'; statusColor = 'var(--bad,#c14545)'; }
        else if (width != null && width < 5000) { status = 'Very tight window'; statusColor = 'var(--warn,#d9a93b)'; }
        else { status = 'OK'; statusColor = 'var(--good,#3da670)'; }

        tbody.appendChild($h('tr', { style: {
          background: impossible ? 'rgba(193,69,69,0.07)' : 'transparent'
        } }, [
          $h('td', { style: { padding: '5px 6px' } }, [r.bedrooms === 'efficiency' ? 'Eff' : r.bedrooms]),
          $h('td', { style: { padding: '5px 6px' } }, [r.ami_tier + '%']),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [String(+r.count || 0)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [String(hh)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [$money(proposed)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [$money(min)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right' } }, [$money(max)]),
          $h('td', { style: { padding: '5px 6px', textAlign: 'right',
            color: width == null ? 'var(--muted)' : (width <= 0 ? 'var(--bad,#c14545)' :
                   (width < 5000 ? 'var(--warn,#d9a93b)' : 'var(--text)')) } }, [$money(width)]),
          $h('td', { style: { padding: '5px 6px', color: statusColor, fontWeight: '500' } }, [status])
        ]));
      });

      t.appendChild(thead); t.appendChild(tbody);
      tableWrap.appendChild(t);
      container.appendChild(tableWrap);

      // Bottom strip
      if (impossibleCount > 0) {
        container.appendChild($h('div', { style: { marginTop: '.5rem',
          padding: '.5rem .7rem', background: 'rgba(193,69,69,0.07)',
          border: '1px solid rgba(193,69,69,0.4)', borderRadius: '4px',
          color: 'var(--bad,#c14545)', fontSize: '.8rem', fontWeight: '500' } }, [
          '⚠ ' + impossibleCount + ' unit' + (impossibleCount === 1 ? '' : 's') +
          ' with impossible eligibility window: min income exceeds HUD ceiling. ' +
          'Either reduce proposed rent or move to a higher AMI tier.'
        ]));
      }

      container.appendChild($h('p', { style: { marginTop: '.45rem',
        fontSize: '.7rem', color: 'var(--muted)' } }, [
        'Imputed HH size (IRS §42): Eff=1, 1BR=2, 2BR=3, 3BR=4, 4BR=6. ',
        'Max income source: ',
        $h('a', { href: 'https://www.huduser.gov/portal/datasets/il.html', target: '_blank', rel: 'noopener' },
          ['HUD MTSP income limits']),
        '. The 40% floor is CHFA-method (rent burden ceiling for qualifying households).'
      ]));
    });
  }

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

  global.SubjectIncomeEligibility = { attach: attach, render: render };
})(window);
