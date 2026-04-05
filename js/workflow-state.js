// workflow-state.js — Legacy compatibility shim
// Real implementation split into workflow-state-core.js + workflow-state-api.js
// This file is kept for backward compatibility with any external references.
(function() {
  if (window.WorkflowState) return; // Already loaded
  console.warn('workflow-state.js shim: loading split modules. Update script tags to load workflow-state-core.js + workflow-state-api.js directly.');
})();
