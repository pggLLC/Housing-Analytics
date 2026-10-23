/**
 * js/land-banking-awards.js
 * Renders land-banking-awards.html from data/policy/prop123-land-banking-awards.json
 * (built by scripts/funding/build_land_banking_awards.py from CHFA's award lists).
 *
 * Every number on the page is computed here from the awards in that file, so the
 * headline, the table and the CSV cannot disagree with each other or with the file.
 * The map is js/land-banking-map.js (shared with the gated Where to build page); its
 * search box (#lbmSearch) and filters also filter this table (it listens for the map's
 * "lbm:change" event). The table sorts the whole filtered list, not only the rows on
 * screen, from its headers or, on a phone where the headers fold away, the "Sort by"
 * menu; its headers carry data-sort-key so the shared sorter leaves them to this file.
 * This page names no contact person:
 * named contacts stay in the gated contacts file, which this page never requests.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LandBankingAwards = api;
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var DATA = 'data/policy/prop123-land-banking-awards.json';
  var FIRST_ROWS = 10;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var PURPOSE_TEXT = { 'Rental': 'Rental', 'Homeownership': 'For-sale', 'Rental and Homeownership': 'Rental and for-sale' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : null; }
  function longDate(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function millions(n) { return '$' + (n / 1e6).toFixed(1) + ' million'; }
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function purposeText(p) { return PURPOSE_TEXT[p] || p || ''; }
  function holderLabel(a) { return a && a.status && a.status.holder ? a.status.holder.label : ''; }

  // Sort keys: the value each award sorts by, and the direction a first click gives.
  var STATUS_ORDER = ['financed', 'applied', 'partner', 'seeking', 'not_funded', 'none_found', 'none'];
  var PURPOSE_ORDER = ['Rental', 'Rental and Homeownership', 'Homeownership'];
  function townText(a) { return (a.places || []).map(function (p) { return p.name; }).join(', '); }
  var SORTS = {
    round: { first: 'desc', val: function (a, ctx) { return ctx.roundIndex[a.round] || 0; } },
    project: { first: 'asc', val: function (a) { return projectName(a).toLowerCase(); } },
    status: { first: 'asc', val: function (a) { var i = STATUS_ORDER.indexOf(a.status && a.status.status); return i < 0 ? STATUS_ORDER.length : i; } },
    grantee: { first: 'asc', val: function (a) { return sponsorName(a).toLowerCase(); } },
    holder: { first: 'asc', val: function (a) { return holderLabel(a) ? (a.status.holder.type === 'government' ? 0 : 1) : 2; } },
    town: { first: 'asc', val: function (a) { return townText(a).toLowerCase(); } },
    purpose: { first: 'asc', val: function (a) { var i = PURPOSE_ORDER.indexOf(a.purpose); return i < 0 ? 9 : i; } },
    amount: { first: 'desc', val: function (a) { return a.amount_awarded; } },
    units: { first: 'desc', val: function (a) { return a.estimated_units; } }
  };

  // Sorts a copy; ties keep newest round first, then project name, so the order is stable.
  function sortAwards(awards, data, key, dir) {
    var ctx = { roundIndex: {} };
    ((data.meta || {}).rounds || []).forEach(function (r, i) { ctx.roundIndex[r.id] = i; });
    var spec = SORTS[key] || SORTS.round;
    var sign = (dir || spec.first) === 'asc' ? 1 : -1;
    var cmp = function (x, y) { return x < y ? -1 : x > y ? 1 : 0; };
    return (awards || []).slice().sort(function (x, y) {
      return sign * cmp(spec.val(x, ctx), spec.val(y, ctx)) ||
        cmp(ctx.roundIndex[y.round] || 0, ctx.roundIndex[x.round] || 0) || cmp(projectName(x), projectName(y));
    });
  }

  // ------------------------------------------------------------ pure helpers

  function filterAwards(awards, opts) {
    var o = opts || {};
    var q = String(o.q || '').toLowerCase().trim();
    return (awards || []).filter(function (a) {
      if (o.round && o.round !== 'all' && a.round !== o.round) return false;
      if (o.purpose === 'rental' && !a.rental) return false;
      if (o.purpose === 'homeownership' && !a.homeownership) return false;
      if (q) {
        var hay = [a.project, a.sponsor, a.show_project, a.show_sponsor, a.location].concat((a.places || []).map(function (p) { return p.name + ' ' + (p.county || ''); }))
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function summarize(awards) {
    var towns = {};
    var s = { awards: 0, amount: 0, units: 0, towns: 0 };
    (awards || []).forEach(function (a) {
      s.awards += 1;
      s.amount += a.amount_awarded;
      s.units += a.estimated_units;
      (a.places || []).forEach(function (p) { towns[p.geoid] = true; });
    });
    s.towns = Object.keys(towns).length;
    return s;
  }

  // One pin per town, carrying every award that names it.
  function groupByTown(awards) {
    var by = {};
    (awards || []).forEach(function (a) {
      (a.places || []).forEach(function (p) {
        var g = by[p.geoid] || (by[p.geoid] = { geoid: p.geoid, name: p.name, county: p.county, lat: p.lat, lng: p.lng, awards: [] });
        g.awards.push(a);
      });
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return y.awards.length - x.awards.length || x.name.localeCompare(y.name); });
  }

  function projectName(a) { return a.show_project || a.project; }
  function sponsorName(a) { return a.show_sponsor || a.sponsor; }

  // What has happened to the site since the award, when a dated public source says.
  function sinceHtml(a) {
    var s = a && a.since;
    if (!s || !s.text) return '';
    var links = (s.sources || []).map(function (x) {
      var u = safeUrl(x.url);
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' : esc(x.title);
    }).join('; ');
    return '<p class="lb-since">Since the award: ' + esc(s.text) + (links ? ' <span class="lb-note">Sources: ' + links + '.</span>' : '') + '</p>';
  }

  // The status line is built by the map module, which the page loads first.
  function statusCell(a) {
    var map = global.LandBankingMap || (typeof globalThis !== 'undefined' ? globalThis.LandBankingMap : null);
    return map && map.statusHtml ? map.statusHtml(a, 'lb-status') : '';
  }

  function roundLabel(data, id) {
    var r = ((data.meta || {}).rounds || []).find(function (x) { return x.id === id; });
    return r ? r.label : id;
  }

  // ------------------------------------------------------------ renderers

  function leadHtml(data) {
    var m = data.meta;
    var rounds = m.rounds || [];
    var first = rounds.length ? longDate(rounds[0].pdf_date) : null;
    return 'Since ' + esc(first ? first.replace(/^[A-Za-z]+ \d+, /, '') : 'the first round') + ', Colorado has given <strong>' + millions(m.total_awarded) + ' in ' + int(m.award_count) +
      ' awards</strong> to buy land for about ' + int(m.total_estimated_units) + ' future affordable homes in ' + int(summarize(data.awards).towns) + ' towns. ' +
      'The money comes from Proposition 123, the housing fund Colorado voters approved.';
  }

  // The kind of grantee, under its name: from the printed name, a dated source, or the
  // program rule (CHFA lends only to nonprofits), and the line says which.
  function holderHtml(a) {
    var h = a && a.status && a.status.holder;
    if (!h) return '';
    var u = h.source && safeUrl(h.source.url);
    var how = h.how === 'source' && u ? ' <a href="' + esc(u) + '" target="_blank" rel="noopener">(source)</a>' : '';
    return '<span class="lb-holder">' + esc(h.label) + how + '</span>';
  }

  function rowHtml(a, data) {
    var url = safeUrl(a.source_url);
    var towns = (a.places || []).map(function (p) { return p.name; }).join(', ');
    var src = (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">CHFA award list (PDF)</a>' : 'CHFA award list') +
      '<details class="lb-quote"><summary>Row as printed</summary><blockquote>' + esc(a.source_quote) + '</blockquote>' +
      (a.note ? '<p class="lb-note">' + esc(a.note) + '</p>' : '') + '</details>';
    return '<tr>' +
      '<td class="lb-c-round">' + esc(roundLabel(data, a.round)) + '</td>' +
      '<td class="lb-c-project"><strong>' + esc(projectName(a)) + '</strong>' + sinceHtml(a) + '</td>' +
      '<td data-label="Status">' + statusCell(a) + '</td>' +
      '<td data-label="Received by">' + esc(sponsorName(a)) + holderHtml(a) + '</td>' +
      '<td data-label="Town">' + esc(towns) + '</td>' +
      '<td data-label="Homes planned">' + esc(purposeText(a.purpose)) + '</td>' +
      '<td class="n" data-label="Awarded">' + money(a.amount_awarded) + '</td>' +
      '<td class="n" data-label="Est. homes">' + int(a.estimated_units) + '</td>' +
      '<td data-label="Source">' + src + '</td></tr>';
  }

  function openRoundHtml(data) {
    var o = (data.meta || {}).open_round;
    if (!o) return '<p>No open round is recorded.</p>';
    var url = safeUrl(o.source_url);
    var email = (data.meta || {}).program_email;
    var today = (global.LandBankingAwardsToday || new Date().toISOString().slice(0, 10));
    if (o.review_by && today > o.review_by) {
      return '<p>The round recorded here was checked on ' + esc(longDate(o.checked)) + ' and its first window has closed. ' +
        (url ? 'See <a href="' + esc(url) + '" target="_blank" rel="noopener">CHFA\'s program page</a> for the current round.' : '') + '</p>' +
        (email ? '<p>To ask for an application, email <a href="mailto:' + esc(email) + '">' + esc(email) + '</a>.</p>' : '');
    }
    return (o.summary ? '<p>' + esc(o.summary) + '</p>' : '') +
      (email ? '<p>To ask for an application, email <a href="mailto:' + esc(email) + '">' + esc(email) + '</a>.</p>' : '') +
      '<p class="lb-note">CHFA\'s words: “' + esc(o.quote) + '” ' + (o.allocation_quote ? '“' + esc(o.allocation_quote) + '” ' : '') +
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">(program page, checked ' + esc(longDate(o.checked) || o.checked) + ')</a>' : '') + '</p>';
  }

  function programHtml(data) {
    var m = data.meta || {};
    return m.program_quote ? '<p>CHFA describes the program this way: “' + esc(m.program_quote) + '”</p>' : '';
  }

  function sourcesHtml(data) {
    var rounds = (data.meta || {}).rounds || [];
    return 'Award lists: ' + rounds.map(function (r) {
      var u = safeUrl(r.source_url);
      var t = esc(r.title) + (r.pdf_date ? ', dated ' + esc(longDate(r.pdf_date)) : '');
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>' : t;
    }).join('; ') + '. Each list\'s rows add up to the total it prints.';
  }

  function countHtml(shown, all) {
    if (shown.awards === all.awards) return 'Showing all ' + int(all.awards) + ' awards in ' + int(shown.towns) + ' towns.';
    return 'Showing ' + int(shown.awards) + ' of ' + int(all.awards) + ' awards, in ' + int(shown.towns) + (shown.towns === 1 ? ' town' : ' towns') +
      ': ' + (shown.amount ? millions(shown.amount) : '$0') + ' for about ' + int(shown.units) + ' homes.';
  }

  // ------------------------------------------------------------ page

  function render(state) {
    var doc = global.document;
    var data = state.data;
    var map = global.LandBankingMap;
    var view = map && map.current ? map.current() : null;
    var q = view ? view.q : doc.getElementById('lbmSearch').value;
    var shown = view ? view.shown : filterAwards(data.awards, { q: q });
    var filtered = view && Object.keys(view.filters || {}).some(function (k) { return view.filters[k]; });
    // The full list is long on a phone: show the first few until the reader asks for all,
    // searches or filters.
    var ordered = sortAwards(shown, data, state.sort.key, state.sort.dir);
    var limit = state.showAll || String(q || '').trim() || filtered ? ordered.length : FIRST_ROWS;
    doc.querySelector('[data-lb-rows]').innerHTML = ordered.length
      ? ordered.slice(0, limit).map(function (a) { return rowHtml(a, data); }).join('')
      : '<tr><td colspan="9">No award matches that search and those filters. Try a town or county name, or set a filter back to all.</td></tr>';
    markSort(doc, state.sort);
    var more = doc.querySelector('[data-lb-more]');
    if (more) {
      more.hidden = ordered.length <= limit;
      more.textContent = 'Show all ' + int(ordered.length) + ' awards';
    }
    var csv = doc.querySelector('[data-lb-csv]');
    if (csv) csv.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvText(ordered, data));
  }

  // The rows the table shows (all of them, not just the first few), as a spreadsheet.
  function csvText(awards, data) {
    var cell = function (v) { var t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var head = ['round', 'project', 'status', 'grantee', 'grantee_kind', 'towns', 'counties', 'homes_planned', 'amount_awarded', 'estimated_homes', 'source_url'];
    return [head.join(',')].concat((awards || []).map(function (a) {
      return [roundLabel(data, a.round), projectName(a), (a.status && a.status.label) || '', sponsorName(a), holderLabel(a),
        (a.places || []).map(function (p) { return p.name; }).join('; '),
        (a.places || []).map(function (p) { return p.county; }).filter(Boolean).join('; '),
        purposeText(a.purpose), a.amount_awarded, a.estimated_units, a.source_url].map(cell).join(',');
    })).join('\n') + '\n';
  }

  // Headers show the sort with aria-sort; the "Sort by" menu shows it when it has that option.
  function markSort(doc, sort) {
    Array.prototype.forEach.call(doc.querySelectorAll('.lb-table th[data-sort-key]'), function (th) {
      var on = th.getAttribute('data-sort-key') === sort.key;
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    var sel = doc.querySelector('[data-lb-sort]');
    if (sel) {
      var v = sort.key + ':' + sort.dir;
      sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === v; }) ? v : '';
    }
  }

  function setSort(state, key, dir) {
    var spec = SORTS[key];
    if (!spec) return;
    if (!dir) dir = state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : spec.first;
    state.sort = { key: key, dir: dir };
    render(state);
  }

  function boot(data) {
    var doc = global.document;
    var state = { data: data, sort: { key: 'round', dir: 'desc' } };
    doc.querySelector('[data-lb-lead]').innerHTML = leadHtml(data);
    doc.querySelector('[data-lb-open]').innerHTML = openRoundHtml(data);
    doc.querySelector('[data-lb-program]').innerHTML = programHtml(data);
    doc.querySelector('[data-lb-sources]').innerHTML = sourcesHtml(data);
    // The map re-filters first, then tells the table; without the map, the box drives it.
    if (global.LandBankingMap && global.LandBankingMap.current) doc.addEventListener('lbm:change', function () { render(state); });
    else doc.getElementById('lbmSearch').addEventListener('input', function () { render(state); });
    Array.prototype.forEach.call(doc.querySelectorAll('.lb-table th[data-sort-key]'), function (th) {
      th.addEventListener('click', function () { setSort(state, th.getAttribute('data-sort-key')); });
      th.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === th) { e.preventDefault(); setSort(state, th.getAttribute('data-sort-key')); }
      });
    });
    var sortSel = doc.querySelector('[data-lb-sort]');
    if (sortSel) sortSel.addEventListener('change', function () {
      var p = sortSel.value.split(':');
      if (p[0]) setSort(state, p[0], p[1]);
    });
    var more = doc.querySelector('[data-lb-more]');
    if (more) more.addEventListener('click', function () { state.showAll = true; render(state); });
    render(state);
    return state;
  }

  function start() {
    var doc = global.document;
    if (!doc || !doc.querySelector('[data-land-banking]')) return;
    // Share the map's request so the headline, table and download match its pins.
    var map = global.LandBankingMap;
    var load = map && map.loadAwards ? map.loadAwards()
      : global.fetch(DATA).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    Promise.resolve(load).then(boot).catch(function (e) {
      doc.querySelector('[data-lb-lead]').textContent = 'The award list could not be loaded (' + (e && e.message) + '). Try reloading the page.';
    });
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return { filterAwards: filterAwards, summarize: summarize, groupByTown: groupByTown, leadHtml: leadHtml,
    countHtml: countHtml, rowHtml: rowHtml, sortAwards: sortAwards, holderHtml: holderHtml, csvText: csvText, openRoundHtml: openRoundHtml, boot: boot, DATA: DATA };
}));
