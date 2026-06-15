# `js/components/subject-income-eligibility.js`

js/components/subject-income-eligibility.js
===============================================================
Income-eligibility table: per AMI tier × bedroom × household size,
shows the income BAND a renter must fall into to qualify for the
Subject's units.

  Max eligible income = HUD MTSP income limit (tier × HH size)
  Min eligible income = proposed_gross_rent × 12 ÷ 0.40
    (CHFA / NCHMA convention — rent burden ≤ 40% at the floor;
     i.e. a renter's annual income must be at least 2.5× their
     annual gross rent for them to "qualify down" without burden.)

Output is a grid grouped by bedroom, showing the income window
per AMI tier as $low – $high. Surfaces a warning when min > max
(impossible band — no eligible renters at that rent + AMI tier).

Mount target: any container with id="subjectIncomeEligibilityMount".

_No documented symbols — module has a file-header comment only._
