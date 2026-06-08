# `js/components/inline-glossary.js`

inline-glossary.js — COHO Analytics (F152)
─────────────────────────────────────────────────────────────────
A lightweight, no-dependency component that decorates inline
housing-terminology mentions with hover/focus tooltips.

USAGE (recommended): annotate at write-time
  <abbr data-glossary="AMI">AMI</abbr>
  <abbr data-glossary="LIHTC">LIHTC</abbr>

AUTO-DECORATION (opt-in): on pages that include this script,
the FIRST occurrence of each known term inside elements with
class `js-glossary-auto` will be wrapped in an <abbr> tag.

Opt-out per page:
  <body data-inline-glossary="off">

Why a separate component (and not js/glossary.js)?
  js/glossary.js renders the modal launcher used in the header.
  This component is targeted at *inline* term-on-first-use
  plain-English tooltips for new public pages (F152 IndiBuild
  Pipeline + audit checklist additions to HNA/PMA/OF/Compare).
  Keeping them separate avoids tangling the modal launcher's
  DOM with inline tooltips.

Accessibility:
  - Uses native <abbr title> as a fallback so screen readers and
    non-JS readers still see the definition.
  - The custom tooltip is keyboard-focusable (tabindex=0) and
    dismissable with Escape.
  - aria-describedby wires the tooltip to the term.

_No documented symbols — module has a file-header comment only._
