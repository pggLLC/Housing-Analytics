/**
 * local-discussion.js — the "Local discussion" panel on the gated place card.
 *
 * When a developer marks a place "Planning to submit", the private backend's
 * weekly read collects that town's council and commission agendas, packets,
 * minutes and local news, keeps the housing sentences word for word with date
 * and link, counts the housing words by quarter, and lists the dates and pages
 * to check where a portal cannot be read. This panel shows that result:
 * up to four key numbers, what they mean and the next step first, the rest folded.
 *
 * It reads only what the gated site serves: api/watch (the marked places),
 * api/discussion?geoid= (the weekly result and pasted links), and the copy the
 * last deploy carried, data/local-discussion/<geoid>.json. None of that is in
 * this repository: the quotes name officials, so the data stays private.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.LocalDiscussion in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LocalDiscussion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVEL = {
    reads: { label: 'Read automatically', note: 'Every agenda source for this place is read each week.' },
    partly: { label: 'Partly automatic', note: 'Some boards are read each week. For the rest, check the pages on the dates below.' },
    hand: { label: 'Check by hand', note: 'Nothing here can be read automatically. Check the pages on the dates below, then paste what you find.' }
  };

  var RULE = 'A shift is a word whose share of housing words moves 10 points or more against the past 4 quarters, with at least 20 words in each; or a word used for the first time in an adopted ordinance, resolution or plan.';
  // Counts from the backend become plain numbers before they reach the page.
  // A count or share the backend did not supply (absent, null, not a number, or below zero) is unknown, never zero.
  function has(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
  function share(v) { return has(v) && v <= 100; }
  function rising(n) { var w = n && n.rising; return w && label(w.term) && label(w.quarter) && share(w.from) && share(w.to) && w.to > w.from ? w : null; }
  function num(v) { return has(v) ? Math.round(v) : 0; }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  // A shift needs its word and quarter; a change in share also needs both shares.
  function okFlag(f) { return label(f.term) && label(f.quarter) && (f.kind === 'first' || (share(f.from) && share(f.to) && Math.abs(f.to - f.from) >= 10)); }
  function label(v) { return typeof v === 'string' && v.trim() !== ''; }
  // A real calendar date in YYYY-MM-DD form (2026-02-31 is not).
  function isDay(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var p = d.split('-'), t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return t.getUTCFullYear() === +p[0] && t.getUTCMonth() === +p[1] - 1 && t.getUTCDate() === +p[2];
  }
  // A date to check is shown only with its board and both dates.
  function okCheck(c) { c = obj(c); return label(c.body) && isDay(c.check_on) && isDay(c.meeting); }
  // One pass over what the backend sent, so a partial or older result can't break a section.
  function clean(r) {
    var lex = obj(r.lexicon);
    return Object.assign({}, r, {
      numbers: (function (n) {
        n = Object.assign({}, obj(n));
        n.next_check = okCheck(n.next_check) ? n.next_check : null;
        n.hearing = isDay(obj(n.hearing).date) ? n.hearing : null;
        n.rising = Object.keys(obj(n.rising)).length ? n.rising : null;
        return n;
      })(r.numbers), how_read: obj(r.how_read),
      lexicon: { quarters: (Array.isArray(lex.quarters) ? lex.quarters : []).filter(function (q) { return typeof q === 'string'; }),
        counts: obj(lex.counts), flags: arr(lex.flags).filter(okFlag) },
      terms: arr(r.terms), news: arr(r.news), sources: arr(r.sources),
      check_here: arr(r.check_here).filter(okCheck).map(function (c) { return Object.assign({}, c, { page: c.page && typeof c.page === 'object' ? c.page : null }); }),
      timeline: arr(r.timeline).map(function (t) { return Object.assign({}, t, { quotes: arr(t.quotes) }); })
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function link(url, text) {
    return /^https:\/\//.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text);
  }
  function day(d) {
    if (!isDay(d)) return 'date not found';
    var p = d.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function quote(q) {
    if (!q) return '';
    return '<blockquote class="ld-quote">“' + esc(q.quote || q.text) + '”<br><span class="ib-muted">' + esc(day(q.date)) +
      (q.title ? ', ' + esc(q.title) : '') + (q.url ? ' · ' + link(q.url, 'source') : '') + '</span></blockquote>';
  }

  // The four key numbers, one sentence each.
  function keyNumbers(r) {
    r = clean(obj(r));
    var n = r.numbers || {}, out = [];
    var items = has(n.items_90d) ? num(n.items_90d) : null;
    out.push(items === null ? { big: 'Not counted', text: 'the housing item count for the last 90 days did not come through in this read.' }
      : { big: String(items), text: 'housing items on agendas, minutes or packets in the last 90 days.' });
    var c = n.next_check;
    out.push(c ? { big: day(c.check_on), text: 'next date to check: ' + c.body + ' meets ' + day(c.meeting) + '.' }
      : { big: 'None', text: 'no meeting to check in the next 60 days on file.' });
    var w = rising(n);
    out.push(w ? { big: '“' + w.term + '”', text: 'fastest-rising housing word: ' + num(w.from) + '% of housing words in the 4 quarters before, ' + num(w.to) + '% in ' + w.quarter + ' (at least 20 words in each).' }
      : { big: 'Steady', text: 'no word has risen yet; that needs at least 20 housing words in this quarter and in the year before.' });
    var h = n.hearing;
    out.push(h ? { big: day(h.date), text: 'next public hearing or comment date with housing on it' + (label(h.body) ? ' (' + h.body + ')' : '') + '.' }
      : { big: 'None', text: 'no upcoming public hearing or comment deadline found.' });
    return out;
  }

  function meaning(r) {
    r = clean(obj(r));
    var n = r.numbers || {};
    if (rising(n)) return 'Local talk is moving toward “' + n.rising.term + '”. Use the town’s own words when you pitch the deal.';
    if (!has(n.items_90d)) return 'Read the newest quotes before you call.';
    if (!num(n.items_90d)) return 'Housing has been quiet on agendas lately. A first call can set the terms before a debate starts.';
    return 'Housing is on the agenda. Read the latest quotes before you call, so the pitch answers what was said.';
  }

  function nextStep(r) {
    var c = (r.numbers || {}).next_check;
    if (c) return 'Check the ' + esc(c.body) + ' agenda on ' + esc(day(c.check_on)) + (c.url ? ' at ' + link(c.url, 'this page') : '') + '.';
    return 'Read the newest quotes under “What was said”.';
  }

  function checkList(list) {
    if (!list || !list.length) return '<p class="ib-muted">No dates to check in the next 60 days.</p>';
    return '<ul class="ld-list">' + list.map(function (c) {
      var page = c.page ? ' <span class="ld-page ld-page-' + esc(c.page.status) + '">' + esc(c.page.note) + '</span>' : '';
      return '<li><strong>' + esc(day(c.check_on)) + '</strong>: ' + esc(c.body) + ' meets ' + esc(day(c.meeting)) + '. ' +
        (c.url ? link(c.url, c.automatic ? 'Portal' : 'Where to check') : '') + page +
        '<br><span class="ib-muted">' + esc(c.rule) + (c.source_url ? ' ' + link(c.source_url, 'source') : '') + '</span>' +
        (c.source_quote ? '<br><span class="ib-muted">“' + esc(c.source_quote) + '”</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function flags(list) {
    if (!list.length) return '<p class="ib-muted">No shift yet. ' + RULE + '</p>';
    return '<p class="ib-muted">' + RULE + '</p><ul class="ld-list">' + list.map(function (f) {
      var head = f.kind === 'first'
        ? '“' + esc(f.term) + '” first appears in an adopted item (' + esc(f.quarter) + ')'
        : '“' + esc(f.term) + '” ' + (f.to > f.from ? 'rose' : 'fell') + ' from ' + num(f.from) + '% to ' + num(f.to) + '% of housing words (' + esc(f.quarter) + ')';
      return '<li><strong>' + head + '</strong>' + (f.before ? '<br>Before:' + quote(f.before) : '') + (f.after ? (f.before ? 'After:' : '') + quote(f.after) : '') + '</li>';
    }).join('') + '</ul>';
  }

  // A word missing from a quarter was not used there (the read writes only words it found).
  // A quarter with no counts map, or holding a count that is not a number, is unavailable: no shares are worked out for it.
  function wordTable(r) {
    var lex = r.lexicon, qs = lex.quarters, terms = r.terms;
    var counts = {}, bad = {};
    qs.forEach(function (q) {
      var raw = lex.counts[q];
      counts[q] = obj(raw);
      bad[q] = counts[q] !== raw || Object.keys(counts[q]).some(function (k) { return !has(counts[q][k]); });
    });
    var used = terms.filter(function (t) { return qs.some(function (q) { return counts[q][t.term] !== undefined; }); });
    if (!qs.length || !used.length) return '<p class="ib-muted">No housing words counted yet.</p>';
    var tot = {};
    qs.forEach(function (q) { tot[q] = bad[q] ? null : Object.keys(counts[q]).reduce(function (a, k) { return a + num(counts[q][k]); }, 0); });
    return '<div class="ld-table-wrap"><table class="ld-table"><thead><tr>' +
      '<th data-tip="The housing word or phrase counted. Each counts only in a sentence that also names housing.">Word</th>' +
      '<th data-tip="How housing is named, the tools in play, the form of building, or pushback.">Group</th>' +
      qs.map(function (q) {
        return '<th data-tip="' + (bad[q] ? 'Counts for ' + esc(q) + ' did not come through in this read, so no shares are shown.'
          : 'Share of all housing words counted in ' + esc(q) + ' (' + num(tot[q]) + ' words).') + '">' + esc(q) + '</th>';
      }).join('') +
      '</tr></thead><tbody>' + used.map(function (t) {
        return '<tr><td>' + esc(t.term) + '</td><td>' + esc(t.group) + '</td>' + qs.map(function (q) {
          if (bad[q]) return '<td data-sort="">n/a</td>';
          var k = num(counts[q][t.term]);
          return '<td data-sort="' + (tot[q] ? (100 * k / tot[q]).toFixed(1) : 0) + '">' + (k ? Math.round(100 * k / tot[q]) + '% <span class="ib-muted">(' + k + ')</span>' : '·') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function timeline(list) {
    if (!list || !list.length) return '<p class="ib-muted">No housing sentences found yet.</p>';
    return '<ul class="ld-list">' + list.slice(0, 25).map(function (t) {
      return '<li><strong>' + esc(day(t.date)) + '</strong> ' + link(t.url, t.title) +
        (t.quotes || []).slice(0, 2).map(function (q) { return '<blockquote class="ld-quote">“' + esc(q.text) + '”</blockquote>'; }).join('') + '</li>';
    }).join('') + '</ul>';
  }

  function news(list) {
    if (!list || !list.length) return '<p class="ib-muted">No local housing news found in the last search.</p>';
    return '<ul class="ld-list">' + list.map(function (n) {
      return '<li><strong>' + esc(day(n.date)) + '</strong> ' + link(n.url, n.title) + ' <span class="ib-muted">' + esc(n.source) +
        (n.blocked ? ' · this publisher blocks automated reading, so only the headline is listed' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  function sources(r) {
    var s = r.sources || [];
    if (!s.length) return '';
    return '<ul class="ld-list">' + s.map(function (x) {
      return '<li>' + link(x.url, x.label) + ': ' + (x.ok ? 'read this week' + (num(x.new_docs) ? ', ' + num(x.new_docs) + ' new' : '') : 'could not be read this week') + '</li>';
    }).join('') + '</ul>';
  }

  function linksForm(geoid, links) {
    var mine = arr(links).map(function (l) {
      return '<li>' + esc(day(l.date || l.added)) + ' ' + (l.url ? link(l.url, l.title || l.url) : esc(l.title || 'Pasted text')) +
        ' <button type="button" class="ld-remove" data-link="' + esc(l.id) + '">Remove</button></li>';
    }).join('');
    return (mine ? '<ul class="ld-list">' + mine + '</ul>' : '') +
      '<form class="ld-form" data-geoid="' + esc(geoid) + '"><fieldset><legend>Add an agenda, minutes or news link</legend>' +
      '<label>Link to the agenda, minutes or article<input name="url" type="url" inputmode="url" placeholder="Paste the web address"></label>' +
      '<label>Meeting date<input name="date" type="date"></label>' +
      '<label>Board<input name="body" type="text" placeholder="e.g. Town Board"></label>' +
      '<label>If the page will not open for us, paste its text<textarea name="text" rows="3"></textarea></label>' +
      '<button type="submit">Add</button> <span class="ld-status" role="status" tabindex="-1"></span>' +
      '<p class="ib-muted">Counted in the next weekly read, the same way as the automatic sources.</p></fieldset></form>';
  }

  function render(o) {
    var r = o.result && typeof o.result === 'object' ? clean(o.result) : null, name = o.name || 'this place', on = !!o.watched;
    var h = '<section class="ld-panel" aria-labelledby="ldHead"><h3 id="ldHead">Local discussion</h3>';
    h += '<p><button type="button" class="ld-switch" aria-pressed="' + (on ? 'true' : 'false') + '"' + (o.watchState === 'ok' ? '' : ' disabled') + '>' +
      (on ? 'Planning to submit: on' : 'Mark as planning to submit') + '</button> <span class="ld-switch-status" role="status"></span></p>';
    if (o.watchState === 'error') h += '<p class="ib-muted">The watch list did not load. Check you are still signed in.</p>';
    if (!r && o.loadError) return h + '<p>The local discussion read did not load. Check you are still signed in, then reload the page.</p></section>';
    if (!r) {
      return h + '<p>' + (on ? 'Not read yet. The first weekly read runs on Monday.' :
        'Mark this place to track council and commission agendas, minutes and local news about housing here, and how the local words change.') + '</p>' +
        (on ? linksForm(o.geoid, o.links) : '') + '</section>';
    }
    if (!on) h += '<p class="ib-muted">' + (r.starting_place ? esc(r.name || name) + ' is on the starting list, so it is read every week either way.'
      : 'Not marked, so this read from ' + esc(day(r.updated)) + ' will not be updated.') + '</p>';
    var lvl = LEVEL[r.how_read.level] || LEVEL.hand;
    h += '<div class="ld-numbers">' + keyNumbers(r).map(function (k) {
      return '<div class="ld-num"><span class="ld-big">' + esc(k.big) + '</span> <span>' + esc(k.text) + '</span></div>';
    }).join('') + '</div>';
    h += '<p><strong>What this means:</strong> ' + esc(meaning(r)) + '</p><p><strong>Next step:</strong> ' + nextStep(r) + '</p>';
    h += '<p class="ld-how"><span class="ld-level ld-level-' + esc((r.how_read || {}).level) + '">' + esc(lvl.label) + '</span> ' +
      esc((r.how_read || {}).text || lvl.note) + ' <span class="ib-muted">Read ' + esc(day(r.updated)) + '; ' + (has(r.documents_read) ? esc(num(r.documents_read)) + ' documents on file' : 'document count not available') +
      '' + (r.history_since ? ' since ' + esc(day(r.history_since)) : '') + '.</span></p>';
    var fold = function (title, body) { return '<details class="ld-fold"><summary>' + esc(title) + '</summary>' + body + '</details>'; };
    h += fold('Dates and pages to check (' + r.check_here.length + ')', checkList(r.check_here));
    h += fold('Word shifts (' + r.lexicon.flags.length + ')', flags(r.lexicon.flags));
    h += fold('Housing words by quarter', wordTable(r));
    h += fold('What was said (' + r.timeline.length + ')', timeline(r.timeline));
    h += fold('Local news (' + r.news.length + ')', news(r.news));
    h += fold('Sources read', sources(r) + '<p class="ib-muted">' + esc(lvl.note) + '</p>');
    h += fold('Add a link (' + arr(o.links).length + ')', linksForm(o.geoid, o.links));
    return h + '</section>';
  }

  // null when there is nothing there (404); 'error' when the request failed, so an outage is not read as "nothing yet".
  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return null;
      return r.ok && /json/.test(r.headers.get('Content-Type') || '') ? r.json() : 'error';
    }).catch(function () { return 'error'; });
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t || 'not saved'); }); return r.json(); });
  }

  // Mount the panel into el for one place.
  function mount(el, geoid, name) {
    if (!el) return;
    var o = { geoid: geoid, name: name, result: null, links: [], watched: false, watchState: 'loading' };
    // After a save the panel is redrawn; focus returns to the control used and its status says what happened.
    var draw = function (focusSel, statusSel, msg) {
      el.innerHTML = render(o); wire();
      var f = focusSel && el.querySelector(focusSel), s = statusSel && el.querySelector(statusSel);
      if (s && msg) s.textContent = msg;
      if (f) { var d = f.closest && f.closest('details'); if (d) d.open = true; f.focus(); }
    };
    function wire() {
      var sw = el.querySelector('.ld-switch');
      if (sw) sw.addEventListener('click', function () {
        sw.disabled = true;
        post('api/watch', { geoid: geoid, name: name, on: !o.watched }).then(function (list) {
          o.watched = arr(list).some(function (w) { return w.geoid === geoid; });
          draw('.ld-switch', '.ld-switch-status', o.watched ? 'Saved: planning to submit.' : 'Saved: no longer marked.');
        }, function (e) {
          sw.disabled = false;
          var s = el.querySelector('.ld-switch-status'); if (s) s.textContent = /full/.test(e.message) ? 'The watch list is full (20 places). Unmark one first.' : 'Not saved. Check you are still signed in.';
        });
      });
      var form = el.querySelector('.ld-form');
      if (form) form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = form.elements, status = form.querySelector('.ld-status');
        var body = { geoid: geoid, url: f.url.value.trim(), date: f.date.value, body: f.body.value.trim(), text: f.text.value };
        if (!body.url && !body.text.trim()) { status.textContent = 'Add a link or paste the text.'; status.focus(); return; }
        post('api/discussion', body).then(function (list) { o.links = arr(list); draw('.ld-status', '.ld-status', 'Added. It is counted in the next weekly read.'); }, function () { status.textContent = 'Not added. Check the link is a full web address starting with https, and that you are still signed in.'; status.focus(); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('.ld-remove'), function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          post('api/discussion', { geoid: geoid, remove: b.getAttribute('data-link') }).then(function (list) { o.links = arr(list); draw('.ld-status', '.ld-status', 'Link removed.'); }, function () {
            b.disabled = false;
            var st = el.querySelector('.ld-status'); if (st) { st.textContent = 'Not removed. Check you are still signed in.'; st.focus(); }
          });
        });
      });
    }
    draw();
    Promise.all([
      fetch('api/watch', { cache: 'no-cache' }).then(function (r) { return r.ok && /json/.test(r.headers.get('Content-Type') || '') ? r.json() : 'error'; }).catch(function () { return 'error'; }),
      getJson('api/discussion?geoid=' + encodeURIComponent(geoid)),
      getJson('data/local-discussion/' + encodeURIComponent(geoid) + '.json')
    ]).then(function (res) {
      var watch = res[0], live = res[1], shipped = res[2];
      o.watchState = Array.isArray(watch) ? 'ok' : 'error';
      o.watched = Array.isArray(watch) && watch.some(function (w) { return w.geoid === geoid; });
      // The newer of the live result and the copy the last deploy carried.
      var failed = live === 'error' || shipped === 'error';
      if (live === 'error') live = null;
      if (shipped === 'error') shipped = null;
      var a = live && live.result, b = shipped;
      o.result = a && b ? ((a.updated || '') >= (b.updated || '') ? a : b) : (a || b || null);
      o.links = arr(live && live.links);
      o.loadError = failed && !o.result;
      draw();
    });
  }

  return { render: render, keyNumbers: keyNumbers, meaning: meaning, mount: mount, LEVEL: LEVEL };
});
