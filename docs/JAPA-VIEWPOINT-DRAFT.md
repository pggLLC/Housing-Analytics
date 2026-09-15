# Planning Viewpoint — submission draft

**Target:** *Journal of the American Planning Association* (Taylor & Francis), Planning Viewpoint
**Limit:** 3,000 words main text, excluding abstract, references, notes and tables
**Review:** double-blind — the manuscript below is anonymized; identifying material goes on a separate title page

> **Before submitting, verify the current author guidelines yourself.** I could not retrieve
> `files.taylorandfrancis.com/rjpa-guidelines.pdf` (HTTP 403) or the T&F AI policy page (403). The
> abstract structure and word limits below come from secondary summaries and observed JAPA practice,
> not from the source document. Check the abstract headings, the 300-word abstract cap, the keyword
> count, and the required AI-disclosure wording against the real guidelines before you submit.

---

## Title page (separate file — not for reviewers)

**Title:** The Coerced Zero: Why Housing Data Systems Should Publish Their Ignorance

**Author:** Paul Glasgow, pggLLC

**Acknowledgment of AI use:** See the disclosure statement below. It is reproduced on the title page
and, in anonymized form, in the manuscript.

---

## Abstract

*(Structured per JAPA practice. Cap is 300 words including headings.)*

**Problem, research strategy, and findings.** Housing needs assessments routinely render an
unmeasured quantity as a zero. In most software this is a rendering defect; in housing analysis it
is a claim that a place has no need, and it is indistinguishable from a measured zero once
published. I report on a continuously rebuilt public dataset covering 546 Colorado
geographies whose organizing design rule is that an unmeasurable quantity is null, never zero. The rule was adopted after the defect recurred five times, including $0 resale prices
displayed for 53 of 482 places. Enforcing it required place-level rather than county-level
resolution, because a coerced zero is undetectable at a geography where some component is always
nonzero. The consequence is substantive rather than technical. In one worked jurisdiction, severe
cost burden below 80% of area median income falls on owners rather than renters by roughly five to
one — 113 owner households against 22 renter households — a finding a renter-led assessment would
not produce and county-level data cannot resolve. Cost burden and unit deficit also diverge at the same income band, licensing different
interventions: preservation where units exist, production where they do not. I argue that the discipline of publishing absence,
not the volume of data published, is what makes such a system actionable.

**Takeaway for practice.** Planners should read the tenure split before the headline need figure,
treat any zero as a claim requiring a stated source, and separate cost burden from unit gap rather
than merging them into a single "units needed." A zero substituted for an unknown does not merely
misinform; it misallocates program dollars to the wrong income band, the wrong tenure, and the wrong
timeline.

**Keywords:** housing needs assessment; data infrastructure; cost burden; tenure; missing data;
open data

---

## Main text

*(Target ≤3,000 words. Current count is noted at the end. Section headings are working headings.)*

### The zero that is not a measurement

A housing needs assessment for a small town arrives with a table of income bands. One row reads
zero. The planner reading it concludes there is no need in that band and allocates accordingly.

Sometimes that conclusion is right. Often the zero means the source did not publish a figure at that
geography, or the sample was suppressed for disclosure control, or an upstream join failed silently.
Once the table is printed, those cases are indistinguishable. The reader cannot tell a measured
absence of need from an absence of measurement, and nothing downstream can recover the difference.

This Viewpoint argues that the distinction is the central design problem in housing data
infrastructure — more consequential than coverage, resolution, or currency — and that a system's
willingness to publish "we do not know" is the best available proxy for whether its other numbers
can be trusted.

The claim is not that missingness is unstudied. It is among the most developed areas in applied
statistics: Rubin's (1987) multiple imputation and the missing-completely-at-random / at-random /
not-at-random taxonomy formalized in Little and Rubin (2019) give a mature apparatus for reasoning
about absent values. Nor is the difficulty of small-area estimates news — the Fay–Herriot (1979)
model was built precisely to produce income estimates for areas under a thousand people, and Rao and
Molina (2015) survey four decades of borrowing strength across areas to get them.

