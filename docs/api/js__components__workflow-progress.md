# `js/components/workflow-progress.js`

workflow-progress.js — COHO Analytics
Reusable 5-step workflow progress bar component.

Reads step completion from WorkflowState when available, so each page no
longer needs to inline duplicate progress-bar styles and markup.

Usage:
  WorkflowProgress.render('myContainerId', 2);
  WorkflowProgress.render('myContainerId', 3, { doneSteps: [1, 2] });
  WorkflowProgress.refresh('myContainerId');

Requires: workflow-state.js (optional but recommended)

_No documented symbols — module has a file-header comment only._
