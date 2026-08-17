# `js/pma-commute-shaped.js`

Commute-shaped PMA beta mode.

Default PMA behavior remains the circular buffer. This module is lazy-loaded
only after the user opts into the beta mode, and the mode is blocked rather
than silently degraded when its committed LODES inputs are unavailable.

_No documented symbols — module has a file-header comment only._