What is missing is the step between that literature and the artifact a planner reads. Imputation
theory tells you how to estimate an absent value and how to propagate its uncertainty. It does not
tell you what a housing needs assessment should *print* in a cell it could not fill, and in practice
the answer has been a zero. This Viewpoint is about that last step, where the statistics stop and the
document starts.

The argument rests on seven months of building and maintaining a continuously rebuilt public dataset
covering 546 Colorado geographies: 64 counties, 272 incorporated places, and 210 census-designated
places. It is free, requires no account, and is maintained by one person without institutional
funding. Those constraints are not incidental. They determined which failures were survivable and
which had to be designed out, and a project with staff could have made different choices.

### Why zero is the default, and why that is not a bug in the data

The mechanism is mundane. In most programming languages the conversion of a null value to a number
yields zero, and zero is a finite number. A coercion two layers upstream of a chart therefore
produces a value that passes every downstream check for validity. The renderer receives a number. It
draws a number. Nothing is malformed.

This means the defect cannot be fixed at the display layer, which is where it is always noticed. A
renderer that correctly formats a null never sees the null, because the coercion happened before the
data reached it. The fix has to be a rule about where absence is permitted to be destroyed, enforced
continuously, or the defect returns — and in the system reported here it returned five times before
the rule was written down.

The five recurrences are worth listing because they are not exotic. An income band with no
households rendered as a band with zero households. Home equity displayed as $0 and as negative
$320,000 where the underlying value was missing. A Proposition 123 affordable-housing commitment
that had not been filed, displayed as a decision not to participate. A chart drawing a flat line
across a dead data series. And resale price and owner equity shown as $0 for 53 of 482 places —
roughly one place in nine, every one of them a jurisdiction whose planner might have read it.

Only the last was caught by a person noticing. The others were found by tests written after the
first one.

### The rule, and what enforcing it costs

The rule is one sentence: an unmeasurable quantity is null, never zero.

Three consequences follow, and each has a price. Possibly-null values that feed arithmetic or a
renderer may not be coerced, which means carrying nullability through layers that would otherwise be
simpler. Guards must test for values at or below zero rather than strictly below, because a price or
rent of exactly zero means unknown rather than free. And the *reason* for an absence must travel
with the data, which means every metric carries a source, a vintage, a geography level, and a
confidence alongside its value — roughly quadrupling the payload for a number that may not exist.

In the system reported here, 38 test files carrying 119 named assertions exist specifically to
enforce this. That is a substantial fraction of a one-person project's test surface spent on
defending the right to say nothing.

The return on that spend is that the other numbers become load-bearing. A place-level estimate is
worth having only if a place with no data renders differently from a place with no need. Without the
rule, higher resolution actively increases the number of cells that can be silently filled with a
false zero.

### The scale mismatch, and why it is a policy choice

Housing policy is made at municipal scale. Inclusionary ordinances, fee waivers, land contribution,
density bonuses, and deed restrictions are all municipal acts. Most published housing data crossing
cost burden with income band and tenure — in the United States, principally HUD's Comprehensive
Housing Affordability Strategy tables — is published at census tract level, and is most readily
aggregated to counties.

A county figure is rarely the figure a practitioner needs. Within a single Colorado county, severe
renter cost burden varies widely between municipalities, and the spread is precisely the actionable
content. The alternative approach, assigning each place its primary county's rates, fails
systematically where towns straddle county lines: a town half of whose tracts lie in a neighboring
county would inherit rates from a jurisdiction containing half its households.

The system reported here apportions tract-level data to places by areal weight, then anchors each
place's household total to the American Community Survey's occupied-unit count. The second step
matters more than it sounds. Areal weighting is geometrically sound and demographically optimistic:
population clusters in the built-up portion of a tract rather than spreading evenly across its area,
so summing across overlapping tracts overcounts households in roughly 31% of Colorado places. The
anchor corrects the level while preserving the rates — and the rate, not the count, is what a policy
is written against.

