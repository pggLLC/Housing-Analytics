# `js/components/chfa-award-history.js`

js/components/chfa-award-history.js — F148
============================================
Renders a per-jurisdiction CHFA LIHTC award timeline showing every
reservation year + credit type + units. Pulls from properties.json
(deduped 5-source dataset). Useful IC-packet context: "what does
this market's LIHTC pipeline actually look like over time?"

Usage:
  ChfaAwardHistory.attach(container, {
    placeGeoid: '0830780',   // optional
    countyFips: '045',       // optional
    cityName:   'Glenwood Springs'  // fallback match by city
  });

_No documented symbols — module has a file-header comment only._
