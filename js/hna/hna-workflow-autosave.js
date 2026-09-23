/**
 * hna-workflow-autosave.js — the Housing Needs Assessment counts as done once
 * it has been read, not once a button has been pressed.
 *
 * WorkflowState marks the 'hsa' step complete only when the page's snapshot is
 * saved (housing-needs-assessment.html: saveHnaToProject), and until 2026-09-23
 * the only thing that saved it was the "Save to project" button. A reader who
 * opened the HNA for a jurisdiction, read it, and followed the page's own
 * "Next step → Deal Calculator" link was then told on the calculator: "Earlier
 * Step Incomplete — Housing Needs Assessment hasn't been completed yet. Go to
 * Housing Needs Assessment." Verified on production for Fruita, following the
 * HNA's own link. The jurisdiction step already auto-completes from the URL
 * context and the Opportunity Finder is treated as always complete; this
 * gives the HNA the same courtesy, on evidence: the headline stats have
 * rendered real values for the selected geography.
 *
 * Saves once per geography (the pill text), again if the geography changes,
 * and on click of any next-step link if the stats are ready — so the save
 * lands before navigation even if the observer has not fired yet.
 *
 * No DOM assumptions beyond ids: init({ save, document, statIds }) is what the
 * test drives.
 */
(function (global) {
  'use strict';

  var PLACEHOLDERS = { '': 1, '—': 1, '–': 1, '-': 1, 'Loading': 1, '…': 1, '...': 1, 'N/A': 1 };
  var NEXT_STEP_HREF = /^(market-analysis|deal-calculator|hna-scenario-builder|recommendation)\.html/;

  function isReal(text) {
    var v = (text || '').replace(/\s+/g, ' ').trim();
    return !PLACEHOLDERS[v];
  }

  function init(opts) {
    opts = opts || {};
    var doc = opts.document || global.document;
    var save = opts.save;
    var statIds = opts.statIds || ['statPop', 'statRent', 'statRentBurden'];
    var pillId = opts.pillId || 'geoContextPill';
    if (!doc || typeof save !== 'function') return null;

    var savedFor = null;

    function geoKey() {
      var pill = doc.getElementById(pillId);
      return pill ? pill.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function ready() {
      for (var i = 0; i < statIds.length; i++) {
        var el = doc.getElementById(statIds[i]);
        if (!el || !isReal(el.textContent)) return false;
      }
      return true;
    }
    function attempt(reason) {
      if (!ready()) return false;
      var key = geoKey();
      if (key && key === savedFor) return false;
      var ok = false;
      try { ok = !!save(reason); } catch (e) { ok = false; }
      if (ok) savedFor = key;
      return ok;
    }

    // 1. When the stats render (or re-render for another geography).
    if (global.MutationObserver) {
      var mo = new global.MutationObserver(function () { attempt('render'); });
      var targets = statIds.concat([pillId]);
      for (var t = 0; t < targets.length; t++) {
        var node = doc.getElementById(targets[t]);
        if (node) mo.observe(node, { childList: true, characterData: true, subtree: true });
      }
    }
    // 2. On the way out through a next-step link, if the stats are ready.
    doc.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (NEXT_STEP_HREF.test(a.getAttribute('href') || '') && ready()) {
        try { if (save('next-step')) savedFor = geoKey(); } catch (_) {}
      }
    }, true);

    attempt('init');
    return { attempt: attempt, ready: ready, isReal: isReal };
  }

  global.HnaWorkflowAutosave = { init: init, isReal: isReal };
})(typeof window !== 'undefined' ? window : globalThis);
