/**
 * js/components/housing-events.js
 * Upcoming Colorado housing events (data/policy/housing-events.json) for the
 * Housing News page and the jurisdiction briefs.
 *
 * Until 2026-10-14 Housing News carried no events: its feeds are news
 * searches, and neither the Housing Colorado conference nor CHFA's chfareach
 * classes ever made the news. scripts/news/fetch_housing_events.py now reads
 * CHFA's calendar feed, Housing Colorado's events page and a hand-checked list
 * every day.
 *
 * What a reader must never get is an old list presented as current. So:
 *   - an event that has ended is not shown, whatever the file says;
 *   - a file not refreshed in STALE_DAYS shows no events at all, and says when
 *     it last updated;
 *   - a source the fetcher could not read is named as unavailable, never left
 *     to look like a quiet calendar.
 *
 * Past events are kept (from 2026-10-19) under their own heading, newest
 * first: an ended event in the upcoming list moves there, and the file's
 * `past` list is shown even when the file has stopped updating, since what
 * already happened does not go out of date.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HousingEvents = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DAY = 864e5;
  var WINDOW_DAYS = 60;
  var STALE_DAYS = 7;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
  }

  // Today in Colorado, as YYYY-MM-DD: the events are dated in Mountain time.
  function denverDay(now) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(now || new Date());
    } catch (e) {
      return new Date((now || new Date()).getTime() - 7 * 36e5).toISOString().slice(0, 10);
    }
  }

  function addDays(iso, n) {
    var t = Date.parse(iso + 'T12:00:00Z');
    return new Date(t + n * DAY).toISOString().slice(0, 10);
  }

  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }

  function dateRange(start, end) {
    var a = parts(start), b = parts(end);
    if (!a) return '';
    var first = MON[a.m] + ' ' + a.d;
    if (!b || end === start) return first;
    if (a.y === b.y && a.m === b.m) return first + '–' + b.d;
    return first + ' – ' + MON[b.m] + ' ' + b.d;
  }

  function clock(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return '';
    var h = +m[1], ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + ap;
  }

  /**
   * The state of the file as a reader should see it.
   * { stale, updated, events, unavailable: [source names] }
   */
  function read(doc, now) {
    now = now || new Date();
    var empty = { stale: false, updated: '', events: [], past: [], unavailable: [], categories: {} };
    if (!doc || !doc.meta || !Array.isArray(doc.events)) return empty;
    var generated = Date.parse(doc.meta.generated || '');
    var stale = !isFinite(generated) || (now.getTime() - generated) > STALE_DAYS * DAY;
    var today = denverDay(now), last = addDays(today, WINDOW_DAYS);
    var events = stale ? [] : doc.events.filter(function (e) {
      return e && e.title && e.start && (e.end || e.start) >= today && e.start <= last;
    }).sort(function (x, y) {
      return x.start < y.start ? -1 : x.start > y.start ? 1 : String(x.time || '').localeCompare(String(y.time || ''));
    });
    var seen = {};
    var past = doc.events.concat(Array.isArray(doc.past) ? doc.past : []).filter(function (e) {
      if (!e || !e.title || !e.start || (e.end || e.start) >= today) return false;
      var k = [e.organizer, e.title, e.start].join('|');
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).sort(function (x, y) {
      var a = x.end || x.start, b = y.end || y.start;
      return a < b ? 1 : a > b ? -1 : (x.start < y.start ? 1 : x.start > y.start ? -1 : 0);
    });
    var unavailable = (doc.sources || []).filter(function (s) {
      return s && s.status && s.status !== 'ok';
    }).map(function (s) { return s.name; });
    return {
      stale: stale,
      updated: isFinite(generated) ? new Date(generated).toISOString().slice(0, 10) : '',
      events: events,
      past: past,
      unavailable: unavailable,
      categories: doc.meta.categories || {}
    };
  }

  function rowHtml(e, categories, isPast) {
    var url = safeUrl(e.url);
    var title = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(e.title) + '</a>'
      : esc(e.title);
    var p = parts(e.start);
    var when = dateRange(e.start, e.end) + (isPast && p ? ', ' + p.y : '') + (e.time && !isPast ? ' · ' + clock(e.time) : '');
    var meta = [e.organizer, e.location].filter(Boolean).map(esc).join(' · ');
    return '<li class="event-row" data-category="' + esc(e.category || '') + '">' +
      '<span class="event-row__when">' + esc(when) + '</span>' +
      '<span class="event-row__title">' + title + '</span>' +
      (meta ? '<span class="event-row__meta">' + meta + '</span>' : '') +
      '</li>';
  }

  function pastRowHtml(e, categories) { return rowHtml(e, categories, true); }

  function longDay(iso) {
    var p = parts(iso);
    return p ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December'][p.m] + ' ' + p.d + ', ' + p.y : '';
  }

  /** The note under the panel heading: where the list comes from, and what is missing. */
  function noteText(state) {
    if (state.stale) {
      return 'The events calendar has not updated since ' + (longDay(state.updated) || 'an unknown date') +
        ', so no events are shown. Check CHFA and Housing Colorado directly.';
    }
    var note = 'Next ' + WINDOW_DAYS + ' days, from CHFA\'s and Housing Colorado\'s calendars and events checked by hand. Updated daily.';
    if (state.unavailable.length) {
      note += ' Not available today: ' + state.unavailable.join(', ') + '.';
    }
    return note;
  }

  return {
    WINDOW_DAYS: WINDOW_DAYS,
    STALE_DAYS: STALE_DAYS,
    read: read,
    rowHtml: rowHtml,
    pastRowHtml: pastRowHtml,
    noteText: noteText,
    dateRange: dateRange,
    clock: clock,
    denverDay: denverDay,
    esc: esc
  };
}));
