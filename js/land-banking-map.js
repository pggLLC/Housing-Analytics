/**
 * js/land-banking-map.js
 * The Prop 123 land banking map, on two pages:
 *   - land-banking-awards.html (public): grantee organisations and CHFA's program
 *     contact only, and each town links to its public needs assessment.
 *   - the developer-gated Where to build page, whose section names its own contacts
 *     file (data-lbm-contacts) and report link (data-lbm-report). This file names no
 *     gated path, so the public build can ship it; only a page that names a contacts
 *     file ever requests one.
 *
 * Reads data/policy/prop123-land-banking-awards.json (built by
 * scripts/funding/build_land_banking_awards.py from CHFA's award lists). One pin
 * per town; an award listing several towns has a pin in each. Pins sit at the town's
 * Census centre because CHFA lists towns, not addresses.
 *
 * Each award's status since the award (later state funding, a partner chosen, or
 * nothing found) comes from data/policy/prop123-land-banking-status.json
 * (scripts/funding/build_land_banking_status.py), loaded alongside the awards.
 *
 * Every count on the section is computed here from the awards file, so the summary
 * line and the pins cannot disagree with it. A contact the award list did not print
 * is labelled "to confirm" until someone confirms it.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LandBankingMap = api;
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var AWARDS = 'data/policy/prop123-land-banking-awards.json';
  var STATUS = 'data/policy/prop123-land-banking-status.json';
  var PURPOSE_TEXT = { 'Rental': 'rental', 'Homeownership': 'for-sale', 'Rental and Homeownership': 'rental and for-sale' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : null; }
  function safeEmail(e) { return /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(String(e || '')) ? String(e) : null; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function millions(n) { return '$' + (n / 1e6).toFixed(1) + ' million'; }
  function int(n) { return Math.round(n).toLocaleString('en-US'); }

  // award_id -> contact. CHFA's own list wins over a researched entry.
  function contactIndex(contacts) {
    var by = {};
    if (!contacts) return by;
    (contacts.researched || []).forEach(function (c) { by[c.award_id] = Object.assign({ kind: 'researched' }, c); });
    (contacts.from_award_lists || []).forEach(function (c) { by[c.award_id] = Object.assign({ kind: 'chfa' }, c); });
    return by;
  }

  function filterAwards(awards, q) {
    var s = String(q || '').toLowerCase().trim();
    if (!s) return (awards || []).slice();
    return (awards || []).filter(function (a) {
      var hay = [a.project, a.sponsor, a.show_project, a.show_sponsor, a.location].concat((a.places || []).map(function (p) { return p.name + ' ' + (p.county || ''); }))
        .join(' ').toLowerCase();
      return hay.indexOf(s) !== -1;
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

  // The name as readers should see it: CHFA's printed name unless the data gives a
  // corrected one (a typo or a shortened name in the award list).
  function projectName(a) { return a.show_project || a.project; }
  function sponsorName(a) { return a.show_sponsor || a.sponsor; }

  // One dated, sourced line on what has happened to the site since the award.
  function sinceHtml(a) {
    var s = a && a.since;
    if (!s || !s.text) return '';
    var links = (s.sources || []).map(function (x) {
      var u = safeUrl(x.url);
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' : esc(x.title);
    }).join('; ');
    return '<span class="lbm-since">Since the award: ' + esc(s.text) + (links ? ' <span class="lbm-note">(' + links + ')</span>' : '') + '</span>';
  }

  function roundLabel(data, id) {
    var r = ((data.meta || {}).rounds || []).find(function (x) { return x.id === id; });
    return r ? r.label : id;
  }

  function contactHtml(c, data, contactsMissing) {
    var programEmail = safeEmail((data.meta || {}).program_email);
    var ask = programEmail ? ' Ask CHFA at <a href="mailto:' + esc(programEmail) + '">' + esc(programEmail) + '</a>.' : '';
    if (contactsMissing) return '<span class="lbm-note">Contacts are not in this copy of the data.' + ask + '</span>';
    if (!c || c.status === 'not_found' || (!c.name && !c.phone && !c.email)) {
      return '<span class="lbm-note">No public contact found.' + ask + '</span>';
    }
    var email = safeEmail(c.email);
    var parts = [c.name ? esc(c.name) : null, c.role && c.kind !== 'chfa' ? esc(c.role) : null,
      c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a>' : null,
      email ? '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>' : null].filter(Boolean);
    var url = safeUrl(c.source_url);
    var where = c.kind === 'chfa' ? 'named on CHFA\'s award list' : 'from the grantee\'s website';
    var tag = c.kind === 'chfa' || c.confirmed === true ? '' : ' <span class="lbm-tag">to confirm</span>';
    return parts.join(', ') + ' <span class="lbm-note">(' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + where + '</a>' : where) + ')</span>' + tag;
  }

  // Public pages name no person: the grantee organisation, then CHFA's program contact.
  function publicContactHtml(a, data) {
    var programEmail = safeEmail((data.meta || {}).program_email);
    return 'ask ' + esc(sponsorName(a)) + (programEmail
      ? ', or CHFA\'s land banking team at <a href="mailto:' + esc(programEmail) + '">' + esc(programEmail) + '</a>.'
      : '.');
  }

  function reportLink(town, opts) {
    var base = opts.reportBase && /^[a-z0-9-]+\.html\?geoid=$/.test(opts.reportBase) ? opts.reportBase : null;
    return opts.mode === 'gated' && base
      ? '<a href="' + esc(base) + esc(town.geoid) + '">Open the ' + esc(town.name) + ' report</a>'
      : '<a href="housing-needs-assessment.html?geoid=' + esc(town.geoid) + '&amp;geoType=place&amp;auto=1">Open the ' +
        esc(town.name) + ' housing needs assessment</a>';
  }

  // opts: { mode: 'public' | 'gated', reportBase: 'page.html?geoid=' (gated only) }.
  function popupHtml(town, data, contacts, contactsMissing, opts) {
    opts = opts || { mode: 'public' };
    var mode = opts.mode;
    return '<div class="lbm-popup"><h4>' + esc(town.name) + (town.county ? ' <span class="lbm-note">(' + esc(town.county) + ')</span>' : '') + '</h4><ul>' +
      town.awards.map(function (a) {
        var since = sinceHtml(a);
        var status = statusHtml(a);
        return '<li><strong>' + esc(projectName(a)) + '</strong>: ' + esc(sponsorName(a)) + ', ' + money(a.amount_awarded) + ', about ' +
          int(a.estimated_units) + ' ' + esc(PURPOSE_TEXT[a.purpose] || String(a.purpose || '').toLowerCase()) + ' homes (' + esc(roundLabel(data, a.round)) + ').' +
          (status ? '<br>' + status : '') +
          (since ? '<br>' + since : '') +
          (mode === 'gated' ? '<br>Contact: ' + contactHtml((contacts || {})[a.id], data, contactsMissing)
            : '<br>Questions: ' + publicContactHtml(a, data)) + '</li>';
      }).join('') + '</ul>' + reportLink(town, opts) + '</div>';
  }

  function countText(shown, all) {
    if (shown.awards === all.awards) {
      return int(all.awards) + ' awards, ' + millions(all.amount) + ', for about ' + int(all.units) + ' homes in ' + int(all.towns) + ' towns.';
    }
    return int(shown.awards) + ' of ' + int(all.awards) + ' awards, in ' + int(shown.towns) + (shown.towns === 1 ? ' town' : ' towns') +
      ': ' + (shown.amount ? millions(shown.amount) : '$0') + ' for about ' + int(shown.units) + ' homes.';
  }

  function cssVar(name, fallback) {
    try {
      var v = global.getComputedStyle(global.document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  var CO_BOUNDS = [[36.99, -109.06], [41.0, -102.04]];

  var COUNTIES = 'data/co-county-boundaries.json';
  function addCountyLines(L, map, dark) {
    if (typeof L.geoJSON !== 'function') return;
    map.createPane('lbmCounties');
    map.getPane('lbmCounties').style.zIndex = 350;   // above the tiles, below the pins
    map.getPane('lbmCounties').style.pointerEvents = 'none';
    getJSON(COUNTIES, true).then(function (gj) {
      if (!gj || !gj.features) return;
      L.geoJSON(gj, {
        pane: 'lbmCounties', interactive: false,
        // Lines only: a fill would sit over the tile labels when someone zooms in.
        style: { color: dark ? '#8b98a8' : '#6b7787', weight: 1, opacity: 0.8, fill: false }
      }).addTo(map);
    });
  }

  function initMap(el) {
    var L = global.L;
    if (!L || !el) return null;
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
    map.fitBounds(CO_BOUNDS, { padding: [8, 8] });
    var dark = global.document.documentElement.getAttribute('data-theme') === 'dark';
    var base = global.COHOBasemaps ? (dark ? global.COHOBasemaps.dark() : global.COHOBasemaps.light()) : null;
    if (base) base.addTo(map);
    // The grey canvas tiles show almost nothing inside Colorado at state zoom, and a
    // browser that blocks the tile host shows nothing at all. County lines from our own
    // copy of the Census boundaries give the pins a recognisable state either way.
    addCountyLines(L, map, dark);
    // Re-measure when the container changes size (a phone rotating, the page reflowing),
    // or Leaflet keeps the first size and leaves part of the map without tiles.
    if (typeof global.ResizeObserver === 'function') {
      try { new global.ResizeObserver(function () { map.invalidateSize(); }).observe(el); } catch (e) { /* map still works at its first size */ }
    }
    return { map: map, layer: L.layerGroup().addTo(map) };
  }

  // Every town answers a tap anywhere within 22px of its pin (a 44px target), measured on
  // screen. Pins can sit closer than that (Denver and Thornton are ~8px apart at state
  // zoom), so a tap that reaches more than one town opens a short list of those towns
  // to choose from instead of guessing; no town's 44px area is cut down by a neighbour.
  var MIN_HIT_RADIUS = 22;
  function pinRadius(t) { return 6 + 3 * Math.sqrt(t.awards.length - 1); }
  function hitRadius(t) { return Math.max(MIN_HIT_RADIUS, pinRadius(t)); }

  function townsNear(towns, point, project) {
    return (towns || []).map(function (t) {
      var p = project([t.lat, t.lng]);
      return { t: t, d: Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)) };
    }).filter(function (x) { return x.d <= hitRadius(x.t); })
      .sort(function (a, b) { return a.d - b.d || a.t.name.localeCompare(b.t.name); })
      .map(function (x) { return x.t; });
  }

  function nearestTown(towns, point, project) {
    var best = null, bestD = Infinity;
    (towns || []).forEach(function (t) {
      var p = project([t.lat, t.lng]);
      var d = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2));
      if (d <= hitRadius(t) && d < bestD) { best = t; bestD = d; }
    });
    return best;
  }

  // The town a search names: one whose name matches the search exactly, or else the
  // only town left. A shared award (Trinidad, Walsenburg, Fort Garland) keeps its other
  // towns on the map, so the remaining-town count alone would never open it.
  function townForSearch(towns, q) {
    var s = String(q || '').toLowerCase().trim();
    if (!s) return null;
    var exact = towns.filter(function (t) { return String(t.name).toLowerCase() === s; });
    if (exact.length === 1) return exact[0];
    return towns.length === 1 ? towns[0] : null;
  }

  function drawPins(state, awards) {
    if (!state.mapState) return 0;
    var L = global.L;
    var colour = cssVar('--accent', '#096e65');
    state.mapState.layer.clearLayers();
    var towns = groupByTown(awards);
    towns.forEach(function (t) {
      L.circleMarker([t.lat, t.lng], {
        radius: pinRadius(t), interactive: false,
        color: '#ffffff', weight: 1.5, fillColor: colour, fillOpacity: 0.85
      }).addTo(state.mapState.layer);
    });
    state.shownTowns = towns;
    return towns.length;
  }

  // A town's awards open in a panel under the map rather than a popup: on a phone the
  // map is too narrow to hold several awards and their contacts.
  function showTown(state, town) {
    var el = global.document.querySelector('[data-lbm-detail]');
    if (!el) return;
    el.innerHTML = town ? popupHtml(town, state.data, state.contacts, state.contactsMissing, { mode: state.mode, reportBase: state.reportBase }) : '';
    el.hidden = !town;
  }

  // A tap that reaches several close pins: list them, nearest first, to pick one.
  function showChoice(state, towns) {
    var el = global.document.querySelector('[data-lbm-detail]');
    if (!el) return;
    el.innerHTML = '<div class="lbm-popup"><h4>' + towns.length + ' towns are close together here</h4>' +
      '<p class="lbm-note">Pick one, or zoom in on the map.</p><ul class="lbm-choice">' +
      towns.map(function (t) {
        var n = t.awards.length + (t.awards.length === 1 ? ' award' : ' awards');
        return '<li><button type="button" data-lbm-town="' + esc(t.geoid) + '">' + esc(t.name) +
          ' <span class="lbm-note">' + esc(n) + '</span></button></li>';
      }).join('') + '</ul></div>';
    el.hidden = false;
  }

  function onTap(state, towns) {
    if (towns.length === 1) showTown(state, towns[0]);
    else if (towns.length > 1) showChoice(state, towns);
  }

  // The same towns as the pins, as buttons: keyboard and screen-reader users cannot
  // reach an SVG pin, so this list is how they open a town without knowing its name.
  function townListHtml(towns) {
    return (towns || []).slice().sort(function (x, y) { return x.name.localeCompare(y.name); })
      .map(function (t) {
        var n = t.awards.length + (t.awards.length === 1 ? ' award' : ' awards');
        return '<li><button type="button" data-lbm-town="' + esc(t.geoid) + '">' + esc(t.name) +
          ' <span class="lbm-note">' + esc(n) + '</span></button></li>';
      }).join('');
  }

  // A search moves the map to what it found, so a town's pin is read against its own
  // name on the base map rather than a bigger neighbour's (Fruita's pin sits beside the
  // "Grand Junction" label at state zoom). An empty search goes back to the whole state.
  function fitToSearch(state, q) {
    if (!state.mapState) return;
    var map = state.mapState.map;
    var towns = state.towns || [];
    var town = townForSearch(towns, q);
    try {
      if (!String(q || '').trim() || !towns.length) map.fitBounds(CO_BOUNDS, { padding: [8, 8], animate: false });
      else if (town) map.setView([town.lat, town.lng], 11, { animate: false });
      else map.fitBounds(towns.map(function (t) { return [t.lat, t.lng]; }), { padding: [30, 30], maxZoom: 10, animate: false });
    } catch (e) { /* the map keeps its view */ }
  }

  function render(state) {
    var doc = global.document;
    var q = doc.getElementById('lbmSearch').value;
    var shown = filterAwards(state.data.awards, q);
    // The public page's headline already gives the totals, so its unfiltered line is short.
    var all = summarize(state.data.awards);
    doc.querySelector('[data-lbm-count]').textContent = shown.length
      ? (state.mode !== 'gated' && shown.length === all.awards ? 'Showing all ' + int(all.awards) + ' awards in ' + int(all.towns) + ' towns.'
        : countText(summarize(shown), all))
      : 'No award matches that search. Try a town, county or grantee name.';
    drawPins(state, shown);
    state.towns = groupByTown(shown);
    var list = doc.querySelector('[data-lbm-towns]');
    if (list) list.innerHTML = townListHtml(state.towns);
    var listCount = doc.querySelector('[data-lbm-towns-count]');
    if (listCount) listCount.textContent = String(state.towns.length);
    var listLabel = doc.querySelector('[data-lbm-towns-word]');
    if (listLabel) listLabel.textContent = state.towns.length === 1 ? 'town' : 'towns';
    fitToSearch(state, q);
    // A search that names a town, or narrows to one, opens it; otherwise the panel waits for a tap.
    showTown(state, townForSearch(state.towns, q));
  }

  // A section that names a contacts file is the gated version; anything else is public.
  function pageConfig(doc) {
    var el = doc.querySelector('[data-land-banking-map]');
    var contacts = el && el.getAttribute('data-lbm-contacts');
    return contacts
      ? { mode: 'gated', contactsPath: contacts, reportBase: el.getAttribute('data-lbm-report') || null }
      : { mode: 'public', contactsPath: null, reportBase: null };
  }

  function boot(data, contacts, cfg) {
    var doc = global.document;
    var m = data.meta || {};
    cfg = cfg || pageConfig(doc);
    var state = { data: data, mode: cfg.mode, reportBase: cfg.reportBase, contacts: contactIndex(contacts), contactsMissing: !contacts };
    var url = safeUrl(m.program_url);
    var email = safeEmail(m.program_email);
    var program = doc.querySelector('[data-lbm-program]');
    if (program) program.innerHTML =
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">CHFA\'s program page</a>' : 'CHFA') +
      (email ? ' · <a href="mailto:' + esc(email) + '">' + esc(email) + '</a>' : '');
    var note = doc.querySelector('[data-lbm-note]');
    if (note) note.textContent = m.location_note || '';
    state.mapState = initMap(doc.getElementById('lbmMap'));
    if (state.mapState) {
      var map = state.mapState.map;
      var project = function (ll) { return map.latLngToContainerPoint(ll); };
      map.on('click', function (e) {
        onTap(state, townsNear(state.shownTowns, e.containerPoint, project));
      });
      map.on('mousemove', function (e) {
        var t = nearestTown(state.shownTowns, e.containerPoint, project);
        map.getContainer().style.cursor = t ? 'pointer' : '';
        map.getContainer().title = t ? t.name + ': ' + t.awards.length + (t.awards.length === 1 ? ' award' : ' awards') : '';
      });
    }
    doc.getElementById('lbmSearch').addEventListener('input', function () { render(state); });
    // Town buttons live in the list under the map and in the close-pins chooser.
    var section = doc.querySelector('[data-land-banking-map]');
    if (section) section.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-lbm-town]');
      if (!b) return;
      var geoid = b.getAttribute('data-lbm-town');
      var town = (state.towns || []).filter(function (t) { return t.geoid === geoid; })[0];
      showTown(state, town || null);
      var panel = doc.querySelector('[data-lbm-detail]');
      if (town && panel) panel.focus();
    });
    render(state);
    return state;
  }

  // no-store, like DataService.getJSON: a weekly data update must reach a returning browser.
  function getJSON(path, optional) {
    return global.fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) { if (optional) return null; throw new Error('HTTP ' + r.status); }
      return r.json();
    }).catch(function (e) { if (optional) return null; throw e; });
  }

  // One request per page load, so a page that also renders the awards elsewhere
  // (the public table) shows the same snapshot as the map.
  // The status file is optional: without it the awards show as before, with no status line.
  var awardsLoad = null;
  function loadAwards() {
    if (!awardsLoad) awardsLoad = Promise.all([getJSON(AWARDS, false), getJSON(STATUS, true)]).then(function (r) {
      return attachStatus(r[0], r[1]);
    });
    return awardsLoad;
  }

  function attachStatus(data, status) {
    var by = (status && status.status) || {};
    (data.awards || []).forEach(function (a) { if (by[a.id]) a.status = by[a.id]; });
    return data;
  }

  // Where the site stands since the award: a label, then the dated, sourced detail.
  function statusHtml(a, cls) {
    var s = a && a.status;
    if (!s || !s.label) return '';
    var links = (s.sources || []).map(function (x) {
      var u = safeUrl(x.url);
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' : esc(x.title);
    }).join('; ');
    var checked = s.status === 'none_found' && s.checked ? ' (checked ' + esc(s.checked) + ')' : '';
    // The table's Status column names itself; the map popup needs the word.
    return '<span class="' + (cls || 'lbm-status') + '"><strong>' + (cls ? '' : 'Status: ') + esc(s.label) + '</strong>' + checked + '.' +
      (s.text ? ' ' + esc(s.text) : '') + (links ? ' <span class="lbm-note">(' + links + ')</span>' : '') + '</span>';
  }

  function start() {
    var doc = global.document;
    if (!doc || !doc.querySelector('[data-land-banking-map]')) return null;
    var cfg = pageConfig(doc);
    // Only the gated page names a contacts file; the public page never requests one.
    return Promise.all([loadAwards(), cfg.contactsPath ? getJSON(cfg.contactsPath, true) : null])
      .then(function (r) { boot(r[0], r[1], cfg); }).catch(function (e) {
      doc.querySelector('[data-lbm-count]').textContent = 'The award list could not be loaded (' + (e && e.message) + '). Try reloading the page.';
    });
  }

  if (global.document && !global.LandBankingMapNoAutoStart) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return { contactIndex: contactIndex, filterAwards: filterAwards, summarize: summarize, groupByTown: groupByTown,
    popupHtml: popupHtml, sinceHtml: sinceHtml, projectName: projectName, sponsorName: sponsorName, showTown: showTown, townForSearch: townForSearch, hitRadius: hitRadius, nearestTown: nearestTown, townsNear: townsNear, onTap: onTap, townListHtml: townListHtml, contactHtml: contactHtml, publicContactHtml: publicContactHtml, pageConfig: pageConfig, loadAwards: loadAwards, attachStatus: attachStatus, statusHtml: statusHtml, start: start, countText: countText, boot: boot, AWARDS: AWARDS, STATUS: STATUS };
}));