Choosing the place as the unit of analysis is a policy decision before it is a technical one.
Regional analysis is cheaper, more statistically stable, and matches how the data is published.
Place-level analysis accepts wider error bars in exchange for matching the scale at which decisions
actually happen. Reasonable analysts disagree, and the disagreement should be explicit rather than
settled by whichever geography the source happened to publish.

### What the resolution buys: an example

Consider a town of roughly 1,300 households, 433 renter and 864 owner, in a Western Slope county.

Below 80% of area median income, 228 renter households and 191 owner households are cost burdened —
a near-even split that a headline figure would report as roughly 419 burdened households and leave
there.

Severe burden tells a different story. Below the same threshold, 113 owner households pay more than
half their income for housing, against 22 renter households. Roughly five to one, in the opposite
direction from the headline.

A conventional assessment leading with renter cost burden and rental production would direct the
entire program at the smaller population. The instruments differ completely: owner-occupied
rehabilitation, weatherization, and property-tax relief reach severely burdened owners; neither new
rental construction nor rental assistance does.

The second divergence is between burden and shortage. At 31–50% of area median income in this town,
96 of 97 renter households are cost burdened while the measured unit deficit at that band is zero.
Both statements are true and they describe different problems. The units exist; they are occupied by
households who cannot afford them. That is an allocation problem, addressable by acquisition with
deed restriction or project-based subsidy on existing buildings, on a horizon of months to a year
and a half. At the deepest band the deficit is real, and closing it requires new construction,
competitive credit, and three to five years.

Sequenced by the data rather than by the default, the program reaches 113 households within a year
and reserves the slow, expensive instrument for the one band that requires it. Same total need,
different order, materially different time to relief.

This matters for the argument because the finding is only derivable if burden and gap are kept as
separate published quantities. Most assessments report a single "units needed" figure, which merges
them. The merge is where the information is lost.

### The counter-arguments, taken seriously

**Higher resolution has wider error bars.** True, and the objection is the strongest one. This is the
bias–variance trade-off at the center of small-area estimation (Rao & Molina, 2015): direct
estimators for small domains have standard errors too large to use, and model-based estimators buy
precision by importing structure from elsewhere — which is a different error, not less of it.
Apportioned place-level estimates carry more uncertainty than the county aggregates they derive from,
and the weighting assumption is poorest exactly where a tract barely overlaps a municipality. The
response is not that the error is small. It is that a wide interval at the decision scale is more
useful than a narrow interval at a scale where no instrument operates — provided the interval is
published. That proviso is the whole argument, and a system that resolves to places without marking
confidence is worse than one that does not resolve at all.

**Publishing absence is worse for the user.** A dashboard full of "not published" is harder to act on
than one full of numbers, and the open-government-data literature reports persistently low
utilization traced to a gap between what portals publish and what users need. That literature also
complicates the objection in a useful way: studies of trust in open government data find perceived
*service* quality a stronger driver of citizen trust than perceived *data* quality, and metadata
documentation a material contributor to both. If how a dataset explains itself matters more to trust
than the numbers in it, then marking absence is not a tax on usability — it is part of the thing
users are actually evaluating. The alternative, in any case, is not a usable dashboard but a
confidently wrong one. Between omitting the row, substituting a default, and publishing the absence,
only the third leaves the reader correctly informed. The first makes a covered place look uncovered;
the second is the coerced zero.

**Imputation is a solved problem.** Multiple imputation (Rubin, 1987) is well developed and the
objection has force where the missingness mechanism is understood and modelable. Much of the
missingness here is not of that kind. It is disclosure suppression, source discontinuation, and join
failure — three mechanisms with no shared model, at least two of which are emphatically not missing
at random. Census disclosure avoidance is the clearest case: the 2020 Decennial applied
zero-concentrated differential privacy with noise deliberately scaled *larger for small counts*
(U.S. Census Bureau, 2019), which is to say the error is greatest exactly at the geographies this
system exists to serve, and is a known function of the published value rather than a random
perturbation of it. Imputing through that is not filling a gap; it is modeling a privacy mechanism.
Where a value is imputed it should be labeled as imputed — the same discipline, applied differently,
rather than an alternative to it.

