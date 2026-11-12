# `js/whitepaper/member-place.js`

member-place.js — "Working on: <place>" on every member page.

paul, 2026-11-11: "You should always know which one you are on, have selected", with an easy switch.
Each member tool took a place its own way (?geoid=, ?place=, a filter box, or nothing), so moving from
one tool to the next lost the town. This keeps one picked place in the browser and shows it in a line
under the member menu, with three actions: open this page for that place, change it, clear it.

Rules:
  - The address wins. A page opened with a place in its address (?geoid=, or ?place= on Market screen)
    sets the picked place, so a shared link opens on the sender's town and the line says so.
  - Nothing moves on its own. The line offers "Open it here"; it never redirects a page.
  - The place is kept in this browser only (localStorage, the member site's own origin). No request
    carries it and nothing is saved on the server.
  - Names are drawn with textContent, never as HTML.

Loaded by developer-nav.js after it draws the menu, so every page with the member menu has it.
Lives in js/whitepaper/ because the gated bundle already copies that folder and the public build
already excludes it.

_No documented symbols — module has a file-header comment only._
