/**
 * js/components/pipeline-add-button.js — F161
 * ===============================================================
 * "Add to IndiBuild Pipeline" button + inline form. Mounts on
 * jurisdiction-context pages inside the IndiBuild gate (briefs,
 * where-should-I-build) so a single click adds the active
 * jurisdiction to a local-storage pipeline draft.
 *
 * Usage:
 *   PipelineAddButton.attach(container, {
 *     jurisdiction: 'New Castle',
 *     geoid:        '0853395',
 *     defaults: {
 *       stage:          'Signal',     // optional pre-fill
 *       ioi_score:      71,
 *       confidence:     'medium',
 *       classification: 'C',
 *       product_type:   '9% LIHTC',
 *       next_action:    '...',
 *       next_action_due:'2026-07-15',
 *       notes:          '...'
 *     }
 *   });
 *
 * Re-attaching with the same options replaces the existing
 * button (idempotent). The form is rendered inline beneath the
 * button — no global modal — so it never conflicts with leaflet
 * or chart event listeners.
 */
(function (global) {
  'use strict';
  if (global.PipelineAddButton) return;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _todayIso() {
    // Avoid Date.now()/new Date() races by using location.search or
    // window.__APP_TODAY if available; otherwise fall back. For an
    // add form the small drift is acceptable.
    try {
      if (window.__APP_TODAY) return window.__APP_TODAY;
      return new Date().toISOString().slice(0, 10);
    } catch (_) { return ''; }
  }

  function _ensureStyles() {
    if (document.getElementById('pab-styles')) return;
    var st = document.createElement('style');
    st.id = 'pab-styles';
    st.textContent = [
      '.pab-wrap { margin: .55rem 0; }',
      '.pab-btn {',
      '  display: inline-flex; align-items: center; gap: .35rem;',
      '  padding: .4rem .85rem; border-radius: var(--radius, 6px);',
      '  background: var(--accent, #096e65); color: var(--card, #fff);',
      '  border: none; cursor: pointer; font-weight: 700; font-size: .85rem;',
      '  transition: opacity .12s;',
      '}',
      '.pab-btn:hover { opacity: .92; }',
      '.pab-btn--inpipe { background: var(--good, #16a34a); }',
      '.pab-btn--draft { background: var(--warn, #d97706); }',
      '.pab-state {',
      '  font-size: .78rem; color: var(--muted); margin-left: .55rem;',
      '}',
      '.pab-form {',
      '  margin-top: .6rem; padding: .8rem;',
      '  background: var(--card, #fff); border: 1px solid var(--border, rgba(0,0,0,.12));',
      '  border-radius: var(--radius, 6px); max-width: 640px;',
      '}',
      '.pab-form__grid {',
      '  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));',
      '  gap: .55rem .75rem; margin-bottom: .6rem;',
      '}',
      '.pab-form__field { display: flex; flex-direction: column; gap: .15rem; }',
      '.pab-form__label {',
      '  font-size: .72rem; font-weight: 700; color: var(--muted);',
      '  text-transform: uppercase; letter-spacing: .04em;',
      '}',
      '.pab-form__input, .pab-form__select, .pab-form__textarea {',
      '  padding: .35rem .5rem; font-size: .85rem;',
      '  border: 1px solid var(--border, rgba(0,0,0,.18));',
      '  border-radius: 4px; background: var(--bg2, #f3f4f6); color: var(--text, #111);',
      '  font-family: inherit;',
      '}',
      '.pab-form__textarea { min-height: 60px; resize: vertical; grid-column: 1 / -1; }',
      '.pab-form__row { grid-column: 1 / -1; }',
      '.pab-form__actions { display: flex; gap: .5rem; justify-content: flex-end; }',
      '.pab-form__cancel, .pab-form__save {',
      '  padding: .35rem .85rem; border-radius: 4px; border: 1px solid var(--border, rgba(0,0,0,.18));',
      '  cursor: pointer; font-weight: 700; font-size: .82rem;',
      '}',
      '.pab-form__cancel { background: var(--bg2, #f3f4f6); color: var(--text, #111); }',
      '.pab-form__save { background: var(--accent, #096e65); color: var(--card, #fff); border-color: var(--accent, #096e65); }',
      '.pab-msg { font-size: .78rem; color: var(--muted); margin-top: .3rem; }',
      '.pab-msg--ok { color: var(--good, #16a34a); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _currentStatusFor(geoid) {
    if (!window.PipelineStore || !geoid) {
      return Promise.resolve({ state: 'unknown' });
    }
    return window.PipelineStore.loadCanonical()
      .then(function (canonical) {
        var canon = (canonical || []).find(function (r) { return r.geoid === geoid; });
        var drafts = window.PipelineStore.getDrafts();
        var draft = drafts.find(function (r) { return r.geoid === geoid; });
        if (canon) return { state: 'canonical', row: canon };
        if (draft) return { state: 'draft',     row: draft };
        return { state: 'none' };
      });
  }

  function _buildForm(opts, status) {
    var existing = (status && status.row) || {};
    var d = opts.defaults || {};
    function val(k, fallback) {
      if (existing[k]) return existing[k];
      if (d[k]) return d[k];
      return fallback == null ? '' : fallback;
    }
    var stage = val('stage', 'Signal');
    var conf  = val('confidence', 'medium');
    var clazz = val('classification', 'C');

    function selectHtml(name, options, current) {
      return '<select class="pab-form__select" name="' + name + '">' +
        options.map(function (o) {
          var sel = (o === current) ? ' selected' : '';
          return '<option value="' + _esc(o) + '"' + sel + '>' + _esc(o) + '</option>';
        }).join('') +
      '</select>';
    }

    return '' +
      '<div class="pab-form" data-pab-form>' +
        '<div class="pab-form__grid">' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Jurisdiction</label>' +
            '<input class="pab-form__input" name="jurisdiction" value="' + _esc(val('jurisdiction', opts.jurisdiction || '')) + '" required>' +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">GEOID</label>' +
            '<input class="pab-form__input" name="geoid" value="' + _esc(val('geoid', opts.geoid || '')) + '" required>' +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Stage</label>' +
            selectHtml('stage', window.PipelineStore.STAGES, stage) +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">IOI score</label>' +
            '<input class="pab-form__input" type="number" min="0" max="100" name="ioi_score" value="' + _esc(val('ioi_score', '')) + '">' +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Confidence</label>' +
            selectHtml('confidence', window.PipelineStore.CONFIDENCES, conf) +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Classification</label>' +
            selectHtml('classification', window.PipelineStore.CLASSIFICATIONS, clazz) +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Product type</label>' +
            '<input class="pab-form__input" name="product_type" value="' + _esc(val('product_type', '')) + '" placeholder="9% LIHTC / Workforce / ...">' +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Last update</label>' +
            '<input class="pab-form__input" type="date" name="last_update" value="' + _esc(val('last_update', _todayIso())) + '">' +
          '</div>' +
          '<div class="pab-form__field pab-form__row">' +
            '<label class="pab-form__label">Next action</label>' +
            '<input class="pab-form__input" name="next_action" value="' + _esc(val('next_action', '')) + '">' +
          '</div>' +
          '<div class="pab-form__field">' +
            '<label class="pab-form__label">Next action due</label>' +
            '<input class="pab-form__input" type="date" name="next_action_due" value="' + _esc(val('next_action_due', '')) + '">' +
          '</div>' +
          '<div class="pab-form__field pab-form__row">' +
            '<label class="pab-form__label">Notes</label>' +
            '<textarea class="pab-form__textarea" name="notes">' + _esc(val('notes', '')) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="pab-form__actions">' +
          (status && status.state === 'draft' ?
            '<button type="button" class="pab-form__cancel" data-pab-remove>Remove draft</button>' : '') +
          '<button type="button" class="pab-form__cancel" data-pab-cancel>Cancel</button>' +
          '<button type="button" class="pab-form__save" data-pab-save>' +
            (status && (status.state === 'draft' || status.state === 'canonical') ? 'Save changes' : 'Add to pipeline') +
          '</button>' +
        '</div>' +
        '<p class="pab-msg" data-pab-msg></p>' +
      '</div>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    if (!window.PipelineStore) {
      container.innerHTML = '<p style="font-size:.78rem;color:var(--muted)">' +
        'Pipeline store not loaded — include js/components/pipeline-store.js first.</p>';
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'pab-wrap';
    container.innerHTML = '';
    container.appendChild(wrap);

    function _render() {
      _currentStatusFor(opts.geoid).then(function (status) {
        var btnLabel, btnClass = 'pab-btn';
        if (status.state === 'canonical') { btnLabel = '✓ In pipeline · Edit'; btnClass += ' pab-btn--inpipe'; }
        else if (status.state === 'draft') { btnLabel = '✎ Draft saved · Edit'; btnClass += ' pab-btn--draft'; }
        else { btnLabel = '+ Add to IndiBuild Pipeline'; }

        wrap.innerHTML = '<button type="button" class="' + btnClass + '" data-pab-open>' + btnLabel + '</button>' +
          (status.state === 'canonical' || status.state === 'draft'
            ? '<span class="pab-state">' + (status.state === 'canonical'
                ? 'Stage: ' + _esc(status.row.stage || '—') + ' · IOI ' + _esc(status.row.ioi_score || '—')
                : 'Local draft — export from the pipeline page to commit to CSV')
              + '</span>'
            : '');

        wrap.querySelector('[data-pab-open]').addEventListener('click', function () {
          // Toggle form
          var form = wrap.querySelector('[data-pab-form]');
          if (form) { form.remove(); return; }
          wrap.insertAdjacentHTML('beforeend', _buildForm(opts, status));
          _wireForm(wrap, opts, status, _render);
        });
      });
    }

    _render();
  }

  function _wireForm(wrap, opts, status, onChange) {
    var form = wrap.querySelector('[data-pab-form]');
    if (!form) return;
    var msg = form.querySelector('[data-pab-msg]');
    function setMsg(text, ok) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.className = 'pab-msg' + (ok ? ' pab-msg--ok' : '');
    }

    form.querySelector('[data-pab-cancel]').addEventListener('click', function () {
      form.remove();
    });

    var removeBtn = form.querySelector('[data-pab-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        if (!confirm('Remove this draft from local pipeline?')) return;
        window.PipelineStore.removeDraft(opts.geoid);
        form.remove();
        onChange();
      });
    }

    form.querySelector('[data-pab-save]').addEventListener('click', function () {
      var fields = form.querySelectorAll('[name]');
      var data = {};
      fields.forEach(function (el) { data[el.name] = el.value; });
      if (!data.jurisdiction || !data.geoid) {
        setMsg('Jurisdiction + GEOID are required.', false);
        return;
      }

      if (status && status.state === 'canonical') {
        // Save as an edit overlay on the canonical row (don't duplicate)
        var diff = {};
        Object.keys(data).forEach(function (k) {
          if ((status.row[k] || '') !== (data[k] || '')) diff[k] = data[k];
        });
        if (!Object.keys(diff).length) {
          setMsg('No changes to save.', false);
          return;
        }
        window.PipelineStore.editCanonical(data.geoid, diff);
        setMsg('Saved local edits to canonical row. Export from the pipeline page to commit.', true);
      } else {
        window.PipelineStore.addDraft(data);
        setMsg('Saved as local draft. Export from the pipeline page to commit to CSV.', true);
      }

      setTimeout(function () { form.remove(); onChange(); }, 600);
    });
  }

  global.PipelineAddButton = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
