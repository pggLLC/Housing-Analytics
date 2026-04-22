# `js/market-analysis/market-report-renderers.js`

js/market-analysis/market-report-renderers.js
Section-level HTML rendering functions for the market analysis report.
Exposes window.MARenderers.

Each render function writes into a named DOM element.  If data is
null or unavailable, a styled "Data unavailable" card is rendered
instead.  All HTML is assembled via string concatenation (no template
literal dependencies) so the module is fully ES5-compatible.

## Symbols

### `_el(id)`

Return the element with the given id, or null.
@param {string} id
@returns {Element|null}

### `_render(id, html)`

Set the innerHTML of a section element.
@param {string} id
@param {string} html

### `_unavailableCard(label)`

Build an unavailable-data card.
@param {string} label - Section label shown in the card.
@returns {string} HTML string.

### `_spinner()`

Build a loading spinner HTML string.
@returns {string}

### `_scoreBadge(score, label)`

Build a score badge HTML string.
@param {number} score  - 0–100.
@param {string} [label]
@returns {string}

### `_metricRow(label, value, color)`

Build a metric row: label + formatted value side-by-side.
@param {string} label
@param {string|number} value
@param {string} [color] - Optional CSS color for value text.
@returns {string}

### `_sectionHeading(title)`

Build a section heading.
@param {string} title
@returns {string}

### `renderExecutiveSummary(scores, acs)`

Render the executive summary card.
@param {object|null} scores - Result from SiteSelectionScore.computeScore().
@param {object|null} acs    - Aggregated ACS metrics.

### `_componentChip(label, score)`

Build a small component score chip.
@private

### `renderMarketDemand(acs)`

Render the market demand section.
@param {object|null} acs - Aggregated ACS metrics.

### `_burdenColor(rate)`

@private

### `renderAffordableSupply(lihtcData)`

Render the affordable supply section.
@param {Array|null} lihtcData - Array of LIHTC GeoJSON features.

### `_lihtcTable(features)`

@private Build a compact LIHTC project table.

### `renderSubsidyOpportunities(subsidyData)`

Render the subsidy opportunities section.
@param {object|null} subsidyData - e.g. { qct, dda, fmrRatio, nearbySubsidized, subsidy_score }.

### `renderSiteFeasibility(feasibilityData)`

Render the site feasibility section.
@param {object|null} feasibilityData - e.g. { floodRisk, soilScore, cleanupFlag, feasibility_score }.

### `renderNeighborhoodAccess(accessData)`

Render the neighborhood access section with walkability & bikeability.
@param {object|null} accessData - { amenities, walkability, access_score }.

### `_walkBikeRow(label, score, labelText)`

Build a walkability/bikeability score row with gauge bar.
@private

### `_miniMetric(label, value)`

Build a compact metric for the EPA factors grid.
@private

### `renderPolicyOverlays(policyData)`

Render the policy overlays section.
@param {object|null} policyData - e.g. { zoningCapacity, publicOwnership, overlayCount, overlays[], policy_score }.

### `renderOpportunities(opportunitiesData)`

Render the opportunities summary section.
@param {object|null} opportunitiesData - e.g. { items: [{ title, description, priority }] }.

### `showSectionLoading(sectionId)`

Replace a section's content with a loading spinner.
@param {string} sectionId - Element id.

### `showSectionError(sectionId, msg)`

Replace a section's content with an error message card.
@param {string} sectionId - Element id.
@param {string} msg       - Error message text.

### `renderInfrastructure(data)`

Render the infrastructure feasibility section (supplementary indicator).
NOT part of the main 5-dimension scoring — supplementary from public data.
@param {object|null} data - { score: number, justification: object }

### `exportReport()`

Collect rendered report HTML and open in a new print-ready window.
Captures the current state of all 8 report sections plus site metadata.
