/**
 * sunday-digest.js — renders the Sunday digest of Colorado housing news.
 *
 * Reads data/news-digest/index.json (list of editions) and the edition's
 * Markdown file, and renders it with a small, escape-first Markdown reader.
 * Only the Markdown the digest uses is supported: headings, paragraphs,
 * bullet and numbered lists (one nested level), rules, bold, italic, inline
 * code and links. Every character of the source is HTML-escaped before any
 * markup is added, and links are kept only when they point to http(s) or to a
 * relative path, so an edition cannot inject script.
 *
 * ?date=YYYY-MM-DD shows that edition; the default is the newest.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Link targets allowed in an edition: absolute http(s), or a relative path
  // with no scheme (a colon before the first slash means a scheme).
  function safeHref(raw) {
    var href = String(raw).trim();
    if (/^https?:\/\//i.test(href)) return href;
    // Relative only: no scheme, and not protocol-relative (//host) or a backslash path.
    if (href.indexOf(':') === -1 && !/^[\/\\]{2}/.test(href) && href.indexOf('\\') === -1) return href;
    return null;
  }

  function inline(text) {
    // Pull out code spans first so their contents are not formatted.
    var codes = [];
    var s = String(text).replace(/`([^`]+)`/g, function (_, c) {
      codes.push('<code>' + esc(c) + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // Links: [label](url). Labels are formatted; URLs are checked.
    var links = [];
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var href = safeHref(url);
      var inner = fmt(esc(label));
      if (!href) {
        links.push(inner);
      } else {
        var external = /^https?:\/\//i.test(href);
        links.push('<a href="' + esc(href) + '"' +
          (external ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>');
      }
      return '\u0001' + (links.length - 1) + '\u0001';
    });
    s = fmt(esc(s));
    s = s.replace(/\u0001(\d+)\u0001/g, function (_, i) { return links[+i]; });
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
    return s;
  }

  // Bold and italic on already-escaped text.
  function fmt(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  }

  /** Markdown string -> HTML string. Exported for tests. */
  function render(md) {
    var lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var para = [];
    var list = null;      // { tag, items: [{ html, kids: null | {tag, items} }] }

    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function listHtml(l) {
      return '<' + l.tag + '>' + l.items.map(function (it) {
        return '<li>' + it.html + (it.kids ? listHtml(it.kids) : '') + '</li>';
      }).join('') + '</' + l.tag + '>';
    }
    function flushList() {
      if (list) { out.push(listHtml(list)); list = null; }
    }

    lines.forEach(function (line) {
      var m;
      if (!line.trim()) { flushPara(); return; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara(); flushList();
        // The edition's h1 becomes the page title (removed before rendering),
        // so ## sections are the page's h2s.
        var level = Math.max(m[1].length, 2);
        out.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
        return;
      }
      if (/^\s*-{3,}\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); return; }
      if ((m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line))) {
        flushPara();
        var indent = m[1].length;
        var tag = /\d/.test(m[2]) ? 'ol' : 'ul';
        var item = { html: inline(m[3]), kids: null };
        if (indent >= 2 && list && list.items.length) {
          var parent = list.items[list.items.length - 1];
          if (!parent.kids) parent.kids = { tag: tag, items: [] };
          parent.kids.items.push(item);
        } else {
          if (list && list.tag !== tag) flushList();
          if (!list) list = { tag: tag, items: [] };
          list.items.push(item);
        }
        return;
      }
      if (/^\s{2,}\S/.test(line) && list && list.items.length) {
        // Continuation text under a list item.
        list.items[list.items.length - 1].html += '<p>' + inline(line.trim()) + '</p>';
        return;
      }
      flushList();
      para.push(line.trim());
    });
    flushPara(); flushList();
    return out.join('\n');
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function resolve(p) {
    return typeof window.resolveAssetUrl === 'function' ? window.resolveAssetUrl(p) : p;
  }

  function init() {
    var body = document.getElementById('digestBody');
    var titleEl = document.getElementById('digestTitle');
    var listEl = document.getElementById('digestEditions');
    var statusEl = document.getElementById('digestStatus');
    if (!body) return;

    var want = (new URLSearchParams(location.search).get('date') || '').trim();

    fetch(resolve('data/news-digest/index.json'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .then(function (idx) {
        var eds = (idx.editions || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        if (!eds.length) throw new Error('no editions');
        var ed = eds.filter(function (e) { return e.date === want; })[0] || eds[0];

        if (listEl) {
          listEl.innerHTML = eds.map(function (e) {
            var cur = e.date === ed.date;
            return '<li><a href="sunday-digest.html?date=' + esc(e.date) + '"' +
              (cur ? ' aria-current="page"' : '') + '>' + esc(fmtDate(e.window_start)) +
              ' – ' + esc(fmtDate(e.window_end)) + '</a></li>';
          }).join('');
        }

        return fetch(resolve(ed.file), { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error('edition ' + r.status); return r.text(); })
          .then(function (md) {
            var lines = md.split('\n');
            var h1 = lines.findIndex(function (l) { return /^#\s+/.test(l); });
            var title = h1 >= 0 ? lines[h1].replace(/^#\s+/, '') : ed.title;
            if (h1 >= 0) lines.splice(h1, 1);
            if (titleEl) titleEl.textContent = title;
            document.title = title + ' | COHO Analytics';
            body.innerHTML = render(lines.join('\n'));
            if (statusEl) statusEl.textContent = '';
          });
      })
      .catch(function () {
        if (statusEl) statusEl.textContent = 'The digest could not be loaded. Try again later, or see Housing News.';
      });
  }

  if (typeof window !== 'undefined') {
    window.SundayDigest = { render: render, safeHref: safeHref };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { render: render, safeHref: safeHref };
})();
