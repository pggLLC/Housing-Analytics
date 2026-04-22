# `js/market-analysis/market-analysis-state.js`

js/market-analysis/market-analysis-state.js
Global state container for the market analysis report.
Exposes window.MAState with get/set/subscribe.

## Symbols

### `_state`

Selected site coordinates and buffer radius. */
    site: {
      lat:         null,
      lon:         null,
      bufferMiles: 5
    },
    /** Aggregated ACS metrics object (null until computed). */
    acs:       null,
    /** Array of LIHTC GeoJSON features inside the buffer. */
    lihtc:     [],
    /** Scoring result returned by SiteSelectionScore.computeScore(). */
    scores:    null,
    /** Per-section data payloads used by MARenderers. */
    sections: {
      demand:       null,
      supply:       null,
      subsidy:      null,
      feasibility:  null,
      access:       null,
      policy:       null,
      opportunities: null
    },
    /** True while any async data operation is in flight. */
    loading:   false,
    /** Non-null error string when the last operation failed. */
    error:     null,
    /** True once all required data has been successfully loaded. */
    dataReady: false
  };

  /* ── Private module state ─────────────────────────────────────────

### `_deepClone(obj)`

Shallow-clone a plain object one level deep.
Nested objects (sections, site) are replaced by reference on setState
so callers must pass complete sub-objects when updating them.
@param {object} obj
@returns {object}

### `_merge(target, partial)`

Merge `partial` into a shallow copy of `target`.
@param {object} target
@param {object} partial
@returns {object}

### `getState()`

Return a deep copy of the current state.
@returns {object}

### `setState(partial)`

Merge `partial` into the current state and notify all subscribers.
@param {object} partial - Keys to update; other keys are preserved.

### `subscribe(fn)`

Register a callback to be invoked whenever state changes.
Returns an unsubscribe function.
@param {function} fn - Called with (newState, prevState).
@returns {function} unsubscribe

### `reset()`

Reset state to its initial shape and notify subscribers.
