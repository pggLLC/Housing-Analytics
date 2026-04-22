# `js/pma-analysis-runner.js`

js/pma-analysis-runner.js
Multi-step PMA analysis pipeline orchestrator with progress reporting.

Runs all eight data-source modules in the optimal order (parallel where safe),
emitting progress events after each step so the UI can update a progress bar.

Usage:
  PMAAnalysisRunner.run(lat, lon, options)
    .on('progress', function(step) { ... })  // step: {index, total, label, pct}
    .on('complete', function(scoreRun) { ... })
    .on('error',    function(err) { ... });

Options:
  method         "buffer" | "commuting" | "hybrid"  (default: "buffer")
  bufferMiles    number                              (default: 5)
  proposedUnits  number                             (default: 100)
  vintage        string LODES vintage               (default: "2021")

Exposed as window.PMAAnalysisRunner.

## Symbols

### `run(lat, lon, options)`

Execute the full PMA analysis pipeline.

@param {number} lat
@param {number} lon
@param {object} [options]
@returns {EventEmitter}  — attach .on('progress'|'complete'|'error') handlers
