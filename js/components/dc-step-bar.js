/*
 * The seven-step bar on deal-calculator.html: the same bar, in the same place, as on every other step (hub/step-bar.js
 * draws it; js/components/ma-step-bar.js does the same on Market Analysis). This file says which step this page is
 * and which place it is on.
 *
 * One place: the county the calculator is using. That is the county picked in the quick start or the full
 * calculator (both write #dc-county-select), else the place the other steps kept. Picking a county here names it in
 * the bar, as Market Analysis does, and takes down the "Choose a jurisdiction first" notice
 * (js/components/workflow-next-action.js), which is not true here: the calculator draws every figure from the county
 * it is given. No project is created; the place is kept the way the other new pages keep it (LabStep.setWorking).
 *
 * paul, 25 Nov 2026, build plan item 10 (fresh-eyes fix 1: the calculator in the site's own shell, one place picker).
 */
(function () {
  'use strict';
  var el = document.getElementById('dcStepBar');
  var Step = window.LabStep;
  if (!el || !Step || !Step.mount) return;
  // The bar's own address for this step (hub/step-bar.js PATH): a page is "here" when it mounts with that address.
  var AT = '#/deal-calculator';
  var COUNTY = /^08\d{3}$/;

  function picked() {
    var sel = document.getElementById('dc-county-select') || document.getElementById('dq-county');
    if (!sel || !COUNTY.test(sel.value || '')) return null;
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? String(opt.textContent).split(' — ')[0].trim() : '';
    return name ? { geoid: sel.value, label: name } : null;
  }

  // The notice the calculator does not need once it has a county; it comes back if the county is cleared.
  function notice(hasCounty) {
    Array.prototype.forEach.call(document.querySelectorAll('.wf-next-action--skipped'), function (n) {
      n.style.display = hasCounty ? 'none' : '';
    });
  }

  // The "Analyzing" banner above the title names the same county the bar now names. It stays only while it has
  // something the bar does not say: why a town's figures are its county's (HUD sets limits by county).
  function banner() {
    var b = document.getElementById('dcJurisdictionBanner'), sub = document.getElementById('dcJurisdictionSub');
    if (b) b.style.display = sub && /HUD sets/.test(sub.textContent || '') ? '' : 'none';
  }

  // Which county a kept town is in, from the place the page resolved (js/components/jurisdiction-url-context.js).
  var placeCounty = {}, resolved = null;
  document.addEventListener('jurisdiction-url-context:resolved', function (ev) {
    var c = ev && ev.detail;
    resolved = c || null;
    if (c && c.placeGeoid && COUNTY.test(c.countyFips || '')) placeCounty[c.placeGeoid] = c.countyFips;
  });
  // Only a county someone chose becomes the kept place: one picked in this page's county lists, or one the address
  // or a shared link names. The county the page fills in by itself on opening, from the old pages' saved project or
  // county, is shown but never kept, so it cannot replace the member's place (member live check, 26 Nov 2026: El Paso
  // over Fruita). That fill is the first county set, matching what the page resolved from those old keys.
  var chosen = false, first = true;
  function selfFilled(value) {
    var c = resolved;
    return !!(c && (c.source === 'workflow' || c.source === 'sitestate') && c.countyFips === value);
  }
  function fromLink() {
    if (window.__DealCalcSharedCounty) return true;
    try { var q = new URLSearchParams(location.search); return !!(q.get('geoid') || q.get('fips')); } catch (e) { return false; }
  }

  var shown = '';
  function draw() {
    var p = picked();
    notice(!!p);
    banner();
    var w = Step.working && Step.working();
    // The kept place stays the bar's place while the calculator is on it, or on the county it is in (Fruita and
    // Mesa County): the bar names the town, and the kept place is not narrowed or widened to the county.
    var same = !!(w && p && (w.geoid === p.geoid || placeCounty[w.geoid] === p.geoid));
    var key = p ? (same ? w.geoid : p.geoid) : '';
    if (shown && key === shown) return;
    if (p && same) { shown = key; Step.mount(el, AT, w.geoid, w.label); return; }
    // (The bar keeps any place it is given, so a county the page filled in by itself is not given to it.)
    if (p && (chosen || fromLink())) { shown = key; Step.mount(el, AT, p.geoid, p.label); return; }
    if (p) { if (shown !== '-') { shown = '-'; Step.mount(el, AT, w && w.geoid, w && w.label); } return; }
    if (!shown) { shown = '-'; Step.mount(el, AT, w && w.geoid, w && w.label); }
  }

  draw();
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t && (t.id === 'dc-county-select' || t.id === 'dq-county')) {
      var auto = first && t.id === 'dc-county-select' && selfFilled(t.value);
      first = false;
      if (!auto) chosen = true;
      setTimeout(draw, 0);
    }
  });
  // The county arrives late when it comes from a shared link, a deal file or the place kept from other steps; the
  // notice is drawn late too. Check again once things have loaded, and when the notice appears.
  window.addEventListener('load', function () { setTimeout(draw, 0); setTimeout(draw, 1500); });
  if (window.MutationObserver) {
    var main = document.getElementById('main-content');
    if (main) new MutationObserver(function () { if (Array.prototype.some.call(document.querySelectorAll('.wf-next-action--skipped'), function (n) { return n.style.display !== 'none'; }) && picked()) notice(true); banner(); })
      .observe(main, { childList: true, subtree: true });
  }
})();
