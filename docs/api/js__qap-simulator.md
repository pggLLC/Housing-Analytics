# `js/qap-simulator.js`

js/qap-simulator.js
CHFA QAP Competitiveness Simulator — Interactive scoring tool

Allows users to toggle individual QAP scoring drivers and see
estimated competitiveness in real time. Wraps the scoring logic
from CHFAAwardPredictor with a fully interactive UI.

Non-goals:
  - Does NOT predict the actual CHFA score (CHFA is the sole arbiter)
  - Does NOT guarantee an award — estimates only
  - Does NOT replace professional pre-application consultation with CHFA

Exposed as window.QAPSimulator (browser) and module.exports (Node).

## Symbols

### `_handleMutualExclusions(changedId)`

Handle mutually exclusive toggles (e.g. PMA high vs mod).

### `render(containerId)`

Render the QAP Simulator into a container element.
@param {string} containerId - DOM id of the mount point
