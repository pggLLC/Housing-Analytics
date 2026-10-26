/**
 * member-calculator.js — the member bar on the Deal Calculator, on the member
 * site only (js/navigation.js loadMemberCalculator loads it there, never on
 * cohoanalytics.com).
 *
 * Shows who is signed in, links back to the member home, signs out, and saves
 * the deal on screen to the signed-in member's own deals (/api/deals,
 * coho-backend), where Deal workbook and Submittal review list it. The public
 * page's "Save to Project" keeps a copy in this browser only.
 *
 * A save is the same version a Submittal review import of "Export JSON" makes
 * (SubmittalReview.fromCalculatorExport), plus the share link, so a 4% or
 * non-CHFA deal still opens in the workbook.
 *
 * The save controls sit in a dock fixed to the bottom of the screen, with the
 * calculator's current funding gap, so they stay in view while the member works
 * down the page. A save with no gap warns first and says why there is none.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.MemberCalculator in the browser;
 * module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MemberCalculator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API = '/api/deals';
  var SAVE_LABEL = 'Save to workbook';
  var IDENTITY = '/cdn-cgi/access/get-identity'; // Cloudflare Access: the signed-in email
  var BLANK_DEAL = { mix: {}, place: '', election: '40-60', applicant: '', gpRole: '', supportive: false, rehab: false, existingCredit: false,
    subsidyExpiring: false, otherActiveCredits: null, stateCredits: null, creditRequested: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // snap: the calculator's Export JSON snapshot. c: SubmittalReview.fromCalculatorExport(snap).
  // Returns { error } or the POST body for /api/deals.
  // deal: a saved deal's id to add this as its next version (compared side by side in Submittal review), or empty for a new deal.
  // note: what changed in this run, in the member's words; without one the label names the cost and homes.
  function saveBody(snap, c, name, deal, note) {
    if (!snap || !c) return { error: 'The Deal Calculator has no result to save yet.' };
    if (c.error) return { error: c.error };
    var d = JSON.parse(JSON.stringify(BLANK_DEAL));
    d.mix = c.mix; d.election = c.election; d.calc4 = !c.nine;
    d.calcRegime = c.nine && !c.chfa ? c.regime : null;
    var data = { deal: d, claims: {}, thresholds: {}, documents: [], engine: {}, calculator: null, url: snap.url, savedFrom: 'deal-calculator' };
    // Same rule as a Submittal review import: only a 9% CHFA LIHTC deal carries its model results into the 9% score.
    if (c.nine && c.chfa) {
      data.calculator = { query: c.query, exportedAt: c.exportedAt, nine: true, election: c.election, mix: Object.assign({}, c.mix), stale: false };
      data.engine = c.engine;
      d.creditRequested = c.requested; d.stateCredits = c.stateAnnual;
    }
    var gap = c.engine && typeof c.engine.fundingGap === 'number' ? c.engine.fundingGap : null;
    var tdc = c.engine && typeof c.engine.totalDevelopmentCost === 'number' ? c.engine.totalDevelopmentCost : null;
    var homes = Object.keys(c.mix || {}).reduce(function (s, k) { return s + (c.mix[k] || 0); }, 0);
    var bits = [];
    if (tdc != null) bits.push('$' + (tdc / 1e6).toFixed(1) + 'M cost');
    if (homes) bits.push(homes + ' homes');
    var auto = bits.length ? 'Calculator: ' + bits.join(', ') : 'From the Deal Calculator';
    var label = String(note || '').trim().slice(0, 120) || auto;
    var body = { name: name, label: label, data: data, summary: { score: null, gap: gap, lane: '' } };
    if (deal) body.deal = deal;
    return body;
  }

  function money(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }

  // rec: the calculator's fundingGap output record ({ value, unavailableReason }); mode: its deal mode.
  // Returns { kind: 'gap' | 'zero' | 'blank' | 'sale' | 'wait', text } for the dock's gap line.
  function gapLine(rec, mode) {
    if (mode === 'ownership') return { kind: 'sale', text: 'For-sale deal: the workbook saves rental tax credit deals.' };
    if (!rec) return { kind: 'wait', text: 'Funding gap: waiting for the calculator.' };
    if (typeof rec.value === 'number') {
      // The engine reports a surplus as $0, so $0 means sources cover the cost.
      return rec.value > 0 ? { kind: 'gap', text: 'Funding gap ' + money(rec.value) } : { kind: 'zero', text: 'Funding gap $0: sources cover the cost' };
    }
    return { kind: 'blank', text: 'No funding gap yet: ' + (String(rec.unavailableReason || '').trim() || 'the calculator could not work one out.') };
  }

  var STYLE =
    '.mc-bar{max-width:1400px;margin:.75rem auto 0;padding:.6rem 18px;display:flex;flex-wrap:wrap;gap:.5rem .75rem;align-items:center;' +
    'border:1px solid var(--border);border-radius:var(--radius-sm,8px);background:var(--card);font-size:var(--small,.9rem)}' +
    '.mc-bar>a,.mc-bar button{min-height:44px;display:inline-flex;align-items:center;font-weight:600}' +
    '.mc-bar a{color:var(--accent);font-weight:600}.mc-bar>a{padding:0 .25rem}' +
    '.mc-who{color:var(--muted);flex:1 1 12rem}' +
    // The dock: fixed to the bottom so Save and the gap stay in view; body padding keeps the page's end clear of it.
    '#mcDock.mc-dock{position:fixed;left:0;right:0;bottom:0;z-index:900;padding:.5rem 16px calc(.5rem + env(safe-area-inset-bottom,0px));' +
    'background:var(--card,#fff);border-top:1px solid var(--border);box-shadow:0 -2px 10px rgba(0,0,0,.12);font-size:var(--small,.9rem)}' +
    '.mc-dock-in{max-width:1400px;margin:0 auto;display:flex;flex-wrap:wrap;gap:.4rem .75rem;align-items:center}' +
    '.mc-gap{margin:0;font-weight:700;color:var(--text-strong,var(--text));flex:0 1 auto}' +
    '.mc-gap[data-kind="blank"],.mc-gap[data-kind="sale"]{color:var(--warn,#8a5a00);font-weight:600;flex:1 1 100%}' +
    '@media print{#mcDock{display:none}body.mc-docked{padding-bottom:0 !important}}' +
    '.mc-more{display:none;padding:0 .75rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer}' +
    '@media (max-width:640px){.mc-more{display:inline-flex}.mc-dock:not(.mc-open) .mc-extra{display:none}' +
    '.mc-gap,.mc-gap[data-kind]{flex:1 1 0;min-width:0}.mc-save{flex:1 1 100%}.mc-save input{flex:1 1 0;min-width:0}.mc-save select,#mcNote{flex:1 1 100%;max-width:none}' +
    '.mc-save select{order:-2}#mcNote{order:-1}}' +
    '.mc-save{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;flex:1 1 30rem}' +
    '.mc-save input,.mc-save select{min-height:44px;flex:1 1 10rem;max-width:24rem;padding:0 .6rem;border:1px solid var(--border);border-radius:6px;font:inherit;background:var(--bg);color:var(--text)}' +
    '.mc-save button,.mc-more{min-height:44px;font-weight:600}.mc-save #mcSave{padding:0 1rem;border:0;border-radius:6px;background:var(--accent);color:var(--on-accent, #fff);cursor:pointer}' +
    '.mc-save #mcSave[disabled]{opacity:.6;cursor:wait}' +
    '.mc-status{flex:1 1 100%;margin:0}.mc-status:empty{display:none}';

  function mount(doc, win) {
    if (doc.getElementById('mcBar')) return;
    var main = doc.getElementById('main-content');
    if (!main) return;
    if (!doc.getElementById('mcStyle')) {
      var st = doc.createElement('style'); st.id = 'mcStyle'; st.textContent = STYLE; doc.head.appendChild(st);
    }
    var bar = doc.createElement('section');
    bar.id = 'mcBar'; bar.className = 'mc-bar'; bar.setAttribute('aria-label', 'Member site');
    bar.innerHTML =
      '<a href="developer.html">← Member site</a>' +
      '<span class="mc-who" id="mcWho">Signed in to the member site.</span>' +
      '<a href="/logout" id="mcOut">Sign out</a>';
    main.insertBefore(bar, main.firstChild);
    // A div, not a section: the site theme makes every section's background transparent.
    var dock = doc.createElement('div');
    dock.id = 'mcDock'; dock.className = 'mc-dock'; dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Save this deal');
    dock.innerHTML = '<div class="mc-dock-in">' +
      '<p class="mc-gap" id="mcGap" aria-live="polite"></p>' +
      '<button type="button" class="mc-more" id="mcMore" aria-expanded="false" aria-controls="mcDeal mcNote">Version</button>' +
      '<div class="mc-save"><label for="mcDeal" style="position:absolute;left:-9999px">Save as</label>' +
      '<select id="mcDeal" class="mc-extra"><option value="">New deal</option></select>' +
      '<label for="mcName" style="position:absolute;left:-9999px">Deal name</label>' +
      '<input type="text" id="mcName" maxlength="120" placeholder="Deal name, e.g. site and town">' +
      '<label for="mcNote" style="position:absolute;left:-9999px">What changed (optional)</label>' +
      '<input type="text" id="mcNote" class="mc-extra" maxlength="120" placeholder="What changed (optional), e.g. construction +$2M">' +
      '<button type="button" id="mcSave">' + SAVE_LABEL + '</button></div>' +
      '<p class="mc-status" id="mcStatus" role="status" aria-live="polite"></p></div>';
    doc.body.appendChild(dock);
    var $ = function (id) { return doc.getElementById(id); };
    function say(html) { $('mcStatus').innerHTML = html; fit(); }
    // Keep the end of the page clear of the dock. The dark-mode button and the watchlist chip also sit at the
    // bottom right, so they are lifted above it by the dock's measured height.
    var lift = doc.createElement('style'); lift.id = 'mcDockLift'; doc.head.appendChild(lift);
    function fit() {
      var h = dock.offsetHeight || 0;
      doc.body.classList.add('mc-docked');
      doc.body.style.paddingBottom = h ? h + 'px' : '';
      lift.textContent = h ? '@media screen{body.mc-docked .dark-mode-toggle{bottom:' + (h + 20) + 'px}' +
        'body.mc-docked #coho-watchlist-panel{bottom:' + (h + 12) + 'px !important}}' : '';
    }
    $('mcMore').addEventListener('click', function () {
      var open = dock.classList.toggle('mc-open');
      $('mcMore').setAttribute('aria-expanded', open ? 'true' : 'false'); fit();
    });
    if (win.addEventListener) win.addEventListener('resize', fit);
    // The calculator's current gap, read again after every recalculation.
    var gapNow = { kind: 'wait' }, warned = false;
    function readGap() {
      var dc = win.__DealCalc, rec = null, mode = null;
      try { rec = dc && dc.getOutputRecords ? dc.getOutputRecords().fundingGap || null : null; } catch (_) { rec = null; }
      var m = doc.querySelector('input[name="dc-deal-mode"]:checked'); mode = m ? m.value : null;
      gapNow = gapLine(rec, mode);
      $('mcGap').textContent = gapNow.text; $('mcGap').setAttribute('data-kind', gapNow.kind);
      if (warned) { warned = false; $('mcSave').textContent = SAVE_LABEL; }
      fit();
    }
    doc.addEventListener('deal-calc:updated', readGap);
    readGap();

    win.fetch(IDENTITY, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.email) $('mcWho').textContent = 'Signed in as ' + j.email + '. Saved deals stay on your own sign-in.'; })
      .catch(function () { /* keep the plain line */ });
    // Your saved deals, so a revised run saves as the next version of one and Submittal review can compare them.
    function addDeal(id, name) {
      var sel = $('mcDeal'), o = doc.createElement('option');
      o.value = id; o.textContent = 'New version of ' + name; sel.appendChild(o);
    }
    // Opened from Deal workbook's "Change it in the Deal Calculator": that deal is picked, so a save adds its next version.
    var back = /(?:^#|&)save-to=([a-z0-9-]+)/.exec((win.location && win.location.hash) || '');
    win.fetch(API, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        ((j && j.deals) || []).forEach(function (x) { addDeal(x.id, x.name); });
        // Only when nothing was picked or typed while the list loaded.
        var sel = $('mcDeal'), o = back && !sel.value && !$('mcName').value ? sel.querySelector('option[value="' + back[1] + '"]') : null;
        if (o) { sel.value = back[1]; $('mcName').value = o.textContent.replace(/^New version of /, ''); say('Saving adds a new version of "' + esc($('mcName').value) + '".'); }
      })
      .catch(function () { /* New deal still works */ });
    $('mcDeal').addEventListener('change', function () {
      var o = $('mcDeal').selectedOptions[0];
      if (o && o.value) $('mcName').value = o.textContent.replace(/^New version of /, '');
    });
    $('mcOut').addEventListener('click', function () {
      try { win.sessionStorage.removeItem('ib-auth-v1'); } catch (_) { /* storage blocked */ }
    });

    $('mcSave').addEventListener('click', function () {
      var name = $('mcName').value.trim();
      if (!name) { say('Give the deal a name first.'); $('mcName').focus(); return; }
      // A save with no gap is allowed, but only after the member has seen why there is none.
      if (gapNow.kind === 'blank' && !warned) {
        warned = true; $('mcSave').textContent = 'Save without a gap';
        say('This version has no funding gap to save; the line above says why. Fix that and the gap appears there, or click again to save without one.');
        return;
      }
      var share = win.__DealCalcShare, review = win.SubmittalReview;
      if (!share || !share.buildSnapshot || !review) { say('The calculator is still loading. Try again in a moment.'); return; }
      var snap;
      try { snap = share.buildSnapshot(); } catch (e) { snap = null; }
      if (snap && snap.dealMode === 'ownership') { say('This is a for-sale deal. The workbook covers rental tax credit deals.'); return; }
      var body = saveBody(snap, snap ? review.fromCalculatorExport(snap) : null, name, $('mcDeal').value, $('mcNote').value);
      if (body.error) { say(esc(body.error)); return; }
      var btn = $('mcSave'); btn.disabled = true; say('Saving…');
      win.fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) {
          // The next save of this run becomes its next version.
          if (!$('mcDeal').value && j.deal) { addDeal(j.deal, name); $('mcDeal').value = j.deal; }
          $('mcNote').value = ''; // a note describes one version
          if (warned) { warned = false; $('mcSave').textContent = SAVE_LABEL; }
          say('Saved "' + esc(name) + '" ' + new Date(j.meta && j.meta.at || Date.now()).toLocaleString() +
            '. Open it in <a href="developer-deal-workbook.html">Deal workbook</a>, or compare versions in <a href="developer-submittal-review.html">Submittal review</a>. Saving again adds a new version.');
        }, function (e) { say('Not saved: the member site answered ' + esc(e.message) + '. Nothing was lost on this page; try again.'); })
        .then(function () { btn.disabled = false; });
    });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(document, window); });
    else mount(document, window);
  }

  return { saveBody: saveBody, gapLine: gapLine, mount: mount, API: API, saveLabel: SAVE_LABEL };
});
