# `js/workflow/recommendation-page.js`

Step 7 — rendering the recommendation.

Conclusion first, in the literal sense: the verdict and the sentence that
explains it are the first two things on the page, before any table, and the
evidence that produced them is underneath, collapsed. A reader who opens
this page and reads nothing else should still leave with the answer.

The three states are drawn as three different things, not three colours of
the same thing. An insufficient verdict does not get a number with a warning
icon beside it — it gets a sentence saying no recommendation was reached and
a list of what is missing. Half of Colorado's 546 jurisdictions land there,
so it has to read as a real outcome rather than a broken page.

Everything here reads RecommendationContract's output. It never reaches into
another page's DOM.

_No documented symbols — module has a file-header comment only._
