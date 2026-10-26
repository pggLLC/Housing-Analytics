// The address an audit opens a page with, where the page shows nothing until
// a visitor picks something.
//
// Since 2026-10-26 the HNA pages start on "pick a place" when no address or
// saved place names one (js/hna/hna-controller.js init). Audits opened them
// bare and measured the loaded statewide page; opening them on Colorado
// statewide keeps measuring that page: the heaviest HNA load (926 LIHTC
// markers) and every source line, chart and stat it renders.
const HNA_STATEWIDE = '?geoid=08&geoType=state';

export const ARRIVE_WITH = Object.freeze({
  'housing-needs-assessment.html':       HNA_STATEWIDE,
  'hna-what-housing-exists.html':        HNA_STATEWIDE,
  'hna-who-lives-here.html':             HNA_STATEWIDE,
  'hna-what-households-can-afford.html': HNA_STATEWIDE,
  'hna-where-its-heading.html':          HNA_STATEWIDE,
  'hna-what-to-do.html':                 HNA_STATEWIDE,
});

// "page.html", "page.html#tab" or "/page.html" -> the same with the query
// inserted before any hash.
export function arriveUrl(pagePath) {
  const hash = pagePath.indexOf('#');
  const file = hash < 0 ? pagePath : pagePath.slice(0, hash);
  const query = ARRIVE_WITH[file.replace(/^\//, '')] || '';
  return file + query + (hash < 0 ? '' : pagePath.slice(hash));
}
