# `js/components/workflow-next-action.js`

workflow-next-action.js — "Recommended Next Action" banner component

Renders a contextual banner on each workflow page telling the user
what step to take next.  Reads from WorkflowState.getProgress() and
the current page's data-step attribute (set on the analytics.js script tag).

States:
  1. Current step incomplete, prior steps also incomplete → nudge to go back
  2. Current step incomplete, all priors done → "Complete this step, then…"
  3. Current step complete, next step exists → "Step complete! Continue to…"
  4. All 5 steps complete → "Workflow complete — export your summary"

Mount:  Looks for an element with id="workflowNextAction" on the page.
        If absent, auto-creates one after the first .hero, .sb-hero,
        .dc-hero, or .sj-header element inside <main>.

Depends on: workflow-state-core.js, workflow-state-api.js

_No documented symbols — module has a file-header comment only._
