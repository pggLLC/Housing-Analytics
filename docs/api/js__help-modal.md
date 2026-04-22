# `js/help-modal.js`

help-modal.js — COHO Analytics
Reusable "How to Use This Page" help modal component.

Usage:
  CohoHelp.init({
    title: 'How to Use This Page',
    description: 'Optional intro text…',
    steps: [
      { label: 'Step label', desc: 'Step description.' },
      …
    ],
    tips: ['Tip one', 'Tip two'],   // optional
  });

This creates a "?" button appended to the first <h1> on the page and wires
it to a fully accessible modal dialog.

_No documented symbols — module has a file-header comment only._
