// The four page templates' shared parts: breadcrumbs, the page head with its one-line answer and
// key facts, the "on this page" list, and the Next box. Views build their pages from these.
(function (global) {
  'use strict';

  var esc = function (s) { return global.LabShell.esc(s); };
  var KINDS = { guide: 'Guide', brief: 'Research brief', data: 'Data', tool: 'Tool', place: 'Place', hub: 'Section' };

  // crumbs: [{ label, href }], last one is the current page and is not linked.
  function crumbs(list) {
    return '<nav class="crumbs" aria-label="Breadcrumb"><ol>' + list.map(function (c, i) {
      return '<li>' + (i < list.length - 1 && c.href ? '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a>' : '<span aria-current="page">' + esc(c.label) + '</span>') + '</li>';
    }).join('') + '</ol></nav>';
  }

  // A trail for a page under one of the five menus.
  function trail(menuId, page, extra) {
    var m = global.LabNav.MENUS.filter(function (x) { return x.id === menuId; })[0];
    return [{ label: 'Home', href: '#/' }, { label: m.title, href: m.hub }].concat(extra || [], page ? [{ label: page }] : []);
  }

  // facts: [{ value, label, source, href }]. Each fact names its source; a fact without one is not shown.
  function factStrip(facts) {
    var shown = (facts || []).filter(function (f) { return f.value != null && f.source; });
    if (!shown.length) return '';
    return '<ul class="fact-strip">' + shown.map(function (f) {
      return '<li><span class="fact-value">' + esc(f.value) + '</span><span class="fact-label">' + esc(f.label) + '</span>' +
        '<span class="fact-source">' + (f.href ? '<a href="' + esc(f.href) + '">' + esc(f.source) + '</a>' : esc(f.source)) + '</span></li>';
    }).join('') + '</ul>';
  }

  // o: { kind, crumbs, title, answer, meta, facts, aside }
  // Currency stamp (paul 11-09: every generated page is dated). o.dated: the files a page drew from, as loaded;
  // the stamp is the newest build or check date any of them states. o.datedWord overrides "Data updated".
  var DATE_KEY = /^(generated|generated_at|generatedAt|updated|lastUpdated|last_updated|as_of|asOf|pulled_at_utc|fetched|fetched_at|fetchedAt|built|built_at|last_verified|verified)$/;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function newest(files) {
    var best = '';
    function look(o, depth) {
      if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 1) return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (DATE_KEY.test(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 10) > best && v.slice(0, 10) <= new Date().toISOString().slice(0, 10)) best = v.slice(0, 10);
        else if (/^(meta|metadata|_meta|stories_meta)$/.test(k)) look(v, depth + 1);
      });
    }
    Object.keys(files || {}).forEach(function (k) { look(files[k], 0); });
    return best;
  }
  function stamp(word, iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return '<span class="currency-stamp">' + esc(word) + ' <time datetime="' + esc(iso) + '">' + MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0] + '</time></span>';
  }

  function head(o) {
    // o.visual: a small picture beside the title (a locator map on place pages; big visual pass, paul 11-06).
    return '<header class="page-head page-' + esc(o.kind) + (o.visual ? ' has-visual' : '') + '">' + crumbs(o.crumbs) +
      (o.visual ? '<div class="ph-visual">' + o.visual + '</div>' : '') +
      '<p class="page-kind">' + esc(KINDS[o.kind]) + '</p>' +
      '<h1>' + esc(o.title) + '</h1>' +
      (o.answer ? '<p class="page-answer">' + o.answer + '</p>' : '') +
      // Gemini round 10, pick A (paul 11-05): a graphic strip under 200 px, after the sentence that says what the page is for.
      (o.strip ? '<div class="first-strip">' + o.strip + '</div>' : '') +
      (o.meta || o.dated ? '<p class="page-meta">' + (o.meta || '') + (o.dated && newest(o.dated) ? (o.meta ? ' ' : '') + stamp(o.datedWord || 'Data updated', newest(o.dated)) : '') + '</p>' : '') +
      (o.aside || '') + factStrip(o.facts) + '</header>';
  }

  // sections: [{ id, title }]
  // inline: a row of links under the page head, for pages without the guide's side column.
  function onThisPage(sections, inline) {
    return '<nav class="on-this-page' + (inline ? ' otp-inline' : '') + '" aria-label="On this page"><p class="otp-title">On this page</p><ol>' + sections.map(function (s) {
      return '<li' + (s.lang ? ' lang="' + esc(s.lang) + '"' : '') + '><a href="#/' + esc(location.hash.slice(2).split('?')[0]) + '?at=' + esc(s.id) + '" data-jump="' + esc(s.id) + '">' + esc(s.title) + '</a></li>';
    }).join('') + '</ol></nav>';
  }

  // links: [{ href, label, secondary }]
  function next(title, links) {
    return '<aside class="next-box" aria-label="Next"><p class="next-title">' + esc(title || 'Next') + '</p><div class="actions">' + links.map(function (l) {
      return '<a class="button-link' + (l.secondary ? ' secondary' : '') + '" href="' + esc(l.href) + '">' + esc(l.label) + '</a>';
    }).join('') + '</div></aside>';
  }

  // The page story (thread "Make analysis pages tell a story", paul 11-06): after the finding and its graphic,
  // a line or two on why it matters. No advice to the reader (paul 11-06: "just explain why it's important").
  // lines: [{ text, who? }]; text is markup.
  function means(lines, title) {
    var shown = (lines || []).filter(function (l) { return l && l.text; });
    if (!shown.length) return '';
    return '<aside class="means-box" data-no-source aria-label="' + esc(title || 'Why it matters') + '"><p class="means-title">' + esc(title || 'Why it matters') + '</p><ul>' + shown.map(function (l) {
      return '<li>' + (l.who ? '<strong>' + esc(l.who) + ':</strong> ' : '') + l.text + '</li>';
    }).join('') + '</ul></aside>';
  }
  // Abbreviations a page defines, folded under the head so the finding comes first. html is markup.
  function terms(html) {
    return html ? '<details class="terms-fold"><summary>Terms used on this page</summary>' + html + '</details>' : '';
  }

  function source(text, href, date) {
    return '<p class="source-line"><span>Source</span> ' + (href ? '<a href="' + esc(href) + '">' + esc(text) + '</a>' : esc(text)) + (date ? ', ' + esc(date) : '') + '</p>';
  }


  // A section folded shut on a long page: the title and a one-line answer show, and the full section opens below.
  // Nothing is removed: the folded part is on the page, opens on tap, on a jump link to anything inside it, on
  // find-in-page, and for printing. o: { id, level (2 by default, 3 for a part), open }.
  function fold(title, take, body, o) {
    o = o || {};
    var h = o.level === 3 ? 'h3' : 'h2';
    var key = o.id || stripTags(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return '<details class="fold fold-sec' + (o.level === 3 ? ' fold-part' : '') + '" data-fold="' + esc(key) + '"' + (o.open ? ' open' : '') + '><summary>' +
      '<' + h + ' class="fold-title"' + (o.id ? ' id="' + esc(o.id) + '" tabindex="-1"' : '') + '>' + title + '</' + h + '>' +
      (take ? '<span class="fold-take">' + take + '</span>' : '') + '<span class="fold-cue" aria-hidden="true"></span></summary><div class="fold-body">' + body + '</div></details>';
  }
  // The same, for a section a page already drew as '<h2>Title</h2>…': its first heading becomes the fold's title.
  // Title and take are markup here, already escaped by the page that drew them.
  function foldHtml(html, take, o) {
    var m = /^\s*<(h[23])([^>]*)>([\s\S]*?)<\/\1>/.exec(html || '');
    if (!m) return html || '';
    o = o || {};
    var id = /\bid="([^"]+)"/.exec(m[2]);
    return fold(m[3], take, html.slice(m[0].length), { id: o.id || (id && id[1]), level: o.level || (m[1] === 'h3' ? 3 : 2), open: o.open });
  }
  // Open every fold around an element, so a link to something inside a fold lands on it open.
  function openAround(el) {
    for (var d = el && el.closest && el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  }

  // "On this page" links keep the route in the hash and scroll to the section, so the router never
  // mistakes a section id for a page.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-jump]');
    if (!a) return;
    var el = document.getElementById(a.dataset.jump);
    if (!el) return;
    ev.preventDefault();
    // A guide part folded behind "Read the rest" opens when the contents list jumps to it.
    Array.prototype.forEach.call(el.querySelectorAll('details.g-more'), function (d) { d.open = true; });
    if (el.tagName === 'DETAILS') el.open = true;
    openAround(el);
    var clipped = el.closest('.list-clipped');
    if (clipped) unclipList(clipped);
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  });

  // Long lists on the reading pages show their first few items and a "Show all" button; the rest are on the page,
  // only hidden, so search-in-page after "Show all", print and the words are unchanged. Some of these lists are
  // drawn by the live site's own modules after the page opens, so this runs whenever the page's content changes.
  // view: [[selector, items kept, noun, button label if not "Show all N noun"]]
  var LONG_LISTS = {
    legislation: [['ul.pw-list', 3, 'items']],
    guide: [['#g-ha-steps ol', 3, 'steps'], ['#g-ha-joint ol', 3, 'steps']],
    research: [['.research-cards', 4, 'briefs']],
    elections: [['#candidate-records', 1, 'races'], ['.candidate-race', 4, 'entries'], ['#on-ballot-records > section', 4, 'entries'], ['ol.milestones', 5, 'milestones']],
    'equity-pricing': [['ul.eq-law', 3, 'bills and rules'], ['ul.eq-credits', 2, 'credit types'], ['ul.eq-gaps', 3, 'items'], ['#eq-drivers', 5, '', 'Read the rest of this part']],
    data: [['ul.ds-apis', 6, 'services'], ['ul.ds-groups', 4, 'groups'], ['.ds-col > ul', 6, 'entries'], ['.ds-col > ol', 6, 'entries']]
  };
  function unclipList(list) {
    list.classList.remove('list-clipped');
    var b = list.nextElementSibling;
    if (b && b.hasAttribute('data-unclip-list')) b.remove();
  }
  function clipLists() {
    var view = (location.hash.slice(2).split('?')[0].split('/')[0]) || 'home';
    var rules = LONG_LISTS[view];
    var main = document.getElementById('main');
    if (!rules || !main) return;
    rules.forEach(function (r) {
      Array.prototype.forEach.call(main.querySelectorAll(r[0]), function (list) {
        if (list.hasAttribute('data-clip-done')) return;
        list.setAttribute('data-clip-done', '');
        var items = Array.prototype.slice.call(list.children);
        if (items.length < r[1] + 2) return;
        items.forEach(function (it, i) { if (i >= r[1]) it.setAttribute('data-extra', '1'); });
        list.classList.add('list-clipped');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'quiet show-all';
        b.setAttribute('data-unclip-list', '');
        b.textContent = r[3] || 'Show all ' + items.length + ' ' + r[2];
        b.addEventListener('click', function () { unclipList(list); });
        list.parentNode.insertBefore(b, list.nextSibling);
      });
    });
  }
  // Pages redraw when their data arrives or a box is ticked; a fold the reader opened or shut stays that way.
  var foldState = {};
  function foldKey(d) { return location.hash.slice(2).split('?')[0] + '|' + d.getAttribute('data-fold'); }
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.classList && d.classList.contains('fold-sec')) foldState[foldKey(d)] = d.open;
  }, true);
  function keepFolds() {
    Array.prototype.forEach.call(document.querySelectorAll('details.fold-sec[data-fold]'), function (d) {
      var k = foldKey(d);
      if (k in foldState && d.open !== foldState[k]) d.open = foldState[k];
    });
  }
  // Sources fold (paul, 10 Nov): a run of source lines, and a section headed "Sources", sits under one "Sources"
  // line that opens on tap, but only past FOLD_OVER lines (paul, 11-10: one line doesn't need to fold, just over three). Nothing is removed: the lines stay on the page, open for printing and for a
  // link into them, and a fold the reader opened stays open when the page redraws.
  var srcState = {}, FOLD_OVER = 3;
  function srcKey(i) { return location.hash.slice(2).split('?')[0] + '|' + i; }
  function srcFold(nodes, label) {
    var first = nodes[0], d = document.createElement('details');
    d.className = 'fold-src';
    d.innerHTML = '<summary>' + esc(label) + '</summary>';
    first.parentNode.insertBefore(d, first);
    nodes.forEach(function (n) { d.appendChild(n); });
    return d;
  }
  // Header sorting for ordinary tables, as the public site's shared sorter gives them (js/components/table-sort.js).
  // The lab's own .data-table lists already sort and are left alone. Skipped on purpose: tables with merged cells,
  // tables inside a form (inputs), statements and schedules whose order is the meaning (data-nosort or a class
  // below), and tables under three rows. A third press puts the rows back as written. Rows with no value sort
  // last; a Total row stays at the foot.
  var NO_SORT = '.data-table, form, [data-nosort], .proj-table, .quick-pf, .statement, .waterfall, .dq-table';
  function cellText(td) { return td ? (td.getAttribute('data-v') != null ? td.getAttribute('data-v') : td.textContent).replace(/\s+/g, ' ').trim() : ''; }
  function asNumber(t) {
    if (!/\d/.test(t) || /^\d{4}-\d{2}/.test(t)) return null;
    var m = /^[^\d\-−+]*([\-−+]?[\d,]*\.?\d+)\s*(million|billion|[kKmMbB])?/.exec(t.replace(/^\(([^)]*)\)$/, '-$1'));
    if (!m) return null;
    var n = Number(m[1].replace(/,/g, '').replace('−', '-'));
    if (!isFinite(n)) return null;
    var u = (m[2] || '').toLowerCase();
    return n * (u === 'billion' || u === 'b' ? 1e9 : u === 'million' || u === 'm' ? 1e6 : u === 'k' ? 1e3 : 1);
  }
  function isBlank(t) { return t === '' || /^(—|–|-|n\/a|no value|not published|not available|unavailable)$/i.test(t); }
  // Tags out, repeated until nothing changes, so a tag split by another tag cannot survive.
  function stripTags(s) { var prev; s = String(s); do { prev = s; s = s.replace(/<[^>]*>/g, ''); } while (s !== prev); return s; }
  function sortable() {
    var main = document.getElementById('main');
    if (!main || global.LAB_SITE_SORT) return;
    Array.prototype.forEach.call(main.querySelectorAll('table:not([data-sort-seen])'), function (t) {
      // A table still filling (fewer than three rows, as when a live script adds them later) is looked at again.
      if (t.tBodies.length === 1 && t.tBodies[0].rows.length < 3 && !t.closest(NO_SORT)) return;
      t.setAttribute('data-sort-seen', '1');
      if (t.closest(NO_SORT) || !t.tHead || t.tHead.rows.length !== 1 || t.tBodies.length !== 1 || t.tBodies[0].rows.length < 3) return;
      if (t.querySelector('[colspan], [rowspan], input, select, button')) return;
      var heads = t.tHead.rows[0].cells, n = heads.length;
      // A one-column list sorts too, A to Z (the map "Show the numbers" lists of marks).
      if (n < 1 || Array.prototype.some.call(t.tBodies[0].rows, function (r) { return r.cells.length !== n; })) return;
      Array.prototype.forEach.call(t.tBodies[0].rows, function (r, i) { r.setAttribute('data-row', i); });
      Array.prototype.forEach.call(heads, function (th, i) {
        if (!th.textContent.trim()) return;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'th-sort'; b.setAttribute('data-th-sort', i);
        while (th.firstChild) b.appendChild(th.firstChild);
        th.appendChild(b); th.setAttribute('aria-sort', 'none');
      });
      t.classList.add('can-sort');
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.th-sort');
    if (!b || global.LAB_SITE_SORT) return;
    var th = b.parentNode, t = th.closest('table'), body = t.tBodies[0], i = Number(b.getAttribute('data-th-sort'));
    var rows = Array.prototype.slice.call(body.rows);
    var vals = rows.map(function (r) { return cellText(r.cells[i]); });
    var filled = vals.filter(function (x) { return !isBlank(x); });
    var numeric = filled.length > 0 && filled.filter(function (x) { return asNumber(x) != null; }).length >= filled.length * 0.8;
    var was = th.getAttribute('aria-sort'), first = numeric ? 'descending' : 'ascending', second = numeric ? 'ascending' : 'descending';
    var dir = was === 'none' ? first : was === first ? second : 'none';
    Array.prototype.forEach.call(th.parentNode.cells, function (x) { if (x.hasAttribute('aria-sort')) x.setAttribute('aria-sort', 'none'); });
    th.setAttribute('aria-sort', dir);
    var total = function (r) { return /^(total|all|statewide|colorado)\b/i.test(cellText(r.cells[0])); };
    rows.sort(function (a, c) {
      var o = Number(a.getAttribute('data-row')) - Number(c.getAttribute('data-row'));
      if (dir === 'none') return o;
      if (total(a) !== total(c)) return total(a) ? 1 : -1;
      var x = cellText(a.cells[i]), y = cellText(c.cells[i]);
      if (isBlank(x) !== isBlank(y)) return isBlank(x) ? 1 : -1;
      if (isBlank(x)) return o;
      var d = numeric ? (asNumber(x) == null ? 1 : asNumber(y) == null ? -1 : asNumber(x) - asNumber(y)) : x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' });
      return (dir === 'ascending' ? d : -d) || o;
    });
    rows.forEach(function (r) { body.appendChild(r); });
    var say = document.getElementById('sort-status');
    if (!say) { say = document.createElement('p'); say.id = 'sort-status'; say.className = 'visually-hidden'; say.setAttribute('role', 'status'); document.body.appendChild(say); }
    say.textContent = dir === 'none' ? 'Rows back in their original order.' : 'Sorted by ' + b.textContent.trim() + ', ' + dir + '.';
  });


  // Section tabs for long pages (format review F2, paul 11-12): the same sticky tab row as the HNA chapters,
  // under the step bar, one swipeable row on a phone. A page's "On this page" list becomes the row; a long
  // page without one gets a row from its h2 headings. A page with its own tab row is left alone.
  var TAB_MIN = 3, TAB_SCREENS = 8;
  function slugId(t, used) {
    var b = 'sec-' + (t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part'), id = b, i = 2;
    while (used[id] || document.getElementById(id)) id = b + '-' + i++;
    used[id] = 1; return id;
  }
  function tabLabel(t) { t = t.replace(/\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 41).replace(/\s+\S*$/, '') + '…' : t; }
  function pageTabs() {
    var main = document.getElementById('main');
    if (!main || !main.querySelector('h1')) return;
    // Guides keep their side contents list until they are served from the live pages (format review F3).
    if (/^#\/guide\//.test(location.hash)) { var g = main.querySelector('.page-tabs'); if (g) g.remove(); return; }
    // The Deal Calculator's sticky result strip owns that spot; a page with its own tab row keeps it.
    var own = main.querySelector('.tabs:not(.page-tabs), .quick-live');
    var old = main.querySelector('.page-tabs');
    if (own) { if (old) old.remove(); return; }
    var otp = main.querySelector('nav.on-this-page'), items = [];
    if (otp) {
      Array.prototype.forEach.call(otp.querySelectorAll('a[data-jump]'), function (a) {
        var el = document.getElementById(a.getAttribute('data-jump'));
        if (el) items.push({ id: el.id, el: el, label: tabLabel(a.textContent) });
      });
    } else {
      if (document.documentElement.scrollHeight < TAB_SCREENS * (global.innerHeight || 800)) { if (old) old.remove(); return; }
      var used = {};
      Array.prototype.forEach.call(main.querySelectorAll('h2'), function (h) {
        if (h.closest('details, aside, figure, nav, .page-tabs, .next-box, [hidden]') || !h.textContent.trim() || h.classList.contains('visually-hidden')) return;
        var sec = h.parentNode && h.parentNode.tagName === 'SECTION' && h.parentNode.firstElementChild === h ? h.parentNode : h;
        if (!sec.id) sec.id = slugId(h.textContent, used);
        items.push({ id: sec.id, el: sec, label: tabLabel(h.textContent) });
      });
    }
    if (items.length < TAB_MIN) { if (old) old.remove(); return; }
    var key = items.map(function (x) { return x.id; }).join('|');
    if (old && old.getAttribute('data-key') === key) return;
    if (old) old.remove();
    var route = location.hash.slice(2).split('?')[0];
    var nav = document.createElement('nav');
    nav.className = 'tabs page-tabs';
    nav.setAttribute('aria-label', 'Sections of this page');
    nav.setAttribute('data-key', key);
    nav.innerHTML = '<ul>' + items.map(function (x, i) {
      return '<li><a href="#/' + esc(route) + '?at=' + esc(x.id) + '" data-jump="' + esc(x.id) + '"' + (i ? '' : ' aria-current="location"') + '>' + esc(x.label) + '</a></li>';
    }).join('') + '</ul>';
    // Placed in the container that holds the page head, so the row sticks for the whole page, not one wrapper.
    var h1 = main.querySelector('h1'), at = otp || items[0].el;
    while (at.parentNode && at.parentNode !== main && !at.parentNode.contains(h1)) at = at.parentNode;
    at.parentNode.insertBefore(nav, at);
    if (otp) otp.hidden = true;
    spyTabs();
  }
  // The tab for the section being read is marked, and on a phone scrolled into view in the row.
  // A tab the reader picks stays marked until they scroll on, even when its section sits too low to reach the top.
  var spyQueued = false, picked = null;
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('.page-tabs a[data-jump]');
    if (!a) return;
    // The slim step bar can appear as the page scrolls, after the browser placed the section: clear it again.
    global.setTimeout(function () {
      var el = document.getElementById(a.getAttribute('data-jump')), nav = a.closest('.page-tabs');
      if (el && nav) { var gap = el.getBoundingClientRect().top - nav.getBoundingClientRect().bottom - 8; if (gap < 0) global.scrollBy({ top: gap, behavior: 'instant' }); }
      picked = { a: a, y: global.scrollY }; markTab(a);
    }, 150);
  });
  function markTab(cur) {
    var nav = cur && cur.closest('.page-tabs');
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll('a[aria-current]'), function (a) { if (a !== cur) a.removeAttribute('aria-current'); });
    if (cur.getAttribute('aria-current') !== 'location') {
      cur.setAttribute('aria-current', 'location');
      var ul = nav.querySelector('ul');
      if (ul && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = Math.max(0, cur.parentNode.offsetLeft - 16);
    }
  }
  function spyTabs() {
    spyQueued = false;
    var nav = document.querySelector('#main .page-tabs');
    if (!nav) return;
    if (picked && picked.a.isConnected && Math.abs(global.scrollY - picked.y) < 60) return;
    picked = null;
    var cs = global.getComputedStyle(document.documentElement), px = function (n) { return parseFloat(cs.getPropertyValue(n)) || 0; };
    var line = px('--hdr-h') + px('--sp-top') + nav.getBoundingClientRect().height + 24, cur = null;
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-jump]'), function (a) {
      var el = document.getElementById(a.getAttribute('data-jump'));
      if (el && el.getClientRects().length && el.getBoundingClientRect().top <= line) cur = a;
    });
    markTab(cur || nav.querySelector('a[data-jump]'));
  }
  if (typeof global.addEventListener === 'function') global.addEventListener('scroll', function () { if (!spyQueued) { spyQueued = true; (global.requestAnimationFrame || setTimeout)(spyTabs); } }, { passive: true });

  function foldSources() {
    var main = document.getElementById('main');
    if (!main) return;
    var made = [];
    Array.prototype.forEach.call(main.querySelectorAll('p.source-line'), function (p) {
      if (p.closest('details.fold-src, .print-only, summary')) return;
      var prev = p.previousElementSibling;
      if (prev && prev.classList.contains('source-line')) return; // handled with the first line of its run
      var run = [p];
      for (var n = p.nextElementSibling; n && n.classList.contains('source-line'); n = n.nextElementSibling) run.push(n);
      if (run.length > FOLD_OVER) made.push(srcFold(run, 'Sources (' + run.length + ')'));
    });
    Array.prototype.forEach.call(main.querySelectorAll('h2, h3'), function (h) {
      if (!/^(sources?|data sources|methodology and data sources)\b/i.test(h.textContent.trim()) || h.closest('details, summary')) return;
      var rest = [];
      for (var n = h.nextElementSibling; n && !/^H[12]$/.test(n.tagName) && !(n.tagName === h.tagName); n = n.nextElementSibling) rest.push(n);
      // Count the lines a reader sees: list items, else paragraphs.
      var lines = rest.reduce(function (t, n) { var li = n.querySelectorAll ? n.querySelectorAll('li').length : 0; return t + (li || (n.tagName === 'P' ? 1 : 0)); }, 0);
      if (lines <= FOLD_OVER) return;
      var d = srcFold(rest, h.textContent.trim());
      d.classList.add('fold-src-sec');
      d.insertBefore(h, d.firstChild.nextSibling);
      h.classList.add('fold-src-head');
      made.push(d);
    });
    Array.prototype.forEach.call(main.querySelectorAll('details.fold-src'), function (d, i) {
      var k = srcKey(i);
      if (k in srcState) d.open = srcState[k];
      if (!d.hasAttribute('data-src-i')) { d.setAttribute('data-src-i', i); d.addEventListener('toggle', function () { srcState[srcKey(+d.getAttribute('data-src-i'))] = d.open; }); }
    });
    return made.length;
  }
  // A page opened at ?at=<id> whose target sits in a fold opens that fold, once per address.
  var atDone = '';
  function openAt() {
    var h = location.hash, i = h.indexOf('?');
    if (i < 0 || atDone === h) return;
    var id = new URLSearchParams(h.slice(i + 1)).get('at'), el = id && document.getElementById(id);
    if (!el) return;
    atDone = h;
    if (el.closest('details:not([open])')) { openAround(el); el.scrollIntoView({ block: 'start' }); }
  }
  // Printing opens every section fold, and closes again afterwards the ones the reader had shut.
  var printOpened = [];
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('beforeprint', function () {
      // A print is the whole page: section and source folds, a guide's folded parts, and each chart's table of numbers, whether or not
      // the reader had opened them. (Long lists print every row through CSS; see shell.css.)
      printOpened = Array.prototype.filter.call(document.querySelectorAll('details.fold-sec:not([open]), details.fold-src:not([open]), details.viz-data:not([open]), .guide-body details:not([open])'), function (d) { d.open = true; return true; });
    });
    global.addEventListener('afterprint', function () { printOpened.forEach(function (d) { d.open = false; }); printOpened = []; });
  }
  if (typeof MutationObserver !== 'undefined') {
    var clipQueued = false;
    new MutationObserver(function () {
      // Sources fold before the browser lays the page out, so a redraw never shifts the reader's place.
      foldSources();
      sortable();
      pageTabs();
      keepFolds();
      if (clipQueued) return;
      clipQueued = true;
      (global.requestAnimationFrame || setTimeout)(function () { clipQueued = false; clipLists(); openAt(); });
    }).observe(document.getElementById('main') || document.body, { childList: true, subtree: true });
  }

  // Print or save as PDF (the browser's print dialog, with the print rules in templates.css), and Word, the way the
  // live working paper offers it (js/components/working-paper-download.js): the page's own HTML handed to Word as .doc.
  function printBar(o) {
    o = o || {};
    return '<div class="actions print-bar" role="group" aria-label="Save this page">' +
      '<button type="button" class="button-link secondary" data-lab-print>Print or save as PDF</button>' +
      (o.word ? '<button type="button" class="button-link secondary" data-lab-word="' + esc(o.word) + '">Download Word (.doc)</button>' : '') + '</div>';
  }
  if (global.document) global.document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-lab-print],[data-lab-word]');
    if (!b) return;
    if (b.hasAttribute('data-lab-print')) { global.print(); return; }
    var main = global.document.querySelector('main') || global.document.body, clone = main.cloneNode(true);
    clone.querySelectorAll('.print-bar, button, script, nav, .viz-data, svg.viz-p').forEach(function (n) { n.remove(); });
    var title = (global.document.querySelector('main h1') || {}).textContent || global.document.title;
    var html = '<html><head><meta charset="utf-8"><title>' + esc(title) + '</title></head><body>' + clone.innerHTML + '</body></html>';
    var url = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' })), a = global.document.createElement('a');
    a.href = url; a.download = b.getAttribute('data-lab-word') + '.doc'; global.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // Gemini round 15, pick 1 (paul 11-05): a deal result's colour matches its news, with an icon and words so colour
  // is never the only signal. A gap under 5% of total development cost is "small"; the line is ours to change here.
  var SMALL_GAP = 0.05;
  function gapTone(gap, tdc) {
    if (gap == null || !isFinite(gap)) return '';
    if (gap <= 0) return 'ok';
    return isFinite(tdc) && tdc > 0 && gap / tdc < SMALL_GAP ? 'small' : 'large';
  }
  var TONES = { ok: ['\u2713', 'Fully funded'], small: ['!', 'Small gap, under 5% of cost'], large: ['\u2715', 'Large gap, 5% of cost or more'] };
  function toneBadge(tone) {
    var t = TONES[tone]; if (!t) return '';
    return '<p class="tone-badge tone-' + tone + '" data-tone="' + tone + '"><span class="tone-i" aria-hidden="true">' + t[0] + '</span>' + esc(t[1]) + '</p>';
  }

  // Gemini round 16, pick 2 (paul 11-05; tightened 11-06): alt text for a main graphic is its finding plus its
  // source, under 125 characters. The source is dropped before the finding is ever cut.
  var ALT_MAX = 125;
  function alt(finding, src) {
    var tidy = function (t) { return String(t || '').replace(/[.\s;,]+$/, ''); };
    var f0 = tidy(finding);
    // Shorter readings of a long finding: its first clause, then without the bracketed detail.
    var tries = [f0, tidy(f0.split('; ')[0]), tidy(f0.split('; ')[0].replace(/ \([^)]*\)/g, ''))];
    for (var i = 0; i < tries.length; i++) {
      var f = tries[i], full = f + '. Source: ' + src + '.', mid = f + '. ' + src + '.';
      if (full.length <= ALT_MAX) return full;
      if (mid.length <= ALT_MAX) return mid;
    }
    for (i = 0; i < tries.length; i++) if (tries[i].length < ALT_MAX) return tries[i] + '.';
    var cut = f0.slice(0, ALT_MAX - 1); return cut.slice(0, cut.lastIndexOf(' ')) + '\u2026';
  }

  global.LabTpl = { newest: newest, stamp: stamp, means: means, terms: terms, alt: alt, ALT_MAX: ALT_MAX, gapTone: gapTone, toneBadge: toneBadge, crumbs: crumbs, trail: trail, head: head, factStrip: factStrip, onThisPage: onThisPage, pageTabs: pageTabs, next: next, source: source, fold: fold, foldHtml: foldHtml, openAround: openAround, printBar: printBar, foldSources: foldSources, sortable: sortable };
})(window);
