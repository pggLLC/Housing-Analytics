// How it gets built (#/pipeline): the live page's eight stages from data/pipeline/content.json, the same file
// pipeline.html renders. Every field is shown as written; the lab lays the stages out as a numbered path,
// each one opening to its sources, confidence, limits and next step.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var LIVE = 'https://cohoanalytics.com/';
  var CONF = { high: 'High', 'medium-public': 'Medium (public data)', medium: 'Medium', low: 'Low' };
  // The live page's own links, mapped to lab pages where the lab has one.
  var IN_LAB = { 'lihtc-guide-for-stakeholders.html': '#/guide/lihtc-basics' };

  function link(href) { return IN_LAB[href] || (/^https?:/.test(href) ? href : LIVE + href); }
  function list(items) { return items && items.length ? '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }

  function view() {
    var s = UI.load({ c: 'data/pipeline/content.json' });
    var crumbs = T.trail('deal', 'How it gets built');
    if (!s.data) return T.head({ kind: 'guide', crumbs: crumbs, title: 'How it gets built' }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var c = s.data.c, hero = c.hero, stat = hero.stat_strip[0];
    var steps = c.steps.map(function (st) {
      return '<li class="pl-step" id="pl-' + st.n + '" tabindex="-1"><details' + (st.n === 1 ? ' open' : '') + '><summary><span class="pl-n" aria-hidden="true">' + st.n + '</span><span class="pl-title">' + esc(st.title) + '</span><span class="pl-sum">' + esc(st.summary) + '</span></summary>' +
        '<div class="pl-body">' +
        '<p>' + esc(st.what_this_means) + '</p>' +
        '<h4>Why it matters</h4><p>' + esc(st.why_it_matters) + '</p>' +
        '<div class="table-scroll" data-no-source="catalog: the table lists the sources themselves"><table><caption>Public data for this stage</caption><thead><tr><th scope="col">Source</th><th scope="col">Vintage</th><th scope="col">What it gives</th></tr></thead><tbody>' +
        st.data_sources.map(function (d) { return '<tr><td>' + esc(d.label) + '</td><td>' + esc(d.vintage) + '</td><td>' + esc(d.what) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p><span class="scope-tag">Confidence: ' + esc(CONF[st.confidence] || st.confidence) + '</span> ' + esc(st.confidence_note || '') + '</p>' +
        '<h4>Watch out for</h4>' + list(st.watch_outs) +
        '<h4>What this stage does not tell you</h4><p>' + esc(st.does_not_tell_you) + '</p>' +
        '<p class="pl-next"><strong>Next:</strong> ' + esc(st.next_step) + '</p>' +
        '</div></details></li>';
    }).join('');
    var ami = c.ami_anchor, bands = ['ami_30', 'ami_50', 'ami_60', 'ami_80', 'ami_100'];
    var amiTable = '<div class="table-scroll"><table><caption>' + esc(ami.title) + ', household of four, ' + esc(ami.vintage) + '</caption><thead><tr><th scope="col">County</th>' +
      bands.map(function (b) { return '<th scope="col" class="num">' + b.slice(4) + '% AMI</th>'; }).join('') + '</tr></thead><tbody>' +
      ami.rows.map(function (r) { return '<tr><th scope="row">' + esc(r.county) + '</th>' + bands.map(function (b) { return '<td class="num">' + esc(UI.money(r[b])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    var pp = c.public_private_boundary;
    return T.head({
      kind: 'guide', crumbs: crumbs, title: hero.title,
      answer: esc(hero.lede),
      meta: '<span class="scope-tag">Public method only</span> Reviewed ' + esc(c._meta.last_reviewed) + '. No specific sites, owners or deal status.',
      facts: [{ value: stat.value, label: stat.label + ', 2023', source: stat.source }]
    }) +
      '<p>' + esc(c.intro.why_this_matters) + '</p>' + list(c.intro.how_to_read) +
      '<h2>The eight stages</h2><p class="note">Open a stage for its sources, confidence and limits.</p>' +
      '<ol class="pl-steps">' + steps + '</ol>' +
      '<h2>' + esc(ami.title) + '</h2><p>' + esc(ami.preface) + '</p>' + amiTable +
      '<p class="note">' + esc(ami.footnote) + '</p>' + T.source('HUD income limits', ami.source_url, ami.vintage) +
      '<h2>' + esc(c.verification_questions.title) + '</h2><p>' + esc(c.verification_questions.preface) + '</p>' +
      '<ol>' + c.verification_questions.questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      '<h2>' + esc(pp.title) + '</h2><p>' + esc(pp.body) + '</p>' +
      '<div class="chart-pair"><div><h3>Public here</h3>' + list(pp.what_is_public) + '</div><div><h3>Kept private</h3>' + list(pp.what_stays_private) + '</div></div>' +
      '<p class="callout">' + esc(pp.boundary_rule) + '</p>' +
      '<h2>' + esc(c.closing.title) + '</h2><p>' + esc(c.closing.body) + '</p>' +
      '<ul>' + c.closing.links.map(function (l) { return '<li><a href="' + esc(link(l.href)) + '">' + esc(l.label) + '</a></li>'; }).join('') + '</ul>' +
      T.next('Next', [{ href: '#/places', label: 'Start with a place →' }, { href: '#/guide/deal-team', label: 'Who does what', secondary: true }]);
  }

  Shell.views.pipeline = view;
  global.LabPipeline = { view: view };
})(window);
