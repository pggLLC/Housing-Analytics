/**
 * deal-summary.js: one sourced summary per CHFA housing tax credit award, on deal-summary.html.
 *
 * deal-summary.html?d=<slug> draws data/deals/<slug>.json; with no (or an unknown) slug it lists
 * every summary in data/deals/index.json. Each record is hand-researched from public sources and
 * every figure names its source ids, which are drawn as numbered links to the Sources list.
 * Rows on where-housing-money-goes.html link here (js/agency-funding.js reads the same index).
 */
(function (global) {
  'use strict';

  var INDEX = 'data/deals/index.json';
  var root, view;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  }

  function slugFromUrl() {
    var m = /[?&]d=([a-z0-9-]+)/.exec(global.location.search || '');
    return m ? m[1] : null;
  }

  // ── one deal ──────────────────────────────────────────────────────────────
  function renderDeal(d) {
    var order = {};
    (d.sources || []).forEach(function (s, i) { order[s.id] = i + 1; });
    function cite(ids) {
      return (ids || []).filter(function (id) { return order[id]; }).map(function (id) {
        return '<a class="ds-cite" href="#ds-src-' + order[id] + '" aria-label="Source ' + order[id] + '">[' + order[id] + ']</a>';
      }).join('');
    }
    // Researchers name source ids inline in free text ("[chfa-4pct-award; dc-plat-staff]");
    // swap each known id for its numbered citation link so the text stays traceable.
    var idPattern = Object.keys(order).length ? new RegExp('(^|[^a-z0-9-])(' + Object.keys(order).sort(function (a, b) { return b.length - a.length; })
      .map(function (id) { return id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![a-z0-9-])', 'g') : null;
    function textWithCites(x) {
      var t = esc(x);
      return idPattern ? t.replace(idPattern, function (m, pre, id) { return pre + cite([id]); }) : t;
    }
    function list(items, fn) { return items && items.length ? items.map(fn).join('') : ''; }
    function section(title, body, open) {
      if (!body) return '';
      return '<details class="ds-fold"' + (open ? ' open' : '') + '><summary><h2>' + esc(title) + '</h2></summary><div class="ds-fold-body">' + body + '</div></details>';
    }
    function table(head, rows, caption) {
      return '<div class="ds-scroll"><table class="ds-table"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>' +
        head.map(function (h) { return '<th scope="col" data-tip="' + esc(h[1]) + '">' + esc(h[0]) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    }
    function mixTable(rows, label, keyName, caption) {
      if (!rows || !rows.length) return '';
      var total = rows.reduce(function (t, r) { return t + (Number(r.units) || 0); }, 0);
      var max = Math.max.apply(null, rows.map(function (r) { return Number(r.units) || 0; })) || 1;
      return table([[label, keyName === 'level' ? 'Income limit tier, as a share of area median income (AMI)' : 'Unit size'], ['Homes', 'Number of homes at this level'], ['Share', 'Share of all homes in this table']],
        rows.map(function (r) {
          var n = Number(r.units) || 0;
          return '<tr><td>' + esc(r[keyName]) + '</td><td class="num">' + n.toLocaleString('en-US') +
            '</td><td><span class="ds-bar" style="width:' + Math.round(n / max * 100) + '%" aria-hidden="true"></span>' +
            (total ? Math.round(n / total * 100) + '%' : '') + '</td></tr>';
        }).concat(['<tr class="total ds-total"><td>Total</td><td class="num">' + total.toLocaleString('en-US') + '</td><td></td></tr>']), caption);
    }

    var keys = list((d.key_numbers || []).slice(0, 4), function (k) {
      return '<li class="ds-key"><span class="ds-key-value">' + esc(k.value) + '</span><span class="ds-key-meaning">' + esc(k.meaning) + ' ' + cite(k.src) + '</span></li>';
    });
    var top =
      '<header class="ds-head"><p class="ds-kicker">' + esc([d.city, d.county ? d.county + ' County' : null].filter(Boolean).join(', ')) + ' · ' + esc(d.award) + '</p>' +
      '<h1>' + esc(d.name) + '</h1>' +
      '<p class="ds-headline">' + esc(d.headline) + '</p>' +
      (d.status ? '<p class="ds-status"><strong>Status:</strong> ' + esc(d.status.label) + '. ' + esc(d.status.detail || '') + ' ' + cite(d.status.src) + '</p>' : '') +
      '</header>' +
      (keys ? '<ul class="ds-keys">' + keys + '</ul>' : '') +
      (d.why_it_matters ? '<p class="ds-why"><strong>Why this matters:</strong> ' + esc(d.why_it_matters) + '</p>' : '') +
      (d.next_step ? '<p class="ds-next"><strong>Next step:</strong> ' + esc(d.next_step) + '</p>' : '') +
      '<p class="ds-actions"><button type="button" class="ds-print" data-ds-print>Download as PDF</button> <a href="deal-summary.html">All deal summaries</a></p>';

    var facts = d.facts && d.facts.length ? table([['Item', 'What the fact is'], ['Value', 'As the cited source prints it'], ['Source', 'Numbered source, listed at the end']],
      d.facts.map(function (f) { return '<tr><td>' + esc(f.item) + '</td><td>' + esc(f.value) + '</td><td>' + cite(f.src) + '</td></tr>'; }), 'Project facts') : '';
    var mix = mixTable(d.income_mix, 'Income level', 'level', 'Homes by income level') +
      mixTable(d.bedroom_mix, 'Unit size', 'type', 'Homes by unit size') +
      ((d.income_mix && d.income_mix.length) || (d.bedroom_mix && d.bedroom_mix.length) ? '<p class="ds-muted">Source: ' + cite(d.mix_src) + '</p>' : '');
    var money = d.money && d.money.length ? table([['Source of money', 'Who provides it'], ['Amount', 'As the cited source prints it'], ['Note', 'What the amount covers'], ['Source', 'Numbered source']],
      d.money.map(function (m) { return '<tr><td>' + esc(m.source) + '</td><td class="num">' + esc(m.amount) + '</td><td>' + esc(m.note || '') + '</td><td>' + cite(m.src) + '</td></tr>'; }), 'Public money in the deal') : '';
    var parties = d.parties && d.parties.length ? '<ul class="ds-list">' + list(d.parties, function (p) { return '<li><strong>' + esc(p.role) + ':</strong> ' + esc(p.name) + ' ' + cite(p.src) + '</li>'; }) + '</ul>' : '';
    var background = d.background && d.background.length ? '<ul class="ds-list">' + list(d.background, function (b) { return '<li>' + esc(b.text) + ' ' + cite(b.src) + '</li>'; }) + '</ul>' : '';
    var timeline = d.timeline && d.timeline.length ? table([['Date', 'Date as the source gives it'], ['Event', 'What happened or is planned'], ['Source', 'Numbered source']],
      d.timeline.map(function (t) { return '<tr><td class="ds-nowrap">' + esc(t.date) + '</td><td>' + esc(t.event) + '</td><td>' + cite(t.src) + '</td></tr>'; }), 'Timeline') : '';
    var pictures = d.pictures && d.pictures.length ? '<ul class="ds-list">' + list(d.pictures, function (p) {
      var u = safeUrl(p.url);
      return '<li>' + (u ? '<a href="' + esc(u) + '" rel="noopener" target="_blank">' + esc(p.title) + '</a>' : esc(p.title)) +
        ' (' + esc(p.kind) + (p.made_by ? ', by ' + esc(p.made_by) : '') + ')' + (p.note ? ': ' + esc(p.note) : '') + ' ' + cite(p.src) + '</li>';
    }) + '</ul><p class="ds-muted">Pictures stay in the public documents they come from; each link opens the document.</p>' : '';
    var checks = (d.discrepancies || []).concat([]).length ? '<ul class="ds-list">' + list(d.discrepancies, function (x) { return '<li>' + (x && typeof x === 'object' ? textWithCites(x.text) + ' ' + cite(x.src) : textWithCites(x)) + '</li>'; }) + '</ul>' : '';
    var open = d.open_questions && d.open_questions.length ? '<ul class="ds-list">' + list(d.open_questions, function (x) { return '<li>' + textWithCites(x) + '</li>'; }) + '</ul>' : '';
    var sources = d.sources && d.sources.length ? '<ol class="ds-sources">' + list(d.sources, function (s, i) {
      var u = safeUrl(s.url);
      return '<li id="ds-src-' + (i + 1) + '">' + esc([s.publisher, s.title].filter(Boolean).join(', ')) + (s.date ? ' (' + esc(s.date) + ')' : '') +
        (u ? '. <a href="' + esc(u) + '" rel="noopener" target="_blank">' + esc(u.replace(/^https?:\/\//, '').slice(0, 70)) + (u.length > 78 ? '…' : '') + '</a>' : '') + '</li>';
    }) + '</ol>' : '';

    view.innerHTML = top +
      section('Project facts', facts, true) +
      section('Who the homes are for', mix, true) +
      section('The public money', money, true) +
      section('Who is involved', parties) +
      section('Background, land and approvals', background) +
      section('Timeline', timeline) +
      section('Site plans and pictures', pictures) +
      section('Where sources disagree', checks) +
      section('Not public yet', open) +
      section('Sources', sources, true) +
      '<p class="ds-muted">Researched ' + esc(d.researched_on || '') + ' from public records. Amounts on CHFA award reports are marked subject to change until closing.</p>';
    var crumb = root.querySelector('[data-ds-crumb]');
    if (crumb) crumb.textContent = d.name;
    document.title = d.name + ' | Deal Summaries | COHO Analytics';
  }

  // ── the list ──────────────────────────────────────────────────────────────
  // County, year and credit filters; ?county=<name> (as CHFA prints it) opens the list filtered,
  // which is how the Housing Needs Assessment pages link to a county's write-ups.
  // An award can carry both credits ("Federal 9% and 4% ..."), so a deal matches every credit its award names.
  function hasCredit(award, kind) {
    var a = String(award || '');
    if (kind === 'Other') return !/9%|4%/.test(a);
    return a.indexOf(kind) !== -1;
  }

  function paramFromUrl(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(global.location.search || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (_) { return ''; }
  }

  function renderIndex(idx) {
    var all = (idx.deals || []).slice().sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.name).localeCompare(String(b.name)); });
    function uniq(fn) {
      var seen = {};
      all.forEach(function (r) { var k = fn(r); if (k !== '' && k !== null && k !== undefined) seen[k] = true; });
      return Object.keys(seen);
    }
    var counties = uniq(function (r) { return r.county; }).sort();
    var years = uniq(function (r) { return r.year; }).sort().reverse();
    function select(id, label, values, labelFn) {
      return '<label class="ds-filter" for="' + id + '">' + esc(label) + ' <select id="' + id + '"><option value="">All</option>' +
        values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(labelFn ? labelFn(v) : v) + '</option>'; }).join('') + '</select></label>';
    }
    var latest = all.reduce(function (m, r) { return r.researched_on && r.researched_on > m ? r.researched_on : m; }, '');
    view.innerHTML = '<h1>Deal summaries</h1>' +
      '<p class="ds-headline">One sourced summary per Colorado housing tax credit award: the homes, who they serve, the public money, the land deal and what is still open. Built from CHFA, state and local public records, newest awards first.</p>' +
      '<div class="ds-filters" role="group" aria-label="Filter the deal summaries">' +
      select('dsCounty', 'County', counties, function (c) { return c + ' County'; }) +
      select('dsYear', 'Award year', years) +
      select('dsCredit', 'Credit', ['9%', '4%', 'Other'], function (k) { return k === 'Other' ? 'Other credits' : k + ' credits'; }) +
      '</div>' +
      '<p class="ds-muted" data-ds-count aria-live="polite"></p>' +
      '<div class="ds-scroll"><table class="ds-table"><caption class="sr-only">Every deal summary. Select a column heading to sort.</caption><thead><tr>' +
      '<th scope="col" data-tip="Project name as CHFA prints it">Deal</th><th scope="col" data-tip="City as CHFA prints it">City</th>' +
      '<th scope="col" data-tip="County the project is in">County</th>' +
      '<th scope="col" data-tip="The CHFA award the summary covers">Award</th><th scope="col" class="num" data-tip="Total homes as CHFA prints them">Homes</th></tr></thead><tbody data-ds-rows></tbody></table></div>' +
      '<p class="ds-muted">Source: homes and awards as printed in <a href="https://www.chfainfo.com/rental-housing/housing-credit/awards" target="_blank" rel="noopener">CHFA\'s housing tax credit award reports</a>' +
      (latest ? ' (researched through ' + esc(latest) + ')' : ' (date unconfirmed)') + '. Each summary lists its own dated sources.</p>' +
      '<p class="ds-muted">' + all.length + ' summaries so far. More are added in batches; every CHFA award also appears on <a href="where-housing-money-goes.html">Where Colorado\'s Housing Money Goes</a>.</p>';

    var body = view.querySelector('[data-ds-rows]');
    var count = view.querySelector('[data-ds-count]');
    var fCounty = view.querySelector('#dsCounty'), fYear = view.querySelector('#dsYear'), fCredit = view.querySelector('#dsCredit');
    var want = paramFromUrl('county');
    if (want) {
      // A county with no write-up yet stays selected and shows the empty state, not every county.
      if (counties.indexOf(want) === -1 && /^[A-Za-z .'-]{2,40}$/.test(want)) {
        var opt = document.createElement('option');
        opt.value = want; opt.textContent = want + ' County';
        fCounty.appendChild(opt);
      }
      if (fCounty.querySelector('option[value="' + want.replace(/"/g, '') + '"]')) fCounty.value = want;
    }

    function draw() {
      var rows = all.filter(function (r) {
        return (!fCounty.value || r.county === fCounty.value) &&
          (!fYear.value || String(r.year) === fYear.value) &&
          (!fCredit.value || hasCredit(r.award, fCredit.value));
      });
      body.innerHTML = rows.map(function (r) {
        return '<tr><td><a href="deal-summary.html?d=' + esc(r.slug) + '">' + esc(r.name) + '</a></td><td>' + esc(r.city) + '</td><td>' + esc(r.county) + '</td><td>' + esc(r.award) +
          '</td><td class="num">' + (r.units ? Number(r.units).toLocaleString('en-US') : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5">No write-ups match these filters yet.</td></tr>';
      var homes = rows.reduce(function (t, r) { return t + (Number(r.units) || 0); }, 0);
      count.textContent = 'Showing ' + rows.length + ' of ' + all.length + ' write-ups' + (homes ? ', ' + homes.toLocaleString('en-US') + ' homes' : '') + '.';
    }
    [fCounty, fYear, fCredit].forEach(function (el) { el.addEventListener('change', draw); });
    draw();
  }

  function start() {
    root = document.querySelector('[data-deal-summary]');
    if (!root) return;
    view = root.querySelector('[data-ds-view]');
    root.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-ds-print]')) {
        Array.prototype.forEach.call(root.querySelectorAll('details.ds-fold'), function (el) { el.open = true; });
        global.print();
      }
    });
    fetchJson(INDEX).then(function (idx) {
      var slug = slugFromUrl();
      var known = slug && (idx.deals || []).some(function (r) { return r.slug === slug; });
      if (!known) { renderIndex(idx); return null; }
      return fetchJson('data/deals/' + slug + '.json').then(renderDeal);
    }).catch(function () {
      view.innerHTML = '<p>The deal summaries could not be loaded. Try reloading the page.</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
