/**
 * Step 7 — the recommendation, as data.
 *
 * Every conclusion this repo can reach is computed somewhere: the HNA's short
 * answer, the AMI-gap module, the ownership screen, the deal calculator. None
 * of them are ever assembled on one screen, so the reader finishes the workflow
 * holding six separate pages and no answer.
 *
 * This module is the assembly, and it is deliberately a DATA CONTRACT rather
 * than a harvest of the other pages' DOM. The workflow's own saved state is
 * already a DOM harvest — WorkflowState.setStep('hsa', …) stores
 * `costBurden: "49.5%"`, a formatted string scraped out of a <span> — and a
 * synthesis built on that inherits every one of its silences. A step that was
 * never opened and a step whose element was missing look identical.
 *
 * So place conclusions come from data/hna/jurisdiction-metrics-digest/<geoid>.json,
 * which carries value, confidence, source_id, as_of, geography_level and the
 * denominator for every one of its 136 metrics. Project facts come from
 * WorkflowState and are quoted back as what the reader RECORDED, never
 * re-derived.
 *
 * ── Insufficient evidence is the normal case, not the error case ──
 *
 * 220 of 546 Colorado jurisdictions carry `confidence: "low"` on the core need
 * metrics, and 199 have a cost-burden rate computed on a denominator below the
 * floor. For CDPs it is 146 of 210. A page that only worked when the data was
 * good would be wrong for most of the state, so the insufficient state is a
 * first-class verdict here with its own text, not a hole where a verdict
 * should be.
 *
 * The signal that matters most is not confidence but `geography_level`. A
 * small place's median home value often arrives as `county_context` — a real
 * number about the surrounding county, sitting in the place's record. Aetna
 * Estates (CDP) reports $52,038, which is Adams County's adjusted figure and
 * not any house in Aetna Estates. Presenting that as the place's answer is the
 * exact failure this page exists to stop, so a borrowed figure is always named
 * as borrowed.
 *
 * Pure. No DOM, no fetch, no clock: everything arrives as arguments.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RecommendationContract = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var SCHEMA = 'workflow-recommendation/v1';

  /* States, worst first. A conclusion takes the worst state of the metrics
     that drive it — averaging them would let one solid number carry three
     absent ones. */
  var ESTABLISHED = 'established';
  var PROVISIONAL = 'provisional';
  var INSUFFICIENT = 'insufficient';
  var RANK = {};
  RANK[INSUFFICIENT] = 0;
  RANK[PROVISIONAL] = 1;
  RANK[ESTABLISHED] = 2;

  function worst(states) {
    return states.reduce(function (acc, state) {
      return RANK[state] < RANK[acc] ? state : acc;
    }, ESTABLISHED);
  }

  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  /**
   * Read one digest metric into an evidence item, with its state and the
   * reason for that state.
   *
   * Order matters: a metric can be several kinds of unusable at once, and the
   * reader needs the one that would change what they do. "We have no figure"
   * ranks above "the figure is about the next town over", which ranks above
   * "the figure rests on 40 households".
   */
  function evidence(metrics, key, label, options) {
    options = options || {};
    var metric = metrics && metrics[key];
    var item = {
      key: key,
      label: label,
      value: null,
      unit: options.unit || null,
      source: null,
      asOf: null,
      confidence: null,
      geographyLevel: null,
      state: INSUFFICIENT,
      why: null,
      borrowedFrom: null
    };
    if (!metric) {
      item.why = 'This jurisdiction’s digest carries no ' + label.toLowerCase() + '.';
      return item;
    }
    item.value = metric.value === null || metric.value === undefined ? null : metric.value;
    item.source = metric.source_id || null;
    item.asOf = metric.as_of || null;
    item.confidence = metric.confidence || null;
    item.geographyLevel = metric.geography_level || null;

    // A level that is not the level the reader asked about is a figure about
    // somewhere else. Recorded whatever the state ends up being, because the
    // reader has to know it even when the number is otherwise usable.
    if (options.requestedLevel && item.geographyLevel
      && item.geographyLevel !== options.requestedLevel
      && !(options.requestedLevel === 'cdp' && item.geographyLevel === 'place')) {
      item.borrowedFrom = item.geographyLevel;
    }

    if (item.value === null || item.confidence === 'missing') {
      item.state = INSUFFICIENT;
      item.why = 'No figure is published for this jurisdiction.';
      return item;
    }
    if (item.confidence === 'low') {
      item.state = INSUFFICIENT;
      item.why = item.borrowedFrom
        ? 'The only figure available is ' + item.borrowedFrom.replace(/_/g, ' ') + ', not this jurisdiction.'
        : 'The underlying sample is too small for this figure to carry a decision.';
      return item;
    }
    if (metric.denominator_floor_applied === true) {
      item.state = INSUFFICIENT;
      item.why = 'The rate rests on ' + (num(metric.denominator) === null ? 'too few' : metric.denominator)
        + ' households — below the ' + (metric.min_denominator || 'minimum') + ' this repo will report a rate on.';
      return item;
    }
    if (item.borrowedFrom) {
      item.state = PROVISIONAL;
      item.why = 'This is the ' + item.borrowedFrom.replace(/_/g, ' ') + ' figure standing in for the jurisdiction.';
      return item;
    }
    if (item.confidence === 'medium' || item.confidence === 'acs_raw') {
      item.state = PROVISIONAL;
      item.why = item.confidence === 'acs_raw'
        ? 'Census self-reported value rather than a transaction-based index.'
        : 'Reported with medium confidence; treat it as a direction, not a number.';
      return item;
    }
    item.state = ESTABLISHED;
    return item;
  }

  function conclusion(id, question, items, verdictFn) {
    var computedAt = COMPUTED_AT[id] || null;
    var state = worst(items.map(function (item) { return item.state; }));
    var usable = items.filter(function (item) { return item.state !== INSUFFICIENT; });
    var verdict = state === INSUFFICIENT ? null : verdictFn(items);
    return {
      id: id,
      question: question,
      state: state,
      // Present even when the conclusion is insufficient: a reader who is told
      // the evidence is too thin most wants to go and look at it.
      computedAt: computedAt,
      verdict: verdict && verdict.verdict || null,
      plain: verdict && verdict.plain
        || 'There is not enough evidence here to answer this one.',
      // What produced the answer, as state, where a conclusion has more than
      // one possible method (production: workforce vs resident_growth).
      basis: verdict && verdict.basis || null,
      evidence: items,
      // What would have to be true to answer it. Named, so the reader knows
      // whether this is fixable by them (open the step) or not (no data
      // exists for a place this small).
      blocking: state === INSUFFICIENT
        ? items.filter(function (item) { return item.state === INSUFFICIENT; })
          .map(function (item) { return item.label + ' — ' + item.why; })
        : [],
      usableCount: usable.length,
      evidenceCount: items.length
    };
  }

  function band(value, thresholds, labels) {
    for (var i = 0; i < thresholds.length; i++) {
      if (value >= thresholds[i]) return labels[i];
    }
    return labels[labels.length - 1];
  }

  /**
   * Where each conclusion was computed.
   *
   * #1620 §6 criterion 7 asks for "one screen, conclusion first, then evidence
   * links back to steps 2-6". Before this the evidence tables named their
   * source_id and nothing more, so a reader could see that a figure came from
   * `hud-chas-place-apportioned` and still had no way to reach the page that
   * shows the working.
   *
   * Three of the five point at the same chapter. That is not laziness — "How
   * much of what, for whom, and what is already available" is the chapter that
   * carries the scorecard, the 20-year need and the ownership screen, and
   * sending the reader somewhere tidier would send them somewhere the number
   * is not.
   *
   * The anchors are guarded: test:recommendation asserts each page exists and
   * actually contains that id, so a chapter that moves a section breaks the
   * build rather than shipping a link that scrolls nowhere.
   */
  var COMPUTED_AT = {
    need: { page: 'hna-what-to-do.html', anchor: 'hnaScorecardPanel',
      label: 'the need scorecard' },
    affordability: { page: 'hna-what-households-can-afford.html', anchor: 'statRentBurden',
      label: 'what households can afford' },
    production: { page: 'hna-what-to-do.html', anchor: 'statUnitsNeed',
      label: 'how many homes are needed' },
    ownership: { page: 'hna-what-to-do.html', anchor: 'affordable-ownership-need-section',
      label: 'the ownership screen' },
    confidence: { page: 'hna-what-to-do.html', anchor: 'hnaGapCoveragePanel',
      label: 'the gap-coverage panel' }
  };

  /* ── The five conclusions ───────────────────────────────────────────────
     Same five the HNA's own short answer uses — need, affordability,
     production, ownership, confidence — so a reader who saw them there meets
     the same vocabulary here rather than a second, differently-named summary
     of the same jurisdiction. */

  function buildConclusions(metrics, level) {
    var ev = function (key, label, options) {
      return evidence(metrics, key, label, Object.assign({ requestedLevel: level }, options || {}));
    };

    var need = conclusion('need', 'How much housing pressure is there?', [
      ev('overall_need_score', 'Overall need score'),
      ev('rank', 'Rank among 546 Colorado jurisdictions')
    ], function (items) {
      var score = num(items[0].value);
      var rank = num(items[1].value);
      // The tier phrase has to read as an answer on its own AND inside a
      // sentence. Gluing a noun onto it produced "Among the highest in
      // Colorado housing need", so each tier carries its own sentence.
      var TIERS = [
        { at: 70, verdict: 'Among the highest in Colorado', sentence: 'Housing pressure here is among the highest in the state' },
        { at: 55, verdict: 'High', sentence: 'Housing pressure here is high' },
        { at: 40, verdict: 'Moderate', sentence: 'Housing pressure here is moderate' },
        { at: -Infinity, verdict: 'Lower', sentence: 'Housing pressure here is lower than most of the state' }
      ];
      var tier = TIERS.find(function (row) { return score >= row.at; });
      return {
        verdict: tier.verdict,
        plain: tier.sentence
          + (rank === null ? '' : ', ranked ' + rank + ' of 546 Colorado jurisdictions')
          + '.'
      };
    });

    var affordability = conclusion('affordability', 'Who is priced out?', [
      ev('pct_cost_burdened', 'Renters paying over 30% of income'),
      ev('pct_renter_severe_burdened', 'Renters paying over 50% of income')
    ], function (items) {
      var cb30 = num(items[0].value);
      var cb50 = num(items[1].value);
      var tier = band(cb30, [50, 35, 20], ['High', 'Elevated', 'Moderate', 'Lower']);
      return {
        verdict: tier + ' cost burden',
        plain: cb30 + '% of renter households pay more than 30% of income on rent'
          + (cb50 === null ? '' : ', and ' + cb50 + '% pay more than half') + '.'
      };
    });

    var production = conclusion('production', 'How many homes are needed?', [
      ev('future_units_needed_20yr', 'Additional homes needed over 20 years'),
      ev('housing_gap_units', 'Homes missing at the deepest income tier today')
    ], function (items) {
      var future = num(items[0].value);
      var gap = num(items[1].value);
      // Which reading produced the 20-year figure. For most jurisdictions it
      // is the workforce reading (jobs against homes affordable to the people
      // doing them), which the digest has carried under a DOLA source id; the
      // sentence says what the number counts rather than inheriting that.
      var reading = metrics.future_units_reading ? metrics.future_units_reading.value : null;
      var growth = metrics.future_units_growth_20yr ? num(metrics.future_units_growth_20yr.value) : null;
      var how = '';
      if (future !== null && reading === 'workforce') {
        how = ', read from jobs: more lower-wage workers are employed here than there are homes they can afford'
          + (growth === null ? '' : ' (resident growth alone would need about ' + growth.toLocaleString('en-US') + ')');
      } else if (future !== null && reading === 'resident_growth') {
        how = ', from projected household growth';
      }
      return {
        verdict: future === null
          ? 'Gap of ' + gap.toLocaleString('en-US') + ' homes today'
          : future.toLocaleString('en-US') + ' homes over 20 years',
        plain: (future === null ? '' : 'Roughly ' + future.toLocaleString('en-US') + ' additional homes over 20 years' + how)
          + (gap === null ? '' : (future === null ? 'A gap of ' : ', against a gap of ')
            + gap.toLocaleString('en-US') + ' homes at the deepest income tier today') + '.',
        basis: reading
      };
    });

    // The ownership engine already publishes a recommendation in words. It is
    // quoted rather than re-derived — two producers of one recommendation is
    // how this repo has been bitten before, and the engine is the producer.
    var ownership = conclusion('ownership', 'Rental, ownership, or both?', [
      ev('ownership_need_recommendation', 'Tenure recommendation'),
      ev('ownership_need_data_quality', 'Ownership screen data quality'),
      ev('ownership_need_ownership_fit_tier', 'Ownership fit')
    ], function (items) {
      var rec = items[0].value;
      var fit = items[2].value;
      if (rec === 'Verify locally') {
        return {
          verdict: 'No clear signal',
          plain: 'The screen does not lean either way here — this one needs local judgement '
            + 'rather than a number.'
        };
      }
      return {
        verdict: rec,
        plain: rec + (fit ? ', with ' + String(fit).toLowerCase() + ' ownership fit' : '') + '.'
      };
    });

    var confidence = conclusion('confidence', 'How hard can you lean on this?', [
      ev('score_confidence_multiplier', 'Score confidence multiplier')
    ], function (items) {
      var mult = num(items[0].value);
      var tier = band(mult, [0.97, 0.92], ['High', 'Moderate', 'Limited']);
      return {
        // "Public-data" is load-bearing. This multiplier grades the digest's
        // evidence and nothing else; it read as confidence in the whole
        // recommendation while the reader had run no market analysis and no
        // scenarios. build() appends which project steps it does not cover.
        verdict: tier + ' public-data confidence',
        plain: tier + ' confidence in the public data behind the scores above; '
          + 'they are a screening read, not a study.'
      };
    });

    return [need, affordability, production, ownership, confidence];
  }

  /**
   * The headline.
   *
   * It names a tenure strategy only when the ownership conclusion actually
   * reached one. Otherwise it says there is no recommendation and why, rather
   * than softening an absence into a hedge that reads like advice.
   */
  function headline(conclusions, geographyName) {
    var byId = {};
    conclusions.forEach(function (item) { byId[item.id] = item; });
    var ownership = byId.ownership;
    var need = byId.need;
    var blocked = conclusions.filter(function (item) { return item.state === INSUFFICIENT; });

    if (!ownership || ownership.state === INSUFFICIENT || ownership.verdict === 'No clear signal') {
      return {
        state: INSUFFICIENT,
        verdict: 'No recommendation for ' + geographyName,
        plain: ownership && ownership.verdict === 'No clear signal'
          ? 'The ownership screen does not lean either way for ' + geographyName
            + '. That is a finding, not a gap: a strategy here has to come from local knowledge '
            + 'the public data does not carry.'
          : 'There is not enough public evidence to recommend a housing strategy for '
            + geographyName + '. What is missing is listed under each question below.',
        blockedCount: blocked.length
      };
    }
    var confident = ownership.state === ESTABLISHED && need && need.state !== INSUFFICIENT;
    return {
      state: ownership.state,
      verdict: ownership.verdict,
      plain: (confident
        ? 'The public evidence for ' + geographyName + ' points to '
        : 'On the evidence available for ' + geographyName + ', the direction is ')
        + String(ownership.verdict).toLowerCase() + '. '
        + (blocked.length
          ? blocked.length + ' of the ' + conclusions.length + ' questions below could not be answered from public data.'
          : 'All ' + conclusions.length + ' questions below are answered from public data.'),
      blockedCount: blocked.length
    };
  }

  /* ── What the reader actually did ────────────────────────────────────────
     Quoted, never recomputed. These arrive from WorkflowState as formatted
     strings harvested from each page's DOM, so the honest thing is to present
     them as a record of a step, stamped with when it was taken — not to treat
     them as inputs to a calculation. */

  var STEPS = [
    { key: 'jurisdiction', label: 'Jurisdiction', href: 'select-jurisdiction.html',
      fields: [['name', 'Jurisdiction'], ['geoType', 'Level']] },
    { key: 'hsa', label: 'Housing needs assessment', href: 'hna-what-housing-exists.html',
      fields: [['population', 'Population'], ['medianRent', 'Median rent'], ['costBurden', 'Cost burden']] },
    { key: 'market', label: 'Market analysis', href: 'market-analysis.html',
      fields: [['score', 'Site score'], ['label', 'Tier']] },
    { key: 'scenario', label: 'Scenarios', href: 'hna-scenario-builder.html',
      fields: [['county', 'County']] },
    // Rental and ownership saves carry different fields, and each is quoted
    // only under its own mode (PC-2). An ownership project quoting "Annual
    // credits" and "First mortgage" is the defect this split exists to stop:
    // the rental panel is computed even in ownership mode, and the old save
    // read it regardless.
    { key: 'deal', label: 'Deal test', href: 'deal-calculator.html',
      fieldsByMode: {
        rental: [['outputs.gap', 'Funding gap'], ['outputs.annualCredits', 'Annual credits'],
          ['outputs.firstMortgage', 'First mortgage']],
        ownership: [['outputs.maxAffordablePrice', 'Max affordable sale price'],
          ['outputs.subsidyGapPerUnit', 'Subsidy gap per unit'],
          ['outputs.totalOwnershipGap', 'Total ownership gap']]
      } }
  ];

  var MODE_LABEL = { rental: 'rental (LIHTC)', ownership: 'for-sale ownership' };

  /* The analysis steps a recommendation about a PROJECT depends on. The
     jurisdiction and HNA steps describe the place, which the digest already
     covers; these three describe the project, which it cannot. */
  var PROJECT_STEPS = ['market', 'scenario', 'deal'];

  function dig(source, path) {
    return path.split('.').reduce(function (acc, part) {
      return acc && typeof acc === 'object' ? acc[part] : undefined;
    }, source);
  }

  function projectRecord(project) {
    return STEPS.map(function (step) {
      var data = project && (project[step.key] || (project.steps && project.steps[step.key]));
      if (!data || !data.completedAt) {
        return {
          key: step.key, label: step.label, href: step.href,
          status: 'not_run', recordedAt: null, fields: []
        };
      }
      var mode = null;
      var note = null;
      var pairs = step.fields || [];
      if (step.fieldsByMode) {
        mode = data.dealMode === 'ownership' || data.dealMode === 'rental' ? data.dealMode : null;
        if (mode) {
          pairs = step.fieldsByMode[mode];
        } else {
          // Saved before the calculator recorded its mode. The values could
          // be either path's, and quoting LIHTC figures for what may have
          // been an ownership project is the defect, so none are quoted.
          pairs = [];
          note = 'Saved before the calculator recorded whether this was a rental or an '
            + 'ownership deal, so its figures are not quoted. Reopen the step and save again.';
        }
      }
      var fields = pairs.map(function (pair) {
        var value = dig(data, pair[0]);
        return {
          label: pair[1],
          value: (value === null || value === undefined || value === '') ? null : String(value)
        };
      }).filter(function (field) { return field.value !== null; });
      var record = {
        key: step.key, label: step.label, href: step.href,
        status: 'recorded', recordedAt: data.completedAt, fields: fields
      };
      if (step.fieldsByMode) {
        record.mode = mode;
        if (mode) record.label = step.label + ' \u2014 ' + MODE_LABEL[mode];
        if (note) record.note = note;
      }
      return record;
    });
  }

  function sourcesOf(conclusions) {
    var seen = {};
    var out = [];
    conclusions.forEach(function (item) {
      item.evidence.forEach(function (field) {
        if (!field.source || seen[field.source]) return;
        seen[field.source] = true;
        out.push({ source: field.source, asOf: field.asOf });
      });
    });
    return out;
  }

  /**
   * @param {Object} input.digest    parsed jurisdiction-metrics-digest/<geoid>.json
   * @param {Object} input.project   WorkflowState active project, or null
   * @param {string} input.generatedAt  ISO stamp supplied by the caller
   */
  function build(input) {
    input = input || {};
    var digest = input.digest;
    if (!digest || !digest.geography || !digest.metrics) {
      return {
        schema: SCHEMA,
        geography: null,
        generatedAt: input.generatedAt || null,
        headline: {
          state: INSUFFICIENT,
          verdict: 'No jurisdiction selected',
          plain: 'Choose a jurisdiction and this page will assemble what the public '
            + 'data says about it, alongside whatever you have recorded in the workflow.',
          blockedCount: 0
        },
        conclusions: [],
        project: projectRecord(input.project),
        sources: []
      };
    }
    var level = digest.geography.type === 'county' ? 'county' : 'place';
    var conclusions = buildConclusions(digest.metrics, level);
    var project = projectRecord(input.project);
    var head = headline(conclusions, digest.geography.name);
    var notRun = project.filter(function (step) {
      return PROJECT_STEPS.indexOf(step.key) !== -1 && step.status === 'not_run';
    }).map(function (step) { return step.label; });
    if (notRun.length) {
      var list = notRun.join(', ');
      var gapLine = ' Not yet run for this project: ' + list + '.';
      conclusions.forEach(function (item) {
        if (item.id === 'confidence' && item.verdict) {
          item.plain += ' It does not cover your project: ' + list
            + (notRun.length === 1 ? ' has' : ' have') + ' not been run.';
        }
      });
      if (head.state !== INSUFFICIENT) head.plain += gapLine;
    }
    return {
      schema: SCHEMA,
      geography: {
        geoid: digest.geography.geoid,
        name: digest.geography.name,
        type: digest.geography.type,
        containingCounty: digest.geography.containingCounty || null
      },
      generatedAt: input.generatedAt || null,
      digestGeneratedAt: (digest.generated_from || {}).ranking_index_generated_at || null,
      headline: head,
      conclusions: conclusions,
      project: project,
      projectStepsNotRun: notRun,
      sources: sourcesOf(conclusions)
    };
  }

  return {
    SCHEMA: SCHEMA,
    COMPUTED_AT: COMPUTED_AT,
    ESTABLISHED: ESTABLISHED,
    PROVISIONAL: PROVISIONAL,
    INSUFFICIENT: INSUFFICIENT,
    STEPS: STEPS.map(function (s) { return { key: s.key, label: s.label, href: s.href }; }),
    PROJECT_STEPS: PROJECT_STEPS.slice(),
    evidence: evidence,
    worst: worst,
    buildConclusions: buildConclusions,
    headline: headline,
    projectRecord: projectRecord,
    build: build
  };
}));
