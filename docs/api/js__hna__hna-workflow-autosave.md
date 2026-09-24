# `js/hna/hna-workflow-autosave.js`

hna-workflow-autosave.js — the Housing Needs Assessment counts as done once
it has been read, not once a button has been pressed.

WorkflowState marks the 'hsa' step complete only when the page's snapshot is
saved (housing-needs-assessment.html: saveHnaToProject), and until 2026-09-23
the only thing that saved it was the "Save to project" button. A reader who
opened the HNA for a jurisdiction, read it, and followed the page's own
"Next step → Deal Calculator" link was then told on the calculator: "Earlier
Step Incomplete — Housing Needs Assessment hasn't been completed yet. Go to
Housing Needs Assessment." Verified on production for Fruita, following the
HNA's own link. The jurisdiction step already auto-completes from the URL
context and the Opportunity Finder is treated as always complete; this
gives the HNA the same courtesy, on evidence: the headline stats have
rendered real values for the selected geography.

Saves once per geography (the pill text), again if the geography changes,
and on click of any next-step link if the stats are ready — so the save
lands before navigation even if the observer has not fired yet.

No DOM assumptions beyond ids: init({ save, document, statIds }) is what the
test drives.

_No documented symbols — module has a file-header comment only._
