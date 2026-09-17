# `js/navigation.js`

navigation.js — Shared site header, nav, drawer, and footer
Injects a consistent header + footer across pages.
Uses site-theme.css variables.

Information Architecture:
─────────────────────────────────────────────────────────────────────────
SCOPING A RENTAL PROJECT (primary workflow):
  LIHTC Guide (start here) → Opportunity Finder (find a market) →
  Select Jurisdiction → HNA → Market Analysis → Scenario Builder →
  Deal Calculator

SCOPING A FOR-SALE PROJECT (entry points):
  Ownership Need, For-Sale Market Study, Deal Calculator,
  Land Value & Negotiation

EXPLORE (comparative & context):
  Compare Jurisdictions, Colorado Deep Dive, CHFA Portfolio,
  Economic Dashboard, LIHTC Allocations, Preservation Tracking

DATA (transparency & quality):
  Data Health, Data Quality, Data Review, Census Explorer

INSIGHTS (news, policy & reference):
  Housing News, Market Insights, Market Intelligence,
  Housing Legislation, CRA Expansion, About COHO
─────────────────────────────────────────────────────────────────────────

## Symbols

### `subsAreActive(items)`

Does this group contain sub-entries, and is one of them the current page?

### `subsOpen(key, items)`

Remembered open/closed state for a collapsible run of sub-entries.

### `renderItems(items, key, renderOne)`

Render one group's items, collapsing each run of isSub entries behind a
disclosure row.

The five assessment views are children of step 3, not steps in their own
right. Rendered flat they added ~400px to a dropdown already taller than
the viewport and pushed steps 4-6 below the fold. Collapsed by default the
menu is its original length; the run expands on demand, and expands itself
when you are already on one of the views.
