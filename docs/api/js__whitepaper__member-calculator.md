# `js/whitepaper/member-calculator.js`

member-calculator.js — the member bar on the Deal Calculator, on the member
site only (js/navigation.js loadMemberCalculator loads it there, never on
cohoanalytics.com).

Shows who is signed in, links back to the member home, signs out, and saves
the deal on screen to the signed-in member's own deals (/api/deals,
coho-backend), where Deal workbook and Submittal review list it. The public
page's "Save to Project" keeps a copy in this browser only.

A save is the same version a Submittal review import of "Export JSON" makes
(SubmittalReview.fromCalculatorExport), plus the share link, so a 4% or
non-CHFA deal still opens in the workbook.

The save controls sit in a dock fixed to the bottom of the screen, with the
calculator's current funding gap, so they stay in view while the member works
down the page. A save with no gap warns first and says why there is none.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.MemberCalculator in the browser;
module.exports in Node.

_No documented symbols — module has a file-header comment only._
