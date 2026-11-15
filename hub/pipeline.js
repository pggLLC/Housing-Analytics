// How it gets built (#/pipeline): the live page's eight stages from data/pipeline/content.json, the same file
// pipeline.html renders. Every field is shown as written; the lab lays the stages out as a numbered path,
// each one opening to its sources, confidence, limits and next step. A stage's own extras (the four buckets,
// the readiness levels for both tracks, what follows closing, the site lenses, the council note, the three
// sources to reconcile against, the community note and the named next actions) are shown in the same order
// as pipeline.html (content check of 14 Nov 2026, gap 12).
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
  function levels(label, rows) {
    return '<h4>' + esc(label) + '</h4><ol class="pl-levels">' + rows.map(function (r) {
      return '<li><span class="scope-tag">Level ' + esc(r.level) + '</span> <strong>' + esc(r.name) + '</strong><span class="pl-def">' + esc(r.definition) + '</span></li>';
    }).join('') + '</ol>';
  }
  // The parts only some stages carry, in pipeline.html's order.
  function extras(st, strip) {
    var h = '';
    if (st.buckets && st.buckets.length) {
      h += '<h4>The four buckets</h4>' + (strip && strip.sub ? '<p>' + esc(strip.sub) + '</p>' : '') + '<ul class="pl-buckets">' + st.buckets.map(function (b) {
        return '<li><span class="pl-code" aria-hidden="true">' + esc(b.code) + '</span><span><strong>' + esc(b.code) + ': ' + esc(b.name) + '</strong><span class="pl-def">' + esc(b.definition) + '</span></span></li>';
      }).join('') + '</ul><p class="note"><strong>Public boundary:</strong> these buckets explain the framework. Jurisdiction-specific classifications and outreach status are internal review materials.</p>';
    }
    if (st.readiness_levels && st.readiness_levels.length) h += levels(st.readiness_label || 'The five readiness levels', st.readiness_levels);
    var ot = st.ownership_track;
    if (ot && ot.readiness_levels && ot.readiness_levels.length) {
      if (ot.what_this_means) h += '<h4>Affordable ownership: what this means</h4><p>' + esc(ot.what_this_means) + '</p>';
      h += levels(ot.title || 'Affordable ownership: the five readiness levels', ot.readiness_levels);
      if (ot.watch_outs && ot.watch_outs.length) h += '<h4>Watch out for on the ownership track</h4>' + list(ot.watch_outs);
      if (ot.does_not_tell_you) h += '<h4>What the ownership track does not tell you</h4><p>' + esc(ot.does_not_tell_you) + '</p>';
    }
    var ac = st.after_closing;
    if (ac && ac.tracks && ac.tracks.length) {
      h += '<h4>' + esc(ac.label || 'What follows closing') + '</h4>' + (ac.intro ? '<p>' + esc(ac.intro) + '</p>' : '') + ac.tracks.map(function (t) {
        return '<h5 class="pl-track">' + esc(t.track) + '</h5><ul class="pl-oblig">' + (t.obligations || []).map(function (o) {
          return '<li><strong>' + esc(o.what) + '</strong><dl>' +
            [['When', o.when], ['Who reports', o.who_reports], ['To whom', o.to_whom], ['If missed', o.if_missed]].map(function (x) {
              return x[1] ? '<div><dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd></div>' : '';
            }).join('') + '</dl></li>';
        }).join('') + '</ul>';
      }).join('');
    }
    if (st.lenses && st.lenses.length) {
      h += '<h4>The eight site lenses (easiest to hardest)</h4><ol class="pl-levels">' + st.lenses.map(function (l) {
        return '<li><strong>' + esc(l.label) + '</strong><span class="pl-def">' + esc(l.note) + '</span></li>';
      }).join('') + '</ol>';
    }
    if (st.why_a_council_member_should_care) h += '<h4>Why a council member should care</h4><p>' + esc(st.why_a_council_member_should_care) + '</p>';
    var er = st.external_reconciliation;
    if (er && er.sources && er.sources.length) {
      h += '<h4>' + esc(er.title) + '</h4><ul>' + er.sources.map(function (x) {
        return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>: ' + esc(x.purpose) + '</li>';
      }).join('') + '</ul>' + (er.note ? '<p class="note">' + esc(er.note) + '</p>' : '');
    }
    return h;
  }
  // Only on the stage that carries them, after "Why it matters" as on pipeline.html.
  function later(st) {
    var h = '';
    if (st.community_engagement_note) h += '<h4>Community engagement</h4><p>' + esc(st.community_engagement_note) + '</p>';
    if (st.examples && st.examples.length) h += '<h4>Examples of named next actions</h4>' + list(st.examples);
    return h;
  }

  function view() {
    var s = UI.load({ c: 'data/pipeline/content.json' });
    var crumbs = T.trail('deal', 'How it gets built');
    if (!s.data) return T.head({ kind: 'guide', crumbs: crumbs, title: 'How it gets built' }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var c = s.data.c, hero = c.hero, stat = hero.stat_strip[0];
    var steps = c.steps.map(function (st) {
      return '<li class="pl-step" id="pl-' + st.n + '" tabindex="-1"><details' + (st.n === 1 ? ' open' : '') + '><summary><span class="pl-n" aria-hidden="true">' + st.n + '</span><span class="pl-title">' + esc(st.title) + '</span><span class="pl-sum">' + esc(st.summary) + '</span></summary>' +
        '<div class="pl-body">' +
        '<p>' + esc(st.what_this_means) + '</p>' + extras(st, hero.stat_strip[2]) +
        '<h4>Why it matters</h4><p>' + esc(st.why_it_matters) + '</p>' + later(st) +
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
      (stat.sub ? '<p class="note">' + esc(stat.sub) + ' Source: ' + esc(stat.source) + '</p>' : '') +
      '<p>' + esc(c.intro.why_this_matters) + '</p>' + list(c.intro.how_to_read) +
      '<h2>The eight stages</h2><p class="note">' + (hero.stat_strip[1] && hero.stat_strip[1].sub ? esc(hero.stat_strip[1].sub) + ' ' : '') + 'Open a stage for its sources, confidence and limits.</p>' +
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
