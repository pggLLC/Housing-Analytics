/**
 * Which jurisdiction is this for-sale study about?
 *
 * Before this module the answer was always Fruita. The page hard-coded one
 * place GEOID in two places and fetched that place's summary, so a planner who
 * chose Longmont at step 1 and walked into the for-sale study read Fruita's
 * AMI, Fruita's home values and Fruita's buyer pool, with nothing on screen
 * saying so. Every figure was correct arithmetic about the wrong town.
 *
 * The split this module draws is deliberate:
 *
 *   - the PROGRAM (unit mix, AMI bands, costs, partners) stays in the scenario
 *     fixtures. It is an example project and is labelled as one.
 *   - the MARKET (AMI, home value, buyer pool) follows the reader's selected
 *     jurisdiction.
 *
 * So "example program, your market" — which is the only honest thing a
 * screening page can offer, because nobody has supplied a real program.
 *
 * The scenario document itself is never rewritten. The baseline travels as an
 * override into ProjectScenario.derive(), because the fixture validator carries
 * provenance checks that only make sense for the shipped fixtures (see
 * validateLocalBaseline in project-scenario.js).
 *
 * Pure: every dataset arrives already parsed, so Node tests run the same code
 * the browser does.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudyGeography = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PLACE_LEVELS = ['place', 'cdp'];

  function isPlaceGeoid(value) { return /^08\d{5}$/.test(String(value || '')); }
  function isCountyGeoid(value) { return /^08\d{3}$/.test(String(value || '')); }
  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  /**
   * Read the reader's jurisdiction. Delegates to JurisdictionUrlContext, which
   * is the site's one resolver for ?fips= → WorkflowState → SiteState. This
   * page must not grow a fourth.
   */
  function resolve(global) {
    try {
      var ctx = global && global.JurisdictionUrlContext
        && global.JurisdictionUrlContext.resolveSync
        && global.JurisdictionUrlContext.resolveSync();
      if (!ctx) return null;
      var geoid = String(ctx.geoid || ctx.fips || '');
      if (!isPlaceGeoid(geoid) && !isCountyGeoid(geoid)) return null;
      return {
        geoid: geoid,
        geoLevel: isCountyGeoid(geoid) ? 'county' : (PLACE_LEVELS.indexOf(ctx.geoType) >= 0 ? ctx.geoType : 'place'),
        name: ctx.displayName || ctx.countyName || null,
        countyFips: ctx.countyFips || (isCountyGeoid(geoid) ? geoid : null),
        countyName: ctx.countyName || null,
        source: ctx.source || null
      };
    } catch (_) {
      return null;
    }
  }

  /** The datasets inputs() needs, as page-relative paths. */
  function datasetPaths(context) {
    var paths = {
      placeChas: 'data/hna/place-chas.json',
      countyChas: 'data/hna/chas_affordability_gap.json',
      amiGapPlace: 'data/co_ami_gap_by_place.json',
      amiGapCounty: 'data/co_ami_gap_by_county.json',
      homeValueCascade: 'data/hna/home-value-cascade.json'
    };
    if (context && context.geoid) paths.summary = 'data/hna/summary/' + context.geoid + '.json';
    return paths;
  }

  function chasEntry(context, data) {
    if (context.geoLevel === 'county') {
      return ((data.countyChas || {}).counties || {})[context.geoid] || null;
    }
    return ((data.placeChas || {}).places || {})[context.geoid] || null;
  }

  /**
   * Mirrors buildOwnershipRecords() in scripts/hna/build_jurisdiction_metrics_digest.mjs.
   * Deliberately the same shape, including the gapSource tag, so the page and
   * the precomputed data/hna/ownership-need.json cannot drift apart —
   * test:forsale-jurisdiction replays a sample of geographies through here and
   * compares the result against that file.
   */
  function amiGapEntry(context, data) {
    if (context.geoLevel === 'county') {
      var counties = (data.amiGapCounty || {}).counties;
      var row = null;
      if (Array.isArray(counties)) {
        for (var i = 0; i < counties.length; i++) {
          if (String(counties[i].fips) === context.geoid) { row = counties[i]; break; }
        }
      } else if (counties) {
        row = counties[context.geoid] || null;
      }
      return row ? Object.assign({ gapSource: 'county' }, row) : null;
    }
    var place = ((data.amiGapPlace || {}).places || {})[context.geoid] || null;
    return place ? Object.assign({ gapSource: 'place' }, place) : null;
  }

  function homeValueEntry(context, data) {
    var bucket = context.geoLevel === 'county'
      ? (data.homeValueCascade || {}).counties
      : (data.homeValueCascade || {}).places;
    var entry = (bucket || {})[context.geoid] || null;
    if (!entry || num(entry.value) === null) return null;
    return entry;
  }

  /**
   * Build the local baseline in the shape ProjectScenario expects.
   *
   * A missing figure becomes an explicit not_available node rather than a
   * number borrowed from somewhere else. derive() already renders a null
   * baseline value as "Owner input required" rather than a zero, so an
   * incomplete jurisdiction degrades one row at a time instead of all at once.
   */
  function localBaseline(context, data) {
    var ami = amiGapEntry(context, data);
    var home = homeValueEntry(context, data);
    var amiValue = ami ? num(ami.ami_4person) : null;
    var homeValue = home ? num(home.value) : null;
    var placeLabel = context.name || context.geoid;
    return {
      ami_4person: amiValue === null
        ? { value: null, classification: 'not_available', owner_input_required: true, verify: true }
        : {
          value: amiValue,
          classification: 'observed',
          source: 'data/co_ami_gap_by_' + (context.geoLevel === 'county' ? 'county' : 'place') + '.json (HUD) — ' + placeLabel
        },
      home_value: homeValue === null
        ? { value: null, classification: 'not_available', owner_input_required: true, verify: true }
        : {
          value: homeValue,
          classification: 'observed',
          source: 'data/hna/home-value-cascade.json (' + placeLabel + ' ' + (home.source || 'cascade') + ')',
          as_of: home.as_of || null
        },
      // Not wired for an arbitrary jurisdiction. It is display-only today and
      // nothing derives from it; an owner supplies it or it stays blank. It is
      // NOT filled from home_value, which would make a modelled figure look
      // like a closed-sale observation.
      median_sale_price: { value: null, classification: 'not_available', owner_input_required: true, verify: true }
    };
  }

  /**
   * Assemble everything the page needs for one jurisdiction.
   *
   * Returns a result whose `unavailable` is either null or a named reason. It
   * is never a silent fallback to the example jurisdiction: a study that
   * cannot be computed for the reader's town says so.
   */
  function inputs(context, data, engines) {
    if (!context) return { mode: 'example', context: null, localBaseline: null, ownershipNeed: null, observed: null, unavailable: null };
    var OwnershipNeed = engines && engines.HNAOwnershipNeed;
    var EffectiveDemand = engines && engines.EffectiveDemand;
    var result = {
      mode: 'jurisdiction',
      context: context,
      localBaseline: localBaseline(context, data),
      ownershipNeed: null,
      observed: null,
      unavailable: null
    };
    var chas = chasEntry(context, data);
    if (!chas) {
      result.unavailable = {
        reason: 'no_chas',
        detail: 'HUD CHAS household data is not published for this geography, so the buyer pool cannot be screened here.'
      };
      return result;
    }
    if (!OwnershipNeed || !EffectiveDemand) {
      result.unavailable = { reason: 'engine_missing', detail: 'The ownership-need engine did not load.' };
      return result;
    }
    var isCounty = context.geoLevel === 'county';
    result.ownershipNeed = OwnershipNeed.computeOwnershipNeed({
      placeChasEntry: isCounty ? null : chas,
      countyChasEntry: isCounty ? chas : null,
      geographyId: context.geoid,
      geographyName: context.name || context.geoid,
      geoLevel: isCounty ? 'county' : 'place',
      amiGapEntry: amiGapEntry(context, data),
      homeValueEntry: homeValueEntry(context, data),
      ownerValueSupplyProfile: (data.summary || {}).acsProfile || null
    });
    var screen = result.ownershipNeed && result.ownershipNeed.priceBandScreen;
    if (!screen || !Array.isArray(screen.rows) || !screen.rows.length) {
      result.unavailable = {
        reason: 'no_price_band_screen',
        detail: 'This geography has household data but not the price-band detail the demand funnel needs.'
      };
    }
    return result;
  }

  /**
   * Turn the ownership need into the funnel's starting pool, for one scenario.
   * Separate from inputs() because it is per-scenario and inputs() is not.
   */
  function observedFor(geography, scenario, EffectiveDemand) {
    if (!geography || geography.unavailable || !geography.ownershipNeed) return null;
    return EffectiveDemand.fromOwnershipNeed(scenario, geography.ownershipNeed);
  }

  return {
    resolve: resolve,
    datasetPaths: datasetPaths,
    localBaseline: localBaseline,
    amiGapEntry: amiGapEntry,
    homeValueEntry: homeValueEntry,
    chasEntry: chasEntry,
    inputs: inputs,
    observedFor: observedFor
  };
}));
