// Deal summaries (#/deals, #/deals/<slug>): one hand-researched record per CHFA award, from the live site's
// data/deals/ files. The lab lays each record out in the Data template; every figure keeps its numbered
// source, exactly as the record cites it.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var LIVE = 'https://cohoanalytics.com/deal-summary.html';
  var AWARDS = 'https://www.chfainfo.com/rental-housing/housing-credit/awards';
  var one = {};

  function crumbs(page, extra) { return T.trail('deal', page, extra); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }

  // ?county=<name>, as CHFA prints it: the list shows that county's summaries. The Housing Needs Assessment links
  // to a county's write-ups this way (deal-summary.html?county=, which forwards here with it).
  var COUNTY = /^[A-Za-z .'-]{2,40}$/;

  // ?round=<year>-<n>: one CHFA competitive round, read from CHFA's own award list for that round. This was the
  // 2026 Round One page (#/opportunity/round-one, which forwards here): one home for awards is Deal summaries
  // (one-home proposal item 4, paul "go remaining duplicates", 18 Nov 2026). Every column it showed is kept.
  var ROUNDS = {
    '2026-1': { label: '2026 Round One', file: 'data/affordable-housing/chfa-awards/2026-round-one.json' },
    '2026-2': { label: '2026 Round Two', file: 'data/affordable-housing/chfa-awards/2026-round-two.json' }
  };
  function roundLinks(cur) {
    return '<p class="note">By round: ' + ['<a href="#/deals"' + (cur ? '' : ' aria-current="page"') + '>Every summary</a>'].concat(Object.keys(ROUNDS).map(function (k) {
      return '<a href="#/deals?round=' + k + '"' + (k === cur ? ' aria-current="page"' : '') + '>' + esc(ROUNDS[k].label) + ' awards</a>';
    })).join(' · ') + '</p>';
  }
  function round(key) {
    var R = ROUNDS[key], title = R.label + ' tax credit awards';
    var s = UI.load({ round: R.file });
    var head = function (answer, meta) { return T.head({ kind: 'data', crumbs: crumbs(R.label, [{ label: 'Deal summaries', href: '#/deals' }]), title: title, answer: answer, meta: meta }); };
    if (!s.data) return head('CHFA’s ' + R.label + ' housing tax credit awards.') + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var m = s.data.round.metadata, awards = s.data.round.awards || [];
    var year = Number(key.split('-')[0]);
    var summaryOf = function (r) { return summaryHref({ agency: 'CHFA', year: year, name: r.name }); };
    var written = awards.filter(summaryOf).length;
    var homes = awards.reduce(function (t, a) { return t + (Number(a.total_units) || 0); }, 0);
    var anyFour = awards.some(function (a) { return a.federal_4pct_credit; }), anyNine = awards.some(function (a) { return a.federal_9pct_credit; });
    var cols = [
      { key: 'name', label: 'Development', href: function (r) { return summaryOf(r) || UI.placeFor(r.city); }, tip: 'Opens COHO’s sourced deal summary where one is written, otherwise the town' },
      { key: 'city', label: 'City' }, { key: 'county', label: 'County' }, { key: 'sponsor', label: 'Sponsor' },
      { key: 'total_units', label: 'Homes', num: true, fmt: UI.num }
    ].concat(anyNine ? [{ key: 'federal_9pct_credit', label: '9% credit', num: true, fmt: UI.money, tip: 'Annual federal 9% credit awarded' }] : [])
      .concat(anyFour ? [{ key: 'federal_4pct_credit', label: '4% credit', num: true, fmt: UI.money, tip: 'Annual federal 4% credit, where listed' }] : [])
      .concat([{ key: 'state_credit', label: 'State credit', num: true, fmt: UI.money, tip: 'Colorado state credit awarded' }, { key: 'unit_mix_raw', label: 'Unit mix' }]);
    var srcs = [[m.source_url, 'CHFA award descriptions'], [m.press_release_url, 'press release'], [m.pdf_report_url, 'award report']].filter(function (x) { return safeUrl(x[0]); });
    var total = m.press_release_total_units || homes;
    return head(UI.num(m.parsed_count || awards.length) + ' developments won credits for ' + UI.num(total) + ' homes' + (m.press_release_total_equity_M ? ' and about $' + esc(m.press_release_total_equity_M) + ' million in equity' : '') + '. Announced by CHFA on ' + esc(m.announcement_date) + '.',
      '<span class="scope-tag">Scope: CHFA ' + esc(R.label) + '</span> ' + UI.num(written) + ' of ' + UI.num(awards.length) + ' have a COHO deal summary so far.') +
      roundLinks(key) +
      UI.bars('Homes in each award', null, awards.map(function (a) { return [a.name + ', ' + a.city, a.total_units]; }).sort(function (a, b) { return b[1] - a[1]; }), UI.num) +
      UI.table('r1', R.label + ' awards', cols, awards, { noun: 'awards', placeholder: 'Name, city or sponsor' }) +
      '<p class="note metric-source">' + (m.note ? esc(m.note) + ' ' : '') + 'Sources: ' + srcs.map(function (x) { return '<a href="' + esc(x[0]) + '">' + esc(x[1]) + '</a>'; }).join(' and ') + ', announced ' + esc(m.announcement_date) + '.</p>' +
      T.next('Next', [{ href: '#/deals', label: 'Every deal summary →' }, { href: '#/opportunity/portfolio', label: 'Whole tax credit portfolio', secondary: true }]);
  }

  function list(params) {
    var s = UI.load({ index: 'data/deals/index.json' });
    if (!s.data) return '<h1>Deal summaries</h1>' + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var all = s.data.index.deals.slice().sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.name).localeCompare(String(b.name)); });
    var homes = all.reduce(function (t, r) { return t + (Number(r.units) || 0); }, 0);
    var latest = all.reduce(function (m, r) { return r.researched_on && r.researched_on > m ? r.researched_on : m; }, '');
    var nine = all.filter(function (r) { return /9%/.test(r.award); }).length, four = all.filter(function (r) { return /4%/.test(r.award); }).length;
    var byYear = UI.tally(all, function (r) { return r.year; }, function () { return 1; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var rk = params && params.get ? String(params.get('round') || '') : '';
    if (ROUNDS[rk]) return round(rk);
    var want = params && params.get ? String(params.get('county') || '').trim() : '';
    if (!COUNTY.test(want)) want = '';
    var mine = want ? all.filter(function (r) { return String(r.county || '').toLowerCase() === want.toLowerCase(); }) : null;
    if (mine && mine.length) want = mine[0].county;
    var cols = [
      { key: 'name', label: 'Deal', href: function (r) { return '#/deals/' + r.slug; }, tip: 'Project name as CHFA prints it' },
      { key: 'city', label: 'City' }, { key: 'county', label: 'County' },
      { key: 'award', label: 'Award', tip: 'The CHFA award the summary covers' },
      { key: 'year', label: 'Year', num: true },
      { key: 'units', label: 'Homes', num: true, fmt: UI.num, tip: 'Total homes as CHFA prints them' }
    ];
    // A county's list (?county=) is the page the reader asked for: its own title, its rows, and a way back to every summary.
    if (mine) {
      return T.head({
        kind: 'data', crumbs: crumbs(want + ' County', [{ label: 'Deal summaries', href: '#/deals' }]), title: 'Deal summaries for ' + want + ' County',
        answer: (mine.length ? UI.num(mine.length) + ' of the ' + UI.num(all.length) + ' sourced summaries of Colorado housing tax credit awards are in ' + esc(want) + ' County.'
          : 'No summary for ' + esc(want) + ' County yet. Summaries are added in batches.') + ' <a href="#/deals">Show every summary</a>',
        meta: '<span class="scope-tag">Scope: CHFA awards</span> Researched through ' + esc(latest) + ' from public records. Each summary lists its own dated sources.'
      }) +
        (mine.length ? UI.table('deals', 'Deal summaries in ' + want + ' County, newest awards first', cols, mine, { noun: 'deals', placeholder: 'Name, city or credit' }) + T.source('CHFA housing tax credit award reports', AWARDS, latest) : '') +
        T.next('Next', [{ href: '#/deals', label: 'Every deal summary →' }, { href: '#/deal-calculator', label: 'Test a LIHTC deal', secondary: true }]);
    }
    return T.head({
      kind: 'data', crumbs: crumbs('Deal summaries'), title: 'Deal summaries',
      answer: 'One sourced summary per Colorado housing tax credit award: the homes, who they serve, the public money and what is still open.',
      meta: '<span class="scope-tag">Scope: CHFA awards</span> Researched through ' + esc(latest) + ' from public records. Each summary lists its own dated sources. A few deals have both 9% and 4% credits or neither, so those two counts do not add to the total.',
      facts: [
        { value: UI.num(all.length), label: 'Summaries so far', source: 'COHO deal summaries', href: LIVE },
        { value: UI.num(homes), label: 'Homes in them', source: 'CHFA award reports', href: AWARDS },
        { value: UI.num(nine), label: 'With 9% credits', source: 'CHFA award reports', href: AWARDS },
        { value: UI.num(four), label: 'With 4% credits', source: 'CHFA award reports', href: AWARDS }
      ]
    }) +
      UI.bars('Summaries by award year', 'Counts of summaries, not of all awards', byYear.map(function (r) { return [String(r[0]), r[1]]; }), UI.num) + T.source('CHFA housing tax credit award reports', AWARDS, latest) +
      '<h2>Every summary</h2>' + roundLinks('') + UI.table('deals', 'Every deal summary, newest awards first', cols, all, { noun: 'deals', placeholder: 'Name, city, county or credit' }) +
      T.source('CHFA housing tax credit award reports', AWARDS, latest) +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Test a LIHTC deal →' }, { href: '#/deals?round=2026-1', label: '2026 Round One awards', secondary: true }]);
  }

  function load(slug) {
    if (one[slug]) return one[slug];
    var c = one[slug] = { d: null, error: null };
    fetch((global.LAB_VENDOR) + 'data/deals/' + slug + '.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { c.d = d; Shell.render(); })
      .catch(function (e) { c.error = 'This summary did not load (' + e.message + ').'; Shell.render(); });
    return c;
  }

  // One deal: the live page's sections in its order, under the Data template. Citations stay numbered.
  function deal(slug) {
    var idx = UI.load({ index: 'data/deals/index.json' });
    if (!idx.data) return '<h1>Deal summary</h1><p role="status" class="note">Loading…</p>';
    if (!idx.data.index.deals.some(function (r) { return r.slug === slug; })) {
      return T.head({ kind: 'data', crumbs: crumbs('Not found', [{ label: 'Deal summaries', href: '#/deals' }]), title: 'Not found', answer: 'There is no deal summary at this address.' }) + T.next('Next', [{ href: '#/deals', label: 'Every deal summary' }]);
    }
    var c = load(slug);
    if (!c.d) return '<h1>Deal summary</h1>' + (c.error ? '<p class="callout">' + esc(c.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var d = c.d, order = {};
    (d.sources || []).forEach(function (s, i) { order[s.id] = i + 1; });
    function cite(ids) {
      return (ids || []).filter(function (id) { return order[id]; }).map(function (id) { return '<a class="fn-cite" href="#/deals/' + esc(slug) + '" data-jump="ds-src-' + order[id] + '" aria-label="Source ' + order[id] + '">[' + order[id] + ']</a>'; }).join('');
    }
    var idPattern = Object.keys(order).length ? new RegExp('(^|[^a-z0-9-])(' + Object.keys(order).sort(function (a, b) { return b.length - a.length; })
      .map(function (id) { return id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![a-z0-9-])', 'g') : null;
    function withCites(x) { var t = esc(x); return idPattern ? t.replace(idPattern, function (m, pre, id) { return pre + cite([id]); }) : t; }
    function table(head, rows, caption) {
      return '<div class="table-scroll"><table class="ds-table"><caption>' + esc(caption) + '</caption><thead><tr>' + head.map(function (h) { return '<th scope="col"' + (h[1] ? ' title="' + esc(h[1]) + '"' : '') + (h[2] ? ' class="num"' : '') + '>' + esc(h[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    }
    function mix(rows, label, key, caption) {
      if (!rows || !rows.length) return '';
      var total = rows.reduce(function (t, r) { return t + (Number(r.units) || 0); }, 0);
      return UI.bars(caption, 'Homes, ' + UI.num(total) + ' in all', rows.map(function (r) { return [String(r[key]), Number(r.units) || 0]; }), UI.num);
    }
    var sec = [];
    function add(id, title, body) { if (body) sec.push({ id: id, title: title, html: body }); }
    add('ds-facts', 'Project facts', d.facts && d.facts.length ? table([['Item'], ['Value', 'As the cited source prints it'], ['Source']], d.facts.map(function (f) { return '<tr><td>' + esc(f.item) + '</td><td>' + esc(f.value) + '</td><td>' + cite(f.src) + '</td></tr>'; }), 'Project facts') : '');
    var mixes = mix(d.income_mix, 'Income level', 'level', 'Homes by income level') + mix(d.bedroom_mix, 'Unit size', 'type', 'Homes by unit size');
    add('ds-mix', 'Who the homes are for', mixes ? '<div class="chart-pair">' + mixes + '</div><p class="note">Source: ' + cite(d.mix_src) + '</p>' : '');
    add('ds-money', 'The public money', d.money && d.money.length ? table([['Source of money'], ['Amount', 'As the cited source prints it', 1], ['Note'], ['Source']], d.money.map(function (m) { return '<tr><td>' + esc(m.source) + '</td><td class="num">' + esc(m.amount) + '</td><td>' + esc(m.note || '') + '</td><td>' + cite(m.src) + '</td></tr>'; }), 'Public money in the deal') : '');
    add('ds-parties', 'Who is involved', d.parties && d.parties.length ? '<ul>' + d.parties.map(function (p) { return '<li><strong>' + esc(p.role) + ':</strong> ' + esc(p.name) + ' ' + cite(p.src) + '</li>'; }).join('') + '</ul>' : '');
    add('ds-background', 'Background, land and approvals', d.background && d.background.length ? '<ul>' + d.background.map(function (b) { return '<li>' + esc(b.text) + ' ' + cite(b.src) + '</li>'; }).join('') + '</ul>' : '');
    add('ds-timeline', 'Timeline', d.timeline && d.timeline.length ? table([['Date'], ['Event'], ['Source']], d.timeline.map(function (t) { return '<tr><td>' + esc(t.date) + '</td><td>' + esc(t.event) + '</td><td>' + cite(t.src) + '</td></tr>'; }), 'Timeline') : '');
    add('ds-pictures', 'Site plans and pictures', d.pictures && d.pictures.length ? '<ul>' + d.pictures.map(function (p) { var u = safeUrl(p.url); return '<li>' + (u ? '<a href="' + esc(u) + '">' + esc(p.title) + '</a>' : esc(p.title)) + ' (' + esc(p.kind) + (p.made_by ? ', by ' + esc(p.made_by) : '') + ')' + (p.note ? ': ' + esc(p.note) : '') + ' ' + cite(p.src) + '</li>'; }).join('') + '</ul><p class="note">Pictures stay in the public documents they come from; each link opens the document.</p>' : '');
    add('ds-checks', 'Where sources disagree', d.discrepancies && d.discrepancies.length ? '<ul>' + d.discrepancies.map(function (x) { return '<li>' + (x && typeof x === 'object' ? withCites(x.text) + ' ' + cite(x.src) : withCites(x)) + '</li>'; }).join('') + '</ul>' : '');
    add('ds-open', 'Not public yet', d.open_questions && d.open_questions.length ? '<ul>' + d.open_questions.map(function (x) { return '<li>' + withCites(x) + '</li>'; }).join('') + '</ul>' : '');
    add('ds-sources', 'Sources', d.sources && d.sources.length ? '<ol class="ds-sources">' + d.sources.map(function (s, i) { var u = safeUrl(s.url); return '<li id="ds-src-' + (i + 1) + '" tabindex="-1">' + esc([s.publisher, s.title].filter(Boolean).join(', ')) + (s.date ? ' (' + esc(s.date) + ')' : '') + (u ? '. <a href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, '').slice(0, 70)) + (u.length > 78 ? '…' : '') + '</a>' : '') + '</li>'; }).join('') + '</ol>' : '');

    var keys = (d.key_numbers || []).slice(0, 4);
    return T.head({
      kind: 'data', crumbs: crumbs(d.name, [{ label: 'Deal summaries', href: '#/deals' }]), title: d.name,
      answer: esc(d.headline || ''),
      meta: esc([d.city, d.county ? d.county + ' County' : null].filter(Boolean).join(', ') + ' · ' + d.award) +
        (d.status ? '<br><strong>Status:</strong> ' + esc(d.status.label) + '. ' + esc(d.status.detail || '') + ' ' + cite(d.status.src) : '')
    }) +
      (keys.length ? '<ul class="fact-strip ds-keys">' + keys.map(function (k) { return '<li><span class="fact-value">' + esc(k.value) + '</span><span class="fact-label">' + esc(k.meaning) + '</span><span class="fact-source">' + cite(k.src) + '</span></li>'; }).join('') + '</ul>' : '') +
      (d.why_it_matters ? '<p class="callout"><strong>Why this matters:</strong> ' + esc(d.why_it_matters) + '</p>' : '') +
      (d.next_step ? '<p><strong>Next step:</strong> ' + esc(d.next_step) + '</p>' : '') +
      T.onThisPage(sec.map(function (x) { return { id: x.id, title: x.title }; }), true) +
      sec.map(function (x) { return '<section id="' + x.id + '" tabindex="-1"><h2>' + esc(x.title) + '</h2>' + x.html + '</section>'; }).join('') +
      '<p class="note">Researched ' + esc(d.researched_on || '') + ' from public records. Amounts on CHFA award reports are marked subject to change until closing. <a href="' + esc(LIVE + '?d=' + slug) + '">This summary on the Deal Summaries page</a>.</p>' +
      T.next('Next', [{ href: '#/deals', label: 'Every deal summary →' }, { href: '#/deal-calculator', label: 'Test a similar deal', secondary: true }]);
  }

  // The summary for one award row, as the live Where the money goes page matches it (js/agency-funding.js dealFor):
  // same agency and year, and the same name, or one name starting the other when the ledger cuts a long name short.
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function dealFor(deals, a) {
    var n = normName(a && a.name);
    if (!n || !deals) return null;
    for (var i = 0; i < deals.length; i++) {
      var m = deals[i].match || {};
      if (m.agency !== a.agency || (m.year && a.year && Number(m.year) !== Number(a.year))) continue;
      var hit = (m.names || []).some(function (x) { var k = normName(x); return k === n || (n.length >= 12 && k.indexOf(n) === 0) || (k.length >= 12 && n.indexOf(k) === 0); });
      if (hit) return deals[i];
    }
    return null;
  }

  Shell.views.deals = function (params, parts) { return parts[1] ? deal(parts[1]) : list(params); };
  // The summary page for one award row ('#/deals/<slug>'), or null. Loads the index the way the list does (UI.load keys a
  // load by its file paths, so every caller must name the file 'index'), and redraws when it arrives.
  function summaryHref(a) {
    var s = UI.load({ index: 'data/deals/index.json' });
    var dl = s.data && s.data.index ? dealFor(s.data.index.deals, a) : null;
    return dl ? '#/deals/' + dl.slug : null;
  }
  global.LabDeals = { list: list, deal: deal, dealFor: dealFor, summaryHref: summaryHref };
})(window);
