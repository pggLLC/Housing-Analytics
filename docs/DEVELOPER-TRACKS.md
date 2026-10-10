# Developer tracks: LIHTC rental, middle-income rental, for-sale ownership

A developer comes to this site with one of three products in mind. The tools are
shared, but what each tool can answer depends on the product. This page says,
for each product, which pages apply, what they model, and what they do not.
It describes the site as it is on 2026-10-10; where a page and this file
disagree, the page is right and this file is stale.

| | LIHTC rental | Middle-income rental | For-sale ownership |
|---|---|---|---|
| Who it serves | Renters at 30–80% AMI | Renters at 80–120% AMI (140% in rural resort counties) | Buyers, usually 80–120% AMI |
| Main capital | Federal 9% or 4% credits, state AHTC, TOC credit | Colorado MIHTC (HB24-1316), Prop 123 | DPA, soft seconds, land held by a trust, subsidy per home |
| What keeps it affordable | Rent and income limits for 15+ years (usually 30+) | Rent and income limits for 15 years | Deed restriction or CLT ground lease, enforced at resale |
| Guided path support | Full: all 7 steps | **Partial**: need and screening only, no financing model | **Partial**: need, market study and deal screen; steps 2, 4 and 5 are rental-only |

## 1. LIHTC rental

This is the track the guided path (`js/components/workflow-progress.js` STEPS)
was built for.

| Step | Page | What it gives a LIHTC developer |
|---|---|---|
| 1 | `select-jurisdiction.html` | The place |
| 2 | `lihtc-opportunity-finder.html` | 9% and 4% opportunity ranking |
| 3 | `hna-what-housing-exists.html` and the other HNA pages | Need by AMI band, cost burden, projections |
| 4 | `market-analysis.html` | PMA, site scoring, QCT/DDA, LIHTC concept recommendation |
| 5 | `hna-scenario-builder.html` | Unit mix and AMI targeting against projected demand |
| 6 | `deal-calculator.html` (rental mode, the default) | Eligible basis, credits, equity, first mortgage, gap |
| 7 | `recommendation.html` | One screen with the conclusions |

Supporting pages: `lihtc-guide-for-stakeholders.html` (including the state AHTC
and TOC layer), `chfa-portfolio.html`, `article-pricing.html`,
`developer-where.html` (9% / 4% filters).

## 2. Middle-income rental (80–120% AMI)

Colorado's Middle Income Housing Tax Credit (MIHTC, HB24-1316, administered by
CHFA) and Prop 123 fund rental homes above the federal LIHTC limits. CHFA's
data already carries MIHTC deals (`data/chfa-lihtc.json`, `TypeOfCredits`
`MIHTC`).

What the site does today:

- **Need.** The housing-type need lanes (`js/components/housing-type-need.js`)
  have a "workforce rental" lane at **60–80% AMI**. There is no rental lane at
  80–120% AMI; that band appears only as "missing-middle ownership". So the HNA
  cannot say whether a place needs middle-income rental.
- **Where.** `developer-where.html` has "Workforce rental" and "Mixed-income"
  filters. `chfa-portfolio.html` filters MIHTC projects.
- **Financing.** The Deal Calculator shows 100%, 110% and 120% AMI as planning
  bands and excludes them from basis and credits (`js/deal-calculator.js`,
  `MIDDLE_INCOME_AMI_BANDS`). It does not size an MIHTC credit, so a deal that is
  all middle-income units shows no credit equity. The label "CHFA MIHTC/TOC" uses
  two acronyms the page does not expand.
- **Glossary.** `MIHTC` is defined in `data/glossary.json` and
  `js/components/inline-glossary.js`.

A middle-income rental developer can use steps 1, 3 and 4 as they are, but
should not read step 6's credit figures as describing their deal.

## 3. For-sale ownership

| Need | Page |
|---|---|
| Who can afford to buy, and what is missing | HNA ownership section (`#affordable-ownership-need-section` on `housing-needs-assessment.html` and `hna-what-to-do.html`) |
| Demand, capture, absorption, land structure, resale | `for-sale-market-study.html` (a screening, not a completed market study) |
| Subsidy gap per home, and what the public keeps at resale | `deal-calculator.html`, **ownership mode** (the "Deal Mode" toggle at the top of the calculator) |
| Land price and residual bid | `land-value.html` (serves both tracks) |
| Buyer assistance to discuss with buyers | `help-for-homebuyers.html` |
| Where | `developer-where.html`, "Attainable ownership" filter |

In the guided path, steps 2 (Opportunity Finder), 4 (Market Analysis) and 5
(Scenario Builder) are built for rental and say nothing about for-sale demand;
the for-sale market study is the ownership equivalent of step 4 but is not on
the rail. Step 7 does handle ownership: the recommendation contract has an
ownership conclusion, and finish-line criterion PC-2
(`test/ownership-rental-separation.test.js`) holds that an ownership project
never shows tax credits, eligible basis, NOI or LIHTC debt.

## Known gaps

These are recorded so nobody mistakes them for features. None is scheduled.

1. The nav's "For-Sale Feasibility" link opens the Deal Calculator in rental
   mode, because the calculator has no URL parameter for its mode.
2. There is no 80–120% AMI rental need lane and no MIHTC credit model.
3. The guided rail does not branch by product; an ownership project walks
   through three rental-only steps.
4. README described the Deal Calculator as LIHTC-only.
