# `js/components/workflow-progress.js`

workflow-progress.js — COHO Analytics
Reusable 7-step workflow progress bar component.

Reads step completion from WorkflowState when available, so each page no
longer needs to inline duplicate progress-bar styles and markup.

Usage:
  WorkflowProgress.render('myContainerId', 2);
  WorkflowProgress.render('myContainerId', 3, { doneSteps: [1, 2] });
  WorkflowProgress.refresh('myContainerId');

Requires: workflow-state.js (optional but recommended)

## Symbols

### `getProduct()`

The product the reader chose, or null when none has been chosen. The
 active project's choice wins; a per-browser copy covers a reader who
 chose before any project existed.

### `stepsFor(product)`

STEPS as they apply to a product. Overridden slots carry `routed: true`
 and an `action` sentence for the next-step banner; slots with a second
 page carry `companion: { label, href, action }`.
