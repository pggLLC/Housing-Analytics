# `js/components/chart-theme.js`

chart-theme.js  (F19, 2026-05-27)

Site-wide Chart.js default theming. Sets Chart.defaults.color (axis
labels, tooltip text, legend text), .borderColor (grid lines), and
.scales.*.ticks/.title colors from the site's CSS tokens so charts
read correctly in BOTH light + dark modes.

Without this, Chart.js uses its defaults (#666 text, #ddd grid lines)
which fail WCAG AA contrast on the dark-mode background. Several
pages — HNA, Historical Trends, CHFA Portfolio, Policy Simulator —
have multi-chart dashboards where axis labels become unreadable
black-on-dark.

How it works:
  1. Reads CSS custom properties at runtime: --text, --muted,
     --border, --card. These vary by theme (prefers-color-scheme +
     manual .dark-mode toggle).
  2. Sets Chart.defaults — applies to all charts created AFTER this
     file loads.
  3. Listens for theme changes (matchMedia + click on .dark-mode-toggle)
     and re-applies + tells existing charts to re-render.

Loaded by all pages that include Chart.js. Defer order:
  <script defer src="js/vendor/chart.js"></script>
  <script defer src="js/components/chart-theme.js"></script>
  <script defer src="js/your-chart-page.js"></script>

_No documented symbols — module has a file-header comment only._
