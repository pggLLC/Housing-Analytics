/**
 * round-watch.js — the gated "Next round watch" page: deals likely to apply in
 * CHFA's next housing tax credit rounds, why each is on the list, and who to
 * call first.
 *
 * Joins two files the gated site serves:
 *   data/jurisdiction-briefs/_round-watch.json           scores, reasons, sources
 *       (scripts/funding/build_round_watch.py; no contacts)
 *   data/jurisdiction-briefs/_round-watch-contacts.json  contacts, from the
 *       private backend only (coho-backend gated/). Never in this repository.
 *
 * A contact shows only with a public https source. Everything shown is
 * escaped. The map puts each deal at its town's Census centroid, coloured by
 * likelihood, and follows the same round, region and likelihood filters as
 * the list.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.RoundWatch in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoundWatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DATA_URL = 'data/jurisdiction-briefs/_round-watch.json';
  var CONTACTS_URL = 'data/jurisdiction-briefs/_round-watch-contacts.json';
  var BAND_RANK = { High: 0, Medium: 1, Watch: 2 };
  // the six site regions, west to east, as scripts/hna/build_ranking_index.py groups counties
  var REGIONS = ['Southwest', 'San Luis Valley', 'Western Slope', 'Mountains', 'Front Range', 'Eastern Plains'];
  var LEVELS = { high: 'High only', hm: 'High and Medium', all: 'All, with Watch' };
  var KIND_LABEL = {
    chfa_applicant: 'Named by CHFA on its applicant report',
    land_banking: 'Named for the Prop 123 land banking award',
    org_office: 'Organisation main office'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(u) {
    return /^https:\/\//i.test(String(u || '')) ? String(u) : null;
  }

  function pct(a, b) {
    return b ? Math.round((100 * a) / b) + '%' : '—';
  }

  /** Contacts for one project, best first: CHFA's named applicant contact,
   *  then the land banking contact, then the organisation's main office.
   *  Each needs a public https source. */
  function contactsFor(contacts, id) {
    var list = (contacts && contacts.contacts && contacts.contacts[id]) || [];
    var order = { chfa_applicant: 0, land_banking: 1, org_office: 2 };
    return list.filter(function (c) { return safeUrl(c.source_url); })
      .slice().sort(function (a, b) { return (order[a.kind] == null ? 9 : order[a.kind]) - (order[b.kind] == null ? 9 : order[b.kind]); });
  }

  var SORTS = {
    band: function (i) { return BAND_RANK[i.band] * 1000 - i.score; },
    name: function (i) { return String(i.name).toLowerCase(); },
    town: function (i) { return String(i.city || '~').toLowerCase(); },
    region: function (i) { return (i.region ? REGIONS.indexOf(i.region) : 99) * 10000 + BAND_RANK[i.band] * 1000 - i.score; },
    homes: function (i) { return i.homes == null ? Infinity : i.homes; },
    sponsor: function (i) { return String(i.sponsor || (i.award_orgs || [])[0] || '~').toLowerCase(); },
    contact: function (i) { return i._contact ? 0 : 1; }
  };

  /** The deals a round shows under the current filters: likelihood (High
   *  only, High and Medium, or all with Watch) and region. */
  function visibleItems(round, state) {
    var level = state.level || (state.showWatch ? 'all' : 'hm');
    return round.items.filter(function (i) {
      if (level === 'high' && i.band !== 'High') return false;
      if (level === 'hm' && i.band === 'Watch') return false;
      return !state.region || state.region === 'all' || i.region === state.region;
    });
  }

  function sortItems(items, key, dir) {
    var f = SORTS[key] || SORTS.band;
    var d = dir === 'desc' ? -1 : 1;
    return items.slice().sort(function (a, b) {
      var x = f(a), y = f(b);
      if (x < y) return -d;
      if (x > y) return d;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function org(i) {
    if (i.sponsor) return esc(i.sponsor);
    if (i.award_orgs && i.award_orgs.length) return esc(i.award_orgs.join('; ')) + ' <span class="rw-muted">(as the award prints it)</span>';
    return '<span class="rw-muted">not printed</span>';
  }

  function sourceLinks(w) {
    var list = w.sources || (w.source_url ? [{ url: w.source_url, quote: w.quote }] : []);
    return list.map(function (s, n) {
      var u = safeUrl(s.url);
      if (!u) return '';
      return '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(s.quote || '') + '">Source' + (list.length > 1 ? ' ' + (n + 1) : '') + '</a>' +
        (s.quote ? '<blockquote class="rw-quote">' + esc(s.quote) + '</blockquote>' : '');
    }).join(' ');
  }

  function contactHtml(c) {
    var lines = [];
    var who = [c.name, c.role].filter(Boolean).map(esc).join(', ');
    lines.push('<strong>' + esc(c.org || '') + '</strong>' + (who ? ' · ' + who : ''));
    var reach = [];
    if (c.phone) reach.push('<a href="tel:' + esc(String(c.phone).replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a>');
    if (c.email) reach.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>');
    if (safeUrl(c.url)) reach.push('<a href="' + esc(c.url) + '" target="_blank" rel="noopener">Website</a>');
    if (reach.length) lines.push(reach.join(' · '));
    lines.push('<span class="rw-muted">' + esc(KIND_LABEL[c.kind] || c.kind || '') + '. ' + esc(c.source_label || '') +
      (c.as_of ? ', ' + esc(c.as_of) : '') + '. <a href="' + esc(safeUrl(c.source_url)) + '" target="_blank" rel="noopener">Source</a>. To confirm before outreach.</span>');
    return '<li>' + lines.join('<br>') + '</li>';
  }

  function detailHtml(i, contacts) {
    var why = i.why.map(function (w) {
      return '<li>' + esc(w.text) + (w.outcome_detail ? ' <span class="rw-muted">' + esc(w.outcome_detail) + '</span>' : '') +
        ' ' + sourceLinks(w) + '</li>';
    }).join('');
    var cs = contactsFor(contacts, i.id);
    var contactBlock;
    if (contacts == null) {
      contactBlock = '<p class="rw-muted">Contacts are kept only on the private developer site and did not load here.</p>';
    } else if (!cs.length) {
      contactBlock = '<p class="rw-muted">No public contact found yet.</p>';
    } else {
      contactBlock = '<ol class="rw-contacts">' + cs.map(contactHtml).join('') + '</ol>';
    }
    var apps = (i.applications || []).map(function (a) {
      var u = safeUrl(a.source_url);
      return '<li>' + esc(a.round_label) + ' (' + esc(a.credit_type) + '): ' + esc(String(a.outcome).replace(/_/g, ' ')) +
        (u ? ' · <a href="' + esc(u) + '" target="_blank" rel="noopener">applicant report</a>' : '') + '</li>';
    }).join('');
    var summary = i.deal_summary && /^[a-z0-9-]+$/.test(i.deal_summary)
      ? '<p><a href="deal-summary.html?d=' + esc(i.deal_summary) + '">Deal summary for this development</a></p>' : '';
    return '<div class="rw-detail"><h3>Why it is here</h3><ul class="rw-why">' + why + '</ul>' + summary +
      '<h3>First contact</h3>' + contactBlock +
      (apps ? '<h3>CHFA applications on file</h3><ul class="rw-apps">' + apps + '</ul>' : '') + '</div>';
  }

  /** The first contact, short, for the list: who, then a phone or email. */
  function firstContactCell(i, contacts) {
    if (contacts == null) return '<span class="rw-muted">Developer site only</span>';
    var c = contactsFor(contacts, i.id)[0];
    if (!c) return '<span class="rw-muted">None found yet</span>';
    var who = c.name ? esc(c.name) + (c.role ? ', ' + esc(c.role) : '') + '<br><span class="rw-muted">' + esc(c.org || '') + '</span>'
      : esc(c.org || '') + ' <span class="rw-muted">(main office)</span>';
    var reach = c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a>'
      : c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>'
        : safeUrl(c.url) ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">Website</a>' : '';
    return who + (reach ? '<br>' + reach : '');
  }

  function headline(i) {
    var first = i.why[0] ? i.why[0].text : '';
    var cut = first.indexOf('.') > 0 ? first.slice(0, first.indexOf('.') + 1) : first;
    return esc(cut) + (i.why.length > 1 ? ' <span class="rw-muted">+' + (i.why.length - 1) + ' more</span>' : '');
  }

  function rowsHtml(items, contacts, open) {
    return items.map(function (i) {
      var isOpen = !!(open && open[i.id]);
      var rid = 'rw-d-' + esc(i.id);
      return '<tr class="rw-row rw-' + esc(i.band.toLowerCase()) + '">' +
        '<td data-sort-value="' + esc(BAND_RANK[i.band]) + '"><span class="rw-band">' + esc(i.band) + '</span></td>' +
        '<td><button type="button" class="rw-toggle" aria-expanded="' + isOpen + '" aria-controls="' + rid + '" data-id="' + esc(i.id) + '">' +
          esc(i.name) + '</button><div class="rw-muted">' + esc(i.city || '') + (i.county ? ', ' + esc(i.county) : '') + '</div></td>' +
        '<td>' + (i.region ? esc(i.region) : '<span class="rw-muted">—</span>') + '</td>' +
        '<td class="rw-num">' + (i.homes == null ? '—' : esc(i.homes)) + '</td>' +
        '<td>' + org(i) + '</td>' +
        '<td class="rw-first">' + firstContactCell(i, contacts) + '</td>' +
        '<td>' + headline(i) + '</td></tr>' +
        '<tr class="rw-detail-row" id="' + rid + '"' + (isOpen ? '' : ' hidden') + '><td colspan="7">' + detailHtml(i, contacts) + '</td></tr>';
    }).join('');
  }

  var TIPS = {
    band: 'High: 50+ points, usually a deal CHFA turned down a year earlier in this round type. Medium: 25-49. Watch: 10-24.',
    name: 'Tap a project for every reason it is listed, the sources, and the first contact.',
    region: 'The site\'s six regions, built from the state\'s (DOLA) planning regions. Sorting by region keeps the likelihood order inside each.',
    homes: 'Total homes as the latest application or award prints them.',
    sponsor: 'Sponsor on the latest CHFA application; otherwise the organisation the state award names.',
    contact: 'The best public contact: the person CHFA printed on the application, else the land banking contact, else the main office. Tap the project for every contact and its source. Confirm before outreach.',
    why: 'The strongest reason first. Tap the project for the rest.'
  };

  function tableHtml(round, contacts, state) {
    var items = visibleItems(round, state).map(function (i) {
      return Object.assign({}, i, { _contact: contactsFor(contacts, i.id).length > 0 });
    });
    items = sortItems(items, state.sort, state.dir);
    if (!items.length) return '<p class="rw-muted">No deals match these filters.</p>';
    function th(key, label) {
      var cur = state.sort === key;
      return '<th scope="col" data-sort="' + key + '" data-tip="' + esc(TIPS[key]) + '" aria-sort="' +
        (cur ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '">' + label + '</th>';
    }
    return '<div class="rw-scroll"><table class="rw-table"><thead><tr>' +
      th('band', 'Likelihood') + th('name', 'Project') + th('region', 'Region') + th('homes', 'Homes') + th('sponsor', 'Sponsor') +
      th('contact', 'First contact') +
      '<th scope="col" data-tip="' + esc(TIPS.why) + '">Why</th></tr></thead><tbody>' +
      rowsHtml(items, contacts, state.open) + '</tbody></table></div>';
  }

  function statsHtml(data) {
    var r1 = data.rounds[0];
    var bt = data.backtest;
    var hi = bt.bands.High;
    var undecided = data.rounds.reduce(function (n, r) { return n + (r.undecided_last_round || 0); }, 0);
    return '<div class="rw-stats">' +
      '<div class="rw-stat"><div class="rw-stat-v">' + esc(r1.counts.High) + '</div><div>High-likelihood deals for ' + esc(r1.round) + ' (' + esc(r1.credit) + '), applications due in ' + esc(r1.applications_due) + '.</div></div>' +
      '<div class="rw-stat"><div class="rw-stat-v">' + esc(pct(hi.applied, hi.listed)) + '</div><div>of past High picks applied (' + esc(hi.applied) + ' of ' + esc(hi.listed) + ', ' + esc(bt.rounds.length) + ' rounds tested).</div></div>' +
      '<div class="rw-stat"><div class="rw-stat-v">' + esc(bt.caught) + ' of ' + esc(bt.applicants) + '</div><div>past applicants were on the list before their round; ' + esc(bt.below_list) + ' had a weaker sign and ' + esc(bt.no_sign_before) + ' showed no sign we score.</div></div>' +
      '<div class="rw-stat"><div class="rw-stat-v">' + esc(undecided) + '</div><div>applications still waiting on CHFA; any not funded join the next list.</div></div>' +
      '</div>';
  }

  function backtestHtml(bt) {
    var rows = bt.rounds.map(function (r) {
      function cell(b) { return esc(r.bands[b].applied) + ' of ' + esc(r.bands[b].listed); }
      return '<tr><td>' + esc(r.round) + ' (' + esc(r.credit) + ')</td><td class="rw-num">' + esc(r.applicants) + '</td><td class="rw-num">' + esc(r.caught) +
        '</td><td>' + cell('High') + '</td><td>' + cell('Medium') + '</td><td>' + cell('Watch') + '</td></tr>';
    }).join('');
    var names = {
      'lost_last_same_9%': 'Not funded a year earlier, 9% round', 'lost_last_same_4%': 'Not funded a year earlier, 4% round',
      lost_older_same: 'Not funded in an older round of the same type', lost_other: 'Not funded in the other round type',
      soft_fit: 'Recent state money, size suits the round', soft_misfit: 'Recent state money, size suits the other round',
      soft_size_unknown: 'Recent state money, size not yet printed',
      sponsor: 'Sponsor applied in 2+ of the last 4 rounds', land: 'Prop 123 land banking award'
    };
    var sig = Object.keys(bt.signals).map(function (k) {
      var s = bt.signals[k];
      return '<tr><td>' + esc(names[k] || k) + '</td><td class="rw-num">' + esc(s.with_signal) + '</td><td class="rw-num">' + esc(s.applied) +
        '</td><td class="rw-num">' + esc(pct(s.applied, s.with_signal)) + '</td></tr>';
    }).join('');
    return '<table class="rw-table"><thead><tr><th scope="col" data-tip="Each round scored as of the day its applicant report came out, using only what was public then.">Round tested</th>' +
      '<th scope="col" data-tip="Projects on CHFA\'s applicant report for that round.">Applicants</th>' +
      '<th scope="col" data-tip="Applicants that were on the list (any band) before the round.">On the list</th>' +
      '<th scope="col" data-tip="Applied, of those rated High.">High</th><th scope="col" data-tip="Applied, of those rated Medium.">Medium</th>' +
      '<th scope="col" data-tip="Applied, of those rated Watch.">Watch</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>How often each signal was followed by an application</h3>' +
      '<table class="rw-table"><thead><tr><th scope="col" data-tip="Public evidence before the round.">Signal</th>' +
      '<th scope="col" data-tip="Projects with this signal across the rounds tested.">Projects</th>' +
      '<th scope="col" data-tip="Of those, how many applied in the round.">Applied</th><th scope="col" data-tip="Applied as a share of projects.">Rate</th></tr></thead><tbody>' + sig + '</tbody></table>';
  }

  function rollingHtml(list) {
    if (!list.length) return '<p class="rw-muted">None on the rolling list now.</p>';
    return '<table class="rw-table"><thead><tr><th scope="col" data-tip="As CHFA prints it on the rolling federal 4% list.">Project</th>' +
      '<th scope="col" data-tip="Town as printed.">Town</th><th scope="col" data-tip="Total homes as printed.">Homes</th>' +
      '<th scope="col" data-tip="Sponsor as printed.">Sponsor</th><th scope="col" data-tip="Letter of intent or application, as of the list date.">Stage</th></tr></thead><tbody>' +
      list.map(function (r) {
        var u = safeUrl(r.source_url);
        return '<tr><td>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(r.quote) + '">' + esc(r.name) + '</a>' : esc(r.name)) +
          '</td><td>' + esc(r.city) + '</td><td class="rw-num">' + esc(r.homes == null ? '—' : r.homes) + '</td><td>' + esc(r.sponsor || '') +
          '</td><td>' + esc(r.outcome === 'letter_of_intent' ? 'Letter of intent' : 'Application') + (r.as_of ? ', ' + esc(r.as_of) : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---- Map: one pin per town, coloured by its strongest deal --------------

  var CO_BOUNDS = [[36.99, -109.06], [41.0, -102.04]];
  var MIN_HIT_RADIUS = 22;   // every pin answers a tap within 22px: a 44px target

  /** Deals grouped by town, strongest first; deals with no town printed are
   *  returned apart, so the page can name them. */
  function townsFor(items) {
    var by = {}, towns = [], unmapped = [];
    items.forEach(function (i) {
      if (typeof i.lat !== 'number' || typeof i.lng !== 'number') { unmapped.push(i); return; }
      var k = i.place_geoid || (i.lat + ',' + i.lng);
      if (!by[k]) { by[k] = { key: k, name: i.city || '', lat: i.lat, lng: i.lng, items: [] }; towns.push(by[k]); }
      by[k].items.push(i);
    });
    towns.forEach(function (t) {
      t.items.sort(function (a, b) { return BAND_RANK[a.band] - BAND_RANK[b.band] || b.score - a.score; });
      t.band = t.items[0].band;
    });
    return { towns: towns, unmapped: unmapped };
  }

  function pinRadius(t) { return 7 + 3 * Math.sqrt(t.items.length - 1); }

  function townsNear(towns, point, project) {
    return towns.map(function (t) {
      var p = project([t.lat, t.lng]);
      return { t: t, d: Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)) };
    }).filter(function (x) { return x.d <= Math.max(MIN_HIT_RADIUS, pinRadius(x.t)); })
      .sort(function (a, b) { return a.d - b.d; })
      .map(function (x) { return x.t; });
  }

  /** The panel under the map for the towns a tap reached: each deal is a
   *  button that opens it in the list. */
  function townPanelHtml(towns) {
    return towns.map(function (t) {
      return '<div class="rw-town"><h3>' + esc(t.name) + ' <span class="rw-muted">' + esc(t.items.length) +
        (t.items.length === 1 ? ' deal' : ' deals') + '</span></h3><ul>' +
        t.items.map(function (i) {
          return '<li class="rw-' + esc(i.band.toLowerCase()) + '"><span class="rw-band">' + esc(i.band) + '</span> ' +
            '<button type="button" class="rw-open" data-open="' + esc(i.id) + '">' + esc(i.name) + '</button>' +
            (i.homes == null ? '' : ' <span class="rw-muted">' + esc(i.homes) + ' homes</span>') + '</li>';
        }).join('') + '</ul></div>';
    }).join('');
  }

  function cssVar(doc, name, fallback) {
    try { return doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name).trim() || fallback; }
    catch (e) { return fallback; }
  }

  function initMap(doc, el) {
    var w = doc.defaultView;
    var L = w && w.L;
    if (!L || !el) return null;
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
    map.fitBounds(CO_BOUNDS, { padding: [8, 8] });
    var dark = doc.documentElement.getAttribute('data-theme') === 'dark';
    var base = w.COHOBasemaps ? (dark ? w.COHOBasemaps.dark() : w.COHOBasemaps.light()) : null;
    if (base) base.addTo(map);
    if (typeof w.ResizeObserver === 'function') {
      try { new w.ResizeObserver(function () { map.invalidateSize(); }).observe(el); } catch (e) { /* keeps its first size */ }
    }
    return { L: L, map: map, layer: L.layerGroup().addTo(map), towns: [] };
  }

  function drawPins(doc, m, towns) {
    if (!m) return;
    var colour = { High: cssVar(doc, '--accent', '#096e65'), Medium: cssVar(doc, '--accent2', '#b5651d'), Watch: cssVar(doc, '--muted', '#777777') };
    m.layer.clearLayers();
    // weaker pins first, so a High pin is drawn on top
    towns.slice().sort(function (a, b) { return BAND_RANK[b.band] - BAND_RANK[a.band]; }).forEach(function (t) {
      m.L.circleMarker([t.lat, t.lng], {
        radius: pinRadius(t), interactive: false,
        color: '#ffffff', weight: 1.5, fillColor: colour[t.band], fillOpacity: 0.9
      }).addTo(m.layer);
    });
    m.towns = towns;
  }

  function controlsHtml(data, state) {
    var r = data.rounds[state.round];
    var counts = {};
    r.items.forEach(function (i) { if (i.region) counts[i.region] = (counts[i.region] || 0) + 1; });
    return '<div class="rw-tabs" role="tablist">' + data.rounds.map(function (x, n) {
      return '<button type="button" role="tab" aria-selected="' + (n === state.round) + '" data-round="' + n + '">' + esc(x.round) + ' · ' + esc(x.credit) + '</button>';
    }).join('') + '</div>' +
      '<div class="rw-filters"><label>Region <select data-filter="region"><option value="all">All regions</option>' +
      REGIONS.filter(function (g) { return counts[g]; }).map(function (g) {
        return '<option value="' + esc(g) + '"' + (state.region === g ? ' selected' : '') + '>' + esc(g) + '</option>';
      }).join('') + '</select></label>' +
      '<label>Likelihood <select data-filter="level">' + Object.keys(LEVELS).map(function (k) {
        return '<option value="' + k + '"' + (state.level === k ? ' selected' : '') + '>' + esc(LEVELS[k]) + '</option>';
      }).join('') + '</select></label></div>';
  }

  function mount(doc, data, contacts) {
    var el = doc.getElementById('roundWatch');
    if (!el) return;
    var state = { round: 0, sort: 'band', dir: 'asc', level: 'hm', region: 'all', open: {} };
    doc.getElementById('rwStats').innerHTML = statsHtml(data);
    doc.getElementById('rwBacktest').innerHTML = backtestHtml(data.backtest);
    doc.getElementById('rwRolling').innerHTML = rollingHtml(data.rolling_4pct || []);
    doc.getElementById('rwMethod').textContent = data.meta.method;
    doc.getElementById('rwLimits').innerHTML = data.meta.limits.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    doc.getElementById('rwAsOf').textContent = data.meta.generated_at;
    var controls = doc.getElementById('rwControls');
    var panel = doc.getElementById('rwMapDetail');
    var note = doc.getElementById('rwMapNote');
    var m = null;
    try { m = initMap(doc, doc.getElementById('rwMap')); } catch (e) { m = null; }
    if (!m && doc.getElementById('rwMapWrap')) doc.getElementById('rwMapWrap').hidden = true;

    function draw() {
      var r = data.rounds[state.round];
      var shown = visibleItems(r, state);
      if (controls) controls.innerHTML = controlsHtml(data, state);
      el.innerHTML = '<p class="rw-muted">Showing ' + esc(shown.length) + ' of ' + esc(r.items.length) + ': ' +
        esc(r.counts.High) + ' High, ' + esc(r.counts.Medium) + ' Medium, ' + esc(r.counts.Watch) + ' Watch in all regions.' +
        (r.note ? ' ' + esc(r.note) : '') + '</p>' + tableHtml(r, contacts, state);
      var g = townsFor(shown);
      drawPins(doc, m, g.towns);
      // a region zooms to its own pins; all regions shows the whole state
      if (m) {
        try {
          if (state.region !== 'all' && g.towns.length) m.map.fitBounds(g.towns.map(function (t) { return [t.lat, t.lng]; }), { padding: [30, 30], maxZoom: 9, animate: false });
          else m.map.fitBounds(CO_BOUNDS, { padding: [8, 8], animate: false });
        } catch (e) { /* the map keeps its view */ }
      }
      if (panel) { panel.innerHTML = ''; panel.hidden = true; }
      if (note) note.textContent = g.unmapped.length
        ? 'Not on the map, no town printed: ' + g.unmapped.map(function (i) { return i.name; }).join(', ') + '.' : '';
    }

    function openDeal(id) {
      state.open[id] = true;
      var row = doc.getElementById('rw-d-' + id);
      var btn = el.querySelector('.rw-toggle[data-id="' + id.replace(/["\\]/g, '') + '"]');
      if (row) row.hidden = false;
      if (btn) {
        btn.setAttribute('aria-expanded', 'true');
        if (btn.scrollIntoView) btn.scrollIntoView({ block: 'center' });
        btn.focus();
      }
    }

    if (m) {
      m.map.on('click', function (e) {
        var hit = townsNear(m.towns, e.containerPoint, function (ll) { return m.map.latLngToContainerPoint(ll); });
        if (!panel) return;
        panel.innerHTML = hit.length ? townPanelHtml(hit) : '';
        panel.hidden = !hit.length;
      });
    }
    if (panel) panel.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-open]') : null;
      if (b) openDeal(b.getAttribute('data-open'));
    });
    if (controls) {
      controls.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-round]') : null;
        if (t) { state.round = +t.getAttribute('data-round'); state.open = {}; draw(); }
      });
      controls.addEventListener('change', function (e) {
        var k = e.target.getAttribute && e.target.getAttribute('data-filter');
        if (k) { state[k] = e.target.value; draw(); }
      });
    }
    el.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button, th[data-sort]') : null;
      if (!t) return;
      if (t.hasAttribute('data-sort')) {
        var k = t.getAttribute('data-sort');
        state.dir = state.sort === k && state.dir === 'asc' ? 'desc' : 'asc';
        state.sort = k; draw();
      } else if (t.classList.contains('rw-toggle')) {
        var id = t.getAttribute('data-id');
        state.open[id] = !state.open[id];
        var row = doc.getElementById('rw-d-' + id);
        if (row) row.hidden = !state.open[id];
        t.setAttribute('aria-expanded', String(!!state.open[id]));
      }
    });
    draw();
  }

  function start(doc) {
    var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get(DATA_URL), get(CONTACTS_URL)]).then(function (res) {
      if (!res[0]) {
        doc.getElementById('roundWatch').innerHTML = '<p>The watch list did not load. It is served only on the developer site.</p>';
        return;
      }
      mount(doc, res[0], res[1]);
    });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(document); });
    else start(document);
  }

  return { esc: esc, contactsFor: contactsFor, sortItems: sortItems, rowsHtml: rowsHtml, detailHtml: detailHtml,
    tableHtml: tableHtml, visibleItems: visibleItems, firstContactCell: firstContactCell, townsFor: townsFor,
    townsNear: townsNear, townPanelHtml: townPanelHtml, controlsHtml: controlsHtml, REGIONS: REGIONS, statsHtml: statsHtml, backtestHtml: backtestHtml, mount: mount, DATA_URL: DATA_URL, CONTACTS_URL: CONTACTS_URL };
});
