// The place bar on the gated Jurisdiction Report (developer-brief.html).
// Once the picker scrolls off screen, a slim bar pins under the site header and
// says which place the report is about, with a button back to the picker. It
// sits outside the report frame and is hidden in print.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlaceBar = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // "Avon (town)" -> { name: "Avon", kind: "Town in Eagle County" }.
  function describe(row, countyNames) {
    if (!row) return { name: '', kind: '' };
    var raw = String(row.name || '');
    var county = (countyNames || {})[row.containingCounty] || '';
    var inCounty = county ? ' in ' + county : '';
    if (row.type === 'county') return { name: raw, kind: 'County' };
    var m = raw.match(/^(.*?)\s*\((city|town|CDP)\)\s*$/i);
    var base = m ? m[1] : raw.replace(/\s+CDP\b.*$/i, '');
    var tag = m ? m[2].toLowerCase() : '';
    if (row.type === 'cdp') return { name: base, kind: 'Unincorporated community' + inCounty };
    if (tag === 'city') return { name: base, kind: 'City' + inCounty };
    if (tag === 'town') return { name: base, kind: 'Town' + inCounty };
    return { name: base, kind: 'Municipality' + inCounty };
  }

  // bar: the #placeBar element. picker: the element whose leaving the screen
  // shows the bar. input: the picker's text box, focused by "Change place".
  function mount(bar, picker, input) {
    var doc = bar.ownerDocument;
    var win = doc.defaultView;
    var nameEl = bar.querySelector('[data-place-name]');
    var kindEl = bar.querySelector('[data-place-kind]');
    var hasPlace = false;
    var pickerGone = false;

    function headerBottom() {
      var h = doc.querySelector('header.site-header') || doc.getElementById('siteHeader');
      if (!h) return 0;
      var b = h.getBoundingClientRect().bottom;
      return b > 0 ? Math.round(b) : 0;
    }
    function sync() {
      var show = hasPlace && pickerGone;
      if (show) bar.style.top = headerBottom() + 'px';
      bar.hidden = !show;
    }
    if (win.IntersectionObserver) {
      new win.IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        // Gone means scrolled up past the top, not still below the fold.
        pickerGone = !e.isIntersecting && e.boundingClientRect.top < 0;
        sync();
      }).observe(picker);
    }
    win.addEventListener('resize', sync);

    bar.querySelector('[data-place-change]').addEventListener('click', function () {
      var still = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      picker.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      if (input) { input.focus({ preventScroll: true }); input.select(); }
    });

    return {
      set: function (info) {
        nameEl.textContent = (info && info.name) || '';
        kindEl.textContent = (info && info.kind) || '';
        hasPlace = !!(info && info.name);
        sync();
      }
    };
  }

  return { describe: describe, mount: mount };
}));
