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
      if (code.length > MAX_CHARS) throw new Error('The link is too long to be a COHO deal link.');
      var kind = code.charAt(0), bytes = fromB64url(code.slice(1));
      if (kind === 'z') { if (!canSqueeze) throw new Error('This browser cannot read a compressed link. Ask for the deal file instead.'); return squeeze(bytes, 'in'); }
      if (kind === 'j') return bytes;
      throw new Error('This link is not a COHO deal link.');
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
      '<p class="note">Opening makes a new project in this browser. Projects already here are not changed. Reviews are not carried, so check the evidence again before you mark it reviewed. The homes and rents are rerun on the site’s CHFA rent code when you open it.</p>' +
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

  // ---------- the old Deal Calculator's own link (#/open-calc?v=1&...) ----------
  // deal-calculator.html's "Copy link" carries every dc- and pf- box by its id (dc- dropped), a ticked box as 1 or 0,
  // a radio group under its first member's id, the soft sources in tr, and its homes in rentSchedule
  // (js/deal-calculator-share.js _serialize). The Market Analysis page's calculator sends the same, plus subject: the
  // Subject Project its rent schedule is priced from. This turns those into a deal package that #/open-deal opens.
  // As on the old page, a box the link leaves out keeps Financials' starting value; every box the link carries that
  // Financials does not read is named before anything is saved.
  var CALC_MODE_FIELD = { 'mode-rental': 1, 'rate-9': 1, v: 1, subject: 1, rentSchedule: 1, utilityAllowance: 1, inputProvenance: 1, tr: 1, fips: 1, geoid: 1, 'unit-mix-source': 1 };
  var SECTIONS = [/^pf-/, /^stress-/, /^wf-/];
  function calcPackage(q, env) {
    var F = env.F, G = env.G, CB = env.CB, OB = env.OB, DOH = env.DOH;
    q = new URLSearchParams(q.toString());
    var used = {}, notes = [];
    var has = function (k) { return q.has(k); };
    var take = function (k) { used[k] = true; return q.get(k); };
    var json = function (k) { if (!has(k)) return null; try { return JSON.parse(take(k)); } catch (_) { return undefined; } };
    if (has('mode-rental') && take('mode-rental') === 'ownership') throw new Error('This link is a for-sale deal. Financials works rental deals: open it on the Deal Calculator’s for-sale mode.');
    // Cost and operating lines saved before today's layouts load into the lines that hold them, as on the old page.
    var moved = {};
    [['cost', CB && CB.legacyCostFields], ['op', OB && OB.legacyOperatingFields]].forEach(function (x) {
      if (!x[1]) return;
      var legacy = x[1](function (k) { return q.has(k) ? q.get(k) : null; }) || {};
      Object.keys(legacy).forEach(function (k) { q.set(k, legacy[k]); moved[x[0]] = true; });
    });
    // The old lines those moved from are read, by the move.
    var lineIds = {}; F.costIds().forEach(function (id) { lineIds[id] = true; });
    q.forEach(function (v, k) {
      var m = /^cost-([a-z_]+?)(-basis|-eligible|-used)?$/.exec(k);
      if ((moved.cost && m && !lineIds[m[1]]) || (moved.op && k === 'opex')) used[k] = true;
    });
    var d = F.emptyDraft();
    var checks = {}; (F.CHECKBOX_IDS || []).forEach(function (id) { checks[id] = true; });
    var box = function (v) { return v === '1' || v === 'true' ? 'yes' : ''; };
    // The old page's "Copy link" carries every box that is not blank (and every list and ticked box), so a typed box
    // the link leaves out was blank on the sender's page: it opens blank here too, not at Financials' starting value.
    // Only boxes the old page has (js/deal-calculator-input-registry.js) are read that way; a link made before a box
    // existed opens that box blank, where the old page would show its default.
    // The Market Analysis page's calculator has no pro forma, stress test or partnership boxes, so its link carries
    // none of them, while deal-calculator.html's always carries some (their starting values are not blank). A
    // section with no box in the link was not on the sender's page: its boxes keep Financials' starting values. For
    // the pro forma and partnership these are the engine's own values when the boxes are missing; the stress test
    // starts at a 12-month lease-up, where the engine on that page tests none (its stress table has no slider).
    // A link from the quick estimate (from=quick) holds only the boxes the estimate sets, not every box the old page
    // had: a box it leaves out was never typed, so it keeps Financials' starting value (stakeholder review, 19 Nov
    // 2026: read as blank, the loan maturity opened empty and the funding gap read "Not yet").
    var fromQuick = q.get('from') === 'quick';
    if (has('from')) take('from');
    var R = env.registry, keys = [];
    q.forEach(function (v, k) { keys.push(k); });
    var absent = SECTIONS.filter(function (re) { return !keys.some(function (k) { return re.test(k); }); });
    var onPage = function (k) { return !absent.some(function (re) { return re.test(k); }); };
    F.FIELDS.forEach(function (i) {
      var k = i.id.replace(/^dc-/, '');
      if (i.id === 'dc-credit') { if (has('rate-9')) d.fields[i.id] = Number(take('rate-9')) === 0.04 ? '4' : '9'; return; }
      if (!has(k)) { if (!fromQuick && !checks[i.id] && !i.options && R && R.get(i.id) && onPage(k)) d.fields[i.id] = ''; return; }
      var v = String(take(k));
      // A yes-or-no list here can be a ticked box on the old page (dc-auto-noi), which the link sends as 1 or 0.
      var yesNo = i.options && i.options.some(function (o) { return o[0] === 'yes'; }) && i.options.some(function (o) { return o[0] === 'no'; });
      if (yesNo && /^(1|0|true|false)$/.test(v)) v = v === '1' || v === 'true' ? 'yes' : 'no';
      d.fields[i.id] = checks[i.id] ? box(v) : v;
    });
    F.costIds().forEach(function (id) {
      var k = 'cost-' + id;
      if (has(k)) d.costs[id] = String(take(k));
      if (has(k + '-basis')) d.basis[id] = String(take(k + '-basis'));
      if (has(k + '-eligible')) d.parts[id] = String(take(k + '-eligible'));
      if (has(k + '-used')) d.used[id] = String(take(k + '-used'));
    });
    var op = false;
    OB.LINE_TEMPLATE.forEach(function (t) { if (has('op-' + t.id)) { d.opLines[t.id] = String(take('op-' + t.id)); op = true; } });
    OB.INCOME_TEMPLATE.forEach(function (t) { if (has('op-income-' + t.id)) { d.opIncome[t.id] = String(take('op-income-' + t.id)); op = true; } });
    if (op) {
      d.opExample = false;
      OB.LINE_TEMPLATE.forEach(function (t) { if (!has('op-' + t.id)) d.opLines[t.id] = ''; });
      OB.INCOME_TEMPLATE.forEach(function (t) { if (!has('op-income-' + t.id)) d.opIncome[t.id] = ''; });
    }
    // Soft sources: program:amount:mode:rate:term:cash flow %:accrue:priority:type:maturity:IO:federal:DOH:activity:status:state.
    if (has('tr')) {
      var rows = String(take('tr')).split(';').filter(Boolean).slice(0, 12).map(function (s, i) {
        var x = s.split(':'), t = i === 0 ? F.seedTranche() : F.addedTranche(), before = t.program;
        var put = function (k, v) { if (v != null) t[k] = v; };
        put('program', x[0]); put('amount', x[1]); if (x[2]) t.mode = x[2]; put('rate', x[3]); put('term', x[4]); put('cashflowPayPct', x[5]); put('priority', x[7]);
        if (t.program !== before) t.fundSource = F.FEDERAL_FUND_DEFAULTS[t.program] || '';
        if (DOH && t.program !== before) DOH.programChanged(t);
        t.loanType = x[8] !== undefined ? x[8] : x[6] === 'accrued' ? 'accrue_defer' : x[5] !== undefined && x[5] !== '' && Number(x[5]) < 100 ? 'cash_flow' : 'amortizing';
        t.maturity = x[9] !== undefined ? x[9] : x[4]; t.ioYears = x[10] !== undefined ? x[10] : '2';
        if (x[11] !== undefined) t.fundSource = x[11];
        if (DOH) { DOH.fill(t); if (x[12] !== undefined) t.doh = x[12]; if (x[13] !== undefined) t.activity = x[13]; if (x[14]) t.status = x[14]; if (x[15]) t.stateRequest = x[15]; }
        return t;
      });
      if (rows.length) d.tranches = rows;
    }
    // The homes: the unit grid, or the Market Analysis rent schedule priced from the subject the link carries.
    var fips = has('county-select') ? String(q.get('county-select')) : '';
    var schedule = json('rentSchedule'), subject = json('subject'), allowance = json('utilityAllowance');
    if (subject === undefined || (subject != null && (typeof subject !== 'object' || !Array.isArray(subject.unit_mix)))) { notes.push('The link’s Subject Project could not be read, so its homes and rents are not carried.'); subject = null; }
    var scheduled = schedule && schedule.mode === 'schedule';
    var manualMix = null, attachments = [];
    if (subject) attachments.push({ kind: 'rent-schedule', label: 'Homes and rents from the link', snapshot: { subject: subject, result: null }, state: 'attached', origin: { openedFrom: 'deal-calculator link' }, attachedAt: new Date().toISOString() });
    if (!scheduled) {
      var g = G.blank(fips), gchecks = { 'dc-achievable-cap': 1 };
      Object.keys(g).forEach(function (id) {
        var k = id.replace(/^dc-/, '');
        if (!has(k)) return;
        g[id] = /^dc-chk-/.test(id) || gchecks[id] ? box(take(k)) : String(take(k));
      });
      d.grid = g;
      manualMix = { fromScenarioId: null, convertedAt: new Date().toISOString(), cells: [], countyFips: g['dc-county-select'] || fips };
      if (!subject && allowance && allowance.applied) notes.push('The sender’s utility allowance is not in the link, so restricted homes are priced at the full limit until you save the homes with their allowance in Homes and affordability.');
    } else if (!subject) {
      notes.push('Its homes come from a Market Analysis rent schedule the link does not carry, so no homes are set. Enter them in Homes and affordability.');
    }
    used['county-select'] = true;
    var unread = [];
    q.forEach(function (v, k) { if (!used[k] && !CALC_MODE_FIELD[k] && unread.indexOf(k) < 0) unread.push(k); });
    var geoid = has('geoid') && /^\d{2,7}$/.test(q.get('geoid')) ? q.get('geoid') : fips ? fips : null;
    var name = env.countyName(fips);
    var overrides = { financialsDraft: d };
    if (manualMix) overrides.manualMix = manualMix;
    return {
      pkg: { format: P.PACKAGE, version: P.PACKAGE_VERSION, exportedAt: '',
        project: { name: 'Deal from the Deal Calculator' + (name ? ', ' + name : ''), kind: 'development', jurisdiction: geoid ? { geoid: geoid, name: geoid === fips && name ? name : (name || geoid) } : null },
        scenario: { name: scheduled ? 'Rent schedule' : 'Unit grid', site: null }, attachments: attachments, overrides: overrides },
      homes: scheduled ? (subject ? 'schedule' : 'none') : 'grid', linkRows: scheduled ? schedule.rows || [] : null, notes: notes, unread: unread
    };
  }
  // The rerun schedule's homes, as the old page lists them in rentSchedule, to compare with the link's.
  function scheduleRows(pkg) {
    var att = pkg.attachments.filter(function (a) { return a.kind === 'rent-schedule'; })[0];
    var C = global.ChfaRentLimits, sub = att && att.snapshot.subject;
    if (!att || !C || !C.dealMixFromSchedule) return [];
    var mix = C.dealMixFromSchedule(att.snapshot.result, { countyFips: sub.county_fips, regime: 'chfa_lihtc' });
    return mix && mix.available ? (mix.restrictedRows || []).concat(mix.marketRows || []) : [];
  }
  function sameRows(a, b) {
    // The old page marks a market-rate row with tier "market"; the shared mix leaves its tier out.
    var key = function (r) { var m = r.tier == null || r.tier === 'market'; return [m ? 'market' : r.tier, r.bedrooms, r.units, m ? r.rent : r.contractRent].join('|'); };
    var A = (a || []).map(key).sort(), B = (b || []).map(key).sort();
    return A.length > 0 && A.join(';') === B.join(';');
  }
  function calcEnv() {
    return { registry: global.DealCalculatorInputRegistry, F: global.LabFinancials, G: global.LabCalcGrid, CB: global.DealCostBasis, OB: global.DealOperatingBudget, DOH: global.LabCalcDoh,
      countyName: function (fips) { var c = chfa && (chfa.counties || []).filter(function (x) { return x.fips === fips; })[0]; return c ? (/county$/i.test(c.county_name) ? c.county_name : c.county_name + ' County') : ''; } };
  }
  var registry = null;
  function calcView(params) {
    var back = '<a class="back-link" href="#/projects">← Projects</a>';
    var head = back + '<h1>Open a deal from the Deal Calculator</h1><p class="lede">See what the calculator’s link holds before anything is saved.</p>';
    if (!params.toString() || params.get('v') !== '1') return head + '<p class="callout" role="alert">This address holds no Deal Calculator deal. Use the calculator’s “Copy link”, or “Continue in Financials” on Market Analysis.</p>' + picker();
    // A for-sale deal goes to the for-sale screen with the same link, which fills the boxes it has and names the rest.
    if (params.get('mode-rental') === 'ownership') return head + '<p class="callout" role="alert">This link is a for-sale deal. Financials works rental deals, so it opens on Homes for sale, with the same inputs.</p>' +
      '<div class="actions"><a class="button-link" href="#/sale-deal?' + esc(params.toString()) + '">Open it on Homes for sale</a></div>';
    loadChfa();
    if (chfaError) return head + '<p class="callout">' + esc(chfaError) + '</p>';
    if (!global.LabFinancials || !global.DealCostBasis || !global.DealOperatingBudget || !global.LabCalcGrid) return head + '<p role="status">Loading the calculator…</p>';
    if (!chfa) return head + '<p role="status">Loading the CHFA rent table…</p>';
    if (!global.DealCalculatorInputRegistry && registry !== 'failed') {
      if (!registry) {
        registry = 'loading';
        var el = document.createElement('script');
        el.src = VENDOR + 'js/deal-calculator-input-registry.js';
        el.onload = function () { registry = 'ready'; Shell.render(); };
        el.onerror = function () { registry = 'failed'; Shell.render(); };
        document.body.appendChild(el);
      }
      return head + '<p role="status">Loading the calculator’s list of boxes…</p>';
    }
    if (registry === 'failed') return head + '<p class="callout">The Deal Calculator’s list of boxes did not load, so the link cannot be read.</p>';
    var key = 'calc:' + params.toString();
    if (!waiting[key]) {
      try {
        var made = calcPackage(params, calcEnv());
        waiting[key] = { pkg: made.pkg, how: 'share-link', calc: made, problem: P.packageProblem(made.pkg) };
      } catch (e) { waiting[key] = { problem: e.message }; }
    }
    var w = waiting[key];
    if (w.problem) return head + '<p class="callout" role="alert">' + esc(w.problem) + '</p>';
    var c = w.calc;
    var homes = c.homes === 'grid' ? 'Homes: the unit grid from the link.' : c.homes === 'schedule' ? 'Homes: the Market Analysis rent schedule, rerun on the site’s CHFA rent code when you open it.' : 'Homes: none set.';
    var extra = '<p>' + esc(homes) + '</p>' + c.notes.map(function (n) { return '<p class="callout">' + esc(n) + '</p>'; }).join('') +
      (c.unread.length ? '<details class="calc-unread"><summary>' + esc(String(c.unread.length)) + ' boxes in the link that Financials does not use</summary><p class="note">They stay on the Deal Calculator. ' + esc(c.unread.join(', ')) + '.</p></details>' : '');
    return head + preview(w, key).replace('<div class="actions">', extra + '<div class="actions">');
  }
  Shell.views['open-calc'] = calcView;

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
      // From a member card on the public site (financials.js carryNote): the same deal link, opened on the member site.
      if (act === 'deal-to-members') {
        var mp;
        var cant = function () { b.insertAdjacentHTML('afterend', ' <span role="status">This browser could not make the link. Use \u201cDownload deal file\u201d on the one-page view and open it on the member site.</span>'); b.disabled = true; };
        try { mp = P.exportScenario(b.dataset.project, b.dataset.scenario); } catch (e) { return cant(); }
        var page = String(location.pathname || '').split('/').pop() || 'index.html';
        encode(mp).then(function (code) { location.href = global.LabShell.MEMBER_SITE + page + '#/open-deal?d=' + code; }, cant);
        return;
      }
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
          // A Deal Calculator link carries the old page's priced rows, not a schedule result: compare with those.
          if (w.calc && rerun.has) rerun.matched = w.calc.linkRows ? sameRows(w.calc.linkRows, scheduleRows(pkgCopy)) : undefined;
          var made = P.importScenario(pkgCopy, w.how, rerun.has ? rerun.matched : undefined);
          delete waiting[b.dataset.key];
          location.hash = rerun.has || w.calc ? '#/financials/' + made.projectId + '/' + made.scenarioId : '#/project/' + made.projectId;
        } catch (e) {
          w.problem = e.message; Shell.render();
        }
      }
    });
    document.addEventListener('change', function (ev) {
      var input = ev.target;
      if (!input || input.dataset.action !== 'deal-file-pick' || !input.files || !input.files[0]) return;
      var f = input.files[0];
      if (f.size > MAX_CHARS) { waiting.file = { problem: 'That file is too large to be a COHO deal file.' }; location.hash = '#/open-deal?from=file'; Shell.render(); return; }
      waiting.file = { reading: true };
      f.text().then(function (t) {
        var pkg = JSON.parse(t);
        waiting.file = { pkg: pkg, how: 'deal-file', problem: P.packageProblem(pkg) };
      }).catch(function () { waiting.file = { problem: 'That file could not be read as a COHO deal file.' }; })
        .then(function () { if (location.hash === '#/open-deal?from=file') Shell.render(); else location.hash = '#/open-deal?from=file'; });
    });
  }

  // Where an opened deal came from, and whether its homes and rents matched the rerun, for Financials to say.
  function openedNote(p) {
    var o = p && p.openedFrom;
    if (!o) return '';
    var from = (o.how === 'share-link' ? 'a share link' : 'a deal file') + ' on ' + Shell.when(o.openedAt);
    return o.scheduleMatched === false
      ? '<p class="callout" role="status">Opened from ' + esc(from) + '. Its homes and rents differ from a rerun on the site’s CHFA rent code, so the rerun is what you see. Ask the sender which CHFA table they used.</p>'
      : '<p class="note">Opened from ' + esc(from) + (o.scheduleMatched ? '. Its homes and rents were rerun on the site’s CHFA rent code and match the deal as shared.' : '.') + '</p>';
  }

  global.LabDealFile = { calcPackage: calcPackage, sameRows: sameRows, encode: encode, decode: decode, panel: panel, picker: picker, openedNote: openedNote, fileName: fileName, rerunSchedule: rerunSchedule, printFull: printFull };
})(typeof window !== 'undefined' ? window : globalThis);
