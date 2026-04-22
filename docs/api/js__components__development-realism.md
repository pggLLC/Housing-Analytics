# `js/components/development-realism.js`

js/components/development-realism.js
Development Realism Module — surfaces real-world LIHTC development
factors that public data cannot capture.

Renders educational/checklist panels for:
 1. Public-Private Partnerships (housing authority, nonprofit, land)
 2. Colorado-Specific Factors (tax exemption, CHFA, state credits)
 3. Project Type Guidance (family, senior, PSH, veterans, workforce)
 4. Community Realities (outreach, NIMBY, council approvals)
 5. Fatal Flaw Screening (environmental, entitlement, infrastructure)

These are NOT scored — they are checklists and educational context
that help users think beyond the quantitative models.

Usage:
  DevRealism.renderPartnershipPanel('pppPanel');
  DevRealism.renderFatalFlawChecklist('fatalFlawPanel');
  DevRealism.renderProjectTypeGuidance('projectTypePanel', { conceptType: 'family' });
  DevRealism.renderCommunityChecklist('communityPanel');
  DevRealism.renderColoradoFactors('coFactorsPanel', { countyFips: '08031' });

Exposes window.DevRealism.

_No documented symbols — module has a file-header comment only._
