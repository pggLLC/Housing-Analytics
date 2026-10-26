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
  var IDENTITY = '/cdn-cgi/access/get-identity'; // Cloudflare Access: the signed-in email
  var BLANK_DEAL = { mix: {}, place: '', election: '40-60', applicant: '', gpRole: '', supportive: false, rehab: false, existingCredit: false,
    subsidyExpiring: false, otherActiveCredits: null, stateCredits: null, creditRequested: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // snap: the calculator's Export JSON snapshot. c: SubmittalReview.fromCalculatorExport(snap).
  // Returns { error } or the POST body for /api/deals.
  // deal: a saved deal's id to add this as its next version (compared side by side in Submittal review), or empty for a new deal.
  function saveBody(snap, c, name, deal) {
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
    var body = { name: name, label: 'From the Deal Calculator', data: data, summary: { score: null, gap: gap, lane: '' } };
    if (deal) body.deal = deal;
    return body;
  }

  var STYLE =
    '.mc-bar{max-width:1400px;margin:.75rem auto 0;padding:.6rem 18px;display:flex;flex-wrap:wrap;gap:.5rem .75rem;align-items:center;' +
    'border:1px solid var(--border);border-radius:var(--radius-sm,8px);background:var(--card);font-size:var(--small,.9rem)}' +
    '.mc-bar>a,.mc-bar button{min-height:44px;display:inline-flex;align-items:center;font-weight:600}' +
    '.mc-bar a{color:var(--accent);font-weight:600}.mc-bar>a{padding:0 .25rem}' +
    '.mc-who{color:var(--muted);flex:1 1 12rem}' +
    '.mc-save{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;flex:1 1 100%}' +
    '.mc-save input,.mc-save select{min-height:44px;flex:1 1 12rem;max-width:24rem;padding:0 .6rem;border:1px solid var(--border);border-radius:6px;font:inherit;background:var(--bg);color:var(--text)}' +
    '.mc-save button{padding:0 1rem;border:0;border-radius:6px;background:var(--accent);color:var(--on-accent, #fff);cursor:pointer}' +
    '.mc-save button[disabled]{opacity:.6;cursor:wait}' +
    '.mc-status{flex:1 1 100%;margin:0}';

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
      '<a href="/logout" id="mcOut">Sign out</a>' +
      '<div class="mc-save"><label for="mcDeal" style="position:absolute;left:-9999px">Save as</label>' +
      '<select id="mcDeal"><option value="">New deal</option></select>' +
      '<label for="mcName" style="position:absolute;left:-9999px">Deal name</label>' +
      '<input type="text" id="mcName" maxlength="120" placeholder="Deal name, e.g. site and town">' +
      '<button type="button" id="mcSave">Save to workbook</button></div>' +
      '<p class="mc-status" id="mcStatus" role="status" aria-live="polite"></p>';
    main.insertBefore(bar, main.firstChild);
    var $ = function (id) { return doc.getElementById(id); };
    function say(html) { $('mcStatus').innerHTML = html; }

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
      var share = win.__DealCalcShare, review = win.SubmittalReview;
      if (!share || !share.buildSnapshot || !review) { say('The calculator is still loading. Try again in a moment.'); return; }
      var snap;
      try { snap = share.buildSnapshot(); } catch (e) { snap = null; }
      if (snap && snap.dealMode === 'ownership') { say('This is a for-sale deal. The workbook covers rental tax credit deals.'); return; }
      var body = saveBody(snap, snap ? review.fromCalculatorExport(snap) : null, name, $('mcDeal').value);
      if (body.error) { say(esc(body.error)); return; }
      var btn = $('mcSave'); btn.disabled = true; say('Saving…');
      win.fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) {
          // The next save of this run becomes its next version.
          if (!$('mcDeal').value && j.deal) { addDeal(j.deal, name); $('mcDeal').value = j.deal; }
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

  return { saveBody: saveBody, mount: mount, API: API };
});
