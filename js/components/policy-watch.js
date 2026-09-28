/**
 * js/components/policy-watch.js
 * Policy watch (data/policy/policy-watch.json), in two sizes.
 *
 * The file is curated by hand: CHFA allocation-plan changes, ballot questions
 * and people in housing roles, each saying how it was checked. Until
 * 2026-09-28 Housing News printed every entry in full in its right-hand
 * column: 19 entries of 56–103 words, each with its verification sentence,
 * 5,448px of a 6,804px column beside about 3,050px of news. On a phone it
 * sat between "Latest" and "Earlier", so the rest of the headlines began
 * 7,395px down. Thirteen of the entries (the people) were already listed in
 * full on colorado-elections.html.
 *
 * So each entry now has one full home and the news rail only points to it:
 *   - summary(): one row per section with its count and newest check date,
 *     plus one row for the topics not yet covered, linked to the full view.
 *     Used by policy-briefs.html.
 *   - full(): every current entry with its detail, source and how it was
 *     checked, and every declared gap. Used by housing-legislation-2026.html
 *     for the sections that live there.
 * DESTINATIONS says where each section's full view is. Which entries count as
 * current follows colorado-elections.js (archived, or an election more than
 * 45 days past, is not current), and test/policy-watch-rail.test.mjs fails if
 * a summary row's count differs from what its destination renders.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PolicyWatch = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAY = 864e5;

  // Section order is display order. `noun` counts entries in a summary row.
  var SECTIONS = [
    { key: 'qap', label: 'CHFA allocation plan', noun: ['change', 'changes'] },
    { key: 'ballot', label: 'On the ballot', noun: ['measure', 'measures'] },
    { key: 'people', label: 'Housing officials', noun: ['role', 'roles'] }
  ];

  // Where each section is shown in full. The legislation page renders the
  // sections listed here as its own; people are rendered by the elections page.
  var DESTINATIONS = {
    qap: { href: 'housing-legislation-2026.html#policy-watch', page: 'Policy & Legislation' },
    ballot: { href: 'housing-legislation-2026.html#policy-watch', page: 'Policy & Legislation' },
    people: { href: 'colorado-elections.html#people-and-roles', page: 'Colorado Elections' },
    gaps: { href: 'housing-legislation-2026.html#policy-watch-gaps', page: 'Policy & Legislation' }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function longDate(iso) {
    var t = Date.parse(String(iso || '') + 'T12:00:00Z');
    return isNaN(t) ? '' : MONTHS[new Date(t).getUTCMonth()] + ' ' + new Date(t).getUTCDate() + ', ' + new Date(t).getUTCFullYear();
  }

  function shortDate(iso) {
    var t = Date.parse(String(iso || '') + 'T12:00:00Z');
    return isNaN(t) ? '' : MONTHS[new Date(t).getUTCMonth()].slice(0, 3) + ' ' + new Date(t).getUTCDate();
  }

  function checkLine(v) {
    if (!v || !v.level) return 'Not yet checked';
    var when = longDate(v.checked);
    if (v.level === 'primary') return 'Checked against ' + (v.against || 'the primary source') + (when ? ' on ' + when : '');
    if (v.level === 'reported') return 'As reported by ' + (v.by || 'the linked outlet') + (when ? '; link checked ' + when : '') + '. Not checked against a primary document.';
    return 'Not yet checked';
  }

  // Mirrors expired() in js/colorado-elections.js, which renders the people.
  function isCurrent(entry, todayIso) {
    if (!entry || entry.archived === true) return false;
    var electionDate = entry.election_date || (entry.election && entry.election.date);
    var time = Date.parse((electionDate || '') + 'T00:00:00Z');
    var today = Date.parse((todayIso || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    return !(Number.isFinite(time) && today - time >= 45 * DAY);
  }

  function entriesOf(doc) {
    return doc && Array.isArray(doc.entries) ? doc.entries : [];
  }

  function gapsOf(doc) {
    return doc && doc.meta && Array.isArray(doc.meta.known_gaps) ? doc.meta.known_gaps : [];
  }

  function bySection(doc, key, todayIso) {
    return entriesOf(doc).filter(function (e) { return e.section === key && isCurrent(e, todayIso); })
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }

  function newestCheck(items) {
    return items.map(function (e) { return (e.verification && e.verification.checked) || ''; })
      .sort().pop() || '';
  }

  // One row per section and one for the gaps. Each row is
  // { key, title, meta, href, count }; count is what the row claims.
  function summaryRows(doc, todayIso) {
    var rows = [];
    SECTIONS.forEach(function (sec) {
      var items = bySection(doc, sec.key, todayIso);
      if (!items.length) return;
      var checked = shortDate(newestCheck(items));
      var status = items[0].status || '';
      rows.push({
        key: sec.key,
        count: items.length,
        title: items.length === 1
          ? items[0].title
          : sec.label + ': ' + items.length + ' ' + sec.noun[1],
        meta: [status, checked ? 'checked ' + checked : ''].filter(Boolean).join(' · '),
        href: DESTINATIONS[sec.key].href,
        page: DESTINATIONS[sec.key].page
      });
    });
    var gaps = gapsOf(doc);
    if (gaps.length) {
      rows.push({
        key: 'gaps',
        count: gaps.length,
        title: gaps.length + (gaps.length === 1 ? ' topic' : ' topics') + ' not yet covered',
        meta: 'listed so nothing is assumed',
        href: DESTINATIONS.gaps.href,
        page: DESTINATIONS.gaps.page
      });
    }
    return rows;
  }

  function summaryHtml(doc, todayIso) {
    return summaryRows(doc, todayIso).map(function (row) {
      return '<li class="watch-row" data-watch-row="' + esc(row.key) + '" data-count="' + row.count + '">' +
        '<a href="' + esc(row.href) + '">' + esc(row.title) + '</a>' +
        '<span class="watch-row__meta">' + esc(row.meta) + (row.meta ? ' · ' : '') + esc(row.page) + '</span></li>';
    }).join('');
  }

  // Every current entry of the given sections, in full, and the gaps.
  function fullHtml(doc, keys, todayIso) {
    var html = '';
    SECTIONS.forEach(function (sec) {
      if (keys.indexOf(sec.key) === -1) return;
      var items = bySection(doc, sec.key, todayIso);
      if (!items.length) return;
      html += '<div class="watch-group" data-watch-section="' + esc(sec.key) + '"><h3>' + esc(sec.label) + '</h3><ul class="watch-list">' +
        items.map(function (e) {
          var url = e.source && e.source.url;
          var title = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(e.title) + '</a>' : esc(e.title);
          var meta = [];
          if (e.status) meta.push('<span class="watch-item__status">' + esc(e.status) + '</span>');
          if (e.date) meta.push(esc(longDate(e.date)));
          if (e.source && e.source.label) meta.push(esc(e.source.label));
          return '<li class="watch-item" data-watch-id="' + esc(e.id) + '"><div class="watch-item__title">' + title + '</div>' +
            (e.detail ? '<p>' + esc(e.detail) + '</p>' : '') +
            '<div class="watch-item__meta">' + meta.join(' · ') +
            '<span class="watch-item__check">' + esc(checkLine(e.verification)) + '</span></div></li>';
        }).join('') + '</ul></div>';
    });
    return html;
  }

  function gapsHtml(doc) {
    var gaps = gapsOf(doc);
    if (!gaps.length) return '';
    return '<ul class="watch-gaps">' + gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
  }

  return {
    SECTIONS: SECTIONS,
    DESTINATIONS: DESTINATIONS,
    longDate: longDate,
    checkLine: checkLine,
    isCurrent: isCurrent,
    summaryRows: summaryRows,
    summaryHtml: summaryHtml,
    fullHtml: fullHtml,
    gapsHtml: gapsHtml
  };
}));
