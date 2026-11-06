# `js/components/next-action-cta.js`

js/components/next-action-cta.js

Renders a "Next" block at the end of each core analytical page of the
deal-targeting workflow:

  Opportunity Finder   →   Find a market
  Housing Needs Asmt.  →   Browse need data per jurisdiction
  Market Analysis      →   Run a PMA workup for a site
  Deal Calculator      →   Build a deal concept + capital stack

One primary link goes to the next step on the 1-7 path; the other core
pages follow as plain "also for this place" links. When a jurisdiction is in scope
(via URL ?fips= param, WorkflowState, or SiteState) the URLs include
?fips=…&geoType=… so the destination page auto-loads it.

Usage from a page:
  <script src="js/components/next-action-cta.js" defer></script>
  <div id="next-action-cta-mount"></div>

Or auto-mount at the bottom of <main>:
  <script src="js/components/next-action-cta.js" defer
          data-next-action-auto="true"
          data-from-page="hna"></script>

data-from-page values: 'hna' | 'of' | 'pma' | 'deal'

(c) COHO Analytics

_No documented symbols — module has a file-header comment only._
