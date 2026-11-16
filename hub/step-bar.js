// The seven-step bar from a town to a deal, the working place it names, and the slim line that rides at the top once
// the bar scrolls away. Moved out of site/hna.js (15 Nov 2026) so every step page draws the same bar: the hub views
// call LabStep.path, and the full Market Analysis (the public site's deal-market-analysis.html, built by its
// scripts/build-market-analysis-hub.mjs) calls LabStep.mount. Loads after shell.js and before hna.js.
(function (global) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  // The live site's address (a port sets LAB_LIVE to its own root, as site/places.js reads it).
  var LIVE = function () { return global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/'; };
  // A lab route as this page should link it: in a port, LAB_PORT points a route at the hub page that carries it, so
  // the bar works the same on a page outside the hubs.
  var go = function (h) {
    var P = global.LAB_PORT, to = P && P.href && /^#\//.test(h || '') ? P.href(h) : null;
    return to || h;
  };

  // The live site's seven steps from a town to a deal recommendation (js/components/workflow-progress.js keeps the
  // same order and names). Only "you are here" is marked: the lab records no progress, because visiting a page is
  // not evidence that a step is done. Every step is a page that draws this same bar (paul, 15 Nov: the bar was
  // missing on Scenarios and drawn differently on Market Analysis); qa/journey-steps.js walks all seven.
  var PATH = [
    ['Jurisdiction', 'Pick a town or county', '#/places'], ['Opportunity Finder', 'Places that fit 4% or 9% deals', '#/finder'],
    ['Needs Assessment', 'Need by income level', 'here'], ['Market Analysis', 'Demand and rents for a site', null, 'deal-market-analysis.html'],
    ['Scenarios', 'Change the forecast', '#/places/scenario'], ['Deal Calculator', 'Sources, uses and the gap', '#/deal-calculator'],
    ['Recommendation', 'What the data says, and how sure', '#/recommendation']];
  // The product a developer chose on the live site (js/components/workflow-progress.js getProduct: the open
  // project's choice, else this browser's). For-sale homes walk the same seven slots, but four of them are rental
  // tools, so they open the ownership tools instead; a project with rental and for-sale homes keeps the rental steps
  // and lists the ownership tools under the bar. The step a page is stays as it is. (Codex P2 on HA #2878: the full
  // Market Analysis's old rail did this, and the shared bar had dropped it.) Keyed by step, counted from 0.
  var PRODUCT_KEY = 'coho:guided-product';
  var PRODUCTS = ['lihtc-rental', 'middle-income-rental', 'for-sale', 'mixed'];
  var OWN = {
    1: ['Ownership Need', 'Who can afford to buy here', 'hna-what-to-do.html#affordable-ownership-need-section'],
    3: ['For-Sale Market Study', 'Buyer demand, capture and resale', 'for-sale-market-study.html'],
    4: ['Land Value', 'What the land is worth', 'land-value.html'],
    5: ['For-Sale Feasibility', 'The subsidy gap per home', 'deal-calculator.html?mode=ownership']
  };
  function product() {
    try {
      var WS = global.WorkflowState, p = WS && typeof WS.get === 'function' ? WS.get('product') : null;
      if (PRODUCTS.indexOf(p) > -1) return p;
    } catch (e) { /* no project */ }
    try { var k = global.localStorage.getItem(PRODUCT_KEY); return PRODUCTS.indexOf(k) > -1 ? k : null; } catch (e) { return null; }
  }
  // A live-site page with the place in its address, before any #section.
  function withPlace(href, g) {
    if (!g) return href;
    var h = href.indexOf('#'), hash = h < 0 ? '' : href.slice(h), base = h < 0 ? href : href.slice(0, h);
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'geoid=' + g + hash;
  }
  // The working place (paul 11-11: the bar has the menu he wants, but the pick must carry from page to page, and
  // you should always know which place you are on). The last place a page opened on is kept in this browser; a
  // place in the address always wins and becomes the working place.
  var WORK_KEY = 'coho-lab-working';
  // The member site's "Working on" line (js/whitepaper/member-place.js) keeps the same place under MEMBER_KEY as
  // {geoid, name}. The two are kept in step (paul, 13 Nov: a place picked on a member page left these pages at
  // "No place picked yet"): every write goes to both with the time it was made, and a read takes the newer one.
  // A value with no time counts as oldest; on a tie the member line's place wins. On the public site nothing
  // reads MEMBER_KEY; it stays in that browser like WORK_KEY.
  var MEMBER_KEY = 'coho-member-place';
  var GEO = /^08\d{3}(\d{2})?$/;
  function kept(key) {
    try {
      var x = JSON.parse(global.localStorage.getItem(key) || 'null');
      if (!x || typeof x !== 'object' || !GEO.test(String(x.geoid || ''))) return null;
      var at = Number(x.at);
      return { geoid: String(x.geoid), label: String((key === WORK_KEY ? x.label : x.name) || '').slice(0, 80), at: isFinite(at) && at > 0 ? at : 0 };
    } catch (e) { return null; }
  }
  function nameFor(geoid) {
    var cat = global.LabShell && global.LabShell.catalog && global.LabShell.catalog();
    var e = cat && cat.entries.filter(function (x) { return x.geoid === geoid; })[0];
    if (!e && global.LabPlaces && global.LabPlaces.entryFor) e = global.LabPlaces.entryFor(geoid);
    return e && e.label ? String(e.label) : '';
  }
  function working() {
    var a = kept(MEMBER_KEY), b = kept(WORK_KEY);
    var w = a && b ? (b.at > a.at ? b : a) : (a || b);
    if (!w) return null;
    // A place picked by its code alone (a member link) is named here when the catalog knows it.
    var label = w.label && w.label !== w.geoid ? w.label : nameFor(w.geoid) || w.geoid;
    return { geoid: w.geoid, label: label };
  }
  function setWorking(geoid, label) {
    if (!GEO.test(String(geoid || ''))) return null;
    // A page that knows only the code (the full Market Analysis has no place list) keeps the name already kept for it.
    var was = working(), known = was && was.geoid === geoid && was.label !== geoid ? was.label : '';
    var w = { geoid: geoid, label: label || nameFor(geoid) || known || geoid };
    var at = Date.now();
    try {
      global.localStorage.setItem(WORK_KEY, JSON.stringify({ geoid: w.geoid, label: w.label, at: at }));
      global.localStorage.setItem(MEMBER_KEY, JSON.stringify({ geoid: w.geoid, name: w.label === w.geoid ? '' : w.label, at: at }));
    } catch (err) { /* storage off: the address still carries it */ }
    return w;
  }
  function clearWorking() {
    try { global.localStorage.removeItem(WORK_KEY); global.localStorage.removeItem(MEMBER_KEY); } catch (e) { /* nothing kept */ }
  }
  // A step's lab route on the working place w ({geoid, label}). The bar and the menus (site/nav.js) both open a step
  // here, so the two cannot drift. The place goes as g on every lab step, so a page that forwards to the live site
  // opens on it (QA/QC F01, 12 Nov: the Deal Calculator step opened on a county saved earlier in the browser).
  function placed(route, w) {
    if (!w || !route) return route;
    var g = encodeURIComponent(w.geoid);
    if (route === '#/finder') return '#/finder?q=' + encodeURIComponent(w.label) + '&g=' + g;
    if (route === '#/recommendation' || route === '#/deal-calculator' || route === '#/places/scenario') return route + '?g=' + g;
    return route;
  }
  // away: drawn off the HNA, so the HNA step links to its picker; at: the lab route that is "you are here" instead;
  // geoid: the place this page is on (it becomes the working place). Without one, the bar uses the working place,
  // and offers Clear; a page that is about one place offers only Change.
  function stepPath(away, at, geoid) {
    var w = geoid ? setWorking(geoid) || { geoid: geoid, label: geoid } : working();
    var g = w ? encodeURIComponent(w.geoid) : '';
    var prod = product();
    var hereAt = -1;
    var items = PATH.map(function (s, i) {
      // The step this page is: matched on the step's own route (or, for a live-site step, its file) before the
      // Needs Assessment step is pointed elsewhere, so a page is never two steps at once.
      var isAt = !!at && (s[2] === at || (!s[2] && s[3] === at));
      // For-sale homes: the ownership tool, on the live site, unless this page is that step.
      if (prod === 'for-sale' && OWN[i] && !isAt) s = [OWN[i][0], OWN[i][1], null, OWN[i][2]];
      if (away && s[2] === 'here') s = [s[0], s[1], w ? '#/place/' + g : '#/places'];
      if (isAt) s = [s[0], s[1], 'here'];
      // Every lab step opens on the working place.
      if (w && s[2] && s[2] !== 'here') s = [s[0], s[1], placed(s[2], w)];
      var here = s[2] === 'here', live = !s[2];
      if (here) hereAt = i;
      var label = '<span class="sp-n" aria-hidden="true">' + (i + 1) + '</span><span class="sp-title">' + esc(s[0]) + (live ? ' <span class="live-tag">live site ↗</span>' : '') + '</span>' +
        '<span class="sp-text">' + esc(s[1]) + '</span>' + (here ? '<span class="sp-here">You are here</span>' : '');
      return '<li class="' + (here ? 'sp-current' : '') + '"' + (here ? ' aria-current="step"' : '') + '>' +
        (here ? '<span class="sp-box">' + label + '</span>' : '<a class="sp-box" href="' + esc(live ? LIVE() + withPlace(s[3], g) : go(s[2])) + '">' + label + '</a>') + '</li>';
    });
    // Rental and for-sale homes: the ownership tools, listed under the bar.
    var also = prod === 'mixed' ? '<p class="sp-also">For the for-sale homes, also: ' + Object.keys(OWN).map(function (i) {
      return '<a href="' + esc(LIVE() + withPlace(OWN[i][2], g)) + '">' + esc(OWN[i][0]) + '</a> (step ' + (+i + 1) + ')';
    }).join(' · ') + '</p>' : '';
    // One line says where you are: the step, and the place, with a way to change or clear it. The same line rides
    // at the top of the screen once the bar scrolls away (bindStepBar).
    var step = hereAt > -1 ? '<span class="sp-of">Step ' + (hereAt + 1) + ' of ' + PATH.length + ': <strong>' + esc(PATH[hereAt][0]) + '</strong></span>' : '';
    var place = '<span class="sp-place">' + (w ? 'Working on: <strong>' + esc(w.label) + '</strong> <a href="' + esc(go('#/places')) + '">Change</a>' + (geoid ? '' : ' <button type="button" class="sp-clear" data-sp-clear="1">Clear</button>')
      : 'No place picked yet. <a href="' + esc(go('#/places')) + '">Pick a town or county</a>') + '</span>';
    var where = step + place;
    return '<nav class="step-path" aria-label="From a town to a deal, seven steps"><p class="sp-where">' + where +
      '<button type="button" class="sp-all" data-sp-all="1" aria-expanded="false">All 7 steps</button></p><ol>' + items.join('') + '</ol>' + also + '</nav>' +
      '<div class="sp-sticky" data-sp-sticky="1" hidden><p class="sp-where">' + where + '<a class="sp-up" href="#" data-sp-up="1">Steps</a>' +
      '<button type="button" class="sp-toggle" data-sp-fold="1" aria-expanded="' + (spFolded() ? 'false' : 'true') + '">' + (spFolded() ? 'Show steps' : 'Hide') + '</button></p></div>';
  }
  // Once per page load: Clear, All 7 steps, and the slim bar that shows while the step bar is scrolled out of view.
  // On a phone the slim line and the tab row can be folded away (paul, 12 Nov); the choice holds for the visit.
  function spFolded() { return !!(global.document && global.document.documentElement.classList.contains('sp-folded')); }
  function bindStepBar() {
    if (bindStepBar.done || !global.document) return;
    bindStepBar.done = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-sp-clear], [data-sp-all], [data-sp-up], [data-sp-fold]');
      if (!t) return;
      if (t.hasAttribute('data-sp-fold')) {
        var fold = !spFolded();
        document.documentElement.classList.toggle('sp-folded', fold);
        t.setAttribute('aria-expanded', fold ? 'false' : 'true'); t.textContent = fold ? 'Show steps' : 'Hide';
        check(); return;
      }
      if (t.hasAttribute('data-sp-clear')) { clearWorking(); if (global.LabShell) global.LabShell.render(); else if (mount.el) mount(mount.el, mount.at); }
      else if (t.hasAttribute('data-sp-all')) { var nav = t.closest('.step-path'), on = !nav.classList.contains('sp-open'); nav.classList.toggle('sp-open', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); t.textContent = on ? 'Fewer steps' : 'All 7 steps'; }
      else { ev.preventDefault(); var bar = document.querySelector('.step-path'); if (bar) bar.scrollIntoView({ block: 'start' }); }
    });
    // On scroll (one check a frame): the slim bar shows once the step bar's bottom has passed the top of the screen.
    var queued = false;
    function check() {
      queued = false;
      var root = document.documentElement, head = document.querySelector('.site-header');
      // The main navigation sticks at the top; everything else that sticks sits under it.
      var hdr = head && global.getComputedStyle(head).position === 'sticky' ? Math.ceil(head.getBoundingClientRect().height) : 0;
      root.style.setProperty('--hdr-h', hdr + 'px');
      var bar = document.querySelector('.step-path'), slim = document.querySelector('[data-sp-sticky]');
      if (slim) slim.hidden = !bar || bar.getBoundingClientRect().bottom > hdr;
      // Anything else that sticks to the top (the calculator's result strip, the tab row) sits under the slim bar, never behind it.
      var sp = slim && !slim.hidden ? Math.ceil(slim.getBoundingClientRect().height) : 0;
      root.style.setProperty('--sp-top', sp + 'px');
      // The tab row's height counts toward where a jump lands only while it is stuck under the bars.
      var tabs = document.querySelector('#main .tabs'), tr = tabs && global.getComputedStyle(tabs).position === 'sticky' ? tabs.getBoundingClientRect() : null;
      root.style.setProperty('--tabs-h', tr && tr.top <= hdr + sp + 1 ? Math.ceil(tr.height) + 'px' : '0px');
      // The calculator's result strip sticks under the bars too; a field moved into view by keyboard clears it as well.
      var live = global.document.querySelector('.quick-live'), lr = live && live.getClientRects().length ? live.getBoundingClientRect() : null;
      root.style.setProperty('--live-h', lr && lr.top <= hdr + sp + 1 ? Math.ceil(lr.height) + 'px' : '0px');
    }
    // Keyboard focus never lands under the sticky header, step line, tabs or result strip (WCAG 2.4.11): a field the
    // browser leaves half-covered is scrolled down to just below them. The page region itself is not a field: the
    // shell moves focus to it when the address changes, and a pick on the same page keeps the reader's place.
    global.document.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (!t || t.id === 'main' || !t.getBoundingClientRect || (t.closest && t.closest('.site-header, [data-sp-sticky], .step-path, #main .tabs, .quick-live'))) return;
      var cs = global.getComputedStyle(global.document.documentElement), px = function (n) { return parseFloat(cs.getPropertyValue(n)) || 0; };
      var cover = px('--hdr-h') + px('--sp-top') + px('--tabs-h') + px('--live-h');
      var r = t.getBoundingClientRect();
      if (cover && r.top < cover + 4) global.scrollBy({ top: r.top - cover - 8, behavior: 'instant' });
    });
    global.addEventListener('scroll', function () { if (!queued) { queued = true; global.requestAnimationFrame(check); } }, { passive: true });
    global.addEventListener('resize', function () { if (!queued) { queued = true; global.requestAnimationFrame(check); } }, { passive: true });
    global.addEventListener('hashchange', function () { global.setTimeout(check, 0); });
    global.setTimeout(check, 0);
  }
  // Draws the bar into an element on a page outside the hubs (the full Market Analysis); Clear draws it again. at is
  // that page's own step (its file); geoid and label are the place it is on, when it has one.
  function mount(el, at, geoid, label) {
    if (!el) return;
    mount.el = el; mount.at = at;
    if (geoid && label) setWorking(geoid, label);
    el.innerHTML = stepPath(true, at, geoid);
    bindStepBar();
  }
  if (global.LabShell) bindStepBar();

  global.LabStep = { PATH: PATH, OWN: OWN, product: product, placed: placed, withPlace: withPlace, WORK_KEY: WORK_KEY, MEMBER_KEY: MEMBER_KEY, working: working, setWorking: setWorking, clearWorking: clearWorking, path: stepPath, mount: mount, bind: bindStepBar };
})(window);
