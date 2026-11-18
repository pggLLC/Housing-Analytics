# data/jurisdiction-briefs/

Only the CHFA LIHTC applications ledger is here now:

- `_lihtc-applications.json`: every application in CHFA's public applicant reports, built by
  `scripts/funding/build_lihtc_applications.py` (`funding-awards.yml`). The public market data
  reads it: local players, development activity, project teams and the unfunded application points.
- `_lihtc-applications-excluded.json`: the rows that build leaves out, and why.

The jurisdiction briefs, their verification records, the next round watch and the brief news
queue moved to the private member site on 18 Nov 2026 (coho-backend `member/briefs/`), with the
member pages that show them. Edit briefs there, never here.
