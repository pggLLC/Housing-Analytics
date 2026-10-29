# `js/co-developer-funding.js`

co-developer-funding.js — Developer Funding tab on colorado-deep-dive.html.

Two data files:
  data/policy/co-developer-funding-guide.json — the curated program guide.
    Every term on it carries the official page it came from and the date it
    was checked; a term the official page does not publish is null with a
    reason, and renders as "Not published", never as a guess.
  data/chfa-income-rent-limits-2026.json — CHFA's income and rent limits,
    the AMI quick reference. The guide names this file in meta so the tab
    and the guide always cite the same limits.

The project finder ("Find programs for my project") filters the cards with
js/funding-fit.js, the same matcher the Opportunity Finder and Compare use.
Its choices live in the URL (?exec=4%25&type=…&county=08077&open=1#tab-funding),
so another page can open the tab already filtered, and ?program=<id> opens
one program's card.

_No documented symbols — module has a file-header comment only._
