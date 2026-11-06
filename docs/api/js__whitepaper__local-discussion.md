# `js/whitepaper/local-discussion.js`

local-discussion.js — the "Local discussion" panel on the gated place card.

When a developer marks a place "Planning to submit", the private backend's
weekly read collects that town's council and commission agendas, packets,
minutes and local news, keeps the housing sentences word for word with date
and link, counts the housing words by quarter, and lists the dates and pages
to check where a portal cannot be read. This panel shows that result:
up to four key numbers, what they mean and the next step first, the rest folded.

It reads only what the gated site serves: api/watch (the marked places),
api/discussion?geoid= (the weekly result and pasted links), and the copy the
last deploy carried, data/local-discussion/<geoid>.json. None of that is in
this repository: the quotes name officials, so the data stays private.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.LocalDiscussion in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
