// Tool template: the Deal Calculator's front page. It says what the tool answers, the steps in order,
// what the engine reads and how fresh it is, and where to start. The steps run in a project's
// Homes and Financials screens (homes.js, financials.js) on the pinned copy of the live Deal Engine.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, P = global.LabProjects;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  // The live calculator on this site (LAB_LIVE is '' on the public site, so staging stays on staging), opened on the
  // working place (QA/QC, 12 Nov: a plain link opened on whatever county the browser had saved).
  var LIVE_TOOL = (global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/') + 'deal-calculator.html';
  function inAddress() { var g = new URLSearchParams(String(location.hash).split('?')[1] || '').get('g') || ''; return /^08\d{3}(\d{2})?$/.test(g) ? g : ''; }
  // The place this page is on: the one in the address, else the working place (deal-quick.js pagePlace). The
  // "Working on" line, the quick estimate's county and every link to the full calculator use this one place.
  function place() { return global.LabDealQuick && global.LabDealQuick.place ? global.LabDealQuick.place() : inAddress(); }
  function liveTool() { return LIVE_TOOL + (place() ? '?geoid=' + place() : ''); }

  var STEPS = [
    { title: 'Pick a place', text: 'The county sets the rent and income limits.' },
    { title: 'Homes and rents', text: 'Bedrooms, AMI levels and rents, checked against CHFA’s limits.' },
    { title: 'Costs', text: 'Each cost line, and whether it counts toward eligible basis.' },
    { title: 'Operating budget', text: 'DOH’s expense lines, per home per year.' },
    { title: 'Financing and exit', text: 'Debt terms, credit pricing, hold period and sale.' }
  ];
  var RESULTS = ['Sources and uses', 'Tax credit equity', 'First mortgage', 'Funding gap', 'Debt coverage', 'Sale and partnership split'];

  // What the engine reads, with each file's own source and date.
  var DATA = [
    { file: 'data/chfa-income-rent-limits-2026.json', what: 'Rent and income limits', src: function (m) { return [m.source, m.source_url, 'effective ' + m.effective_date]; } },
    { file: 'data/hud-fmr-income-limits.json', what: 'Fair market rents and HUD income limits', src: function (m) { return [m.source, m.url_fmr, 'built ' + String(m.generated).slice(0, 10)]; } },
    { file: 'data/market/novogradac-equity-pricing.json', what: 'Tax credit equity pricing', src: function (m) { return [m.source + ', ' + m.vintage, m.source_url, 'as of ' + m.as_of]; } },
    { file: 'data/policy/lihtc-underwriting-rules.json', what: 'Basis, fee and credit rules', src: function (m) { return [m.title, null, 'checked ' + m.last_verified]; } }
  ];
  var meta = null;
  function loadMeta() {
    if (meta) return meta;
    meta = {};
    Promise.all(DATA.map(function (d) { return fetch(VENDOR + d.file).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }))
      .then(function (r) { meta.files = r.map(function (j) { return j && (j.meta || j.metadata || {}); }); Shell.render(); });
    return meta;
  }

  function stepper() {
    return '<ol class="stepper">' + STEPS.map(function (s, i) {
      return '<li><span class="step-n" aria-hidden="true">' + (i + 1) + '</span><span class="step-title">' + esc(s.title) + '</span><span class="step-text">' + esc(s.text) + '</span></li>';
    }).join('') + '<li class="step-result"><span class="step-n" aria-hidden="true">✓</span><span class="step-title">Results</span><span class="step-text">' + esc(RESULTS.join(' · ')) + '</span></li></ol>';
  }

  function start() {
    var mine = P.list();
    var rows = mine.slice(0, 4).map(function (p) {
      var full = P.get(p.projectId), s = full.scenarios[0];
      // A saved project opens at step 2, the homes and rents; its results are one link away.
      var at = esc(p.projectId) + '/' + esc(s.scenarioId);
      return '<li><a href="#/homes/' + at + '">' + esc(p.name) + '</a><span class="note"> ' + esc(p.jurisdiction ? p.jurisdiction.name : 'No place set') + ' · <a href="#/financials/' + at + '">results</a></span></li>';
    }).join('');
    return '<div class="start-grid">' +
      '<section class="start-card"><h2>Build it step by step</h2><p>Step 1 starts from a place. Steps 2 to 5 sit inside a project, so the homes, rents and costs stay together. A saved project opens at step 2. Projects save in this browser only.</p>' +
      (rows ? '<ul class="plain-list">' + rows + '</ul>' : '') +
      '<div class="actions"><a class="button-link" href="#/places">Start from a place</a><a class="button-link secondary" href="#/projects">Your projects</a></div></section>' +
      '<section class="start-card"><h2>Every line on one page</h2><p>The full Deal Calculator runs the same engine with every input on one page, including soft funding.</p>' +
      '<div class="actions"><a class="button-link secondary" href="' + esc(liveTool()) + '">Open the full Deal Calculator ↗</a></div></section></div>';
  }

  function dataTable() {
    var m = loadMeta();
    if (!m.files) return '<p role="status" class="note">Reading the data files…</p>';
    return '<div class="table-scroll" role="region" aria-label="What the engine reads" tabindex="0"><table><thead><tr><th scope="col">What</th><th scope="col">Source</th><th scope="col">Date</th></tr></thead><tbody>' +
      DATA.map(function (d, i) {
        var f = m.files[i];
        if (!f) return '<tr><th scope="row">' + esc(d.what) + '</th><td colspan="2">Not loaded</td></tr>';
        var s = d.src(f);
        return '<tr><th scope="row">' + esc(d.what) + '</th><td>' + (s[1] ? '<a href="' + esc(s[1]) + '">' + esc(s[0]) + '</a>' : esc(s[0])) + '</td><td>' + esc(s[2]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function view() {
    return T.head({
      kind: 'tool', crumbs: T.trail('deal', 'Deal Calculator'), title: 'LIHTC Deal Calculator',
      answer: 'Does a Colorado Low-Income Housing Tax Credit (LIHTC) deal pencil? Start with a quick estimate for a 9% or 4% rental deal, or homes for sale, then enter every line to see the sources and uses, tax credits, debt and the funding gap.'
    }) + (global.LabHna ? global.LabHna.stepPath(true, '#/deal-calculator', inAddress() || undefined) : '') +
      (global.LabDealQuick ? global.LabDealQuick.view() : '') +
      '<section class="tool-section"><h2>How it runs</h2>' + stepper() +
      '<p class="note" data-role="slider-pointer"><strong>Stress sliders</strong> (deep-tier rent cut, coverage floor, lease-up, and rent, vacancy and expense cases) are on a project\u2019s results page. Start from a place and save homes and rents, then open <em>results</em> and use <em>Jump to Stress sliders</em> under Full result. The quick estimate above has no sliders.</p></section>' +
      '<section class="tool-section">' + start() + '</section>' +
      '<section class="tool-section"><h2>What the engine reads</h2><p class="note">Every figure the engine uses comes from one of these files or from what you enter.</p>' + dataTable() + '</section>' +
      '<section class="tool-section"><h2>What the calculator does not show</h2><p>Credit pricing, basis, the 9% competition, the structural gap, 30 years of compliance, services budgets, CRA lenders, soft funding and the partnership and Colorado checklists to work through before predevelopment money goes in.</p>' +
      '<div class="actions"><a class="button-link secondary" href="#/guide/deal-reading' + (place() ? '?g=' + place() : '') + '">Before you underwrite</a></div></section>' +
      T.next('Before you start', [{ href: '#/guide/lihtc-basics', label: 'LIHTC basics' }, { href: '#/opportunity/preservation', label: 'Preservation inventory', secondary: true }]);
  }

  Shell.views['deal-calculator'] = view;
})(window);
