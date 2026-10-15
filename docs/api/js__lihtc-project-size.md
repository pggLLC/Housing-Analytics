# `js/lihtc-project-size.js`

js/lihtc-project-size.js

The Project Size panel of the Historical Trends tab
(colorado-deep-dive.html#tab-history): how many units Colorado LIHTC
projects have, by award period, credit type, size band and county.

Source: data/chfa-lihtc.json (CHFA HousingTaxCreditProperties_view), the
same feed as the other Historical Trends panels. Years are CHFA award
(credit reservation) years, not opening years. A project whose unit count
is missing is excluded and counted in the disclosure, never treated as 0.

Exposes window.LihtcProjectSize.render() (the page calls it once, on the
tab's first reveal) and .compute(features) for tests.

_No documented symbols — module has a file-header comment only._
