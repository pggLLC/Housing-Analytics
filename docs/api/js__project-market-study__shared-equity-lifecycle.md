# `js/project-market-study/shared-equity-lifecycle.js`

Shared-equity lifecycle scenario engine.

Pure computation for the Tier-2 project layer. All time-varying values are
modeled scenario paths, not predictions. Resale-formula restrictions,
public subsidy treatment, subordinate debt, and land/tenure terms remain
separate inputs; this module does not bundle them into product rankings.

Annual conventions: market, AMI, CPI, HOA, and ground-rent growth compound
once per year. Mortgage and amortizing-debt payments compound monthly.
Deferred subordinate interest is simple annual interest. Improvement cash
flows occur at their stated integer year for the owner-return calculation.

_No documented symbols — module has a file-header comment only._
