/**
 * input-provenance.js — tell the user which numbers are theirs.
 *
 * The Deal Calculator ships 133 visible fields and 109 of them arrive
 * pre-filled: Total Development Cost reads $20,000,000 and Total Units reads
 * 60 before anyone types anything. Those are starting assumptions, but they
 * render identically to a figure the user entered and to a figure derived from
 * their jurisdiction's data. A novice cannot tell the three apart, and an
 * assumption mistaken for a finding is the same defect class as a null
 * rendered as $0 (see AGENTS.md, "An unmeasurable quantity is null, never 0").
 *
 * This marks each field with one of three states:
 *
 *   assumption — pre-filled by the tool; the user should review it
 *   yours      — the user has edited it
 *   data       — supplied from the selected jurisdiction (opt-in via markup)
 *
 * Deliberately additive: it reads the DOM after the form renders and never
 * changes a value, so it cannot alter a calculation. If it fails to load, the
 * form behaves exactly as before.
 */
(function (root) {
  'use strict';

  var STATE_ATTR = 'data-provenance';
  var READY_ATTR = 'data-provenance-ready';

  var LABELS = {
    assumption: 'assumption',
    yours: 'yours',
    data: 'from your jurisdiction'
  };

  var TITLES = {
    assumption: 'A starting assumption from the tool, not your input and not measured data. Review and change it.',
    yours: 'You entered this value.',
    data: 'Supplied from the selected jurisdiction’s data.'
  };

  /** Fields the user actually fills in. Radios/checkboxes carry their own labels. */
  function candidateFields(scope) {
    var nodes = (scope || document).querySelectorAll('input, select, textarea');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = (el.type || '').toLowerCase();
      if (t === 'radio' || t === 'checkbox' || t === 'hidden' || t === 'button' ||
          t === 'submit' || t === 'search' || t === 'range') continue;
      if (el.disabled || el.readOnly) continue;
      out.push(el);
    }
    return out;
  }

  function hasValue(el) {
    if (el.tagName === 'SELECT') {
      return el.selectedIndex >= 0 && String(el.value || '').trim() !== '';
    }
    return String(el.value || '').trim() !== '';
  }

  /**
   * Initial state for a field. Markup may declare `data-provenance="data"` to
   * mark a jurisdiction-derived value; everything else pre-filled is an
   * assumption until the user touches it.
   */
  function initialState(el) {
    var declared = el.getAttribute(STATE_ATTR);
    if (declared === 'data') return 'data';
    return hasValue(el) ? 'assumption' : null;
  }

  function badgeFor(el) {
    var id = (el.id || '') + '-prov';
    var existing = el.ownerDocument.getElementById(id);
    if (existing) return existing;
    var span = el.ownerDocument.createElement('span');
    span.id = id;
    span.className = 'input-prov';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function paint(el, state) {
    if (!state) {
      el.removeAttribute(STATE_ATTR);
      var old = el.ownerDocument.getElementById((el.id || '') + '-prov');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }
    el.setAttribute(STATE_ATTR, state);
    var badge = badgeFor(el);
    badge.textContent = LABELS[state] || state;
    badge.className = 'input-prov input-prov--' + state;
    badge.title = TITLES[state] || '';
    // Place the badge next to the field without disturbing layout order.
    if (!badge.parentNode) {
      if (el.parentNode) el.parentNode.insertBefore(badge, el.nextSibling);
    }
  }

  function markUserEdited(el) {
    // A jurisdiction-supplied value the user overrides becomes theirs.
    paint(el, hasValue(el) ? 'yours' : null);
  }

  /**
   * Apply provenance to every candidate field under `scope`.
   * Safe to call repeatedly — re-running after a re-render re-marks new fields
   * and leaves fields the user already edited as "yours".
   *
   * @param {Element|Document} [scope]
   * @returns {{assumption:number, yours:number, data:number, total:number}}
   */
  function apply(scope) {
    var fields = candidateFields(scope);
    var counts = { assumption: 0, yours: 0, data: 0, total: fields.length };

    fields.forEach(function (el) {
      var current = el.getAttribute(STATE_ATTR);
      var state = (current === 'yours') ? 'yours' : initialState(el);

      paint(el, state);
      if (state && counts[state] !== undefined) counts[state]++;

      if (el.getAttribute(READY_ATTR) === '1') return;
      el.setAttribute(READY_ATTR, '1');
      var onEdit = function () { markUserEdited(el); };
      el.addEventListener('input', onEdit);
      el.addEventListener('change', onEdit);
    });

    return counts;
  }

  var api = { apply: apply, candidateFields: candidateFields, initialState: initialState, LABELS: LABELS };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InputProvenance = api;
}(typeof window !== 'undefined' ? window : null));
