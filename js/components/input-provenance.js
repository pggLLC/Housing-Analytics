/** Input origins for screening: metadata follows values, including shared scenarios. */
(function (root) {
  'use strict';
  var records = new WeakMap();
  var programmatic = 0;
  var anonymousId = 0;
  var LABELS = { data: 'Source confirmed', assumption: 'assumption', illustrative: 'Worked example',
    'needs-source': 'Not yet verified', yours: 'yours' };
  var CONCLUSIONS = {
    data: 'Supplied by the named source; check its date and geography before using it.',
    assumption: 'A tool default for screening; review it against your project evidence.',
    illustrative: 'A worked example, not a value for decisions.',
    'needs-source': 'A local source is needed before this value can be supplied.',
    yours: 'You entered this value.'
  };
  function registry(el) {
    return root && root.DealCalculatorInputRegistry && root.DealCalculatorInputRegistry.get(el.id) || {};
  }
  function value(el) { return 'value' in el ? String(el.value) : el.textContent; }
  function hasValue(el) { return value(el).trim() !== ''; }
  function candidateFields(scope) {
    return Array.prototype.filter.call((scope || document).querySelectorAll('input, select, textarea'), function (el) {
      return !/^(radio|checkbox|hidden|button|submit|search|range)$/.test(el.type || '') && !el.disabled && !el.readOnly;
    });
  }
  function identify(el) {
    if (el.id) return;
    var row = el.closest('[data-tranche-id]');
    var key = Array.prototype.find.call(el.classList, function (c) { return /^dc-tr-/.test(c); });
    if (row && key) {
      var index = Array.prototype.indexOf.call(row.parentNode.querySelectorAll('[data-tranche-id]'), row);
      el.id = 'ip-tr-' + index + '-' + key.slice(6);
    } else el.id = 'ip-anonymous-' + (++anonymousId);
  }
  function initialState(el) {
    return el.getAttribute('data-provenance') === 'data' ? 'data'
      : hasValue(el) ? registry(el).status || 'assumption'
      : registry(el).status === 'needs-source' ? 'needs-source' : null;
  }
  function sourceText(meta) {
    return [meta.source, meta.vintage, meta.geography].filter(function (v) { return v != null && v !== ''; }).join(' · ');
  }
  function detail(el, record) {
    var meta = Object.assign({}, registry(el), record.origin.meta);
    var lines = [CONCLUSIONS[record.status], meta.definition, sourceText(meta), meta.why].filter(Boolean);
    if (record.status === 'yours') lines.push('You changed this from ' + record.origin.value +
      (sourceText(meta) ? ' (' + sourceText(meta) + ')' : ' (tool default)') + '.');
    return lines.join(' ');
  }
  function paint(el) {
    var rec = records.get(el);
    var state = rec && rec.status;
    if (!state) {
      el.removeAttribute('data-provenance');
      ['-prov', '-prov-detail'].forEach(function (suffix) {
        var old = el.ownerDocument.getElementById(el.id + suffix); if (old) old.remove();
      });
      return;
    }
    el.setAttribute('data-provenance', state);
    var doc = el.ownerDocument;
    var id = el.id + '-prov';
    var badge = doc.getElementById(id);
    if (!badge) {
      badge = doc.createElement('button'); badge.type = 'button'; badge.id = id;
      badge.style.cssText = 'cursor:pointer;font:inherit;font-size:.68rem;white-space:normal;max-width:100%;' +
        'border:1px solid var(--border,#cbd5e1);border-radius:4px;padding:2px 5px;margin:2px 0;' +
        'background:var(--bg2,#f1f5f9);color:var(--muted,#475569);';
      var pop = doc.createElement('span'); pop.id = id + '-detail'; pop.hidden = true;
      pop.style.cssText = 'position:fixed;z-index:1100;width:20rem;max-width:calc(100vw - 2rem);max-height:calc(100vh - 2rem);overflow:auto;' +
        'padding:.65rem;font-size:.78rem;line-height:1.4;font-weight:400;background:var(--card,#fff);' +
        'color:var(--text,#0f172a);border:1px solid var(--border,#cbd5e1);border-radius:4px;' +
        'box-shadow:0 3px 12px #0002;';
      pop.style.display = 'none';
      badge.setAttribute('aria-controls', pop.id);
      badge.setAttribute('aria-expanded', 'false');
      function show(open) {
        pop.hidden = !open; pop.style.display = open ? 'block' : 'none'; badge.setAttribute('aria-expanded', String(open));
        if (open) {
          var box = badge.getBoundingClientRect(), viewport = doc.defaultView;
          pop.style.left = Math.max(8, Math.min(box.left, viewport.innerWidth - pop.offsetWidth - 8)) + 'px';
          pop.style.top = Math.max(8, Math.min(box.bottom + 4, viewport.innerHeight - pop.offsetHeight - 8)) + 'px';
        }
      }
      badge.addEventListener('click', function (event) { event.preventDefault(); show(true); });
      badge.addEventListener('focus', function () { show(true); });
      badge.addEventListener('keydown', function (event) { if (event.key === 'Escape') show(false); });
      function leave(event) { if (event.relatedTarget !== badge && !pop.contains(event.relatedTarget)) show(false); }
      badge.addEventListener('blur', leave); pop.addEventListener('focusout', leave);
      // Keep a field and its badge in one grid cell; a sibling badge must not
      // displace the next tier/bedroom selector into another row.
      var view = doc.defaultView;
      if (view && view.getComputedStyle(el.parentElement).display === 'grid') {
        var cell = doc.createElement('span'); cell.className = 'input-prov-field'; cell.style.minWidth = '0';
        el.parentNode.insertBefore(cell, el); cell.appendChild(el);
      }
      el.insertAdjacentElement('afterend', badge); badge.insertAdjacentElement('afterend', pop);
    }
    var sharedLabel = root && root.ProvenanceLabel && (state === 'data' || state === 'needs-source')
      ? root.ProvenanceLabel({ classification: state === 'data' ? 'observed' : 'not_available', source_note: CONCLUSIONS[state] }) : null;
    var tone = sharedLabel ? sharedLabel.tone : state === 'data' ? 'source' : state === 'needs-source' ? 'pending' : 'action';
    badge.className = 'input-prov input-prov--' + state + ' provenance provenance--' + tone;
    badge.textContent = sharedLabel ? sharedLabel.label : LABELS[state];
    badge.title = detail(el, rec);
    badge.setAttribute('aria-label', LABELS[state] + ': ' + (registry(el).definition || el.id));
    var panel = doc.getElementById(id + '-detail');
    panel.textContent = badge.title;
    var meta = rec.origin.meta;
    if (meta.sourceUrl && /^(https?:\/\/|(?:\.\.\/)?[a-z][a-z0-9-]*\/)/i.test(meta.sourceUrl)) {
      var link = doc.createElement('a'); link.href = meta.sourceUrl; link.textContent = ' Source record'; panel.appendChild(link);
    }
  }
  function ensure(el) {
    identify(el);
    if (!records.has(el)) records.set(el, { status: initialState(el), origin: {
      value: value(el), meta: Object.assign({}, registry(el), { status: initialState(el) }) } });
    if (el.getAttribute('data-provenance-ready') !== '1') {
      el.setAttribute('data-provenance-ready', '1');
      function edit() {
        if (programmatic) return;
        var rec = records.get(el);
        rec.status = hasValue(el) ? 'yours' : rec.origin.meta.status;
        paint(el);
      }
      el.addEventListener('input', edit); el.addEventListener('change', edit);
    }
    return records.get(el);
  }
  function apply(scope) {
    var fields = candidateFields(scope);
    var counts = { assumption: 0, yours: 0, data: 0, illustrative: 0, 'needs-source': 0, total: fields.length };
    fields.forEach(function (el) { var rec = ensure(el); paint(el); if (rec.status) counts[rec.status]++; });
    return counts;
  }
  function mark(el, meta) {
    if (!el) return;
    ensure(el);
    records.set(el, { status: meta.status, origin: { value: value(el), meta: Object.assign({}, registry(el), meta) } });
    paint(el);
  }
  function markData(el, meta) {
    if (!meta || !meta.source || !meta.sourceUrl || meta.vintage == null || !meta.geography) {
      missing(el, 'Source metadata is incomplete.'); return;
    }
    mark(el, Object.assign({}, meta, { status: 'data' }));
  }
  function missing(el, why) { mark(el, { status: 'needs-source', source: null, sourceUrl: null, vintage: null, geography: null, why: why }); }
  function get(el) { return records.has(el) ? JSON.parse(JSON.stringify(records.get(el))) : null; }
  function withProgrammaticChange(fn) { programmatic++; try { return fn(); } finally { programmatic--; } }
  // Intern dynamic metadata once; default definitions are resolved from the registry.
  function serialize(scope) {
    var result = { version: 1, fields: {}, sources: [] };
    var index = {};
    (scope || document).querySelectorAll('[data-provenance]').forEach(function (el) {
      var r = records.get(el); if (!r || !el.id) return;
      var base = registry(el), extra = {};
      Object.keys(r.origin.meta).forEach(function (key) { if (r.origin.meta[key] !== base[key]) extra[key] = r.origin.meta[key]; });
      var encoded = JSON.stringify(extra);
      if (index[encoded] == null) { index[encoded] = result.sources.length; result.sources.push(extra); }
      // Display-only source labels cannot be edited; their text need not inflate a share URL.
      result.fields[el.id] = [r.status, 'value' in el ? r.origin.value : '', index[encoded]];
    });
    return result;
  }
  function restore(map, scope) {
    if (!map || map.version !== 1 || !map.fields || !Array.isArray(map.sources)) return;
    var doc = (scope && scope.ownerDocument) || document;
    Object.keys(map.fields).forEach(function (id) {
      var el = doc.getElementById(id), field = map.fields[id];
      if (!el || (scope && scope !== doc && !scope.contains(el)) || !Array.isArray(field) || !LABELS[field[0]]) return;
      ensure(el);
      var extra = map.sources[field[2]] || {};
      var meta = Object.assign({}, registry(el));
      ['status', 'definition', 'why', 'source', 'sourceUrl', 'vintage', 'geography', 'countyFips', 'binding'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) meta[key] = extra[key];
      });
      records.set(el, { status: field[0], origin: { value: String(field[1] == null ? '' : field[1]), meta: meta } });
      paint(el);
    });
  }
  // A move invalidates only source-filled editable fields. A personal override
  // stays personal, with its former geographic origin removed.
  function invalidateGeography(scope, countyFips) {
    scope.querySelectorAll('[data-provenance]').forEach(function (el) {
      var r = records.get(el);
      if (!r || !r.origin.meta.countyFips || r.origin.meta.countyFips === countyFips) return;
      if (!('value' in el) || el.readOnly) return;
      if (r.status === 'yours') mark(el, { status: 'yours', why: 'Your entry; review it for the selected county.' });
      else { el.value = ''; missing(el, 'The geography changed; supply a source for the selected county.'); }
    });
  }
  var api = { apply: apply, candidateFields: candidateFields, initialState: initialState, LABELS: LABELS,
    mark: mark, markData: markData, missing: missing, get: get, serialize: serialize, restore: restore,
    withProgrammaticChange: withProgrammaticChange, invalidateGeography: invalidateGeography };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InputProvenance = api;
}(typeof window !== 'undefined' ? window : null));
