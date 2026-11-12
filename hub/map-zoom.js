// Map tooltips and zoom for every lab map drawn as an SVG inside a .pm-frame. The maps carry their labels as
// SVG <title>s, which browsers show late on a mouse and never on a phone. This script turns each one into a
// tooltip that follows the pointer, opens on a tap, and opens on keyboard focus, and adds zoom: the + and -
// buttons, Ctrl or ⌘ with the wheel (also a trackpad pinch), a two-finger pinch on a phone, and a drag to pan
// once zoomed. It only reads what the map already says; it adds no figures.
(function (global) {
  'use strict';

  var doc = global.document;
  var MAPS = '.pres-map .pm-frame > svg, .need-map .pm-frame > svg, .dd-map .pm-frame > svg, .wb-map .pm-frame > svg';
  var MAX = 8;
  // A finger is wide: a tap this close to a small circle counts as a tap on it (screen pixels).
  var REACH = { mouse: 10, pen: 12, touch: 22 };

  function tipOf(el, svg) {
    for (; el && el !== svg; el = el.parentNode) if (el.getAttribute && el.getAttribute('data-tip')) return el;
    return null;
  }
  function shown(el, svg) {
    for (; el && el !== svg; el = el.parentNode) if (el.style && el.style.display === 'none') return false;
    return true;
  }

  function enhance(svg) {
    if (svg.__mapZoom) return;
    svg.__mapZoom = true;
    var frame = svg.parentNode, fig = frame.closest('figure');
    var base = svg.viewBox.baseVal, B = { x: base.x, y: base.y, w: base.width, h: base.height };
    var vb = { x: B.x, y: B.y, w: B.w, h: B.h };
    // A map may ask for a deeper zoom (data-zoom-max) and open already zoomed (data-zoom="x y w h").
    var max = Number(svg.getAttribute('data-zoom-max')) || MAX;
    var start = (svg.getAttribute('data-zoom') || '').split(' ').map(Number);
    if (start.length === 4 && start.every(isFinite) && start[2] > 0) vb = { x: start[0], y: start[1], w: start[2], h: start[3] };

    // <title> → data-tip, so the browser's own late tooltip does not show on top of ours. The text stays
    // the element's accessible name.
    Array.prototype.slice.call(svg.querySelectorAll('title')).forEach(function (t) {
      var p = t.parentNode, text = t.textContent;
      p.setAttribute('data-tip', text);
      var link = p.parentNode && p.parentNode.tagName && p.parentNode.tagName.toLowerCase() === 'a' ? p.parentNode : null;
      if (link && !link.getAttribute('aria-label')) link.setAttribute('aria-label', text);
      if (!link) p.setAttribute('aria-label', text);
      p.removeChild(t);
    });
    var dots = Array.prototype.slice.call(svg.querySelectorAll('circle[data-tip]'));

    svg.classList.add('pm-zoomable');
    var tip = doc.createElement('div');
    tip.className = 'map-tip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    fig.appendChild(tip);
    var controls = doc.createElement('div');
    controls.className = 'pm-zoom';
    controls.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-z="reset" aria-label="Show the whole map">Reset</button>';
    // Before the map, so the legend that follows the frame sits directly under the map (on a phone the
    // buttons sit above it; on a wider screen they float in its top-right corner).
    frame.insertBefore(controls, svg);

    // ---- tooltip ----
    var current = null;
    function show(el, x, y) {
      current = el;
      tip.textContent = el.getAttribute('data-tip');
      tip.hidden = false;
      el.classList.add('is-tipped');
      var f = fig.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.max(4, Math.min(x - f.left - w / 2, f.width - w - 4));
      var top = y - f.top - h - 14;
      if (top < 4) top = y - f.top + 18;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hide() {
      if (current) current.classList.remove('is-tipped');
      current = null;
      tip.hidden = true;
    }
    // The thing under the pointer: a circle hit directly, else the nearest visible circle within reach,
    // else the shape under it (a county or tract).
    function pick(ev) {
      var hit = tipOf(ev.target, svg);
      if (hit && hit.tagName.toLowerCase() === 'circle') return hit;
      var reach = REACH[ev.pointerType] || REACH.mouse, best = null, bestD = reach * reach;
      dots.forEach(function (c) {
        if (!shown(c, svg)) return;
        var r = c.getBoundingClientRect();
        var dx = Math.max(0, Math.abs(ev.clientX - (r.left + r.width / 2)) - r.width / 2);
        var dy = Math.max(0, Math.abs(ev.clientY - (r.top + r.height / 2)) - r.height / 2);
        var d = dx * dx + dy * dy;
        if (d <= bestD) { bestD = d; best = c; }
      });
      return best || hit;
    }

    // ---- zoom ----
    function scale() { return B.w / vb.w; }
    function apply() {
      vb.w = Math.min(B.w, Math.max(B.w / max, vb.w));
      vb.h = vb.w * B.h / B.w;
      vb.x = Math.min(B.x + B.w - vb.w, Math.max(B.x, vb.x));
      vb.y = Math.min(B.y + B.h - vb.h, Math.max(B.y, vb.y));
      svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(function (n) { return +n.toFixed(2); }).join(' '));
      var s = scale();
      svg.classList.toggle('is-zoomed', s > 1.01);
      svg.classList.toggle('is-zoomed-2', s >= 2);
      controls.querySelector('[data-z="out"]').disabled = s <= 1.01;
      controls.querySelector('[data-z="reset"]').disabled = s <= 1.01;
      controls.querySelector('[data-z="in"]').disabled = s >= max - 0.01;
      hide();
      if (typeof CustomEvent === 'function') svg.dispatchEvent(new CustomEvent('mapzoom', { bubbles: true, detail: { scale: s } }));
    }
    function toSvg(x, y) {
      var r = svg.getBoundingClientRect();
      return [vb.x + (x - r.left) / r.width * vb.w, vb.y + (y - r.top) / r.height * vb.h];
    }
    // Zoom by factor k, keeping the map point under (x, y) on screen where it is.
    function zoomAt(k, x, y) {
      var p = toSvg(x, y), w = Math.min(B.w, Math.max(B.w / max, vb.w / k)), f = w / vb.w;
      vb.x = p[0] - (p[0] - vb.x) * f;
      vb.y = p[1] - (p[1] - vb.y) * f;
      vb.w = w;
      apply();
    }
    function zoomCentre(k) {
      var r = svg.getBoundingClientRect();
      zoomAt(k, r.left + r.width / 2, r.top + r.height / 2);
    }
    controls.addEventListener('click', function (ev) {
      var z = ev.target.getAttribute && ev.target.getAttribute('data-z');
      if (z === 'in') zoomCentre(2);
      else if (z === 'out') zoomCentre(0.5);
      else if (z === 'reset') { vb = { x: B.x, y: B.y, w: B.w, h: B.h }; apply(); }
    });
    svg.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
    }, { passive: false });
    svg.addEventListener('dblclick', function (ev) { ev.preventDefault(); zoomAt(2, ev.clientX, ev.clientY); });

    // ---- pointers: hover, tap, drag to pan, pinch ----
    var pts = {}, drag = null, pinch = null, moved = false, lastType = 'mouse';
    function count() { return Object.keys(pts).length; }
    svg.addEventListener('pointerdown', function (ev) {
      lastType = ev.pointerType;
      pts[ev.pointerId] = [ev.clientX, ev.clientY];
      moved = false;
      if (count() === 2) {
        var a = Object.keys(pts).map(function (k) { return pts[k]; });
        pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), w: vb.w };
        drag = null;
        hide();
      } else if (count() === 1 && scale() > 1.01) {
        drag = { x: ev.clientX, y: ev.clientY, vx: vb.x, vy: vb.y };
      }
    });
    svg.addEventListener('pointermove', function (ev) {
      if (pts[ev.pointerId]) pts[ev.pointerId] = [ev.clientX, ev.clientY];
      if (pinch && count() === 2) {
        var a = Object.keys(pts).map(function (k) { return pts[k]; });
        var d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
        var k = vb.w / (pinch.w * pinch.d / d);
        zoomAt(k, (a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2);
        moved = true;
        return;
      }
      if (drag) {
        var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (moved || Math.abs(dx) + Math.abs(dy) > 4) {
          moved = true;
          var r = svg.getBoundingClientRect();
          vb.x = drag.vx - dx / r.width * vb.w;
          vb.y = drag.vy - dy / r.height * vb.h;
          apply();
          svg.classList.add('is-panning');
        }
        return;
      }
      if (ev.pointerType === 'mouse' || ev.pointerType === 'pen') {
        var el = pick(ev);
        if (el) show(el, ev.clientX, ev.clientY); else hide();
      }
    });
    function up(ev) {
      delete pts[ev.pointerId];
      if (count() < 2) pinch = null;
      if (!count()) { drag = null; svg.classList.remove('is-panning'); }
      if (ev.type === 'pointerup' && ev.pointerType === 'touch' && !moved) {
        var el = pick(ev);
        if (el) show(el, ev.clientX, ev.clientY); else hide();
      }
    }
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hide(); });
    // On a touch screen the first tap on a linked shape shows its tooltip; a second tap opens it.
    // After a drag or pinch the click is dropped, so panning never opens a page by accident.
    var tapped = null;
    svg.addEventListener('click', function (ev) {
      var link = ev.target.closest && ev.target.closest('a');
      if (moved) { ev.preventDefault(); moved = false; return; }
      // A county on the need map opens its panel on the first tap; the panel says what the tooltip would.
      if (!link || lastType !== 'touch' || link.hasAttribute('data-county')) return;
      var el = tipOf(ev.target, svg);
      if (el && tapped !== el) { ev.preventDefault(); tapped = el; }
    });
    // Keyboard focus on a linked shape shows its tooltip. Focus on the map itself (a tap can give it) does not.
    svg.addEventListener('focusin', function (ev) {
      if (ev.target === svg) return;
      var el = ev.target.querySelector('[data-tip]') || tipOf(ev.target, svg);
      if (!el) return;
      var r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    });
    svg.addEventListener('focusout', hide);
    doc.addEventListener('pointerdown', function (ev) { if (!svg.contains(ev.target)) { hide(); tapped = null; } });
    // A layer switched off takes its open tooltip with it.
    fig.addEventListener('change', function () { if (current && !shown(current, svg)) hide(); });
    apply();
  }

  function scan(root) { Array.prototype.forEach.call((root || doc).querySelectorAll(MAPS), enhance); }
  if (typeof MutationObserver !== 'undefined' && doc.body) {
    new MutationObserver(function () { scan(); }).observe(doc.body, { childList: true, subtree: true });
    scan();
  }
  global.LabMapZoom = { enhance: enhance, scan: scan };
})(window);
