/* ------------------------------------------------------------
 * data-explorer.js
 *
 * Browse every JSON / GeoJSON / CSV file in data/. Reads the
 * data/_manifest.json produced by scripts/audit/build-data-manifest.mjs
 * and renders a directory tree + filterable file table + preview pane.
 *
 * No build step — vanilla ES module-less classic script. Designed to
 * coexist with the other defer-loaded site scripts.
 * ------------------------------------------------------------ */
(() => {
  'use strict';

  const MANIFEST_URL = 'data/_manifest.json';
  const RAW_PREVIEW_LINES = 200;
  const RAW_PREVIEW_BYTES = 256 * 1024;            // hard cap 256 KB

  const state = {
    files: [],
    meta: null,
    activeDir: '',                                  // '' = all
    activeKinds: new Set(['all']),
    search: '',
    sort: 'path-asc',
    activeFile: null,
    previewTab: 'schema',
  };

  // ---------- formatting helpers ----------
  const fmtBytes = (n) => {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };
  const fmtCount = (n) => Number.isFinite(n) ? n.toLocaleString() : '—';
  const fmtTime = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const now = Date.now();
      const days = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 0) return `today`;
      if (days === 1) return `1 day ago`;
      if (days < 30) return `${days} days ago`;
      if (days < 365) return `${Math.floor(days / 30)} mo ago`;
      return `${Math.floor(days / 365)} yr ago`;
    } catch { return iso; }
  };
  const fmtTimeAbs = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // ---------- DOM helpers ----------
  const $  = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v == null || v === false) continue;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  // ---------- file-record helpers ----------
  function schemaSnippet(f) {
    if (!f) return '';
    if (f.kind === 'csv' && Array.isArray(f.columns)) {
      return f.columns.slice(0, 6).join(', ') + (f.column_count > 6 ? ` (+${f.column_count - 6})` : '');
    }
    if (f.kind === 'geojson' && Array.isArray(f.property_keys)) {
      const t = f.geometry_type ? `${f.geometry_type} · ` : '';
      return t + f.property_keys.slice(0, 6).join(', ');
    }
    if (f.shape === 'array' && Array.isArray(f.first_keys)) {
      return `[${f.first_keys.slice(0, 6).join(', ')}…]`;
    }
    if (f.shape === 'object') {
      if (f.primary_array_key && Array.isArray(f.primary_array_first_keys)) {
        return `${f.primary_array_key}[${f.primary_array_first_keys.slice(0, 5).join(', ')}]`;
      }
      if (Array.isArray(f.keys)) {
        return f.keys.slice(0, 8).join(', ');
      }
    }
    if (f.error) return '⚠ ' + f.error.slice(0, 80);
    if (f.note)  return f.note;
    return '';
  }

  function recordCount(f) {
    if (!f) return null;
    if (f.kind === 'csv') return f.row_count ?? null;
    if (f.kind === 'geojson') return f.feature_count ?? null;
    if (f.shape === 'array') return f.length ?? null;
    if (f.shape === 'object') return f.primary_array_length ?? null;
    return null;
  }

  function topDir(path) {
    const idx = path.indexOf('/');
    return idx < 0 ? '__root__' : path.slice(0, idx);
  }

  // ---------- filter + sort ----------
  function filteredFiles() {
    const q = state.search.trim().toLowerCase();
    return state.files.filter((f) => {
      if (state.activeDir) {
        if (state.activeDir === '__root__') {
          if (f.path.includes('/')) return false;
        } else if (!f.path.startsWith(state.activeDir + '/')) {
          return false;
        }
      }
      if (!state.activeKinds.has('all') && !state.activeKinds.has(f.kind)) return false;
      if (q) {
        const hay = (
          f.path + ' ' +
          (f.columns?.join(' ') || '') + ' ' +
          (f.keys?.join(' ') || '') + ' ' +
          (f.first_keys?.join(' ') || '') + ' ' +
          (f.primary_array_first_keys?.join(' ') || '') + ' ' +
          (f.property_keys?.join(' ') || '') + ' ' +
          (f.primary_array_key || '')
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortedFiles(files) {
    const cmp = {
      'path-asc':     (a, b) => a.path.localeCompare(b.path),
      'path-desc':    (a, b) => b.path.localeCompare(a.path),
      'mtime-desc':   (a, b) => (b.mtime || '').localeCompare(a.mtime || ''),
      'mtime-asc':    (a, b) => (a.mtime || '').localeCompare(b.mtime || ''),
      'size-desc':    (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0),
      'size-asc':     (a, b) => (a.size_bytes || 0) - (b.size_bytes || 0),
      'records-desc': (a, b) => (recordCount(b) || 0) - (recordCount(a) || 0),
    }[state.sort] || ((a, b) => a.path.localeCompare(b.path));
    return [...files].sort(cmp);
  }

  // ---------- renderers ----------
  function renderStats() {
    if (!state.meta) return;
    $('#dexStatFiles').textContent = fmtCount(state.meta.file_count);
    $('#dexStatSize').textContent  = fmtBytes(state.meta.total_size_bytes);
    $('#dexStatJson').textContent  = fmtCount(state.meta.kinds?.json || 0);
    $('#dexStatGeo').textContent   = fmtCount(state.meta.kinds?.geojson || 0);
    $('#dexStatCsv').textContent   = fmtCount(state.meta.kinds?.csv || 0);
    const meta = $('#dexManifestMeta');
    if (meta && state.meta.generated_at) {
      meta.textContent = ` Manifest generated ${fmtTimeAbs(state.meta.generated_at)} · rebuild with node scripts/audit/build-data-manifest.mjs`;
    }
  }

  function renderTree() {
    const container = $('#dexTree');
    container.innerHTML = '';
    const counts = new Map();
    for (const f of state.files) {
      const d = topDir(f.path);
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    // 'All' row
    container.appendChild(el('div', {
      class: 'dex-tree-node' + (state.activeDir === '' ? ' active' : ''),
      role: 'treeitem',
      onclick: () => { state.activeDir = ''; renderTree(); renderRows(); },
    },
      el('span', { class: 'dex-tree-twirl' }, '·'),
      el('span', { class: 'dex-tree-name' }, 'All files'),
      el('span', { class: 'dex-tree-count' }, String(state.files.length)),
    ));
    const dirs = [...counts.keys()].sort((a, b) => {
      if (a === '__root__') return -1;
      if (b === '__root__') return 1;
      return a.localeCompare(b);
    });
    for (const d of dirs) {
      const label = d === '__root__' ? '(root)' : d + '/';
      container.appendChild(el('div', {
        class: 'dex-tree-node' + (state.activeDir === d ? ' active' : ''),
        role: 'treeitem',
        onclick: () => { state.activeDir = d; renderTree(); renderRows(); },
      },
        el('span', { class: 'dex-tree-twirl' }, '▸'),
        el('span', { class: 'dex-tree-name' }, label),
        el('span', { class: 'dex-tree-count' }, String(counts.get(d))),
      ));
    }
  }

  function renderRows() {
    const visible = sortedFiles(filteredFiles());
    $('#dexStatVisible').textContent = fmtCount(visible.length);
    const tbody = $('#dexRows');
    tbody.innerHTML = '';
    if (!visible.length) {
      tbody.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'dex-empty' }, 'No files match these filters.')));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const f of visible) {
      const isActive = state.activeFile && state.activeFile.path === f.path;
      const tr = el('tr', {
        class: isActive ? 'active' : '',
        onclick: () => openPreview(f),
      });
      // path cell
      const lastSlash = f.path.lastIndexOf('/');
      const dirPart  = lastSlash >= 0 ? f.path.slice(0, lastSlash + 1) : '';
      const filePart = lastSlash >= 0 ? f.path.slice(lastSlash + 1) : f.path;
      tr.appendChild(el('td', { class: 'dex-path-cell' },
        el('span', { class: 'dex-path-dir' }, dirPart),
        el('span', { class: 'dex-path-file' }, filePart),
      ));
      tr.appendChild(el('td', {}, el('span', { class: 'dex-kind-pill ' + (f.kind || '') }, (f.kind || '?').toUpperCase())));
      tr.appendChild(el('td', { class: 'dex-num' }, fmtBytes(f.size_bytes)));
      tr.appendChild(el('td', { class: 'dex-mtime', title: fmtTimeAbs(f.mtime) }, fmtTime(f.mtime)));
      const rc = recordCount(f);
      tr.appendChild(el('td', { class: 'dex-num' }, rc == null ? '—' : fmtCount(rc)));
      tr.appendChild(el('td', { class: 'dex-keys', title: schemaSnippet(f) }, schemaSnippet(f)));
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  // ---------- preview ----------
  function buildMetaDl(f) {
    const rc = recordCount(f);
    const pairs = [
      ['Path',       f.path],
      ['Kind',       (f.kind || '?').toUpperCase()],
      ['Size',       fmtBytes(f.size_bytes)],
      ['Modified',   fmtTimeAbs(f.mtime) + (f.mtime ? ` (${fmtTime(f.mtime)})` : '')],
      ['Records',    rc == null ? '—' : fmtCount(rc)],
    ];
    if (f.kind === 'csv') {
      pairs.push(['Columns', f.column_count == null ? '—' : `${f.column_count} (${(f.columns || []).slice(0, 8).join(', ')}${(f.columns || []).length > 8 ? '…' : ''})`]);
    } else if (f.kind === 'geojson') {
      pairs.push(['Geometry type', f.geometry_type || '—']);
      if (Array.isArray(f.property_keys)) {
        pairs.push(['Property keys', f.property_keys.join(', ')]);
      }
    } else if (f.shape === 'object') {
      pairs.push(['Top-level keys', (f.keys || []).join(', ') + (f.key_count > (f.keys || []).length ? ` (+${f.key_count - (f.keys || []).length})` : '')]);
      if (f.primary_array_key) {
        pairs.push(['Primary array', `${f.primary_array_key}[${fmtCount(f.primary_array_length)}]`]);
        if (Array.isArray(f.primary_array_first_keys)) {
          pairs.push(['Array item keys', f.primary_array_first_keys.join(', ')]);
        }
      }
    } else if (f.shape === 'array') {
      pairs.push(['Array length', fmtCount(f.length)]);
      if (Array.isArray(f.first_keys)) {
        pairs.push(['Item keys', f.first_keys.join(', ')]);
      }
    }
    if (f.error) pairs.push(['Error', f.error]);
    if (f.note)  pairs.push(['Note',  f.note]);
    const dl = $('#dexPreviewMeta');
    dl.innerHTML = '';
    for (const [k, v] of pairs) {
      dl.appendChild(el('dt', {}, k));
      dl.appendChild(el('dd', {}, String(v ?? '—')));
    }
  }

  async function openPreview(f) {
    state.activeFile = f;
    state.previewTab = 'schema';
    $('#dexPreviewTitle').textContent = f.path;
    $('#dexPreviewSub').textContent = `${(f.kind || '?').toUpperCase()} · ${fmtBytes(f.size_bytes)} · modified ${fmtTimeAbs(f.mtime)}`;
    buildMetaDl(f);
    const rawUrl = 'data/' + f.path;
    $('#dexOpenRaw').href  = rawUrl;
    $('#dexDownload').href = rawUrl;
    $('#dexDownload').setAttribute('download', f.path.split('/').pop());
    document.querySelectorAll('.dex-preview-actions .dex-tab-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === 'schema');
    });
    showSchemaTab(f);
    $('#dexPreview').removeAttribute('hidden');
    $('#dexPreview').classList.add('open');
    $('#dexBackdrop').classList.add('open');
    $('#dexBackdrop').setAttribute('aria-hidden', 'false');
    renderRows(); // re-render to highlight active row
  }

  function closePreview() {
    state.activeFile = null;
    const p = $('#dexPreview');
    p.classList.remove('open');
    p.setAttribute('hidden', '');
    $('#dexBackdrop').classList.remove('open');
    $('#dexBackdrop').setAttribute('aria-hidden', 'true');
    renderRows();
  }

  function showSchemaTab(f) {
    const body = $('#dexPreviewBody');
    body.innerHTML = '';
    // Show full schema details from manifest
    const meta = el('div', {});
    const pre = el('pre', {}, JSON.stringify(f, null, 2));
    meta.appendChild(pre);
    body.appendChild(meta);
  }

  async function showRawTab(f) {
    const body = $('#dexPreviewBody');
    body.innerHTML = '<div class="dex-loading">Loading file…</div>';
    const url = 'data/' + f.path;
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Stream up to RAW_PREVIEW_BYTES, then bail.
      let text = '';
      if (resp.body && typeof resp.body.getReader === 'function') {
        const reader = resp.body.getReader();
        const dec = new TextDecoder('utf-8');
        let received = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          text += dec.decode(value, { stream: true });
          if (received >= RAW_PREVIEW_BYTES) { try { reader.cancel(); } catch {} break; }
        }
      } else {
        text = await resp.text();
        if (text.length > RAW_PREVIEW_BYTES) text = text.slice(0, RAW_PREVIEW_BYTES);
      }
      let display = text;
      // For JSON / GeoJSON pretty-print if small enough
      if ((f.kind === 'json' || f.kind === 'geojson') && text.length < 200_000) {
        try { display = JSON.stringify(JSON.parse(text), null, 2); }
        catch { /* keep raw */ }
      }
      const lines = display.split(/\r?\n/);
      const truncated = lines.length > RAW_PREVIEW_LINES;
      display = lines.slice(0, RAW_PREVIEW_LINES).join('\n');
      body.innerHTML = '';
      if (truncated) {
        body.appendChild(el('div', { class: 'dex-mtime', style: 'margin-bottom:.5rem;color:var(--muted);font-size:.78rem' },
          `Showing first ${RAW_PREVIEW_LINES} lines · open the raw file to see the rest`));
      }
      body.appendChild(el('pre', {}, display));
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'dex-empty' }, `Could not load file: ${e.message || e}`));
    }
  }

  // ---------- bootstrap ----------
  async function loadManifest() {
    const url = (window.PathResolver && window.PathResolver.fromRoot)
      ? window.PathResolver.fromRoot(MANIFEST_URL)
      : MANIFEST_URL;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not load ${MANIFEST_URL} (HTTP ${r.status}). Run: node scripts/audit/build-data-manifest.mjs`);
    return r.json();
  }

  function attachListeners() {
    $('#dexSearch').addEventListener('input', (e) => {
      state.search = e.target.value || '';
      renderRows();
    });
    document.querySelectorAll('.dex-chip[data-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.kind;
        if (k === 'all') {
          state.activeKinds = new Set(['all']);
        } else {
          state.activeKinds.delete('all');
          if (state.activeKinds.has(k)) state.activeKinds.delete(k);
          else state.activeKinds.add(k);
          if (state.activeKinds.size === 0) state.activeKinds = new Set(['all']);
        }
        document.querySelectorAll('.dex-chip[data-kind]').forEach((b) => {
          const on = state.activeKinds.has(b.dataset.kind);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderRows();
      });
    });
    $('#dexSort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderRows();
    });
    $('#dexPreviewClose').addEventListener('click', closePreview);
    $('#dexBackdrop').addEventListener('click', closePreview);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.activeFile) closePreview();
    });
    document.querySelectorAll('.dex-preview-actions .dex-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.activeFile) return;
        const tab = btn.dataset.tab;
        state.previewTab = tab;
        document.querySelectorAll('.dex-preview-actions .dex-tab-btn').forEach((b) => {
          b.classList.toggle('on', b.dataset.tab === tab);
        });
        if (tab === 'schema') showSchemaTab(state.activeFile);
        else showRawTab(state.activeFile);
      });
    });
  }

  async function init() {
    attachListeners();
    try {
      const m = await loadManifest();
      state.meta  = m.meta || {};
      state.files = (m.files || []).filter((f) => f && f.path);
      renderStats();
      renderTree();
      renderRows();
    } catch (e) {
      const tbody = $('#dexRows');
      tbody.innerHTML = '';
      tbody.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'dex-empty' }, String(e.message || e))));
      $('#dexTree').innerHTML = '<div class="dex-empty" style="padding:1rem .5rem;font-size:.82rem;">Manifest unavailable.</div>';
      console.error('[data-explorer] failed to load manifest:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
