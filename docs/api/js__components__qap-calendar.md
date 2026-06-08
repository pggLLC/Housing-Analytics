# `js/components/qap-calendar.js`

js/components/qap-calendar.js — F143
=====================================
Renders the CHFA QAP cycle calendar with a prominent "next deadline"
countdown + timeline of upcoming rounds. The single most-asked
question on any LIHTC deal is "when's the next round closing?" —
this answers it inline without forcing a CHFA-website lookup.

Usage:
  QapCalendar.attach(container, {
    compact: true,            // small variant for OF detail / IC packet
    showRolling: true         // include 4% / MIHTC / Prop 123 rolling programs
  });

Renders:
  - "Next deadline" callout — days-until + linked event details
  - Timeline list of upcoming events (deadlines, awards, comment periods)
  - Rolling-program summary (4% PAB, MIHTC, State, Prop 123)
  - Methodology footer citing source + vintage + confidence

_No documented symbols — module has a file-header comment only._
