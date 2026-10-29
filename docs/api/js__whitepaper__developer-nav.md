# `js/whitepaper/developer-nav.js`

developer-nav.js — the one menu for every gated developer page.

Each page carries an empty <nav id="devNav" class="ib-section-nav"> and this
script fills it, so the pages cannot drift apart again (2026-10-14: five pages
had four different menus). test/jurisdiction-whitepaper.test.mjs fails on a gated page
that writes its own links.

Lives in js/whitepaper/ because the gated bundle already copies that folder and
the public build already excludes it.

_No documented symbols — module has a file-header comment only._
