// Deal files, share links and the full print view for Financials (calculator batch A).
// A deal is one scenario: its place, site, saved evidence and the visitor's own changes (LabProjects.exportScenario).
// - Share link: the deal, compressed, in the address after #/open-deal?d=. Nothing is sent to a server.
// - Deal file: the same deal as a .json file to email or keep.
// - Opening either shows what it holds first. Only "Open as a new project" saves anything, and it makes a new
//   project; projects already in the browser are never changed. Reviews are not carried.
// - The rent schedule is rerun on open with the public site's ChfaRentLimits.rentSchedule from the carried inputs, so
//   the homes and rents shown come from the engine, not from the file. Financials reruns the Deal Engine as always.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var P = global.LabProjects;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var MAX_CHARS = 5 * 1024 * 1024;
  var LONG_LINK = 8000;
  var KIND_LABEL = { 'place-reference': 'Place', 'site-reference': 'Site record', 'market-snapshot': 'Market area', 'rent-schedule': 'Homes and rents', financials: 'Saved Financials run' };

  // ---------- encoding ----------
  function toB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    var bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function squeeze(bytes, kind) {
    var stream = new Blob([bytes]).stream().pipeThrough(kind === 'in' ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  var canSqueeze = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  // "z" marks a compressed link, "j" plain JSON for a browser without compression streams.
  function encode(pkg) {
    var bytes = new TextEncoder().encode(JSON.stringify(pkg));
    if (!canSqueeze) return Promise.resolve('j' + toB64url(bytes));
    return squeeze(bytes, 'out').then(function (z) { return 'z' + toB64url(z); });
  }
  function decode(code) {
    return Promise.resolve().then(function () {
      code = String(code || '');
      if (code.length > MAX_CHARS) throw new Error('The link is too long to be a lab deal.');
      var kind = code.charAt(0), bytes = fromB64url(code.slice(1));
      if (kind === 'z') { if (!canSqueeze) throw new Error('This browser cannot read a compressed link. Ask for the deal file instead.'); return squeeze(bytes, 'in'); }
      if (kind === 'j') return bytes;
      throw new Error('This link is not a lab deal link.');
    }).then(function (bytes) { return JSON.parse(new TextDecoder().decode(bytes)); });
  }
  function shareUrl(code) { return location.href.split('#')[0] + '#/open-deal?d=' + code; }

  function slug(s) { return String(s || 'deal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deal'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fileName(pkg) { return 'coho-deal-' + slug(pkg.project.name + ' ' + pkg.scenario.name) + '-' + today() + '.json'; }

  // ---------- rent schedule rerun ----------
  var chfa = null, chfaError = null;
  function loadChfa() {
    if (chfa || chfaError) return;
    fetch(VENDOR + 'data/chfa-income-rent-limits-2026.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (t) { chfa = t; Shell.render(); })
      .catch(function () { chfaError = 'The CHFA rent table did not load, so the deal cannot be checked or opened.'; Shell.render(); });
  }
  // The carried schedule is replaced by a fresh run of the same inputs. Returns whether the carried one matched.
  function rerunSchedule(pkg) {
    var att = pkg.attachments.filter(function (a) { return a.kind === 'rent-schedule'; })[0];
    if (!att) return { has: false };
    var subject = att.snapshot && att.snapshot.subject;
    if (!subject || typeof subject !== 'object') throw new Error('The homes and rents in this deal have no inputs to rerun.');
    var fresh = JSON.parse(JSON.stringify(global.ChfaRentLimits.rentSchedule(subject, { chfaTable: chfa })));
    var matched = JSON.stringify(fresh) === JSON.stringify(att.snapshot.result);
    att.snapshot = { subject: subject, result: fresh };
    att.label = (fresh.scheduledUnits || 0) + ' homes, ' + (fresh.totals && fresh.totals.unavailableReason ? 'not complete' : 'priced');
    return { has: true, matched: matched, units: fresh.scheduledUnits || 0 };
  }

  // ---------- what is waiting to be opened ----------
  // key -> { pkg, how, problem }. A link is read once per address; a file waits under "file".
  var waiting = {};
  function read(key, how, getPkg) {
    if (waiting[key]) return waiting[key];
    waiting[key] = { reading: true };
    getPkg().then(function (pkg) {
      waiting[key] = { pkg: pkg, how: how, problem: P.packageProblem(pkg) };
    }, function (e) {
      waiting[key] = { problem: e && e.message && !/JSON|atob|decod|invalid/i.test(e.message) ? e.message : 'This link or file could not be read. It may have been cut short.' };
    }).then(function () { Shell.render(); });
    return waiting[key];
  }

  function picker() {
    return '<div class="deal-open-file"><label for="deal-file-input"><strong>Open a deal file</strong></label>' +
      '<p class="note">A file saved from Financials with “Download deal file”. It is read in this browser only.</p>' +
      '<input id="deal-file-input" type="file" accept=".json,application/json" data-action="deal-file-pick"></div>';
  }

  function preview(w, key) {
    var pkg = w.pkg, pr = pkg.project, sc = pkg.scenario;
    var rows = pkg.attachments.map(function (a) {
      return '<li><strong>' + esc(KIND_LABEL[a.kind] || a.kind) + '</strong>: ' + esc(a.label || '') +
        (a.state === 'stale' ? ' <span class="status">out of date' + (a.staleReason ? ': ' + esc(a.staleReason) : '') + '</span>' : '') +
        (a.attachedAt ? ' <span class="note">saved ' + esc(Shell.when(a.attachedAt)) + '</span>' : '') + '</li>';
    }).join('');
    var draft = pkg.overrides && pkg.overrides.financialsDraft;
    var entered = draft && draft.costs ? Object.keys(draft.costs).filter(function (k) { return draft.costs[k] !== '' && draft.costs[k] != null; }).length : 0;
    return '<div class="deal-preview"><h2>' + esc(pr.name) + ', ' + esc(sc.name) + '</h2>' +
      '<p>' + esc(pr.jurisdiction ? pr.jurisdiction.name : 'No place set') + (sc.site ? ' · ' + esc(sc.site.label) : '') +
      (pkg.exportedAt ? ' · shared ' + esc(Shell.when(pkg.exportedAt)) : '') + '</p>' +
      (rows ? '<ul class="deal-contents">' + rows + '</ul>' : '<p>No saved evidence.</p>') +
      (draft ? '<p>Financials inputs: ' + esc(String(entered)) + ' cost lines entered' + (draft.fields && draft.fields['dc-tdc'] ? ', total development cost $' + esc(Number(draft.fields['dc-tdc']).toLocaleString('en-US')) : '') + '.</p>' : '<p>No Financials inputs yet.</p>') +
      '<p class="note">Opening makes a new project in this browser. Projects already here are not changed. Reviews are not carried, so check the evidence again before you mark it reviewed. The homes and rents are rerun on the public site’s CHFA rent code when you open it.</p>' +
      '<div class="actions"><button type="button" data-action="deal-open" data-key="' + esc(key) + '">Open as a new project</button>' +
      '<a class="button-link secondary" href="#/projects">Not now</a></div></div>';
  }

  function openView(params) {
    var back = '<a class="back-link" href="#/projects">← Projects</a>';
    var head = back + '<h1>Open a shared deal</h1><p class="lede">See what a share link or deal file holds before anything is saved.</p>';
    var d = params.get('d'), key = d ? 'link:' + d : params.get('from') === 'file' ? 'file' : null;
    var w = key === 'file' ? waiting.file : key ? read(key, 'share-link', function () { return decode(d); }) : null;
    if (!w) return head + picker();
    if (w.reading) return head + '<p role="status">Reading the deal…</p>';
    if (w.problem) return head + '<p class="callout" role="alert">' + esc(w.problem) + '</p>' + picker();
    loadChfa();
    if (chfaError) return head + '<p class="callout">' + esc(chfaError) + '</p>';
    if (!chfa) return head + preview(w, key).replace('data-action="deal-open"', 'data-action="deal-open" disabled') + '<p role="status">Loading the CHFA rent table…</p>';
    return head + preview(w, key);
  }
  Shell.views['open-deal'] = openView;

  // ---------- Financials panel ----------
  function panel(p, s) {
    return '<section class="deal-share no-print" id="fin-share" aria-labelledby="fin-share-h"><h2 id="fin-share-h">Share, hand off or print</h2>' +
      '<p class="note">A link or file carries this scenario’s place, homes and rents, and every Financials input. Whoever opens it gets their own copy; changes on either side stay apart. Nothing is sent to a server.</p>' +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="deal-share" data-project="' + esc(p.projectId) + '" data-scenario="' + esc(s.scenarioId) + '">Copy share link</button>' +
      '<button type="button" class="button-link secondary" data-action="deal-download" data-project="' + esc(p.projectId) + '" data-scenario="' + esc(s.scenarioId) + '">Download deal file</button>' +
      '<button type="button" class="button-link secondary" data-action="fin-print-full">Print the full result or save as PDF</button></div>' +
      '<p class="note" role="status" data-role="deal-share-status"></p></section>';
  }

  function status(text) { var el = document.querySelector('[data-role="deal-share-status"]'); if (el) el.innerHTML = text; }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // The whole Financials page, every section open, on paper. The print stylesheet drops the menus and buttons.
  function printFull() {
    var main = document.getElementById('main');
    var shut = [];
    Array.prototype.forEach.call(main.querySelectorAll('details'), function (el) { if (!el.open) { shut.push(el); el.open = true; } });
    var stamp = document.createElement('p');
    stamp.className = 'print-stamp';
    stamp.textContent = 'Printed ' + today() + '. Calculated by the cohoanalytics.com Deal Calculator (public code ' + (global.LAB_PIN || '') + '). Screening figures, not a lender’s or investor’s underwriting.';
    main.insertBefore(stamp, main.firstChild);
    document.body.classList.add('print-full');
    var done = function () {
      document.body.classList.remove('print-full');
      shut.forEach(function (el) { el.open = false; });
      if (stamp.parentNode) stamp.parentNode.removeChild(stamp);
      global.removeEventListener('afterprint', done);
    };
    global.addEventListener('afterprint', done);
    global.print();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('button[data-action^="deal-"], button[data-action="fin-print-full"]');
      if (!b) return;
      var act = b.dataset.action;
      if (act === 'fin-print-full') return printFull();
      if (act === 'deal-share' || act === 'deal-download') {
        var pkg;
        try { pkg = P.exportScenario(b.dataset.project, b.dataset.scenario); } catch (e) { return status(esc(e.message)); }
        if (act === 'deal-download') { download(fileName(pkg), JSON.stringify(pkg, null, 1)); return status('Deal file saved: ' + esc(fileName(pkg)) + '.'); }
        encode(pkg).then(function (code) {
          var url = shareUrl(code);
          var box = '<input type="text" readonly class="deal-link" aria-label="Share link" value="' + esc(url) + '">';
          var warn = url.length > LONG_LINK ? ' The link is ' + url.length.toLocaleString('en-US') + ' characters; some email programs cut long links, so send the deal file if it does not open.' : '';
          var copied = function (ok) { status((ok ? 'Link copied.' : 'Copy this link:') + warn + box); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { copied(true); }, function () { copied(false); });
          else copied(false);
        }, function () { status('The link could not be made in this browser. Download the deal file instead.'); });
        return;
      }
      if (act === 'deal-open') {
        var w = waiting[b.dataset.key];
        if (!w || !w.pkg || w.problem || !chfa) return;
        try {
          var pkgCopy = JSON.parse(JSON.stringify(w.pkg));
          var rerun = rerunSchedule(pkgCopy);
          var made = P.importScenario(pkgCopy, w.how, rerun.has ? rerun.matched : undefined);
          delete waiting[b.dataset.key];
          location.hash = rerun.has ? '#/financials/' + made.projectId + '/' + made.scenarioId : '#/project/' + made.projectId;
        } catch (e) {
          w.problem = e.message; Shell.render();
        }
      }
    });
    document.addEventListener('change', function (ev) {
      var input = ev.target;
      if (!input || input.dataset.action !== 'deal-file-pick' || !input.files || !input.files[0]) return;
      var f = input.files[0];
      if (f.size > MAX_CHARS) { waiting.file = { problem: 'That file is too large to be a lab deal file.' }; location.hash = '#/open-deal?from=file'; Shell.render(); return; }
      waiting.file = { reading: true };
      f.text().then(function (t) {
        var pkg = JSON.parse(t);
        waiting.file = { pkg: pkg, how: 'deal-file', problem: P.packageProblem(pkg) };
      }).catch(function () { waiting.file = { problem: 'That file could not be read as a lab deal file.' }; })
        .then(function () { if (location.hash === '#/open-deal?from=file') Shell.render(); else location.hash = '#/open-deal?from=file'; });
    });
  }

  // Where an opened deal came from, and whether its homes and rents matched the rerun, for Financials to say.
  function openedNote(p) {
    var o = p && p.openedFrom;
    if (!o) return '';
    var from = (o.how === 'share-link' ? 'a share link' : 'a deal file') + ' on ' + Shell.when(o.openedAt);
    return o.scheduleMatched === false
      ? '<p class="callout" role="status">Opened from ' + esc(from) + '. Its homes and rents differ from a rerun on the public site’s CHFA rent code, so the rerun is what you see. Ask the sender which CHFA table they used.</p>'
      : '<p class="note">Opened from ' + esc(from) + (o.scheduleMatched ? '. Its homes and rents were rerun on the public site’s CHFA rent code and match the deal as shared.' : '.') + '</p>';
  }

  global.LabDealFile = { encode: encode, decode: decode, panel: panel, picker: picker, openedNote: openedNote, fileName: fileName, rerunSchedule: rerunSchedule, printFull: printFull };
})(typeof window !== 'undefined' ? window : globalThis);
