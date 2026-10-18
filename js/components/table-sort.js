/**
 * table-sort.js — every data table on the site sorts by its column headers.
 *
 * paul's standing rule (2026-10-18): all tables sort by their headers.
 * Before this, 21 of about 240 tables sorted, each with its own code and
 * its own arrow.
 *
 * Two kinds of table:
 *   - Tables a renderer already sorts (it marks its headers with aria-sort,
 *     data-sort, data-sort-key, data-col, data-metric, .sortable or
 *     .sort-asc/.sort-desc) keep that renderer's logic, because many of them
 *     sort a filtered or paginated dataset that is larger than the rows on
 *     screen. They only get the shared arrow, which clicks the header.
 *   - Every other table with one header row, at least three body rows and
 *     no merged cells is sorted here, in the DOM. Click a header (or its
 *     arrow) for ascending, again for descending, a third time for the
 *     original order — some tables have a meaningful order (steps, years,
 *     ranks) and readers need a way back to it. Numbers sort as numbers
 *     ($, %, commas and K/M/B stripped, and a number followed by a short
 *     unit such as "5 years" or "7.5 KB"), displayed dates by time; blanks
 *     and dashes go last either way; rows marked .total stay at the bottom;
 *     <tfoot> is never touched.
 *     A page opts a table out with data-no-sort on the <table>: the Deal
 *     Calculator's financial statements (sources and uses, pro forma,
 *     depreciation schedules) and the resale settlement steps do, because
 *     their row order is the meaning (subtotals and indented sub-rows).
 *
 * On touch there is no hover, so a tap on a header that has a definition
 * opens the definition (table-header-tips.js stops that tap before it
 * reaches any sort handler) and the arrow is the separate sort target. A
 * header with no definition sorts on a tap anywhere. With a mouse or
 * keyboard the whole header sorts.
 *
 * Runs on load and again whenever tables are inserted or re-rendered
 * (MutationObserver). Idempotent per header.
 */
