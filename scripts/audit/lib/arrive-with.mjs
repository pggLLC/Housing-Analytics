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

// Since 2026-11-14 (redirect group A and county costs) 16 more old pages forward, and since 2026-11-15 groups B and C
// to the hub view that now holds them (js/path-resolver.js MOVED_PAGES). The pages
// stay in the repo and ?classic=1 still shows each as written, so audits keep
// measuring them there; the hub pages are audited on their own.
const MOVED_AS_WRITTEN = '?classic=1';

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
  'colorado-elections.html':             MOVED_AS_WRITTEN,
  'commuting.html':                      MOVED_AS_WRITTEN,
  'compare.html':                        MOVED_AS_WRITTEN,
  'construction-commodities.html':       MOVED_AS_WRITTEN,
  'article-pricing.html':                MOVED_AS_WRITTEN,
  'land-value.html':                     MOVED_AS_WRITTEN,
  'deal-summary.html':                   MOVED_AS_WRITTEN,
  'preservation.html':                   MOVED_AS_WRITTEN,
  'hna-scenario-builder.html':           MOVED_AS_WRITTEN,
  'recommendation.html':                 MOVED_AS_WRITTEN,
  'select-jurisdiction.html':            MOVED_AS_WRITTEN,
  'local-incentives.html':               MOVED_AS_WRITTEN,
  'policy-briefs.html':                  MOVED_AS_WRITTEN,
  'data-status.html':                    MOVED_AS_WRITTEN,
  'data-map-browser.html':               MOVED_AS_WRITTEN,
  'article-co-housing-costs.html':       MOVED_AS_WRITTEN,
  // Groups B and C (15 Nov 2026). The needs assessment pages below open statewide (?geoid=08), which stays as written.
  'census-dashboard.html':               MOVED_AS_WRITTEN,
  'chfa-portfolio.html':                 MOVED_AS_WRITTEN,
  'colorado-deep-dive.html':             MOVED_AS_WRITTEN,
  'economic-dashboard.html':             MOVED_AS_WRITTEN,
  'hna-comparative-analysis.html':       MOVED_AS_WRITTEN,
  'insights.html':                       MOVED_AS_WRITTEN,
  'housing-legislation-2026.html':       MOVED_AS_WRITTEN,
  'land-banking-awards.html':            MOVED_AS_WRITTEN,
  'pipeline.html':                       MOVED_AS_WRITTEN,
  'data-explorer.html':                  MOVED_AS_WRITTEN,
  'dashboard-data-quality.html':         MOVED_AS_WRITTEN,
  'dashboard-data-sources-ui.html':      MOVED_AS_WRITTEN,
  'data-review-hub.html':                MOVED_AS_WRITTEN,
  'ic-summary.html':                     MOVED_AS_WRITTEN,
  'where-housing-money-goes.html':       MOVED_AS_WRITTEN,
  'housing-needs-assessment.html':       HNA_STATEWIDE,
  'hna-what-housing-exists.html':        HNA_STATEWIDE,
  'hna-who-lives-here.html':             HNA_STATEWIDE,
  'hna-what-households-can-afford.html': HNA_STATEWIDE,
  'hna-where-its-heading.html':          HNA_STATEWIDE,
  'hna-what-to-do.html':                 HNA_STATEWIDE,
});

// "page.html", "page.html#tab" or "/page.html" -> the same with the query
// inserted before any hash.
// An address that already has a query (a place: ?geoid=...) forwards with it, so a page on the list above gets
// &classic=1 added and is still measured as written.
export function arriveUrl(pagePath) {
  const hash = pagePath.indexOf('#');
  const file = hash < 0 ? pagePath : pagePath.slice(0, hash);
  const rest = hash < 0 ? '' : pagePath.slice(hash);
  const q = file.indexOf('?');
  if (q >= 0) {
    const listed = ARRIVE_WITH[file.slice(0, q).replace(/^\//, '')];
    return listed && !/[?&]classic=1(?:&|$)/.test(file) ? file + '&classic=1' + rest : pagePath;
  }
  const query = ARRIVE_WITH[file.replace(/^\//, '')] || '';
  return file + query + rest;
}
