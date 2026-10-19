/**
 * ask-pggllc.js — "Ask pggLLC" on the gated developer pages: anyone signed in
 * asks for a clarification, and pggLLC answers in the same list, so everyone
 * let into the site reads the answer. Nothing is emailed.
 *
 * The questions are saved on the private site (/api/questions, coho-backend).
 * On any other copy of the page the form says where questions are kept instead
 * of pretending to send.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.AskPggllc in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AskPggllc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var URL = 'api/questions';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Unanswered first, then newest.
  function order(list) {
    return (list || []).slice().sort(function (a, b) {
      var oa = a.answer ? 1 : 0, ob = b.answer ? 1 : 0;
      if (oa !== ob) return oa - ob;
      return String(b.asked || '').localeCompare(String(a.asked || ''));
    });
  }

  function item(q, canAnswer) {
    var where = q.place ? esc(q.place) : '';
    return '<li class="ask-q" data-id="' + esc(q.id) + '">' +
      '<p class="ask-text">' + esc(q.question) + '</p>' +
      '<p class="ask-meta">Asked ' + esc(q.asked) + (q.by ? ' by ' + esc(q.by) : '') + (where ? ' about ' + where : '') + '</p>' +
      (q.answer
        ? '<p class="ask-answer"><strong>pggLLC:</strong> ' + esc(q.answer) + '</p><p class="ask-meta">Answered ' + esc(q.answered) + '</p>'
        : '<p class="ask-open">Waiting for an answer.</p>' + (canAnswer
          ? '<form class="ask-answer-form"><label>Answer<textarea name="text" rows="2" required></textarea></label><button type="submit">Save answer</button></form>'
          : '')) +
      '</li>';
  }

  // opts: {questions (array or null when the site can't save), place, page, limit, form}
  function render(opts) {
    opts = opts || {};
    var list = opts.questions;
    var saving = Array.isArray(list);
    var shown = order(list).slice(0, opts.limit || 500);
    var form = opts.form === false ? '' : saving
      ? '<form id="askForm" class="ask-form">' +
        '<label for="askQuestion">What should pggLLC clarify?</label>' +
        '<textarea id="askQuestion" name="question" rows="3" required placeholder="e.g. Why is Buena Vista ripening and not ripe?"></textarea>' +
        '<label for="askPlace">Place (optional)</label>' +
        '<input id="askPlace" name="place" value="' + esc(opts.place || '') + '" autocomplete="off">' +
        '<button type="submit">Send to pggLLC</button>' +
        '<p class="ask-note">Saved on this site for everyone signed in. Nothing is emailed.</p></form>'
      : '<p class="ask-note">Questions are saved on the developer site; open this page there to ask one.</p>';
    var none = saving && !shown.length ? '<p class="ask-note">No questions yet.</p>' : '';
    return form + none + (shown.length ? '<ul class="ask-list">' + shown.map(function (q) { return item(q, opts.form !== false); }).join('') + '</ul>' : '');
  }

  function post(body) {
    return fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('save failed'); return r.json(); });
  }

  // Draw into `el` and keep it live. opts as render(), minus questions.
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    function draw(list) {
      el.innerHTML = render(Object.assign({}, opts, { questions: list }));
      var f = el.querySelector('#askForm');
      if (f) f.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = f.querySelector('button'); btn.disabled = true;
        post({ question: f.question.value, place: f.place.value, page: opts.page || '' })
          .then(draw).catch(function () { btn.disabled = false; btn.textContent = 'Not saved. Try again'; });
      });
      Array.prototype.forEach.call(el.querySelectorAll('.ask-answer-form'), function (af) {
        af.addEventListener('submit', function (e) {
          e.preventDefault();
          var id = af.closest('.ask-q').getAttribute('data-id');
          post({ answer: id, text: af.text.value }).then(draw).catch(function () { af.querySelector('button').textContent = 'Not saved. Try again'; });
        });
      });
    }
    fetch(URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) { draw(Array.isArray(list) ? list : null); })
      .catch(function () { draw(null); });
  }

  var STYLE = '.ask-form{display:grid;gap:.4rem;max-width:44rem}.ask-form textarea,.ask-form input,.ask-answer-form textarea{width:100%;box-sizing:border-box;min-height:44px;padding:.6rem .8rem;border:1px solid var(--border);border-radius:var(--radius-sm,6px);background:var(--bg2);color:var(--text);font:inherit}' +
    '.ask-form button,.ask-answer-form button{justify-self:start;min-height:44px;padding:.6rem 1rem;border-radius:var(--radius-sm,6px);border:1px solid var(--accent);background:var(--accent);color:var(--on-accent,#fff);font-weight:700;cursor:pointer}' +
    '.ask-note,.ask-meta{color:var(--muted);font-size:var(--small,.9rem);margin:.2rem 0}.ask-list{list-style:none;padding:0;margin:1rem 0 0;display:grid;gap:.75rem}' +
    '.ask-q{border:1px solid var(--border);border-radius:var(--radius,8px);padding:.75rem 1rem;background:var(--card)}.ask-text{margin:0 0 .25rem;font-weight:600}.ask-answer{margin:.5rem 0 0}.ask-open{margin:.4rem 0;color:var(--warn)}.ask-answer-form{display:grid;gap:.4rem;margin-top:.4rem}';

  function style(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || doc.getElementById('askStyle')) return;
    var st = doc.createElement('style'); st.id = 'askStyle'; st.textContent = STYLE; doc.head.appendChild(st);
  }

  return { URL: URL, order: order, render: render, mount: function (el, opts) { style(); mount(el, opts); } };
});
