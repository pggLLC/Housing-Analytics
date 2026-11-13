// Deadlines and events (#/calendar): CHFA's tax credit dates (data/chfa-qap-calendar.json) and the
// housing events calendar (data/policy/housing-events.json), as the live site publishes them. The events
// file reads CHFA, Housing Colorado, DOLA's Division of Housing and Prop 123 calendars, APA Colorado's
// housing items, OEDIT program dates, FOMC meetings and Census, BLS and FRED release dates. One list,
// newest first, with a month grid on wide screens. Every entry names its agency, links the page the date
// came from and says when it was last checked. Draft-QAP dates say so until CHFA adopts the plan.
// Law dates (paul 31 Oct: "legislative deadlines go in calendar"): when each tracked law takes effect or
// ends (data/policy/tax-credit-legislation.json), and the Colorado session laws' effective dates and the
// deadlines their own titles state (data/policy/policy-watch.json).
// The member site adds its own deal deadlines on the server; none of that is here.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var FILES = { qap: 'data/chfa-qap-calendar.json', events: 'data/policy/housing-events.json', law: 'data/policy/tax-credit-legislation.json', watch: 'data/policy/policy-watch.json' };
  // letter: the shorthand on the month grid (T training, M meeting, C conference, ...), then the organization and topic.
  var KINDS = [
    { id: 'round', label: 'Tax credit round', short: 'Round', letter: 'R' },
    { id: 'deadline', label: 'Agency deadline or funding notice', short: 'Deadline', letter: 'D' },
    { id: 'law', label: 'Law takes effect, ends or sets a deadline', short: 'Law', letter: 'L' },
    { id: 'hearing', label: 'Hearing or comment', short: 'Hearing', letter: 'H' },
    { id: 'training', label: 'Training', short: 'Training', letter: 'T' },
    { id: 'conference', label: 'Conference', short: 'Conference', letter: 'C' },
    { id: 'meeting', label: 'Board or other meeting', short: 'Meeting', letter: 'M' },
    { id: 'release', label: 'Rate decision or data release', short: 'Release', letter: 'DR' }
  ];
  // Short organization names for the grid; the list shows the full name.
  var ORG_SHORT = { 'Colorado Division of Housing': 'DOH', 'DOLA Proposition 123': 'Prop 123', 'Federal Reserve': 'Fed',
    'U.S. Census Bureau': 'Census', 'U.S. Bureau of Labor Statistics': 'BLS', 'Housing Colorado': 'Housing CO', 'APA Colorado': 'APA CO' };
  var KIND_LABEL = {}, KIND_SHORT = {}, KIND_LETTER = {};
  KINDS.forEach(function (k) { KIND_LABEL[k.id] = k.label; KIND_SHORT[k.id] = k.short; KIND_LETTER[k.id] = k.letter; });
  // housing-events.json categories, grouped into the kinds above.
  var EVENT_KIND = { compliance: 'training', developer: 'training', homebuyer: 'training', conference: 'conference', networking: 'conference', board: 'meeting', deadline: 'deadline', release: 'release' };
  // What each CHFA date means for a developer, in one line.
  var MEANING = {
    loi: 'Letter of Intent due. No application in this round without one.',
    deadline: 'Full application due to CHFA.',
    awards: 'CHFA announces which projects get credits.',
    'qap-hearing': 'Public hearing on the draft allocation plan. Speak or send comments.',
    'plan-hearing': 'Public hearing on a draft credit allocation plan. CHFA takes written comments up to the hearing.',
    'qap-comment': 'Last day for written comments on the draft plan.',
    'qap-adoption': 'The plan becomes final, with its dates, credit limits and scoring.'
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function safe(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function nice(s) {
    var p = String(s).split('-');
    return MONTHS[Number(p[1]) - 1].slice(0, 3) + ' ' + Number(p[2]) + ', ' + p[0];
  }
  function chfaMeaning(cat) {
    var m = /-(loi|deadline|awards)$/.exec(cat);
    return MEANING[m ? m[1] : cat] || '';
  }
  // CHFA's notes keep their facts; sentences about the site's own files are left out.
  function clean(text) {
    return String(text || '').split(/(?<=\.)\s+/).filter(function (x) { return !/(data|scripts)\/|Bridge file/.test(x); }).join(' ');
  }

  function entries(d) {
    var meta = d.qap.metadata, src = meta.qap_sources || {};
    var chfa = d.qap.events.map(function (e) {
      var qs = src[e.qap_source];
      return {
        date: e.date, end: e.date_end || null, title: e.name, agency: 'CHFA',
        kind: /hearing|comment|adoption/.test(e.category) ? 'hearing' : 'round',
        meaning: chfaMeaning(e.category), detail: clean(e.details), url: safe(e.url),
        checked: qs ? qs.verified : meta.generated,
        flags: [].concat(e.qap_status === 'draft' ? ['Draft QAP, not adopted'] : [], e.date_precision === 'estimated' ? ['Estimated date'] : [])
      };
    });
    var em = d.events.meta;
    // An event whose own page is gone (HA drops a Zoom registration link once the meeting has ended) keeps its
    // card, sourced to the calendar it came from, as the live page keeps its title.
    var cals = {};
    (d.events.sources || []).forEach(function (x) { if (safe(x.url)) cals[x.id] = { url: safe(x.url), name: x.name }; });
    var ev = d.events.events.concat(d.events.past || []).map(function (e) {
      var own = safe(e.url), cal = !own && cals[e.source];
      return {
        date: e.start, end: e.end || null, title: e.title.replace(/^chfareach:\s*/i, ''), agency: e.organizer || '',
        kind: EVENT_KIND[e.category] || 'meeting', meaning: (em.categories[e.category] || '') + (e.time ? ', ' + e.time : ''),
        detail: e.online ? 'Online' : (e.location || ''), url: own || (cal ? cal.url : ''), checked: em.as_of,
        via: cal ? cal.name : '', flags: cal ? ['No event page; listed on the organizer\u2019s calendar'] : []
      };
    });
    // Every dated entry is listed (QA 11-09: a link that went dead must not take its entry with it). An entry with no
    // link at all says so on its card.
    return chfa.concat(ev, lawDates(d)).filter(function (x) { return x.date; });
  }

  // A date a law's own title states ("due by November 1, 2026", "from December 31, 2027").
  var STATED = new RegExp('(due by|from) (' + MONTHS.join('|') + ') (\\d{1,2}), (\\d{4})');
  function lawDates(d) {
    var out = [];
    if (d.law) {
      var lm = d.law.meta || {};
      d.law.entries.forEach(function (e) {
        var u = safe(e.source_url), checked = e.last_verified || lm.last_verified;
        if (e.effective_date && e.status !== 'proposed') out.push({ date: e.effective_date, end: null, title: e.title, agency: 'Official source', kind: 'law', meaning: 'Takes effect.', detail: e.pricing_impact || '', url: u, checked: checked, flags: [] });
        if (e.sunset_date) out.push({ date: e.sunset_date, end: null, title: e.title, agency: 'Official source', kind: 'law', meaning: 'Ends.', detail: '', url: u, checked: checked, flags: [] });
      });
    }
    if (d.watch) {
      d.watch.entries.filter(function (e) { return e.section === 'law'; }).forEach(function (e) {
        var u = e.source && safe(e.source.url), checked = e.verification && e.verification.checked || d.watch.meta.as_of;
        var who = e.source.label || 'Colorado General Assembly';
        if (e.date) out.push({ date: e.date, end: null, title: e.title, agency: who, kind: 'law', meaning: 'Takes effect.', detail: '', url: u, checked: checked, flags: [] });
        var m = STATED.exec(e.title);
        if (m) {
          var day = m[4] + '-' + ('0' + (MONTHS.indexOf(m[2]) + 1)).slice(-2) + '-' + ('0' + m[3]).slice(-2);
          out.push({ date: day, end: null, title: e.title, agency: who, kind: 'law', meaning: m[1] === 'due by' ? 'Deadline the law sets.' : 'Requirement starts.', detail: '', url: u, checked: checked, flags: [] });
        }
      });
    }
    return out;
  }

  function gcal(x) {
    var a = x.date.replace(/-/g, ''), endDay = new Date((x.end || x.date) + 'T12:00:00');
    endDay.setDate(endDay.getDate() + 1);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(x.title) +
      '&dates=' + a + '/' + iso(endDay).replace(/-/g, '') + '&details=' + encodeURIComponent((x.meaning ? x.meaning + ' ' : '') + x.url);
  }

  function card(x) {
    return '<li class="cal-entry cal-' + esc(x.kind) + '"><p class="cal-when"><time datetime="' + esc(x.date) + '">' + esc(nice(x.date)) + '</time>' +
      (x.end && x.end !== x.date ? ' to <time datetime="' + esc(x.end) + '">' + esc(nice(x.end)) + '</time>' : '') + '</p>' +
      '<p class="cal-title"><span class="cal-chip">' + esc(KIND_LABEL[x.kind]) + '</span> <strong>' + esc(x.title) + '</strong></p>' +
      (x.flags.length ? '<p class="cal-flags">' + x.flags.map(function (f) { return '<span class="cal-flag">' + esc(f) + '</span>'; }).join(' ') + '</p>' : '') +
      (x.meaning ? '<p>' + esc(x.meaning) + '</p>' : '') +
      (x.detail ? '<p class="note">' + esc(x.detail) + '</p>' : '') +
      '<p class="source-line"><span>Source</span> ' + (x.url ? '<a href="' + esc(x.url) + '">' + esc(x.via || x.agency || 'Organizer') + '</a>' : esc(x.agency || 'Organizer') + ' (no link in the source file)') + ', checked ' + esc(x.checked) +
      ' · <a href="' + esc(gcal(x)) + '">Add to Google Calendar</a></p></li>';
  }

  // from: entries already under way are listed in the month they are still open (today's month).
  function byMonth(list, from) {
    var out = [], cur = null;
    list.forEach(function (x) {
      var m = (from && x.date < from ? from : x.date).slice(0, 7);
      if (!cur || cur.m !== m) out.push(cur = { m: m, items: [] });
      cur.items.push(x);
    });
    return out.map(function (g) {
      var p = g.m.split('-');
      return '<h3 class="cal-month">' + esc(MONTHS[Number(p[1]) - 1] + ' ' + p[0]) + '</h3><ul class="cal-list">' + g.items.map(card).join('') + '</ul>';
    }).join('');
  }

  // "T CHFA: NSPIRE Inspections": the kind's letter, the organization, then the topic.
  function label(x) {
    var org = ORG_SHORT[x.agency] || x.agency || '';
    var topic = x.title.replace(new RegExp('^(' + (x.agency || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\s*[:—-]?\\s*', 'i'), '')
      .replace(/^(Training Webinar|Webinar|Training):\s*/i, '');
    return KIND_LETTER[x.kind] + ' ' + (org ? org + ': ' : '') + topic;
  }

  function onDay(list, day) {
    // A window longer than a week (an estimated approval period) marks its first and last day only.
    return list.filter(function (x) {
      var end = x.end || x.date;
      if (end === x.date || (new Date(end) - new Date(x.date)) / 864e5 <= 7) return x.date <= day && end >= day;
      return day === x.date || day === end;
    });
  }

  // The month grid. Past days are grayed, today is outlined, and every day with entries links to that
  // day's list below the grid. Phones get the letters only.
  function grid(month, list, q, today, picked) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1;
    var first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), lead = first.getDay();
    var prev = iso(new Date(y, m - 1, 1)).slice(0, 7), nxt = iso(new Date(y, m + 1, 1)).slice(0, 7);
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push('<td class="cal-empty"></td>');
    for (var dnum = 1; dnum <= days; dnum++) {
      var day = month + '-' + ('0' + dnum).slice(-2);
      var on = onDay(list, day);
      var go = '#/calendar?' + q('d', day, 'm', month);
      var cls = [on.length ? 'cal-has' : '', day < today ? 'cal-gone' : '', day === today ? 'cal-today' : '', day === picked ? 'cal-picked' : ''].filter(Boolean).join(' ');
      cells.push('<td' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<a class="cal-day" href="' + esc(go) + '"' + (day === today ? ' aria-current="date"' : '') +
          ' aria-label="' + esc(nice(day) + (on.length ? ', ' + on.length + (on.length === 1 ? ' entry' : ' entries') : ', nothing listed')) + '">' + dnum + '</a>' +
        on.slice(0, 3).map(function (x) {
          return '<a class="cal-dot cal-' + esc(x.kind) + '" href="' + esc(go) + '" title="' + esc(KIND_LABEL[x.kind] + ': ' + x.title) + '">' +
            '<b>' + esc(KIND_LETTER[x.kind]) + '</b><span class="cal-dot-text"> ' + esc(label(x).slice(KIND_LETTER[x.kind].length + 1)) + '</span></a>';
        }).join('') +
        (on.length > 3 ? '<a class="cal-more" href="' + esc(go) + '">+' + (on.length - 3) + ' more</a>' : '') + '</td>');
    }
    while (cells.length % 7) cells.push('<td class="cal-empty"></td>');
    var rows = [];
    for (var r = 0; r < cells.length; r += 7) rows.push('<tr>' + cells.slice(r, r + 7).join('') + '</tr>');
    var link = function (mm) { return '#/calendar?' + q('m', mm, 'd', ''); };
    return '<div class="cal-grid-wrap"><div class="cal-grid-head"><a href="' + esc(link(prev)) + '">← ' + esc(MONTHS[Number(prev.slice(5)) - 1]) + '</a>' +
      '<p class="cal-grid-title">' + esc(MONTHS[m] + ' ' + y) + '</p><a href="' + esc(link(nxt)) + '">' + esc(MONTHS[Number(nxt.slice(5)) - 1]) + ' →</a></div>' +
      '<p class="cal-key">' + KINDS.map(function (k) { return '<span><b>' + esc(k.letter) + '</b> ' + esc(k.short.toLowerCase()) + '</span>'; }).join('') + '</p>' +
      '<table class="cal-grid" data-no-source="catalog: a month view of the entries listed with their sources"><caption class="visually-hidden">' + esc(MONTHS[m] + ' ' + y) + ', entries by day. Pick a day to see its entries.</caption><thead><tr>' +
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (w) { return '<th scope="col">' + w + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  // The picked day's entries, right under the grid.
  function dayPanel(list, day, today) {
    var on = onDay(list, day);
    return '<section id="cal-day" class="cal-day-panel" tabindex="-1" aria-live="polite"><h2>' + esc(nice(day)) + (day === today ? ' (today)' : '') + '</h2>' +
      (on.length ? '<ul class="cal-list">' + on.map(card).join('') + '</ul>' : '<p class="note">Nothing listed on this day.</p>') + '</section>';
  }

  function view(params) {
    var s = UI.load(FILES);
    var crumbs = T.trail('policy', 'Deadlines and events');
    if (!s.data) return T.head({ kind: 'data', crumbs: crumbs, title: 'Deadlines and events' }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var today = iso(new Date());
    var kind = params.get('kind') || '';
    var all = entries(s.data).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var shown = all.filter(function (x) { return !kind || x.kind === kind; });
    var upcoming = shown.filter(function (x) { return (x.end || x.date) >= today; });
    var past = shown.filter(function (x) { return (x.end || x.date) < today; }).reverse();
    // q('d', day, 'm', month): this page's query with those keys set (or dropped when empty).
    var q = function () {
      var p = new URLSearchParams(params.toString());
      for (var i = 0; i < arguments.length; i += 2) { if (arguments[i + 1]) p.set(arguments[i], arguments[i + 1]); else p.delete(arguments[i]); }
      return p.toString();
    };
    var picked = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : '';
    var month = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m') : (picked || today).slice(0, 7);
    var dayShown = picked || (month === today.slice(0, 7) ? today : '');
    var nextChfa = all.filter(function (x) { return x.agency === 'CHFA' && x.kind === 'round' && x.date >= today; })[0];
    var meta = s.data.qap.metadata, em = s.data.events.meta;
    var down = s.data.events.sources.filter(function (x) { return x.status === 'unreachable'; }).map(function (x) { return x.name; });
    var chips = '<nav class="cal-filter" aria-label="Show"><a href="#/calendar' + (q('kind', '') ? '?' + q('kind', '') : '') + '"' + (!kind ? ' aria-current="true"' : '') + '>All</a>' +
      KINDS.map(function (k) { return '<a class="cal-' + esc(k.id) + '" href="#/calendar?' + esc(q('kind', k.id)) + '"' + (kind === k.id ? ' aria-current="true"' : '') + '>' + esc(k.label) + '</a>'; }).join('') + '</nav>';
    var rolling = s.data.qap.rolling_programs.map(function (r) {
      return '<li><p><strong>' + esc(r.name) + '</strong></p><p>' + esc(clean(r.description)) + '</p>' + (safe(r.url) ? T.source('CHFA', r.url) : '') + '</li>';
    }).join('');
    return T.head({
      kind: 'data', crumbs: crumbs, title: 'Deadlines and events',
      answer: 'Tax credit rounds, state housing deadlines, law dates, board meetings, trainings, conferences, Fed rate decisions and data releases in one dated list. Each entry links the page the date came from.',
      meta: '<span class="scope-tag">Scope: Colorado</span> CHFA dates checked ' + esc(meta.generated) + '; events calendar as of ' + esc(em.as_of) + '.',
      facts: [
        nextChfa ? { value: nice(nextChfa.date), label: 'Next CHFA round date: ' + nextChfa.title, source: 'CHFA', href: nextChfa.url } : null,
        { value: String(upcoming.length), label: 'Upcoming entries' + (kind ? ' (' + KIND_LABEL[kind] + ')' : ''), source: 'CHFA and the calendars listed below', href: s.data.events.sources[0].url }
      ].filter(Boolean)
    }) +
      chips + grid(month, shown, q, today, dayShown) + (dayShown ? dayPanel(shown, dayShown, today) : '') +
      '<section id="cal-upcoming" tabindex="-1"><h2>Coming up</h2>' + (upcoming.length ? (function () {
        // The next 60 days in full; later dates fold, so the month grid and the near dates lead the page.
        var cut = new Date(today + 'T00:00:00'); cut.setDate(cut.getDate() + 60); cut = iso(cut);
        var soon = upcoming.filter(function (x) { return x.date <= cut; }), later = upcoming.filter(function (x) { return x.date > cut; });
        // The first dozen near dates show; the rest of the 60 days folds behind one button.
        var first = soon.slice(0, 12), more = soon.slice(12);
        return (soon.length ? byMonth(first, today) + (more.length ? '<details class="cal-past" id="cal-soon-more"><summary>More in the next 60 days (' + more.length + ')</summary>' + byMonth(more, today) + '</details>' : '') : '<p>Nothing in the next 60 days for this filter.</p>') +
          (later.length ? '<details class="cal-past" id="cal-later"><summary>Later (' + later.length + ')</summary>' + byMonth(later, today) + '</details>' : '');
      }()) : '<p>Nothing upcoming for this filter.</p>') + '</section>' +
      '<section id="cal-rolling" tabindex="-1"><h2>Open all year</h2><ul class="cal-rolling">' + rolling + '</ul></section>' +
      (past.length ? '<details class="cal-past"><summary>Past entries (' + past.length + ')</summary>' + byMonth(past) + '</details>' : '') +
      '<p class="note">' + (s.data.qap.events.some(function (e) { return e.qap_status === 'draft'; })
        ? 'Dates marked “Draft QAP” come from a plan CHFA has not adopted and can change until the CHFA Board and the Governor approve it. '
        : 'Dates for 2027 and 2028 rounds come from CHFA’s 2027–28 QAP, adopted by the CHFA Board on 25 September 2026 and approved by the Governor on 23 October 2026. ') +
      'Members see their own deal deadlines on this calendar on the member site.</p>' +
      T.source('CHFA Dates and Deadlines and Qualified Allocation Plan pages', meta.source_url || 'https://www.chfainfo.com/rental-housing/housing-credit/dates-and-deadlines', 'checked ' + meta.generated) +
      s.data.events.sources.filter(function (x) { return safe(x.url) && x.status === 'ok'; })
        .map(function (x) { return T.source(x.name, safe(x.url), 'as of ' + em.as_of); }).join('') +
      (down.length ? '<p class="note">Not read on ' + esc(nice(em.as_of)) + ': ' + esc(down.join('; ')) + '. Their dates are missing until the next read.</p>' : '') +
      T.next('Next', [{ href: '#/opportunity/round-one', label: 'Latest CHFA awards →' }, { href: '#/news', label: 'Housing news', secondary: true }]);
  }

  Shell.views.calendar = view;
  global.LabCalendar = { view: view, entries: entries, clean: clean };
})(window);
