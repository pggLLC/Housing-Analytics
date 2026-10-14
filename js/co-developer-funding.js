/**
 * co-developer-funding.js — Developer Funding tab on colorado-deep-dive.html.
 *
 * Two data files:
 *   data/policy/co-developer-funding-guide.json — the curated program guide.
 *     Every term on it carries the official page it came from and the date it
 *     was checked; a term the official page does not publish is null with a
 *     reason, and renders as "Not published", never as a guess.
 *   data/chfa-income-rent-limits-2026.json — CHFA's income and rent limits,
 *     the AMI quick reference. The guide names this file in meta so the tab
 *     and the guide always cite the same limits.
 *
 * The project finder ("Find programs for my project") filters the cards with
 * js/funding-fit.js, the same matcher the Opportunity Finder and Compare use.
 * Its choices live in the URL (?exec=4%25&type=…&county=08077&open=1#tab-funding),
 * so another page can open the tab already filtered, and ?program=<id> opens
 * one program's card.
 */
(function (global) {
  'use strict';

  var GUIDE_FILE = 'policy/co-developer-funding-guide.json';
  var LIMITS_FILE = 'chfa-income-rent-limits-2026.json';
  var started = false;
  var guide = null;
  var activeCategory = 'all';
  var query = {};            // finder choices: execution, projectType, county, openOnly, includeSupport
  var compared = [];         // program ids picked for the side-by-side table (at most MAX_COMPARE)
  var MAX_COMPARE = 3;
  var countyNames = {};      // 5-digit FIPS -> county name, from the CHFA limits file

  // Field order and labels for the program cards.
  var FIELDS = [
    ['what_it_funds', 'What it funds'],
    ['award_size', 'Award size'],
    ['rate', 'Rate'],
    ['term', 'Term'],
    ['ami_restriction', 'AMI restriction'],
    ['affordability_period', 'Affordability period'],
    ['eligible_applicants', 'Eligible applicants'],
    ['eligible_projects', 'Eligible projects'],
    ['application_cycle', 'Application cycle']
  ];

  var STATUS_LABELS = {
    open: 'Open',
    rolling: 'Rolling',
    annual: 'Annual round',
    rounds: 'Periodic rounds',
    closed: 'Closed',
    watch: 'No round announced',
    ending: 'Ending',
    ended: 'Ended'
  };

  var TYPE_LABELS = {
    tax_credit: 'Tax credit',
    bond: 'Tax-exempt bonds',
    loan: 'Loan',
    insured_loan: 'Insured loan',
    deferred_loan: 'Deferred loan',
    forgivable_loan: 'Forgivable loan',
    grant: 'Grant',
    equity: 'Equity',
    guarantee: 'Guarantee',
    rental_assistance: 'Rental assistance'
  };

  function dataUrl(key) {
    if (global.DataService && typeof global.DataService.baseData === 'function') return global.DataService.baseData(key);
    return 'data/' + key;
  }

  function fetchJSON(key) {
    return fetch(dataUrl(key)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + key);
      return r.json();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Only https links to an outside source are rendered as links.
  function safeUrl(u) {
    return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
  }

  function extLink(url, text) {
    var u = safeUrl(url);
    if (!u) return escapeHtml(text);
    return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(text) + '</a>';
  }

  function fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function fmtMoney(v) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return 'Value unavailable';
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function unverifiedReason(p, field) {
    var u = (p.unverified || []).filter(function (x) { return x.field === field; })[0];
    return u ? u.reason : null;
  }

  /* ── Considerations ─────────────────────────────────────────── */
  function renderConsiderations(g) {
    var el = document.getElementById('dfConsiderations');
    if (!el) return;
    el.innerHTML = (g.considerations || []).map(function (c) {
      var src = (c.sources || []).map(function (s) { return extLink(s.url, s.label); }).join(' · ');
      return '<article class="df-consider">' +
        '<h3>' + escapeHtml(c.title) + '</h3>' +
        '<p>' + escapeHtml(c.body) + '</p>' +
        (src ? '<p class="df-src">Source: ' + src + (c.last_checked ? ' · checked ' + escapeHtml(fmtDate(c.last_checked)) : '') + '</p>' : '') +
        '</article>';
    }).join('');
  }

  /* ── Stack overview ─────────────────────────────────────────── */
  function renderStack(g) {
    var el = document.getElementById('dfStack');
    if (!el) return;
    el.innerHTML = (g.stack || []).map(function (s) {
      return '<li><strong>' + escapeHtml(s.layer) + '.</strong> ' + escapeHtml(s.body) + '</li>';
    }).join('');
  }

  /* ── Program cards ──────────────────────────────────────────── */
  function renderFilters(g) {
    var el = document.getElementById('dfFilters');
    if (!el) return;
    var cats = [{ id: 'all', label: 'All programs' }].concat(g.categories || []);
    var shown = visiblePrograms(g);
    el.innerHTML = cats.map(function (c) {
      var n = c.id === 'all' ? shown.length
        : shown.filter(function (p) { return p.category === c.id; }).length;
      return '<button type="button" class="df-chip" data-cat="' + escapeHtml(c.id) + '" aria-pressed="' +
        (c.id === activeCategory ? 'true' : 'false') + '">' + escapeHtml(c.label) + ' (' + n + ')</button>';
    }).join('');
    el.querySelectorAll('.df-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        activeCategory = b.getAttribute('data-cat');
        el.querySelectorAll('.df-chip').forEach(function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        renderPrograms(guide);
      });
    });
  }

  function fieldRow(p, key, label) {
    var v = p[key];
    var body;
    if (v == null || v === '') {
      var why = unverifiedReason(p, key);
      body = '<span class="df-na">Not stated' + (why ? '. ' + escapeHtml(why) : '') + '</span>';
    } else {
      body = escapeHtml(v);
    }
    return '<dt>' + escapeHtml(label) + '</dt><dd>' + body + '</dd>';
  }

  /* ── Project finder ─────────────────────────────────────────── */
  function fit() { return global.FundingFit || null; }

  function finderActive() {
    return !!(query.execution || query.projectType || query.county || query.openOnly || query.includeSupport);
  }

  // Programs the finder lets through, in guide order. With no choices made,
  // every program shows, as before the finder existed.
  function visiblePrograms(g) {
    var programs = (g && g.programs) || [];
    var F = fit();
    if (!F || !finderActive()) return programs;
    var keep = {};
    F.select(g, query).forEach(function (r) { keep[r.program.id] = r.notes; });
    return programs.filter(function (p) { return Object.prototype.hasOwnProperty.call(keep, p.id); });
  }

  function options(list, anyLabel, selected) {
    return '<option value="">' + escapeHtml(anyLabel) + '</option>' + list.map(function (o) {
      return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === selected ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
    }).join('');
  }

  function writeUrl() {
    var F = fit();
    if (!F || !global.history || !global.history.replaceState) return;
    var url = F.guideUrl(query, global.location.pathname);
    global.history.replaceState(null, '', url);
  }

  function renderFinder(g) {
    var F = fit();
    var form = document.getElementById('dfFinder');
    if (!F || !form) return;
    var exec = document.getElementById('dfFindExec');
    var type = document.getElementById('dfFindType');
    var county = document.getElementById('dfFindCounty');
    var open = document.getElementById('dfFindOpen');
    var support = document.getElementById('dfFindSupport');
    exec.innerHTML = options(F.EXECUTIONS, 'Any deal type', query.execution);
    type.innerHTML = options(F.PROJECT_TYPES, 'Any project type', query.projectType);
    open.checked = !!query.openOnly;
    support.checked = !!query.includeSupport;
    function change() {
      query.execution = exec.value || undefined;
      query.projectType = type.value || undefined;
      query.county = county.value || undefined;
      query.openOnly = open.checked || undefined;
      query.includeSupport = support.checked || undefined;
      query.program = undefined;
      writeUrl();
      refresh(g);
    }
    [exec, type, county].forEach(function (el) { el.addEventListener('change', change); });
    [open, support].forEach(function (el) { el.addEventListener('change', change); });
  }

  // County names arrive with the CHFA limits file; the finder works without them.
  function renderCountyOptions(limits) {
    var el = document.getElementById('dfFindCounty');
    if (!el) return;
    var counties = (limits && Array.isArray(limits.counties) ? limits.counties : []).slice()
      .sort(function (a, b) { return a.county_name.localeCompare(b.county_name); });
    counties.forEach(function (c) { countyNames[c.fips] = c.county_name; });
    el.innerHTML = '<option value="">Anywhere in Colorado</option>' + counties.map(function (c) {
      return '<option value="' + escapeHtml(c.fips) + '"' + (c.fips === query.county ? ' selected' : '') + '>' +
        escapeHtml(c.county_name) + ' County</option>';
    }).join('');
  }

  function renderSummary(g) {
    var el = document.getElementById('dfFindSummary');
    if (!el) return;
    var F = fit();
    if (!F) { el.textContent = ''; return; }
    var total = (g.programs || []).length;
    if (!finderActive()) {
      el.textContent = 'Showing all ' + total + ' programs. Choose a deal type, project type or county to narrow them.';
      return;
    }
    var rows = F.select(g, query);
    var open = rows.filter(function (r) { return r.availability === 'open'; }).length;
    var scheduled = rows.filter(function (r) { return r.availability === 'scheduled'; }).length;
    var bits = [];
    if (query.execution) bits.push(F.executionLabel(query.execution));
    if (query.projectType) bits.push(F.projectTypeLabel(query.projectType).toLowerCase());
    if (query.county) bits.push('in ' + (countyNames[query.county] ? countyNames[query.county] + ' County' : 'county ' + query.county));
    el.textContent = rows.length + ' of ' + total + ' programs fit' + (bits.length ? ' ' + bits.join(', ') : '') + ': ' +
      open + ' taking applications now and ' + scheduled + ' with a published next round.';
  }

  function fitBlock(p) {
    var F = fit();
    if (!F || !finderActive()) return '';
    var m = F.match(p, query);
    var a = F.availability(p);
    var lines = ['<p><span class="df-avail df-avail-' + escapeHtml(a) + '">' + escapeHtml(F.AVAILABILITY_LABELS[a]) + '.</span></p>'];
    m.notes.forEach(function (n) { lines.push('<p>' + escapeHtml(n) + '</p>'); });
    return '<div class="df-fit">' + lines.join('') + '</div>';
  }

  function compareButton(p) {
    var on = compared.indexOf(p.id) !== -1;
    var full = !on && compared.length >= MAX_COMPARE;
    return '<button type="button" class="df-compare-btn" data-compare="' + escapeHtml(p.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
      (full ? ' disabled title="Compare up to ' + MAX_COMPARE + ' programs at a time"' : '') + '>' +
      (on ? 'Remove from comparison' : 'Compare this program') + '</button>';
  }

  var COMPARE_ROWS = [
    ['administrator', 'Administrator'],
    ['status', 'Round'],
    ['award_size', 'Award size'],
    ['rate', 'Rate'],
    ['term', 'Term'],
    ['ami_restriction', 'AMI restriction'],
    ['affordability_period', 'Affordability period'],
    ['application_cycle', 'Application cycle']
  ];

  function renderCompare(g) {
    var box = document.getElementById('dfCompare');
    var table = document.getElementById('dfCompareTable');
    if (!box || !table) return;
    var ps = compared.map(function (id) {
      return (g.programs || []).filter(function (p) { return p.id === id; })[0];
    }).filter(Boolean);
    var hint = document.getElementById('dfCompareHint');
    if (!ps.length) {
      box.setAttribute('hidden', '');
      table.innerHTML = '';
      return;
    }
    box.removeAttribute('hidden');
    if (hint) hint.textContent = ps.length < MAX_COMPARE
      ? 'Open another program below and choose "Compare this program" to add it (up to ' + MAX_COMPARE + ').'
      : 'Showing the most programs that fit side by side. Remove one to add another.';
    var head = '<caption class="sr-only">The selected programs\' terms, side by side</caption><thead><tr><th scope="col">Term</th>' +
      ps.map(function (p) { return '<th scope="col"><a href="#df-' + escapeHtml(p.id) + '" data-df-open="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</a></th>'; }).join('') +
      '</tr></thead>';
    var body = COMPARE_ROWS.map(function (r) {
      return '<tr><th scope="row">' + escapeHtml(r[1]) + '</th>' + ps.map(function (p) {
        if (r[0] === 'status') return '<td>' + escapeHtml(STATUS_LABELS[p.status] || 'Not stated') + '</td>';
        var v = p[r[0]];
        if (v == null || v === '') {
          var why = unverifiedReason(p, r[0]);
          return '<td><span class="df-na">Not stated' + (why ? '. ' + escapeHtml(why) : '') + '</span></td>';
        }
        return '<td>' + escapeHtml(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    table.innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function openProgram(id, scroll) {
    var card = document.getElementById('df-' + id);
    if (!card) return false;
    card.open = true;
    if (scroll && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
    return true;
  }

  function refresh(g) {
    renderFilters(g);
    renderPrograms(g);
    renderSummary(g);
    renderCompare(g);
  }

  function programCard(p, catLabel) {
    var status = STATUS_LABELS[p.status] || null;
    var types = [].concat(p.funding_type || []).map(function (t) { return TYPE_LABELS[t]; }).filter(Boolean);
    var type = types.length ? types.join(' or ') : null;
    var sources = (p.sources || []).map(function (s) { return '<li>' + extLink(s.url, s.label) + '</li>'; }).join('');
    var evidence = (p.evidence || []).map(function (e) {
      return '<li><span class="df-ev-field">' + escapeHtml(e.field.replace(/_/g, ' ')) + ':</span> “' +
        escapeHtml(e.quote) + '” ' + extLink(e.url, '(source)') + '</li>';
    }).join('');
    var considerations = (p.key_considerations || []).map(function (k) { return '<li>' + escapeHtml(k) + '</li>'; }).join('');
    return '<details class="df-card" data-cat="' + escapeHtml(p.category) + '" id="df-' + escapeHtml(p.id) + '">' +
      '<summary><span class="df-card-head">' +
        '<span class="df-card-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="df-card-meta">' + escapeHtml(p.administrator) +
          (type ? ' · ' + escapeHtml(type) : '') +
          (status ? ' · <span class="df-status df-status-' + escapeHtml(p.status) + '">' + escapeHtml(status) + '</span>' : '') +
        '</span>' +
      '</span></summary>' +
      '<div class="df-card-body">' +
        fitBlock(p) +
        compareButton(p) +
        '<p class="df-official">Official page: ' + extLink(p.official_url, p.official_url_label || p.official_url) + '</p>' +
        '<dl class="df-fields">' + FIELDS.map(function (f) { return fieldRow(p, f[0], f[1]); }).join('') + '</dl>' +
        (considerations ? '<h4>What to know</h4><ul class="df-list">' + considerations + '</ul>' : '') +
        (sources ? '<h4>Sources</h4><ul class="df-list">' + sources + '</ul>' : '') +
        (evidence ? '<details class="df-evidence"><summary>Quoted terms from the official sources</summary><ul class="df-list">' + evidence + '</ul></details>' : '') +
        '<p class="df-src">' + escapeHtml(catLabel) + ' · terms checked ' + escapeHtml(fmtDate(p.last_checked)) + '</p>' +
      '</div>' +
    '</details>';
  }

  function renderPrograms(g) {
    var el = document.getElementById('dfPrograms');
    if (!el) return;
    var labels = {};
    (g.categories || []).forEach(function (c) { labels[c.id] = c.label; });
    var cats = (g.categories || []).filter(function (c) { return activeCategory === 'all' || c.id === activeCategory; });
    var shown = visiblePrograms(g);
    var html = cats.map(function (c) {
      var ps = shown.filter(function (p) { return p.category === c.id; });
      if (!ps.length) return '';
      return '<section class="df-cat" aria-labelledby="df-cat-' + escapeHtml(c.id) + '">' +
        '<h3 id="df-cat-' + escapeHtml(c.id) + '">' + escapeHtml(c.label) + '</h3>' +
        (c.summary ? '<p class="df-cat-summary">' + escapeHtml(c.summary) + '</p>' : '') +
        ps.map(function (p) { return programCard(p, labels[p.category] || ''); }).join('') +
        '</section>';
    }).join('');
    el.innerHTML = html || '<p class="df-empty">No program in this category fits those choices. Clear a choice above, or pick another category.</p>';
  }

  // One delegated listener for the card buttons, the comparison table and in-tab links.
  function wireClicks(g) {
    var panel = document.getElementById('tab-funding');
    if (!panel) return;
    panel.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-compare],[data-df-open],[data-df-tab],#dfCompareClear') : null;
      if (!t) return;
      if (t.id === 'dfCompareClear') {
        compared = [];
        refresh(g);
        return;
      }
      if (t.hasAttribute('data-compare')) {
        var id = t.getAttribute('data-compare');
        var i = compared.indexOf(id);
        if (i !== -1) compared.splice(i, 1);
        else if (compared.length < MAX_COMPARE) compared.push(id);
        var openIds = Array.prototype.map.call(document.querySelectorAll('#dfPrograms details.df-card[open]'), function (d) { return d.id; });
        refresh(g);
        openIds.forEach(function (oid) { var d = document.getElementById(oid); if (d) d.open = true; });
        var again = document.querySelector('[data-compare="' + id + '"]');
        if (again) again.focus();
        return;
      }
      if (t.hasAttribute('data-df-open')) {
        e.preventDefault();
        openProgram(t.getAttribute('data-df-open'), true);
        return;
      }
      if (t.hasAttribute('data-df-tab')) {
        var btn = document.getElementById(t.getAttribute('data-df-tab'));
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });
  }

  /* ── AMI quick reference (CHFA limits) ──────────────────────── */
  function renderAmi(limits) {
    var sel = document.getElementById('dfAmiCounty');
    var meta = document.getElementById('dfAmiMeta');
    if (!sel || !limits || !Array.isArray(limits.counties)) {
      var st = document.getElementById('dfAmiStatus');
      if (st) { st.textContent = 'The CHFA income and rent limits could not be loaded.'; st.removeAttribute('hidden'); }
      return;
    }
    var counties = limits.counties.slice().sort(function (a, b) { return a.county_name.localeCompare(b.county_name); });
    sel.innerHTML = counties.map(function (c) {
      return '<option value="' + escapeHtml(c.fips) + '"' + (c.fips === '08031' ? ' selected' : '') + '>' +
        escapeHtml(c.county_name) + ' County</option>';
    }).join('');
    if (meta) {
      var m = limits.meta || {};
      meta.innerHTML = 'Source: ' + extLink(m.source_url, m.source || 'CHFA income and rent limits') +
        (m.effective_date ? ' · effective ' + escapeHtml(fmtDate(m.effective_date)) : '') +
        '. Max rents are gross rents, including the utility allowance.';
    }
    function draw() {
      var c = counties.filter(function (x) { return x.fips === sel.value; })[0];
      var body = document.getElementById('dfAmiBody');
      var note = document.getElementById('dfAmiNote');
      if (!c || !body) return;
      var tiers = c.regular_tiers || {};
      // Every tier CHFA publishes for this county, lowest first: 20% and 70% are
      // valid income-averaging designations, and rural resort counties add 130% to 160%.
      var tierKeys = Object.keys(tiers).sort(function (a, b) { return Number(a) - Number(b); });
      body.innerHTML = tierKeys.map(function (t) {
        var row = tiers[t];
        if (!row) return '';
        var inc = row.income_limits || {};
        var rent = row.max_rents || {};
        return '<tr><th scope="row">' + t + '% AMI</th>' +
          '<td>' + fmtMoney(inc['1p']) + '</td><td>' + fmtMoney(inc['2p']) + '</td><td>' + fmtMoney(inc['4p']) + '</td>' +
          '<td>' + fmtMoney(rent['1br']) + '</td><td>' + fmtMoney(rent['2br']) + '</td><td>' + fmtMoney(rent['3br']) + '</td></tr>';
      }).join('');
      if (note) {
        var bits = [];
        if (c.rural_resort) bits.push(c.county_name + ' County is a rural resort county, so CHFA also publishes the 130% to 160% AMI tiers shown above for Prop 123.');
        if (c.hera_special) bits.push('HERA Special limits also exist here, for tax credit projects placed in service on or before December 31, 2008.');
        note.textContent = bits.join(' ');
      }
    }
    sel.addEventListener('change', draw);
    draw();
  }

  function renderMeta(g) {
    var el = document.getElementById('dfMeta');
    if (!el || !g.meta) return;
    el.textContent = 'Program terms checked against each official source on ' + fmtDate(g.meta.last_checked) +
      '. Next scheduled review: ' + fmtDate(g.meta.review_by) + '. Rounds, rates and limits change; confirm with the administrator before relying on a term.';
  }

  function init() {
    if (started) return;
    started = true;
    var limits = fetchJSON(LIMITS_FILE).catch(function () { return null; });
    var F = fit();
    if (F) query = F.parseQuery(global.location.search);
    fetchJSON(GUIDE_FILE).then(function (g) {
      guide = g;
      renderMeta(g);
      renderStack(g);
      renderConsiderations(g);
      renderFinder(g);
      refresh(g);
      wireClicks(g);
      // A program named in the URL (search results, the Opportunity Finder) opens
      // even when the finder's other choices would hide it.
      if (query.program && !openProgram(query.program, true)) {
        query = { program: query.program };
        refresh(g);
        openProgram(query.program, true);
      }
      return limits.then(function (l) {
        renderCountyOptions(l);
        renderSummary(g);
        renderAmi(l);
      });
    }).catch(function (err) {
      console.warn('[co-developer-funding] load failed:', err);
      var el = document.getElementById('dfMeta');
      if (el) el.textContent = 'The developer funding guide could not be loaded.';
    });
  }

  global.CoDeveloperFunding = { init: init, _safeUrl: safeUrl };

  // Opened straight onto the tab (#tab-funding): the tab script has already
  // revealed it, so render now.
  function maybeInit() {
    var panel = document.getElementById('tab-funding');
    if (panel && !panel.hasAttribute('hidden')) init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
  else maybeInit();
})(window);
