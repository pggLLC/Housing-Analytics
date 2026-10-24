Please use the prompt below for a deep usability and decision-usefulness review aimed at housing practitioners new to COHO. Walkthrough readiness remains the priority: preserve what works, reuse existing evidence and coordinate with Codex so work isn’t duplicated.

News and email integration is **open for review, not automatically deferred**. Assess its value and timing without connecting accounts or implementing anything yet.

Start with an assessment only: identify walkthrough blockers and recommend the next three to five focused improvements for my approval.

---

# COHO Analytics: iterative usability and decision-usefulness review

Prepared for Claude — October 20, 2026.

## Priority instructions

- **Intended audience:** people working in or seriously interested in affordable housing—planners, developers, housing finance professionals, government staff, nonprofits and informed advocates. They may understand their own field but be unfamiliar with COHO or other parts of Colorado’s housing process. Help them understand those connections without oversimplifying them. Do not design around the assumption that every user is a novice to housing or finance.
- **Walkthrough readiness comes first:** identify what must be reliable and understandable before using practitioners’ time. Preserve what works and improve the existing product through focused rounds, rather than another broad reorganization.
- **Do not duplicate Codex’s work:** first check existing assessments, implementation work, tests, screenshots and rehearsal evidence. Coordinate ownership before proposing overlapping work. Distinguish completed fixes, work in progress and newly discovered problems.
- **This first round is investigation and reporting only.** Do not change application code, connect accounts, start ingestion jobs, merge or deploy.
- **News and email integration is an open priority decision.** The owner is reconsidering its deferral. Evaluate its usefulness and appropriate timing; do not automatically exclude it or assume implementation has been authorized.

## Review assignment

Conduct a deep usability and decision-usefulness review of COHO Analytics. I want to refine the site through several focused rounds, preserving what works and avoiding another broad reorganization.

### 1. Establish what you are evaluating

- Read `AGENTS.md`, the finish-line criteria, walkthrough guidance and the latest readiness assessment.
- Identify the deployed version and any differences from current main. Record the public and gated versions separately when necessary.
- Check what Claude and Codex already have underway. Reuse existing evidence and distinguish completed fixes, work in progress and newly discovered problems.
- Evaluate the functioning product and relevant implementation—not just open PRs or test results.
- Where older audience guidance conflicts with the intended audience above, identify the conflict and use the owner’s audience definition for this review.

### 2. Walk the site as a practitioner trying to make decisions

Use the seven-step guided journey, including its optional Opportunity Finder step:

1. Select jurisdiction.
2. LIHTC Opportunity Finder.
3. HNA: What housing exists.
4. Market Analysis.
5. HNA Scenario Builder.
6. Deal Calculator.
7. Recommendation.

The route follows the product chosen at step 1, so walk each one:

- **LIHTC rental** and **Middle-income rental:** the seven steps above.
- **For-sale ownership:** steps 2, 4, 5 and 6 open the ownership tools instead: Ownership Need, For-Sale Market Study, Land Value and For-Sale Feasibility (the Deal Calculator in ownership mode).
- **Rental and for-sale:** the rental steps, with each ownership tool offered alongside steps 2, 4, 5 and 6.

Check desktop and mobile, with both a well-covered jurisdiction and a small or data-sparse one. Use invented project inputs.

Evaluate whether a user can:

- Identify the housing need and understand who is underserved.
- Distinguish jurisdiction, market area and exact project site.
- Understand market boundaries, including natural-feature cutoff options and their limitations.
- Compare rental and ownership approaches, income targeting and unit mixes.
- Understand project feasibility, funding gaps, loan obligations and the assumptions driving the answer.
- Explain why the recommendation follows from the inputs.
- Identify the next practical action, information needed and appropriate contact.

For each task, ask: **What decision can this information support? What can it not establish? Is that distinction clear to the user?**

### 3. Examine usability beyond whether a page loads

