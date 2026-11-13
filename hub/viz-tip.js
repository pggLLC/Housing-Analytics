// The exact value of a chart mark, shown beside it on hover, on a tap, and from the keyboard.
// Every house chart (site/viz.js) already writes each mark's value into an SVG <title>; this shows that same
// text at once in a small label, instead of leaving it to the browser's slow, mouse-only tooltip.
// Keyboard: a chart is one Tab stop; the arrow keys step through its marks, Home and End jump, Escape closes.
// Nothing is computed here: the label is the mark's own title, so it cannot disagree with the chart or its table.
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc || !doc.addEventListener) return;

  var tip = null, on = null;

  function titleOf(el) {
    if (el.hasAttribute('data-tip')) return el.getAttribute('data-tip');
    var t = null;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName.toLowerCase() === 'title') { t = c; break; }
    var s = t ? t.textContent.trim() : '';
    // Keep the text on the mark and drop the <title>, so the browser's own tooltip does not open over ours.
    el.setAttribute('data-tip', s);
    if (t) el.removeChild(t);
    return s;
  }
  // The mark under a node: the nearest element inside a house chart that carries a value.
  // A value printed on top of its bar must not hide the bar from the pointer, so marks under the pointer count too.
  function markOf(node, ev) {
    if (!node || node.nodeType !== 1 || !node.closest || !node.closest('figure.viz svg')) return null;
    for (var el = node; el && el.nodeType === 1 && el.tagName.toLowerCase() !== 'svg'; el = el.parentNode) {
      if (titleOf(el)) return el;
    }
    if (!ev || !doc.elementsFromPoint) return null;
    var svg = node.closest('svg'), under = doc.elementsFromPoint(ev.clientX, ev.clientY);
    for (var i = 0; i < under.length; i++) {
      if (under[i] !== svg && svg.contains(under[i]) && under[i].tagName.toLowerCase() !== 'text' && titleOf(under[i])) return under[i];
    }
    return null;
  }
  function marksIn(svg) {
    return Array.prototype.filter.call(svg.querySelectorAll('*'), function (el) {
      var n = el.tagName.toLowerCase();
      return n !== 'title' && n !== 'text' && n !== 'line' && titleOf(el);
    });
  }
  function box() {
    if (tip) return tip;
    tip = doc.createElement('div');
    tip.id = 'viz-tip';
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    tip.hidden = true;
    doc.body.appendChild(tip);
    return tip;
  }
  function hide() {
    if (on) on.classList.remove('viz-on');
    on = null;
    if (tip) { tip.hidden = true; tip.textContent = ''; }
  }
  function show(el, text) {
    var b = box();
    if (on && on !== el) on.classList.remove('viz-on');
    on = el;
    if (el.classList) el.classList.add('viz-on');
    b.textContent = text == null ? titleOf(el) : text;
    b.hidden = false;
    // Above the mark, centred on it; below when there is no room above; kept inside the window.
    var r = el.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight, vw = doc.documentElement.clientWidth;
    var x = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, vw - w - 6));
    var y = r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8;
    b.style.left = Math.round(x + global.pageXOffset) + 'px';
    b.style.top = Math.round(y + global.pageYOffset) + 'px';
  }

  // Each chart is one Tab stop, named for what the arrow keys do. Called after every draw.
  function ready(root) {
    Array.prototype.forEach.call((root || doc).querySelectorAll('figure.viz svg:not([data-tip-ready])'), function (svg) {
      svg.setAttribute('data-tip-ready', '');
      if (!marksIn(svg).length) return;
      svg.setAttribute('tabindex', '0');
      svg.setAttribute('aria-keyshortcuts', 'ArrowRight ArrowLeft Home End Escape');
    });
  }

  doc.addEventListener('pointerover', function (ev) {
    if (ev.pointerType === 'touch') return;
    var m = markOf(ev.target, ev);
    if (m) show(m); else if (on && !(doc.activeElement && doc.activeElement.contains && doc.activeElement.contains(on) && doc.activeElement.matches('svg:focus-visible'))) hide();
  });
  // A scroll puts the label away; the next movement over the same mark brings it back.
  doc.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'touch' || on) return;
    var m = markOf(ev.target, ev);
    if (m) show(m);
  });
  // A tap shows the value; a tap anywhere else puts it away.
  doc.addEventListener('click', function (ev) {
    var m = markOf(ev.target, ev);
    if (m) show(m); else hide();
  });
  doc.addEventListener('keydown', function (ev) {
    var svg = doc.activeElement;
    if (!svg || !svg.hasAttribute || !svg.hasAttribute('data-tip-ready') || !svg.hasAttribute('tabindex')) return;
    if (ev.key === 'Escape') { hide(); return; }
    var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (step == null && ev.key !== 'Home' && ev.key !== 'End') return;
    var all = marksIn(svg);
    if (!all.length) return;
    ev.preventDefault();
    var i = all.indexOf(on);
    var next = ev.key === 'Home' ? 0 : ev.key === 'End' ? all.length - 1 : i < 0 ? (step > 0 ? 0 : all.length - 1) : (i + step + all.length) % all.length;
    show(all[next], titleOf(all[next]) + ' (' + (next + 1) + ' of ' + all.length + ')');
  });
  doc.addEventListener('focusin', function (ev) {
    var svg = ev.target;
    if (!svg || !svg.hasAttribute || !svg.hasAttribute('data-tip-ready') || !svg.hasAttribute('tabindex')) return;
    if (svg.matches && !svg.matches(':focus-visible')) return;
    show(svg, 'Arrow keys read each value');
    svg.classList.remove('viz-on');
  });
  doc.addEventListener('focusout', function (ev) {
    if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-tip-ready')) hide();
  });
  global.addEventListener('scroll', function () { if (on && !(doc.activeElement && doc.activeElement.hasAttribute && doc.activeElement.hasAttribute('data-tip-ready'))) hide(); }, { passive: true });
  global.addEventListener('hashchange', hide);

  global.LabVizTip = { ready: ready, hide: hide };
  if (global.MutationObserver && doc.getElementById) {
    var arm = function () {
      var main = doc.getElementById('main');
      if (!main) return;
      ready(main);
      new MutationObserver(function () { ready(main); if (on && !doc.contains(on)) hide(); }).observe(main, { childList: true, subtree: true });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', arm); else arm();
  }
})(typeof window === 'undefined' ? this : window);
