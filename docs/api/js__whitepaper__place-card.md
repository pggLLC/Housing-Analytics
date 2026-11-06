# `js/whitepaper/place-card.js`

place-card.js — one card per place on the gated Jurisdiction Report: the
readiness reading, why the place is in the pipeline, the sites on file and
whether each is open to a new developer, the three people to call first, the
next step and the latest signals, with links to the dossier.

It only joins what the gated site already serves: the pipeline and network
files (PrivateWorkspace), the researched public contacts
(data/jurisdiction-briefs/_contacts/), and data/ripeness.json, which the
private backend builds at deploy time with each site's dossier card and its
developer check. None of those is in this repository, and nothing here
reaches the printed report.

"Call first" ranks every contact for the place, from both sources, by how well
the role fits the next step, then by whether a phone or email is on file, then
by whether you have talked before. Each pick says why.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.PlaceCard in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
