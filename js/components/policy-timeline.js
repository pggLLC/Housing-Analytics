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
  function chartEvents(data) {
    return data.events.map(function (event) {
      var month = new Date(event.date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return {
        id: event.id, date: event.date, year: event.date.slice(0, 4), label: event.title, short: event.title,
        match: new RegExp('^' + month + '\\s*' + event.date.slice(2, 4) + '$', 'i'),
        lineColor: 'rgba(99,102,241,0.8)', pillBg: '#4f46e5',
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
  root.PolicyTimeline = { load: load, render: render, status: status, chartEvents: chartEvents, annotations: annotations };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
