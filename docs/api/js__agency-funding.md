# `js/agency-funding.js`

agency-funding.js — the agency funding view, on any page that holds
<div data-agency-funding><div data-agency-funding-view></div></div>.

Options on the data-agency-funding element, for a page that holds the view
inside a tab:
  data-agency-funding-hash="tab-need"  the tab's own hash stays first in the
                                       URL (#tab-need&county=08049)
  data-agency-funding-level="3"        the view's headings sit under the
                                       page's h2
  data-agency-funding-defer            nothing loads (about 1 MB) until the
                                       page calls AgencyFunding.start()

One set of controls (search, who paid, years, total or per resident) drives
four views of the same awards: the answer sentence, the county map, the
who-funded-whom matrix and the grouped, sortable table of every award. The
arithmetic lives in js/agency-funding-model.js so the tests can run it.

_No documented symbols — module has a file-header comment only._
