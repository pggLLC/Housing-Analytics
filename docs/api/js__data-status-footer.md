# `js/data-status-footer.js`

data-status-footer.js — COHO Analytics
Injects a "Data last updated" status bar beneath the page hero section
and adds source attribution below chart/table regions.

Usage: include <script src="js/data-status-footer.js"></script> and add
data attributes to configure the page:

  <body data-page-source="FRED · Federal Reserve Bank of St. Louis"
        data-page-update-key="fred">

Update keys map to sentinel timestamps in the data files:
  fred        → data/fred-data.json  → .updated
  lihtc       → data/chfa-lihtc.json → .fetchedAt
  manifest    → data/manifest.json   → .generated

A static fallback date can also be supplied:
  <body data-page-last-updated="2026-03-01">

_No documented symbols — module has a file-header comment only._
