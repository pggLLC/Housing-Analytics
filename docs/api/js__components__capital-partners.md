# `js/components/capital-partners.js`

js/components/capital-partners.js — F138
=========================================
Renders a "Capital partners" section for any HNA / OF / Compare
jurisdiction view. Pulls from data/capital-partners.json — a
curated roster of CHFA, USDA RD, DOLA, Enterprise, LISC, Mercy,
FHLB, Fannie / Freddie, and selected impact lenders covering CO.

The component is geography-agnostic by default (all partners are
statewide or national). The caller can pass a hint like
`{ dealTypes: ['lihtc-4pct','preservation'] }` to surface only
partners aligned to the deal type the user is scoping.

Usage:
  CapitalPartners.attach(containerEl, {
    dealTypes: ['lihtc-4pct','preservation'],   // optional
    jurisName: 'Glenwood Springs'              // for header
  });

Caches the JSON fetch so repeat attaches don't re-fetch.

_No documented symbols — module has a file-header comment only._
