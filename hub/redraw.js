// A form that redraws the page on every change must let the reader move on. A change fires as focus leaves a
// field, inside the click or Tab that moves it. Redrawing there replaces the field or button the reader is moving
// to, so the click lands on nothing, and a handler that then focuses the field just left sends the next keystrokes
// back into it (walkthrough, 14 Nov 2026: 40 in Total homes, a click on Vacancy, then 7 gave 740 homes).
// LabRedraw.after(redraw) runs the redraw once the click or Tab has finished, then puts focus on the control the
// reader moved to, found again by its name (and its row, where a form repeats rows). A change made without moving
// (a list pick, Enter) keeps focus where it is.
(function (global) {
  'use strict';
  var doc = global.document;
  var down = false, pending = null, timer = null, edited = [];

  function cssEsc(s) { return global.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\\]\[]/g, '\\$&'); }

  var FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  function focusables() {
    var main = doc.getElementById('main') || doc.body;
    return Array.prototype.filter.call(main.querySelectorAll(FOCUSABLE), function (n) { return !n.disabled && n.type !== 'hidden'; });
  }
  // How to find a control again after the page is rebuilt: id, or name (and value, for a choice), or its first data-
  // attribute (a button such as Add row), inside its row; a control with none of these by its place in the page's order.
  function dataSel(el) {
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0 && a.name !== 'data-row') return el.tagName.toLowerCase() + '[' + a.name + '="' + String(a.value).replace(/["\\]/g, '\\$&') + '"]';
    }
    return null;
  }
  function keyOf(el) {
    if (!el || el === doc.body || !el.tagName) return null;
    var sel = el.id ? '#' + cssEsc(el.id)
      : el.name ? el.tagName.toLowerCase() + '[name="' + String(el.name).replace(/["\\]/g, '\\$&') + '"]' +
        (el.type === 'radio' || el.type === 'checkbox' ? '[value="' + String(el.value).replace(/["\\]/g, '\\$&') + '"]' : '')
      : dataSel(el);
    if (!sel) { var at = focusables().indexOf(el); return at < 0 ? null : { index: at }; }
    var row = el.closest && el.closest('[data-row]');
    return { sel: sel, row: row ? row.getAttribute('data-row') : null };
  }
  function find(key) {
    if (!key) return null;
    if (key.index != null) return focusables()[key.index] || null;
    var within = key.row != null ? '[data-row="' + String(key.row).replace(/["\\]/g, '\\$&') + '"] ' : '';
    try { return doc.querySelector(within + key.sel); } catch (e) { return null; }
  }

  function run() {
    if (timer) { global.clearTimeout(timer); timer = null; }
    var fn = pending, touched = edited;
    pending = null;
    edited = [];
    if (!fn) return;
    var was = doc.activeElement, key = keyOf(was);
    // What the reader has typed into the field they moved to, after the change and before the redraw, is not saved
    // until they leave it, so it is carried across the redraw as typed, caret and all. A field they only moved to
    // takes the redrawn value, which a rule in the change (a cleared allowance) may have reset.
    var typing = was && touched.indexOf(was) >= 0 && (was.tagName === 'TEXTAREA' || (was.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color|hidden)$/.test(was.type)));
    var typed = typing ? was.value : null, caret = null;
    try { caret = typing && typeof was.selectionStart === 'number' ? [was.selectionStart, was.selectionEnd, was.selectionDirection] : null; } catch (e) { caret = null; }
    fn();
    var el = find(key);
    if (!el) return;
    if (typing && el.value !== typed) el.value = typed;
    if (el !== doc.activeElement) el.focus({ preventScroll: true });
    if (caret && typing) { try { el.setSelectionRange(caret[0], caret[1], caret[2] || 'none'); } catch (e) { /* a number field has no caret */ } }
  }
  // Wait for the press to finish, so its click reaches the control that was under it; a lost release still redraws.
  function after(fn) {
    pending = fn;
    if (timer) global.clearTimeout(timer);
    timer = global.setTimeout(run, down ? 600 : 0);
  }

  if (doc) {
    doc.addEventListener('pointerdown', function () { down = true; }, true);
    // A key pressed before the redraw has run goes to the rebuilt field, never to the one about to be replaced.
    doc.addEventListener('keydown', function () { if (pending) run(); }, true);
    // Typing that reaches a field without a key press first (a phone keyboard, dictation, paste) is marked as edited.
    doc.addEventListener('input', function (ev) { if (pending && edited.indexOf(ev.target) < 0) edited.push(ev.target); }, true);
    ['pointerup', 'pointercancel'].forEach(function (type) {
      doc.addEventListener(type, function () {
        down = false;
        if (pending) { if (timer) global.clearTimeout(timer); timer = global.setTimeout(run, 0); }
      }, true);
    });
    // A click that lands while a change is still waiting: redraw first, then give the click to the rebuilt control, so
    // whatever it does (Save, Add row, Export) reads the page as the change left it, never the stale form (Codex on
    // HA #2845). A click into a text field only needs the redraw; focus is put back on the rebuilt field.
    var ACTS = 'button, a[href], summary, label, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]';
    doc.addEventListener('click', function (ev) {
      down = false;
      if (!pending) return;
      var hit = ev.target && ev.target.closest ? ev.target.closest(ACTS) : null;
      // A label hands its click to its box; follow the box. A label for a text field needs only the redraw.
      if (hit && hit.tagName === 'LABEL') hit = hit.control && /^(checkbox|radio)$/.test(hit.control.type) ? hit.control : null;
      var key = hit ? keyOf(hit) : null;
      run();
      if (!hit || hit.isConnected) return;
      var el = find(key);
      if (!el || el === hit) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      el.click();
    }, true);
  }

  global.LabRedraw = { after: after, flush: run, _keyOf: keyOf };
})(window);
