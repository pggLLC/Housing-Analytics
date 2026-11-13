// One icon family for the whole site (Gemini round 4, drawn by Claude, 6 Nov 2026): outline, 24 px grid,
// 2 px stroke, round joins and caps, colour from currentColor. Each icon reads without colour.
// LabIcon.svg(name, cls) returns an <svg> that is hidden from screen readers; the label next to it carries the meaning.
// LabIcon.empty(kind, text) draws an empty-state picture with its one-line caption.
(function (global) {
  'use strict';

  var I = {
    place: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    renter: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><circle cx="10" cy="15" r="2"/><path d="M12 15h4m-1.5 0v2"/>',
    owner: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    short: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10" stroke-dasharray="3 2.5"/><path d="M9.5 15h5"/>',
    money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5m12-5v5"/>',
    credit: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9.5 15.5l2 2 4-4.5"/><path d="M9.5 10h6"/>',
    bond: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><circle cx="16" cy="14" r="2"/><path d="M6.5 13h5m-5 3h3"/>',
    land: '<path d="M3 18l5-8 4 5 3-4 6 7z"/><path d="M3 21h18"/><circle cx="17" cy="6" r="2"/>',
    permit: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    map: '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5m6-11v13.5"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4m4 4V9m4 7v-6"/>',
    trend: '<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4 3 2.5 5-6"/><path d="M15.5 7.5H19V11"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4m8-4v4"/><path d="M8 14h2m4 0h2m-8 3h2"/>',
    deadline: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2"/><path d="M9.5 3h5"/>',
    report: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 17v-3m3 3v-6m3 6v-4"/>',
    sheet: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M3.5 14.5h17M9.5 4v16"/>',
    download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path d="M4.5 16v3.5h15V16"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.2 10.8l7.1-3.6m-7.1 6l7.1 3.6"/>',
    compare: '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="9" width="7" height="10" rx="1.5"/><path d="M12 3v18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
    need: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/><path d="M7.5 12l2-2 1.5 1.5 2.5-3"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>',
    phone: '<path d="M5 4h3.5l1.5 4-2 1.5a10 10 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
    members: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.3"/><path d="M15.5 14.3a4.5 4.5 0 0 1 5 4.2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
    warning: '<path d="M12 3.5L21.5 20h-19z"/><path d="M12 10v4.5m0 2.8h.01"/>',
    next: '<path d="M5 12h14m-5.5-5.5L19 12l-5.5 5.5"/>',
    back: '<path d="M19 12H5m5.5-5.5L5 12l5.5 5.5"/>',
    out: '<path d="M8 6h10v10"/><path d="M18 6L6 18"/>'
  };

  // What each icon stands for, for the reference sheet and checks.
  var MEANS = {
    place: 'A town or county', renter: 'Renter households', owner: 'Owner households', short: 'Homes short',
    money: 'Money, cost or rent', credit: 'Tax credit', bond: 'Private activity bond', land: 'Land and sites',
    permit: 'Permits and approvals', map: 'Map', chart: 'Chart', trend: 'Change over time', calendar: 'Calendar',
    deadline: 'Deadline', report: 'Report or brief', sheet: 'Workbook or table', download: 'Download', share: 'Share',
    compare: 'Compare', search: 'Search', need: 'See a place’s needs', help: 'Help', phone: 'Call', members: 'Members',
    lock: 'Members only', check: 'Done or covered', warning: 'Check this', next: 'Next', back: 'Back', out: 'Opens another site'
  };

  function svg(name, cls) {
    if (!I[name]) return '';
    return '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" class="ic' + (cls ? ' ' + cls : '') + '">' + I[name] + '</svg>';
  }

  // Empty states: nothing picked yet, still loading, no data for this place.
  var EMPTY = {
    pick: '<path d="M30 74 L60 50 L90 74"/><path d="M38 68 V96 H82 V68"/><path d="M60 22 c-9 0-15 6.5-15 14.5 0 10.5 15 22 15 22 s15-11.5 15-22 C75 28.5 69 22 60 22z" class="ie-acc"/><circle cx="60" cy="36.5" r="5" class="ie-acc"/>',
    loading: '<path d="M30 74 L60 50 L90 74"/><path d="M38 68 V96 H82 V68"/><circle cx="48" cy="84" r="3.5" class="ie-d1"/><circle cx="60" cy="84" r="3.5" class="ie-d2"/><circle cx="72" cy="84" r="3.5" class="ie-d3"/>',
    none: '<path d="M30 74 L60 50 L90 74"/><path d="M38 68 V96 H82 V68" stroke-dasharray="6 5"/><path d="M52 80 H68"/>'
  };

  function empty(kind, text) {
    var k = EMPTY[kind] ? kind : 'none';
    return '<div class="ic-empty ic-empty-' + k + '"' + (k === 'loading' ? ' role="status"' : '') + '><svg viewBox="0 0 120 110" aria-hidden="true" focusable="false">' + EMPTY[k] + '</svg>' +
      (text ? '<p>' + String(text).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '</p>' : '') + '</div>';
  }

  // Loading notes across the site get the small "still loading" mark without each page changing its markup.
  function markLoading(root) {
    var list = (root || document).querySelectorAll('p.note[role="status"]:not(.is-loading)');
    for (var i = 0; i < list.length; i++) {
      if (/^(Loading|Reading|Checking|Counting)\b/.test((list[i].textContent || '').trim())) list[i].className += ' is-loading';
    }
  }
  if (global.document && global.MutationObserver) {
    var start = function () {
      markLoading(document);
      new MutationObserver(function () { markLoading(document); }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }

  global.LabIcon = { svg: svg, names: Object.keys(I), means: MEANS, empty: empty, markLoading: markLoading };
})(typeof window !== 'undefined' ? window : globalThis);
