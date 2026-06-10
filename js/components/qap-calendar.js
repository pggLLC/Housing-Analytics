/**
 * js/components/qap-calendar.js — F143
 * =====================================
 * Renders the CHFA QAP cycle calendar with a prominent "next deadline"
 * countdown + timeline of upcoming rounds. The single most-asked
 * question on any LIHTC deal is "when's the next round closing?" —
 * this answers it inline without forcing a CHFA-website lookup.
 *
 * Usage:
 *   QapCalendar.attach(container, {
 *     compact: true,            // small variant for OF detail / IC packet
 *     showRolling: true         // include 4% / MIHTC / Prop 123 rolling programs
 *   });
 *
 * Renders:
 *   - "Next deadline" callout — days-until + linked event details
 *   - Timeline list of upcoming events (deadlines, awards, comment periods)
 *   - Rolling-program summary (4% PAB, MIHTC, State, Prop 123)
 *   - Methodology footer citing source + vintage + confidence
 */
(function (global) {
  'use strict';
  if (global.QapCalendar) return;

  var _data    = null;
  var _promise = null;

  function _resolvePath(p) {
    if (typeof global.resolveAssetUrl === 'function') return global.resolveAssetUrl(p);
    return p;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _load() {
    if (_data) return Promise.resolve(_data);
    if (_promise) return _promise;
    _promise = fetch(_resolvePath('data/chfa-qap-calendar.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _data = d || { events: [] }; return _data; })
      .catch(function (e) {
        console.warn('[QapCalendar] fetch failed', e);
        return { events: [] };
      });
    return _promise;
  }

  function _ensureStyles() {
    if (document.getElementById('qc-styles')) return;
    var st = document.createElement('style');
    st.id = 'qc-styles';
    st.textContent = [
      '.qc-next {',
      '  display:flex; flex-wrap:wrap; align-items:baseline; gap:.6rem;',
      '  padding:.7rem .9rem; margin:.4rem 0 .8rem;',
      '  background: linear-gradient(135deg, rgba(220,38,38,.08), rgba(220,38,38,.02));',
      '  border:1px solid rgba(220,38,38,.3); border-left:5px solid #dc2626;',
      '  border-radius:6px;',
      '}',
      '.dark-mode .qc-next { background: linear-gradient(135deg, rgba(248,113,113,.15), rgba(248,113,113,.04)); border-color:rgba(248,113,113,.4); border-left-color:#f87171; }',
      '.qc-next__days { font-size:2rem; font-weight:800; color: var(--bad); line-height:1; }',
      '.dark-mode .qc-next__days { color:#f87171; }',
      '.qc-next__label { font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }',
      '.qc-next__event { flex:1 1 240px; font-size:.92rem; font-weight:600; }',
      '.qc-next__date  { font-size:.82rem; color:var(--muted); }',
      // F178 — LOI prerequisite subline. Past LOI = critical (red-tint);
      // upcoming LOI = highlight (amber-tint, the operative gate).
      '.qc-next__loi { margin-top:.4rem; padding:.45rem .55rem; border-radius:5px; font-size:.78rem; font-weight:500; line-height:1.4; }',
      '.qc-next__loi strong { font-weight:700; }',
      '.qc-next__loi--past { background:rgba(220,38,38,.1); border:1px solid rgba(220,38,38,.3); color:#991b1b; }',
      '.dark-mode .qc-next__loi--past { background:rgba(248,113,113,.15); color:#fecaca; border-color:rgba(248,113,113,.4); }',
      '.qc-next__loi--upcoming { background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.4); color:#92400e; }',
      '.dark-mode .qc-next__loi--upcoming { background:rgba(251,191,36,.15); color:#fde68a; border-color:rgba(251,191,36,.4); }',
      '.qc-list { list-style:none; padding-left:0; margin:.4rem 0; }',
      '.qc-item {',
      '  padding:.45rem .65rem; margin-bottom:.35rem;',
      '  border:1px solid var(--border, rgba(0,0,0,.08)); border-radius:6px;',
      '  background: color-mix(in oklab, var(--bg2, #f3f4f6) 60%, transparent);',
      '  display:flex; flex-wrap:wrap; align-items:baseline; gap:.5rem;',
      '}',
      '.qc-item--past { opacity:.55; }',
      '.qc-item__date { font-weight:700; font-size:.86rem; min-width:90px; }',
      '.qc-item__name { flex:1 1 250px; font-size:.86rem; }',
      '.qc-item__cat {',
      '  font-size:.66rem; font-weight:700; padding:1px 6px; border-radius:9px;',
      '  text-transform:uppercase; letter-spacing:.03em; white-space:nowrap;',
      '}',
      /* F132 — pill text colors paint over light-tint backgrounds. Add
         dark-mode variants that flip the tint shade so they remain readable
         on dark navy. */
      '.qc-item__cat--9pct-r1-deadline,.qc-item__cat--9pct-r2-deadline,.qc-item__cat--4pct-r2-deadline,.qc-item__cat--mihtc-deadline { background:rgba(220,38,38,.12); color:#8a1414; border:1px solid rgba(220,38,38,.4); }',
      '.qc-item__cat--9pct-r1-awards,.qc-item__cat--9pct-r2-awards,.qc-item__cat--4pct-r2-awards { background:rgba(16,185,129,.12); color:#02563b; border:1px solid rgba(16,185,129,.4); }',
      '.qc-item__cat--9pct-r1-loi,.qc-item__cat--4pct-r2-loi,.qc-item__cat--mihtc-loi { background:rgba(245,158,11,.08); color:#7c3d00; border:1px solid rgba(245,158,11,.3); }',
      '.qc-item__cat--qap-comment { background:rgba(245,158,11,.12); color:#7c3d00; border:1px solid rgba(245,158,11,.4); }',
      '.qc-item__cat--annual-plan { background:rgba(99,102,241,.12); color:#312e81; border:1px solid rgba(99,102,241,.4); }',
      'html.dark-mode .qc-item__cat--9pct-r1-deadline,html.dark-mode .qc-item__cat--9pct-r2-deadline,html.dark-mode .qc-item__cat--4pct-r2-deadline,html.dark-mode .qc-item__cat--mihtc-deadline { color:#fca5a5; }',
      'html.dark-mode .qc-item__cat--9pct-r1-awards,html.dark-mode .qc-item__cat--9pct-r2-awards,html.dark-mode .qc-item__cat--4pct-r2-awards { color:#6ee7b7; }',
      'html.dark-mode .qc-item__cat--9pct-r1-loi,html.dark-mode .qc-item__cat--4pct-r2-loi,html.dark-mode .qc-item__cat--mihtc-loi,html.dark-mode .qc-item__cat--qap-comment { color:#fcd34d; }',
      'html.dark-mode .qc-item__cat--annual-plan { color:#a5b4fc; }',
      '.qc-item__est { font-size:.7rem; font-style:italic; color:var(--muted); }',
      '.qc-item__details { width:100%; font-size:.78rem; color:var(--muted); margin-top:.15rem; padding-left:6px; border-left:2px solid rgba(0,0,0,.08); }',
      '.qc-rolling { margin-top:.7rem; padding:.6rem; background: color-mix(in oklab, var(--bg2, #f3f4f6) 50%, transparent); border-radius:6px; }',
      '.qc-rolling__head { font-weight:700; font-size:.82rem; margin-bottom:.3rem; }',
      '.qc-rolling__item { font-size:.78rem; margin-bottom:.25rem; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // Use a stable "today" reference. The build pipeline freezes Date.now()
  // for caching reasons; we read from the browser only.
  function _today() { return new Date(); }

  function _parseDate(s) {
    // ISO date YYYY-MM-DD → Date in local timezone (treat as midnight)
    if (!s || typeof s !== 'string') return null;
    var parts = s.split('-');
    if (parts.length !== 3) return null;
    var d = new Date(parseInt(parts[0],10), parseInt(parts[1],10) - 1, parseInt(parts[2],10));
    return isNaN(d.getTime()) ? null : d;
  }

  function _daysUntil(targetDate, today) {
    if (!targetDate) return null;
    var ms = targetDate.getTime() - today.getTime();
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  function _fmtDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // F178 — Each application deadline has a Letter-of-Intent prerequisite
  // that gates participation, typically 60+ days earlier. Show the LOI
  // status alongside the application countdown so a developer reading
  // "60 days to R2" doesn't miss that the LOI gate already closed.
  //
  // We link LOI ↔ application by category prefix: "4pct-r2-loi" matches
  // "4pct-r2-deadline" via the shared "4pct-r2" stem. Same for 9pct R1/R2.
  function _findLoiFor(deadlineEvent, allEvents) {
    var cat = deadlineEvent && deadlineEvent.category;
    if (!cat || !/deadline$/.test(cat)) return null;
    var stem = cat.replace(/-deadline$/, '');           // "4pct-r2"
    var loiCat = stem + '-loi';                          // "4pct-r2-loi"
    for (var i = 0; i < allEvents.length; i++) {
      if (allEvents[i].category === loiCat) return allEvents[i];
    }
    return null;
  }

  function _renderNextDeadline(events, today) {
    // Find the soonest upcoming deadline event (R1/R2 application due
    // OR QAP comment period start). Awards aren't "deadlines" you act on.
    var deadlines = events.filter(function (e) {
      if (e.status !== 'upcoming') return false;
      // Surface deadlines, comment periods, and Letter-of-Intent gates —
      // LOIs are real first-gate deadlines (typically due 60+ days before
      // the application). Awards are not action items.
      if (!/deadline|comment|loi/.test(e.category || '')) return false;
      var d = _parseDate(e.date);
      return d && d.getTime() >= today.getTime();
    });
    deadlines.sort(function (a, b) { return _parseDate(a.date) - _parseDate(b.date); });
    var next = deadlines[0];
    if (!next) return '';
    var d = _parseDate(next.date);
    var days = _daysUntil(d, today);
    var esc = next.date_precision === 'estimated' ? ' <span class="qc-item__est">(estimated)</span>' : '';

    // F178 — If the next deadline is an application deadline, check
    // whether the LOI prerequisite is upcoming or past. Past = critical
    // warning (this round is closed to new entrants). Upcoming = highlight
    // the LOI as the operative gate (it's typically what you act on first).
    var loi = _findLoiFor(next, events);
    var loiHtml = '';
    if (loi) {
      var loiDate  = _parseDate(loi.date);
      var loiDays  = _daysUntil(loiDate, today);
      var loiIsPast = loiDate && loiDate.getTime() < today.getTime();
      if (loiIsPast) {
        loiHtml =
          '<div class="qc-next__loi qc-next__loi--past">' +
            '<strong>⚠ LOI gate closed</strong> · was due ' + _fmtDate(loiDate) +
            '. The application deadline below is informational only. Entering this round now is not realistic for two reasons: ' +
            '(1) the CHFA LOI has already passed, and ' +
            '(2) DOH\'s gap-funding round closed even earlier in the cycle — and most LIHTC projects need DOH (or other state) gap funding to clear CHFA underwriting. ' +
            'Planning typically restarts for the next round\'s LOI cycle, paired with the next DOH NOFA.' +
          '</div>';
      } else {
        loiHtml =
          '<div class="qc-next__loi qc-next__loi--upcoming">' +
            '<strong>LOI prerequisite</strong> · due ' + _fmtDate(loiDate) +
            ' (<strong>' + loiDays + ' days</strong>) — the operative gate. CHFA requires the LOI before you can submit the application. ' +
            'Most projects also need DOH gap funding to clear CHFA underwriting, so confirm the current DOH NOFA timing alongside this LOI.' +
          '</div>';
      }
    }

    return '<div class="qc-next">' +
             '<div>' +
               '<div class="qc-next__label">Next deadline</div>' +
               '<div class="qc-next__days">' + days + '</div>' +
               '<div class="qc-next__label">days</div>' +
             '</div>' +
             '<div class="qc-next__event">' +
               (next.url
                 ? '<a href="' + _esc(next.url) + '" target="_blank" rel="noopener">' + _esc(next.name) + '</a>'
                 : _esc(next.name)) + esc +
               '<div class="qc-next__date">' + _fmtDate(d) + '</div>' +
               loiHtml +
             '</div>' +
           '</div>';
  }

  function _renderEventItem(e, today, opts) {
    var d = _parseDate(e.date);
    var isPast = e.status === 'past' || (d && d.getTime() < today.getTime());
    if (opts.compact && isPast) return '';
    var catLabel = (e.category || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    var est = e.date_precision === 'estimated' ? ' <span class="qc-item__est">est.</span>' : '';
    var dateText = _fmtDate(d) + (e.date_end ? ' – ' + _fmtDate(_parseDate(e.date_end)) : '');
    return '<li class="qc-item ' + (isPast ? 'qc-item--past' : '') + '">' +
             '<div class="qc-item__date">' + dateText + est + '</div>' +
             '<div class="qc-item__name">' +
               (e.url
                 ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">' + _esc(e.name) + '</a>'
                 : _esc(e.name)) +
             '</div>' +
             '<span class="qc-item__cat qc-item__cat--' + _esc(e.category || '') + '">' + _esc(catLabel) + '</span>' +
             (opts.compact || !e.details ? '' : '<div class="qc-item__details">' + _esc(e.details) + '</div>') +
           '</li>';
  }

  function _renderRolling(programs) {
    if (!Array.isArray(programs) || !programs.length) return '';
    return '<div class="qc-rolling">' +
             '<div class="qc-rolling__head">Rolling + paired programs</div>' +
             programs.map(function (p) {
               return '<div class="qc-rolling__item">' +
                        '<strong>' +
                          (p.url
                            ? '<a href="' + _esc(p.url) + '" target="_blank" rel="noopener">' + _esc(p.name) + '</a>'
                            : _esc(p.name)) +
                        '</strong> · ' + _esc(p.description) +
                      '</div>';
             }).join('') +
           '</div>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading QAP cycle calendar…</p>';
    _load().then(function (data) {
      var today = _today();
      var nextHtml = _renderNextDeadline(data.events || [], today);
      // Sort events by date ascending. Show upcoming first; past at bottom
      // unless compact mode (compact hides past entirely).
      var events = (data.events || []).slice().sort(function (a, b) {
        return _parseDate(a.date) - _parseDate(b.date);
      });
      var itemsHtml = events.map(function (e) { return _renderEventItem(e, today, opts); }).join('');
      var rollingHtml = (opts.showRolling !== false) ? _renderRolling(data.rolling_programs) : '';
      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        source:    'data/chfa-qap-calendar.json (curated from CHFA QAP + Annual Allocation Plan)',
        sourceUrl: 'https://www.chfainfo.com/business-lending/multifamily-lending/qualified-allocation-plan-qap',
        vintage:   data.metadata && data.metadata.generated,
        method:    'Cycle pattern inferred from CHFA\'s historical R1/R2 deadlines + Annual Plan publication. Future dates marked "est." until CHFA confirms. Verify on chfainfo.com 60-90 days out.',
        confidence:'med'
      }) : '';
      var caption = '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
        'CHFA LIHTC competitive cycles + paired program timing. The single most-asked question on any deal: <strong>"when\'s the next round closing?"</strong></p>';
      container.innerHTML =
        caption + nextHtml +
        '<ul class="qc-list">' + itemsHtml + '</ul>' +
        rollingHtml + mfHtml;
    });
  }

  // F147 — single-line "next deadline" pill for page headers. Renders
  // ONLY the countdown card (no event list, no rolling programs, no
  // methodology footer). Designed to sit above-the-fold on OF.
  function attachPillHeader(container) {
    if (!container) return;
    _ensureStyles();
    container.innerHTML = '';
    _load().then(function (data) {
      var today = _today();
      var html = _renderNextDeadline(data.events || [], today);
      if (!html) return;
      // Compact wrapper — slightly more padding, smaller days digit
      container.innerHTML = html;
      // Patch the days digit to fit headers better
      var d = container.querySelector('.qc-next__days');
      if (d) d.style.fontSize = '1.5rem';
      var n = container.querySelector('.qc-next');
      if (n) {
        n.style.padding = '.5rem .8rem';
        n.style.margin = '0';
        n.style.maxWidth = '760px';
      }
    });
  }

  function loadCalendar() { return _load(); }

  global.QapCalendar = {
    attach: attach,
    attachPillHeader: attachPillHeader,
    loadCalendar: loadCalendar
  };
})(typeof window !== 'undefined' ? window : globalThis);
