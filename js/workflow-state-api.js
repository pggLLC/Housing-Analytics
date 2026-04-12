/**
 * workflow-state-api.js — Public WorkflowState API for COHO Analytics
 *
 * Provides the full public WorkflowState object with all methods for project
 * and step management, event subscription, and export helpers.
 *
 * Must be loaded AFTER workflow-state-core.js (which populates
 * window._WorkflowInternal).
 *
 * Requires site-state.js and workflow-state-core.js to be loaded first.
 */
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * Pull in all internals from the core module
   * ───────────────────────────────────────────────────────────────────────── */

  var I = global._WorkflowInternal;
  if (!I) {
    console.error('[WorkflowState] workflow-state-core.js must be loaded before workflow-state-api.js');
    return;
  }

  // Storage helpers
  var _wfGet    = I._wfGet;
  var _wfSet    = I._wfSet;
  var _wfRemove = I._wfRemove;

  // Step metadata
  var STEP_META     = I.STEP_META;
  var _defaultSteps = I._defaultSteps;

  // Utility helpers
  var _clone         = I._clone;
  var _deepMerge     = I._deepMerge;
  var _formatRelative = I._formatRelative;
  var _dateStamp     = I._dateStamp;

  // In-memory state accessors
  var _getActive = I.getActiveProject;
  var _setActive = I.setActiveProject;

  // Projects list CRUD
  var _loadProjectsList        = I._loadProjectsList;
  var _updateProjectsListEntry = I._updateProjectsListEntry;
  var _isStepCompleteForProject = I._isStepCompleteForProject;
  var _persistProject          = I._persistProject;
  var _loadProjectById         = I._loadProjectById;
  var _saveProjectsList        = I._saveProjectsList;

  // Migration & builders
  var _migrateSiteState = I._migrateSiteState;
  var _buildNewProject  = I._buildNewProject;

  // Event dispatcher
  var _dispatch = I._dispatch;

  /* ══════════════════════════════════════════════════════════════════════════
   * Public API — window.WorkflowState
   * ══════════════════════════════════════════════════════════════════════════ */

  var WorkflowState = {

    /* ── Project Management ─────────────────────────────────────────────── */

    /**
     * Create a new project, make it active, and (if possible) migrate any
     * existing SiteState data into it.
     *
     * @param  {string} [name]  Human-readable project name.  Defaults to
     *                          "Project — {jurisdictionName}" if SiteState has
     *                          a county, otherwise "New Project {YYYY-MM-DD}".
     * @returns {string}  The new project ID.
     */
    newProject: function (name) {
      var resolvedName = name;
      if (!resolvedName) {
        try {
          var c = global.SiteState && global.SiteState.getCounty && global.SiteState.getCounty();
          resolvedName = c && c.name
            ? ('Project \u2014 ' + c.name)
            : ('New Project ' + _dateStamp());
        } catch (_) {
          resolvedName = 'New Project ' + _dateStamp();
        }
      }

      var project = _buildNewProject(resolvedName);
      _setActive(project);
      _wfSet('active', project._meta.projectId);
      _persistProject(project);
      _updateProjectsListEntry(project);

      // Migrate SiteState data into the fresh project
      _migrateSiteState();

      return project._meta.projectId;
    },

    /**
     * Return the full project object that is currently active, or null.
     * @returns {Object|null}
     */
    getActiveProject: function () {
      var ap = _getActive();
      return ap ? _clone(ap) : null;
    },

    /**
     * Load a project by ID and set it as the active project.
     * @param  {string} id  Project ID.
     * @returns {Object|null}  The loaded project, or null if not found.
     */
    loadProject: function (id) {
      var project = _loadProjectById(id);
      if (!project) {
        console.warn('[WorkflowState] Project not found: ' + id);
        return null;
      }
      _setActive(project);
      _wfSet('active', id);
      return _clone(project);
    },

    /**
     * Return summary objects for all saved projects.
     * Each summary: {id, name, createdAt, savedAt, jurisdictionName, completedSteps}
     * @returns {Array}
     */
    listProjects: function () {
      return _clone(_loadProjectsList());
    },

    /**
     * Permanently delete a project and remove it from the projects list.
     * @param {string} id  Project ID to delete.
     */
    deleteProject: function (id) {
      try {
        _wfRemove('project_' + id);
        var list = _loadProjectsList();
        var filtered = [];
        var i;
        for (i = 0; i < list.length; i++) {
          if (list[i].id !== id) { filtered.push(list[i]); }
        }
        _saveProjectsList(filtered);
        var ap = _getActive();
        if (ap && ap._meta.projectId === id) {
          _setActive(null);
          _wfRemove('active');
        }
      } catch (e) {
        console.warn('[WorkflowState] deleteProject failed:', e);
      }
    },

    /**
     * Rename a project.
     * @param {string} id    Project ID.
     * @param {string} name  New name.
     */
    renameProject: function (id, name) {
      try {
        var project = _loadProjectById(id);
        if (!project) {
          console.warn('[WorkflowState] renameProject: project not found: ' + id);
          return;
        }
        project._meta.projectName = name;
        project._meta.savedAt = new Date().toISOString();
        _persistProject(project);
        _updateProjectsListEntry(project);
        var ap = _getActive();
        if (ap && ap._meta.projectId === id) {
          ap._meta.projectName = name;
          ap._meta.savedAt = project._meta.savedAt;
        }
      } catch (e) {
        console.warn('[WorkflowState] renameProject failed:', e);
      }
    },

    /* ── Step Management ────────────────────────────────────────────────── */

    /**
     * Deep-merge data into a workflow step and immediately persist.
     * Dispatches 'workflow:step-updated' on document.
     *
     * @param {string} key   Step key: 'jurisdiction'|'hsa'|'market'|'scenario'|'site'|'deal'
     * @param {Object} data  Partial or full step data to merge.
     */
    setStep: function (key, data) {
      var ap = _getActive();
      if (!ap) {
        console.warn('[WorkflowState] setStep called with no active project');
        return;
      }
      if (!ap[key]) {
        // Initialise from defaults if somehow missing
        ap[key] = _defaultSteps()[key] || {};
      }
      ap[key]         = _deepMerge(ap[key], data);
      ap._meta.savedAt = new Date().toISOString();

      _persistProject(ap);
      _updateProjectsListEntry(ap);

      _dispatch('workflow:step-updated', {
        stepKey:   key,
        projectId: ap._meta.projectId
      });
    },

    /**
     * Return the current state of a workflow step.
     * Returns a null-safe default object if no data has been written yet.
     *
     * @param  {string} key  Step key.
     * @returns {Object}
     */
    getStep: function (key) {
      var ap = _getActive();
      if (!ap) {
        return _clone(_defaultSteps()[key] || {});
      }
      return _clone(ap[key] || _defaultSteps()[key] || {});
    },

    /**
     * Determine whether a given step satisfies its completion criteria.
     * @param  {string} key  Step key.
     * @returns {boolean}
     */
    isStepComplete: function (key) {
      var ap = _getActive();
      if (!ap) { return false; }
      return _isStepCompleteForProject(key, ap);
    },

    /**
     * Compute overall workflow progress across the five tracked steps
     * (jurisdiction, hsa, market, scenario, deal).  The 'site' step is
     * optional and excluded from percentage calculation.
     *
     * @returns {{
     *   pct:             number,
     *   completedCount:  number,
     *   totalCount:      number,
     *   completedSteps:  string[],
     *   nextIncomplete:  string|null,
     *   nextStepNum:     number|null,
     *   nextStepLabel:   string|null,
     *   nextStepUrl:     string|null
     * }}
     */
    getProgress: function () {
      var ap = _getActive();
      var completedSteps = [];
      var nextIncomplete = null;
      var nextMeta       = null;
      var i;

      for (i = 0; i < STEP_META.length; i++) {
        var meta = STEP_META[i];
        if (ap && _isStepCompleteForProject(meta.key, ap)) {
          completedSteps.push(meta.key);
        } else if (!nextIncomplete) {
          nextIncomplete = meta.key;
          nextMeta       = meta;
        }
      }

      var total = STEP_META.length;
      var count = completedSteps.length;
      return {
        pct:            Math.round((count / total) * 100),
        completedCount: count,
        totalCount:     total,
        completedSteps: completedSteps,
        nextIncomplete: nextIncomplete,
        nextStepNum:    nextMeta ? nextMeta.num   : null,
        nextStepLabel:  nextMeta ? nextMeta.label : null,
        nextStepUrl:    nextMeta ? nextMeta.url   : null
      };
    },

    /* ── Quick-access helpers ───────────────────────────────────────────── */

    /**
     * Return the jurisdiction step data, or an empty object.
     * @returns {Object}
     */
    getJurisdiction: function () {
      return WorkflowState.getStep('jurisdiction');
    },

    /**
     * Set jurisdiction data, marking the step complete and syncing SiteState.
     * Automatically sets completedAt to now.
     *
     * @param {Object} data  Jurisdiction fields (fips, name, type, ...).
     */
    setJurisdiction: function (data) {
      var payload = _deepMerge(data, { completedAt: new Date().toISOString() });
      WorkflowState.setStep('jurisdiction', payload);

      // Backward-compat sync to SiteState
      try {
        if (global.SiteState && global.SiteState.setCounty && data.fips) {
          global.SiteState.setCounty(data.fips, data.name || null);
        }
      } catch (e) {
        console.warn('[WorkflowState] SiteState.setCounty sync failed:', e);
      }
    },

    /* ── Generic extras store ───────────────────────────────────────────── */

    /**
     * Store an arbitrary value under a named key in the active project's
     * _meta.extras bag.  Useful for page-level transient state.
     *
     * @param {string} key
     * @param {*}      value
     */
    set: function (key, value) {
      var ap = _getActive();
      if (!ap) {
        console.warn('[WorkflowState] set called with no active project');
        return;
      }
      if (!ap._meta.extras) { ap._meta.extras = {}; }
      ap._meta.extras[key] = value;
      ap._meta.savedAt = new Date().toISOString();
      _persistProject(ap);
    },

    /**
     * Read a value from the active project's _meta.extras bag.
     * @param  {string} key
     * @returns {*}  The stored value, or undefined.
     */
    get: function (key) {
      var ap = _getActive();
      if (!ap || !ap._meta.extras) { return undefined; }
      return ap._meta.extras[key];
    },

    /* ── Event subscription ─────────────────────────────────────────────── */

    /**
     * Subscribe to a workflow custom event (e.g. 'workflow:step-updated').
     * The callback receives the native CustomEvent; use event.detail for data.
     *
     * @param  {string}   event     DOM event name.
     * @param  {Function} callback  Handler function.
     * @returns {Function}  Unsubscribe function — call it to remove the listener.
     */
    subscribe: function (event, callback) {
      document.addEventListener(event, callback);
      return function unsubscribe() {
        document.removeEventListener(event, callback);
      };
    },

    /* ── Export helpers ─────────────────────────────────────────────────── */

    /**
     * Return a single merged export object containing all step data and meta.
     * @returns {Object|null}
     */
    getProjectSummary: function () {
      var ap = _getActive();
      if (!ap) { return null; }
      var p = _clone(ap);
      return {
        meta:         p._meta,
        jurisdiction: p.jurisdiction,
        hsa:          p.hsa,
        market:       p.market,
        scenario:     p.scenario,
        site:         p.site,
        deal:         p.deal,
        progress:     WorkflowState.getProgress()
      };
    },

    /**
     * Trigger a browser download of the active project as a JSON file.
     * Filename pattern: COHO_{jurisdictionName}_{YYYY-MM-DD}.json
     */
    exportProjectJSON: function () {
      var ap = _getActive();
      if (!ap) {
        console.warn('[WorkflowState] exportProjectJSON: no active project');
        return;
      }
      try {
        var summary  = WorkflowState.getProjectSummary();
        var jurName  = (ap.jurisdiction && ap.jurisdiction.name)
          ? ap.jurisdiction.name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '')
          : 'Project';
        var filename = 'COHO_' + jurName + '_' + _dateStamp() + '.json';
        var blob     = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
        var url      = URL.createObjectURL(blob);
        var a        = document.createElement('a');
        a.href       = url;
        a.download   = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('[WorkflowState] exportProjectJSON failed:', e);
      }
    },

    /* ── Save indicator ─────────────────────────────────────────────────── */

    /**
     * Return the ISO string timestamp of the last save, or null.
     * @returns {string|null}
     */
    getLastSaved: function () {
      var ap = _getActive();
      return (ap && ap._meta.savedAt) || null;
    },

    /**
     * Return a human-readable "Saved X minutes ago" style string.
     * @returns {string}
     */
    formatLastSaved: function () {
      return _formatRelative(WorkflowState.getLastSaved());
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
   * Bootstrap — runs once at script evaluation time.
   *
   * 1. Try to load the previously active project from storage.
   * 2. If none found and SiteState has county data, create a migrated project.
   * 3. Otherwise remain in null state until the user creates a project.
   * ───────────────────────────────────────────────────────────────────────── */

  (function _bootstrap() {
    var activeId = _wfGet('active');

    if (activeId) {
      var loaded = _loadProjectById(activeId);
      if (loaded) {
        _setActive(loaded);
        return;
      }
      // Stored ID points to a missing project — clean up
      _wfRemove('active');
    }

    // No active project — check if SiteState has data worth migrating
    try {
      var county = global.SiteState && global.SiteState.getCounty && global.SiteState.getCounty();
      if (county && county.fips) {
        WorkflowState.newProject();  // newProject() calls _migrateSiteState internally
      }
    } catch (e) {
      console.warn('[WorkflowState] Bootstrap migration check failed:', e);
    }
  }());

  /* ─────────────────────────────────────────────────────────────────────────
   * Expose globally
   * ───────────────────────────────────────────────────────────────────────── */
  global.WorkflowState = WorkflowState;

}(typeof window !== 'undefined' ? window : this));
