# `js/components/method-footer.js`

js/components/method-footer.js — F134
======================================
Shared "Source · Vintage · Method · Confidence" footer for any
analytic card on the site. Closes the most common scrutiny question
("where did this number come from?") inline, without forcing the
user into a separate methodology doc.

Usage:
  container.insertAdjacentHTML('beforeend', MethodFooter.html({
    source:    'CHFA LIHTC + HUD MF + USDA RD',
    sourceUrl: 'https://co.chfainfo.com/find-a-tax-credit-property',
    vintage:   '2026-06',
    method:    'Union of 4 sources, deduped by (name, city)',
    confidence:'high'        // 'high' | 'med' | 'low' (optional)
  }));

  // Multi-source variant — for cards drawing from several feeds:
  MethodFooter.html({
    sources: [
      { label: 'ACS 5-yr DP04', url: 'https://data.census.gov/...' },
      { label: 'HUD CHAS 2017-21', url: 'https://www.huduser.gov/portal/datasets/cp.html' }
    ],
    vintage: '2023 (5-yr) + 2017-21 (CHAS)',
    method:  'Area-weighted aggregation from tract → place',
    confidence: 'med'
  });

Conventions:
  - `confidence` semantics:
      high — directly from named source; calculation is verifiable + cited.
      med  — derived from named source via documented methodology with
             non-trivial assumptions (e.g. area weighting, scaling factors).
      low  — heuristic or sample-size sensitive (small-N ACS, single-year
             survey, scaled from larger geography without ground truth).
  - All fields optional except either `source` or `sources`.
  - The footer renders compactly (~30px tall) and is theme-aware.

_No documented symbols — module has a file-header comment only._
