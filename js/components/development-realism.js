/**
 * js/components/development-realism.js
 * Development Realism Module — surfaces real-world LIHTC development
 * factors that public data cannot capture.
 *
 * Renders educational/checklist panels for:
 *  1. Public-Private Partnerships (housing authority, nonprofit, land)
 *  2. Colorado-Specific Factors (tax exemption, CHFA, state credits)
 *  3. Project Type Guidance (family, senior, PSH, veterans, workforce)
 *  4. Community Realities (outreach, NIMBY, council approvals)
 *  5. Fatal Flaw Screening (environmental, entitlement, infrastructure)
 *
 * These are NOT scored — they are checklists and educational context
 * that help users think beyond the quantitative models.
 *
 * Usage:
 *   DevRealism.renderPartnershipPanel('pppPanel');
 *   DevRealism.renderFatalFlawChecklist('fatalFlawPanel');
 *   DevRealism.renderProjectTypeGuidance('projectTypePanel', { conceptType: 'family' });
 *   DevRealism.renderCommunityChecklist('communityPanel');
 *   DevRealism.renderColoradoFactors('coFactorsPanel', { countyFips: '08031' });
 *
 * Exposes window.DevRealism.
 */
(function () {
  'use strict';

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _panel(title, icon, content) {
    return '<details class="devr-panel">' +
      '<summary class="devr-summary">' + icon + ' ' + title + '</summary>' +
      '<div class="devr-body">' + content + '</div>' +
      '</details>';
  }

  function _checklist(items) {
    return '<ul class="devr-checklist">' +
      items.map(function (item) {
        var cls = item.flag || '';
        var flagBadge = '';
        if (item.flag === 'fatal')   flagBadge = '<span class="devr-flag devr-flag--fatal">Fatal Flaw</span>';
        if (item.flag === 'verify')  flagBadge = '<span class="devr-flag devr-flag--verify">Needs Verification</span>';
        if (item.flag === 'strong')  flagBadge = '<span class="devr-flag devr-flag--strong">Strong Signal</span>';
        return '<li class="devr-item devr-item--' + cls + '">' +
          '<label class="devr-check-label">' +
            '<input type="checkbox" class="devr-checkbox">' +
            '<span class="devr-item-text">' + esc(item.text) + '</span>' +
          '</label>' +
          flagBadge +
          (item.note ? '<div class="devr-item-note">' + esc(item.note) + '</div>' : '') +
          '</li>';
      }).join('') +
      '</ul>';
  }

  /* ── 1. Public-Private Partnerships ──────────────────────────────── */
  function renderPartnershipPanel(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var content =
      '<p class="devr-intro">LIHTC projects rarely succeed without partnerships. CHFA QAP scoring rewards projects with local support, nonprofit involvement, and public land contributions. Consider these partnership structures early.</p>' +

      '<h4 class="devr-subhead">Housing Authority Partnership</h4>' +
      _checklist([
        { text: 'Identify the local housing authority (PHA) for your jurisdiction', note: 'Colorado has 60+ housing authorities. Some are county-wide, others city-specific.' },
        { text: 'Determine if PHA is willing to serve as co-general partner or owner', flag: 'strong', note: 'PHA ownership enables property tax exemption (saves $500-$2,000/unit/year in Colorado).' },
        { text: 'Explore PILOT agreement (Payment in Lieu of Taxes)', note: 'Even partial tax exemption improves NOI significantly. Negotiate PILOT terms early.' },
        { text: 'Assess PHA capacity for asset management and compliance', note: 'Some PHAs lack staff for LIHTC compliance. Consider third-party management.' },
        { text: 'Check if PHA has project-based vouchers (PBVs) available', flag: 'strong', note: 'PBVs at 30% AMI units dramatically improve operating income and debt capacity.' },
      ]) +

      '<h4 class="devr-subhead">Nonprofit Co-Developer</h4>' +
      _checklist([
        { text: 'Identify active CHDOs (Community Housing Development Organizations) in the area', flag: 'strong', note: 'CHFA QAP gives significant preference to nonprofit sponsors. CHDO status unlocks HOME funds.' },
        { text: 'Evaluate joint venture structure (developer fee split, co-GP roles)', note: 'Typical split: 50/50 to 70/30 developer fee. Nonprofit usually takes managing member role.' },
        { text: 'Confirm nonprofit has 501(c)(3) status and housing mission', note: 'IRS determination letter required. Mission must include affordable housing.' },
      ]) +

      '<h4 class="devr-subhead">Land Contributions</h4>' +
      _checklist([
        { text: 'Check if any public entity (city, county, school district, RTD) has surplus land', flag: 'strong', note: 'Below-market land is a critical soft source. Can reduce TDC by $1M+ on metro sites.' },
        { text: 'Explore land donation or long-term ground lease (55-75 year)', note: 'Ground leases keep land in public hands. Lenders generally accept 55+ year terms.' },
        { text: 'Assess if land requires rezoning, environmental remediation, or infrastructure', flag: 'verify', note: 'Free land with entitlement risk may cost more than purchased land without it.' },
      ]);

    el.innerHTML = _panel('Public-Private Partnerships', '🤝', content);
  }

  /* ── 2. Colorado-Specific Factors ────────────────────────────────── */
  function renderColoradoFactors(containerId, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;
    opts = opts || {};

    var content =
      '<p class="devr-intro">Colorado has specific regulatory and financial mechanisms that materially affect LIHTC feasibility. These factors are not modeled in the calculator but should inform your development strategy.</p>' +

      '<h4 class="devr-subhead">Property Tax Exemption</h4>' +
      _checklist([
        { text: 'Housing authority ownership qualifies for full property tax exemption under Colorado law', flag: 'strong', note: 'Saves $500-$2,000/unit/year. This is NOT modeled in the deal calculator — add it to your NOI manually.' },
        { text: 'Qualifying 501(c)(3) nonprofit ownership may qualify for partial exemption', note: 'Varies by county assessor interpretation. Confirm with county before underwriting.' },
        { text: 'Property tax exemption improves NOI, which increases supportable first mortgage debt', note: 'For a 60-unit project at $1,000/unit/year savings: $60K/year NOI improvement supports ~$750K additional debt.' },
      ]) +

      '<h4 class="devr-subhead">CHFA Competitiveness</h4>' +
      _checklist([
        { text: 'Review current year CHFA Qualified Allocation Plan (QAP) priorities', flag: 'verify', note: 'QAP changes annually. 2025-2026 priorities may differ from historical patterns used in this tool.' },
        { text: 'Check CHFA geographic distribution preferences (rural vs. urban set-asides)', note: 'CHFA\u2019s current QAP specifies any non-metro set-aside percentages and geographic-distribution scoring weights. Pull the figure from the current QAP rather than relying on prior-year memory \u2014 the split changes.' },
        { text: 'Confirm project type aligns with CHFA priority populations (seniors, families, PSH)', note: 'Serving priority populations adds QAP points. Check current QAP for specific point values.' },
        { text: 'Assess readiness-to-proceed factors (site control, zoning, financing commitments)', note: 'CHFA increasingly weights projects that can close quickly after award.' },
      ]) +

      '<h4 class="devr-subhead">State Housing Tax Credit (HB 24-1007)</h4>' +
      _checklist([
        { text: 'Colorado enacted a state LIHTC effective for 2025 allocations', flag: 'strong', note: 'This new credit layer is NOT modeled in the deal calculator. It can fill gap financing for qualifying projects.' },
        { text: 'Determine eligibility requirements and application timeline', flag: 'verify', note: 'Program details are evolving. Contact CHFA for current guidance.' },
      ]) +

      '<h4 class="devr-subhead">Additional Colorado Sources</h4>' +
      _checklist([
        { text: 'CHFA Housing Trust Fund (HTF) — gap financing for LIHTC projects' },
        { text: 'DOLA Division of Housing (DOH) — state gap funding, typically $500K-$2M per project' },
        { text: 'HOME Investment Partnership funds — available through participating jurisdictions' },
        { text: 'Prop 123 — state funding for affordable housing; check jurisdiction commitment status', note: 'Use the Compliance Dashboard to verify your jurisdiction\'s Prop 123 status.' },
        { text: 'Local housing trust funds (Denver, Boulder, Fort Collins have dedicated funds)', note: 'County-level soft funding estimates are in the deal calculator but may not reflect current availability.' },
      ]);

    el.innerHTML = _panel('Colorado-Specific Factors', '🏔', content);
  }

  /* ── 3. Project Type Guidance ────────────────────────────────────── */
  function renderProjectTypeGuidance(containerId, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;
    opts = opts || {};

    var content =
      '<p class="devr-intro">Project type affects every aspect of development: unit mix, AMI targeting, operating costs, QAP scoring, and partnership structure. The deal calculator models 4 concept types — here is what to consider for each.</p>' +

      '<h4 class="devr-subhead">Family Housing</h4>' +
      '<div class="devr-type-card">' +
        '<div class="devr-type-specs">Typical: 60-100 units | 2-3 BR focus | 30-60% AMI | 9% credit preferred</div>' +
        '<div class="devr-type-notes">Highest demand in most Colorado markets. Requires playground/outdoor space, larger units increase hard costs. School quality is a key site selection factor. Community opposition risk is highest for family projects (perceived traffic, school crowding).</div>' +
      '</div>' +

      '<h4 class="devr-subhead">Senior Housing (55+ or 62+)</h4>' +
      '<div class="devr-type-card">' +
        '<div class="devr-type-specs">Typical: 50-80 units | Studio-1BR focus | 40-60% AMI | 4% or 9% credit</div>' +
        '<div class="devr-type-notes">Lower operating costs (less turnover, less wear). Senior projects often face less community opposition. Requires ADA compliance, elevator, common areas. Consider proximity to medical facilities, transit, and grocery. Colorado senior population growing fastest in mountain and resort communities.</div>' +
      '</div>' +

      '<h4 class="devr-subhead">Permanent Supportive Housing (PSH)</h4>' +
      '<div class="devr-type-card">' +
        '<div class="devr-type-specs">Typical: 40-60 units | Studio-1BR | 30% AMI + services | 9% credit | requires operating subsidy</div>' +
        '<div class="devr-type-notes">Serves chronically homeless, persons with disabilities, or those exiting institutions. Requires ongoing service funding (Medicaid, VA, local grants). Higher operating costs ($2,000-$4,000/unit/year for services). Strong QAP preference but complex underwriting. Requires experienced property management with social service expertise.</div>' +
      '</div>' +

      '<h4 class="devr-subhead">Veterans Housing</h4>' +
      '<div class="devr-type-card">' +
        '<div class="devr-type-specs">Typical: 30-60 units | Studio-2BR | 30-50% AMI | VASH vouchers | 9% credit</div>' +
        '<div class="devr-type-notes">HUD-VASH vouchers provide project-based rental assistance for homeless veterans. VA Supportive Housing provides wraparound services. Strong QAP set-aside in Colorado. Requires partnership with local VA Medical Center and Continuum of Care.</div>' +
      '</div>' +

      '<h4 class="devr-subhead">Workforce Housing (60-80% AMI)</h4>' +
      '<div class="devr-type-card">' +
        '<div class="devr-type-specs">Typical: 80-150 units | 1-3BR | 60-80% AMI | 4% credit (bond-financed) | mixed-income possible</div>' +
        '<div class="devr-type-notes">Targets essential workers (teachers, nurses, first responders). Often uses 4% credits with tax-exempt bonds for larger scale. May include market-rate units in mixed-income structure. Lower QAP competitiveness for 9% credits but strong community support. Consider inclusionary zoning compliance.</div>' +
      '</div>';

    el.innerHTML = _panel('Project Type Guidance', '🏗', content);
  }

  /* ── 4. Community Realities ──────────────────────────────────────── */
  function renderCommunityChecklist(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var content =
      '<p class="devr-intro">Community engagement and political feasibility are the #1 non-financial risk in affordable housing development. A site that scores perfectly on every metric can still fail if the city council votes no. CHFA QAP scoring rewards demonstrated community support.</p>' +

      '<h4 class="devr-subhead">Community Outreach (CHFA expects this)</h4>' +
      _checklist([
        { text: 'Hold at least one community information meeting before application', note: 'CHFA QAP awards points for documented community engagement. Record attendance and feedback.' },
        { text: 'Meet with immediate neighbors and neighborhood association leadership', flag: 'verify', note: 'Early engagement reduces opposition. Listen to concerns before presenting plans.' },
        { text: 'Brief the city/county council member for the project district', note: 'Council support (or at minimum non-opposition) is critical for land use approvals.' },
        { text: 'Engage local school district if serving families', note: 'Address school capacity concerns proactively. Some districts welcome enrollment growth.' },
      ]) +

      '<h4 class="devr-subhead">Political Feasibility</h4>' +
      _checklist([
        { text: 'Assess current council/commission composition on affordable housing', flag: 'verify', note: 'Has this body approved or denied affordable housing projects recently? Research voting records.' },
        { text: 'Check if the jurisdiction has an affordable housing plan or goals', flag: 'strong', note: 'Jurisdictions with adopted housing plans are more likely to support LIHTC applications.' },
        { text: 'Identify potential NIMBY opposition and prepare response strategy', note: 'Common concerns: traffic, parking, property values, school crowding, "character of the neighborhood." Have data-driven responses ready.' },
        { text: 'Determine if the site requires a public hearing (rezoning, CUP, site plan)', flag: 'verify', note: 'Public hearings create opportunities for organized opposition. Build support early.' },
      ]) +

      '<h4 class="devr-subhead">Approvals & Entitlements</h4>' +
      _checklist([
        { text: 'Confirm current zoning allows multifamily residential', flag: 'fatal', note: 'If rezoning is required, add 6-18 months to your timeline and significant political risk.' },
        { text: 'Check if a Conditional Use Permit (CUP) is required', flag: 'verify', note: 'CUPs add discretionary review and public hearing requirements.' },
        { text: 'Estimate site plan review timeline (typically 3-9 months)', note: 'Factor review timeline into your CHFA application readiness-to-proceed assessment.' },
        { text: 'Confirm utility capacity (water, sewer, electric) with service providers', flag: 'fatal', note: 'Will-serve letters from utilities are required for construction financing. Some rural areas have capacity constraints.' },
      ]);

    el.innerHTML = _panel('Community & Political Realities', '🏛', content);
  }

  /* ── 5. Fatal Flaw Screening ─────────────────────────────────────── */
  function renderFatalFlawChecklist(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var content =
      '<p class="devr-intro">Screen for fatal flaws BEFORE investing in full analysis. Any single item marked "Fatal Flaw" can kill a project regardless of how strong the market or financial analysis looks. These checks should happen at site visit, not at application.</p>' +

      '<h4 class="devr-subhead">Environmental</h4>' +
      _checklist([
        { text: 'Site is NOT in a FEMA floodway (Zone AE floodway = unbuildable)', flag: 'fatal', note: 'Floodway is different from floodplain. Floodplain can be mitigated; floodway cannot. Check FEMA Map Service Center.' },
        { text: 'No known soil contamination, underground storage tanks, or superfund adjacency', flag: 'fatal', note: 'Phase I ESA will reveal these. Remediation can cost $500K-$5M+ and take 1-3 years.' },
        { text: 'No protected species habitat, wetlands, or waters of the US on site', flag: 'verify', note: 'Army Corps 404 permit for wetland fill takes 12-24 months. May require mitigation banking.' },
        { text: 'Site is not in a wildfire-urban interface (WUI) zone requiring excessive mitigation', flag: 'verify', note: 'WUI designation in mountain communities can add $10K-$30K/unit in fire mitigation costs.' },
      ]) +

      '<h4 class="devr-subhead">Access & Infrastructure</h4>' +
      _checklist([
        { text: 'Site has legal access from a public road', flag: 'fatal', note: 'Landlocked parcels without recorded easements are not developable.' },
        { text: 'Municipal water and sewer are available (or can be extended at reasonable cost)', flag: 'fatal', note: 'Off-site infrastructure extension can cost $1M-$5M. Well/septic systems are rarely feasible for multifamily.' },
        { text: 'Adequate road capacity exists or improvements are funded', flag: 'verify', note: 'Traffic impact study may be required. Developer may be responsible for turn lanes, signals, or road widening.' },
        { text: 'Site has adequate slope and drainage (not >15% grade)', flag: 'verify', note: 'Steep slopes dramatically increase site work costs. Retaining walls can add $500K+ to a project.' },
      ]) +

      '<h4 class="devr-subhead">Legal & Title</h4>' +
      _checklist([
        { text: 'Clear title with no unresolved liens, encumbrances, or boundary disputes', flag: 'fatal', note: 'Title insurance company must be willing to insure. Unresolved title issues stop closings.' },
        { text: 'No existing leases, occupants, or relocation requirements', flag: 'verify', note: 'Uniform Relocation Act (URA) applies to federally-funded projects. Relocation can cost $10K-$50K per household.' },
        { text: 'Site control available (purchase option, ground lease, development agreement, or LOI)', flag: 'verify', note: 'CHFA requires site control documentation. Purchase options typically need 12-24 month terms. Ground lease is common for housing-authority or PHA land — lease must run ≥50 years to meet LIHTC long-term-affordability requirements and support financing.' },
      ]) +

      '<h4 class="devr-subhead">Market & Timing</h4>' +
      _checklist([
        { text: 'No moratorium on residential development in the jurisdiction', flag: 'fatal', note: 'Some Colorado jurisdictions have enacted building moratoriums. Check with planning department.' },
        { text: 'Construction labor availability in the local market', flag: 'verify', note: 'Mountain and rural communities face severe labor shortages. Factor travel time/lodging into construction costs.' },
        { text: 'Realistic construction timeline aligns with CHFA placed-in-service deadlines', flag: 'verify', note: '9% credits: must be placed in service within 24 months of allocation. 4% bonds: within 24 months of bond issuance.' },
      ]);

    el.innerHTML = _panel('Fatal Flaw Screening', '⚠', content);
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  window.DevRealism = {
    renderPartnershipPanel:    renderPartnershipPanel,
    renderColoradoFactors:     renderColoradoFactors,
    renderProjectTypeGuidance: renderProjectTypeGuidance,
    renderCommunityChecklist:  renderCommunityChecklist,
    renderFatalFlawChecklist:  renderFatalFlawChecklist
  };
})();
