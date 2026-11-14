/*
 * The place and saved-projects row of deal-market-analysis.html.
 *
 * On market-analysis.html the header (js/navigation.js) carries a pill with the place the visitor is working on.
 * A click on it opens a short list: up to three saved projects, the open one marked, and "New Project". The new
 * pages' header has no such pill, so the new page keeps both jobs here, in a row of its own above the page.
 *
 * Nothing new is stored or computed. The place is read the way the pill reads it (the open project in
 * WorkflowState, else the county in SiteState). The projects are WorkflowState.listProjects(), the first three, as
 * in the pill. Opening one calls WorkflowState.loadProject(id), as the pill does. "New project" goes to the same
 * address (select-jurisdiction.html?new=1) and clears the county first, as the pill does.
 *
 * The row is an empty <div id="maPlaceRow"> written by scripts/build-market-analysis-hub.mjs. Without this
 * script it stays hidden.
 */
(function () {
  'use strict';

  var row = document.getElementById('maPlaceRow');
  if (!row) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The place, as js/navigation.js builds the pill's label: "Town · County", or the county alone.
  function placeLabel() {
    var county = null, city = null;
    try {
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (jx && (jx.name || jx.countyName)) {
        var isPlace = /^(city|town|cdp|place)$/i.test(jx.type || '');
        county = jx.countyName || (!isPlace ? jx.name : null) || jx.name;
        if (isPlace) {
          var label = jx.displayName || jx.name || '';
          if (label && label !== county) city = label.replace(/\s*\((?:city|town|CDP)\)/i, '');
        }
      }
    } catch (_) {}
    if (!county) {
      try {
        var sc = window.SiteState && window.SiteState.getCounty();
        if (sc && sc.name) county = sc.name;
      } catch (_) {}
    }
    return county ? (city ? city + ' · ' + county : county) : '';
  }

  function projects() {
    try { return (window.WorkflowState && window.WorkflowState.listProjects()) || []; } catch (_) { return []; }
  }

  function activeId() {
    try {
      var a = window.WorkflowState && window.WorkflowState.getActiveProject();
      // The pill reads a.id, which a project does not carry (its id is _meta.projectId), so the pill never marks
      // the open project. Read both, so the mark the pill means to draw is drawn here.
      return a && (a.id || (a._meta && a._meta.projectId));
    } catch (_) { return null; }
  }

  function draw() {
    var place = placeLabel();
    var list = projects().slice(0, 3);
    var cur = activeId();
    var html = '<p class="ma-place-row__place">' +
      (place ? 'Working on: <strong>' + esc(place) + '</strong>' : 'No place chosen yet.') + '</p>' +
      '<details class="ma-place-row__projects"><summary>Saved projects</summary><div class="ma-place-row__menu">';
    if (list.length) {
      html += '<p class="ma-place-row__label" id="maPlaceRowLabel">Recent projects</p><ul aria-labelledby="maPlaceRowLabel">';
      list.forEach(function (p) {
        var open = p.id === cur;
        html += '<li><button type="button" data-proj-id="' + esc(p.id) + '"' + (open ? ' aria-current="true"' : '') + '>' +
          esc((p.name || 'Untitled project').slice(0, 28)) + (open ? ' <span class="ma-place-row__now">open now</span>' : '') +
          '</button></li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="ma-place-row__label">No project is saved in this browser yet.</p>';
    }
    html += '<a class="ma-place-row__new" href="select-jurisdiction.html?new=1">New project</a>' +
      '<a class="ma-place-row__change" href="select-jurisdiction.html">' + (place ? 'Change place' : 'Choose a place') + '</a>' +
      '</div></details>';
    row.innerHTML = html;
    row.hidden = false;
  }

  function menu() { return row.querySelector('details'); }

  row.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var btn = t.closest('[data-proj-id]');
    if (btn) {
      try { if (window.WorkflowState) window.WorkflowState.loadProject(btn.getAttribute('data-proj-id')); } catch (_) {}
      draw();
      var s = row.querySelector('summary');
      if (s) s.focus();
      return;
    }
    if (t.closest('.ma-place-row__new')) {
      // So the new project does not take the old county into its name (as the pill does).
      try { if (window.SiteState && window.SiteState.setCounty) window.SiteState.setCounty(null); } catch (_) {}
    }
  });

  // A click anywhere else, or Escape, closes the list.
  document.addEventListener('click', function (e) {
    var d = menu();
    if (d && d.open && !d.contains(e.target)) d.open = false;
  });
  document.addEventListener('keydown', function (e) {
    var d = menu();
    if (e.key === 'Escape' && d && d.open) {
      d.open = false;
      var s = d.querySelector('summary');
      if (s) s.focus();
    }
  });

  // The place changes when a step is saved or another project is opened: draw again, unless the list is open.
  function redraw() { var d = menu(); if (!d || !d.open) draw(); }
  document.addEventListener('workflow:step-updated', redraw);
  document.addEventListener('workflow:project-loaded', redraw);

  draw();
}());
