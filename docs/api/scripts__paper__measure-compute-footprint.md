# `scripts/paper/measure-compute-footprint.mjs`

Measure the compute this project consumed, and refuse to guess the rest.

The repository was built with heavy AI assistance. That is a material fact
about how the work was produced and it carries an energy cost, so it is
disclosed here on the same terms as every other figure: what is measured is
measured, what is not is null with a reason, and nothing is rounded into a
reassuring number.

TWO SOURCES, BOTH IMPERFECT, BOTH STATED:

  1. Continuous integration. Workflow runs and their wall-clock durations come
     from the GitHub API. Complete for the life of the repository.

  2. Model inference. Assistant turns and token counts come from the local
     session transcripts under ~/.claude/projects. These are NOT complete:
     transcripts are rotated, and the surviving window is shorter than the
     project. The coverage window is recorded so the figure reads as the
     floor it is, not as a total.

WHAT IS DELIBERATELY NOT COMPUTED HERE: kilowatt-hours and CO2e. Converting
turns to energy requires a per-query figure, and the published range spans
more than an order of magnitude — from sub-watt-hour for optimised serving to
roughly 33 Wh for a reasoning model on a long prompt. Collapsing that to a
point estimate would manufacture a precision the evidence does not support,
which is the exact failure this repository exists to avoid. The page shows the
range and the arithmetic, and lets the reader see how wide it is.

  node scripts/paper/measure-compute-footprint.mjs         # write the JSON
  node scripts/paper/measure-compute-footprint.mjs --stdout

## Symbols

### `ENERGY_RANGE_WH_PER_QUERY`

Published per-query energy figures, with their sources.

These are NOT multiplied out into a single answer. The range spans a factor
of about forty, and which end applies depends on serving efficiency and
context length — neither of which this project can observe from outside.
