# `js/components/denver-income-limits.js`

denver-income-limits.js — fills the Denver income-limit table on
colorado-deep-dive.html from data/hud-fmr-income-limits.json.

The table used to be typed into the page: sixteen dollar figures labelled
"(2025)" that matched no HUD release (the 50% one-person limit read
$43,450; HUD FY2026 is $50,400). Every figure and the year now come from
the data file, so a HUD refresh updates the table with nothing to edit.
A figure the file does not carry stays "—"; nothing is estimated.

_No documented symbols — module has a file-header comment only._
