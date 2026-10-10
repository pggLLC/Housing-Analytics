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
| Guided path | The 7 steps as built | The LIHTC route; the Deal step does not size MIHTC | Own route: steps 2, 4 and 5 open the ownership tools |

## 1. LIHTC rental

This is the track the guided path (`js/components/workflow-progress.js` STEPS)
was built for, and the route a reader gets when they have not chosen a
product on `select-jurisdiction.html` ("What are you planning?").

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

- **Need.** The HNA's "What types of housing" ranking
  (`js/components/housing-type-need.js`) has a **middle-income rental** lane at
  80–120% AMI, next to the 60–80% workforce rental lane. CHAS does not separate
  renters at 100–120% AMI, so the lane reads the 81–100% cohort for the whole
  band and says so in its methodology.
- **Where.** `chfa-portfolio.html` filters MIHTC projects. (`developer-where.html`
  has "Workforce rental" and "Mixed-income" filters, but it is behind the
  developer gate.)
- **Financing.** The Deal Calculator shows 100%, 110% and 120% AMI as planning
  bands and excludes them from basis and credits (`js/deal-calculator.js`,
  `MIDDLE_INCOME_AMI_BANDS`), and says it does not size MIHTC credits. A deal
  that is all middle-income units therefore shows no credit equity.
- **Guided path.** The LIHTC route. The product chooser tells the reader the
  Deal step's credit figures are federal LIHTC only.
- **Glossary.** `MIHTC` is defined in `data/glossary.json` and
  `js/components/inline-glossary.js` (80–120% AMI; the HNA lane is held to the
  same band by `test/housing-type-need-middle-income.test.js`).

The state Transit-Oriented Communities (TOC) credit is not a middle-income
program: CHFA targets it at 30–80% AMI, like LIHTC.

## 3. For-sale ownership

| Need | Page |
|---|---|
| Who can afford to buy, and what is missing | HNA ownership section (`#affordable-ownership-need-section` on `housing-needs-assessment.html` and `hna-what-to-do.html`) |
| Demand, capture, absorption, land structure, resale | `for-sale-market-study.html` (a screening, not a completed market study) |
| Subsidy gap per home, and what the public keeps at resale | `deal-calculator.html`, **ownership mode** (the "Deal Mode" toggle at the top of the calculator) |
| Land price and residual bid | `land-value.html` (serves both tracks) |
| Buyer assistance to discuss with buyers | `help-for-homebuyers.html` |
| Where | `developer-where.html`, "Attainable ownership" filter |

When the reader chooses "For-sale ownership" on `select-jurisdiction.html`, the
guided path swaps its three rental-only steps for the ownership tools:

| Step | LIHTC route | For-sale route |
|---|---|---|
| 2 | Opportunity Finder | Ownership Need |
| 4 | Market Analysis | For-Sale Market Study |
| 5 | Scenario Builder | Land Value |

Step numbers and keys stay the same, so saved projects and step completion
keep working (`test/guided-path-product-routes.test.js`). The Deal step opens
the calculator in rental mode; the reader switches it to ownership mode. Step 7
handles ownership: the recommendation contract has an
ownership conclusion, and finish-line criterion PC-2
(`test/ownership-rental-separation.test.js`) holds that an ownership project
never shows tax credits, eligible basis, NOI or LIHTC debt.

## Known gaps

These are recorded so nobody mistakes them for features.

1. The nav's "For-Sale Feasibility" link, and the for-sale route's Deal step,
   open the Deal Calculator in rental mode, because the calculator has no URL
   parameter for its mode. Planned after Deal Calculator package P1 (#2121).
2. There is no MIHTC credit model. Planned as a later package of the Deal
   Calculator remediation plan.
