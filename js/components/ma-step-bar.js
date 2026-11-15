/*
 * The seven-step bar on deal-market-analysis.html: the same bar, in the same place, as on every other step
 * (paul, 15 Nov 2026). hub/step-bar.js draws it; this file says which step this page is and which place it is on.
 *
 * The place is the one the tool is showing, read the way js/components/jurisdiction-url-context.js reads it: the
 * address (?fips=, then ?geoid=), else the open project, else the chosen county. So the bar, the tool and the place
 * row above the page name the same place, and the bar's links carry it. With none of those, the bar shows the
 * place kept from the other steps, or asks for one.
 *
 * The name is the one kept for the same code; with none kept, the tool's own name for it ("Fruita (city)" reads
 * "Fruita", as the place row writes it), which for a town in the address comes once the place list has loaded.
 *
 * The block is an empty <div id="maStepBar"> written by scripts/build-market-analysis-hub.mjs.
 */
(function () {
  'use strict';
  var el = document.getElementById('maStepBar');
  var Step = window.LabStep;
  if (!el || !Step || !Step.mount) return;
  var GEO = /^08\d{3}(\d{2})?$/;
  var AT = 'deal-market-analysis.html';
  var ok = function (x) { return GEO.test(String(x || '')); };
  var clean = function (s) { return String(s || '').replace(/\s*\((?:city|town|CDP)\)/i, '').trim().slice(0, 80); };
  function context() {
    try { var C = window.JurisdictionUrlContext; return C && C.resolveSync ? C.resolveSync() : null; } catch (_) { return null; }
  }
  // The name, only when the bar has none yet for this code: a name kept from the other steps is the one they show.
  var named = false;
  function nameFrom(g, ctx) {
    if (named || !ctx || [ctx.geoid, ctx.fips].indexOf(g) < 0) return;
    var w = Step.working && Step.working();
    if (w && w.geoid === g && w.label && w.label !== g) { named = true; return; }
    var label = clean(ctx.displayName);
    if (!label || label === g) return;
    named = true;
    Step.mount(el, AT, g, label);
  }

  var fromAddress = '';
  try {
    var q = new URLSearchParams(location.search);
    fromAddress = [q.get('fips'), q.get('geoid')].filter(ok)[0] || '';
  } catch (_) {}
  if (fromAddress) {
    // Drawn at once; named once the address context has read the place list.
    Step.mount(el, AT, fromAddress);
    document.addEventListener('jurisdiction-url-context:resolved', function (ev) { nameFrom(fromAddress, ev && ev.detail); });
    document.addEventListener('DOMContentLoaded', function () { nameFrom(fromAddress, context()); });
    return;
  }
  // No place in the address: the open project or the chosen county, which the tool's deferred scripts read, so the
  // bar is drawn once they have run.
  function draw() {
    var ctx = context(), g = ctx && [ctx.geoid, ctx.fips].filter(ok)[0];
    if (g) { Step.mount(el, AT, g); nameFrom(g, ctx); }
    else Step.mount(el, AT);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw);
  else draw();
})();
