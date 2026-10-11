/**
 * js/resident-services.js
 * Renders the data-driven parts of resident-services.html from
 * data/policy/resident-services.json: the evidence cards, the CHFA QAP
 * requirements, who pays, what services cost, and which 2026 Round One
 * awards describe services. Every figure on those cards comes from the file,
 * and each record shows its source and, once it falls due, a re-check warning.
 * The narrative around them is static HTML in the page.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResidentServices = api;
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var DATA = 'data/policy/resident-services.json';
  var STRENGTH_TEXT = {
    strong: 'Strong evidence',
    moderate: 'Moderate evidence',
    limited: 'Limited or mixed evidence'
  };
  var STRENGTH_PILL = { strong: 'pill good', moderate: 'pill', limited: 'pill warn' };
  var OUTCOME_TEXT = {
    housing: 'Staying housed',
    property: 'Property operations',
    health: 'Health',
    justice: 'Jail and police',
    public_cost: 'Public costs',
    income: 'Income and work'
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function longDate(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }

  function safeUrl(url) {
    return /^https:\/\//.test(String(url || '')) ? String(url) : null;
  }

  function reviewHtml(record) {
    return global.ReviewStatus ? global.ReviewStatus.html(record) : '';
  }

  function sourceLine(r) {
    var url = safeUrl(r.source_url);
    var title = esc(r.source_title || 'Source');
    var link = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + title + '</a>' : title;
    var bits = [link];
    if (r.publisher) bits.push(esc(r.publisher));
    if (r.published) bits.push(esc(r.published));
    var checked = longDate(r.last_verified);
    return '<p class="rs-source">' + bits.join(' · ') + (checked ? ' · checked ' + esc(checked) : '') + '</p>';
  }

  function quoteHtml(r) {
    if (!r.quote) return '';
    return '<details class="rs-quote"><summary>What the source says</summary><blockquote>' + esc(r.quote) + '</blockquote></details>';
  }

  function byKind(doc, kind) {
    return (doc && Array.isArray(doc.entries) ? doc.entries : []).filter(function (e) { return e.kind === kind; });
  }

  function evidenceHtml(doc) {
    var list = byKind(doc, 'evidence');
    if (!list.length) return '<p class="rs-muted">No evidence records are loaded.</p>';
    return '<div class="rs-cards">' + list.map(function (r) {
      var outcomes = (r.outcomes || []).map(function (o) { return '<span class="pill">' + esc(OUTCOME_TEXT[o] || o) + '</span>'; }).join(' ');
      return '<article class="rs-card" data-rs-entry="' + esc(r.id) + '">' +
        '<h4>' + esc(r.title) + '</h4>' +
        '<p class="rs-tags"><span class="' + (STRENGTH_PILL[r.strength] || 'pill') + '">' + esc(STRENGTH_TEXT[r.strength] || r.strength) + '</span> ' + outcomes + '</p>' +
        (r.population ? '<p class="rs-muted"><strong>Who:</strong> ' + esc(r.population) + '</p>' : '') +
        '<p>' + esc(r.finding) + '</p>' +
        (r.caveat ? '<p class="rs-muted"><strong>Keep in mind:</strong> ' + esc(r.caveat) + '</p>' : '') +
        quoteHtml(r) + sourceLine(r) + reviewHtml(r) +
        '</article>';
    }).join('') + '</div>';
  }

  function qapHtml(doc) {
    var list = byKind(doc, 'qap');
    var qd = (doc && doc.meta && doc.meta.qap_document) || {};
    if (!list.length) return '<p class="rs-muted">No QAP records are loaded.</p>';
    var url = safeUrl(qd.url);
    var head = '<p class="rs-muted">Quoted from ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(qd.title) + '</a>' : esc(qd.title)) +
      (qd.note ? '. ' + esc(qd.note) : '') + '</p>';
    return head + '<div class="rs-cards">' + list.map(function (r) {
      return '<article class="rs-card" data-rs-entry="' + esc(r.id) + '">' +
        '<h4>' + esc(r.title) + '</h4>' +
        (r.section ? '<p class="rs-muted">QAP ' + esc(r.section) + '</p>' : '') +
        '<p>' + esc(r.finding) + '</p>' +
        '<blockquote class="rs-qap">' + esc(r.quote) + '</blockquote>' +
        reviewHtml(r) + '</article>';
    }).join('') + '</div>';
  }

  function fundingHtml(doc) {
    var list = byKind(doc, 'funding');
    if (!list.length) return '<p class="rs-muted">No funding records are loaded.</p>';
    var summary = global.ReviewStatus ? global.ReviewStatus.summaryHtml(list, undefined, 'funding sources') : '';
    return summary + '<div class="rs-table-wrap rs-stack"><table class="data-table"><thead><tr>' +
      '<th scope="col">Source</th><th scope="col">What it pays for</th><th scope="col">Limits</th><th scope="col">Source and check</th>' +
      '</tr></thead><tbody>' + list.map(function (r) {
        return '<tr data-rs-entry="' + esc(r.id) + '"><th scope="row">' + esc(r.title) + '</th>' +
          '<td>' + esc(r.finding) + quoteHtml(r) + '</td>' +
          '<td>' + esc(r.limits || '') + '</td>' +
          '<td>' + sourceLine(r) + reviewHtml(r) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function costHtml(doc) {
    var list = byKind(doc, 'cost');
    if (!list.length) return '<p class="rs-muted">No cost records are loaded.</p>';
    return '<div class="rs-cards">' + list.map(function (r) {
      return '<article class="rs-card" data-rs-entry="' + esc(r.id) + '">' +
        '<h4>' + esc(r.title) + '</h4>' +
        (r.figure ? '<p class="rs-figure">' + esc(r.figure) + '</p>' : '') +
        '<p>' + esc(r.finding) + '</p>' +
        (r.caveat ? '<p class="rs-muted"><strong>Keep in mind:</strong> ' + esc(r.caveat) + '</p>' : '') +
        quoteHtml(r) + sourceLine(r) + reviewHtml(r) + '</article>';
    }).join('') + '</div>';
  }

  /**
   * Pure: join the curated award notes to the award file, by name. A note
   * whose award is missing from the file is dropped and counted, never drawn
   * from the note alone.
   */
  function joinAwards(doc, awardsDoc) {
    var notes = (doc && doc.awards && Array.isArray(doc.awards.items)) ? doc.awards.items : [];
    var awards = (awardsDoc && Array.isArray(awardsDoc.awards)) ? awardsDoc.awards : [];
    var byName = {};
    awards.forEach(function (a) { byName[a.name] = a; });
    var rows = [];
    var missing = 0;
    notes.forEach(function (n) {
      var a = byName[n.name];
      if (!a) { missing++; return; }
      rows.push({ name: a.name, city: a.city, units: a.total_units, model: n.model, quote: n.quote });
    });
    var described = rows.length;
    return {
      rows: rows,
      missing: missing,
      total: awards.length,
      described: described,
      round: awardsDoc && awardsDoc.metadata ? awardsDoc.metadata.round : null,
      sourceUrl: awardsDoc && awardsDoc.metadata ? safeUrl(awardsDoc.metadata.source_url) : null
    };
  }

  function awardsHtml(joined, modelText) {
    if (!joined.total) return '<p class="rs-muted">The award file could not be read, so this table is not shown.</p>';
    var link = joined.sourceUrl ? '<a href="' + esc(joined.sourceUrl) + '" target="_blank" rel="noopener">CHFA\'s award descriptions</a>' : 'CHFA\'s award descriptions';
    var lead = '<p data-rs-award-count>' + joined.described + ' of the ' + joined.total + ' developments awarded in ' + esc(joined.round || 'this round') +
      ' describe resident or supportive services in ' + link + '. For the other ' + (joined.total - joined.described) +
      ', the stored excerpt of CHFA\'s description does not mention services. That does not mean they offer none: the excerpt is cut short, and some services plans are only in the full application.</p>';
    var table = '<div class="rs-table-wrap rs-stack"><table class="data-table"><thead><tr>' +
      '<th scope="col">Development</th><th scope="col">Kind of services</th><th scope="col">From CHFA\'s description</th>' +
      '</tr></thead><tbody>' + joined.rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r.name) + '<br><span class="rs-muted">' + esc(r.city) + (r.units ? ' · ' + esc(r.units) + ' units' : '') + '</span></th>' +
          '<td>' + esc((modelText && modelText[r.model]) || r.model) + '</td>' +
          '<td>&ldquo;' + esc(r.quote) + '&rdquo;</td></tr>';
      }).join('') + '</tbody></table></div>';
    return lead + table;
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      return response.json();
    });
  }

  function fill(rootEl, selector, html) {
    var el = rootEl.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  function render(rootEl, doc, awardsDoc) {
    fill(rootEl, '[data-rs-evidence]', evidenceHtml(doc));
    fill(rootEl, '[data-rs-qap]', qapHtml(doc));
    fill(rootEl, '[data-rs-funding]', fundingHtml(doc));
    fill(rootEl, '[data-rs-costs]', costHtml(doc));
    fill(rootEl, '[data-rs-awards]', awardsHtml(joinAwards(doc, awardsDoc), doc.awards && doc.awards.models));
    var checked = longDate(doc.meta && doc.meta.last_verified);
    fill(rootEl, '[data-rs-checked]', checked ? 'Sources last checked ' + esc(checked) : '');
  }

  function init() {
    var rootEl = global.document && global.document.querySelector('[data-resident-services]');
    if (!rootEl) return;
    fetchJson(DATA).then(function (doc) {
      var awardsFile = doc.awards && doc.awards.file;
      var awards = awardsFile ? fetchJson(awardsFile).catch(function () { return null; }) : Promise.resolve(null);
      return awards.then(function (awardsDoc) { render(rootEl, doc, awardsDoc); });
    }).catch(function (err) {
      rootEl.querySelectorAll('[data-rs-evidence],[data-rs-qap],[data-rs-funding],[data-rs-costs],[data-rs-awards]').forEach(function (el) {
        el.innerHTML = '<p class="rs-muted">This section could not load its data (' + esc(err && err.message) + ').</p>';
      });
    });
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { joinAwards: joinAwards, render: render, evidenceHtml: evidenceHtml, awardsHtml: awardsHtml };
}));
