/**
 * js/components/review-status.js
 * Review-date warnings for hand-verified records (#2009).
 *
 * Homebuyer programs and the tax-credit policy watchlist are checked by a
 * person against an official source, and each record carries the date it was
 * checked (last_verified) and the date it must be re-checked by (review_by).
 * Program amounts, eligibility and deadlines change; a card that keeps
 * presenting July's terms in November, with nothing to say so, is the defect
 * this prevents. The warning is computed from today's date every time the page
 * loads — nothing has to be regenerated for it to appear — and the daily
 * workflow policy-review-reminders.yml opens an issue so the re-check happens.
 *
 * States: 'current' (no warning), 'due' (within DUE_SOON_DAYS), 'overdue'
 * (past review_by), 'unknown' (no review date recorded — said, not hidden).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviewStatus = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DUE_SOON_DAYS = 14;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Review dates are Colorado calendar dates.
  function todayDenver(now) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now || new Date());
  }

  function isoDay(value) {
    var s = String(value == null ? '' : value).slice(0, 10);
    return ISO.test(s) ? s : null;
  }

  function daysBetween(a, b) {
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
      Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  }

  function longDate(iso) {
    if (!iso) return null;
    return MONTHS[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4);
  }

  function of(record, today) {
    var day = isoDay(today) || todayDenver();
    var reviewBy = isoDay(record && record.review_by);
    var lastVerified = isoDay(record && (record.last_verified || record.lastVerified));
    if (!reviewBy) return { state: 'unknown', reviewBy: null, lastVerified: lastVerified, days: null };
    var days = daysBetween(day, reviewBy);
    var state = days < 0 ? 'overdue' : days <= DUE_SOON_DAYS ? 'due' : 'current';
    return { state: state, reviewBy: reviewBy, lastVerified: lastVerified, days: days };
  }

  function checked(status) {
    return status.lastVerified ? 'last checked ' + longDate(status.lastVerified) : 'no check date recorded';
  }

  function html(record, today) {
    var s = of(record, today);
    if (s.state === 'current') return '';
    var tone = s.state === 'overdue' ? 'var(--bad)' : 'var(--warn)';
    var text;
    if (s.state === 'overdue') {
      text = '<strong>Review overdue.</strong> This was due to be re-checked by ' + esc(longDate(s.reviewBy)) +
        ' (' + esc(checked(s)) + '). Terms may have changed: confirm with the official source before relying on it.';
    } else if (s.state === 'due') {
      text = '<strong>Review due ' + esc(longDate(s.reviewBy)) + '.</strong> ' +
        esc(checked(s).charAt(0).toUpperCase() + checked(s).slice(1)) + '.';
    } else {
      text = '<strong>No review date recorded.</strong> ' +
        esc(checked(s).charAt(0).toUpperCase() + checked(s).slice(1)) + '; confirm with the official source.';
    }
    return '<p class="review-status review-status--' + s.state + '" data-review-status="' + s.state + '" role="note" ' +
      'style="margin:.5rem 0 0;padding:.4rem .6rem;border-left:3px solid ' + tone + ';color:var(--text);' +
      'font-size:var(--tiny, .78rem);line-height:1.5;">' + text + '</p>';
  }

  // One line above a list: how many records are overdue or coming due.
  function summaryHtml(records, today, noun) {
    var list = Array.isArray(records) ? records : [];
    var counts = { overdue: 0, due: 0, unknown: 0 };
    var soonest = null;
    list.forEach(function (r) {
      var s = of(r, today);
      if (counts[s.state] != null) counts[s.state]++;
      if (s.state === 'due' && (!soonest || s.reviewBy < soonest)) soonest = s.reviewBy;
    });
    var label = noun || 'entries';
    var parts = [];
    if (counts.overdue) parts.push('<strong>' + counts.overdue + ' of ' + list.length + ' ' + esc(label) +
      ' ' + (counts.overdue === 1 ? 'is' : 'are') + ' past their review date</strong> and may be out of date; each is marked below.');
    if (counts.due) parts.push(counts.due + ' ' + (counts.due === 1 ? 'is' : 'are') + ' due for review by ' +
      esc(longDate(soonest)) + '.');
    if (counts.unknown) parts.push(counts.unknown + ' ' + (counts.unknown === 1 ? 'has' : 'have') + ' no review date recorded.');
    if (!parts.length) return '';
    var state = counts.overdue ? 'overdue' : counts.due ? 'due' : 'unknown';
    var tone = counts.overdue ? 'var(--bad)' : 'var(--warn)';
    return '<div class="review-status-summary" data-review-summary="' + state + '" role="status" ' +
      'style="margin:0 0 var(--sp3, 1rem);padding:.6rem .8rem;border:1px solid var(--border);border-left:4px solid ' + tone + ';' +
      'border-radius:var(--radius, 6px);color:var(--text);font-size:var(--small, .9rem);line-height:1.55;">' +
      parts.join(' ') + '</div>';
  }

  return { DUE_SOON_DAYS: DUE_SOON_DAYS, of: of, html: html, summaryHtml: summaryHtml, todayDenver: todayDenver };
}));
