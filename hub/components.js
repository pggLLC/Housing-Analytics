// Shared pieces for the rebuilt hubs: a pinned-file loader, sortable and filterable tables, a bar list,
// and the chapter frame (what the screen answers, the finding, the next step). No figures are made here;
// every value comes from the caller, as the source file publishes it.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;

  var num = function (n) { return n == null ? null : Math.round(n).toLocaleString('en-US'); };
  var money = function (n) { return n == null ? null : '$' + Math.round(n).toLocaleString('en-US'); };
  var millions = function (n) { return n == null ? null : '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' million'; };

  // One load per set of files; the view re-renders when they arrive.
  var sets = {};
  function load(files) {
    var key = Object.keys(files).map(function (k) { return files[k]; }).join('|');
    var s = sets[key];
    // A failed load is retried the next time a page asks for it, not kept until a full reload.
    if (s && s.error && Date.now() - s.failedAt > 5000) s = null;
    if (!s) {
      s = sets[key] = { data: null, error: null };
      var keys = Object.keys(files);
      Promise.all(keys.map(function (k) {
        return fetch(VENDOR + files[k]).then(function (r) { if (!r.ok) throw new Error(files[k] + ' ' + r.status); return r.json(); });
      })).then(function (all) {
        s.data = {};
        keys.forEach(function (k, i) { s.data[k] = all[i]; });
        Shell.render();
      }).catch(function (e) {
        s.error = 'The data did not load (' + e.message + '). Open this page again in a few seconds to retry.'; s.failedAt = Date.now();
        Shell.render();
      });
    }
    return s;
  }

  // The frame every rebuilt screen shares: what it answers, then the plain finding.
  function intro(ask, finding) {
    return '<div class="chapter-intro"><p class="chapter-ask">' + esc(ask) + '</p>' +
      (finding ? '<p class="chapter-finding">' + esc(finding) + '</p>' : '') + '</div>';
  }

  // links: [{href, label, secondary}]
  function next(links) {
    return '<div class="next-step"><p><strong>Next</strong></p><div class="actions">' + links.map(function (l) {
      return '<a class="button-link' + (l.secondary ? ' secondary' : '') + '" href="' + esc(l.href) + '">' + esc(l.label) + '</a>';
    }).join('') + '</div></div>';
  }

  // A card that is also the way into a tool.
  // The title link covers the whole card; the source link sits above it, so both can be followed.
  function linkCard(href, title, value, detail, source, url) {
    return '<div class="metric metric-link"><a class="metric-main" href="' + esc(href) + '"><span class="metric-label">' + esc(title) + '</span>' +
      '<span class="metric-value">' + esc(value == null ? 'Not published' : value) + '</span>' +
      (detail ? '<span class="metric-detail">' + esc(detail) + '</span>' : '') + '</a>' +
      '<p class="metric-source">' + (url ? '<a href="' + esc(url) + '" rel="noopener">' + esc(source) + '</a>' : esc(source)) + '</p>' +
      '<span class="metric-go" aria-hidden="true">Open →</span></div>';
  }

  // rows: [[label, value]]; fmt formats the value; cls picks the series fill.
  function bars(title, note, rows, fmt, cls) {
    if (!rows.length || rows.every(function (r) { return r[1] == null; })) return '<p class="note">' + esc(title) + ': not published.</p>';
    var max = Math.max.apply(null, rows.map(function (r) { return r[1] || 0; })) || 1;
    return '<figure class="gap-chart"><figcaption><strong>' + esc(title) + '</strong>' + (note ? '<span class="note">' + esc(note) + '</span>' : '') + '</figcaption>' +
      '<div class="gap-rows">' + rows.map(function (r) {
        var w = r[1] == null ? 0 : r[1] / max * 100;
        var shown = r[1] == null ? 'Not published' : fmt(r[1]);
        return '<div class="gap-row"><p class="gap-band">' + esc(r[0]) + '</p><div class="bar-row">' +
          '<span class="bar ' + (cls || 'homes') + '" style="width:calc((100% - 7rem) * ' + (w / 100).toFixed(4) + ')" title="' + esc(r[0] + ': ' + shown) + '"></span>' +
          '<span class="bar-value">' + esc(shown) + '</span></div></div>';
      }).join('') + '</div></figure>';
  }

  // Sum a field by a key, largest first.
  function tally(items, keyOf, valueOf) {
    var t = {};
    items.forEach(function (x) { var k = keyOf(x); if (k == null || k === '') return; t[k] = (t[k] || 0) + (valueOf ? valueOf(x) || 0 : 1); });
    return Object.keys(t).map(function (k) { return [k, t[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }

  // A table's sort and filter live in the address (sort.<id>=<column>.<a|d>, filter.<id>=<text>), so Back
  // and a copied link return to the same view. The address is replaced, not pushed, so each click is not a page.
  function hashParams() {
    var raw = (location.hash || '#/').slice(1), q = raw.indexOf('?');
    return { path: q > -1 ? raw.slice(0, q) : raw, params: new URLSearchParams(q > -1 ? raw.slice(q + 1) : '') };
  }
  function keep(key, value) {
    var h = hashParams();
    if (value == null || value === '') h.params.delete(key); else h.params.set(key, value);
    var qs = h.params.toString();
    history.replaceState(null, '', '#' + h.path + (qs ? '?' + qs : ''));
  }
  function compare(x, y, isNum, dir) {
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    var r = isNum ? Number(x) - Number(y) : x.localeCompare(y);
    return dir === 'ascending' ? r : -r;
  }

  // A sortable, filterable table. cols: [{key, label, tip, num, fmt, href, more}]. Sorting and filtering happen in
  // the page, so a long list never re-renders; header buttons carry the column's explanation as a tooltip.
  // more(row) adds finished HTML after the cell's text (source links, say); the caller escapes it.
  function table(id, caption, cols, rows, opts) {
    opts = opts || {};
    var here = hashParams().params;
    var sortAt = /^(\d+)\.([ad])$/.exec(here.get('sort.' + id) || '');
    var sortCol = sortAt && cols[Number(sortAt[1])] ? Number(sortAt[1]) : -1;
    var sortDir = sortAt && sortAt[2] === 'a' ? 'ascending' : 'descending';
    var filter = (here.get('filter.' + id) || '').trim();
    var raw = function (r, c) { return r[c.key] == null ? '' : String(r[c.key]); };
    var textOf = function (r) { return cols.map(function (c) { return r[c.key] == null ? '' : r[c.key]; }).join(' ').toLowerCase(); };
    if (sortCol > -1) {
      rows = rows.slice().sort(function (a, b) { return compare(raw(a, cols[sortCol]), raw(b, cols[sortCol]), !!cols[sortCol].num, sortDir); });
    }
    var shownCount = filter ? rows.filter(function (r) { return textOf(r).indexOf(filter.toLowerCase()) > -1; }).length : rows.length;
    var cell = function (c, r) {
      var v = r[c.key];
      var shown = v == null || v === '' ? '—' : c.fmt ? c.fmt(v, r) : String(v);
      var inner = c.href && c.href(r) ? '<a href="' + esc(c.href(r)) + '">' + esc(shown) + '</a>' : esc(shown);
      var cls = (c.num ? 'num ' : '') + (c.cls ? c.cls(r) || '' : '');
      return '<td' + (cls.trim() ? ' class="' + esc(cls.trim()) + '"' : '') + ' data-v="' + esc(v == null ? '' : v) + '">' + inner + (c.more ? c.more(r) || '' : '') + '</td>';
    };
    // Long lists show their first rows and a button for the rest, so the page leads with its charts; a filter
    // or sort always searches every row.
    var clipAt = opts.clip === false ? 0 : opts.clip || 20, clipped = clipAt && rows.length > clipAt + 5 && !filter;
    return '<div class="data-table' + (clipped ? ' clipped' : '') + '" data-table="' + esc(id) + '">' +
      '<div class="table-tools"><label for="' + esc(id) + '-q">Filter ' + esc(opts.noun || 'rows') + '</label>' +
      '<input id="' + esc(id) + '-q" type="search" autocomplete="off" data-filter="' + esc(id) + '" value="' + esc(filter) + '" placeholder="' + esc(opts.placeholder || 'Name, city or county') + '">' +
      '<p class="count" role="status" data-count="' + esc(id) + '">' + (filter ? num(shownCount) + ' of ' : '') + num(rows.length) + ' ' + esc(opts.noun || 'rows') + '</p></div>' +
      '<div class="table-scroll"><table><caption>' + esc(caption) + '</caption><thead><tr>' + cols.map(function (c, i) {
        return '<th scope="col"' + (c.num ? ' class="num"' : '') + ' aria-sort="' + (i === sortCol ? sortDir : 'none') + '"><button type="button" data-sort="' + i + '"' + (c.num ? ' data-num="1"' : '') +
          (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + esc(c.label) + '</button></th>';
      }).join('') + '</tr></thead><tbody>' + rows.map(function (r, i) {
        var text = textOf(r);
        return '<tr data-text="' + esc(text) + '"' + (i >= clipAt ? ' data-extra="1"' : '') + (filter && text.indexOf(filter.toLowerCase()) < 0 ? ' hidden' : '') + '>' + cols.map(function (c) { return cell(c, r); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      (clipped ? '<button type="button" class="quiet show-all" data-unclip="' + esc(id) + '">Show all ' + num(rows.length) + ' ' + esc(opts.noun || 'rows') + '</button>' : '') + '</div>';
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.data-table th button[data-sort]');
    if (!b) return;
    var th = b.parentNode, tr = th.parentNode, tbl = tr.closest('table'), body = tbl.tBodies[0];
    var i = Number(b.dataset.sort), isNum = !!b.dataset.num;
    var dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
    if (!isNum && th.getAttribute('aria-sort') === 'none') dir = 'ascending';
    Array.prototype.forEach.call(tr.children, function (x) { x.setAttribute('aria-sort', 'none'); });
    th.setAttribute('aria-sort', dir);
    var rows = Array.prototype.slice.call(body.rows);
    rows.sort(function (a, c) { return compare(a.cells[i].dataset.v, c.cells[i].dataset.v, isNum, dir); });
    rows.forEach(function (r) { body.appendChild(r); });
    keep('sort.' + tbl.closest('.data-table').dataset.table, i + '.' + (dir === 'ascending' ? 'a' : 'd'));
  });
  function unclip(wrap) {
    if (!wrap || !wrap.classList.contains('clipped')) return;
    wrap.classList.remove('clipped');
    var b = wrap.querySelector('[data-unclip]'); if (b) b.remove();
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-unclip]');
    if (b) unclip(b.closest('.data-table'));
    var s = ev.target.closest && ev.target.closest('.data-table th button[data-sort]');
    if (s) unclip(s.closest('.data-table'));
  });
  document.addEventListener('input', function (ev) {
    var id = ev.target.dataset && ev.target.dataset.filter;
    if (!id) return;
    var q = ev.target.value.trim().toLowerCase(), shown = 0;
    var wrap = document.querySelector('[data-table="' + id + '"]');
    if (q) unclip(wrap);
    Array.prototype.forEach.call(wrap.querySelectorAll('tbody tr'), function (r) {
      var on = !q || r.dataset.text.indexOf(q) > -1;
      r.hidden = !on; if (on) shown++;
    });
    var total = wrap.querySelectorAll('tbody tr').length;
    keep('filter.' + id, ev.target.value.trim());
    wrap.querySelector('[data-count]').textContent = (q ? num(shown) + ' of ' : '') + num(total) + ' ' + (wrap.querySelector('label').textContent.replace(/^Filter /, ''));
  });

  // Find the lab place page for a town name, so a property can lead to its place's HNA.
  function placeFor(name) {
    if (!name) return null;
    var n = String(name).trim().toLowerCase();
    var hit = Shell.catalog().entries.filter(function (e) { return e.geoid && e.label && e.label.toLowerCase() === n; })[0];
    return hit ? '#/place/' + hit.geoid : null;
  }

  global.LabUI = { load: load, intro: intro, next: next, linkCard: linkCard, bars: bars, tally: tally, table: table, placeFor: placeFor, num: num, money: money, millions: millions };
})(window);