**This is a software-engineering concern, not a planning one.** It becomes a planning concern at the
point where a program is sized. A zero substituted for an unknown does not merely misinform; it
misallocates. Every dollar committed on a coerced zero is committed to the wrong income band, the
wrong tenure, and the wrong timeline, and the error is invisible in the document that justified it.

### What this does not solve

The binding constraint on the system reported here is not analysis but cost data. It can size need
to the household and cannot cost it at all. No validated Colorado cost-per-unit figures exist in it
for new construction, acquisition-rehabilitation, or owner-occupied repair, which is why the
sequencing above attaches horizons and no budget. Inventing those figures would violate the rule the
system is built on. Assembling them from credit allocations, state program awards, and completed
project cost certifications is a tractable public-data project and, on the evidence here, the
highest-return one available.

The approach is also single-state and single-maintainer. The methods generalize; the data wiring
does not, and no second state has been attempted. Uneven vintage across sources remains a real
limitation: each metric carries its own reference date, which is the right design, but a reader
comparing two metrics is comparing two vintages.

### Conclusion

The proposition is narrow and, I think, uncomfortable. A housing data system earns its keep not by
how much it publishes but by how reliably it refuses to publish what it cannot support.

That is an unattractive thing to claim. It makes a system look less capable, its dashboards
patchier, and its coverage maps worse. It is also the only property that makes the rest of the
output actionable rather than merely available — because a planner who cannot tell which zeros are
measurements cannot act on any of them.

---

## Disclosure of AI use

*(Required by most publishers; verify T&F's current required wording. Anonymized for review — the
identified version belongs on the title page.)*

This work was produced with substantial assistance from AI coding tools over approximately nine
months. The author directed the work, made all analytical and policy decisions, and is responsible
for all content; AI was used for implementation, testing, and drafting. No AI system is an author.

The energy cost is disclosed on the same terms the project applies to housing data. Continuous
integration has run approximately 40,000 jobs, about 1,509 runner-hours. Model inference across the
surviving session transcripts — a partial window of roughly a third of the project, with the
heaviest months missing — comes to 71,384 turns generating 68.1 million output tokens.

Converting turns to energy is where the accounting stops being measurement. Published per-query
figures span a factor of roughly 140, from 0.24 Wh for a short prompt on optimized serving to 33.6
Wh for a reasoning model on a long prompt (Jegham et al., 2025). Applied to the measured window,
that yields 17 to 2,399 kWh, or roughly 7 to 936 kg CO₂e at US average grid intensity. Agentic
coding turns carry longer context than the high-end benchmark, so neither end is a firm bound. No
midpoint is offered: averaging a disagreement of that magnitude into a single figure would
manufacture a precision the evidence does not support, which is the error this paper is about.

No net-benefit claim is made. Setting this cost against the travel and staff time of the consultant
studies the system substitutes for would be self-serving and has not been measured.

---

## Notes

1. Figures describing the system are regenerated from the repository by a build script rather than
   transcribed, and a continuous-integration check fails if the published document and the
   underlying data disagree. Two errors in an earlier draft were caught this way: a test-file count
   inflated by a double-matching file glob, and an absence-handling count produced by a keyword scan
   that matched files mentioning missing data only in passing.

2. The worked jurisdiction is Palisade, Mesa County (GEOID 0856970). It is named in the published
   version; the anonymized manuscript describes it generically to avoid identifying the author
   through the project.

3. Household counts from apportioned CHAS data are fractional before rounding; figures here are
   rounded households and column sums are computed from the rounded values, so they are internally
   consistent.

---

## References

*(Author-date. **Verification status is marked on every entry** — publisher pages returned HTTP 403
to automated retrieval, so page ranges and some volume numbers could not be confirmed and are marked
rather than guessed. Complete them from the library before submission; do not submit an entry still
carrying a bracketed gap.)*

**Missing data and imputation**

