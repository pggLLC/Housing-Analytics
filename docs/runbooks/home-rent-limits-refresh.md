# HUD HOME rent limits refresh

HUD publishes the HOME Program Rent Limits once a year, usually effective
June 1, as one national workbook on
[HUD User](https://www.huduser.gov/portal/datasets/HOME-Rent-limits.html).
huduser.gov answers scripted requests with an empty HTTP 202, so the workbook
is downloaded in a browser.

1. On the HUD User page, download `HOME_Limits_Rents_<year>.xlsx` and the year's
   memo (`<year>-HOME-RentLimits-Memo.pdf`). Do not commit either file.
2. Read the effective date from the memo and add it to `EFFECTIVE_DATES` in
   `scripts/build_home_rent_limits_co.py`.
3. Install the workbook reader once (`python3 -m pip install openpyxl`; it is
   not in CI's Python setup), then run
   `python3 scripts/build_home_rent_limits_co.py <path to the workbook>`.
   It writes `data/hud-home-rent-limits-co-<year>.json` with all 64 counties
   and refuses to write a missing or zero limit.
4. Point `test/hud-home-rent-limits.test.js` at the new year and run
   `npm run test:hud-home-rent-limits`. It checks HUD's "lesser of" rules
   against every county, so a misread column fails it.
5. Keep the previous year's file while leases signed under it are still in
   force, and follow AGENTS.md for the manifest steps on any `data/` change.
