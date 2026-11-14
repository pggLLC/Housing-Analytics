// Sliders that say where they are and where to aim (paul, 14 Nov 2026: "sliders should show value when sliding so you
// know what your selecting... also there should be some indication of what should be targeted").
// LabSlider.attrs(fmt, outputId, band) goes on the <input type="range">: the named <output> shows the value as the
// slider moves, before it is let go. LabSlider.scale(...) draws a strip under the slider with the target band and
// the starting mark, and a line that says what they are and where they come from. Every target is a figure the page
// already cites (a CHFA minimum, a program limit, a published average); this adds no new figure.
(function (global) {
  'use strict';
  var doc = global.document;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var FMT = {
    money: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); },
    price: function (v) { return '$' + v.toFixed(2); },
    pct: function (v) { return String(+v.toFixed(2)) + '%'; },
    x: function (v) { return v.toFixed(2) + 'x'; },
    plain: function (v) { return String(v); }
  };
  function at(v, min, max) { return Math.max(0, Math.min(100, (v - min) / (max - min) * 100)); }

  // Attributes for the range input. band = [lo, hi]: outside it the target line is marked "outside".
  // zeroOk: 0 means "not used" (a gap source left out), so it is never flagged as outside the band.
  function attrs(fmt, outputId, band, zeroOk) {
    return ' data-slider-fmt="' + esc(fmt) + '" data-slider-out="' + esc(outputId) + '"' +
      (band ? ' data-slider-lo="' + esc(band[0]) + '" data-slider-hi="' + esc(band[1]) + '"' : '') + (zeroOk ? ' data-slider-zero-ok' : '');
  }

  // o: { id, min, max, value, band: [lo, hi] | null, mark: number | null, text: html, markText: html, zeroOk }
  // The band is the target; the mark is where the slider starts (an average, the base case, the budget as entered).
  function scale(o) {
    var min = Number(o.min), max = Number(o.max), v = Number(o.value);
    var band = o.band && isFinite(o.band[0]) && isFinite(o.band[1]) ? [Math.max(min, Number(o.band[0])), Math.min(max, Number(o.band[1]))] : null;
    var mark = o.mark != null && isFinite(o.mark) ? Number(o.mark) : null;
    var off = band && !(o.zeroOk && v === 0) && (v < band[0] - 1e-9 || v > band[1] + 1e-9);
    var strip = !band && mark == null ? '' : '<div class="sl-scale" aria-hidden="true">' +
      (band ? '<span class="sl-band" style="left:' + at(band[0], min, max).toFixed(2) + '%;width:' + (at(band[1], min, max) - at(band[0], min, max)).toFixed(2) + '%"></span>' : '') +
      (mark != null ? '<i class="sl-mark" style="left:' + at(mark, min, max).toFixed(2) + '%"></i>' : '') + '</div>';
    var lines = '';
    if (band && o.text) lines += '<span class="sl-line"><span class="sl-key sl-key-band" aria-hidden="true"></span><span>' + o.text +
      ' <strong class="sl-off" data-slider-off="' + esc(o.id) + '"' + (off ? '' : ' hidden') + '>Now outside it.</strong></span></span>';
    else if (o.text) lines += '<span class="sl-line"><span>' + o.text + '</span></span>';
    if (mark != null && o.markText) lines += '<span class="sl-line"><span class="sl-key sl-key-mark" aria-hidden="true"></span><span>' + o.markText + '</span></span>';
    return strip + (lines ? '<span class="sl-target" id="' + esc(o.id) + '-target">' + lines + '</span>' : '');
  }

  function update(el) {
    var f = FMT[el.getAttribute('data-slider-fmt')] || FMT.plain, v = Number(el.value);
    var out = doc.getElementById(el.getAttribute('data-slider-out'));
    if (out) out.textContent = f(v);
    var lo = el.getAttribute('data-slider-lo'), hi = el.getAttribute('data-slider-hi');
    var flag = doc.querySelector('[data-slider-off="' + (el.id || el.name || '').replace(/["\\]/g, '\\$&') + '"]');
    if (flag && lo != null && hi != null) flag.hidden = (el.hasAttribute('data-slider-zero-ok') && v === 0) || !(v < Number(lo) - 1e-9 || v > Number(hi) + 1e-9);
  }

  if (doc) doc.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el && el.type === 'range' && el.hasAttribute('data-slider-out')) update(el);
  }, true);

  // The swatch that ties a line of text to the band or the mark on the strip.
  function key(kind) { return '<span class="sl-key sl-key-' + (kind === 'band' ? 'band' : 'mark') + '" aria-hidden="true"></span>'; }

  global.LabSlider = { attrs: attrs, scale: scale, key: key, update: update, FMT: FMT };
})(window);
