# `js/workflow-state-core.js`

workflow-state-core.js — Internal helpers for COHO workflow state manager

This file contains all private/internal functions, constants, and state
used by the WorkflowState API.  It exposes them via window._WorkflowInternal
so that workflow-state-api.js can access them.

Must be loaded BEFORE workflow-state-api.js.

Requires site-state.js to be loaded first.

## Symbols

### `_memStore`

In-memory fallback when localStorage is unavailable.

### `_generateProjectId()`

Generate a unique project ID.
@returns {string}

### `_clone(obj)`

Deep-clone an object using JSON round-trip (ES5-safe).
@param {*} obj
@returns {*}

### `_deepMerge(target, source)`

Recursively merge source into a clone of target.
Arrays in source fully replace arrays in target (not concatenated).
@param {Object} target
@param {Object} source
@returns {Object} new merged object

### `_formatRelative(isoString)`

Format an ISO date string as a human-readable "Saved X ago" label.
@param {string} isoString
@returns {string}

### `_dateStamp()`

Return a YYYY-MM-DD stamp for use in filenames.
@returns {string}

### `_updateProjectsListEntry(project)`

Upsert a summary entry for the given project in the projects list.
@param {Object} project  Full project object

### `_computeCompletedSteps(project)`

Compute the list of completed step keys for a project.
@param {Object} project
@returns {string[]}

### `_isStepCompleteForProject(key, project)`

Evaluate step completion for a given project object.
@param {string} key      Step key
@param {Object} project  Full project object
@returns {boolean}

### `_migrateSiteState()`

If SiteState holds county or PMA data, seed those into the active project.
Note: This function references WorkflowState.setStep which is defined in
workflow-state-api.js.  It is safe because _migrateSiteState is only
called after both files have loaded and WorkflowState exists on window.

### `_buildNewProject(name)`

Build a brand-new project object with empty steps.
@param {string} name  Project name
@returns {Object}
