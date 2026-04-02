/**
 * workflow-state.js — Project-based workflow state manager for COHO Analytics
 *
 * Extends window.SiteState with a full 6-step LIHTC development workflow,
 * organised around named "projects" persisted in localStorage.  Each project
 * tracks the six analysis steps: jurisdiction → HSA → market → scenario →
 * site (optional) → deal.
 *
 * This module does NOT replace SiteState — it reads from and writes back to
 * SiteState for full backward compatibility with existing pages.
 *
 * Storage layout
 *   coho_wf_projects          — JSON array of project summary objects
 *   coho_wf_active            — string project ID of the active project
 *   coho_wf_project_{id}      — full project object
 *
 * Usage:
 *   var id = WorkflowState.newProject('Boulder Analysis');
 *   WorkflowState.setJurisdiction({ fips: '08013', name: 'Boulder County' });
 *   var pct = WorkflowState.getProgress().pct;
 *   WorkflowState.subscribe('workflow:step-updated', function(e) { … });
 *
 * Requires site-state.js to be loaded first.
 */
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * Storage helpers — graceful degradation when localStorage is unavailable
   * ───────────────────────────────────────────────────────────────────────── */

  var WF_PREFIX = 'coho_wf_';

  /** In-memory fallback when localStorage is unavailable. */
  var _memStore = {};

  function _wfGet(key) {
    try {
      var raw = localStorage.getItem(WF_PREFIX + key);
      return raw !== null ? JSON.parse(raw) : null;
    } catch (_) {
      return (WF_PREFIX + key) in _memStore ? _memStore[WF_PREFIX + key] : null;
    }
  }

  function _wfSet(key, value) {
    try {
      localStorage.setItem(WF_PREFIX + key, JSON.stringify(value));
    } catch (_) {
      _memStore[WF_PREFIX + key] = value;
    }
  }

  function _wfRemove(key) {
    try {
      localStorage.removeItem(WF_PREFIX + key);
    } catch (_) {
      delete _memStore[WF_PREFIX + key];
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Step metadata — used for navigation helpers and progress calculations.
   * 'site' step is intentionally omitted; it is optional and filled alongside
   * the market step rather than tracked in progress percentage.
   * ───────────────────────────────────────────────────────────────────────── */

  var STEP_META = [
    { key: 'jurisdiction', num: 1, label: 'Select Jurisdiction',     url: 'select-jurisdiction.html' },
    { key: 'hsa',          num: 2, label: 'Housing Needs Assessment', url: 'housing-needs-assessment.html' },
    { key: 'market',       num: 3, label: 'Market Analysis',          url: 'market-analysis.html' },
    { key: 'scenario',     num: 4, label: 'Scenario Builder',         url: 'scenario-builder.html' },
    { key: 'deal',         num: 5, label: 'Deal Calculator',          url: 'deal-calculator.html' }
  ];

  /* ─────────────────────────────────────────────────────────────────────────
   * Default step shapes — returned when a step has never been written so
   * callers always receive a consistent object structure.
   * ───────────────────────────────────────────────────────────────────────── */

  function _defaultSteps() {
    return {
      jurisdiction: {
        fips: null, name: null, type: null, geoid: null,
        displayName: null, amiArea: null, lat: null, lon: null,
        population: null, mhi: null, completedAt: null
      },
      hsa: {
        completedAt: null, costBurdenRate: null, rentersTotal: null,
        amiGapUnits: null, recommendedAmiMix: null, medianIncome: null,
        renterShare: null, vacancyRate: null, keyFindings: [],
        exportReady: false
      },
      market: {
        completedAt: null, siteAddress: null, siteLat: null, siteLon: null,
        bufferMiles: 3, pmaScore: null, dimensions: null,
        qctFlag: false, ddaFlag: false, fmrRents: null,
        bridgeLandContext: null, exportReady: false
      },
      scenario: {
        completedAt: null, totalUnits: null, amiMix: [],
        unitTypeMix: null, creditType: '9pct', grossRentRevenue: null,
        noi: null, exportReady: false
      },
      site: {
        address: null, lat: null, lon: null, parcelAcres: null,
        zoningCode: null, landCostTier: null, neighborhoodEra: null,
        exportReady: false
      },
      deal: {
        completedAt: null, tdc: null, devFee: null,
        constructionCostPsf: null, equityPrice: 0.91,
        leasingMonths: 18, results: null,
        recommendedPartners: [], exportReady: false
      }
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Utility helpers
   * ───────────────────────────────────────────────────────────────────────── */

  /**
   * Generate a unique project ID.
   * @returns {string}
   */
  function _generateProjectId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Deep-clone an object using JSON round-trip (ES5-safe).
   * @param {*} obj
   * @returns {*}
   */
  function _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Recursively merge source into a clone of target.
   * Arrays in source fully replace arrays in target (not concatenated).
   * @param {Object} target
   * @param {Object} source
   * @returns {Object} new merged object
   */
  function _deepMerge(target, source) {
    var result = _clone(target);
    var key;
    for (key in source) {
      if (!source.hasOwnProperty(key)) { continue; }
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = _deepMerge(result[key], source[key]);
      } else {
        result[key] = _clone(source[key] !== undefined ? source[key] : result[key]);
      }
    }
    return result;
  }

  /**
   * Format an ISO date string as a human-readable "Saved X ago" label.
   * @param {string} isoString
   * @returns {string}
   */
  function _formatRelative(isoString) {
    if (!isoString) { return 'Never saved'; }
    var then;
    try { then = new Date(isoString).getTime(); } catch (_) { return 'Never saved'; }
    var nowMs = Date.now();
    var diffMs = nowMs - then;
    if (diffMs < 0) { diffMs = 0; }
    var diffMin = Math.floor(diffMs / 60000);
    var diffHr  = Math.floor(diffMin / 60);
    var diffDay = Math.floor(diffHr  / 24);

    if (diffMin < 1)  { return 'Saved just now'; }
    if (diffMin < 60) { return 'Saved ' + diffMin + ' minute' + (diffMin === 1 ? '' : 's') + ' ago'; }
    if (diffHr  < 24) { return 'Saved ' + diffHr  + ' hour'   + (diffHr  === 1 ? '' : 's') + ' ago'; }
    if (diffDay < 2)  {
      var d = new Date(then);
      var hh = d.getHours();
      var mm = d.getMinutes();
      var ampm = hh >= 12 ? 'PM' : 'AM';
      hh = hh % 12 || 12;
      mm = mm < 10 ? '0' + mm : String(mm);
      return 'Saved today at ' + hh + ':' + mm + ' ' + ampm;
    }
    return 'Saved ' + diffDay + ' days ago';
  }

  /**
   * Return a YYYY-MM-DD stamp for use in filenames.
   * @returns {string}
   */
  function _dateStamp() {
    var d = new Date();
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return d.getFullYear() + '-' +
      (mm < 10 ? '0' + mm : mm) + '-' +
      (dd < 10 ? '0' + dd : dd);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * In-memory active project reference
   * ───────────────────────────────────────────────────────────────────────── */

  var _activeProject = null;  // the full project object currently in memory

  /* ─────────────────────────────────────────────────────────────────────────
   * Projects list helpers
   * ───────────────────────────────────────────────────────────────────────── */

  function _loadProjectsList() {
    return _wfGet('projects') || [];
  }

  function _saveProjectsList(list) {
    _wfSet('projects', list);
  }

  /**
   * Upsert a summary entry for the given project in the projects list.
   * @param {Object} project  Full project object
   */
  function _updateProjectsListEntry(project) {
    var list = _loadProjectsList();
    var meta = project._meta;
    var found = false;
    var completedSteps = _computeCompletedSteps(project);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === meta.projectId) {
        list[i].name             = meta.projectName;
        list[i].savedAt          = meta.savedAt;
        list[i].jurisdictionName = (project.jurisdiction && project.jurisdiction.name) || null;
        list[i].completedSteps   = completedSteps;
        found = true;
        break;
      }
    }
    if (!found) {
      list.push({
        id:               meta.projectId,
        name:             meta.projectName,
        createdAt:        meta.createdAt,
        savedAt:          meta.savedAt,
        jurisdictionName: (project.jurisdiction && project.jurisdiction.name) || null,
        completedSteps:   completedSteps
      });
    }
    _saveProjectsList(list);
  }

  /**
   * Compute the list of completed step keys for a project.
   * @param {Object} project
   * @returns {string[]}
   */
  function _computeCompletedSteps(project) {
    var completed = [];
    var i;
    for (i = 0; i < STEP_META.length; i++) {
      if (_isStepCompleteForProject(STEP_META[i].key, project)) {
        completed.push(STEP_META[i].key);
      }
    }
    return completed;
  }

  /**
   * Evaluate step completion for a given project object.
   * @param {string} key      Step key
   * @param {Object} project  Full project object
   * @returns {boolean}
   */
  function _isStepCompleteForProject(key, project) {
    var step = project[key];
    if (!step) { return false; }
    switch (key) {
      case 'jurisdiction':
        return !!(step.fips && step.completedAt);
      case 'hsa':
        return !!step.completedAt;
      case 'market':
        return !!step.completedAt;
      case 'scenario':
        return !!(step.completedAt && step.totalUnits && step.totalUnits > 0);
      case 'site':
        return false;   // optional — never blocks progress
      case 'deal':
        return !!step.completedAt;
      default:
        return false;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Persist / load individual projects
   * ───────────────────────────────────────────────────────────────────────── */

  function _persistProject(project) {
    try {
      _wfSet('project_' + project._meta.projectId, project);
    } catch (e) {
      console.warn('[WorkflowState] Failed to persist project:', e);
    }
  }

  function _loadProjectById(id) {
    try {
      return _wfGet('project_' + id) || null;
    } catch (e) {
      console.warn('[WorkflowState] Failed to load project ' + id + ':', e);
      return null;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Migration helpers — absorb existing SiteState data into a project
   * ───────────────────────────────────────────────────────────────────────── */

  /**
   * If SiteState holds county or PMA data, seed those into the active project.
   */
  function _migrateSiteState() {
    if (!_activeProject) { return; }

    try {
      var existingCounty = global.SiteState && global.SiteState.getCounty && global.SiteState.getCounty();
      if (existingCounty && existingCounty.fips) {
        WorkflowState.setStep('jurisdiction', {
          fips:        existingCounty.fips,
          name:        existingCounty.name,
          type:        'county',
          geoid:       existingCounty.fips,
          completedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('[WorkflowState] County migration failed:', e);
    }

    try {
      var pma = global.SiteState && global.SiteState.getPmaResults && global.SiteState.getPmaResults();
      if (pma && pma.overall) {
        WorkflowState.setStep('market', {
          pmaScore:    pma.overall,
          dimensions:  pma.dimensions || null,
          completedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('[WorkflowState] PMA migration failed:', e);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Create a fresh project skeleton
   * ───────────────────────────────────────────────────────────────────────── */

  /**
   * Build a brand-new project object with empty steps.
   * @param {string} name  Project name
   * @returns {Object}
   */
  function _buildNewProject(name) {
    var now = new Date().toISOString();
    var id  = _generateProjectId();
    var defaults = _defaultSteps();
    return {
      _meta: {
        version:     1,
        projectId:   id,
        projectName: name || ('New Project ' + _dateStamp()),
        createdAt:   now,
        savedAt:     now,
        extras:      {}
      },
      jurisdiction: defaults.jurisdiction,
      hsa:          defaults.hsa,
      market:       defaults.market,
      scenario:     defaults.scenario,
      site:         defaults.site,
      deal:         defaults.deal
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Custom event dispatcher
   * ───────────────────────────────────────────────────────────────────────── */

  function _dispatch(eventName, detail) {
    try {
      var evt;
      if (typeof CustomEvent === 'function') {
        evt = new CustomEvent(eventName, { detail: detail, bubbles: false });
      } else {
        // IE11 fallback
        evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(eventName, false, false, detail);
      }
      document.dispatchEvent(evt);
    } catch (e) {
      console.warn('[WorkflowState] Could not dispatch event ' + eventName + ':', e);
    }
  }

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
      _activeProject = project;
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
      return _activeProject ? _clone(_activeProject) : null;
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
      _activeProject = project;
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
        if (_activeProject && _activeProject._meta.projectId === id) {
          _activeProject = null;
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
        if (_activeProject && _activeProject._meta.projectId === id) {
          _activeProject._meta.projectName = name;
          _activeProject._meta.savedAt = project._meta.savedAt;
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
      if (!_activeProject) {
        console.warn('[WorkflowState] setStep called with no active project');
        return;
      }
      if (!_activeProject[key]) {
        // Initialise from defaults if somehow missing
        _activeProject[key] = _defaultSteps()[key] || {};
      }
      _activeProject[key]         = _deepMerge(_activeProject[key], data);
      _activeProject._meta.savedAt = new Date().toISOString();

      _persistProject(_activeProject);
      _updateProjectsListEntry(_activeProject);

      _dispatch('workflow:step-updated', {
        stepKey:   key,
        projectId: _activeProject._meta.projectId
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
      if (!_activeProject) {
        return _clone(_defaultSteps()[key] || {});
      }
      return _clone(_activeProject[key] || _defaultSteps()[key] || {});
    },

    /**
     * Determine whether a given step satisfies its completion criteria.
     * @param  {string} key  Step key.
     * @returns {boolean}
     */
    isStepComplete: function (key) {
      if (!_activeProject) { return false; }
      return _isStepCompleteForProject(key, _activeProject);
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
      var completedSteps = [];
      var nextIncomplete = null;
      var nextMeta       = null;
      var i;

      for (i = 0; i < STEP_META.length; i++) {
        var meta = STEP_META[i];
        if (_activeProject && _isStepCompleteForProject(meta.key, _activeProject)) {
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
     * @param {Object} data  Jurisdiction fields (fips, name, type, …).
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
      if (!_activeProject) {
        console.warn('[WorkflowState] set called with no active project');
        return;
      }
      if (!_activeProject._meta.extras) { _activeProject._meta.extras = {}; }
      _activeProject._meta.extras[key] = value;
      _activeProject._meta.savedAt = new Date().toISOString();
      _persistProject(_activeProject);
    },

    /**
     * Read a value from the active project's _meta.extras bag.
     * @param  {string} key
     * @returns {*}  The stored value, or undefined.
     */
    get: function (key) {
      if (!_activeProject || !_activeProject._meta.extras) { return undefined; }
      return _activeProject._meta.extras[key];
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
      if (!_activeProject) { return null; }
      var p = _clone(_activeProject);
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
      if (!_activeProject) {
        console.warn('[WorkflowState] exportProjectJSON: no active project');
        return;
      }
      try {
        var summary  = WorkflowState.getProjectSummary();
        var jurName  = (_activeProject.jurisdiction && _activeProject.jurisdiction.name)
          ? _activeProject.jurisdiction.name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '')
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
      return (_activeProject && _activeProject._meta.savedAt) || null;
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
        _activeProject = loaded;
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
