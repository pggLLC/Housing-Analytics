# `scripts/audit/chart-axes-audit.mjs`

chart-axes-audit.mjs — every rendered chart has readable axes.

The daily audit reads HTML as text and never renders a page, and
chart-population-audit.mjs only checks that ~20 named HNA canvases hold
data. Neither looks at whether a chart can be read. On 2026-10-09 the
LIHTC Equity Pricing History chart on article-pricing.html shipped with no
axes at all, and once it had them, a glossary tooltip spliced into an SVG
<text> blanked its x-axis title. Both are only visible after rendering.

Opens every top-level page in headless Chromium, lets its renderers
settle, and checks every chart that actually painted:

  Chart.js (Chart.instances) — every cartesian chart shows an x scale and
    a y scale, each with at least two tick labels. Pie, doughnut, polar
    area and radar charts have no x/y axes and are skipped by type.
  SVG charts — any <svg role="img"> at least 200px wide inside a
    .chart-card, or any <svg data-chart>, must carry
    <g data-axis="x"> and <g data-axis="y">, each with at least two
    [data-tick] labels.
  Blank labels — any SVG <text> with text content but no rendered box
    (an HTML element inside SVG text renders nothing).
  Legends — two entries with different labels whose swatches are the same
    color and dash, in a Chart.js legend or in any HTML legend (a class
    naming "legend", one small colored swatch per entry), fail. So does a
    Chart.js legend entry whose color the canvas cannot draw. On
    2026-10-11 every policy event under the economic-dashboard.html charts
    shared one indigo, and three map-marker categories shared one amber.

A failure listed in chart-axes-known-gaps.json (page, chart AND problem,
so a new defect on a listed chart is not hidden by the old entry) is
reported as known; anything else fails the run. The list must stay
exact: an entry that no longer fails is reported as stale and also fails,
so a fixed chart comes off the list in the PR that fixes it.

Coverage: chart-axes-coverage.json records how many charts each page
painted when the floor was set. A page that checks fewer fails, so a
renderer that stops painting a page's charts cannot pass as "0 charts".
After adding or removing charts on purpose, refresh it with
`npm run audit:chart-axes -- --write-coverage` and commit the file.

Local:
  npx http-server . -p 8080 --silent &
  npm run audit:chart-axes
Env: AUDIT_BASE_URL (default http://127.0.0.1:8080), AUDIT_PAGES
(comma-separated page list, for a quick run), AUDIT_SETTLE_MS.

_No documented symbols — module has a file-header comment only._