- Rubin, D. B. (1987). *Multiple Imputation for Nonresponse in Surveys.* Wiley. ✓ author/year/title verified
- Little, R. J. A., & Rubin, D. B. (2019). *Statistical Analysis with Missing Data* (3rd ed.). Wiley.
  ⚠ 2nd ed. 2002 confirmed; **verify whether to cite 2nd or 3rd edition** and fix the year accordingly

**Small-area estimation**

- Rao, J. N. K., & Molina, I. (2015). *Small Area Estimation* (2nd ed.). Wiley. ✓ verified
- Fay, R. E., & Herriot, R. A. (1979). An estimation method for small areas. *Journal of the American
  Statistical Association*. ⚠ model and its <1,000-population origin verified; **confirm exact title,
  volume 74, issue and pages**

**Census disclosure avoidance**

- U.S. Census Bureau. (2019). *Title 13, Differential Privacy, and the 2020 Decennial Census.*
  ✓ verified at census.gov
- *Harvard Data Science Review*, Special Issue 2: Differential Privacy for the 2020 U.S. Census.
  ⚠ issue exists and is verified; **pick the specific article you actually cite**

**Housing needs assessment methodology**

- [Author]. (1987). The Housing Needs Assessment Model. *Journal of the American Planning
  Association, 53*(2). ⚠ title, journal, volume and issue verified; **author name and pages still
  needed** — a JAPA-internal citation and worth getting right
- Meen, G. *Objectively Assessed Demand.* UK Collaborative Centre for Housing Evidence.
  ⚠ verified as a real paper; **confirm year and publication series**
- The "not full, not objective, not assessed" formulation is widely repeated in English planning
  commentary. ⚠ **trace it to its original speaker before quoting** — an unattributed bon mot in a
  peer-reviewed paper is worse than no quote
- Methodological weaknesses in housing affordability measurement — qualitative study, PMC6716639.
  ⚠ **retrieve full citation**

**Open data quality and trust**

- Citizens' Trust in Open Government Data. ACM Digital Library, 10.1145/3396956.3396958.
  ⚠ DOI verified; **authors/year/venue needed**
- Factors Influencing Public Trust in Open Government Data. *Sustainability*, 14(15), 9765.
  doi:10.3390/su14159765. ✓ verified
- Civic Trust and the Intention to Utilize Open Government Data: An Experiment. *dg.o 2024*,
  10.1145/3657054.3657183. ⚠ DOI verified; **authors needed**

**Data sources**

- U.S. Department of Housing and Urban Development. *Comprehensive Housing Affordability Strategy
  (CHAS).* ⚠ add vintage and access date
- U.S. Census Bureau. *American Community Survey 5-Year Estimates, 2020–2024.* ⚠ add tables cited
- Jegham, N., et al. (2025). *How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of
  LLM Inference.* arXiv:2505.09598. ✓ verified, figures read from the paper
- U.S. Environmental Protection Agency. *eGRID.* ⚠ add edition year
- U.S. Energy Information Administration. *Residential electricity consumption.* ⚠ add access date

## Word count

Main text: **2,209 words**, counted excluding the abstract, headings, notes, references, and this
section. Abstract: **277 words** against a 300 cap.

**791 words of headroom** remain under the 3,000 limit. The literature engagement is now written in
across five clusters — missing-data theory, small-area estimation, census disclosure avoidance,
housing-needs-assessment methodology, and open-data trust — and each of the four counter-arguments
now names work that holds the position it answers.

What the remaining headroom is for: the housing-needs-assessment cluster is still the weakest, and it
is the one a JAPA reviewer will know best. The 1987 JAPA model paper is cited from this journal's own
back catalogue and deserves a real engagement rather than a passing reference, and the English
"objectively assessed need" critique is imported from a different planning system and needs a
sentence justifying the transfer.

*(Two earlier versions of this section were wrong: one claimed ~2,340 words and a 246-word abstract,
another 1,825 and 255. The figures above are counted. Recorded rather than silently corrected, since
the manuscript's whole argument is that unverified numbers are the problem.)*
