# `js/components/settle-anchor.js`

js/components/settle-anchor.js
Keep a linked section in view while the page renders its data.

Housing News links to sections that sit below lists rendered after page
load (colorado-elections.html#people-and-roles, the policy watch on
housing-legislation-2026.html). The browser scrolls to the anchor at once,
then the lists above it arrive and push it off screen: measured 2026-09-28,
the officials section ended 9,117px below the top of the window a reader
had been sent to.

So after load, whenever the page's content changes, the target is scrolled
back to the top. It stops as soon as the reader scrolls, types, clicks or
touches, so it never fights a reader. SETTLE_MS is only a safety bound: it
must outlast the slowest fetch the destination pages allow (15 s, via
fetchWithTimeout), or a slow response lands after the observer has gone and
pushes the section away again. test/policy-watch-rail.test.mjs checks the
bound against those timeouts.

_No documented symbols — module has a file-header comment only._
