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

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function link(url, text) {
    return /^https:\/\//.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text);
  }
  function day(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return 'date not found';
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
    var n = r.numbers || {}, out = [];
    out.push({ big: String(n.items_90d || 0), text: 'housing items on agendas, minutes or packets in the last 90 days.' });
    var c = n.next_check;
    out.push(c ? { big: day(c.check_on), text: 'next date to check: ' + c.body + ' meets ' + day(c.meeting) + '.' }
      : { big: 'None', text: 'no meeting to check in the next 60 days on file.' });
    var w = n.rising;
    out.push(w ? { big: '“' + w.term + '”', text: 'fastest-rising housing word: ' + w.from + '% of housing words before, ' + w.to + '% in ' + w.quarter + '.' }
      : { big: 'Steady', text: 'no word has risen yet; that needs at least 20 housing words in this quarter and in the year before.' });
    var h = n.hearing;
    out.push(h ? { big: day(h.date), text: 'next public hearing or comment date with housing on it (' + h.body + ').' }
      : { big: 'None', text: 'no upcoming public hearing or comment deadline found.' });
    return out;
  }

  function meaning(r) {
    var n = r.numbers || {};
    if (n.rising) return 'Local talk is moving toward “' + n.rising.term + '”. Use the town’s own words when you pitch the deal.';
    if (!n.items_90d) return 'Housing has been quiet on agendas lately. A first call can set the terms before a debate starts.';
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
    if (!list || !list.length) return '<p class="ib-muted">No shift yet. A shift is a word whose share of housing words moves 10 points or more against the year before, with at least 20 words in each; or a word used for the first time in an adopted ordinance, resolution or plan.</p>';
    return '<ul class="ld-list">' + list.map(function (f) {
      var head = f.kind === 'first'
        ? '“' + esc(f.term) + '” first appears in an adopted item (' + esc(f.quarter) + ')'
        : '“' + esc(f.term) + '” ' + (f.to > f.from ? 'rose' : 'fell') + ' from ' + esc(f.from) + '% to ' + esc(f.to) + '% of housing words (' + esc(f.quarter) + ')';
      return '<li><strong>' + head + '</strong>' + (f.before ? '<br>Before:' + quote(f.before) : '') + (f.after ? (f.before ? 'After:' : '') + quote(f.after) : '') + '</li>';
    }).join('') + '</ul>';
  }

  function wordTable(r) {
    var lex = r.lexicon || {}, qs = lex.quarters || [], terms = r.terms || [];
    var used = terms.filter(function (t) { return qs.some(function (q) { return (lex.counts[q] || {})[t.term]; }); });
    if (!qs.length || !used.length) return '<p class="ib-muted">No housing words counted yet.</p>';
    var tot = {};
    qs.forEach(function (q) { tot[q] = Object.keys(lex.counts[q] || {}).reduce(function (a, k) { return a + lex.counts[q][k]; }, 0); });
    return '<div class="ld-table-wrap"><table class="ld-table"><thead><tr>' +
      '<th data-tip="The housing word or phrase counted. Each counts only in a sentence that also names housing.">Word</th>' +
      '<th data-tip="How housing is named, the tools in play, the form of building, or pushback.">Group</th>' +
      qs.map(function (q) { return '<th data-tip="Share of all housing words counted in ' + esc(q) + ' (' + tot[q] + ' words).">' + esc(q) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + used.map(function (t) {
        return '<tr><td>' + esc(t.term) + '</td><td>' + esc(t.group) + '</td>' + qs.map(function (q) {
          var k = (lex.counts[q] || {})[t.term] || 0;
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
      return '<li>' + link(x.url, x.label) + ': ' + (x.ok ? 'read this week' + (x.new_docs ? ', ' + x.new_docs + ' new' : '') : 'could not be read this week') + '</li>';
    }).join('') + '</ul>';
  }

  function linksForm(geoid, links) {
    var mine = (links || []).map(function (l) {
      return '<li>' + esc(day(l.date || l.added)) + ' ' + (l.url ? link(l.url, l.title || l.url) : esc(l.title || 'Pasted text')) +
        ' <button type="button" class="ld-remove" data-link="' + esc(l.id) + '">Remove</button></li>';
    }).join('');
    return (mine ? '<ul class="ld-list">' + mine + '</ul>' : '') +
      '<form class="ld-form" data-geoid="' + esc(geoid) + '"><fieldset><legend>Add an agenda, minutes or news link</legend>' +
      '<label>Link (https://)<input name="url" type="url" inputmode="url" placeholder="https://"></label>' +
      '<label>Meeting date<input name="date" type="date"></label>' +
      '<label>Board<input name="body" type="text" placeholder="e.g. Town Board"></label>' +
      '<label>If the page will not open for us, paste its text<textarea name="text" rows="3"></textarea></label>' +
      '<button type="submit">Add</button> <span class="ld-status" role="status" tabindex="-1"></span>' +
      '<p class="ib-muted">Counted in the next weekly read, the same way as the automatic sources.</p></fieldset></form>';
  }

  function render(o) {
    var r = o.result, name = o.name || 'this place', on = !!o.watched;
    var h = '<section class="ld-panel" aria-labelledby="ldHead"><h3 id="ldHead">Local discussion</h3>';
    h += '<p><button type="button" class="ld-switch" aria-pressed="' + (on ? 'true' : 'false') + '"' + (o.watchState === 'ok' ? '' : ' disabled') + '>' +
      (on ? 'Planning to submit: on' : 'Mark as planning to submit') + '</button> <span class="ld-switch-status" role="status"></span></p>';
    if (o.watchState === 'error') h += '<p class="ib-muted">The watch list did not load. Check you are still signed in.</p>';
    if (!r) {
      return h + '<p>' + (on ? 'Not read yet. The first weekly read runs on Monday.' :
        'Mark this place to track council and commission agendas, minutes and local news about housing here, and how the local words change.') + '</p>' +
        (on ? linksForm(o.geoid, o.links) : '') + '</section>';
    }
    if (!on) h += '<p class="ib-muted">' + (r.starting_place ? esc(r.name || name) + ' is on the starting list, so it is read every week either way.'
      : 'Not marked, so this read from ' + esc(day(r.updated)) + ' will not be updated.') + '</p>';
    var lvl = LEVEL[(r.how_read || {}).level] || LEVEL.hand;
    h += '<div class="ld-numbers">' + keyNumbers(r).map(function (k) {
      return '<div class="ld-num"><span class="ld-big">' + esc(k.big) + '</span> <span>' + esc(k.text) + '</span></div>';
    }).join('') + '</div>';
    h += '<p><strong>What this means:</strong> ' + esc(meaning(r)) + '</p><p><strong>Next step:</strong> ' + nextStep(r) + '</p>';
    h += '<p class="ld-how"><span class="ld-level ld-level-' + esc((r.how_read || {}).level) + '">' + esc(lvl.label) + '</span> ' +
      esc((r.how_read || {}).text || lvl.note) + ' <span class="ib-muted">Read ' + esc(day(r.updated)) + '; ' + esc(r.documents_read || 0) +
      ' documents on file' + (r.history_since ? ' since ' + esc(day(r.history_since)) : '') + '.</span></p>';
    var fold = function (title, body) { return '<details class="ld-fold"><summary>' + esc(title) + '</summary>' + body + '</details>'; };
    h += fold('Dates and pages to check (' + (r.check_here || []).length + ')', checkList(r.check_here));
    h += fold('Word shifts (' + ((r.lexicon || {}).flags || []).length + ')', flags((r.lexicon || {}).flags));
    h += fold('Housing words by quarter', wordTable(r));
    h += fold('What was said (' + (r.timeline || []).length + ')', timeline(r.timeline));
    h += fold('Local news (' + (r.news || []).length + ')', news(r.news));
    h += fold('Sources read', sources(r) + '<p class="ib-muted">' + esc(lvl.note) + '</p>');
    h += fold('Add a link (' + (o.links || []).length + ')', linksForm(o.geoid, o.links));
    return h + '</section>';
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      return r.ok && /json/.test(r.headers.get('Content-Type') || '') ? r.json() : null;
    }).catch(function () { return null; });
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t || 'not saved'); }); return r.json(); });
  }

  // Mount the panel into el for one place.
  function mount(el, geoid, name) {
    if (!el) return;
    var o = { geoid: geoid, name: name, result: null, links: [], watched: false, watchState: 'loading' };
    var draw = function () { el.innerHTML = render(o); wire(); };
    function wire() {
      var sw = el.querySelector('.ld-switch');
      if (sw) sw.addEventListener('click', function () {
        sw.disabled = true;
        post('api/watch', { geoid: geoid, name: name, on: !o.watched }).then(function (list) {
          o.watched = list.some(function (w) { return w.geoid === geoid; }); draw();
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
        post('api/discussion', body).then(function (list) { o.links = list; draw(); }, function () { status.textContent = 'Not added. Check the link starts with https:// and you are still signed in.'; status.focus(); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('.ld-remove'), function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          post('api/discussion', { geoid: geoid, remove: b.getAttribute('data-link') }).then(function (list) { o.links = list; draw(); }, function () { b.disabled = false; });
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
      var a = live && live.result, b = shipped;
      o.result = a && b ? ((a.updated || '') >= (b.updated || '') ? a : b) : (a || b || null);
      o.links = (live && live.links) || [];
      draw();
    });
  }

  return { render: render, keyNumbers: keyNumbers, meaning: meaning, mount: mount, LEVEL: LEVEL };
});