(function () {
  'use strict';

  var OWN_SORT = 'th[aria-sort]:not(.th-sortable):not([data-aria-from-class]), th[data-sort], th[data-sort-key], th[data-col], th[data-metric], th.sortable, th.sort-asc, th.sort-desc';
  var BLANK = /^(—|–|-|n\/a|na|not published|unavailable|not available)$/i;
  var lastPointerTouch = false;
  document.addEventListener('pointerdown', function (e) {
    lastPointerTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
  }, true);

  function headerRow(t) {
    if (t.tHead) return t.tHead.rows.length === 1 ? t.tHead.rows[0] : null;
    var first = t.rows[0];
    if (!first) return null;
    for (var i = 0; i < first.cells.length; i++) if (first.cells[i].tagName !== 'TH') return null;
    return first;
  }

  function bodyRows(t, head) {
    var tb = t.tBodies[0];
    if (!tb) return [];
    return Array.prototype.filter.call(tb.rows, function (r) { return r !== head; });
  }

  function eligible(t) {
    if (t.hasAttribute('data-no-sort')) return false;
    var head = headerRow(t);
    if (!head || head.cells.length < 2) return false;
    for (var i = 0; i < head.cells.length; i++) if (head.cells[i].colSpan > 1) return false;
    var rows = bodyRows(t, head);
    if (rows.length < 3) return false;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].cells.length !== head.cells.length) return false;
      for (var k = 0; k < rows[j].cells.length; k++) {
        var c = rows[j].cells[k];
        if (c.colSpan > 1 || c.rowSpan > 1) return false;
      }
    }
    return true;
  }

  // Displayed dates sort by time, not by their text ("3 Mar 2025" before
  // "10 Aug 2026"). Only whole-cell dates in the formats the site prints
  // are read; anything else stays text, so a label that merely contains a
  // month name is never mistaken for a date.
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  var DATE_FORMATS = [
    [new RegExp('^(\\d{1,2}) ' + MON + ',? (\\d{4})$', 'i'), function (m) { return [m[3], m[2], m[1]]; }],
    [new RegExp('^' + MON + ' (\\d{1,2}),? (\\d{4})$', 'i'), function (m) { return [m[3], m[1], m[2]]; }],
    [new RegExp('^' + MON + ',? (\\d{4})$', 'i'), function (m) { return [m[2], m[1], 1]; }],
    // A month range ("Apr–Jun 2026") sorts by where it starts.
    [new RegExp('^' + MON + ' ?[–-] ?' + MON + ',? (\\d{4})$', 'i'), function (m) { return [m[3], m[1], 1]; }],
    [/^(\d{4})-(\d{2})(?:-(\d{2}))?$/, function (m) { return [m[1], Number(m[2]) - 1, m[3] || 1]; }],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, function (m) { return [m[3], Number(m[1]) - 1, m[2]]; }]
  ];
  function dateKey(txt) {
    for (var i = 0; i < DATE_FORMATS.length; i++) {
      var m = DATE_FORMATS[i][0].exec(txt);
      if (!m) continue;
      var ymd = DATE_FORMATS[i][1](m);
      var mon = typeof ymd[1] === 'string' ? MONTHS[ymd[1].slice(0, 3).toLowerCase()] : ymd[1];
      return Date.UTC(Number(ymd[0]), mon, Number(ymd[2]));
    }
    return null;
  }

  var AGO = /^(\d+\.?\d*)\s*(mins?|minutes?|hrs?|hours?|days?|wks?|weeks?|mos?|months?|yrs?|years?)\s+ago$/i;
  var AGO_DAYS = { min: 1 / 1440, minute: 1 / 1440, hr: 1 / 24, hour: 1 / 24, day: 1, wk: 7, week: 7, mo: 30, month: 30, yr: 365, year: 365 };

  function key(cell) {
    var txt = cell ? (cell.getAttribute('data-sort-value') || cell.textContent) : '';
    txt = txt.replace(/\s+/g, ' ').trim();
    if (!txt || BLANK.test(txt)) return { blank: true };
    var num = txt.replace(/[$,%\s  ]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^[−–]/, '-').replace(/^\+/, '');
    if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?[kmb]?$/i.test(num)) {
      var v = parseFloat(num);
      var suf = num.slice(-1).toLowerCase();
      if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
      return { n: v };
    }
    var d = dateKey(txt);
    if (d !== null) return { n: d };
    // Relative ages ("today", "3 days ago", "2 mo ago", "1 yr ago") sort by
    // age, oldest first, the same direction as dates.
    var ago = AGO.exec(txt);
    if (/^(today|just now)$/i.test(txt)) return { n: 0 };
    if (/^yesterday$/i.test(txt)) return { n: -1 };
    if (ago) return { n: -parseFloat(ago[1]) * AGO_DAYS[ago[2].toLowerCase().replace(/s$/, '')] };
    // A number with a short unit or note after it sorts by the number:
    // "5 years", "4-5 weeks", "384 (36%)", "$35.04/hr", "+105 bp",
    // "60% AMI", "7.5 KB" next to "2.1 MB". Prose that happens to start
    // with a number stays text.
    var lead = /^[~≈<>]?\s*([+−–-])?\s*\$?(\d[\d,]*\.?\d*)\s*%?\s*(.*)$/.exec(txt);
    if (lead && lead[3].length <= 24) {
      var lv = parseFloat(lead[2].replace(/,/g, ''));
      var unit = /^([kmg])b\b/i.exec(lead[3]);
      if (unit) lv *= { k: 1e3, m: 1e6, g: 1e9 }[unit[1].toLowerCase()];
      if (lead[1] && lead[1] !== '+') lv = -lv;
      if (isFinite(lv)) return { n: lv };
    }
    return { s: txt.toLowerCase() };
  }

  function compare(a, b) {
    if (a.n !== undefined && b.n !== undefined) return a.n - b.n;
    if (a.n !== undefined) return -1;
    if (b.n !== undefined) return 1;
    return a.s.localeCompare(b.s, undefined, { numeric: true });
  }

  // Total and result rows stay at the bottom: a .total class, a row ruled
  // off with an inline top border (the stakeholder guide's Net Benefit),
  // or a first cell that reads "Total …" / "Grand total" (its TOTAL
  // SOURCES, TOTAL USES and TOTAL POSSIBLE are marked only by their label).
  function isTotal(r) {
    if (r.classList.contains('total')) return true;
    if (/border-top/i.test(r.getAttribute('style') || '')) return true;
    var first = r.cells[0];
    return !!first && /^(grand\s+|sub)?total\b/i.test(first.textContent.replace(/\s+/g, ' ').trim());
  }

  function sortBy(t, th, col) {
    var head = headerRow(t);
    var tb = t.tBodies[0];
    if (!head || !tb) return;
    var rows = bodyRows(t, head);
    rows.forEach(function (r, i) { if (r.dataset.sortOrig === undefined) r.dataset.sortOrig = i; });
    var cur = th.getAttribute('aria-sort');
    var next = cur === 'ascending' ? 'descending' : cur === 'descending' ? 'none' : 'ascending';
    Array.prototype.forEach.call(head.cells, function (h) {
      if (h.classList.contains('th-sortable')) h.setAttribute('aria-sort', 'none');
    });
    th.setAttribute('aria-sort', next);
    var orig = function (r) { return Number(r.dataset.sortOrig); };
    if (next === 'none') {
      rows.sort(function (ra, rb) { return orig(ra) - orig(rb); }).forEach(function (r) { tb.appendChild(r); });
      return;
    }
    var pinned = rows.filter(isTotal);
    var movable = rows.filter(function (r) { return !isTotal(r); });
    var dir = next === 'descending' ? -1 : 1;
    movable.sort(function (ra, rb) {
      var a = key(ra.cells[col]);
      var b = key(rb.cells[col]);
      if (a.blank || b.blank) return a.blank && b.blank ? orig(ra) - orig(rb) : (a.blank ? 1 : -1);
      return dir * compare(a, b) || orig(ra) - orig(rb);
    });
    movable.concat(pinned).forEach(function (r) { tb.appendChild(r); });
  }

  // The header's name without any direction glyph: renderers' own
  // indicators (hidden by CSS, but still in the text) would otherwise give
  // the arrow a name like "Sort by Expiration ↑" that goes stale.
  var INDICATORS = '.sort-icon, .aff-sort-indicator, .mhc-sort-indicator, .th-sort, .th-tip__pop';
  function label(th) {
    var c = (th.querySelector('.th-tip__label') || th).cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll(INDICATORS), function (n) { n.parentNode.removeChild(n); });
    return c.textContent.replace(/[⇅↑↓▲▼↕]/g, '').replace(/\s+/g, ' ').trim();
  }

  function addArrow(th, onSort) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-sort';
    btn.setAttribute('aria-label', 'Sort by ' + label(th));
    btn.innerHTML = '<span aria-hidden="true"></span>';
    btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); onSort(); });
    th.appendChild(btn);
    th.classList.add('th-sortable');
  }

  // A renderer's own sortable headers: add the arrow, and let the header's
  // own click handler do the sorting. Headers whose sort control is already
  // a button inside the cell (agency funding, funding vs need) keep it.
  // These stay two-state (the renderer's own asc/desc): a renderer's default
  // order is itself a sort on one column (award year, need score), so
  // clicking that column is the way back to it.
  //
  // Renderers that mark direction only with .sort-asc/.sort-desc get
  // aria-sort kept in step here, so assistive technology hears it too.
  function syncAria(t) {
    // Only a table whose renderer has marked a direction with a class:
    // one that sets aria-sort itself (Opportunity Finder) is never touched.
    if (!t.querySelector('th.sort-asc, th.sort-desc')) return;
    Array.prototype.forEach.call(t.querySelectorAll('th[data-aria-from-class]'), function (th) {
      th.setAttribute('aria-sort', th.classList.contains('sort-asc') ? 'ascending' : th.classList.contains('sort-desc') ? 'descending' : 'none');
    });
  }

  function wireOwn(t) {
    t.classList.add('th-own-sort');
    // A renderer that already writes aria-sort on any header manages it
    // for all of them; only a class-only renderer gets it mirrored here.
    var rendererAria = !!t.querySelector('th[aria-sort]:not([data-aria-from-class])');
    Array.prototype.forEach.call(t.querySelectorAll(OWN_SORT), function (th) {
      if (th.querySelector('.th-sort, button, input, select, a[href]') || !label(th)) return;
      if (!rendererAria && !th.hasAttribute('aria-sort')) th.setAttribute('data-aria-from-class', '');
      addArrow(th, function () {
        // Marked so table-header-tips.js does not read it as a tap on the
        // label (which would open the definition instead of sorting).
        var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        ev.thSortArrow = true;
        th.dispatchEvent(ev);
      });
    });
    if (!t.dataset.ariaSync) {
      t.dataset.ariaSync = '1';
      t.addEventListener('click', function () { setTimeout(function () { syncAria(t); }, 0); });
    }
    syncAria(t);
  }

  function wireShared(t) {
    var head = headerRow(t);
    // A renderer replaced the body rows while a sort was showing: the new
    // rows are in the renderer's order, so the arrow resets to match.
    var rows = bodyRows(t, head);
    if (rows.some(function (r) { return r.dataset.sortOrig === undefined; })) {
      Array.prototype.forEach.call(head.cells, function (h) {
        if (h.classList.contains('th-sortable')) h.setAttribute('aria-sort', 'none');
      });
      rows.forEach(function (r) { delete r.dataset.sortOrig; });
    }
    Array.prototype.forEach.call(head.cells, function (th, col) {
      if (th.dataset.sortWired || !label(th) || th.querySelector('input, select, button:not(.th-sort), a[href]')) return;
      th.dataset.sortWired = '1';
      th.setAttribute('aria-sort', 'none');
      if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');
      addArrow(th, function () { sortBy(t, th, col); });
      th.addEventListener('click', function (e) {
        sortBy(t, th, col);
      });
      th.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === th) { e.preventDefault(); sortBy(t, th, col); }
      });
    });
  }

  function wire(t) {
    if (t.hasAttribute('data-no-sort')) return;
    if (t.classList.contains('th-own-sort') || t.querySelector(OWN_SORT)) { wireOwn(t); return; }
    if (eligible(t)) wireShared(t);
  }

  function wireAll() {
    Array.prototype.forEach.call(document.querySelectorAll('table'), wire);
  }

  function init() {
    wireAll();
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; wireAll(); }, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TableSort = { key: key, eligible: eligible, wireAll: wireAll };
})();
