# `js/analytics/query-builder.js`

js/analytics/query-builder.js
Visual query builder for advanced analytics.

Responsibilities:
 - QueryBuilder class for visual query construction
 - Dimension selectors (Geography, Age Group, Income, Tenure, etc.)
 - Operator selectors (equals, between, greater than, in list)
 - Filter validation and error handling
 - Filter application to data arrays

Exposed on window.QueryBuilder for use by other modules.

## Symbols

### `QueryBuilder(container, options)`

@class QueryBuilder
@param {HTMLElement|string} container - DOM element or selector to render into.
@param {object} [options]
@param {function} [options.onChange] - Callback invoked with updated filter list.
