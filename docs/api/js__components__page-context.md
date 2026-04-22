# `js/components/page-context.js`

js/components/page-context.js
Page-purpose disclosure: "What this page does / Why it matters / What it does NOT do"

Renders a compact, collapsible context block at the top of analysis pages.
Helps users understand scope before diving into data.

Usage (declarative):
  <div id="pageContext"
    data-ctx-what="Screening-level housing needs snapshot using public Census, DOLA, and HUD data."
    data-ctx-why="LIHTC applications require documented community need. This tool helps identify where need is greatest before commissioning a formal study."
    data-ctx-not="This is not a certified housing needs study, CHFA-required market analysis, or professional due diligence report.">
  </div>

Or imperative:
  PageContext.render('pageContext', {
    what: '...',
    why: '...',
    not: '...',
    nextSteps: [{ label: 'Market Analysis', href: 'market-analysis.html', desc: 'Score a specific site' }]
  });

Exposes window.PageContext.

## Symbols

### `safeHref(url)`

Sanitize href — block javascript: URIs
