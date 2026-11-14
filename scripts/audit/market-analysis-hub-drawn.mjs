// Which elements of <main> are in the page but not drawn. Shared by the two browser checks that compare
// market-analysis.html with deal-market-analysis.html (market-analysis-hub-parity.mjs and -sweep.mjs).
//
// Both checks read the page's words with textContent, which returns the words of a hidden element too. So on its
// own, "the words are the same" would still pass if the new page hid a score, a risk flag or a table the old page
// shows. This lists every element that is not drawn (display, visibility, a closed <details>, a hidden ancestor),
// and the two pages must list the same ones.
//
// Left out: the trail the new page adds; glossary pop-ups, the <abbr> the glossary puts round a term and the bare
// <span> it puts round the sentence that term sits in (js/glossary.js; which sentences it reaches first varies
// from load to load on either page); the one element the new page hides on purpose
// (.kicker, the small line above the heading, which the trail replaces); and the map's picture tiles (how many
// there are follows the width of the map's box, which the new look changes; the map's layers, markers and
// controls are compared).
//
// An element is named by its own id, or by its tag and its first class in alphabetical order under the nearest
// ancestor that has an id, so a name does not move when a glossary term is wrapped somewhere above it, or when two
// scripts that each add a class to a table header (js/components/table-sort.js and table-header-tips.js) finish
// in the other order. Ids a script numbers as it goes (thtip-45) are not used: the number differs from load to
// load.
//
// notDrawn runs inside the page (pass it to page.evaluate) and returns { elements, hidden: ['name xCount', ...],
// all: ['name xCount', ...] }: `all` names every element counted, so when the totals differ the report can say
// which element one page has and the other has not.
// readNotDrawn(page) is what the checks call: those two scripts decorate a table a moment after it is drawn
// (50 and 60 ms), so it reads until two readings in a row agree and returns that one.
export const notDrawn = () => {
  const live = document.getElementById('main-content');
  const SKIP = 'nav.crumbs, nav.crumbs *, .gl-tooltip-popup, .gl-tooltip-popup *, .gl-tooltip-trigger, abbr[data-glossary], script, style, noscript, template, .kicker, .kicker *, .leaflet-tile-pane *';
  const made = id => /^(thtip|tip|gl|tt|uid|id)-?\d+$/i.test(id);
  const nameOf = e => {
    if (e.id && !made(e.id)) return '#' + e.id;
    let a = e.parentElement;
    while (a && a !== live && !(a.id && !made(a.id))) a = a.parentElement;
    return (a && a !== live ? '#' + a.id + ' ' : '') + e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).sort()[0] : '');
  };
  const count = {}, every = {};
  let elements = 0;
  live.querySelectorAll('*').forEach(e => {
    if (e.matches(SKIP)) return;
    if (e.tagName === 'SPAN' && !e.attributes.length && e.querySelector(':scope > .gl-tooltip-trigger')) return;
    elements++;
    const k = nameOf(e);
    every[k] = (every[k] || 0) + 1;
    if (!e.checkVisibility({ checkVisibilityCSS: true })) count[k] = (count[k] || 0) + 1;
  });
  const list = m => Object.keys(m).sort().map(k => k + ' x' + m[k]);
  return { elements, hidden: list(count), all: list(every) };
};

// What two readings disagree on, in words: '' when they agree.
export function drawnDiff(a, b) {
  const only = (x, y) => { const Y = new Set(y); return x.filter(k => !Y.has(k)).slice(0, 6).join(' ; ') || 'same'; };
  const out = [];
  if (a.elements !== b.elements || a.all.join('|') !== b.all.join('|')) out.push('elements ' + a.elements + ' on the old page, ' + b.elements + ' on the new: old page ' + only(a.all, b.all) + ' | new page ' + only(b.all, a.all));
  if (a.hidden.join('|') !== b.hidden.join('|')) out.push('not drawn, old page ' + only(a.hidden, b.hidden) + ' | new page ' + only(b.hidden, a.hidden));
  return out.join('; ');
}

export async function readNotDrawn(page) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(notDrawn);
    if (last && now.all.join('|') === last.all.join('|') && now.hidden.join('|') === last.hidden.join('|')) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}
