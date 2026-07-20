# `scripts/audit/runtime-contrast-scanner.mjs`

F128 — Runtime contrast scanner. Uses Puppeteer to load every HTML
page in both light AND dark mode, walks every visible text node, and
fails if any rendered foreground/background pair scores below WCAG AA
(4.5:1 normal text, 3.0:1 large text).

THIS IS THE GATE THE PROJECT SHOULD HAVE HAD FROM THE START.

Why static gates aren't enough:
  - test:pill-contrast only checks predefined badge classes
  - test:inline-contrast only catches specific source patterns
  - Real bugs come from CASCADE — a perfectly-valid CSS rule gets
    a hardcoded color from a 3rd-party stylesheet (Leaflet, etc.) or
    the `strong { color: !important }` rule paints the wrong text on
    a class-set bg. Source-pattern gates can't see the rendered
    contrast.

Usage:
  npm run test:runtime-contrast              # all pages, both modes
  npm run test:runtime-contrast -- index     # one page
  npm run test:runtime-contrast -- --light   # only light mode

The scanner is also exported as window.__contrastScan() — paste it
into any preview/devtools console to get a snapshot for the page
currently loaded.

_No documented symbols — module has a file-header comment only._
