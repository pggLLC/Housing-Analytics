/** Honest, self-contained screening-report assembly from a Phase-8 model. */
(function (root, factory) {
  'use strict';
  var api = factory(root && root.ProvenanceLabel);
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../provenance-label.js'));
  if (root) root.MarketStudyReport = api;
}(typeof window !== 'undefined' ? window : this, function (ProvenanceLabel) {
  'use strict';

  var NA = 'not_available';
  var BANNER = 'SCREENING DRAFT — not a completed market study';
  var G2 = "CHAS cannot see above 100% HAMFI, so the 100–120% band's measured pool is structurally zero pending an above-100% income source.";
  var COMPETITIVE = 'Capture scenarios do not account for competing for-sale inventory or pipeline; no supply data source exists yet. A professional market study must supply the competitive set.';
  var HUMILITY = 'Even professionally delineated market areas captured only 44% of actual applicants at the Fruita Mews benchmark; outside-area demand of 9–56% is documented. Treat capture scenarios as screening arithmetic, not achievable-sales claims.';
  var BUYER_POOL = 'potential buyer pool (moderate-income renter households) - not committed demand';
  var FHA = 'Fruita Housing Authority ≠ Federal Housing Administration';
  var VERIFY = 'Verification parties: developer discussions, lender, appraiser, broker, program administrator, and local jurisdiction.';
  var LEGEND = 'Evidence labels distinguish confirmed sources, calculated estimates, owner inputs, and sources awaiting review.';
  var COMMITMENT = 'available is context, never money';
  var SCENARIO = 'scenario, not a prediction';
  var TRANSPARENCY = 'Owner-net transparency warning (conditional): a warning appears here whenever the public recovers all of its subsidy plus a share of the price growth and the owner walks away with less cash than they put in.';
  var INTERNAL_CAVEATS = Object.freeze([
    BANNER, 'Hypothesis to test', 'Values still needed', G2, COMPETITIVE,
    HUMILITY, BUYER_POOL, TRANSPARENCY, FHA, VERIFY, LEGEND, COMMITMENT, SCENARIO
  ]);
  var REQUIRED_CAVEATS = Object.freeze(INTERNAL_CAVEATS.slice());

  /**
   * Plain-language labels, shared with market-study-page.js so the page and
   * the downloaded report can never describe the same field two ways. These
   * only relabel engine field ids; every value shown beside them is still the
   * engine's own.
   */
  var PLAIN_LABELS = Object.freeze({
    stages: Object.freeze({
      household_size_compatibility: 'Household size fits the homes offered',
      first_time_buyer_share: 'Would be first-time buyers',
      tenure_preference: 'Want to own rather than rent',
      down_payment_readiness: 'Have a down payment saved',
      debt_credit_readiness: 'Credit and debts would pass a lender',
      mortgage_readiness: 'Could get a mortgage approved',
      unit_type_preference: 'Would take the home types offered',
      location_preference: 'Would live at this location',
      shared_equity_acceptance: 'Would accept a capped resale price',
      purchase_readiness_window: 'Ready to buy during the sales period',
      contract_fallout: 'Signed contracts that actually close'
    }),
    landFields: Object.freeze({
      appraised_value_treatment: 'How an appraiser values it',
      buyer_mortgageability: 'Can buyers get a mortgage?',
      property_tax_implication: 'Property taxes',
      ground_rent_burden: 'Monthly land fee for the buyer',
      future_affordability: 'What keeps it affordable later',
      public_control: 'How much control the public keeps',
      foreclosure_exposure: 'If an owner is foreclosed on',
      resale_administration: 'Who oversees resales',
      steward_replaceability: 'Can the steward be replaced?',
      public_subsidy_preservation: 'Does the public investment stay in the home?',
      administrative_cost: 'Ongoing administration effort',
      buyer_acceptance: 'How buyers are likely to react',
      legal_document_complexity: 'Legal paperwork',
      failure_risk: 'Main way it could fail',
      initial_benefit: 'Where the upfront savings come from'
    }),
    pending: Object.freeze({
      tdc_build_up: 'a breakdown of total development cost (TDC)',
      land_value: 'the land value',
      phasing: 'the construction phasing',
      hrwc_terms: 'the steward\'s terms (Housing Resources of Western Colorado)',
      development_partner: 'a development partner',
      lender: 'a lender'
    }),
    costs: Object.freeze({
      tdc: 'Total development cost (TDC)',
      hard_cost: 'Construction (hard costs)',
      soft_cost: 'Design, permits, legal and other soft costs',
      developer_fee: 'Developer fee',
      contingency: 'Contingency for overruns',
      sales_cost: 'Sales and marketing',
      financing_cost: 'Construction financing'
    })
  });
  // Engine basis and reason strings, said in words. Translated at display
  // time only: the engines and their own tests keep the original strings.
  var PLAIN_BASES = Object.freeze({
    'Phase-6 modeled effective demand': 'the estimated buyer pool (effective demand)',
    'Phase-6 modeled effective demand cross-tab pool': 'the estimated buyer pool for this income group',
    'Phase-6 modeled effective-demand sensitivity pool': 'the estimated buyer pool under a higher or lower assumption',
    'the Phase-6 contract_fallout survival share': 'the share of signed contracts that actually close'
  });
  var PLAIN_REASONS = Object.freeze({
    pool_zero_see_data_limitations: 'No buyers are counted in the pool here, so no share can be worked out. For the top income group this is the CHAS data gap described in section 6.'
  });
  function plainBasis(basis) { return PLAIN_BASES[basis] || noviceText(basis); }
  function plainReason(reason) { return reason ? (PLAIN_REASONS[reason] || humanize(reason)) : ''; }
  function humanize(id) {
    var words = String(id).replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  function plainLabel(group, id) { return PLAIN_LABELS[group][id] || humanize(id); }
  function plain(text) { return '<p class="plain"><strong>In plain terms:</strong> ' + text + '</p>'; }
  function yesNo(flag, detail) {
    if (typeof flag !== 'boolean') return escape(noviceText(detail));
    return '<strong>' + (flag ? 'Yes' : 'No') + '</strong> — ' + escape(noviceText(detail));
  }
  var ASSISTANCE_ANSWERS = Object.freeze({
    sufficient: '<strong>Yes</strong> — covered at the top of the example\'s help range',
    insufficient: '<strong>No</strong> — still short at the top of the example\'s help range',
    unknown: 'Cannot tell — a figure is missing'
  });

  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unavailable(value) { return value === null || value === undefined || value === NA; }
  function noviceText(value) { return String(value).replace(/\bmodeled\b/gi, 'calculated'); }
  function display(value, kind) {
    if (unavailable(value)) return 'Owner input required';
    if (typeof value !== 'number') return escape(noviceText(value));
    if (kind === 'money') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    if (kind === 'rate') return value.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  function rounded(value, digits) {
    if (unavailable(value)) return 'Owner input required';
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }
  function formatSchedule(values, total) {
    if (!Array.isArray(values)) return display(values);
    var even = values.length > 0 && values.every(function (value) {
      return rounded(value, 2) === rounded(values[0], 2);
    });
    if (even) return '≈' + rounded(values[0], 2) + ' / month × ' + values.length + ' months (total ' + rounded(total, 2) + ')';
    return 'total ' + rounded(total, 2) + ' — ' + values.map(function (value) { return rounded(value, 2); }).join(' · ');
  }
  function formatAnnualClosings(values) {
    if (!Array.isArray(values)) return display(values);
    return values.map(function (value) { return rounded(value, 2); }).join(' · ');
  }
  function zeroPool(figure) { return unavailable(figure.value) && figure.denominator && figure.denominator.value === 0; }
  function formatDenominator(figure, kind) {
    var shown = zeroPool(figure) ? 'None — the pool is empty' : display(figure.value, kind);
    return shown + '<small>denominator: ' + rounded(figure.denominator.value, 2) + ' — ' + escape(plainBasis(figure.denominator.basis)) + '</small>';
  }
  function formatAnnualCapture(values) {
    if (!Array.isArray(values)) return display(values);
    // A pool that had buyers in an earlier year and has none now was used up
    // by sales. A pool with no buyers from the start is a measured zero — for
    // example an entered share of 0 — and saying it was "used up" would be a
    // false explanation.
    var hadBuyers = false;
    return values.map(function (entry, index) {
      var earlierPool = hadBuyers;
      if (entry && entry.denominator && typeof entry.denominator.value === 'number' && entry.denominator.value > 0) hadBuyers = true;
      if (zeroPool(entry)) {
        return 'Year ' + (index + 1) + ': none — ' + (earlierPool
          ? 'the buyer pool is used up by earlier sales'
          : 'the estimated buyer pool is empty from the start');
      }
      return 'Year ' + (index + 1) + ': ' + (unavailable(entry.value) ? display(entry.value) : entry.value.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })) + ' — pool ' + rounded(entry.denominator.value, 2);
    }).join('<br>');
  }
  function badge(value, compact) { return ProvenanceLabel.html(typeof value === 'object' ? value : { classification: value }, { compact: compact !== false }); }
  function table(headers, rows) {
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (item) {
      return '<th>' + escape(item) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  /**
   * Sections that run on fixed example inputs — the land, resale and
   * settlement engines take a set home value, restricted price, four-person
   * AMI and loan terms from market-study-page.js, identical for every
   * jurisdiction. Before this they rendered under a banner saying the figures
   * were the selected jurisdiction's, so Denver and Fruita showed the same
   * dollars as if each were local. The label names the place the figures are
   * NOT from; the page and the report share this one wording.
   */
  function exampleInputsLabel(placeName) {
    return 'Example only \u2014 illustrative inputs, not ' + (placeName ? placeName + '\'s' : 'local') + ' data';
  }
  function exampleInputsDetail() {
    return 'The home value, restricted price, four-person AMI and loan terms behind these figures are fixed example inputs, the same for every jurisdiction. Use them to see how the options behave, not as local numbers.';
  }
  function exampleInputsNote(placeName) {
    return '<p class="warning example-inputs" data-example-inputs="true"><strong>' + escape(exampleInputsLabel(placeName)) + '.</strong> ' + exampleInputsDetail() + '</p>';
  }
  /**
   * Is the study's jurisdiction the example project's own town? Only then may
   * the report carry the example project's name and its named partners.
   */
  function isExampleJurisdiction(scenario, jurisdictionLabel, jurisdictionGeoid) {
    var home = (scenario && scenario.jurisdiction) || {};
    if (!jurisdictionLabel && !jurisdictionGeoid) return true;
    if (jurisdictionGeoid && home.place_geoid) return String(jurisdictionGeoid) === String(home.place_geoid);
    return !!home.name && String(jurisdictionLabel) === String(home.name);
  }
  function reportTitle(scenario, jurisdictionLabel, jurisdictionGeoid) {
    if (isExampleJurisdiction(scenario, jurisdictionLabel, jurisdictionGeoid)) return 'Fruita Commons — For-Sale Fundamental Market Study';
    return (jurisdictionLabel || jurisdictionGeoid) + ' — For-Sale Market Study (screening)';
  }

  function assertComplete(html) {
    INTERNAL_CAVEATS.forEach(function (entry) {
      if (html.indexOf(entry) === -1) throw new Error('MarketStudyReport: required caveat missing: ' + entry);
    });
  }

  /**
   * Every report before this led with nine sections of tables and ended
   * on a screening-draft banner — a reader could fill in all 11 demand-
   * funnel stages correctly and still be handed no sentence saying what
   * the numbers add up to. This puts an answer, or an honest account of
   * why there isn't one yet, at the top — same "the answer, first"
   * pattern already used in js/hna/hna-renderers.js's ownership-need
   * panel. Plain prose only: no badge() calls here, since the exported
   * document's data-provenance-label counts are pinned exactly by
   * BADGE_COUNTS in test/market-study-report.test.js and every value
   * used below is already classified by the sections that compute it.
   */
  function verdictSection(model) {
    var funnel = model.funnel;
    var stageCount = funnel.stages.length;
    var totalStages = Math.max(0, stageCount - 1); // exclude the auto-computed starting-pool row
    var unresolvedList = funnel.unresolvedStages;
    var unresolvedCount = unresolvedList.length;
    if (funnel.effectiveDemand === NA) {
      var resolvedCount = totalStages - unresolvedCount;
      return '<section class="verdict"><h2>The screening answer, so far</h2>' +
        '<p><strong>Not enough local data yet for even a screening-level answer.</strong> ' +
        escape(resolvedCount + ' of ' + totalStages + ' demand-funnel stages have a local share entered') +
        '; the remaining ' + unresolvedCount + ' — ' + escape(unresolvedList.map(function (id) { return plainLabel('stages', id); }).join('; ')) +
        ' — still need one before section 6 (Demand) and section 7 (Capture) can say anything. ' +
        'The rest of this report does not depend on the funnel: costs, land, and settlement math are already complete below.</p>' +
        plain('this report cannot yet say how many local households would buy these homes. Each blank step needs a share backed by local evidence — buyer surveys, lender or broker records, or results from similar projects.') +
        '</section>';
    }
    var thirtyMonth = (model.capture.scenarios || []).filter(function (item) { return item.selloutMonths === 30; })[0];
    var penetration = thirtyMonth ? formatDenominator(thirtyMonth.totalProjectPenetration, 'rate') : null;
    return '<section class="verdict"><h2>The screening answer, so far</h2>' +
      '<p><strong>Effective demand: ' + display(funnel.effectiveDemand) + ' households</strong> against a ' +
      display(model.scenario.program.total_units.value) + '-unit program.' +
      (penetration
        ? ' At a 30-month sellout pace, the program would need to capture ' + penetration +
          ' of that pool. Whether that share is realistic is exactly what section 7 and the ' +
          'competitive-supply gap it discloses exist to inform — this line states the arithmetic, not a conclusion.'
        : '') +
      '</p>' +
      plain('effective demand is the estimated number of local households who could and would buy one of these homes, after every step of the buyer funnel in section 6. The capture share is how much of that group the project would have to sell to. The larger that share, the harder the sales job; a share above 100% means the project needs more buyers than the pool is estimated to hold. It is only as good as the local shares entered.') +
      '</section>';
  }

  function buildReport(model, meta) {
    if (!model || !model.scenario || !model.derived || !model.funnel || !model.capture) {
      throw new Error('MarketStudyReport: a complete Phase-8 buildModel object is required');
    }
    meta = meta || {};
    if (!meta.asOf || !meta.vintages) throw new Error('MarketStudyReport: caller must supply asOf and vintages');
    var suppliedCaveats = meta.requiredCaveats || INTERNAL_CAVEATS;
    INTERNAL_CAVEATS.forEach(function (entry) {
      if (suppliedCaveats.indexOf(entry) === -1) throw new Error('MarketStudyReport: required caveat manifest is incomplete: ' + entry);
    });

    var scenario = model.scenario;
    // The program comes from the example scenario; the market half may come
    // from the reader's own jurisdiction. An exported report that named the
    // example town while quoting another town's home value would be the
    // worst of both — it leaves the building as a PDF nobody can re-check.
    var baseline = model.localBaseline || scenario.local_baseline;
    var jurisdictionLabel = meta.jurisdictionLabel || scenario.jurisdiction.name;
    var atHome = isExampleJurisdiction(scenario, meta.jurisdictionLabel, meta.jurisdictionGeoid);
    var title = reportTitle(scenario, meta.jurisdictionLabel, meta.jurisdictionGeoid);
    var exampleNote = exampleInputsNote(jurisdictionLabel);
    var mixRows = scenario.program.unit_mix.map(function (row) {
      return '<tr><td>' + display(row.count) + '</td><td>' + display(row.bedrooms) + '</td><td>' + display(row.sqft_range[0]) + '–' + display(row.sqft_range[1]) + ' sq ft</td><td>' + badge(row) + '</td></tr>';
    });
    var amiRows = scenario.program.ami_mix.map(function (row) {
      return '<tr><td>' + display(row.band[0], 'rate') + '–' + display(row.band[1], 'rate') + '</td><td>' + display(row.count) + '</td><td>' + badge(row) + '</td></tr>';
    });
    var partnerRows = scenario.partners.map(function (row) {
      // The candidates are the example town's organisations. Elsewhere they
      // would read as local partners, so only the role is carried over.
      var candidate = atHome ? display(row.name || row.provider_id) : 'None identified for ' + escape(jurisdictionLabel);
      return '<tr><td>' + escape(humanize(row.role)) + '</td><td>' + candidate + '</td><td>candidate — no commitment</td><td>' + badge(row) + '</td></tr>';
    });
    var project = '<section><h2>1. Project summary</h2>' + plain('the example project being screened: how many homes, what sizes, how many are priced for each income group, and who might build and run it. The project is an example; the market figures in section 2 are for the jurisdiction named here.') + '<p><strong>Jurisdiction:</strong> ' + escape(jurisdictionLabel) + '</p><p><strong>Total homes:</strong> ' + display(scenario.program.total_units.value) + ' ' + badge(scenario.program.total_units) + '</p><p><strong>Home type:</strong> ' + display(scenario.program.tenure_form.value) + ' ' + badge(scenario.program.tenure_form) + '</p><h3>Unit mix and sizes</h3>' + table(['Homes', 'Bedrooms', 'Size', 'Where the number comes from'], mixRows) + '<h3>Homes by income group</h3>' + table(['Income group (AMI band)', 'Homes', 'Where the number comes from'], amiRows) + '<h3>Partners</h3>' + table(['Role', 'Candidate', 'Status', 'Where the number comes from'], partnerRows) + '<p class="warning"><strong>Not the same agency:</strong> ' + FHA + '. The first is the local housing authority named as a possible land owner; the second is the federal agency that insures some home mortgages. They are different bodies.</p></section>';

    var bandRows = model.derived.bands.map(function (row) {
      return '<tr><td>' + display(row.band[0], 'rate') + '–' + display(row.band[1], 'rate') + '</td><td>' + display(row.count) + '</td><td>' + display(row.maxAffordablePrice, 'money') + '</td><td>' + display(row.gapVsLocalPrice, 'money') + '</td><td>' + (ASSISTANCE_ANSWERS[row.assistanceRangeCheck] || escape(row.assistanceRangeCheck)) + '</td><td>' + badge(row) + '</td></tr>';
    });
    var selectedOutcome = model.selectedConvention.results[model.selectedYear];
    var affordability = '<section><h2>2. Affordability &amp; gap</h2>' + plain('for each income group, the most a household in the middle of that group could pay — counting the mortgage payment, property taxes, homeowner\'s insurance and mortgage insurance — and how far that falls short of the typical local home value (the gap). The last money column asks whether the down-payment help assumed for the example project could close the gap; that help is an example assumption, not a list of programs available in this jurisdiction.') + '<p><strong>Typical local home value:</strong> ' + display(baseline.home_value.value, 'money') + ' — ' + escape(baseline.home_value.source || 'owner input required') + ' (' + badge(baseline.home_value) + ')</p>' + table(['Income group (AMI band)', 'Homes', 'Most they could pay', 'Gap to typical home value', 'Could the example\'s down-payment help close it?', 'Where the number comes from'], bandRows) + exampleNote + '<p><strong>Income the next buyer would need at resale (year ' + escape(model.selectedYear) + ', ' + escape(model.selectedConvention.conventionLabel) + ' formula):</strong> ' + display(selectedOutcome.futureBuyerIncomeNeeded, 'money') + ' ' + badge(selectedOutcome) + '</p></section>';

    var costs = Object.keys(scenario.costs).map(function (key) {
      var item = scenario.costs[key];
      return '<tr><td>' + escape(plainLabel('costs', key)) + '</td><td>' + display(item.value, 'money') + '</td><td>' + badge(item) + '</td></tr>';
    });
    var costsMissing = Object.keys(scenario.costs).every(function (key) { return unavailable(scenario.costs[key].value); });
    var pending = scenario.meta.owner_inputs_pending.map(function (item) { return '<li>' + escape(plainLabel('pending', item)) + '</li>'; }).join('');
    var costSection = '<section><h2>3. Costs &amp; subsidy</h2>' + plain('what it would cost to build each home, and how much public money would be needed to sell it at the prices in section 2. Total development cost (TDC) is everything it takes to build: land, construction, design and permits, fees and financing. ' + (costsMissing ? 'None of these figures has been supplied for the example project yet, so this section lists what is still needed.' : 'Any figure still marked as needing owner input has not been supplied yet.') + '') + table(['Cost', 'Amount', 'Where the number comes from'], costs) + '<p><strong>TDC per unit:</strong> ' + display(model.derived.tdcDependent.tdcPerUnit, 'money') + '</p><p><strong>Subsidy per unit:</strong> ' + display(model.derived.tdcDependent.subsidyPerUnit, 'money') + '</p><h3>What this report is waiting on</h3><p><strong>Values still needed</strong> from the project sponsor:</p><ul>' + pending + '</ul></section>';

    var landCards = model.landOutcomes.map(function (item) {
      var checks = Object.keys(item.row.assessments).map(function (key) {
        var field = item.row.assessments[key];
        return '<li><strong>' + escape(plainLabel('landFields', key)) + ':</strong> ' + escape(humanize(field.value)) + ' ' + badge(field, false) + '</li>';
      }).join('');
      return '<article><h3>' + escape(item.row.label) + '</h3><p>' + (item.row.modelId === 'model_a_public_land_retention' ? '<strong>Hypothesis to test</strong> — an idea to check, not a finding' : '') + '</p><p>Upfront price reduction per home: ' + display(item.row.initialPerUnitAffordabilityBenefit, 'money') + '</p><p>Monthly housing cost at year 5: ' + display(item.lifecycle.results[5].monthlyHousingCost, 'money') + ' ' + badge(item.lifecycle) + '</p><ul>' + checks + '</ul></article>';
    }).join('');
    var land = '<section><h2>4. Land disposition</h2>' + plain('four ways a town or housing authority could handle the land under the homes. Keeping the land and leasing it to buyers (a ground lease) takes the land out of the price, but adds a monthly land fee and more paperwork. Selling the land with a deed restriction or covenant avoids the land fee and gives buyers ordinary ownership, but the public keeps only the right to enforce the restriction, not the land itself. Monthly housing cost is what the buyer would pay each month in year 5.') + '<p>The options are listed in a fixed order; the order does not mean one is better. Dollar figures use the same example assumptions for every option.</p>' + exampleNote + landCards + '<p class="warning">Property taxes on retained land: whether a buyer is taxed only on the house, not the land, while the housing authority still owns the land must be confirmed with the county assessor and an attorney.</p></section>';

    var conventionRows = model.conventionResults.map(function (result) {
      var outcome = result.results[model.selectedYear];
      return '<tr><td>' + escape(result.conventionLabel) + '</td><td>' + display(outcome.ownerNetProceeds, 'money') + '</td><td>' + yesNo(outcome.preservesAffordability, outcome.preservesAffordabilityLabel) + '</td><td>' + badge(result, false) + '</td><td>' + escape(result.scenarioLabel) + '</td></tr>';
    });
    var warning = model.settlement.ownerNetTransparencyWarning ? '<p class="warning"><strong>Owner-net transparency warning:</strong> ' + escape(model.settlement.ownerNetTransparencyNote) + '</p>' : '';
    var equity = '<section><h2>5. Shared equity &amp; settlement</h2>' + plain('price-restricted homes come with a resale formula that caps what an owner can sell for. The goal is to keep the home affordable for the next buyer, but a cap does not guarantee it — the third column checks whether it does, ' + escape(model.selectedYear) + ' years after purchase. The market path sets one yearly rate that home values, incomes and inflation all follow.') + exampleNote + table(['Resale formula', 'Seller walks away with (net proceeds)', 'Still affordable to the next buyer?', 'Where the number comes from', 'Market path'], conventionRows) + '<h3>Where the money goes in one sale</h3>' + plain('when the home sells, selling costs are paid first, then the mortgage, then the owner gets their down payment back, then any public help is repaid. The owner\'s net proceeds are their down payment back, any improvement credit, and whatever is left after that. Public subsidy recaptured is public money paid back at the sale; public subsidy retained stays in the home rather than being paid back.') + '<p>' + escape(model.settlement.scenarioLabel) + ' ' + badge(model.settlement) + '</p><p>Public subsidy retained in home: <strong>' + display(model.settlement.publicSubsidyRetainedInHome, 'money') + '</strong></p><p>Public subsidy recaptured at sale: <strong>' + display(model.settlement.publicSubsidyRecapturedAtSale, 'money') + '</strong></p><p>Owner net proceeds: <strong>' + display(model.settlement.ownerNetProceeds, 'money') + '</strong></p><p>' + TRANSPARENCY + (model.settlement.ownerNetTransparencyWarning ? '' : ' No such warning applies to this sale.') + '</p>' + warning + '</section>';

    var funnelRows = model.funnel.stages.map(function (stage) {
      return '<tr><td>' + escape(stage.id === 'observed_base' ? 'Starting pool' : plainLabel('stages', stage.id)) + '</td><td>' + display(stage.share, 'rate') + '</td><td>' + display(stage.outputCount) + '</td><td>' + escape(stage.label || '') + '</td><td>' + escape(stage.basis) + '</td><td>' + badge(stage) + '</td></tr>';
    });
    var unresolved = model.funnel.unresolvedStages;
    var demand = '<section><h2>6. Demand (screening)</h2>' + plain('the buyer funnel. It starts from a rough count of local moderate-income renter households, taken from HUD\'s CHAS tables and split across the project\'s income groups — a potential pool, not committed buyers. Each step after it keeps only the share of households that pass that step, using a share someone has entered from local evidence. If a step is blank, every step below it stays blank, because the report will not guess.') + '<p><strong>Steps still blank:</strong> ' + escape(unresolved.length ? unresolved.map(function (id) { return plainLabel('stages', id); }).join('; ') : 'none') + '</p><p class="field-ids">Field names: ' + escape(unresolved.length ? unresolved.join(', ') : 'none') + '</p>' + table(['Step', 'Share kept', 'Households left', 'What the number means', 'Where a real share should come from', 'Where the number comes from'], funnelRows) + '<p><strong>' + BUYER_POOL + '</strong></p><p class="warning">' + G2 + ' In plain terms: HUD\'s CHAS data does not count households above the area median income, so the top income group shows no buyers here. That is a gap in the data, not a finding that nobody in that group would buy.</p></section>';

    var captureRows = model.capture.scenarios.map(function (item) {
      return '<tr><td>' + escape(item.scenarioLabel) + '</td><td>' + formatSchedule(item.monthlyClosings, model.scenario.program.total_units.value) + '</td><td>' + formatAnnualClosings(item.annualClosings) + '</td><td>' + formatAnnualCapture(item.annualCaptureRate) + '</td><td>' + formatDenominator(item.totalProjectPenetration, 'rate') + '</td><td>' + formatDenominator(item.grossContractsNeeded) + '</td><td>' + (typeof item.poolDepletionModeled === 'boolean' ? (item.poolDepletionModeled ? 'Yes' : 'No') : display(item.poolDepletionModeled)) + '</td></tr>';
    });
    var captureBands = Object.keys(model.capture.captureByAmiBand).map(function (key) {
      var item = model.capture.captureByAmiBand[key];
      return '<tr><td>' + escape(key) + '</td><td>' + display(item.numerator) + '</td><td>' + formatDenominator(item, 'rate') + '</td><td>' + escape(plainReason(item.reason)) + '</td></tr>';
    });
    var capture = '<section><h2>7. Capture scenarios (screening)</h2>' + plain('given the estimated buyer pool from section 6, what share of those buyers the project would have to sign up to sell every home in two, two and a half, three or four years. The bigger the share, the harder the sales job. Each figure shows the pool it was divided by underneath it.') + table(['Sales pace', 'Homes closing each month', 'Homes closing each year', 'Share of ready buyers needed each year', 'Share of all ready buyers the project needs', 'Signed contracts needed (some fall through)', 'Pool only shrinks as homes sell (no new buyers added)'], captureRows) + table(['Income group (AMI band)', 'Homes in this group', 'Share of this group\'s ready buyers needed', 'Data limitation'], captureBands) + '<p class="warning"><strong>Other homes for sale are not counted:</strong> ' + escape(model.capture.competitiveSupplyNote) + '</p><p class="warning"><strong>Treat these as rough arithmetic:</strong> ' + escape(model.capture.captureHumilityCaveat) + '</p></section>';

    var validation = '<section><h2>8. Validation steps</h2>' + plain('who has to check this screen before anyone relies on it, and what each of them checks.') + '<p>' + VERIFY + '</p><ul><li><strong>Attorney:</strong> whether the deed restriction or ground lease can be enforced, and the construction-defect liability for attached homes such as townhomes under Colorado\'s Construction Defect Action Reform Act (CDARA).</li><li><strong>Appraiser:</strong> how a home with a capped resale price is valued.</li><li><strong>Lender:</strong> which mortgage products will lend on these homes.</li><li><strong>Program administrator or steward:</strong> whether the organization that runs resales has the capacity to do it.</li><li><strong>County assessor:</strong> whether property tax is based on the restricted price.</li></ul></section>';
    var legend = '<section><h2>9. Evidence legend</h2><p><strong>' + LEGEND + '</strong></p><dl><dt>Source confirmed</dt><dd>A cited primary source supports the value.</dd><dt>Calculated estimate</dt><dd>The value follows a stated screening method and assumptions.</dd><dt>Owner input required</dt><dd>Replace the screening placeholder with a project-specific input.</dd><dt>Not yet verified</dt><dd>A named document exists but its applicable terms still need review.</dd></dl><p><strong>Partners and funding:</strong> ' + COMMITMENT + '. A partner or funding source listed as a candidate or as available only shows it exists; it is not counted as money committed to this project.</p><p>Every result that looks ahead in time carries the words “' + SCENARIO + '.” It shows how the arithmetic behaves under one set of assumptions, not what will happen.</p></section>';
    var glossary = '<section><h2>10. Words used in this report</h2><dl>' +
      '<dt>AMI (Area Median Income)</dt><dd>The middle income for the area, published each year by HUD. An income group such as 80–90% of AMI is a range of incomes measured against it.</dd>' +
      '<dt>HAMFI</dt><dd>HUD Area Median Family Income, the version of area median income used in HUD\'s CHAS tables.</dd>' +
      '<dt>CHAS</dt><dd>A HUD dataset built from the Census American Community Survey that counts households by income and housing situation.</dd>' +
      '<dt>Gap</dt><dd>How far the typical local home value is above what an income group can pay.</dd>' +
      '<dt>Total development cost (TDC)</dt><dd>Everything it takes to build the homes: land, construction, design and permits, fees and financing.</dd>' +
      '<dt>Ground lease / CLT</dt><dd>The buyer owns the house but leases the land, usually from a community land trust (CLT), housing authority or town, for a monthly fee. Leaving the land out of the price makes the home cheaper.</dd>' +
      '<dt>Deed restriction / covenant</dt><dd>A legal limit recorded on the property that caps the resale price and sets who can buy next, while the owner owns house and land.</dd>' +
      '<dt>Resale formula (shared equity)</dt><dd>The rule that caps what an owner can sell for, aiming to keep the home affordable. The owner still builds some wealth, but less than on the open market.</dd>' +
      '<dt>Steward</dt><dd>The organization that checks buyers qualify and enforces the resale formula over time.</dd>' +
      '<dt>Net proceeds</dt><dd>What the seller walks away with after selling costs, the mortgage and any public help are repaid.</dd>' +
      '<dt>Recapture</dt><dd>Public money paid back when a home is sold. Programs use it on its own or together with a capped resale price.</dd>' +
      '<dt>Buyer funnel (effective demand)</dt><dd>A rough count of local moderate-income renter households, narrowed step by step by entered shares to those who could and would buy. An estimate, not a count of committed buyers.</dd>' +
      '<dt>Capture</dt><dd>The share of the estimated buyer pool the project would need to sell to. A very high share is a warning sign.</dd>' +
      '<dt>Fee simple</dt><dd>Ordinary ownership of both the house and the land under it.</dd>' +
      '<dt>Leasehold</dt><dd>Owning the house while leasing the land under it, as in a ground lease.</dd>' +
      '<dt>Denominator</dt><dd>The number a share was divided by — shown under each capture figure so you can see which pool it was measured against.</dd>' +
      '<dt>Sellout</dt><dd>Selling every home in the project; a 30-month sellout means all homes sold within 30 months.</dd>' +
      '</dl></section>';
    var vintages = '<ul><li>Scenario: ' + escape(meta.vintages.scenario) + '</li><li>Home value: ' + escape(meta.vintages.homeValue) + '</li><li>Resale conventions: ' + escape(meta.vintages.conventions) + '</li></ul>';
    var verdict = verdictSection(model);
    var content = '<article class="report"><header><h1>' + escape(title) + '</h1><p class="banner"><strong>' + BANNER + '</strong></p><p><strong>As of:</strong> ' + escape(meta.asOf) + '</p><h2>Data vintages</h2>' + vintages + '<div class="how-to-read"><h2>How to read this report</h2><p>This is a first screen of whether a proposed group of price-restricted homes for sale could work in this market: could local working households afford them, would enough of them buy, and what happens to the price when an owner later sells. It is not a completed market study.</p><p>Each number carries a label saying where it comes from — see section 9. <strong>Owner input required</strong> marks a number that still has to come from the project sponsor or from local evidence; the report leaves it blank rather than guess. Each section opens with an <strong>In plain terms</strong> summary, and section 10 explains the terms used.</p></div></header>' + verdict + project + affordability + costSection + land + equity + demand + capture + validation + legend + glossary + '<footer><strong>' + BANNER + '</strong></footer></article>';
    assertComplete(content);
    return Object.freeze({ title: title, asOf: meta.asOf, content: content });
  }

  function renderReportPreview(report) {
    if (!report || !report.content) throw new Error('MarketStudyReport: report content is required');
    assertComplete(report.content);
    return report.content;
  }
  function renderReportHtml(report) {
    var content = renderReportPreview(report);
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(report.title) + '</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172033;max-width:1100px;margin:auto;padding:28px}h1,h2,h3{line-height:1.2}section{border-top:1px solid #bac4d0;padding-top:18px;margin-top:24px}.banner,.warning{border:2px solid #8b4b00;background:#fff5df;padding:12px}.plain{border-left:4px solid #1f5f8b;background:#eef5fa;padding:8px 12px}.how-to-read{border:1px solid #bac4d0;background:#f7f9fb;padding:4px 16px;margin-top:16px}.field-ids{color:#52616f;font-size:.85em}dt{font-weight:700;margin-top:8px}dd{margin-left:0}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bac4d0;padding:7px;text-align:left;vertical-align:top}th{background:#eef2f6}.provenance__label{display:inline-block;border:1px solid #52616f;border-radius:999px;padding:1px 7px;font-size:.8em}.provenance__explanation{display:block;font-size:.85em;margin-top:3px}small{display:block}footer{border-top:3px solid #172033;margin-top:30px;padding-top:16px}@media print{body{max-width:none}.table-wrap{overflow:visible}}</style></head><body>' + content + '</body></html>';
  }

  return {
    REQUIRED_CAVEATS: REQUIRED_CAVEATS,
    PLAIN_LABELS: PLAIN_LABELS,
    humanize: humanize,
    exampleInputsLabel: exampleInputsLabel,
    exampleInputsDetail: exampleInputsDetail,
    isExampleJurisdiction: isExampleJurisdiction,
    reportTitle: reportTitle,
    plainBasis: plainBasis,
    plainReason: plainReason,
    formatSchedule: formatSchedule,
    formatAnnualClosings: formatAnnualClosings,
    formatAnnualCapture: formatAnnualCapture,
    formatDenominator: formatDenominator,
    buildReport: buildReport,
    renderReportPreview: renderReportPreview,
    renderReportHtml: renderReportHtml
  };
}));
