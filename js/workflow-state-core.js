/**
 * workflow-state-core.js — Internal helpers for COHO workflow state manager
 *
 * This file contains all private/internal functions, constants, and state
 * used by the WorkflowState API.  It exposes them via window._WorkflowInternal
 * so that workflow-state-api.js can access them.
 *
 * Must be loaded BEFORE workflow-state-api.js.
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
    { key: 'scenario',     num: 4, label: 'Scenario Builder',         url: 'hna-scenario-builder.html' },
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
   * Note: This function references WorkflowState.setStep which is defined in
   * workflow-state-api.js.  It is safe because _migrateSiteState is only
   * called after both files have loaded and WorkflowState exists on window.
   */
  function _migrateSiteState() {
    if (!_activeProject) { return; }

    try {
      var existingCounty = global.SiteState && global.SiteState.getCounty && global.SiteState.getCounty();
      if (existingCounty && existingCounty.fips) {
        global.WorkflowState.setStep('jurisdiction', {
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
        global.WorkflowState.setStep('market', {
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

  /* ─────────────────────────────────────────────────────────────────────────
   * Expose internals via shared namespace for workflow-state-api.js
   * ───────────────────────────────────────────────────────────────────────── */

  global._WorkflowInternal = {
    // Storage helpers
    _wfGet:      _wfGet,
    _wfSet:      _wfSet,
    _wfRemove:   _wfRemove,
    _memStore:   _memStore,

    // Step metadata
    STEP_META:     STEP_META,
    _defaultSteps: _defaultSteps,

    // Utility helpers
    _generateProjectId: _generateProjectId,
    _clone:             _clone,
    _deepMerge:         _deepMerge,
    _formatRelative:    _formatRelative,
    _dateStamp:         _dateStamp,

    // In-memory state (object reference — mutations are shared)
    getActiveProject: function () { return _activeProject; },
    setActiveProject: function (p) { _activeProject = p; },

    // Projects list CRUD
    _loadProjectsList:       _loadProjectsList,
    _saveProjectsList:       _saveProjectsList,
    _updateProjectsListEntry: _updateProjectsListEntry,
    _computeCompletedSteps:  _computeCompletedSteps,
    _isStepCompleteForProject: _isStepCompleteForProject,
    _persistProject:         _persistProject,
    _loadProjectById:        _loadProjectById,

    // Migration
    _migrateSiteState: _migrateSiteState,

    // Project skeleton builder
    _buildNewProject: _buildNewProject,

    // Event dispatcher
    _dispatch: _dispatch
  };

}(typeof window !== 'undefined' ? window : this));
