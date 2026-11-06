# `js/where-to-build-charts.js`

## Symbols

### `groupSplit(s)`

Points each slider group earns toward a place's score (sums to the base score before signals and flags).

### `rankRange(W, places, weights, topGeoids)`

For each of the top places, its best and worst rank when any one weighted group is set to 0,
      ranked as the page ranks (whole-number score, then name).

### `coverage(W, places)`

Rows with a recorded value (points not null), per factor, across the places given.

### `draw(W, rows, model, weights, cen, geo, today)`

Redraw all five from the rows the page is showing ({p, s} sorted by score) and the full model.
