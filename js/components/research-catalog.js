/**
 * js/components/research-catalog.js
 * One list of research and analysis, for two places.
 *
 * insights.html (Research & Analysis) and the "Latest research" panel on
 * policy-briefs.html (Housing News) used to keep separate lists that did not
 * overlap: the page listed articles, the panel listed curated briefs, and
 * neither showed the other's. Both now read:
 *   - data/insights/catalog.json: every page the hub lists, with how it is
 *     kept current (its `maintenance`);
 *   - data/policy_briefs_curated.json: the curated research briefs.
 * test/research-catalog.test.mjs renders both pages and checks they agree.
 *
 * A "reviewed" item does not carry its own dates. Its review_from names the
 * data file that does (the tax-credit watchlist, the homebuyer program list,
 * the pricing benchmarks), so a check date lives in one place.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ResearchCatalog = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CATALOG_URL = 'data/insights/catalog.json';
  var BRIEFS_URL = 'data/policy_briefs_curated.json';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ISO = /^\d{4}-\d{2}-\d{2}/;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function day(iso) {
    return ISO.test(String(iso || '')) ? String(iso).slice(0, 10) : null;
  }

  function shortDate(iso) {
    var d = day(iso);
    if (!d) return '';
    var t = new Date(d + 'T12:00:00Z');
    return MONTHS[t.getUTCMonth()] + ' ' + t.getUTCDate() + ', ' + t.getUTCFullYear();
  }

  // Curated briefs as catalog items. Only is_curated briefs are research.
  function briefItems(curated) {
    var list = Array.isArray(curated) ? curated : (curated && Array.isArray(curated.briefs) ? curated.briefs : []);
    return list.filter(function (b) { return b && b.is_curated && b.id && b.title; }).map(function (b) {
      return {
        id: 'brief:' + b.id,
        section: 'analysis',
        type: b.source_reviewed ? 'Source-reviewed brief' : 'Research brief',
        title: b.title,
        url: 'research-brief.html?id=' + encodeURIComponent(b.id),
        summary: '',
        sources: Array.isArray(b.sources) ? b.sources : [],
        maintenance: 'dated',
        published: day(b.generated),
        brief: true
      };
    });
  }

  // { last_verified, review_by } for a reviewed item, from the file it names.
  // With ids: the earliest dates among those entries, so the item is due when
  // its first entry is. Without: the file's own meta.
  function reviewOf(entry, docs) {
    var from = entry && entry.review_from;
    if (!from || !docs || !docs[from.file]) return null;
    var doc = docs[from.file];
    var rows;
    if (Array.isArray(from.ids) && from.ids.length) {
      var list = Array.isArray(doc.entries) ? doc.entries : [];
      rows = from.ids.map(function (id) { return list.filter(function (e) { return e.id === id; })[0]; });
      if (rows.some(function (r) { return !r; })) return null;
    } else {
      var m = doc.meta || {};
      rows = [{ last_verified: m.last_verified || m.as_of, review_by: m.review_by || m.next_expected_update }];
    }
    var earliest = function (key) {
      var vals = rows.map(function (r) { return day(r[key]); });
      if (vals.some(function (v) { return !v; })) return null;
      return vals.sort()[0];
    };
    return { last_verified: earliest('last_verified'), review_by: earliest('review_by') };
  }

  // Everything the hub lists: catalog entries, then briefs, each with its
  // review dates resolved when it has them.
  function items(catalog, curated, docs) {
    var entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : [];
    return entries.map(function (e) {
      var item = {};
      Object.keys(e).forEach(function (k) { item[k] = e[k]; });
      item.review = reviewOf(e, docs);
      return item;
    }).concat(briefItems(curated));
  }

  // The newest dated analysis and briefs, for the Housing News panel.
  function latest(list, n) {
    return list.filter(function (i) { return i.section === 'analysis' && day(i.published); })
      .sort(function (a, b) { return b.published < a.published ? -1 : b.published > a.published ? 1 : 0; })
      .slice(0, n == null ? 3 : n);
  }

  // The files a catalog's reviewed items read their dates from.
  function reviewFiles(catalog) {
    var seen = {};
    (catalog && catalog.entries || []).forEach(function (e) {
      if (e.review_from && e.review_from.file) seen[e.review_from.file] = true;
    });
    return Object.keys(seen);
  }

  // One line saying how current an item is, by how it is maintained.
  function dateLine(item) {
    if (item.maintenance === 'reviewed') {
      return item.review && item.review.last_verified ? 'Checked ' + shortDate(item.review.last_verified) : 'Check date unavailable';
    }
    if (item.maintenance === 'live-data') return 'Live data: the page shows the vintage of each source';
    var parts = [];
    if (item.published) parts.push('Published ' + shortDate(item.published));
    if (item.updated) parts.push('updated ' + shortDate(item.updated));
    if (item.maintenance === 'generated') parts.push('regenerated from the repository');
    return parts.join(' · ');
  }

  function cardHtml(item, reviewStatus) {
    var badge = item.review && reviewStatus ? reviewStatus.html({ review_by: item.review.review_by, last_verified: item.review.last_verified }) : '';
    return '<article class="rc-card" data-catalog-id="' + esc(item.id) + '">' +
      '<div class="rc-card__type">' + esc(item.type) + '</div>' +
      '<h3 class="rc-card__title"><a href="' + esc(item.url) + '">' + esc(item.title) + '</a></h3>' +
      (item.summary ? '<p class="rc-card__summary">' + esc(item.summary) + '</p>' : '') +
      '<div class="rc-card__meta"><span class="rc-card__date">' + esc(dateLine(item)) + '</span>' +
      (item.sources && item.sources.length ? '<span class="rc-card__sources">Sources: ' + esc(item.sources.join(', ')) + '</span>' : '') +
      '</div>' + badge + '</article>';
  }

  // The hub, section by section in the catalog's order. Analysis is newest
  // first; other sections keep catalog order.
  function hubHtml(catalog, list, reviewStatus) {
    var sections = catalog && catalog.meta && Array.isArray(catalog.meta.sections) ? catalog.meta.sections : [];
    return sections.map(function (sec) {
      var inSec = list.filter(function (i) { return i.section === sec.key; });
      if (sec.key === 'analysis') {
        inSec = inSec.slice().sort(function (a, b) { return String(b.published || '').localeCompare(String(a.published || '')); });
      }
      if (!inSec.length) return '';
      return '<section class="rc-section" data-catalog-section="' + esc(sec.key) + '" aria-labelledby="rc-' + esc(sec.key) + '">' +
        '<h2 id="rc-' + esc(sec.key) + '">' + esc(sec.label) + '</h2>' +
        (sec.note ? '<p class="rc-section__note">' + esc(sec.note) + '</p>' : '') +
        '<div class="rc-grid">' + inSec.map(function (i) { return cardHtml(i, reviewStatus); }).join('') + '</div></section>';
    }).join('');
  }

  return {
    CATALOG_URL: CATALOG_URL,
    BRIEFS_URL: BRIEFS_URL,
    items: items,
    latest: latest,
    reviewFiles: reviewFiles,
    reviewOf: reviewOf,
    dateLine: dateLine,
    shortDate: shortDate,
    hubHtml: hubHtml
  };
}));