- Is each page’s purpose and next action clear?
- Are navigation, labels, controls and terminology consistent?
- Can users recognize required inputs, edit assumptions and recover from mistakes?
- Are important conclusions visible without hunting through cards or opening numerous explanations?
- Are charts and maps understandable, with useful legends, units and geography?
- Do loading, empty, unavailable and error states explain what happened and what to do?
- Does changing jurisdiction, going Back or reopening a saved session preserve appropriate state without retaining misleading results?
- Check keyboard access, focus, contrast, touch targets, horizontal scrolling and disruptive loading or layout shifts.
- Identify repeated information, unnecessary choices and unexplained jargon that slow a competent practitioner down.

Use the real browser for observed behavior. Record viewport, jurisdiction and session conditions for reproducible findings. Do not present a code-based inference as an observed user experience.

### 4. Assess trust and decision quality

Trace representative figures from their source through the displayed result, explanation and export. Check that:

- Observed data, modeled estimates, examples and user assumptions are distinguishable.
- Geography, source date and limitations are visible where needed.
- Missing inputs remain unavailable with a reason.
- Screening results do not imply underwriting, approval or a formal market study.
- Sensitivity to uncertain assumptions is understandable.
- Recommendations explain meaningful tradeoffs rather than merely presenting a score.

Assess whether users can tell which conclusions are dependable now, which depend on their assumptions, and which require additional professional investigation.

### 5. Include the gated developer brief and rehearsal evidence

Reuse an existing authorized authenticated session and verification records. Check the brief’s jurisdiction and county assignment, contacts, landscape, source dates and return after login. Do not bypass authentication or reproduce private information in the report.

Find the existing internal rehearsal record first. Identify only missing evidence; do not repeat a completed rehearsal. Distinguish what you personally verified from what an existing record establishes.

The readiness record should identify one stable public/gated release combination, its applicable CI evidence, the journeys checked, limitations and unresolved blockers. Disclose differences between tested and deployed revisions rather than claiming an exact match without evidence.

If authenticated access or an existing record is unavailable, say precisely what remains unverified and who can supply the evidence. Do not label the intentional access gate a defect.

### 6. Assess news and email integration as an open decision

The owner is unsure that news and email integration should remain deferred. Revisit that assumption.

- Inspect the existing housing-news, alerts and editorial-review workflow before proposing anything new. Read issue #2366 as background, but treat its earlier deferral as under reconsideration.
- Assess how Google Alerts delivered to an owner-selected Gmail account, Google News interests and Apple News reading could help practitioners discover policy changes, funding opportunities, local developments and emerging risks.
- Distinguish technically supported ingestion from manual sharing or curation; do not assume personalized feeds or multiple accounts can be accessed.
- Explain where the information would help a decision within COHO, how it would be filtered by jurisdiction and topic, and how users would distinguish a news lead from a verified program fact.
- Consider account selection, consent, privacy, duplicates, source dates, maintenance effort and the risk of stale or misleading stories.
- Recommend whether a useful first step belongs before the walkthrough, can proceed independently without delaying it, or should follow practitioner feedback. State the benefit and tradeoff of each realistic option.

This is a recommendation about scope and timing, not authorization to connect a mailbox, read private email, send messages, activate automation or publish imported material.

### 7. Deliver one prioritized Markdown assessment

Include:

- An overall judgment of usefulness for the intended audience.
- What already works well and should be preserved.
- Findings grouped into **must fix before the practitioner walkthrough**, **improve in the next refinement round**, and **later polish**.
- For each finding: the user’s task, observed problem, decision consequence, reproduction steps, page and relevant code location, evidence, and the smallest proposed improvement.
- Clearly marked inferred concerns and anything you could not verify.
- Existing issues or active work that already cover a finding, rather than duplicate proposals.
- A separate recommendation on news and email integration, with the owner decisions needed.

Prioritize by the likelihood and consequence of a user making a wrong decision or getting stuck. Separate factual defects, usability problems and design preferences. Do not treat every open issue as a walkthrough blocker.

### 8. Make this an iterative review

End with the **three to five highest-value improvements** for the next round and an observable success criterion for each. Separate defects from design hypotheses that need practitioner feedback.

After I approve a round, evaluate its results against this baseline, check for regressions and update the same assessment. Keep a short record of what improved and what remains unresolved. Do not expand into a redesign without approval.

The goal is a coherent, dependable decision-support tool. Automated checks and your review support the practitioner walkthrough; they do not replace feedback from real practitioners.
