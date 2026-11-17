/*
 * The tariffs brief's conclusions on a construction cost page.
 * Fills every [data-tariff-cost-note] element from data/policy/tariffs-cost-note.json,
 * which scripts/policy/build_tariffs_brief.mjs builds from the same data as the brief,
 * so the page and the brief cannot disagree. Shows nothing if the file does not load.
 */
(function (global) {
  'use strict';
  var FILE = 'data/policy/tariffs-cost-note.json';

  function el(doc, tag, text, parent, cls) {
    var n = doc.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  /** Draws the note into host. Returns false when the file is not usable. */
  function render(host, note) {
    if (!host || !note || !Array.isArray(note.lines) || !note.lines.length || !note.brief) return false;
    var doc = host.ownerDocument;
    host.textContent = '';
    el(doc, 'h2', note.title, host, 'chart-title');
    var ul = el(doc, 'ul', null, host);
    ul.style.cssText = 'list-style:disc;padding-left:1.2rem;margin:0 0 .75rem';
    note.lines.forEach(function (line) { el(doc, 'li', line, ul).style.margin = '.3rem 0'; });
    var more = el(doc, 'p', null, host);
    var a = el(doc, 'a', 'Read the research brief: ' + note.brief.title, more);
    a.href = note.brief.href;
    var src = el(doc, 'p', 'Source: ', host, 'tariff-cost-note__source');
    var s = el(doc, 'a', note.source.text, src);
    s.href = note.source.url;
    s.rel = 'noopener';
    if (note.note) src.appendChild(doc.createTextNode(' ' + note.note));
    host.hidden = false;
    return true;
  }

  function init(doc) {
    var hosts = doc.querySelectorAll('[data-tariff-cost-note]');
    if (!hosts.length || typeof global.fetch !== 'function') return Promise.resolve(0);
    return global.fetch(FILE)
      .then(function (r) { if (!r.ok) throw new Error(FILE + ' ' + r.status); return r.json(); })
      .then(function (note) {
        var n = 0;
        Array.prototype.forEach.call(hosts, function (h) { if (render(h, note)) n++; });
        return n;
      })
      .catch(function () { return 0; });
  }

  var api = { FILE: FILE, render: render, init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TariffCostNote = api;
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', function () { init(global.document); });
    else init(global.document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
