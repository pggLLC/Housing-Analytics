// Policy and research: Housing news (#/news), Who holds housing posts (#/housing-posts) and Legislation
// (#/legislation) from the live site's data files, and the menu's hub (#/guides). The live news page also
// carries events and the policy watch; here (paul 31 Oct) news keeps only the articles, events and law dates
// go to Deadlines and events (#/calendar), laws and the allocation plan to Legislation, and the housing posts
// to their own page. The LLM-written briefs on the live page are not carried over. Every row keeps its own
// source and date.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var LIVE = 'https://cohoanalytics.com/';
  var NEWS = { briefs: 'data/policy_briefs.json' };
  var POSTS = { watch: 'data/policy/policy-watch.json' };
  var LAW = { law: 'data/policy/tax-credit-legislation.json', watch: 'data/policy/policy-watch.json' };
  var SCOPE = { lihtc: 'Housing tax credits', nmtc: 'New Markets', oz: 'Opportunity Zones', homebuyer: 'Homes and energy', 'itc-ptc': 'Clean-energy credits', cra: 'Bank CRA rules' };
  var STATUS = { enacted: 'Enacted', proposed: 'Proposed', 'phased-out': 'Phased out', 'rule-pending': 'Rule pending' };

  function safe(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function wait(title, s, menu) {
    return T.head({ kind: 'data', crumbs: T.trail(menu || 'policy', title), title: title }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
  }

  // Policy watch entries under one heading per section; labels names the sections to show, in order.
  function watchList(w, labels) {
    return Object.keys(labels).map(function (k) {
      var items = w.entries.filter(function (e) { return e.section === k; });
      if (!items.length) return '';
      return '<h3>' + esc(labels[k]) + '</h3><ul class="pw-list">' + items.map(function (e) {
        var u = e.source && safe(e.source.url);
        return '<li><p><strong>' + esc(e.title) + '</strong></p><p>' + esc(e.detail) + '</p><p class="note">' + esc(e.date || '') + (u ? ' · <a href="' + esc(u) + '">' + esc(e.source.label) + '</a>' : '') +
          (e.verification ? ' · ' + esc(e.verification.level === 'primary' ? 'Checked against the primary source' : 'From a named outlet') + ' ' + esc(e.verification.checked || '') : '') + '</p></li>';
      }).join('') + '</ul>';
    }).join('');
  }

  // The ROAD to Housing Act's path to law, as the live Legislation page lists it (checked 11 October 2026).
  var ROAD_TIMELINE = [
    ['February 9, 2026', 'House passed the original measure.'],
    ['March 12, 2026', 'Senate passed an amended version under the 21st Century ROAD to Housing Act short title.'],
    ['May 20, 2026', 'House agreed to the Senate amendment with a further amendment.'],
    ['June 22, 2026', 'Senate concurred in the House amendment with an amendment, 85–5.'],
    ['June 23, 2026', 'House agreed to the Senate’s version, 358–32: final passage.'],
    ['July 11, 2026', 'H.R. 6644 became law without the President’s signature (Public Law 119-101).']
  ];

  // The live Legislation page's ROAD Act write-up: its enacted provisions, the tax credit read-through and what it
  // means in Colorado (QA 11-09). In the lab, read from site/guides/legislation-road.json, which
  // scripts/build-guide-pages.js copies from the pinned page word for word; inside the public site, from the page.
  var ROAD_KEEP = ['verified-enacted-housing-provisions', 'tax-credit-market-read-through', 'what-it-means-in-colorado'];
  var road = null;
  function roadSections() {
    if (!road) {
      road = {};
      var X = global.LabGuideExtract, done = function (g) { road.g = g; Shell.render(); }, fail = function () { road.error = true; Shell.render(); };
      // Inside the public site the page reads the Legislation page itself, cut the same way the lab's copy is
      // (site/guide-extract.js), so it never shows a frozen copy (format review F3).
      if (global.LAB_PORT && X && global.DOMParser) {
        fetch((global.LAB_VENDOR || '') + 'housing-legislation-2026.html').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (html) {
          var doc = new global.DOMParser().parseFromString(html, 'text/html'), main = doc.querySelector('main');
          if (!main || !main.querySelector('h2')) throw new Error('no article');
          done({ sections: X.byH2(main, doc, { routes: X.ROUTES, live: LIVE, keepPaths: false }).sections });
        }).catch(fail);
      } else {
        fetch('guides/legislation-road.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(done, fail);
      }
    }
    if (road.error) return '<p class="note">The ROAD Act write-up did not load; it is on <a href="' + LIVE + 'housing-legislation-2026.html#road-act">the full Legislation page</a>.</p>';
    if (!road.g) return '';
    return '<section id="lg-road" class="guide-body">' + road.g.sections.filter(function (x) { return ROAD_KEEP.indexOf(x.id) > -1; }).map(function (x) {
      return '<h2 id="lg-' + esc(x.id) + '">' + esc(x.id === 'verified-enacted-housing-provisions' ? 'ROAD to Housing Act: what it enacted' : x.title) + '</h2>' + x.html;
    }).join('') + '<p class="note">From <a href="' + LIVE + 'housing-legislation-2026.html#road-act">the full Legislation page</a>.</p></section>';
  }

  function natRow(x) {
    var u = safe(x.link);
    return '<li><p>' + (u ? '<a href="' + esc(u) + '">' + esc(x.title) + '</a>' : esc(x.title)) + '</p><p class="note">' + esc(x.source || 'Unknown publisher') + (x.date ? ' · ' + esc(x.date) : '') +
      (Array.isArray(x.also) && x.also.length ? ' · Also ' + esc(x.also.map(function (y) { return y.source; }).join(', ')) : '') + '</p></li>';
  }
  // The live page's "This week" sourcing line: the last seven days' stories by outlet check.
  function weekLine(st) {
    var newest = st.reduce(function (m, x) { return x.date > m ? x.date : m; }, ''), n = { checked: 0, unverified: 0, weak: 0 };
    if (!newest) return '';
    var since = new Date(Date.parse(newest) - 6 * 864e5).toISOString().slice(0, 10);
    st.forEach(function (x) { if (x.date >= since) n[x.sourcing === 'weak' || x.sourcing === 'unverified' ? x.sourcing : 'checked'] += 1; });
    return '<p class="note" id="nw-week">Week to ' + esc(newest) + ': ' + num(n.checked) + ' from checked outlets · ' + num(n.unverified) + ' unverified · ' + num(n.weak) + ' weak sourcing.</p>';
  }
  // One-tap buttons above the headlines (the full Housing News page's own two rows): the programs a story is
  // tagged with in the news file, and its outlet check. Each is a link, so a pick rides in the address (np, nc).
  var NEWS_PROGRAMS = [['LIHTC', 'Tax credits (LIHTC)'], ['CHFA', 'CHFA'], ['Prop 123', 'Prop 123'], ['Division of Housing', 'Division of Housing (DOLA)'], ['HUD', 'HUD'], ['Section 8', 'Section 8']];
  var NEWS_CHECKS = [['checked', 'Checked'], ['unverified', 'Unverified outlet'], ['weak', 'Weak sourcing']];
  // Stories from before the outlet check carry no `sourcing` and count as checked, as on the live page.
  function newsCheck(x) { return x.sourcing === 'unverified' || x.sourcing === 'weak' ? x.sourcing : 'checked'; }
  function news(params) {
    params = params || new URLSearchParams();
    var s = UI.load(NEWS);
    if (!s.data) return wait('Housing news', s);
    // The live page keeps stories scoped 'national' out of the Colorado list and shows them under National trends.
    var all = s.data.briefs.stories, sm = s.data.briefs.stories_meta;
    var st = all.filter(function (x) { return x.scope !== 'national'; });
    var nat = all.filter(function (x) { return x.scope === 'national' && x.title; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    // Outlet check, as the live page tags it: stories before the check have no `sourcing` and count as checked.
    function check(x) { return x.sourcing === 'unverified' ? 'Unverified outlet' : x.sourcing === 'weak' ? 'Weak sourcing' + (x.sourcing_label ? ': ' + x.sourcing_label : '') : 'Checked'; }
    // The picks: any of the chosen programs (as the live page matches them), and one outlet check.
    var wantP = String(params.get('np') || '').split(',').filter(function (k, i, a) { return a.indexOf(k) === i && NEWS_PROGRAMS.some(function (p) { return p[0] === k; }); });
    var wantC = NEWS_CHECKS.some(function (c) { return c[0] === params.get('nc'); }) ? params.get('nc') : '';
    var inProgram = function (x, list) { var ps = x.programs || []; return !list.length || list.some(function (k) { return ps.indexOf(k) > -1; }); };
    var picked = st.filter(function (x) { return inProgram(x, wantP) && (!wantC || newsCheck(x) === wantC); });
    var narrowed = wantP.length > 0 || !!wantC;
    var to = function (set) {
      var q = new URLSearchParams(params.toString());
      Object.keys(set).forEach(function (k) { if (set[k]) q.set(k, set[k]); else q.delete(k); });
      var t = q.toString();
      return '#/news' + (t ? '?' + t : '');
    };
    // Each button shows how many headlines it would leave, given the other row's pick.
    var chip = function (id, on, href, label, n) {
      return '<li><a id="' + id + '"' + (on ? ' class="is-on" aria-current="true"' : '') + ' href="' + esc(href) + '">' + esc(label) + ' <span class="news-n">' + num(n) + '<span class="visually-hidden"> headlines</span></span></a></li>';
    };
    var programChips = NEWS_PROGRAMS.map(function (p, i) {
      if (!st.some(function (x) { return (x.programs || []).indexOf(p[0]) > -1; })) return '';
      var on = wantP.indexOf(p[0]) > -1;
      return chip('nw-p' + i, on, to({ np: (on ? wantP.filter(function (k) { return k !== p[0]; }) : wantP.concat([p[0]])).join(',') }), p[1],
        st.filter(function (x) { return (!wantC || newsCheck(x) === wantC) && (x.programs || []).indexOf(p[0]) > -1; }).length);
    }).join('');
    var checkChips = NEWS_CHECKS.map(function (c, i) {
      if (c[0] !== 'checked' && !st.some(function (x) { return newsCheck(x) === c[0]; })) return '';
      return chip('nw-c' + i, wantC === c[0], to({ nc: wantC === c[0] ? '' : c[0] }), c[1], st.filter(function (x) { return inProgram(x, wantP) && newsCheck(x) === c[0]; }).length);
    });
    var pickedNames = NEWS_PROGRAMS.filter(function (p) { return wantP.indexOf(p[0]) > -1; }).map(function (p) { return p[1]; }).concat(NEWS_CHECKS.filter(function (c) { return c[0] === wantC; }).map(function (c) { return c[1]; }));
    var pickRows = (programChips ? '<nav class="dm-chips" aria-label="Program"><p class="news-pick-label">Program</p><ul>' + programChips + '</ul></nav>' : '') +
      (checkChips.filter(Boolean).length > 1 ? '<nav class="dm-chips" aria-label="Outlet check"><p class="news-pick-label">Outlet check</p><ul>' + checkChips.join('') + '</ul></nav>' : '');
    var pick = pickRows ? '<section id="nw-pick" class="news-pick" aria-label="Narrow the headlines">' + pickRows +
      (narrowed ? '<p class="chapter-finding" role="status">' + (picked.length ? 'Showing ' + num(picked.length) + ' of ' + num(st.length) + ' headlines' : 'No headlines match') + ': ' + esc(pickedNames.join(', ')) + '. <a id="nw-all" href="' + esc(to({ np: '', nc: '' })) + '">Show all headlines</a></p>' : '') + '</section>' : '';
    var stories = picked.map(function (x) { return { date: x.date, title: x.title, link: safe(x.link), source: x.source, check: check(x), where: (x.places || []).map(function (p) { return p.name; }).concat(x.places && x.places.length ? [] : x.regions || []).join(', ') || 'Statewide' }; });
    var byMonth = UI.tally(st, function (x) { return x.date && x.date.slice(0, 7); }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var outlets = UI.tally(st, function (x) { return x.source; }).length;
    var top = stories.slice(0, 8);
    return T.head({
      kind: 'data', crumbs: T.trail('policy', 'Housing news'), title: 'Housing news',
      meta: '<span class="scope-tag">Colorado</span> Updated ' + esc(sm.generated.slice(0, 10)) + '.'
    }) +
      pick +
      (!top.length ? '' : '<section id="nw-top" aria-labelledby="nw-top-h"><h2 id="nw-top-h" class="visually-hidden">Latest stories</h2><ol class="news-top">' + top.map(function (r) {
        return '<li><p class="news-date">' + esc(r.date) + ' · ' + esc(r.source) + (r.check !== 'Checked' ? ' · <span class="news-check">' + esc(r.check) + '</span>' : '') + '</p><p class="news-head">' + (r.link ? '<a href="' + esc(r.link) + '">' + esc(r.title) + '</a>' : esc(r.title)) + '</p>' +
          '<p class="news-where">' + esc(r.where) + '</p></li>';
      }).join('') + '</ol></section>') +
      weekLine(st) +
      '<section id="nw-latest" tabindex="-1"><h2>' + (narrowed ? 'Headlines picked' : 'All headlines') + '</h2>' +
      UI.table('news', 'Colorado housing headlines, newest first' + (narrowed ? ': ' + pickedNames.join(', ') : ''), [
        { key: 'date', label: 'Date' },
        { key: 'title', label: 'Headline', href: function (r) { return r.link; } },
        { key: 'source', label: 'Outlet' },
        { key: 'check', label: 'Outlet check', tip: 'Checked: COHO has reviewed the outlet. Unverified: not checked yet. Weak sourcing: reviewed, with the reason. The same tags are on the full Housing News page.' },
        { key: 'where', label: 'Where', tip: 'Places named in the story, matched to the 546 Colorado geographies; otherwise its region' }
      ], stories, { noun: 'headlines', placeholder: 'Headline, outlet or place' }) + T.source('Each outlet named in its row, as COHO’s news list gathers them', LIVE + 'data/policy_briefs.json', 'updated ' + sm.generated.slice(0, 10)) +
      UI.bars('Colorado headlines by month', (narrowed ? 'Every headline, not only the ones picked above. ' : '') + 'Stories kept after duplicates and other-state news are removed. The first month starts ' + st[st.length - 1].date + ', so it is partial.', byMonth, num) +
      T.source('COHO news list, counted by month', LIVE + 'data/policy_briefs.json', 'updated ' + sm.generated.slice(0, 10)) +
      '<details class="counted"><summary>How this list is made</summary><p class="note">' + num(st.length) + ' Colorado headlines from ' + num(outlets) + ' outlets, newest ' + esc(st[0].date) + ', each dated and linked to the outlet that ran it. ' +
      esc(sm.method.split('. ').filter(function (x) { return !/(data|scripts)\//.test(x); }).join('. ').replace(/\.?$/, '.')) + ' Places are matched to Colorado\u2019s counties, towns and CDPs (Census Gazetteer). Other states are left out. The same list is on <a href="' + LIVE + 'policy-briefs.html">the full Housing News page</a>.</p></details></section>' +
      (nat.length ? '<section id="nw-national" aria-labelledby="nw-national-h"><h2 id="nw-national-h">National trends</h2><p class="note">Housing market and homebuilding trends reported by national newspapers and housing research centers. Opinion pieces are left out. They are kept out of the Colorado list above.</p>' +
        '<ul class="pw-list">' + nat.slice(0, 5).map(natRow).join('') + '</ul>' +
        (nat.length > 5 ? '<details class="counted"><summary>' + num(nat.length - 5) + ' more national stories</summary><ul class="pw-list">' + nat.slice(5).map(natRow).join('') + '</ul></details>' : '') + '</section>' : '') +
      '<p class="note">For the week in one read, see the <a href="' + LIVE + 'sunday-digest.html">Sunday digest</a>, a short summary of Colorado housing news each Sunday.</p>' +
      '<p class="note">Event dates and law deadlines are on <a href="#/calendar">Deadlines and events</a>. The laws themselves are on <a href="#/legislation">Legislation</a>, and the state\u2019s housing appointments on <a href="#/housing-posts">Who holds housing posts</a>.</p>' +
      T.next('Next', [{ href: '#/calendar', label: 'Deadlines and events \u2192' }, { href: '#/legislation', label: 'Laws COHO tracks', secondary: true }]);
  }

  // The state's housing appointments, grouped by agency, each linked to the official page it was read from.
  var AGENCIES = [
    ['DOLA and its Division of Housing', /Department of Local Affairs/],
    ['Colorado Housing and Finance Authority (CHFA)', /^CHFA/],
    ['OEDIT', /Economic Development/],
    ['State Housing Board', /State Housing Board/]
  ];
  function posts() {
    var s = UI.load(POSTS);
    if (!s.data) return wait('Who holds housing posts', s);
    var w = s.data.watch, people = w.entries.filter(function (e) { return e.section === 'people'; });
    var group = function (e) {
      var label = (e.source && e.source.label) || '';
      for (var i = 0; i < AGENCIES.length; i++) if (AGENCIES[i][1].test(label)) return AGENCIES[i][0];
      return label.split(',')[0] || 'Other';
    };
    var names = [];
    people.forEach(function (e) { var g = group(e); if (names.indexOf(g) < 0) names.push(g); });
    names.sort(function (a, b) {
      var ia = AGENCIES.map(function (x) { return x[0]; }).indexOf(a), ib = AGENCIES.map(function (x) { return x[0]; }).indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var gaps = (w.meta.known_gaps || []).filter(function (g) { return /appointments/i.test(g); });
    return T.head({
      kind: 'data', crumbs: T.trail('policy', 'Who holds housing posts'), title: 'Who holds housing posts',
      answer: 'Colorado\u2019s state housing appointments, by agency, each read from the agency\u2019s own page.',
      meta: '<span class="scope-tag">Scope: Colorado state agencies</span> ' + (function () { var c = people.map(function (e) { return e.verification && e.verification.checked; }).filter(Boolean).sort(); return c.length ? 'Checked ' + esc(c[0]) + (c[0] !== c[c.length - 1] ? ' to ' + esc(c[c.length - 1]) : '') + '.' : 'As of ' + esc(w.meta.as_of) + '.'; })(),
      facts: [{ value: num(people.length), label: 'Posts listed across ' + names.length + ' agencies and boards', source: 'Agency leadership and board pages', href: LIVE + 'policy-briefs.html' }]
    }) +
      names.map(function (g) {
        return '<h2>' + esc(g) + '</h2><ul class="post-list">' + people.filter(function (e) { return group(e) === g; }).map(function (e) {
          var cut = e.title.lastIndexOf(': '), role = cut > 0 ? e.title.slice(0, cut) : e.title, who = cut > 0 ? e.title.slice(cut + 2) : '';
          var u = e.source && safe(e.source.url);
          return '<li class="post-card"><p class="post-name">' + esc(who || role) + '</p>' + (who ? '<p class="post-role">' + esc(role) + '</p>' : '') +
            (e.detail ? '<p class="note">' + esc(e.detail) + '</p>' : '') +
            '<p class="source-line"><span>Source</span> ' + (u ? '<a href="' + esc(u) + '">' + esc(e.source.label) + '</a>' : esc((e.source && e.source.label) || '')) +
            (e.verification && e.verification.checked ? ', checked ' + esc(e.verification.checked) : '') + '</p></li>';
        }).join('') + '</ul>';
      }).join('') +
      (gaps.length ? '<h2>Not listed</h2><p>' + gaps.map(esc).join(' ') + '</p>' : '') +
      '<p class="note">Names and titles only, as each agency publishes them. Contact details are on the agency pages linked above.</p>' +
      T.next('Next', [{ href: '#/legislation', label: 'Laws COHO tracks \u2192' }, { href: '#/calendar', label: 'Deadlines and events', secondary: true }]);
  }


  // When each tracked change takes effect and, where it has one, when it ends (lab addition), on one 2023-2030 scale.
  // Bars run from the effective date to the end date; an open end runs to the edge. Undated items are listed after.
  var LT_FROM = 2023, LT_TO = 2030;
  var LT_COLORS = { enacted: 'var(--pine)', 'phased-out': 'var(--warn)', proposed: 'var(--c-blue)', 'rule-pending': 'var(--c-amber)' };
  function yearPos(d) {
    var t = Date.parse(d + 'T00:00:00Z'); if (!isFinite(t)) return null;
    var y = new Date(t).getUTCFullYear(), start = Date.UTC(y, 0, 1), next = Date.UTC(y + 1, 0, 1);
    var v = y + (t - start) / (next - start);
    return Math.max(0, Math.min(100, (v - LT_FROM) / (LT_TO - LT_FROM) * 100));
  }
  function lawTimeline(e) {
    var dated = e.filter(function (x) { return x.effective_date; }).sort(function (a, b) { return a.effective_date < b.effective_date ? -1 : 1; });
    var undated = e.filter(function (x) { return !x.effective_date; });
    var ticks = []; for (var y = LT_FROM; y <= LT_TO; y++) ticks.push(y);
    var todayPos = yearPos(new Date().toISOString().slice(0, 10));
    var ltTitle = 'When each change takes effect', ltTake = dated.length + ' dated federal and Colorado changes on one timeline, from ' + LT_FROM + ' to ' + LT_TO + '.';
    var ltFold = global.LabTpl && global.LabTpl.fold;
    var html = '<section class="lt-wrap" aria-labelledby="lt-h">' + (ltFold ? '' : '<h2 id="lt-h">' + ltTitle + '</h2>') + (ltFold ? '\u0000' : '') +
      '<ul class="mi-rows lt-rows">' + dated.map(function (x) {
        var a = yearPos(x.effective_date), b = x.sunset_date ? yearPos(x.sunset_date) : 100, open = !x.sunset_date || Date.parse(x.sunset_date) > Date.UTC(LT_TO, 0, 1);
        if (b < a) b = a;
        var label = x.status === 'phased-out' ? 'Ended ' + (x.sunset_date || x.effective_date) :
          x.status === 'enacted' ? 'In effect from ' + x.effective_date + (x.sunset_date ? ' to ' + x.sunset_date : ', no end date') :
          (STATUS[x.status] || x.status) + ', dated ' + x.effective_date + '; not final';
        if (x.status === 'phased-out') { a = yearPos(x.sunset_date || x.effective_date); b = a; }
        return '<li><span class="mi-name">' + esc(x.title) + '</span><span class="mi-track" role="img" aria-label="' + esc(x.title + ': ' + label) + '">' +
          '<span class="mi-bar' + (open ? ' lt-open' : '') + '" style="left:' + a.toFixed(2) + '%;width:' + Math.max(1.2, b - a).toFixed(2) + '%;background:' + (LT_COLORS[x.status] || 'var(--muted)') + '"></span>' +
          (todayPos != null ? '<span class="lt-today" style="left:' + todayPos.toFixed(2) + '%"></span>' : '') +
          '</span><span class="mi-label">' + esc(label) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="mi-axis lt-axis" aria-hidden="true">' + ticks.map(function (t) { return '<span style="left:' + ((t - LT_FROM) / (LT_TO - LT_FROM) * 100).toFixed(2) + '%">' + t + '</span>'; }).join('') + '</div>' +
      '<ul class="lt-key">' + Object.keys(LT_COLORS).filter(function (k) { return dated.some(function (x) { return x.status === k; }); }).map(function (k) { return '<li><span class="el-dot" style="background:' + LT_COLORS[k] + '"></span>' + esc(STATUS[k]) + '</li>'; }).join('') +
      '<li><span class="el-dot lt-today-key"></span>Today</li></ul>' +
      (undated.length ? '<p class="note">Not dated yet, because they are not law or the rule is pending: ' + undated.map(function (x) { return esc(x.title); }).join('; ') + '.</p>' : '') +
      '<p class="metric-source">Source: each item’s official federal or Colorado source, linked on its card below.</p>';
    // Folds shut behind its title and a one-line answer (paul, 10 Nov: phone length).
    var i0 = html.indexOf('\u0000');
    if (i0 > -1) html = html.slice(0, i0) + global.LabTpl.fold(esc(ltTitle), esc(ltTake), html.slice(i0 + 1), { id: 'lt-h' });
    return html + '</section>';
  }
  function legislation() {
    var s = UI.load(LAW);
    if (!s.data) return wait('Legislation', s);
    var m = s.data.law.meta, e = s.data.law.entries, w = s.data.watch;
    var count = function (k) { return e.filter(function (x) { return x.status === k; }).length; };
    var byStatus = Object.keys(STATUS).map(function (k) { return [STATUS[k], count(k)]; }).filter(function (r) { return r[1]; });
    var cards = Object.keys(STATUS).map(function (k) {
      var items = e.filter(function (x) { return x.status === k; });
      if (!items.length) return '';
      return '<h3>' + esc(STATUS[k]) + ' (' + items.length + ')</h3><ul class="pw-list">' + items.map(function (x) {
        var u = safe(x.source_url);
        return '<li><p><strong>' + esc(x.title) + '</strong> <span class="scope-tag">' + esc(SCOPE[x.scope] || x.scope) + '</span></p><p>' + esc(x.pricing_impact || '') + '</p>' +
          '<p class="note">' + (x.effective_date ? 'Effective ' + esc(x.effective_date) + ' · ' : '') + (x.sunset_date ? 'Ends ' + esc(x.sunset_date) + ' · ' : '') +
          (u ? '<a href="' + esc(u) + '">Official source</a> · ' : '') + 'checked ' + esc(x.last_verified || m.last_verified) + '</p>' +
          (x.source_note ? '<details class="counted"><summary>What the source says</summary><p>' + esc(x.source_note) + '</p></details>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
    return T.head({
      kind: 'data', crumbs: T.trail('policy', 'Legislation'), title: 'Legislation',
      answer: 'The federal and Colorado tax credit laws and rules COHO tracks: ' + count('enacted') + ' enacted, ' + count('proposed') + ' proposed, and what each one does to deals.',
      meta: '<span class="scope-tag">Checked ' + esc(m.last_verified) + '</span> Next review by ' + esc(m.review_by) + '. Status links go to official federal or Colorado sources.',
      facts: byStatus.map(function (r) { return { value: num(r[1]), label: r[0], source: 'Official legislative sources', href: LIVE + 'housing-legislation-2026.html' }; })
    }) +
      lawTimeline(e) +
      cards +
      roadSections() +
      '<h2>ROAD to Housing Act: enactment timeline</h2><ol class="timeline-list">' + ROAD_TIMELINE.map(function (r) { return '<li><strong>' + esc(r[0]) + ':</strong> ' + esc(r[1]) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">Sources: <a href="https://www.govtrack.us/congress/bills/119/hr6644">GovTrack, H.R. 6644 status</a>; <a href="https://www.govinfo.gov/content/pkg/PLAW-119publ101/html/PLAW-119publ101.htm">Public Law 119-101 (GovInfo)</a>.</p>' +
      // Folds shut behind its title and a one-line answer (paul, 10 Nov: phone length).
      T.fold('Colorado policy watch', 'Colorado housing laws and CHFA allocation plan changes COHO has checked, each with its source. As of ' + esc(w.meta.as_of) + '.',
        watchList(w, { law: 'Colorado housing laws, 2026 session', qap: 'CHFA allocation plan' }) +
        (w.meta.known_gaps && w.meta.known_gaps.length ? '<h3>Not yet covered</h3><p class="note">Topics not checked yet, listed so their absence is not read as “nothing happened”.</p><ul>' + w.meta.known_gaps.filter(function (g) { return !/appointments/i.test(g); }).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' : ''), { id: 'policy-watch' }) +
      '<p class="note">How each change may move credit prices is the site’s reading, to be reviewed quarterly; the status links go to official sources.</p>' +
      T.next('Next', [{ href: '#/equity-pricing', label: 'What credits sell for now →' }, { href: '#/guide/ahcia', label: 'AHCIA status', secondary: true }]);
  }

  // The hub: one card per page in the menu, each with what it answers. No figure shows twice.
  var LIVE_HUB = Shell.views.guides;
  function hub() {
    var m = global.LabNav.MENUS.filter(function (x) { return x.id === 'policy'; })[0];
    var card = function (it) {
      var lab = !!it.lab;
      return '<a class="hub-card' + (lab ? '' : ' is-live') + '" href="' + esc(global.LabNav.href(it)) + '"><span class="hub-card-title">' + esc(it.label) + (lab ? '' : ' <span class="live-tag">live site ↗</span>') + '</span><span class="hub-card-desc">' + esc(it.desc) + '</span></a>';
    };
    var rest = LIVE_HUB ? LIVE_HUB().replace(/^[\s\S]*?<\/header>/, '') : '';
    return T.head({ kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: m.title }], title: m.title, answer: esc(m.question) }) +
      m.groups.map(function (g) { return '<h2>' + esc(g.title) + '</h2><div class="hub-cards">' + g.items.map(card).join('') + '</div>'; }).join('') +
      '<details class="counted"><summary>Every page under this menu</summary>' + rest + '</details>';
  }

  Shell.views.news = news;
  Shell.views['housing-posts'] = posts;
  Shell.views.legislation = legislation;
  Shell.views.guides = hub;
  global.LabPolicy = { news: news, posts: posts, legislation: legislation, hub: hub, NEWS: NEWS, POSTS: POSTS, LAW: LAW };
})(window);
