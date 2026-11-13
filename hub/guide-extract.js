// Cuts a Housing-Analytics article page down to its words, headings, lists, tables, diagrams and links, split
// at its h2s. Shared by scripts/build-guide-pages.js (Node, jsdom) and by the lab's pages when they run inside
// the public site, where they read the live page itself instead of a copy (format review F3, paul 11-12).
// Nothing is reworded; only styling, scripts and the page's own navigation are dropped.
// o: { routes: { 'page.html': '#/route' }, live: 'https://cohoanalytics.com/', keepPaths: bool }
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.LabGuideExtract = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Live pages the lab has rebuilt open in the lab; every other site link opens the live page.
  const LAB_ROUTES = {
    'deal-calculator.html': '#/deal-calculator',
    'lihtc-guide-for-stakeholders.html': '#/guide/lihtc-basics',
    'affordable-deal-team.html': '#/guide/deal-team',
    'green-building-guide.html': '#/guide/green-building',
    'resident-services.html': '#/guide/resident-services',
    'cra-expansion-analysis.html': '#/guide/cra-pricing',
    'lihtc-enhancement-ahcia.html': '#/guide/ahcia',
    'article-fair-housing-rollback.html': '#/guide/fair-housing',
    'article-federal-rule-changes.html': '#/guide/federal-rules',
    'housing-authority-guide.html': '#/guide/housing-authority',
    'apa-white-paper.html': '#/guide/white-paper',
    'working-paper.html': '#/guide/working-paper',
    'methods.html': '#/guide/methods',
    'about.html': '#/guide/about',
    'housing-help.html': '#/guide/renter-help',
    'help-for-homebuyers.html': '#/assistance',
    'policy-briefs.html': '#/news',
    'housing-legislation-2026.html': '#/legislation',
    'dashboard-data-sources-ui.html': '#/data/sources',
    'deal-summary.html': '#/deals',
    'article-pricing.html': '#/equity-pricing',
    'pipeline.html': '#/pipeline',
    'land-value.html': '#/opportunity/land-value',
    'compare.html': '#/places/compare',
    'hna-comparative-analysis.html': '#/places/ranking',
    'local-incentives.html': '#/places/incentives',
    'preservation.html': '#/opportunity/preservation',
    'chfa-portfolio.html': '#/opportunity/portfolio',
    'land-banking-awards.html': '#/opportunity/land-banking',
    'select-jurisdiction.html': '#/places',
    'housing-needs-assessment.html': '#/places'
  };
  const KEEP = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
    'blockquote', 'code', 'br', 'figure', 'figcaption', 'details', 'summary', 'sup', 'sub', 'abbr', 'dl', 'dt', 'dd', 'section', 'div', 'span', 'small', 'cite', 'time']);
  const DROP = 'script, style, noscript, iframe, object, embed, form, button, input, select, textarea, svg, canvas, img, picture, video, audio, nav, link, meta, template';
  const ATTRS = { a: ['href'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], abbr: ['title'], time: ['datetime'] };
  // The page's own structure classes, renamed into the lab's: cards, panels, tables and its HTML diagrams.
  const CLASS = c => ({ 'lihtc-roles-grid': 'role-grid', 'lihtc-role-card': 'role-card', 'chart-card': 'panel', 'data-source': 'source-line', 'table-wrap': 'table-scroll' })[c]
    || (/^(dg-|diagram)/.test(c) ? c : null);

  function linkFor(href, o) {
    if (!href || href.startsWith('#')) return null;
    if (/^(https?:|mailto:)/i.test(href)) return href;
    const file = href.split('#')[0].split('?')[0].replace(/^\.?\//, '');
    return o.routes[file] || o.live + href.replace(/^\.?\//, '');
  }

  function clean(node, doc, o) {
    node.querySelectorAll(DROP).forEach(n => n.remove());
    const walker = doc.createTreeWalker(node, 128 /* comments */);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => c.remove());
    [...node.querySelectorAll('*')].reverse().forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); return; }
      const classes = (el.getAttribute('class') || '').split(/\s+/).map(CLASS).filter(Boolean);
      const keep = ATTRS[tag] || [];
      // The page's own anchor on this element is kept as data-at (not as an id, which could clash with the
      // page it is drawn into), so a link to it can open the fold it sits in and land on it.
      const own = el.getAttribute('id');
      [...el.attributes].forEach(a => { if (keep.indexOf(a.name) < 0) el.removeAttribute(a.name); });
      if (own && /^[A-Za-z0-9_-]{1,80}$/.test(own)) el.setAttribute('data-at', own);
      if (classes.length) el.setAttribute('class', classes.join(' '));
      if (tag === 'a') {
        const to = linkFor(el.getAttribute('href'), o);
        if (!to) { el.replaceWith(...el.childNodes); return; }
        el.setAttribute('href', to);
      }
      if (tag === 'div' && !el.attributes.length && el.children.length === 0 && !el.textContent.trim()) el.remove();
    });
    // A source line that names one of the site's files by its path reads "the site's data file" instead,
    // except on Methods and the working paper (keepPaths), which are about those files.
    if (!o.keepPaths) {
    const texts = doc.createTreeWalker(node, 4 /* text */);
    while (texts.nextNode()) texts.currentNode.nodeValue = texts.currentNode.nodeValue.replace(/\bdata\/[\w./-]+\.(?:json|csv|geojson)\b/g, 'the site\u2019s data file');
    }
    return node.innerHTML.replace(/\s+/g, ' ').trim();
  }

  // Splits an article at its h2s. Each section is the largest block around its h2 that holds no other h2;
  // when h2s sit side by side in one block, the section is the h2's following siblings up to the next one.
  function byH2(main, doc, o) {
    const h1 = main.querySelector('h1');
    const title = h1.textContent.replace(/\s+/g, ' ').trim();
    // The lede is the first paragraph after the h1 inside the page's header block.
    let ledeEl = null;
    for (let box = h1.parentElement, up = 0; box && !ledeEl && up < 3; box = box.parentElement, up++) {
      ledeEl = [...box.querySelectorAll('p')].find(p => h1.compareDocumentPosition(p) & 4 && !p.querySelector('h2') && !p.closest('h2') && p.textContent.trim().length > 40) || null;
      if (ledeEl && [...main.querySelectorAll('h2')].some(h => h.compareDocumentPosition(ledeEl) & 4)) ledeEl = null;
    }
    const lede = ledeEl ? ledeEl.textContent.replace(/\s+/g, ' ').trim() : '';
    if (ledeEl) ledeEl.remove();
    h1.remove();
    // "Which document do you need?": the chooser the white paper, working paper and Methods share. It is the
    // page's own navigation between the three, so it is kept as a list of links, in the page's words.
    const chooser = main.querySelector('nav.doc-guide');
    let docGuide;
    if (chooser) {
      const say1 = (el, q) => { const n = el.querySelector(q); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
      const items = [...chooser.querySelectorAll('li')].map(li => {
        const a = li.querySelector('a');
        return a ? { name: a.textContent.replace(/\s+/g, ' ').trim(), href: linkFor(a.getAttribute('href'), o), here: li.classList.contains('is-current') || undefined,
          use: say1(li, '.doc-guide__for'), about: say1(li, '.doc-guide__about') } : null;
      }).filter(x => x && x.href);
      if (items.length) docGuide = { title: say1(chooser, '.doc-guide__title') || 'Which document do you need?', items };
      chooser.remove();
    }
    main.querySelectorAll(DROP).forEach(n => n.remove());
    // The page's header lines (its disclaimer, kicker and dated byline) become notes under the title, not the
    // first section. A line about a print or PDF button the lab does not have is left out and recorded.
    // Header lines sit before the first real content: a heading, list, table or a full paragraph.
    const start = [...main.querySelectorAll('h2, h3, ul, ol, table, p')].find(el => el.tagName !== 'P' || el.textContent.trim().length > 220);
    const before = el => !start || (el.compareDocumentPosition(start) & 4);
    const say = el => el.textContent.replace(/\s+/g, ' ').trim();
    const notes = [], omitted = [];
    [...main.querySelectorAll('div, p, span, small')].forEach(el => {
      if (!el.isConnected || el.querySelector('h2, h3, ul, ol, table')) return;
      const t = say(el);
      if (!t) return;
      if (/print dialog|Save as PDF/i.test(t) && t.length < 160 && !el.querySelector('div, p')) { omitted.push(t); el.remove(); return; }
      if (!before(el)) return;
      const disclaimer = t.length < 400 && /public-data reference|not (?:legal|financial|tax)[^.]*advice/i.test(t) && !el.querySelector('p, div');
      const byline = t.length < 220 && / \u00b7 /.test(t) && !el.querySelector('div, p');
      const kicker = t.length < 30 && !el.children.length && !/\d/.test(t) && t.split(' ').length <= 3;
      if (disclaimer || byline || kicker) { notes.push(t); el.remove(); }
    });
    const h2s = [...main.querySelectorAll('h2')];
    // A section in another language than the page (the renter guide's Spanish half) keeps its language.
    const pageLang = doc.documentElement.getAttribute('lang');
    const langs = h2s.map(h2 => { const el = h2.closest('[lang]'); return el && el.getAttribute('lang') !== pageLang ? el.getAttribute('lang') : undefined; });
    // Each h2's block is found before anything moves, so a later section never swallows the page header.
    const boxes = h2s.map(h2 => {
      let box = h2;
      while (box.parentElement && box.parentElement !== main && box.parentElement.querySelectorAll('h2').length === 1) box = box.parentElement;
      return box;
    });
    const used = new Set();
    const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'section';
    const sections = h2s.map((h2, i) => {
      const box = boxes[i];
      // A number in its own span ("<span>01</span>What") reads with a space, as the page shows it.
      const t = [...h2.childNodes].map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      const holder = doc.createElement('div');
      if (box === h2) {
        let n = h2.nextSibling;
        while (n && !(n.nodeType === 1 && (n.tagName === 'H2' || (n.querySelector && n.querySelector('h2'))))) { const next = n.nextSibling; holder.appendChild(n); n = next; }
        h2.remove();
      } else {
        h2.remove();
        holder.appendChild(box);
      }
      const lang = langs[i];
      let id = box !== h2 && box.id ? box.id : slug(t);
      while (used.has(id)) id += '-' + i;
      used.add(id);
      // An empty element with an id, or one that says it is loading, is a slot the live page's script fills.
      const slots = [...holder.querySelectorAll('*')].filter(el => /^Loading\b/i.test(el.textContent.trim()) ||
        (!el.textContent.trim() && !el.children.length && [...el.attributes].some(a => a.name === 'id' || a.name.startsWith('data-')) && el.tagName !== 'TD'));
      slots.forEach(el => { if (/^Loading\b/i.test(el.textContent.trim())) el.remove(); });
      // The page's own anchors inside this part, so a link to one of them still lands on the part.
      const ids = [h2.id].concat([...holder.querySelectorAll('[id]')].map(el => el.id)).filter(x => x && x !== id);
      const html = clean(holder, doc, o);
      return { id, title: t, lang, html, liveFilled: slots.length ? true : undefined, ids: ids.length ? ids : undefined };
    });
    const intro = clean(main, doc, o);
    return { title, lede, intro, sections, notes, omitted, docGuide };
  }

  // The LIHTC guide's own layout: a .hero, a .lihtc-explainer intro and one <section> per part.
  function lihtc(main, doc, o) {
    const hero = main.querySelector('.hero');
    const title = hero.querySelector('h1').textContent.trim();
    const lede = hero.querySelector('p').textContent.replace(/\s+/g, ' ').trim();
    const intro = main.querySelector('.lihtc-explainer');
    const sections = [...main.children].filter(el => el.tagName === 'SECTION' && el !== intro).map((el, i) => {
      const h2 = el.querySelector('h2');
      const id = el.id || 'resources';
      const t = h2 ? h2.textContent.replace(/\s+/g, ' ').trim() : 'Section ' + (i + 1);
      if (h2) h2.remove();
      const ids = [...el.querySelectorAll('[id]')].map(x => x.id).filter(x => x && x !== id);
      return { id, title: t, html: clean(el, doc, o), ids: ids.length ? ids : undefined };
    });
    return { title, lede, intro: clean(intro, doc, o), sections, notes: [], omitted: [] };
  }

  // Inside the public site a guide is read from its own page, not from a copy (format review F3). A page whose
  // scripts write some of its words and tables (rendered) is opened out of sight first, so those are read too.
  // The pop-up definitions a script adds to table headings are not the page's words and are left out.
  // onLate(guide), optional: a rendered page whose data arrives after the first read (a slow connection) is read
  // again when it changes, for up to 20 seconds, and the fuller guide is handed over. The frame is kept that long.
  function fromPage(url, o, onLate) {
    const parse = html => new DOMParser().parseFromString(html, 'text/html');
    const cut = doc => {
      doc.querySelectorAll('[role="tooltip"]').forEach(n => n.remove());
      const main = doc.querySelector('main');
      if (!main || !main.querySelector('h1')) throw new Error('no article');
      const description = (doc.querySelector('meta[name="description"]') || {}).content || null;
      const b = o.mode === 'lihtc' ? lihtc(main, doc, o) : byH2(main, doc, o);
      b.description = description;
      return b;
    };
    if (!o.rendered) return fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(html => cut(parse(html)));
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.setAttribute('tabindex', '-1'); f.setAttribute('title', 'Reading the guide');
      f.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
      const WAIT = o.wait || 8000, LATE = o.late == null ? 20000 : o.late, TICK = 150;
      let timer = null, settled = false, readAt = -1;
      const stop = () => { clearInterval(timer); f.remove(); };
      const fail = e => { stop(); if (!settled) { settled = true; reject(e); } };
      f.onerror = () => fail(new Error('the page did not open'));
      f.onload = () => {
        const t0 = Date.now(); let quiet = 0, last = -1;
        timer = setInterval(() => {
          let main = null;
          try { main = f.contentDocument && f.contentDocument.querySelector('main'); } catch (e) { return fail(e); }
          if (!main) return fail(new Error('no article'));
          const size = main.innerHTML.length, loading = /(^|\s)Loading\b/i.test(main.textContent), age = Date.now() - t0;
          quiet = size === last && !loading ? quiet + 1 : 0; last = size;
          // First read: once nothing says it is loading and the page has stopped changing, or after 8 seconds.
          if (!settled && (quiet >= 4 || age > WAIT)) {
            settled = true; readAt = size;
            try { resolve(cut(parse(f.contentDocument.documentElement.outerHTML))); } catch (e) { stop(); return reject(e); }
            if (!onLate) stop();
          // Later: the page changed after that read and has gone quiet again.
          } else if (settled && onLate && quiet >= 4 && size !== readAt) {
            readAt = size;
            try { onLate(cut(parse(f.contentDocument.documentElement.outerHTML))); } catch (e) { /* the first read stands */ }
          }
          if (settled && age > LATE) stop();
        }, TICK);
      };
      f.src = url;
      document.body.appendChild(f);
    });
  }

  return { ROUTES: LAB_ROUTES, KEEP: KEEP, DROP: DROP, linkFor: linkFor, clean: clean, byH2: byH2, lihtc: lihtc, fromPage: fromPage };
});
