/**
 * ripeness.js — "Ready to build" on the gated pipeline page: two lists, one of
 * communities (every pipeline place, kept as it is) and one of specific sites,
 * each row saying in one line why it sits where it does.
 *
 * The data, data/ripeness.json, is built by the private backend at deploy time:
 * sites screened from data/market/development-activity.json for the pipeline's
 * places, plus readiness cards written from each site dossier. It is never in
 * this repository, so on any other copy of the page the section says where the
 * list lives instead of showing an empty one.
 *
 * Suggested order: a community's best site first (ripe, ripening, a site on file
 * with no readiness sheet yet, a site studied and not yet ready, no site), then
 * the pipeline score. "My order" is the owner's own: rows moved, pinned or
 * selected are saved on the site (/api/ready-order) and in this browser.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.Ripeness in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ripeness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DATA_URL = 'data/ripeness.json';
  var ORDER_URL = 'api/ready-order';
  var LOCAL_KEY = 'coho-ready-order';
  var RANK = { ripe: 0, ripening: 1, on_file: 2, not_yet: 3, none: 4 };
  var LABEL = { ripe: 'Ripe', ripening: 'Ripening', on_file: 'Site on file', not_yet: 'Not yet', none: 'No site on file' };
  var QUESTIONS = [
    ['need', 'Is there need?'],
    ['control', 'Is there a path to site control?'],
    ['entitlements', 'Are the entitlements firm?'],
    ['deal', 'Does a deal close?'],
    ['support', 'Is there local support?'],
    ['window', 'Is a funding window within 12 months?'],
    ['blockers', 'Are hard blockers cleared?']
  ];
  var STATUS = { ready: 'Yes', partly: 'Partly', not_yet: 'Not yet' };
  var STAGE = {
    land_funded: 'land funded, no tax credit yet',
    applied: 'applied, decision pending',
    letter_of_intent: 'letter of intent filed',
    not_funded: 'applied, not funded',
    dossier: 'studied in a site dossier',
    public_land: 'land held by a public owner'
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function link(text, url) {
    return /^https?:\/\//.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text);
  }

  function siteReading(s) { return s.card ? s.card.reading : 'on_file'; }

  // The developer check on a site, from the backend's site research.
  var OPEN = {
    open: 'Open: land held, no developer chosen.',
    rfp: 'Open: developer search under way or coming.',
    opening: 'Opening: the last applicant appears to have moved on.',
    unclear: 'Unclear: no developer named in public records.',
    taken: 'Taken: a developer is still on it.'
  };
  var OPEN_RANK = { open: 0, rfp: 1, opening: 2, unclear: 3, taken: 4 };
  function openRank(s) { return s.opening && s.opening.status in OPEN_RANK ? OPEN_RANK[s.opening.status] : 3; }
  function openingLine(s) { return s.opening && OPEN[s.opening.status] ? ' ' + OPEN[s.opening.status] : ' No developer check on file yet; treat as unclear.'; }

  function siteLine(s) {
    return siteBase(s) + openingLine(s);
  }
  function siteBase(s) {
    if (s.card) {
      return LABEL[s.card.reading] + ' (dossier, checked ' + s.card.checked + '). What would change it: ' + s.card.trigger +
        (s.card.next ? ' Next date: ' + s.card.next.date + ', ' + s.card.next.what + '.' : '');
    }
    return 'On file: ' + [s.program, s.agency].filter(Boolean).join(', ') + ', ' + (STAGE[s.stage] || s.stage) + (s.year ? ' (' + s.year + ')' : '') +
      '. No readiness sheet yet.';
  }

  function prop123Line(p) {
    if (!p || !p.prop123) return '';
    return 'Prop 123: ' + p.prop123.toLowerCase() + (p.prop123_units ? ' (' + p.prop123_units + ' homes)' : '') + (p.fast_track ? ', fast track' : '');
  }

  // Both lists, in suggested order. `pipeline` is the merged pipeline (private
  // file plus site edits); every place in it stays, whatever its readiness.
  function build(data, pipeline, signals) {
    data = data || { sites: [], places: {} };
    var byGeoid = {};
    (data.sites || []).forEach(function (s) { (byGeoid[s.geoid] = byGeoid[s.geoid] || []).push(s); });
    function siteSort(a, b) {
      return openRank(a) - openRank(b) || RANK[siteReading(a)] - RANK[siteReading(b)] || (num(b.homes) || 0) - (num(a.homes) || 0) || String(a.name).localeCompare(String(b.name));
    }
    Object.keys(byGeoid).forEach(function (g) { byGeoid[g].sort(siteSort); });
    var rows = (pipeline || []).filter(function (r) { return r && r.geoid && r.stage !== 'Anti'; });
    var byPlace = {};
    rows.forEach(function (r) { byPlace[r.geoid] = r; });

    var communities = rows.map(function (r) {
      var sites = byGeoid[r.geoid] || [];
      // A site another developer is on is listed, never suggested.
      var best = sites.filter(function (s) { return !(s.opening && s.opening.status === 'taken'); })[0] || null;
      var reading = best ? siteReading(best) : 'none';
      var sig = (signals || []).filter(function (s) { return s.geoid === r.geoid; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0] || null;
      var why = [
        r.ioi_score ? 'Pipeline score ' + r.ioi_score + [r.classification ? 'class ' + r.classification : '', r.confidence ? r.confidence + ' confidence' : ''].filter(Boolean).map(function (x) { return ', ' + x; }).join('') : '',
        prop123Line((data.places || {})[r.geoid]),
        best ? 'Best site: ' + best.name + (best.homes ? ' (' + best.homes + ' homes)' : '') + ', ' + LABEL[reading].toLowerCase() + (sites.length > 1 ? '; ' + (sites.length - 1) + ' more on file' : '') : sites.length ? 'Every site on file has a developer on it' : 'No site on file in public program records',
        sig ? 'Latest signal: ' + [sig.signal_type, sig.strength, sig.date].filter(Boolean).join(', ') : ''
      ].filter(Boolean).join('. ') + '.';
      return { key: r.geoid, report: r.geoid, name: r.jurisdiction || r.geoid, geoid: r.geoid, row: r, sites: sites, reading: reading, signal: sig, place: (data.places || {})[r.geoid] || null, why: why };
    }).sort(function (a, b) {
      return RANK[a.reading] - RANK[b.reading] || (num(b.row.ioi_score) || 0) - (num(a.row.ioi_score) || 0) || a.name.localeCompare(b.name);
    });

    var sites = (data.sites || []).map(function (s) {
      var c = byPlace[s.geoid] || null;
      return { key: s.id, report: reportId(s), name: s.name, geoid: s.geoid, place: s.place, site: s, reading: siteReading(s), community: c, why: siteLine(s) };
    }).sort(function (a, b) {
      return openRank(a.site) - openRank(b.site) || RANK[a.reading] - RANK[b.reading] ||
        (num(b.community && b.community.ioi_score) || 0) - (num(a.community && a.community.ioi_score) || 0) ||
        (num(b.site.homes) || 0) - (num(a.site.homes) || 0) || a.name.localeCompare(b.name);
    });
    return { communities: communities, sites: sites };
  }

  function blankList() { return { order: [], pinned: [], selected: [] }; }
  function cleanState(s) {
    function list(v) {
      v = v || {};
      var keys = function (a) { return Array.isArray(a) ? a.map(String) : []; };
      return { order: keys(v.order), pinned: keys(v.pinned), selected: keys(v.selected) };
    }
    s = s && typeof s === 'object' ? s : {};
    var r = s.reports && typeof s.reports === 'object' && !Array.isArray(s.reports) ? s.reports : null;
    var ids = function (a) { return Array.isArray(a) ? a.map(String) : []; };
    return { communities: list(s.communities), sites: list(s.sites), reports: r ? { communities: ids(r.communities), sites: ids(r.sites) } : null };
  }

  // ---- Daily update picks. The alert email's "Today's tasks" reports on the
  // projects ticked here: a community by its geoid, a site by its dossier when
  // it has a readiness card (the email reads the card). A row counts as ticked
  // when its own row key is saved; the saved list also carries each ticked
  // row's email id, rebuilt from the ticked rows on every change, so a card
  // added or removed (or two sites sharing a dossier) never flips a tick.
  // No choice saved (reports null) means every project is reported; the first
  // untick writes out the full choice for both lists, minus that row.
  function reportId(s) { return s.card && s.card.dossier ? String(s.card.dossier) : String(s.id); }
  function reportIds(it) { return it.report === String(it.key) ? [it.report] : [String(it.key), it.report]; }
  function isReported(state, tab, it) {
    return !state.reports || state.reports[tab].indexOf(String(it.key)) !== -1;
  }
  // The saved list for one tab: ids no current row owns (kept for rows that
  // may come back), then every id of each ticked row.
  function rebuild(state, rows, tab, flip) {
    var owned = [].concat.apply([], rows.map(reportIds));
    var out = state.reports ? state.reports[tab].filter(function (id) { return owned.indexOf(id) === -1; }) : [];
    rows.forEach(function (it) {
      if (isReported(state, tab, it) === (it !== flip)) reportIds(it).forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    });
    return out;
  }
  function toggleReport(state, lists, tab, it) {
    return {
      communities: rebuild(state, lists.communities, 'communities', tab === 'communities' ? it : null),
      sites: rebuild(state, lists.sites, 'sites', tab === 'sites' ? it : null)
    };
  }
  // Bring the saved ids in line with the ticked rows (a card added or removed
  // since the last save). Returns true when the choice changed.
  function syncReports(state, lists) {
    if (!state.reports) return false;
    var next = toggleReport(state, lists, null, null);
    var changed = JSON.stringify(next) !== JSON.stringify(state.reports);
    state.reports = next;
    return changed;
  }

  // The rows to show: pinned first (in the order pinned); then, in "My order",
  // rows the owner has placed in their saved order and new rows after them in
  // suggested order; in "Suggested order", the rest as suggested.
  function arrange(items, saved, mode, selectedOnly) {
    saved = saved || blankList();
    var byKey = {};
    items.forEach(function (it) { byKey[it.key] = it; });
    var pinned = saved.pinned.filter(function (k) { return byKey[k]; }).map(function (k) { return byKey[k]; });
    var rest = items.filter(function (it) { return saved.pinned.indexOf(it.key) === -1; });
    if (mode === 'mine') {
      var placed = saved.order.filter(function (k) { return byKey[k] && saved.pinned.indexOf(k) === -1; }).map(function (k) { return byKey[k]; });
      rest = placed.concat(rest.filter(function (it) { return saved.order.indexOf(it.key) === -1; }));
    }
    var out = pinned.concat(rest);
    return selectedOnly ? out.filter(function (it) { return saved.selected.indexOf(it.key) !== -1; }) : out;
  }

  // Move one row within the shown order and save that whole order as "mine".
  // fullKeys is the same view unfiltered: when only selected rows are shown,
  // the moved rows trade places among the slots they already hold, so the
  // hidden rows stay where they were.
  function move(saved, shownKeys, key, to, fullKeys) {
    var unpinned = function (k) { return saved.pinned.indexOf(k) === -1; };
    var keys = shownKeys.filter(unpinned);
    var from = keys.indexOf(key);
    if (from === -1) return saved;
    to = Math.max(0, Math.min(keys.length - 1, to));
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    if (fullKeys) {
      var next = 0;
      keys = fullKeys.filter(unpinned).map(function (k) { return keys.indexOf(k) === -1 ? k : keys[next++]; });
    }
    var others = saved.order.filter(function (k) { return keys.indexOf(k) === -1; });
    return { order: keys.concat(others), pinned: saved.pinned.slice(), selected: saved.selected.slice() };
  }
  function toggle(list, key) {
    var i = list.indexOf(key);
    return i === -1 ? list.concat([key]) : list.slice(0, i).concat(list.slice(i + 1));
  }

  // ---- browser: saved order, rendering, events.
  // The browser copy is marked unsent until the site takes it. An unsent copy
  // is newer than the site's, so it wins at the next load and is sent then.
  var PENDING_KEY = LOCAL_KEY + '-unsent';
  function loadState(fetchFn, storage) {
    var local = null, unsent = false;
    try { local = JSON.parse(storage.getItem(LOCAL_KEY) || 'null'); unsent = storage.getItem(PENDING_KEY) === '1'; } catch (e) { local = null; }
    return fetchFn(ORDER_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (remote) {
        if (local && unsent) return { state: cleanState(local), synced: false, unsent: true };
        var state = cleanState(remote || local);
        // Keep the site copy in the browser too, so a later failed load falls
        // back to the newest order, not an older one.
        if (remote) { try { storage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (e) { /* private window */ } }
        return { state: state, synced: !!remote, unsent: false };
      });
  }
  function keepLocal(storage, state) {
    try { storage.setItem(LOCAL_KEY, JSON.stringify(state)); storage.setItem(PENDING_KEY, '1'); } catch (e) { /* private window */ }
  }
  function saveState(fetchFn, storage, state) {
    keepLocal(storage, state);
    return fetchFn(ORDER_URL, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
      .then(function (r) { return r.ok; }).catch(function () { return false; })
      .then(function (ok) {
        if (ok) { try { storage.removeItem(PENDING_KEY); } catch (e) { /* private window */ } }
        return ok;
      });
  }

  var STYLE =
    '.rd-tabs,.rd-tools{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.6rem 0}' +
    '.rd-tabs button,.rd-tools button{padding:.45rem .8rem;border-radius:var(--radius-sm,6px);border:1px solid var(--border);background:var(--bg2);color:var(--text);font-weight:600;font-size:var(--small,.9rem);cursor:pointer;min-height:44px}' +
    '.rd-tabs button[aria-selected="true"],.rd-tools button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:var(--on-accent,#fff)}' +
    '.rd-tools label{font-size:var(--small,.9rem);display:flex;gap:.35rem;align-items:center;min-height:44px;cursor:pointer}' +
    '.rd-list{list-style:none;padding:0;margin:0}' +
    '.rd-row{display:grid;grid-template-columns:auto 1fr auto;gap:.5rem .7rem;align-items:start;padding:.65rem .2rem;border-bottom:1px solid var(--border)}' +
    '.rd-row.dragging{opacity:.4}.rd-row.over{border-top:2px solid var(--accent)}' +
    '.rd-pick{display:flex;flex-direction:column;align-items:center;gap:.2rem;font-weight:700;color:var(--muted);font-size:.85rem}' +
    '.rd-pick label{display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;cursor:pointer}.rd-pick input{width:1.15rem;height:1.15rem}' +
    '.rd-main{min-width:0}.rd-main a.rd-name{font-weight:700}' +
    '.rd-badge{display:inline-block;font-size:.72rem;font-weight:700;padding:0 .4rem;border-radius:4px;border:1px solid var(--border);margin-left:.35rem;white-space:nowrap}' +
    '.rd-ripe{background:var(--good,#1a7f37);border-color:var(--good,#1a7f37);color:#fff}.rd-ripening{border-color:var(--accent);color:var(--accent)}' +
    '.rd-pin{font-size:.72rem;font-weight:700;color:var(--muted);margin-left:.35rem}' +
    '.rd-report{display:inline-flex;align-items:center;gap:.4rem;min-height:44px;font-size:var(--small,.9rem);font-weight:600;cursor:pointer}.rd-report input{width:1.15rem;height:1.15rem}' +
    '.rd-why{margin:.25rem 0 0;font-size:var(--small,.9rem);line-height:1.5}' +
    '.rd-main details{margin-top:.3rem;font-size:var(--small,.9rem)}.rd-main summary{cursor:pointer;color:var(--accent);font-weight:600;line-height:44px}' +
    '.rd-answers{list-style:none;padding:0;margin:.4rem 0 0}.rd-answers li{padding:.3rem 0;border-top:1px solid var(--border);line-height:1.5}' +
    '.rd-move{display:flex;gap:.25rem}.rd-move button{min-width:44px;min-height:44px;border:1px solid var(--border);border-radius:var(--radius-sm,6px);background:var(--bg2);color:var(--text);cursor:pointer;font-size:1rem}' +
    '.rd-move button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}' +
    '@media (max-width:600px){.rd-row{grid-template-columns:auto 1fr}.rd-move{grid-column:2;justify-content:flex-start}}';

  function answersHtml(s) {
    var c = s.card;
    if (!c) {
      return '<p>' + link('The public record for this site', s.source_url) + '. A readiness sheet answers the seven questions: need, site control, entitlements, whether a deal closes, local support, timing and blockers.</p>';
    }
    var href = function (sec) { return c.dossier_href ? c.dossier_href + '#' + sec : null; };
    return '<ul class="rd-answers">' + QUESTIONS.map(function (q) {
      var a = (c.answers || []).filter(function (x) { return x.q === q[0]; })[0] || {};
      var h = href(a.section);
      return '<li><strong>' + esc(q[1]) + '</strong> ' + esc(STATUS[a.status] || '') + '. ' + esc(a.line) +
        (h ? ' <a href="' + esc(h) + '">Dossier section</a>' : '') + '</li>';
    }).join('') + '</ul>' +
      (c.dossier_href ? '<p><a href="' + esc(c.dossier_href) + '">Open the full dossier</a></p>' : '<p style="color:var(--muted)">The full dossier opens here once dossiers are turned on for this site.</p>') +
      (s.source_url ? '<p>' + link('Public record for this site', s.source_url) + '</p>' : '');
  }

  function communityDetail(c) {
    var s = c.sites.map(function (x) { return '<li><strong>' + esc(x.name) + '</strong> <span class="rd-badge rd-' + esc(siteReading(x)) + '">' + esc(LABEL[siteReading(x)]) + '</span><br>' + esc(siteLine(x)) + '</li>'; }).join('');
    return '<ul class="rd-answers">' + (s || '<li>No site on file in the land banking, CHFA or state award records since 2023. A site here needs a search by hand.</li>') +
      (c.row.notes ? '<li><strong>Your note:</strong> ' + esc(c.row.notes) + '</li>' : '') +
      (c.signal ? '<li><strong>Latest signal:</strong> ' + esc(c.signal.summary || '') + ' ' + link('(source)', c.signal.source_url) + '</li>' : '') +
      (c.place && c.place.prop123 ? '<li><strong>' + esc(prop123Line(c.place)) + '</strong>, from DOLA commitment filings.</li>' : '') +
      '</ul><p><a href="developer-brief.html?geoid=' + encodeURIComponent(c.geoid) + '">Open the place card</a></p>';
  }

  function mount(el, ctx) {
    if (!el) return Promise.resolve();
    var doc = el.ownerDocument;
    var win = doc.defaultView || root;
    var fetchFn = (ctx && ctx.fetch) || win.fetch.bind(win);
    var storage; try { storage = win.localStorage; } catch (e) { storage = { getItem: function () { return null; }, setItem: function () {} }; }
    if (!doc.getElementById('rdStyle')) {
      var st = doc.createElement('style'); st.id = 'rdStyle'; st.textContent = STYLE; doc.head.appendChild(st);
    }
    var ui = { tab: 'communities', mode: 'suggested', selectedOnly: false };
    var lists = null, state = cleanState(null), synced = false, data = null, dragKey = null;

    // One save in flight at a time; changes made meanwhile go in one follow-up
    // save of the latest state, so an older order can never land last.
    var saving = false, again = false;
    function save() {
      if (saving) { keepLocal(storage, state); again = true; return; }
      saving = true;
      saveState(fetchFn, storage, state).then(function (ok) {
        saving = false;
        if (again) { again = false; save(); return; }
        synced = ok;
        var s = el.querySelector('#rdSaved');
        if (s) s.textContent = ok ? 'Your order is saved on the site, so it is the same on every device.' : 'Your order is saved in this browser only; the site did not take it.';
      });
    }

    function draw() {
      var items = lists[ui.tab];
      var saved = state[ui.tab];
      var shown = arrange(items, saved, ui.mode, ui.selectedOnly);
      var counts = { communities: lists.communities.length, sites: lists.sites.length };
      el.innerHTML =
        '<div class="rd-tabs" role="tablist" aria-label="Ready to build lists">' +
          ['communities', 'sites'].map(function (t) {
            return '<button type="button" role="tab" id="rdTab-' + t + '" aria-controls="rdPanel" data-rd-tab="' + t + '" aria-selected="' + (ui.tab === t) + '">' + (t === 'communities' ? 'Communities' : 'Sites') + ' (' + counts[t] + ')</button>';
          }).join('') + '</div>' +
        '<div role="tabpanel" id="rdPanel" aria-labelledby="rdTab-' + esc(ui.tab) + '">' +
        '<div class="rd-tools">' +
          '<button type="button" data-rd-mode="suggested" aria-pressed="' + (ui.mode === 'suggested') + '">Suggested order</button>' +
          '<button type="button" data-rd-mode="mine" aria-pressed="' + (ui.mode === 'mine') + '">My order</button>' +
          '<label><input type="checkbox" id="rdOnly"' + (ui.selectedOnly ? ' checked' : '') + '> Show selected only (' + saved.selected.length + ')</label>' +
        '</div>' +
        '<p class="ws-status">Ticked "Daily update" rows are in the daily task email' + (state.reports ? '' : ' (all of them, until you untick one)') + '.</p>' +
        '<p class="ws-status" id="rdSaved">' + (synced ? 'Your order is saved on the site, so it is the same on every device.' : 'Your order is saved in this browser.') + '</p>' +
        (shown.length ? '<ol class="rd-list">' + shown.map(function (it, i) {
          var isPinned = saved.pinned.indexOf(it.key) !== -1;
          var sel = saved.selected.indexOf(it.key) !== -1;
          var nameHtml = ui.tab === 'communities'
            ? '<a class="rd-name" href="developer-brief.html?geoid=' + encodeURIComponent(it.geoid) + '">' + esc(it.name) + '</a>' + (it.row.stage ? ' <span class="rd-pin">' + esc(it.row.stage) + '</span>' : '')
            : '<span class="rd-name" style="font-weight:700">' + esc(it.name) + '</span> <span class="rd-pin">' + esc(it.place || '') + (it.site.homes ? ', ' + esc(it.site.homes) + ' homes' : '') + '</span>';
          return '<li class="rd-row" draggable="true" data-key="' + esc(it.key) + '">' +
            '<div class="rd-pick"><label><input type="checkbox" data-rd-select="' + esc(it.key) + '"' + (sel ? ' checked' : '') + ' aria-label="Select ' + esc(it.name) + '"></label>' + (i + 1) + '</div>' +
            '<div class="rd-main">' + nameHtml + ' <span class="rd-badge rd-' + esc(it.reading) + '">' + esc(LABEL[it.reading]) + '</span>' + (isPinned ? '<span class="rd-pin">pinned</span>' : '') +
              '<p class="rd-why">' + esc(it.why) + '</p>' +
              '<label class="rd-report"><input type="checkbox" data-rd-report="' + esc(it.key) + '"' + (isReported(state, ui.tab, it) ? ' checked' : '') + ' aria-label="Daily update for ' + esc(it.name) + '"> Daily update</label>' +
              '<details><summary>Why, in detail</summary>' + (ui.tab === 'communities' ? communityDetail(it) : answersHtml(it.site)) + '</details></div>' +
            '<div class="rd-move">' +
              '<button type="button" data-rd-up="' + esc(it.key) + '" aria-label="Move ' + esc(it.name) + ' up"' + (isPinned ? ' disabled' : '') + '>&uarr;</button>' +
              '<button type="button" data-rd-down="' + esc(it.key) + '" aria-label="Move ' + esc(it.name) + ' down"' + (isPinned ? ' disabled' : '') + '>&darr;</button>' +
              '<button type="button" data-rd-pin="' + esc(it.key) + '" aria-pressed="' + isPinned + '" aria-label="' + (isPinned ? 'Unpin ' : 'Pin ') + esc(it.name) + ' to the top">' + (isPinned ? 'Unpin' : 'Pin') + '</button>' +
            '</div></li>';
        }).join('') + '</ol>' : '<p class="ws-status">' + (ui.selectedOnly ? 'Nothing selected yet. Tick the box beside a row to select it.' : 'Nothing in this list yet.') + '</p>') +
        '<p class="ws-status" style="margin-top:.6rem">Sites come from the state\'s Prop 123 land banking awards and CHFA tax credit applications since 2023, for the places in your pipeline or with a dossier; land banked only for ownership is left out. Rebuilt at each deploy, last ' + esc(data.generated || 'unknown') +
          '. A reading of ripe, ripening or not yet comes only from a site dossier; every other site shows as on file until one is written.</p></div>';
    }

    function shownKeys(all) { return arrange(lists[ui.tab], state[ui.tab], ui.mode, all ? false : ui.selectedOnly).map(function (it) { return it.key; }); }
    function moveKey(key, delta) {
      var keys = shownKeys().filter(function (k) { return state[ui.tab].pinned.indexOf(k) === -1; });
      state[ui.tab] = move(state[ui.tab], shownKeys(), key, keys.indexOf(key) + delta, shownKeys(true));
      ui.mode = 'mine'; save(); draw();
      refocus(delta < 0 ? 'data-rd-up' : 'data-rd-down', key);
    }

    // A redraw replaces every control, so put focus back on the one just used.
    function refocus(attr, val) {
      var all = el.querySelectorAll('[' + attr + ']');
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute(attr) === val) { all[i].focus(); return; }
      }
    }
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button, input');
      if (!t || !el.contains(t)) return;
      var a;
      if (t.hasAttribute('data-rd-tab')) { ui.tab = t.getAttribute('data-rd-tab') === 'sites' ? 'sites' : 'communities'; draw(); refocus('data-rd-tab', ui.tab); }
      else if (t.hasAttribute('data-rd-mode')) { ui.mode = t.getAttribute('data-rd-mode') === 'mine' ? 'mine' : 'suggested'; draw(); refocus('data-rd-mode', ui.mode); }
      else if (t.hasAttribute('data-rd-up')) moveKey(t.getAttribute('data-rd-up'), -1);
      else if (t.hasAttribute('data-rd-down')) moveKey(t.getAttribute('data-rd-down'), 1);
      else if (t.hasAttribute('data-rd-pin')) { a = t.getAttribute('data-rd-pin'); state[ui.tab].pinned = toggle(state[ui.tab].pinned, a); save(); draw(); refocus('data-rd-pin', a); }
      else if (t.hasAttribute('data-rd-select')) { a = t.getAttribute('data-rd-select'); state[ui.tab].selected = toggle(state[ui.tab].selected, a); save(); draw(); refocus('data-rd-select', a); }
      else if (t.hasAttribute('data-rd-report')) { a = t.getAttribute('data-rd-report'); var row = lists[ui.tab].filter(function (x) { return String(x.key) === a; })[0]; if (row) { state.reports = toggleReport(state, lists, ui.tab, row); save(); } draw(); refocus('data-rd-report', a); }
      else if (t.id === 'rdOnly') { ui.selectedOnly = t.checked; draw(); refocus('id', 'rdOnly'); }
    });
    // Drag to reorder (mouse); the arrow buttons do the same on a phone or keyboard.
    el.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('.rd-row');
      if (!li) return;
      dragKey = li.getAttribute('data-key'); li.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragKey); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ }
    });
    el.addEventListener('dragover', function (e) {
      var li = e.target.closest && e.target.closest('.rd-row');
      if (!li || !dragKey) return;
      e.preventDefault();
      Array.prototype.forEach.call(el.querySelectorAll('.rd-row.over'), function (x) { x.classList.remove('over'); });
      li.classList.add('over');
    });
    el.addEventListener('drop', function (e) {
      var li = e.target.closest && e.target.closest('.rd-row');
      if (!li || !dragKey) return;
      e.preventDefault();
      var keys = shownKeys().filter(function (k) { return state[ui.tab].pinned.indexOf(k) === -1; });
      var to = keys.indexOf(li.getAttribute('data-key'));
      if (to !== -1) { state[ui.tab] = move(state[ui.tab], shownKeys(), dragKey, to, shownKeys(true)); ui.mode = 'mine'; save(); }
      dragKey = null; draw();
    });
    el.addEventListener('dragend', function () { dragKey = null; draw(); });

    el.innerHTML = '<p class="ws-status">Loading the readiness lists…</p>';
    return Promise.all([
      fetchFn(DATA_URL, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      loadState(fetchFn, storage)
    ]).then(function (v) {
      data = v[0];
      if (!data || !Array.isArray(data.sites)) {
        el.innerHTML = '<p class="ws-status">The readiness lists load only on the developer site, which builds them from the private files and the site dossiers at each deploy.</p>';
        return;
      }
      state = v[1].state; synced = v[1].synced;
      lists = build(data, ctx && ctx.pipeline, ctx && ctx.signals);
      var grew = syncReports(state, lists);
      draw();
      if (v[1].unsent || grew) save();
    });
  }

  return { build: build, arrange: arrange, move: move, toggle: toggle, cleanState: cleanState, reportId: reportId, isReported: isReported, toggleReport: toggleReport, syncReports: syncReports, loadState: loadState, saveState: saveState, siteLine: siteLine, mount: mount, RANK: RANK, LABEL: LABEL, QUESTIONS: QUESTIONS, OPEN: OPEN, OPEN_RANK: OPEN_RANK };
});
