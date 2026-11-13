/**
 * member-place.js — "Working on: <place>" on every member page.
 *
 * paul, 2026-11-11: "You should always know which one you are on, have selected", with an easy switch.
 * Each member tool took a place its own way (?geoid=, ?place=, a filter box, or nothing), so moving from
 * one tool to the next lost the town. This keeps one picked place in the browser and shows it in a line
 * under the member menu, with three actions: open this page for that place, change it, clear it.
 *
 * Rules:
 *   - The address wins. A page opened with a place in its address (?geoid=, or ?place= on Market screen)
 *     sets the picked place, so a shared link opens on the sender's town and the line says so.
 *   - Nothing moves on its own. The line offers "Open it here"; it never redirects a page.
 *   - The place is kept in this browser only (localStorage, the member site's own origin). No request
 *     carries it and nothing is saved on the server.
 *   - Names are drawn with textContent, never as HTML.
 *
 * Loaded by developer-nav.js after it draws the menu, so every page with the member menu has it.
 * Lives in js/whitepaper/ because the gated bundle already copies that folder and the public build
 * already excludes it.
 */
(function (root) {
  'use strict';

  var KEY = 'coho-member-place';
  var GEOID = /^08\d{3}(\d{2})?$/;
  // Pages that open on a place given in the address, and the parameter each one reads.
  // Market screen scores towns, so it takes places (7 digits) only.
  var TAKES = {
    'developer-brief.html': { param: 'geoid' },
    'developer-commuters.html': { param: 'geoid' },
    'developer-hna-input.html': { param: 'geoid' },
    'developer-hap-survey.html': { param: 'geoid' },
    'developer-market-screen.html': { param: 'place', placesOnly: true },
    // Prop 123 strategy rewrites ?place= when its own picker changes, so the line follows it.
    'developer-prop123.html': { param: 'place' }
  };
  // Where the names come from, read only when someone opens "Change" or arrives by a link with no name yet.
  var PLACES_URL = 'data/co-place-centroids.json';          // 482 towns and Census places: byGeoid[geoid].name
  var COUNTIES_URL = 'data/policy/state-housing-laws.json'; // counties (5-digit keys) by name

  function fileOf(pathname) {
    var f = String(pathname || '').split('/').pop();
    return f || 'developer.html';
  }

  // The place in a page's address, or null. Only the parameter that page reads counts.
  function fromAddress(pathname, search) {
    var t = TAKES[fileOf(pathname)];
    if (!t) return null;
    var g;
    try { g = new URLSearchParams(String(search || '')).get(t.param) || ''; } catch (_) { g = ''; }
    if (!GEOID.test(g) || (t.placesOnly && g.length !== 7)) return null;
    return g;
  }

  // The address of this page for a place, or '' when the page takes none (or not this kind of place).
  function hrefFor(pathname, geoid) {
    var f = fileOf(pathname), t = TAKES[f];
    if (!t || !GEOID.test(String(geoid || '')) || (t.placesOnly && geoid.length !== 7)) return '';
    return f + '?' + t.param + '=' + geoid;
  }

  // The hub pages (places-hub, deal-hub and the rest, hub/hna.js) keep their own "Working on" place under
  // LAB_KEY as {geoid, label}. Both are kept in step (paul, 13 Nov: picking on one page left the other blank):
  // every write goes to both with the time it was made, and a read takes the newer one. A value from before
  // that has no time counts as oldest, and on a tie the member line's own place wins.
  var LAB_KEY = 'coho-lab-working';
  function parse(store, key) {
    var x;
    try { x = JSON.parse(store.getItem(key) || 'null'); } catch (_) { x = null; }
    if (!x || typeof x !== 'object' || !GEOID.test(String(x.geoid || ''))) return null;
    var at = Number(x.at);
    return { geoid: String(x.geoid), name: String((key === KEY ? x.name : x.label) || '').slice(0, 80), at: isFinite(at) && at > 0 ? at : 0 };
  }
  // getStore: returns localStorage. Reading the property itself throws when storage is blocked, so every
  // read and write happens inside a try.
  function read(getStore) {
    var store;
    try { store = getStore(); } catch (_) { return null; }
    var a = parse(store, KEY), b = parse(store, LAB_KEY);
    var x = a && b ? (b.at > a.at ? b : a) : (a || b);
    if (!x) return null;
    // The hub keeps a code as its label until it knows the name; the line names it itself.
    return { geoid: x.geoid, name: x.name === x.geoid ? '' : x.name };
  }
  function write(getStore, place) {
    try {
      var store = getStore();
      if (place && GEOID.test(String(place.geoid || ''))) {
        var name = String(place.name || '').slice(0, 80), at = Date.now();
        store.setItem(KEY, JSON.stringify({ geoid: place.geoid, name: name, at: at }));
        store.setItem(LAB_KEY, JSON.stringify({ geoid: place.geoid, label: name || place.geoid, at: at }));
      } else {
        store.removeItem(KEY);
        store.removeItem(LAB_KEY);
      }
      return true;
    } catch (_) { return false; }
  }

  // The Census name without its legal suffix: "Salida city" reads "Salida". "CDP" stays, since a Census place is
  // not a town. Two places left with one name each keep their full Census name.
  function plain(name) { return String(name).replace(/\s+(city and county|city|town)$/i, ''); }

  // [{geoid, name}] from the two files, towns and counties together, by name.
  function placeList(centroids, laws) {
    var out = [], seen = {};
    var by = (centroids && centroids.byGeoid) || {};
    var ids = Object.keys(by).filter(function (g) { return GEOID.test(g) && by[g] && by[g].name; });
    var uses = {};
    ids.forEach(function (g) { var n = plain(by[g].name).toLowerCase(); uses[n] = (uses[n] || 0) + 1; });
    ids.forEach(function (g) {
      if (seen[g]) return;
      var n = plain(by[g].name);
      seen[g] = 1; out.push({ geoid: g, name: uses[n.toLowerCase()] > 1 ? String(by[g].name) : n });
    });
    var j = (laws && laws.jurisdictions) || {};
    Object.keys(j).forEach(function (g) {
      if (g.length === 5 && GEOID.test(g) && j[g] && j[g].name && !seen[g]) { seen[g] = 1; out.push({ geoid: g, name: String(j[g].name) }); }
    });
    // Every option must name one geography, since the box submits only the name (Codex, #2774). A county
    // that shares its name with its town (Denver, Broomfield) reads "Denver County"; places that still share
    // a full Census name (two Twin Lakes CDPs) carry their GEOID.
    var count = function () { var c = {}; out.forEach(function (p) { var k = p.name.toLowerCase(); c[k] = (c[k] || 0) + 1; }); return c; };
    var c1 = count();
    out.forEach(function (p) { if (c1[p.name.toLowerCase()] > 1 && p.geoid.length === 5 && !/county$/i.test(p.name)) p.name += ' County'; });
    var c2 = count();
    out.forEach(function (p) { if (c2[p.name.toLowerCase()] > 1) p.name += ' (' + p.geoid + ')'; });
    return out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }
  function nameOf(list, geoid) {
    for (var i = 0; i < list.length; i++) if (list[i].geoid === geoid) return list[i].name;
    return '';
  }
  function findByName(list, typed) {
    var t = String(typed || '').trim().toLowerCase();
    if (!t) return null;
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === t) return list[i];
    return null;
  }

  var STYLE =
    '.mp-line{display:flex;flex-wrap:wrap;gap:.15rem .6rem;align-items:center;padding:.25rem 0;margin:0 0 var(--sp3,1rem);font-size:var(--small,.9rem);color:var(--muted)}' +
    '.mp-line strong{color:var(--text,inherit)}' +
    '.mp-line a,.mp-line button{min-height:44px;display:inline-flex;align-items:center;padding:0 .5rem;border:0;background:none;color:var(--accent);font:inherit;font-weight:600;text-decoration:none;cursor:pointer;border-radius:var(--radius-sm,6px)}' +
    '.mp-line a:hover,.mp-line button:hover{text-decoration:underline}' +
    '.mp-pick{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;flex-basis:100%}' +
    '.mp-pick input{min-height:44px;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm,6px);background:var(--card,transparent);color:var(--text,inherit);font:inherit;min-width:0;flex:1 1 14rem;max-width:22rem;box-sizing:border-box}' +
    '.mp-pick button[type=submit]{background:var(--accent);color:var(--on-accent,#fff);padding:0 .9rem}' +
    '.mp-pick button[type=submit]:hover{text-decoration:none}' +
    '.mp-msg{flex-basis:100%;margin:0}' +
    // The menu rows carry the space under them; the line takes it over.
    '#devNav.mp-above,#devSubNav.mp-above{margin-bottom:0}' +
    '@media print{.mp-line{display:none !important}}';

  function mount(doc, win) {
    doc = doc || root.document; win = win || root;
    var nav = doc && doc.getElementById('devNav');
    if (!nav || doc.getElementById('mpLine')) return;
    var loc = win.location || {}, path = loc.pathname || '';
    var getStore = function () { return win.localStorage; };
    // Under /dossiers/ the data files and member pages are one or two folders up (developer-nav.js upFrom).
    var up = root.DeveloperNav && root.DeveloperNav.upFrom ? root.DeveloperNav.upFrom(path) : '';
    var el = function (tag, attrs, text) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
      if (text != null) n.textContent = text;
      return n;
    };
    if (!doc.getElementById('mpStyle')) { var st = el('style', { id: 'mpStyle' }); st.textContent = STYLE; doc.head.appendChild(st); }

    var line = el('div', { id: 'mpLine', class: 'mp-line', role: 'group', 'aria-label': 'Place you are working on' });
    var after = doc.getElementById('devSubNav') || nav;
    after.classList.add('mp-above');
    if (after !== nav) nav.classList.add('mp-above');
    after.parentNode.insertBefore(line, after.nextSibling);

    var list = null, listLoading = null;
    var picked = null;   // the place the line shows now
    function loadList() {
      if (list) return Promise.resolve(list);
      if (!listLoading) {
        var get = function (u) { return win.fetch(up + u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
        listLoading = Promise.all([get(PLACES_URL), get(COUNTIES_URL)]).then(function (r) { list = placeList(r[0], r[1]); return list; });
      }
      return listLoading;
    }

    function draw(place, picking, msg) {
      line.textContent = '';
      if (place) {
        var lead = el('span', {}, 'Working on: ');
        lead.appendChild(el('strong', {}, place.name || place.geoid));
        line.appendChild(lead);
        var here = hrefFor(path, place.geoid);
        if (here && fromAddress(path, loc.search) !== place.geoid) line.appendChild(el('a', { href: here }, 'Open it here'));
      } else {
        line.appendChild(el('span', {}, 'No place picked.'));
      }
      var change = el('button', { type: 'button', 'aria-expanded': picking ? 'true' : 'false' }, place ? 'Change' : 'Pick a place');
      change.addEventListener('click', function () { draw(place, !picking); });
      line.appendChild(change);
      if (place) {
        var clear = el('button', { type: 'button' }, 'Clear');
        clear.addEventListener('click', function () { picked = null; write(getStore, null); draw(null, false); });
        line.appendChild(clear);
      }
      if (picking) {
        var form = el('form', { class: 'mp-pick' });
        var input = el('input', { id: 'mpInput', type: 'text', list: 'mpPlaces', autocomplete: 'off', placeholder: 'Town or county, e.g. Salida', 'aria-label': 'Town or county' });
        var dl = el('datalist', { id: 'mpPlaces' });
        form.appendChild(input); form.appendChild(dl); form.appendChild(el('button', { type: 'submit' }, 'Use this place'));
        line.appendChild(form);
        var note = el('p', { class: 'mp-msg', role: 'status', 'aria-live': 'polite' }, 'Loading the list of places…');
        line.appendChild(note);
        loadList().then(function (l) {
          l.forEach(function (p) { dl.appendChild(el('option', { value: p.name })); });
          note.textContent = l.length ? '' : 'The list of places did not load. Try again in a minute.';
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          loadList().then(function (l) {
            var hit = findByName(l, input.value);
            if (!hit) { note.textContent = 'Pick a town or county from the list as you type.'; return; }
            if (!write(getStore, hit)) { note.textContent = 'This browser blocks saved settings, so the place cannot be kept.'; return; }
            var go = hrefFor(path, hit.geoid);
            // A page that opens on a place goes to it; any other page just shows the new place.
            picked = hit;
            if (go && TAKES[fileOf(path)] && fromAddress(path, loc.search)) { loc.href = go; return; }
            draw(hit, false);
          });
        });
        try { input.focus(); } catch (_) { /* not focusable yet */ }
      } else if (msg) {
        line.appendChild(el('p', { class: 'mp-msg', role: 'status' }, msg));
      }
    }

    // The address wins: a place in this page's address becomes the picked place.
    var linked = fromAddress(path, loc.search), kept = read(getStore);
    if (linked && (!kept || kept.geoid !== linked)) {
      kept = { geoid: linked, name: '' };
      write(getStore, kept);
    }
    picked = kept;
    draw(kept, false);
    if (kept && !kept.name) nameIt(kept.geoid);

    // Fill in the name of a place picked by its code alone (a link, or the page's own picker).
    function nameIt(asked) {
      loadList().then(function (l) {
        // The member may have cleared or changed the place while the names loaded: only name the place
        // that is still picked, and never write it back otherwise.
        if (!picked || picked.geoid !== asked || picked.name) return;
        var n = nameOf(l, asked);
        if (!n) return;
        picked = { geoid: asked, name: n };
        write(getStore, picked);
        // Keep an open "Change" box open; only the name in the line is filled in.
        if (!doc.getElementById('mpInput')) draw(picked, false);
      });
    }

    // A page that switches place itself (Report's own picker rewrites ?geoid= with history.replaceState)
    // moves the line and the kept place with it, so the line never names a town the page no longer shows
    // (Codex, #2774).
    // Only a change of place in the address counts: the page restating the place it opened on (the report
    // rewrites ?geoid= when it finishes loading) must not bring back a place the member cleared.
    var shown = linked;
    function follow() {
      var g = fromAddress(path, loc.search);
      if (!g || g === shown) return;
      shown = g;
      if (picked && picked.geoid === g) return;
      picked = { geoid: g, name: list ? nameOf(list, g) : '' };
      write(getStore, picked);
      draw(picked, false);
      if (!picked.name) nameIt(g);
    }
    if (TAKES[fileOf(path)] && win.history) {
      ['pushState', 'replaceState'].forEach(function (m) {
        var orig = win.history[m];
        if (typeof orig !== 'function') return;
        win.history[m] = function () {
          var r = orig.apply(this, arguments);
          try { follow(); } catch (_) { /* the page's own call already succeeded */ }
          return r;
        };
      });
      if (win.addEventListener) win.addEventListener('popstate', follow);
    }
  }

  var api = { KEY: KEY, LAB_KEY: LAB_KEY, TAKES: TAKES, fromAddress: fromAddress, hrefFor: hrefFor, read: read, write: write, placeList: placeList, nameOf: nameOf, findByName: findByName, mount: mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MemberPlace = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { mount(); });
      else mount();
    }
  }
}(typeof self !== 'undefined' ? self : this));
