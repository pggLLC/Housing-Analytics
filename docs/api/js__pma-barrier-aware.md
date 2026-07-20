# `js/pma-barrier-aware.js`

js/pma-barrier-aware.js
Default-off C2 barrier-aware PMA downweight helper.

C2 contract: this module never changes shipped PMA behavior unless the
explicit flag is enabled. When enabled it downweights tract buffer shares
for crossed barriers; it never removes tracts and never zeroes weights.

_No documented symbols — module has a file-header comment only._
