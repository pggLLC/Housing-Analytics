# `js/components/policy-watch.js`

js/components/policy-watch.js
Policy watch (data/policy/policy-watch.json), in two sizes.

The file is curated by hand: CHFA allocation-plan changes, ballot questions
and people in housing roles, each saying how it was checked. Until
2026-09-28 Housing News printed every entry in full in its right-hand
column: 19 entries of 56–103 words, each with its verification sentence,
5,448px of a 6,804px column beside about 3,050px of news. On a phone it
sat between "Latest" and "Earlier", so the rest of the headlines began
7,395px down. Thirteen of the entries (the people) were already listed in
full on colorado-elections.html.

So each entry now has one full home and the news rail only points to it:
  - summary(): one row per section with its count and newest check date,
    plus one row for the topics not yet covered, linked to the full view.
    Used by policy-briefs.html.
  - full(): every current entry with its detail, source and how it was
    checked, and every declared gap. Used by housing-legislation-2026.html
    for the sections that live there.
DESTINATIONS says where each section's full view is. Which entries count as
current follows colorado-elections.js (archived, or an election more than
45 days past, is not current), and test/policy-watch-rail.test.mjs fails if
a summary row's count differs from what its destination renders.

_No documented symbols — module has a file-header comment only._
