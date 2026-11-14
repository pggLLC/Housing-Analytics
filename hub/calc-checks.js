// Calculator move, piece E: the live Deal Calculator's Development Realism Checklists on the Deal hub's
// Financials page. The three panels the live page shows (public-private partnerships, Colorado-specific
// factors, project type guidance) are drawn by the live page's own module, js/components/development-realism.js,
// so every item, note and source link is that file's wording. The module is loaded when Financials opens,
// drawn once off screen, and its panels are then placed here with each tick box named.
//
// The live page forgets a tick when it is reloaded. This page redraws itself after every change above, so a
// tick is saved with the scenario (overrides.realismChecks, in this browser) or it would be lost at once.
// A tick changes no figure and is read by nothing else.
(function (global) {
  'use strict';
  var P = global.LabProjects, Shell = global.LabShell;
  var PATH = 'js/components/development-realism.js', KEY = 'realismChecks';
  var PANELS = ['renderPartnershipPanel', 'renderColoradoFactors', 'renderProjectTypeGuidance'];
  var state = null;   // null: not asked; 'loading'; 'failed'; 'ready'
  var panels = null;  // [{ id, title, el (the staged <details>, kept off the page), items: [{ id, group, text }] }]

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // A tick is kept under its item's words, so a tick stays with its item if the live file reorders its list.
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }

  function stage() {
    var D = global.DevRealism, host = document.createElement('div');
    host.hidden = true;
    document.body.appendChild(host);
    var seen = {};
    panels = PANELS.map(function (fn, n) {
      var box = document.createElement('div');
      box.id = 'lab-realism-stage-' + n;
      host.appendChild(box);
      if (typeof D[fn] !== 'function') return null;
      D[fn](box.id);
      var det = box.querySelector('details');
      if (!det) return null;
      var sum = det.querySelector('summary'), group = '', items = [];
      // The live summary opens with a picture character; the title is the words after it.
      var title = (sum ? sum.textContent : '').replace(/^[^A-Za-z]+/, '').trim();
      if (sum) det.removeChild(sum);
      Array.prototype.forEach.call(det.querySelectorAll('h4, input[type="checkbox"]'), function (el) {
        if (el.tagName === 'H4') { group = el.textContent.trim(); return; }
        var label = el.closest('label'), text = ((label && label.querySelector('.devr-item-text')) || label || el).textContent.trim();
        var id = slug(text);
        while (seen[id]) id += '-2';
        seen[id] = true;
        el.setAttribute('name', 'chk:' + id);
        items.push({ id: id, group: group, text: text });
      });
      // Links leave the site in the lab's way: same tab, marked with an arrow.
      Array.prototype.forEach.call(det.querySelectorAll('a[href]'), function (a) {
        a.removeAttribute('target'); a.removeAttribute('rel');
        if (!/↗\s*$/.test(a.textContent)) a.appendChild(document.createTextNode(' ↗'));
      });
      return { id: 'realism-' + n, title: title, el: det, items: items };
    }).filter(Boolean);
    document.body.removeChild(host);
    state = panels.length ? 'ready' : 'failed';
  }

  function load() {
    if (state) return;
    if (global.DevRealism) { stage(); return; }
    state = 'loading';
    var el = document.createElement('script');
    el.src = global.LAB_VENDOR + PATH;
    el.onload = function () { if (global.DevRealism) stage(); else state = 'failed'; patch(); };
    el.onerror = function () { state = 'failed'; patch(); };
    document.body.appendChild(el);
  }

  function saved(p, sid) {
    var o = p && p.overrides && p.overrides[sid] && p.overrides[sid][KEY];
    return o && typeof o === 'object' ? o : {};
  }
  function count(panel, ticks) { return panel.items.filter(function (i) { return ticks[i.id]; }).length; }
  function tally(panel, ticks) { return panel.items.length ? count(panel, ticks) + ' of ' + panel.items.length + ' ticked' : 'reference'; }

  function body(p, sid) {
    if (state === 'failed') return '<p class="note" data-role="realism-status">The checklists did not load. Reload the page to try again.</p>';
    if (state !== 'ready') return '<p class="note" data-role="realism-status">Loading the checklists…</p>';
    var ticks = saved(p, sid);
    return panels.map(function (panel) {
      Array.prototype.forEach.call(panel.el.querySelectorAll('input[type="checkbox"]'), function (el) {
        if (ticks[el.name.slice(4)]) el.setAttribute('checked', ''); else el.removeAttribute('checked');
      });
      return '<details class="devr-panel" id="' + panel.id + '"><summary class="devr-summary">' + esc(panel.title) +
        ' <span class="note" data-role="realism-tally">' + esc(tally(panel, ticks)) + '</span></summary>' + panel.el.innerHTML + '</details>';
    }).join('');
  }

  function render(p, s) {
    load();
    return '<section class="fin-section realism" data-role="realism" data-pid="' + esc(p.projectId) + '" data-sid="' + esc(s.scenarioId) + '" aria-labelledby="fin-realism">' +
      '<h2 id="fin-realism">Development realism checklists</h2>' +
      '<p>These factors are not modeled above but can decide whether a deal works. Review them before spending on predevelopment.</p>' +
      '<p class="note">A tick is kept with this scenario in this browser. It changes no figure, and the share link and deal file do not carry it.</p>' +
      '<div data-role="realism-body">' + body(p, s.scenarioId) + '</div></section>';
  }

  // The live file arriving late redraws only this section's own block, so a fold the reader has open elsewhere stays open.
  function patch() {
    var sec = document.querySelector('[data-role="realism"]'), box = sec && sec.querySelector('[data-role="realism-body"]');
    if (!box) return;
    box.innerHTML = body(P.get(sec.dataset.pid), sec.dataset.sid);
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.name || t.name.indexOf('chk:') !== 0 || state !== 'ready') return;
    var sec = t.closest('[data-role="realism"]');
    if (!sec) return;
    var p = P.get(sec.dataset.pid), sid = sec.dataset.sid;
    if (!p) return;
    var ticks = JSON.parse(JSON.stringify(saved(p, sid))), id = t.name.slice(4);
    if (t.checked) ticks[id] = true; else delete ticks[id];
    P.setOverride(sec.dataset.pid, sid, KEY, ticks);
    var det = t.closest('details.devr-panel'), panel = det && panels.filter(function (x) { return x.id === det.id; })[0];
    var out = det && det.querySelector('[data-role="realism-tally"]');
    if (panel && out) out.textContent = tally(panel, ticks);
  });

  global.LabCalcChecks = { render: render, _state: function () { return state; }, _panels: function () { return panels; }, KEY: KEY };
})(window);
