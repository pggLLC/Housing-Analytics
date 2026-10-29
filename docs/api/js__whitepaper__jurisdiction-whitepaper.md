# `js/whitepaper/jurisdiction-whitepaper.js`

jurisdiction-whitepaper.js — one shareable jurisdiction report (the white paper) per Colorado jurisdiction,
built from what the repo already holds about it.

buildModel(sources, geoid, opts) gathers the facts; renderHtml(model) writes a
self-contained, printable HTML document. Both are pure: the gated page
(developer-whitepaper.html) fetches the sources in the browser, and
scripts/whitepaper/build-whitepaper.mjs reads them from disk, so the two print the
same document.

Rules this module keeps:
 - An unmeasured value is null and renders as "Not available", never 0
   (AGENTS.md, "An unmeasurable quantity is null").
 - Every section names the file and vintage it came from.
 - The "ideal deal" is a shape (credit route, income mix, rent check, basis
   boost), not a pro forma: dollar sizing belongs to the Deal Calculator engine.
 - Contacts appear only from a researched contacts file that quotes its source;
   search-engine links are never shown as contacts.

Exposed as window.JurisdictionWhitepaper and module.exports.

_No documented symbols — module has a file-header comment only._
