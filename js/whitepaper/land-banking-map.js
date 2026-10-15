/**
 * js/whitepaper/land-banking-map.js
 * The Prop 123 land banking map on developer-where.html (developer-gated).
 *
 * Reads data/policy/prop123-land-banking-awards.json (built by
 * scripts/funding/build_land_banking_awards.py from CHFA's award lists) and the
 * gated contacts file data/jurisdiction-briefs/_land-banking-contacts.json. One pin
 * per town; an award listing several towns has a pin in each. Pins sit at the town's
 * Census centre because CHFA lists towns, not addresses.
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
  var CONTACTS = 'data/jurisdiction-briefs/_land-banking-contacts.json';
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
      var hay = [a.project, a.sponsor, a.location].concat((a.places || []).map(function (p) { return p.name + ' ' + (p.county || ''); }))
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

  function popupHtml(town, data, contacts, contactsMissing) {
    return '<div class="lbm-popup"><h4>' + esc(town.name) + (town.county ? ' <span class="lbm-note">(' + esc(town.county) + ')</span>' : '') + '</h4><ul>' +
      town.awards.map(function (a) {
        return '<li><strong>' + esc(a.project) + '</strong>: ' + esc(a.sponsor) + ', ' + money(a.amount_awarded) + ', about ' +
          int(a.estimated_units) + ' ' + esc(PURPOSE_TEXT[a.purpose] || String(a.purpose || '').toLowerCase()) + ' homes (' + esc(roundLabel(data, a.round)) + ').' +
          '<br>Contact: ' + contactHtml(contacts[a.id], data, contactsMissing) + '</li>';
      }).join('') + '</ul>' +
      '<a href="developer-brief.html?geoid=' + esc(town.geoid) + '">Open the ' + esc(town.name) + ' report</a></div>';
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

  function initMap(el) {
    var L = global.L;
    if (!L || !el) return null;
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
    map.fitBounds([[36.99, -109.06], [41.0, -102.04]], { padding: [8, 8] });
    var dark = global.document.documentElement.getAttribute('data-theme') === 'dark';
    var base = global.COHOBasemaps ? (dark ? global.COHOBasemaps.dark() : global.COHOBasemaps.light()) : null;
    if (base) base.addTo(map);
    // Re-measure when the container changes size (a phone rotating, the page reflowing),
    // or Leaflet keeps the first size and leaves part of the map without tiles.
    if (typeof global.ResizeObserver === 'function') {
      try { new global.ResizeObserver(function () { map.invalidateSize(); }).observe(el); } catch (e) { /* map still works at its first size */ }
    }
    return { map: map, layer: L.layerGroup().addTo(map) };
  }

  var MIN_HIT_RADIUS = 22;
  function pinRadius(t) { return 6 + 3 * Math.sqrt(t.awards.length - 1); }
  function hitRadius(t) { return Math.max(MIN_HIT_RADIUS, pinRadius(t)); }

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
      // The visible pin is as small as 6px; an invisible circle at least 44px across
      // takes the tap, so every town meets the 44px touch-target rule.
      L.circleMarker([t.lat, t.lng], { radius: hitRadius(t), stroke: false, fillOpacity: 0, fillColor: colour })
        .on('click', function () { showTown(state, t); })
        .bindTooltip(t.name + ': ' + t.awards.length + (t.awards.length === 1 ? ' award' : ' awards'))
        .addTo(state.mapState.layer);
    });
    return towns.length;
  }

  // A town's awards open in a panel under the map rather than a popup: on a phone the
  // map is too narrow to hold several awards and their contacts.
  function showTown(state, town) {
    var el = global.document.querySelector('[data-lbm-detail]');
    if (!el) return;
    el.innerHTML = town ? popupHtml(town, state.data, state.contacts, state.contactsMissing) : '';
    el.hidden = !town;
  }

  function render(state) {
    var doc = global.document;
    var q = doc.getElementById('lbmSearch').value;
    var shown = filterAwards(state.data.awards, q);
    doc.querySelector('[data-lbm-count]').textContent = shown.length
      ? countText(summarize(shown), summarize(state.data.awards))
      : 'No award matches that search. Try a town, county or grantee name.';
    drawPins(state, shown);
    // A search that narrows to one town opens it; otherwise the panel waits for a tap.
    showTown(state, townForSearch(groupByTown(shown), q));
  }

  function boot(data, contacts) {
    var doc = global.document;
    var m = data.meta || {};
    var state = { data: data, contacts: contactIndex(contacts), contactsMissing: !contacts };
    var url = safeUrl(m.program_url);
    var email = safeEmail(m.program_email);
    doc.querySelector('[data-lbm-program]').innerHTML =
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">CHFA\'s program page</a>' : 'CHFA') +
      (email ? ' · <a href="mailto:' + esc(email) + '">' + esc(email) + '</a>' : '');
    doc.querySelector('[data-lbm-note]').textContent = m.location_note || '';
    state.mapState = initMap(doc.getElementById('lbmMap'));
    doc.getElementById('lbmSearch').addEventListener('input', function () { render(state); });
    render(state);
    return state;
  }

  function getJSON(path, optional) {
    return global.fetch(path).then(function (r) {
      if (!r.ok) { if (optional) return null; throw new Error('HTTP ' + r.status); }
      return r.json();
    }).catch(function (e) { if (optional) return null; throw e; });
  }

  function start() {
    var doc = global.document;
    if (!doc || !doc.querySelector('[data-land-banking-map]')) return;
    Promise.all([getJSON(AWARDS, false), getJSON(CONTACTS, true)]).then(function (r) { boot(r[0], r[1]); }).catch(function (e) {
      doc.querySelector('[data-lbm-count]').textContent = 'The award list could not be loaded (' + (e && e.message) + '). Try reloading the page.';
    });
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return { contactIndex: contactIndex, filterAwards: filterAwards, summarize: summarize, groupByTown: groupByTown,
    popupHtml: popupHtml, showTown: showTown, townForSearch: townForSearch, hitRadius: hitRadius, contactHtml: contactHtml, countText: countText, boot: boot, AWARDS: AWARDS, CONTACTS: CONTACTS };
}));
