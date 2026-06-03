/**
 * indibuild-pipeline-public.js — F152
 * Renders the public-facing IndiBuild Pipeline page from
 * /data/indibuild/pipeline-content.json.
 *
 * The page is data-driven so non-developers can edit content
 * by changing JSON, not HTML.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/indibuild/pipeline-content.json';

  // ─── tiny dom helpers ──────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function fmtMoney(n) {
    if (n == null) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // ─── renderers ────────────────────────────────────────────────
  function renderHero(c) {
    var hero = el('section', { class: 'ipp-hero' });
    if (c.kicker) hero.appendChild(el('div', { class: 'ipp-hero__kicker', text: c.kicker }));
    hero.appendChild(el('h1', { text: c.title }));
    hero.appendChild(el('p', { class: 'ipp-hero__lede', text: c.lede }));

    if (Array.isArray(c.stat_strip) && c.stat_strip.length) {
      var strip = el('div', { class: 'ipp-stat-strip' });
      c.stat_strip.forEach(function (s) {
        var card = el('div', { class: 'ipp-stat' });
        card.appendChild(el('div', { class: 'ipp-stat__label', text: s.label }));
        card.appendChild(el('div', { class: 'ipp-stat__value', text: s.value }));
        if (s.sub) card.appendChild(el('div', { class: 'ipp-stat__sub', text: s.sub }));
        if (s.source) card.appendChild(el('div', { class: 'ipp-stat__source', text: 'Source: ' + s.source }));
        strip.appendChild(card);
      });
      hero.appendChild(strip);
    }
    return hero;
  }

  function renderHowTo(intro) {
    var sec = el('section', { class: 'ipp-howto js-glossary-auto' });
    sec.appendChild(el('h2', { text: 'How to read this page' }));
    if (intro.why_this_matters) {
      sec.appendChild(el('p', {
        text: intro.why_this_matters,
        style: 'margin: 0 0 0.75rem; font-size: 0.92rem; color: var(--text); line-height: 1.55;'
      }));
    }
    var ul = el('ul');
    intro.how_to_read.forEach(function (line) { ul.appendChild(el('li', { text: line })); });
    sec.appendChild(ul);
    return sec;
  }

  function renderAmiAnchor(c) {
    var sec = el('section', { class: 'ipp-section js-glossary-auto', id: 'ami-anchor' });
    sec.appendChild(el('h2', { text: c.title }));
    sec.appendChild(el('p', { text: c.preface, style: 'margin: 0 0 0.65rem; color: var(--muted); line-height: 1.55;' }));
    sec.appendChild(el('div', { class: 'ipp-ami-vintage', text: c.vintage }));
    var wrap = el('div', { class: 'ipp-ami-table-wrap' });
    var t = el('table', { class: 'ipp-ami-table' });
    t.appendChild(el('thead', null, el('tr', null, [
      el('th', { text: 'County (4-person household)' }),
      el('th', { text: '30% AMI' }),
      el('th', { text: '50% AMI' }),
      el('th', { text: '60% AMI' }),
      el('th', { text: '80% AMI' }),
      el('th', { text: '100% AMI' })
    ])));
    var tb = el('tbody');
    c.rows.forEach(function (r) {
      tb.appendChild(el('tr', null, [
        el('td', { text: r.county }),
        el('td', { text: fmtMoney(r.ami_30) }),
        el('td', { text: fmtMoney(r.ami_50) }),
        el('td', { text: fmtMoney(r.ami_60) }),
        el('td', { text: fmtMoney(r.ami_80) }),
        el('td', { text: fmtMoney(r.ami_100) })
      ]));
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    sec.appendChild(wrap);
    sec.appendChild(el('p', { class: 'ipp-ami-footnote', text: c.footnote }));
    return sec;
  }

  function renderConfidenceBadge(level, note) {
    var labelMap = {
      'high': 'High',
      'medium-public': 'Medium (public data) — verify locally',
      'medium': 'Medium',
      'low': 'Low'
    };
    var wrap = el('div');
    var badge = el('span', {
      class: 'ipp-confidence ipp-confidence--' + (level || 'medium-public'),
      text: 'Confidence: ' + (labelMap[level] || labelMap['medium-public'])
    });
    wrap.appendChild(badge);
    if (note) wrap.appendChild(el('p', { class: 'ipp-confidence__note', text: note }));
    return wrap;
  }

  function renderSourcesTable(rows) {
    var t = el('table', { class: 'ipp-sources' });
    t.appendChild(el('thead', null, el('tr', null, [
      el('th', { text: 'Source' }),
      el('th', { text: 'Vintage' }),
      el('th', { text: 'What it provides' })
    ])));
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', null, [
        el('td', { text: r.label }),
        el('td', { text: r.vintage }),
        el('td', { text: r.what })
      ]));
    });
    t.appendChild(tb);
    return t;
  }

  function renderStep(s) {
    var step = el('section', { class: 'ipp-step js-glossary-auto', id: 'step-' + s.n });

    var head = el('div', { class: 'ipp-step__head' });
    head.appendChild(el('div', { class: 'ipp-step__n', text: String(s.n) }));
    var tb = el('div', { class: 'ipp-step__titleblock' });
    tb.appendChild(el('h2', { text: 'Step ' + s.n + ' — ' + s.title }));
    tb.appendChild(el('p', { class: 'ipp-step__summary', text: s.summary }));
    head.appendChild(tb);
    step.appendChild(head);

    // What this means
    if (s.what_this_means) {
      var b = el('div', { class: 'ipp-block' });
      b.appendChild(el('div', { class: 'ipp-block__label', text: 'What this means' }));
      b.appendChild(el('p', { text: s.what_this_means }));
      step.appendChild(b);
    }

    // A/B/C/D buckets (only on Step 4)
    if (Array.isArray(s.buckets) && s.buckets.length) {
      var bb = el('div', { class: 'ipp-block' });
      bb.appendChild(el('div', { class: 'ipp-block__label', text: 'The four buckets' }));
      var grid = el('div', { class: 'ipp-bucket-grid' });
      s.buckets.forEach(function (k) {
        var b = el('div', { class: 'ipp-bucket ipp-bucket--' + k.code });
        var h = el('div', { class: 'ipp-bucket__head' });
        h.appendChild(el('span', { class: 'ipp-bucket__code', text: k.code }));
        h.appendChild(el('span', { class: 'ipp-bucket__name', text: k.name }));
        b.appendChild(h);
        b.appendChild(el('p', { class: 'ipp-bucket__def', text: k.definition }));
        grid.appendChild(b);
      });
      bb.appendChild(grid);
      step.appendChild(bb);
    }

    // Readiness levels (only on Step 6)
    if (Array.isArray(s.readiness_levels) && s.readiness_levels.length) {
      var rb = el('div', { class: 'ipp-block' });
      rb.appendChild(el('div', { class: 'ipp-block__label', text: 'The five readiness levels' }));
      var rl = el('ul', { class: 'ipp-levels' });
      s.readiness_levels.forEach(function (r) {
        var li = el('li', { class: 'ipp-level' });
        li.appendChild(el('div', { class: 'ipp-level__n', text: 'Level ' + r.level }));
        var n = el('div');
        n.appendChild(el('span', { class: 'ipp-level__name', text: r.name }));
        n.appendChild(el('span', { class: 'ipp-level__def', text: r.definition }));
        li.appendChild(n);
        rl.appendChild(li);
      });
      rb.appendChild(rl);
      step.appendChild(rb);
    }

    // Site lenses (only on Step 5)
    if (Array.isArray(s.lenses) && s.lenses.length) {
      var lb = el('div', { class: 'ipp-block' });
      lb.appendChild(el('div', { class: 'ipp-block__label', text: 'The eight site lenses (easiest to hardest)' }));
      var ll = el('ul', { class: 'ipp-lenses' });
      s.lenses.forEach(function (lens) {
        var li = el('li', { class: 'ipp-lens' });
        var c = el('div');
        c.appendChild(el('span', { class: 'ipp-lens__label', text: lens.label }));
        c.appendChild(el('span', { class: 'ipp-lens__note', text: lens.note }));
        li.appendChild(c);
        ll.appendChild(li);
      });
      lb.appendChild(ll);
      step.appendChild(lb);
    }

    // Why a council member should care (Step 2 only)
    if (s.why_a_council_member_should_care) {
      var c = el('div', { class: 'ipp-block ipp-block--council' });
      c.appendChild(el('div', { class: 'ipp-block__label', text: 'Why a council member should care' }));
      c.appendChild(el('p', { text: s.why_a_council_member_should_care }));
      step.appendChild(c);
    }

    // External reconciliation (Step 2)
    if (s.external_reconciliation) {
      var er = el('div', { class: 'ipp-recon' });
      er.appendChild(el('h4', { text: s.external_reconciliation.title }));
      var ul = el('ul');
      s.external_reconciliation.sources.forEach(function (src) {
        var li = el('li');
        var a = el('a', { href: src.url, target: '_blank', rel: 'noopener', text: src.name });
        li.appendChild(a);
        li.appendChild(document.createTextNode(' — ' + src.purpose));
        ul.appendChild(li);
      });
      er.appendChild(ul);
      if (s.external_reconciliation.note) er.appendChild(el('p', { text: s.external_reconciliation.note, style: 'font-size:.82rem;color:var(--muted);margin:.6rem 0 0;line-height:1.5;' }));
      step.appendChild(er);
    }

    // Why it matters
    if (s.why_it_matters) {
      var w = el('div', { class: 'ipp-block' });
      w.appendChild(el('div', { class: 'ipp-block__label', text: 'Why it matters' }));
      w.appendChild(el('p', { text: s.why_it_matters }));
      step.appendChild(w);
    }

    // Community engagement note (Step 3)
    if (s.community_engagement_note) {
      var ce = el('div', { class: 'ipp-block ipp-block--council' });
      ce.appendChild(el('div', { class: 'ipp-block__label', text: 'Community engagement' }));
      ce.appendChild(el('p', { text: s.community_engagement_note }));
      step.appendChild(ce);
    }

    // Examples (Step 8)
    if (Array.isArray(s.examples) && s.examples.length) {
      var ex = el('div', { class: 'ipp-block' });
      ex.appendChild(el('div', { class: 'ipp-block__label', text: 'Examples of named next actions' }));
      var eul = el('ul');
      s.examples.forEach(function (e) { eul.appendChild(el('li', { text: e })); });
      ex.appendChild(eul);
      step.appendChild(ex);
    }

    // Data sources
    if (Array.isArray(s.data_sources) && s.data_sources.length) {
      var ds = el('div', { class: 'ipp-block' });
      ds.appendChild(el('div', { class: 'ipp-block__label', text: 'Data sources' }));
      ds.appendChild(renderSourcesTable(s.data_sources));
      step.appendChild(ds);
    }

    // Confidence
    if (s.confidence) {
      var cf = el('div', { class: 'ipp-block' });
      cf.appendChild(el('div', { class: 'ipp-block__label', text: 'Confidence' }));
      cf.appendChild(renderConfidenceBadge(s.confidence, s.confidence_note));
      step.appendChild(cf);
    }

    // Watch-outs
    if (Array.isArray(s.watch_outs) && s.watch_outs.length) {
      var wo = el('div', { class: 'ipp-block' });
      wo.appendChild(el('div', { class: 'ipp-block__label', text: 'Watch-outs' }));
      var wul = el('ul');
      s.watch_outs.forEach(function (w) { wul.appendChild(el('li', { text: w })); });
      wo.appendChild(wul);
      step.appendChild(wo);
    }

    // What this does NOT tell you
    if (s.does_not_tell_you) {
      var dn = el('div', { class: 'ipp-block ipp-block--not' });
      dn.appendChild(el('div', { class: 'ipp-block__label', text: 'What this does NOT tell you' }));
      dn.appendChild(el('p', { text: s.does_not_tell_you }));
      step.appendChild(dn);
    }

    // Next step
    if (s.next_step) {
      var ns = el('div', { class: 'ipp-block' });
      ns.appendChild(el('div', { class: 'ipp-block__label', text: 'Next step' }));
      ns.appendChild(el('p', { text: s.next_step }));
      step.appendChild(ns);
    }

    return step;
  }

  function renderVerificationQuestions(vq) {
    var sec = el('section', { class: 'ipp-section js-glossary-auto', id: 'verification' });
    sec.appendChild(el('h2', { text: vq.title }));
    sec.appendChild(el('p', { text: vq.preface, style: 'margin: 0 0 0.65rem; color: var(--muted); line-height: 1.55;' }));
    var ol = el('ol', { class: 'ipp-vq' });
    vq.questions.forEach(function (q) { ol.appendChild(el('li', { text: q })); });
    sec.appendChild(ol);
    return sec;
  }

  function renderBoundary(b) {
    var sec = el('section', { class: 'ipp-section', id: 'boundary' });
    sec.appendChild(el('h2', { text: b.title }));
    sec.appendChild(el('p', { text: b.body, style: 'margin: 0 0 0.85rem; color: var(--text); line-height: 1.6;' }));

    var grid = el('div', { class: 'ipp-boundary-grid' });

    var pub = el('div', { class: 'ipp-boundary ipp-boundary--public' });
    pub.appendChild(el('h4', { text: 'What we publish' }));
    var pul = el('ul');
    b.what_we_publish.forEach(function (i) { pul.appendChild(el('li', { text: i })); });
    pub.appendChild(pul);
    grid.appendChild(pub);

    var priv = el('div', { class: 'ipp-boundary ipp-boundary--private' });
    priv.appendChild(el('h4', { text: 'What stays in private workspace' }));
    var rul = el('ul');
    b.what_stays_private.forEach(function (i) { rul.appendChild(el('li', { text: i })); });
    priv.appendChild(rul);
    grid.appendChild(priv);

    sec.appendChild(grid);

    if (b.boundary_rule) {
      sec.appendChild(el('p', { class: 'ipp-boundary__rule', text: b.boundary_rule }));
    }
    return sec;
  }

  function renderClosing(c) {
    var sec = el('section', { class: 'ipp-section', id: 'closing' });
    sec.appendChild(el('h2', { text: c.title }));
    sec.appendChild(el('p', { text: c.body, style: 'margin: 0 0 0.5rem; color: var(--text); line-height: 1.6;' }));
    if (Array.isArray(c.links) && c.links.length) {
      var g = el('div', { class: 'ipp-close-grid' });
      c.links.forEach(function (lnk) {
        g.appendChild(el('a', { class: 'ipp-close-link', href: lnk.href, text: lnk.label }));
      });
      sec.appendChild(g);
    }
    return sec;
  }

  // ─── boot ─────────────────────────────────────────────────────
  function mount(data) {
    var root = document.getElementById('ippMount');
    if (!root) return;
    // Clear the "Loading…" placeholder before mounting content
    root.innerHTML = '';

    var frag = document.createDocumentFragment();
    frag.appendChild(renderHero(data.hero));
    frag.appendChild(renderHowTo(data.intro));
    frag.appendChild(renderAmiAnchor(data.ami_anchor));

    data.steps.forEach(function (s) { frag.appendChild(renderStep(s)); });

    frag.appendChild(renderVerificationQuestions(data.verification_questions));
    frag.appendChild(renderBoundary(data.public_private_boundary));
    frag.appendChild(renderClosing(data.closing));

    root.appendChild(frag);

    // Re-decorate inline-glossary terms in the freshly mounted content
    if (window.InlineGlossary && typeof window.InlineGlossary.decorate === 'function') {
      window.InlineGlossary.decorate(root);
    }
  }

  function mountError(err) {
    var root = document.getElementById('ippMount');
    if (!root) return;
    root.innerHTML =
      '<div style="padding:2rem;background:var(--card);border:1px solid var(--border);border-radius:8px;">' +
      '<h2 style="margin-top:0;color:var(--bad,#b91c1c);">Could not load the pipeline content.</h2>' +
      '<p style="color:var(--muted);">Reload the page or check Data Health for ingest issues. Details: ' +
      String(err && err.message ? err.message : err) + '</p></div>';
  }

  function init() {
    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(mount)
      .catch(mountError);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
