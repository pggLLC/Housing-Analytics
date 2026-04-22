# `js/colorado-deep-dive.js`

colorado-deep-dive.js — Page controller for colorado-deep-dive.html

Responsibilities:
 - Tab switching with ARIA state management + keyboard navigation
 - Hash-based deep linking (#tab-ami-gap, #tab-market-trends, etc.)
 - Lazy-loading per-panel init (modules only boot when their tab opens)
 - localStorage caching utility with TTL
 - Error handling: one panel failing never crashes others
 - Data-loading status indicators

_No documented symbols — module has a file-header comment only._
