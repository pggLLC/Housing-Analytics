// The address an audit opens a page with, where the page shows nothing until
// a visitor picks something.
//
// Since 2026-10-26 the HNA pages start on "pick a place" when no address or
// saved place names one (js/hna/hna-controller.js init). Audits opened them
// bare and measured the loaded statewide page; opening them on Colorado
// statewide keeps measuring that page: the heaviest HNA load (926 LIHTC
// markers) and every source line, chart and stat it renders.
const HNA_STATEWIDE = '?geoid=08&geoType=state';

// Since 2026-11-13 a written guide's own page forwards a visitor to the Policy
// hub, which draws the guide from the words on that page. The words, their
// source lines and their markup still live on the page, so audits keep
// measuring it there: ?classic=1 shows the page as written, not forwarded.
const GUIDE_AS_WRITTEN = '?classic=1';

export const ARRIVE_WITH = Object.freeze({
  'lihtc-guide-for-stakeholders.html':   GUIDE_AS_WRITTEN,
  'affordable-deal-team.html':           GUIDE_AS_WRITTEN,
  'green-building-guide.html':           GUIDE_AS_WRITTEN,
  'resident-services.html':              GUIDE_AS_WRITTEN,
  'cra-expansion-analysis.html':         GUIDE_AS_WRITTEN,
  'lihtc-enhancement-ahcia.html':        GUIDE_AS_WRITTEN,
  'article-fair-housing-rollback.html':  GUIDE_AS_WRITTEN,
  'article-federal-rule-changes.html':   GUIDE_AS_WRITTEN,
  'housing-authority-guide.html':        GUIDE_AS_WRITTEN,
  'apa-white-paper.html':                GUIDE_AS_WRITTEN,
  'working-paper.html':                  GUIDE_AS_WRITTEN,
  'methods.html':                        GUIDE_AS_WRITTEN,
  'about.html':                          GUIDE_AS_WRITTEN,
  'housing-help.html':                   GUIDE_AS_WRITTEN,
  'help-for-homebuyers.html':            GUIDE_AS_WRITTEN,
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
