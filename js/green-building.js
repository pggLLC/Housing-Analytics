/**
 * js/green-building.js
 * Renders the sourced parts of green-building-guide.html from
 * data/policy/green-building.json: CHFA's requirements, why efficiency pays,
 * how it moves a deal, the federal credits and the Colorado programs. Every
 * figure on those cards comes from the file, each record shows its source and
 * the words it is quoted from, and a record past its re-check date says so.
 * The short answer and the "which program for which deal" table are static
 * HTML in the page; each table row names the records it relies on in
 * data-gb-ref, and render() turns those into links to the records' cards.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GreenBuilding = api;
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var DATA = 'data/policy/green-building.json';
  var SECTIONS = ['requirements', 'benefits', 'deal', 'credits', 'programs'];
  var STATUS_PILL = { open: 'pill good', verify: 'pill', closed: 'pill warn', ended: 'pill warn', 'at-risk': 'pill warn', watch: 'pill' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function longDate(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }

  function safeUrl(url) {
    return /^https:\/\//.test(String(url || '')) ? String(url) : null;
  }

  function link(url, text) {
    var u = safeUrl(url);
    return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text);
  }

  function reviewHtml(r) {
    return global.ReviewStatus ? global.ReviewStatus.html(r) : '';
  }

  function sourceLine(r, doc) {
    var bits = [link(r.source_url, r.source_title || 'Source')];
    if (r.qap_section) bits.push(esc(r.qap_section));
    if (r.publisher) bits.push(esc(r.publisher));
    if (r.published) bits.push('published ' + esc(longDate(r.published) || r.published));
    if (r.also_in_draft) {
      var d = doc && doc.meta && doc.meta.qap_documents && doc.meta.qap_documents.draft;
      if (d) bits.push('same in the ' + link(d.url, 'Third Draft'));
    }
    if (r.also_see) bits.push('see also ' + link(r.also_see.url, r.also_see.title));
    var checked = longDate(r.last_verified);
    return '<p class="gb-source">' + bits.join(' · ') + (checked ? ' · checked ' + esc(checked) : '') + '</p>';
  }

  function quotesHtml(r) {
    var q = Array.isArray(r.quotes) ? r.quotes : [];
    if (!q.length) return '';
    return '<details class="gb-quote"><summary>What the source says</summary>' +
      q.map(function (t) { return '<blockquote>' + esc(t) + '</blockquote>'; }).join('') + '</details>';
  }

  // Colorado programs set date-only deadlines on Colorado's calendar, so the
  // day is read in Mountain Time wherever the reader is.
  var DENVER_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  function isoDay(d) {
    return DENVER_DAY.format(d);
  }

  // `now` is a Date or a YYYY-MM-DD string (tests). A date-only string stands
  // for noon that day in Colorado.
  function asDate(now) {
    if (Object.prototype.toString.call(now) === '[object Date]') return now;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(now || ''))) return new Date(now + 'T12:00:00-07:00');
    return new Date();
  }

  // An open record with dates is "no open round" before it opens, open through
  // its deadline and closed after it, so the page does not depend on someone
  // flipping the status in time. opens_at / deadline_at carry the source's own
  // time and zone (the IRS portal opens and closes on Eastern time); without
  // them a date counts through the end of that day in Colorado.
  var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  function effectiveStatus(r, now) {
    if (r.status !== 'open') return r.status;
    var t = asDate(now);
    var day = isoDay(t);
    if (r.opens_at ? t < new Date(r.opens_at) : (ISO_DAY.test(String(r.opens || '')) && day < r.opens)) return 'watch';
    if (r.deadline_at ? t > new Date(r.deadline_at) : (ISO_DAY.test(String(r.deadline || '')) && day > r.deadline)) return 'closed';
    return r.status;
  }

  function statusPill(r, doc, today) {
    if (!r.status) return '';
    var status = effectiveStatus(r, today);
    var text = (doc.status_text && doc.status_text[status]) || status;
    if (status === 'open' && r.deadline && longDate(r.deadline)) text += ' until ' + longDate(r.deadline);
    if (status === 'watch' && r.opens && longDate(r.opens)) text += '; next opens ' + longDate(r.opens);
    return '<span class="' + (STATUS_PILL[status] || 'pill') + '" data-gb-status="' + esc(status) + '">' + esc(text) + '</span>';
  }

  function anchorId(id) {
    return 'gb-r-' + String(id);
  }

  function entries(doc, section) {
    return (doc && Array.isArray(doc.entries) ? doc.entries : []).filter(function (e) { return e.section === section; });
  }

  function cardsHtml(doc, section, today) {
    var list = entries(doc, section);
    if (!list.length) return '<p class="gb-muted">No records are loaded for this section.</p>';
    return '<div class="gb-cards">' + list.map(function (r) {
      return '<article class="gb-card" id="' + esc(anchorId(r.id)) + '" data-gb-entry="' + esc(r.id) + '">' +
        '<h3>' + esc(r.title) + (r.status ? ' ' + statusPill(r, doc, today) : '') + '</h3>' +
        '<p>' + esc(r.finding) + '</p>' +
        (r.caveat ? '<p class="gb-muted"><strong>Keep in mind:</strong> ' + esc(r.caveat) + '</p>' : '') +
        quotesHtml(r) + sourceLine(r, doc) + reviewHtml(r) +
        '</article>';
    }).join('') + '</div>';
  }

  function tableHtml(doc, section, firstHead, today) {
    var list = entries(doc, section);
    if (!list.length) return '<p class="gb-muted">No records are loaded for this section.</p>';
    var hasFits = list.some(function (r) { return r.fits; });
    return '<div class="gb-table-wrap gb-stack"><table class="data-table"><thead><tr>' +
      '<th scope="col">' + esc(firstHead) + '</th><th scope="col">Status</th><th scope="col">What it does</th>' +
      (hasFits ? '<th scope="col">Fits</th>' : '') + '<th scope="col">Source</th>' +
      '</tr></thead><tbody>' + list.map(function (r) {
        return '<tr id="' + esc(anchorId(r.id)) + '" data-gb-entry="' + esc(r.id) + '"><th scope="row">' + esc(r.title) + '</th>' +
          '<td data-label="Status">' + statusPill(r, doc, today) + '</td>' +
          '<td data-label="What it does">' + esc(r.finding) +
            (r.caveat ? '<br><span class="gb-muted">' + esc(r.caveat) + '</span>' : '') + quotesHtml(r) + '</td>' +
          (hasFits ? '<td data-label="Fits">' + esc(r.fits || '') + '</td>' : '') +
          '<td data-label="Source">' + sourceLine(r, doc) + reviewHtml(r) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // "Relies on" links under each row of the which-program table.
  function linkPickRows(rootEl, doc) {
    var byId = {};
    (doc && Array.isArray(doc.entries) ? doc.entries : []).forEach(function (e) { byId[e.id] = e; });
    Array.prototype.forEach.call(rootEl.querySelectorAll('#gb-pick tbody tr[data-gb-ref]'), function (row) {
      var cell = row.querySelector('td:last-child');
      if (!cell) return;
      var old = cell.querySelector('.gb-refs');
      if (old) old.parentNode.removeChild(old);
      var links = row.getAttribute('data-gb-ref').split(/\s+/).filter(function (id) { return byId[id]; })
        .map(function (id) { return '<a href="#' + esc(anchorId(id)) + '">' + esc(byId[id].title) + '</a>'; });
      if (!links.length) return;
      cell.insertAdjacentHTML('beforeend', '<p class="gb-muted gb-refs">Relies on: ' + links.join('; ') + '</p>');
    });
  }

  function fill(rootEl, selector, html) {
    var el = rootEl.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  // `today` (YYYY-MM-DD) is for tests; the page uses the reader's date.
  function render(rootEl, doc, today) {
    fill(rootEl, '[data-gb-section="requirements"]', cardsHtml(doc, 'requirements', today));
    fill(rootEl, '[data-gb-section="benefits"]', cardsHtml(doc, 'benefits', today));
    fill(rootEl, '[data-gb-section="deal"]', cardsHtml(doc, 'deal', today));
    fill(rootEl, '[data-gb-section="credits"]', tableHtml(doc, 'credits', 'Credit', today));
    fill(rootEl, '[data-gb-section="programs"]', tableHtml(doc, 'programs', 'Program', today));
    linkPickRows(rootEl, doc);
    var checked = longDate(doc.meta && doc.meta.last_verified);
    fill(rootEl, '[data-gb-checked]', checked ? 'Oldest source check: ' + esc(checked) : '');
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      return response.json();
    });
  }

  function init() {
    var rootEl = global.document && global.document.querySelector('[data-green-building]');
    if (!rootEl) return;
    fetchJson(DATA).then(function (doc) { render(rootEl, doc); }).catch(function (err) {
      SECTIONS.forEach(function (s) {
        fill(rootEl, '[data-gb-section="' + s + '"]', '<p class="gb-muted">This section could not load its data (' + esc(err && err.message) + ').</p>');
      });
    });
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render: render, cardsHtml: cardsHtml, tableHtml: tableHtml, anchorId: anchorId, effectiveStatus: effectiveStatus, SECTIONS: SECTIONS };
}));
