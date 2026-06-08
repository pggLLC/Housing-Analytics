# `js/components/pipeline-store.js`

js/components/pipeline-store.js — F161
===============================================================
In-browser CRUD layer for IndiBuild Pipeline jurisdictions, now
built on top of a generic `createIbStore` factory so the same
draft / edit / delete / export machinery can back additional
stores (signals, anti-targets, network) without copy-paste.

Two surfaces are exposed:
  1. window.IbCsvStore  — the generic factory:
       createIbStore({ csvUrl, storageNamespace, headers, enumLists })
     Future stores can call this directly with their own csvUrl,
     namespace and headers; `enumLists` is optional.
  2. window.PipelineStore — the pipeline-specific instance,
     preserving its original public API exactly:
       loadCanonical, getDrafts, addDraft, updateDraft,
       removeDraft, editCanonical, clearCanonicalEdit,
       getCanonicalEdits, queueDelete, unqueueDelete,
       getQueuedDeletes, merge, exportCsv, clearAll, counts,
       HEADERS, STAGES, CONFIDENCES, CLASSIFICATIONS,
       CSV_URL, parseCsvText.

The canonical source for the pipeline is
docs/indibuild-pipeline-prototype/02-pipeline.csv (read-only via
fetch). The local layer adds a localStorage cache of:
  - DRAFTS: new rows (added in-app, not yet in the canonical CSV)
  - EDITS:  field-level overrides on canonical rows
  - DELETES: queued removals of canonical rows

Row shape for the pipeline store (matches 02-pipeline.csv header):
  {
    jurisdiction, geoid, stage, ioi_score, confidence, classification,
    product_type, last_update, next_action, next_action_due, notes,
    _isDraft? boolean, _hasLocalEdits? boolean, _queuedForDelete? boolean
  }

Storage keys are versioned (KEY_V = "v1") so a future schema
change can migrate. A console.info fires if any legacy-shaped key
(without the version suffix) is detected for the configured
namespace — scaffolding for a future migration helper, no
auto-migrate today.

_No documented symbols — module has a file-header comment only._
