/* One curated timeline for Insights lists and chart annotations. */
(function (root) {
  'use strict';
  var pending;
  function load() {
    if (!pending) {
      var url = 'data/policy/policy-timeline.json';
      if (root.resolveAssetUrl) url = root.resolveAssetUrl(url);
      pending = root.fetch(url).then(function (r) {
        if (!r.ok) throw new Error('Policy timeline unavailable');
        return r.json();
      });
    }
    return pending;
  }
  function status(event, today) {
    // A dated milestone is historical even if its law remains in force.
    return event.date < (today || new Date().toISOString().slice(0, 10)) ? 'historical' : event.status;
  }
  // One color per event, so a chart's event key can be read. The colors are
  // the --event-1..12 tokens in css/site-theme.css (light and dark sets, each
  // >= 4.5:1 on its card and >= 20 apart in CIE Lab), resolved here because a
  // canvas cannot draw var(). The fallback is the light set. Order follows the
  // timeline file, so an event keeps its color on every chart; more events than
  // tokens wraps round, which the legend check in
  // scripts/audit/chart-axes-audit.mjs flags.
  var EVENT_COLORS = ['#1d4ed8', '#9a3412', '#0f766e', '#e11d48', '#7c3aed', '#4d7c0f',
    '#075985', '#a21caf', '#a16207', '#166534', '#db2777', '#57534e'];
  function eventColors() {
    var css = root.getComputedStyle ? root.getComputedStyle(root.document.documentElement) : null;
    return EVENT_COLORS.map(function (fallback, i) {
      var token = css && css.getPropertyValue('--event-' + (i + 1)).trim();
      return token || fallback;
    });
  }
  function chartEvents(data) {
    var colors = eventColors();
    return data.events.map(function (event, i) {
      var color = colors[i % colors.length];
      var month = new Date(event.date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return {
        id: event.id, date: event.date, year: event.date.slice(0, 4), label: event.title, short: event.title,
        match: new RegExp('^' + month + '\\s*' + event.date.slice(2, 4) + '$', 'i'),
        lineColor: color, pillBg: color,
        desc: event.date + ' · ' + status(event) + ' — ' + event.detail
      };
    });
  }
  function annotations(data, labels) {
    var result = {};
    chartEvents(data).forEach(function (event) {
      var match = labels.map(String).find(function (label) {
        return label === event.year || label.slice(0, 7) === event.date.slice(0, 7) || event.match.test(label);
      });
      if (match == null) return;
      result[event.id] = {
        type: 'line', xMin: match, xMax: match,
        borderColor: event.lineColor, borderWidth: 2, borderDash: [6, 4],
        label: { display: false },
        // The accessible list provides the complete description and official link.
      };
    });
    return result;
  }
  function render(container, data) {
    container.replaceChildren();
    data.events.forEach(function (event) {
      var item = document.createElement('li');
      item.dataset.policyEventId = event.id;
      item.dataset.policyStatus = status(event);
      var link = document.createElement('a');
      link.href = event.source_url;
      link.textContent = event.title;
      var detail = document.createElement('p');
      detail.dataset.policyDetail = event.id;
      detail.textContent = event.detail;
      var verification = document.createElement('small');
      verification.textContent = event.verified ? 'Source checked ' + event.verified : 'Not independently verified — ' + event.note;
      item.append(event.date + ' · ' + status(event) + ' · ', link, detail, verification);
      if (event.legislation_ids) {
        var ref = document.createElement('a');
        ref.href = data.meta.legislation_file;
        ref.textContent = 'Tax-credit legislation record';
        item.append(' · ', ref);
      }
      container.appendChild(item);
    });
  }
  function mount() {
    document.querySelectorAll('[data-policy-timeline]').forEach(function (container) {
      load().then(function (data) { render(container, data); }).catch(function () {
        container.textContent = 'Policy timeline unavailable — source file could not be loaded.';
      });
    });
  }
  root.PolicyTimeline = { EVENT_COLORS: EVENT_COLORS, load: load, render: render, status: status, chartEvents: chartEvents, annotations: annotations };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
