# `js/components/soft-funding-breakdown.js`

js/components/soft-funding-breakdown.js
Renders eligible soft-funding programs below the Sources & Uses gap line
on the Deal Calculator page.

Shows:
  - All eligible programs for the selected county + execution type (9%/4%)
  - Per-program: available $, max per project, deadline, competitiveness
  - PAB volume cap warning for 4% deals
  - Total theoretical soft-funding capacity vs the gap

Depends on: js/soft-funding-tracker.js (must load first)
Mount: renders into #dcSoftFundingBreakdown (created dynamically)

_No documented symbols — module has a file-header comment only._
