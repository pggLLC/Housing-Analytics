// Lab project store. Projects live in this browser only (decision 2, 2026-10-25).
// Rules from docs/first-slice.md:
// - Exploring never creates or changes a project; evidence is attached only to a project the visitor names.
// - Each project and scenario is separate; nothing is shared through a global "active" record.
// - Attached evidence is a frozen snapshot, kept apart from the visitor's own overrides.
// - Changing a site or geography marks dependent evidence stale; the old snapshot stays recoverable.
// - Saved, attached, reviewed and stale are different states.
(function (global) {
  'use strict';

  var PREFIX = 'coho-lab.';
  var VERSION = 1;
  // Live-site keys, read only for an explicit one-time import. Never written.
  var LEGACY = { subject: 'coho.subjectProject.v1', projects: 'coho_wf_projects', projectPrefix: 'coho_wf_project_' };

  // What each kind of change makes stale. Written out so it can be reviewed and tested.
  var DEPENDENCIES = {
    jurisdiction: ['place-reference', 'market-snapshot', 'rent-schedule', 'financials'],
    site: ['market-snapshot', 'rent-schedule', 'financials'],
    schedule: ['financials']
  };

  // When the browser refuses to store (private mode, blocked site data, a full quota), work is kept in
  // memory for this visit only. The store says so through persistent() and isTemporary(), so no page
  // tells the reader their work is saved when a reload would lose it.
  var memory = {};
  function disk() {
    try { var k = PREFIX + '__probe'; global.localStorage.setItem(k, '1'); global.localStorage.removeItem(k); return global.localStorage; }
    catch (_) { return null; }
  }
  function read(key, fallback) {
    try {
      var k = PREFIX + key, d = disk();
      var raw = k in memory ? memory[k] : d ? d.getItem(k) : null;
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function write(key, value) {
    var k = PREFIX + key, v = JSON.stringify(value), d = disk();
    if (d) { try { d.setItem(k, v); delete memory[k]; return; } catch (_) { /* quota or blocked: keep it for this visit */ } }
    memory[k] = v;
  }
  function remove(key) { var k = PREFIX + key, d = disk(); delete memory[k]; if (d) { try { d.removeItem(k); } catch (_) { /* nothing stored */ } } }
  // True when this browser is storing projects; false when everything written this visit lives in memory.
  function persistent() { return !!disk() && !Object.keys(memory).length; }
  // True when this one project would be lost on reload.
  function isTemporary(projectId) { return (PREFIX + 'project.' + projectId) in memory; }

  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function now() { return new Date().toISOString(); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  function index() { var list = read('projects', []); return Array.isArray(list) ? list : []; }
  function saveIndex(list) { write('projects', list); }

  function get(projectId) {
    var p = read('project.' + projectId, null);
    return p && p.version === VERSION && p.projectId === projectId ? p : null;
  }

  function save(p) {
    p.savedAt = now();
    write('project.' + p.projectId, p);
    var list = index().filter(function (x) { return x.projectId !== p.projectId; });
    list.unshift({ projectId: p.projectId, name: p.name, kind: p.kind, jurisdiction: p.jurisdiction, savedAt: p.savedAt });
    saveIndex(list);
    return clone(p);
  }

  function create(opts) {
    opts = opts || {};
    var name = String(opts.name || '').trim();
    if (!name) throw new Error('A project needs a name');
    if (opts.kind !== 'development' && opts.kind !== 'strategy') throw new Error('Kind must be development or strategy');
    var scenarioId = id('scn');
    var p = {
      version: VERSION, projectId: id('prj'), name: name, kind: opts.kind,
      jurisdiction: opts.jurisdiction ? { geoid: String(opts.jurisdiction.geoid), name: String(opts.jurisdiction.name) } : null,
      createdAt: now(), savedAt: null,
      // A development scenario has at most one subject site; a jurisdiction strategy can list several.
      sites: [], scenarios: [{ scenarioId: scenarioId, name: 'Scenario A', siteId: null }],
      attachments: [], overrides: {}, reviews: {}
    };
    return save(p);
  }

  function rename(projectId, name) {
    var p = mustGet(projectId); name = String(name || '').trim();
    if (!name) throw new Error('A project needs a name');
    p.name = name; return save(p);
  }

  function removeProject(projectId) {
    remove('project.' + projectId);
    saveIndex(index().filter(function (x) { return x.projectId !== projectId; }));
  }

  function mustGet(projectId) {
    var p = get(projectId);
    if (!p) throw new Error('No project ' + projectId + ' in this browser');
    return p;
  }
  function mustScenario(p, scenarioId) {
    var s = p.scenarios.filter(function (x) { return x.scenarioId === scenarioId; })[0];
    if (!s) throw new Error('No scenario ' + scenarioId + ' in ' + p.name);
    return s;
  }

  function addScenario(projectId, name, copyFrom) {
    var p = mustGet(projectId);
    var s = { scenarioId: id('scn'), name: String(name || ('Scenario ' + String.fromCharCode(65 + p.scenarios.length))), siteId: null };
    if (copyFrom) {
      var from = mustScenario(p, copyFrom);
      s.siteId = from.siteId;
      p.attachments.filter(function (a) { return a.scenarioId === copyFrom && a.state !== 'replaced'; }).forEach(function (a) {
        var c = clone(a); c.attachmentId = id('att'); c.scenarioId = s.scenarioId; c.copiedFrom = a.attachmentId; p.attachments.push(c);
      });
      if (p.overrides[copyFrom]) p.overrides[s.scenarioId] = clone(p.overrides[copyFrom]);
    }
    p.scenarios.push(s);
    save(p);
    return s.scenarioId;
  }

  // Evidence goes into the project and scenario the visitor chose. There is no default target.
  function attach(projectId, scenarioId, evidence) {
    var p = mustGet(projectId);
    mustScenario(p, scenarioId);
    if (!evidence || !evidence.kind || !evidence.snapshot) throw new Error('Evidence needs a kind and a snapshot');
    if (Object.keys(DEPENDENCIES).every(function (k) { return DEPENDENCIES[k].indexOf(evidence.kind) < 0; }) && evidence.kind !== 'site-reference')
      throw new Error('Unknown evidence kind ' + evidence.kind);
    p.attachments.forEach(function (a) {
      if (a.scenarioId === scenarioId && a.kind === evidence.kind && a.state !== 'replaced') { a.state = 'replaced'; a.replacedAt = now(); }
    });
    var att = {
      attachmentId: id('att'), scenarioId: scenarioId, kind: evidence.kind,
      label: String(evidence.label || evidence.kind),
      snapshot: clone(evidence.snapshot),
      sourceDates: clone(evidence.sourceDates || null),
      methodVersions: clone(evidence.methodVersions || null),
      origin: clone(evidence.origin || null),
      attachedAt: now(), state: 'attached'
    };
    p.attachments.push(att);
    if (evidence.kind === 'rent-schedule') markStale(p, scenarioId, 'schedule', 'Homes and rents changed');
    save(p);
    return att.attachmentId;
  }

  function current(p, scenarioId, kind) {
    return p.attachments.filter(function (a) { return a.scenarioId === scenarioId && a.kind === kind && a.state !== 'replaced'; })[0] || null;
  }

  function markStale(p, scenarioId, change, reason) {
    (DEPENDENCIES[change] || []).forEach(function (kind) {
      p.attachments.forEach(function (a) {
        if ((scenarioId == null || a.scenarioId === scenarioId) && a.kind === kind && a.state === 'attached') {
          a.state = 'stale'; a.staleReason = reason; a.staleAt = now();
        }
      });
      p.scenarios.forEach(function (s) {
        if ((scenarioId == null || s.scenarioId === scenarioId) && p.reviews[s.scenarioId]) delete p.reviews[s.scenarioId][kind];
      });
    });
  }

  function setJurisdiction(projectId, jurisdiction) {
    var p = mustGet(projectId);
    var next = jurisdiction ? { geoid: String(jurisdiction.geoid), name: String(jurisdiction.name) } : null;
    var before = p.jurisdiction;
    if ((before && before.geoid) === (next && next.geoid)) return clone(p);
    p.jurisdiction = next;
    markStale(p, null, 'jurisdiction', 'Place changed from ' + (before ? before.name : 'none') + ' to ' + (next ? next.name : 'none'));
    return save(p);
  }

  function setSite(projectId, scenarioId, site) {
    var p = mustGet(projectId);
    var s = mustScenario(p, scenarioId);
    var newSite = { siteId: id('site'), label: String(site.label || 'Site'), lat: site.lat == null ? null : Number(site.lat), lng: site.lng == null ? null : Number(site.lng), parcel: site.parcel || null };
    if (p.kind === 'development' && s.siteId) markStale(p, scenarioId, 'site', 'Site changed to ' + newSite.label);
    p.sites.push(newSite);
    s.siteId = newSite.siteId;
    save(p);
    return newSite.siteId;
  }

  // The visitor's own changes are stored apart from the attached evidence.
  function setOverride(projectId, scenarioId, key, value) {
    var p = mustGet(projectId); mustScenario(p, scenarioId);
    p.overrides[scenarioId] = p.overrides[scenarioId] || {};
    if (value === undefined) delete p.overrides[scenarioId][key]; else p.overrides[scenarioId][key] = clone(value);
    return save(p);
  }

  // Reviewed means a person looked at the current evidence; it is cleared whenever that evidence goes stale.
  function markReviewed(projectId, scenarioId, kind) {
    var p = mustGet(projectId); mustScenario(p, scenarioId);
    var a = current(p, scenarioId, kind);
    if (!a || a.state !== 'attached') throw new Error('Only current, attached evidence can be marked reviewed');
    p.reviews[scenarioId] = p.reviews[scenarioId] || {};
    p.reviews[scenarioId][kind] = { attachmentId: a.attachmentId, reviewedAt: now() };
    return save(p);
  }

  function stateOf(projectId, scenarioId, kind) {
    var p = mustGet(projectId);
    var a = current(p, scenarioId, kind);
    if (!a) return 'not attached';
    var r = p.reviews[scenarioId] && p.reviews[scenarioId][kind];
    if (a.state === 'stale') return 'stale';
    return r && r.attachmentId === a.attachmentId ? 'reviewed' : 'attached';
  }

  // A deal file or share link carries one scenario: its place, site, current evidence and the visitor's own changes.
  // Opening one makes a new project in this browser; it never changes a project already here. Reviews stay behind,
  // because a review is a person's own check: whoever opens the deal reviews the evidence again.
  var PACKAGE = 'coho-lab-deal';
  var PACKAGE_KINDS = ['place-reference', 'site-reference', 'market-snapshot', 'rent-schedule', 'financials'];
  function exportScenario(projectId, scenarioId) {
    var p = mustGet(projectId), s = mustScenario(p, scenarioId);
    var site = s.siteId ? p.sites.filter(function (x) { return x.siteId === s.siteId; })[0] || null : null;
    return {
      format: PACKAGE, version: VERSION, exportedAt: now(),
      project: { name: p.name, kind: p.kind, jurisdiction: clone(p.jurisdiction) },
      scenario: { name: s.name, site: site ? { label: site.label, lat: site.lat, lng: site.lng, parcel: clone(site.parcel) } : null },
      attachments: p.attachments.filter(function (a) { return a.scenarioId === scenarioId && a.state !== 'replaced'; }).map(function (a) {
        var c = clone(a); c.ref = a.attachmentId; delete c.scenarioId; delete c.attachmentId; delete c.copiedFrom; return c;
      }),
      overrides: clone(p.overrides[scenarioId] || {})
    };
  }
  // Checks a package before anything is saved. Returns the reason it cannot be opened, or null.
  function packageProblem(pkg) {
    if (!pkg || typeof pkg !== 'object' || pkg.format !== PACKAGE) return 'This is not a COHO lab deal file.';
    if (pkg.version !== VERSION) return 'This deal file is from another version of the lab (' + String(pkg.version) + ').';
    var pr = pkg.project, sc = pkg.scenario;
    if (!pr || typeof pr.name !== 'string' || !pr.name.trim() || pr.name.length > 200) return 'The deal file has no project name.';
    if (pr.kind !== 'development' && pr.kind !== 'strategy') return 'The deal file has an unknown project kind.';
    if (pr.jurisdiction != null && !(pr.jurisdiction && /^\d{2,7}$/.test(String(pr.jurisdiction.geoid)) && typeof pr.jurisdiction.name === 'string')) return 'The deal file has an unreadable place.';
    if (!sc || typeof sc.name !== 'string' || sc.name.length > 200) return 'The deal file has no scenario.';
    if (!Array.isArray(pkg.attachments)) return 'The deal file has no evidence list.';
    var seen = {};
    for (var i = 0; i < pkg.attachments.length; i++) {
      var a = pkg.attachments[i];
      if (!a || PACKAGE_KINDS.indexOf(a.kind) < 0 || !a.snapshot || typeof a.snapshot !== 'object') return 'The deal file holds evidence the lab does not know.';
      if (a.state !== 'attached' && a.state !== 'stale') return 'The deal file holds evidence in an unknown state.';
      if (seen[a.kind]) return 'The deal file holds two current copies of the same evidence.';
      seen[a.kind] = true;
    }
    if (pkg.overrides != null && (typeof pkg.overrides !== 'object' || Array.isArray(pkg.overrides))) return 'The deal file has unreadable changes.';
    return null;
  }
  function importScenario(pkg, how, scheduleMatched) {
    var problem = packageProblem(pkg);
    if (problem) throw new Error(problem);
    var p = create({ name: pkg.project.name.trim(), kind: pkg.project.kind, jurisdiction: pkg.project.jurisdiction });
    p = get(p.projectId);
    var s = p.scenarios[0];
    s.name = pkg.scenario.name.trim() || s.name;
    var site = pkg.scenario.site;
    if (site) {
      var ns = { siteId: id('site'), label: String(site.label || 'Site'), lat: site.lat == null ? null : Number(site.lat), lng: site.lng == null ? null : Number(site.lng), parcel: clone(site.parcel) || null };
      p.sites.push(ns); s.siteId = ns.siteId;
    }
    var ids = {};
    pkg.attachments.forEach(function (a) {
      var c = clone(a); c.attachmentId = id('att'); c.scenarioId = s.scenarioId;
      if (c.ref) ids[c.ref] = c.attachmentId;
      delete c.ref; p.attachments.push(c);
    });
    // A saved Financials run names the rent schedule it ran on; point it at that schedule's new copy.
    p.attachments.forEach(function (a) {
      if (a.kind === 'financials' && a.snapshot.scheduleAttachmentId) a.snapshot.scheduleAttachmentId = ids[a.snapshot.scheduleAttachmentId] || null;
    });
    if (pkg.overrides && Object.keys(pkg.overrides).length) p.overrides[s.scenarioId] = clone(pkg.overrides);
    p.openedFrom = { how: how === 'share-link' ? 'share-link' : 'deal-file', exportedAt: String(pkg.exportedAt || ''), openedAt: now(), scheduleMatched: typeof scheduleMatched === 'boolean' ? scheduleMatched : null };
    save(p);
    return { projectId: p.projectId, scenarioId: s.scenarioId };
  }

  // One-time import of live-site browser records. Shows what exists; copies only what the visitor picks,
  // into a project the visitor names. Never runs on its own and never writes the live-site keys.
  function legacyPreview() {
    var out = { subject: null, projects: [] };
    try {
      var subject = global.localStorage.getItem(LEGACY.subject);
      if (subject) out.subject = JSON.parse(subject);
      var list = JSON.parse(global.localStorage.getItem(LEGACY.projects) || '[]');
      if (Array.isArray(list)) out.projects = list.map(function (x) { return { id: x.id, name: x.name, jurisdictionName: x.jurisdictionName || null }; });
    } catch (_) { /* unreadable records are left alone */ }
    return out;
  }

  function importLegacySubject(projectId, scenarioId) {
    var preview = legacyPreview();
    if (!preview.subject) throw new Error('No live-site subject record in this browser');
    return attach(projectId, scenarioId, { kind: 'site-reference', label: 'Imported from this browser’s Subject Project', snapshot: preview.subject, origin: { importedFrom: LEGACY.subject } });
  }

  global.LabProjects = { persistent: persistent, isTemporary: isTemporary,
    list: function () { return clone(index()); },
    get: function (projectId) { return clone(get(projectId)); },
    create: create, rename: rename, remove: removeProject, addScenario: addScenario,
    attach: attach, setJurisdiction: setJurisdiction, setSite: setSite, setOverride: setOverride,
    markReviewed: markReviewed, stateOf: stateOf,
    exportScenario: exportScenario, importScenario: importScenario, packageProblem: packageProblem,
    legacyPreview: legacyPreview, importLegacySubject: importLegacySubject,
    DEPENDENCIES: DEPENDENCIES
  };
})(typeof window !== 'undefined' ? window : globalThis);
