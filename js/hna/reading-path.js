/**
 * The guided reading path.
 *
 * The assessment runs 54 sections and changes subject 33 times; affordability
 * alone is split across 8 non-contiguous runs between screens 6 and 42. The
 * contents rail made that navigable, but navigable is not the same as
 * coherent — a reader still has to work out for themselves which sections
 * constitute the argument and in what order.
 *
 * This is the argument, stated as a route: eight stops running "what exists →
 * who is priced out → what households earn → is it getting worse → how much is
 * needed → what to do". It reorders nothing. The sections stay exactly where
 * they are; the path just says which ones matter and in which order to read
 * them — the narrative benefit without the regression risk of moving 54
 * sections past freshness checks, anchors and the PDF export.
 *
 * The route follows DOCUMENT order. An earlier draft ordered it purely by
 * argument and sent the reader from screen 20 back to screen 7 between two
 * consecutive steps; a numbered path that jumps backwards reads as broken, and
 * a reader may scroll rather than click between stops. followsDocumentOrder()
 * below caught that, and is kept so a future edit cannot reintroduce it.
 * Ordering by the page cost nothing in the end — burden following stock
 * directly is, if anything, tighter than the draft.
 *
 * Every anchor is one that already exists in the page — 13 headings carry
 * stable ids and 14 sections do. Nothing here invents an anchor, because an
 * invented one silently stops matching the first time the markup moves.
 *
 * Steps whose target is absent or hidden are dropped rather than rendered as
 * dead links: the county-comparison stop only exists when a place is selected,
 * and a path that offers a destination the reader cannot reach is worse than a
 * shorter path.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HNAReadingPath = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /**
   * The route. `question` is what the reader is actually asking at that point —
   * the labels are deliberately questions rather than section titles, because
   * the section titles are what failed to convey the argument in the first
   * place.
   */
  var STEPS = [
    { id: 'hnaDecisionStrip',          label: 'The short answer',
      question: 'What does this jurisdiction need, in four numbers?' },
    { id: 'countyComparisonSection',   label: 'Compared to the county',
      question: 'Is this town better or worse off than the county around it?' },
    { id: 'hnaH2Stock',                label: 'What housing exists',
      question: 'What is already built, and of what kind?' },
    { id: 'hnaH2RentBurden',           label: 'Who is priced out',
      question: 'How many households pay more than they can carry?' },
    { id: 'hnaH2Income',               label: 'What households earn',
      question: 'What can households here actually afford?' },
    { id: 'hnaH2DecadeAffordTrend',    label: 'Is it getting worse',
      question: 'Has affordability moved over the last 15 years?' },
    { id: 'housing-need-projection',   label: 'How much is needed',
      question: 'How many units, at which income bands?' },
    { id: 'housing-action-plan',       label: 'What to do about it',
      question: 'Which actions address what the data shows?' }
  ];

  function isReachable(doc, id) {
    var el = doc.getElementById(id);
    if (!el) return false;
    if (el.hidden) return false;
    if (el.closest && el.closest('[hidden]')) return false;
    var view = doc.defaultView;
    if (view && view.getComputedStyle) {
      var cs = view.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  /**
   * resolve — the steps a reader can actually follow right now.
   * @param {Document} doc
   * @param {{steps?: Array}} [opts]
   * @returns {{steps: Array, dropped: Array}}
   */
  function resolve(doc, opts) {
    opts = opts || {};
    var list = opts.steps || STEPS;
    var steps = [];
    var dropped = [];
    list.forEach(function (step) {
      if (isReachable(doc, step.id)) steps.push(step);
      else dropped.push(step);
    });
    return { steps: steps, dropped: dropped };
  }

  /**
   * Reading order must match document order, or the path sends readers
   * backwards up a page they are scrolling down. The route above was written
   * to follow the page; this proves it against the real DOM instead of
   * trusting the author — including future authors.
   */
  function followsDocumentOrder(doc, steps) {
    for (var i = 1; i < steps.length; i += 1) {
      var a = doc.getElementById(steps[i - 1].id);
      var b = doc.getElementById(steps[i].id);
      if (!a || !b) continue;
      // DOCUMENT_POSITION_FOLLOWING (4) means b comes after a.
      if (!(a.compareDocumentPosition(b) & 4)) return false;
    }
    return true;
  }

  return {
    STEPS: STEPS.slice(),
    resolve: resolve,
    isReachable: isReachable,
    followsDocumentOrder: followsDocumentOrder
  };
}));
