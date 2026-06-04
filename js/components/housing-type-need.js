/**
 * js/components/housing-type-need.js
 * Responsibility: data-driven 6-category ranking of which housing types the
 *   public data most supports for a given jurisdiction. Read-only pure
 *   compute over data the HNA already loads — no new fetches, no new deps.
 *
 * Exposes: window.HousingTypeNeed.compute({
 *            acsProfile, chasRows, hudIncomeLimits, lihtcInventory,
 *            jurisdictionName
 *          })
 *          -> Array<{
 *               type, label, score, level, signals, confidence,
 *               confidenceReason, lihtcRelevance, plainEnglish,
 *               methodology
 *             }>
 *
 * The 6 categories (each a distinct quadrant of tenure × size × AMI × form):
 *   1. deeplyAffordableRental  — rent · mixed size · ≤30% AMI · apartment
 *   2. workforceRental         — rent · mixed size · 60–80% AMI · apt/townhome
 *   3. familyRental            — rent · 2–3BR · mixed AMI · MF/townhome
 *   4. seniorRental            — rent · 1–2BR · mixed AMI · apt/cottage
 *   5. missingMiddleOwnership  — own · small · 80–120% AMI · townhome/duplex/4plex
 *   6. detachedSfOwnership     — own · 3BR+ · 100%+ AMI · SF
 *
 * Scoring: each category has 4–5 weighted indicators normalised to 0–100.
 *   score = Σ (indicator_0to100 × weight). Weights inside a category sum to 1.0.
 *   Level: Low <30 · Moderate 30–49 · High 50–69 · VeryHigh ≥70.
 *
 * Confidence: count of indicators that produced a non-null value.
 *   ≥4 → high · 2–3 → med · ≤1 → low.
 *   Adds a small-sample caveat when population < 5000 OR DP04 bedroom mix is missing.
 */
(function (root) {
  'use strict';

  // ── helpers ────────────────────────────────────────────────────────────────

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(v, lo, hi) {
    if (v == null) return null;
    return Math.max(lo, Math.min(hi, v));
  }

  // Map a raw value through a piecewise-linear ramp to 0..100.
  // pivots is an array of [rawValue, score0to100] pairs (sorted ascending).
  function ramp(value, pivots) {
    if (value == null) return null;
    var v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (v <= pivots[0][0]) return pivots[0][1];
    if (v >= pivots[pivots.length - 1][0]) return pivots[pivots.length - 1][1];
    for (var i = 1; i < pivots.length; i++) {
      var a = pivots[i - 1], b = pivots[i];
      if (v <= b[0]) {
        var t = (v - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return pivots[pivots.length - 1][1];
  }

  function scoreToLevel(s) {
    if (s == null || !Number.isFinite(s)) return 'Low';
    if (s >= 70) return 'VeryHigh';
    if (s >= 50) return 'High';
    if (s >= 30) return 'Moderate';
    return 'Low';
  }

  // ── data extractors (defensive — every read returns null if missing) ──────

  function extractAcs(profile) {
    var p = profile || {};
    // Core demographics + housing
    var pop          = num(p.DP05_0001E);
    var totalHH      = num(p.DP02_0001E);
    var mhi          = num(p.DP03_0062E);
    var poverty      = num(p.DP03_0128PE);   // pct individuals below poverty
    var senior65     = num(p.DP05_0024E);
    var seniorPct    = num(p.DP05_0024PE);
    // Fallback: derive 65+ share from the count when DP05_0024PE is absent
    // (the HNA extended-batch fetch returns DP05_0024E count but not the PE
    // percentage — so seniorPct was always null in practice).
    if (seniorPct == null && senior65 != null && pop && pop > 0) {
      seniorPct = (senior65 / pop) * 100;
    }
    var schoolAgePct = num(p.DP05_0019PE);   // under 18 pct
    // Same fallback for under-18 share — DP05_0019E count is fetched, PE isn't.
    if (schoolAgePct == null) {
      var under18 = num(p.DP05_0019E);
      if (under18 != null && pop && pop > 0) schoolAgePct = (under18 / pop) * 100;
    }
    var totalUnits   = num(p.DP04_0001E);
    var occUnits     = num(p.DP04_0002E) || totalUnits;

    // Tenure
    var ownerHH      = num(p.DP04_0046E);
    var renterHH     = num(p.DP04_0047E);
    var renterPct    = num(p.DP04_0047PE);
    if (renterPct == null && ownerHH != null && renterHH != null && (ownerHH + renterHH) > 0) {
      renterPct = (renterHH / (ownerHH + renterHH)) * 100;
    }

    // Rent burden share — ACS 2023+ canonical codes (per hna-utils.rentBurden30Plus):
    //   DP04_0141PE = 30-34.9% (moderate cost burden)
    //   DP04_0142PE = 35%+     (severe cost burden)
    // Previous wiring read DP04_0142PE for "30%+" and DP04_0143PE for "35%+";
    // DP04_0143PE doesn't exist in current ACS so renterCB35 was always null
    // and the deeply-affordable severe-burden indicator was silently dropped.
    var rb30_34 = num(p.DP04_0141PE);
    var rb35p   = num(p.DP04_0142PE);
    var renterCB35 = rb35p;
    var renterCB30 = (rb30_34 != null && rb35p != null) ? rb30_34 + rb35p
                   : (rb35p != null ? rb35p : null);

    // Owner cost burden — sum 30-34.9 (DP04_0114PE) + 35%+ (DP04_0115PE) when both
    // present; the HNA extended fetch returns both. Fall back to 0114 alone if
    // 0115 is missing.
    var ocb30_34 = num(p.DP04_0114PE);
    var ocb35p   = num(p.DP04_0115PE);
    var ownerCB30Pct = (ocb30_34 != null && ocb35p != null) ? ocb30_34 + ocb35p
                    : (ocb30_34 != null ? ocb30_34 : null);

    // Structure type — DP04
    var totSf   = (num(p.DP04_0007E) || 0) + (num(p.DP04_0008E) || 0); // detached + attached
    var sfDet   = num(p.DP04_0007E) || 0;
    var sfAtt   = num(p.DP04_0008E) || 0;
    var mf2to19 = (num(p.DP04_0009E) || 0) + (num(p.DP04_0010E) || 0)
                + (num(p.DP04_0011E) || 0) + (num(p.DP04_0012E) || 0);
    var mf20p   = num(p.DP04_0013E) || 0;
    var mobile  = num(p.DP04_0014E) || 0;
    var structTotal = totSf + mf2to19 + mf20p + mobile;
    var sfDetachedShare = structTotal > 0 ? (sfDet / structTotal) * 100 : null;
    var attachedShare   = structTotal > 0 ? ((sfAtt + mf2to19 + mf20p) / structTotal) * 100 : null;

    // Bedroom mix — DP04_0039E..DP04_0043E
    // 0039 = no BR, 0040 = 1BR, 0041 = 2BR, 0042 = 3BR, 0043 = 4BR, 0044 = 5BR+
    var br0 = num(p.DP04_0039E) || 0;
    var br1 = num(p.DP04_0040E) || 0;
    var br2 = num(p.DP04_0041E) || 0;
    var br3 = num(p.DP04_0042E) || 0;
    var br4 = num(p.DP04_0043E) || 0;
    var br5 = num(p.DP04_0044E) || 0;
    var brTotal = br0 + br1 + br2 + br3 + br4 + br5;
    var br1Share   = brTotal > 0 ? (br1 / brTotal) * 100 : null;
    var br2_3Share = brTotal > 0 ? ((br2 + br3) / brTotal) * 100 : null;
    var br3pShare  = brTotal > 0 ? ((br3 + br4 + br5) / brTotal) * 100 : null;

    // Household composition — DP02
    var familyHHPct  = num(p.DP02_0003PE); // family households (married + other family)
    // Fallback: derive family-HH share from DP02_0003E count / DP02_0001E total
    // (the HNA extended fetch returns these but not the PE percentage).
    if (familyHHPct == null) {
      var famHH = num(p.DP02_0003E);
      if (famHH != null && totalHH && totalHH > 0) familyHHPct = (famHH / totalHH) * 100;
    }
    var avgHHSize    = num(p.DP02_0016E);
    // Fallback: pop / households is a reasonable proxy for average HH size when
    // DP02_0016E is missing (slightly biased high because it includes group-quarters
    // population, but close enough for a directional indicator).
    if (avgHHSize == null && pop && totalHH && totalHH > 0) {
      avgHHSize = pop / totalHH;
    }

    // Overcrowding — DP04 occupants per room ≥1.01 (rough proxy)
    var crowd_101_150 = num(p.DP04_0079PE);
    var crowd_150p    = num(p.DP04_0080PE);
    var overcrowdPct = (crowd_101_150 != null || crowd_150p != null)
      ? (crowd_101_150 || 0) + (crowd_150p || 0) : null;

    // Home value
    var medHomeVal = num(p.DP04_0089E);

    return {
      pop: pop,
      totalHH: totalHH,
      mhi: mhi,
      poverty: poverty,
      senior65: senior65,
      seniorPct: seniorPct,
      schoolAgePct: schoolAgePct,
      occUnits: occUnits,
      renterPct: renterPct,
      renterCount: renterHH,           // absolute renter HH count
      renterCB30: renterCB30,
      renterCB35: renterCB35,
      ownerCB30Pct: ownerCB30Pct,
      sfDetachedShare: sfDetachedShare,
      attachedShare: attachedShare,
      br1Share: br1Share,
      br2_3Share: br2_3Share,
      br3pShare: br3pShare,
      familyHHPct: familyHHPct,
      avgHHSize: avgHHSize,
      overcrowdPct: overcrowdPct,
      medHomeVal: medHomeVal,
      hasBedroomMix: brTotal > 0
    };
  }

  // chasRows can be either:
  //   - the raw chas_affordability_gap.json record for the county
  //     (with renter_hh_by_ami.{lte30,31to50,51to80,81to100,gt100}.* fields)
  //   - already-normalised place-CHAS record (same shape)
  // We extract a renter-by-AMI distribution + cost-burden shares for two AMI bands.
  function extractChas(chasRecord) {
    if (!chasRecord) return { renterByAmi: null, severeBurdenAmi30: null, costBurdenAmi6080: null };
    var rba = chasRecord.renter_hh_by_ami;
    if (!rba) return { renterByAmi: null, severeBurdenAmi30: null, costBurdenAmi6080: null };

    var lte30   = rba.lte30   || {};
    var t3150   = rba['31to50']   || {};
    var t5180   = rba['51to80']   || {};
    var t81100  = rba['81to100']  || {};
    // Schema variants: 'gt100' (older) or '100plus' (current) — accept either.
    var gt100   = rba.gt100 || rba['100plus'] || {};

    var total = (num(lte30.total) || 0)
              + (num(t3150.total) || 0)
              + (num(t5180.total) || 0)
              + (num(t81100.total) || 0)
              + (num(gt100.total) || 0);

    var renterByAmi = total > 0 ? {
      lte30Share:   ((num(lte30.total)   || 0) / total) * 100,
      t3150Share:   ((num(t3150.total)   || 0) / total) * 100,
      t5180Share:   ((num(t5180.total)   || 0) / total) * 100,
      t6080Share:   ((num(t5180.total)   || 0) / total) * 100 * 0.6,   // 60-80 ≈ ⅗ of 51-80 band
      t81100Share:  ((num(t81100.total)  || 0) / total) * 100,
      gt100Share:   ((num(gt100.total)   || 0) / total) * 100,
      totalRenter:  total
    } : null;

    // Cost-burden shares (≥30% of income) within each AMI band
    var cbLte30 = num(lte30.cost_burdened_30pct);
    var cbAt30  = (cbLte30 != null && num(lte30.total)) ? (cbLte30 / num(lte30.total)) * 100 : null;
    var cbT5180 = num(t5180.cost_burdened_30pct);
    var cbAt5180= (cbT5180 != null && num(t5180.total)) ? (cbT5180 / num(t5180.total)) * 100 : null;

    return {
      renterByAmi: renterByAmi,
      severeBurdenAmi30: cbAt30,
      costBurdenAmi6080: cbAt5180
    };
  }

  // hudIncomeLimits: county/MSA HUD income limits dict (any of the shapes the
  // HNA passes). We only need the 4-person 50% AMI limit to derive
  // an MHI-vs-AMI gap signal for category 6.
  function extractHud(hud) {
    if (!hud || typeof hud !== 'object') return { ami100_4p: null };
    // Try several common shapes
    var p4_50 = num(hud.il50_p4) || num(hud.IL50_P4) || num(hud.il_50_p4);
    if (p4_50 == null && hud.limits) p4_50 = num(hud.limits.il50_p4);
    if (p4_50 == null && hud.AMI) {
      // Some payloads expose AMI directly as 100% 4-person
      var ami = num(hud.AMI) || num(hud.ami);
      if (ami) return { ami100_4p: ami };
    }
    return { ami100_4p: p4_50 != null ? p4_50 * 2 : null };
  }

  // lihtcInventory: array of properties.json records (or features). We just
  // need a count of LIHTC units in the jurisdiction to flag supply.
  function extractLihtc(inv, jurisdictionName) {
    if (!Array.isArray(inv) || !inv.length) return { lihtcUnits: 0, recordCount: 0 };
    var name = String(jurisdictionName || '').toLowerCase().replace(/\s*\((?:town|city|cdp|county)\)\s*$/i, '').trim();
    var matched = 0;
    var units = 0;
    for (var i = 0; i < inv.length; i++) {
      var rec = inv[i];
      if (!rec) continue;
      var p = rec.properties || rec;
      var city = String(p.city || p.CITY || p.PROJ_CTY || p.proj_cty || '').toLowerCase().trim();
      if (!name || city === name) {
        matched++;
        var u = num(p.total_units) || num(p.LI_UNITS) || num(p.li_units) || num(p.units) || 0;
        units += u;
      }
    }
    return { lihtcUnits: units, recordCount: matched };
  }

  // ── category scoring ──────────────────────────────────────────────────────

  // Each indicator returns { name, raw, value0to100, weight, contribution, weightLabel }
  // value0to100 may be null when the underlying raw value isn't available.

  function ind(name, weight, raw, normalisedScore, weightLabel) {
    var v = (normalisedScore == null) ? null : clamp(normalisedScore, 0, 100);
    return {
      name: name,
      raw: raw,
      value: v,
      weight: weight,
      contribution: v == null ? null : v * weight,
      weightLabel: weightLabel || (Math.round(weight * 100) + '%')
    };
  }

  function aggregate(indicators) {
    // Renormalise weights across indicators with non-null values so a missing
    // signal doesn't push the score artificially low.
    var totalWeight = 0;
    var sum = 0;
    var available = 0;
    indicators.forEach(function (i) {
      if (i.value != null) {
        totalWeight += i.weight;
        sum += i.value * i.weight;
        available++;
      }
    });
    var score = totalWeight > 0 ? sum / totalWeight : 0;
    return { score: Math.round(score), available: available };
  }

  // ── builders for each category ────────────────────────────────────────────

  function buildDeeplyAffordableRental(acs, chas) {
    // Low-MHI proxy — when MHI sits well below the area median income, the
    // place mechanically has more ≤30% AMI households even without a
    // working CHAS distribution. Picks up Pueblo (MHI ~$55K vs $87-92K
    // elsewhere) without double-counting renter burden.
    var mhi = acs.mhi;
    var indicators = [
      // Set to 0.30 (was 0.30 originally; bumped to 0.35 then dialed back) —
      // severe rent burden alone is shared by ELI and workforce, so giving
      // it 35% double-credited deeply-affordable scores everywhere. Pivot
      // also raised at the top (40 → 45) so only truly extreme severe-burden
      // places saturate; CO baseline severe burden is high enough that the
      // original pivot was too generous.
      ind('Severe renter cost burden (≥35% of income)', 0.30,
        acs.renterCB35,
        ramp(acs.renterCB35, [[10, 0], [20, 35], [30, 65], [45, 100]])),
      // Bumped to 0.25 from 0.20 — the CHAS share of renters at ≤30% AMI
      // is the most direct signal of who needs PSH/30%-AMI LIHTC. Replaces
      // some of the weight pulled off severe burden above.
      ind('≤30% AMI renter share', 0.25,
        chas.renterByAmi ? chas.renterByAmi.lte30Share : null,
        ramp(chas.renterByAmi ? chas.renterByAmi.lte30Share : null,
             [[5, 0], [15, 50], [25, 80], [35, 100]])),
      ind('Cost burden within ≤30% AMI cohort', 0.20,
        chas.severeBurdenAmi30,
        ramp(chas.severeBurdenAmi30, [[40, 0], [60, 45], [80, 80], [90, 100]])),
      ind('Poverty rate', 0.15,
        acs.poverty,
        ramp(acs.poverty, [[5, 0], [10, 35], [15, 65], [25, 100]])),
      // Low MHI as ELI-density proxy. Pueblo MHI ~$55K (low) → ~80; Denver
      // $92K → ~30; Boulder $86K → ~40 (still meaningful because *renter*
      // burden picks up Boulder via the 0.35-weighted indicator above).
      ind('Median household income (lower = more ELI demand)', 0.10,
        mhi,
        ramp(mhi, [[50000, 100], [65000, 70], [80000, 40], [100000, 10], [130000, 0]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'deeplyAffordableRental',
      label: 'Deeply affordable rental',
      meta: '≤30% AMI · apartment · rent',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'Weighted blend of severe renter burden (35%), ≤30% AMI renter share (20%), ' +
        'cost burden inside the ≤30% cohort (20%), poverty rate (15%), and MHI level (10%, ' +
        'lower MHI = more ELI demand). Tracks demand for PSH / extremely-low-income LIHTC at ' +
        '30% AMI rents.',
      lihtcRelevance: 'Aligns with ≤30% AMI LIHTC set-asides, PSH layering, and Prop 123 ' +
        '"extremely low income" credit boosts.',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'Severe cost burden and a heavy ≤30% AMI renter base point to strong demand ' +
                 'for deeply affordable rental — the lowest-income LIHTC tier.';
        }
        if (level === 'Moderate') {
          return 'Some signs of deeply affordable rental need, but the cohort is smaller — ' +
                 'verify with local waitlists before sizing a project around 30% AMI rents.';
        }
        return 'Limited evidence of deeply affordable rental pressure from public data.';
      }
    };
  }

  function buildWorkforceRental(acs, chas) {
    // commute-in workforce signal we don't always have — use NULL when absent
    var renterCBAny = (acs.renterCB30 != null) ? acs.renterCB30
                    : (acs.renterCB35 != null) ? acs.renterCB35 + 10 : null;
    // Home value / MHI gap — wide ownership gap drives renter demand at the
    // workforce tier even where renter share is currently small (Fruita,
    // Salida — fast-growing places where the workforce can't buy in).
    var hvToMhi = (acs.medHomeVal != null && acs.mhi) ? acs.medHomeVal / acs.mhi : null;
    var indicators = [
      // Bumped to 0.32 from 0.30 — strongest CHAS signal of the target cohort.
      ind('60–80% AMI renter share', 0.32,
        chas.renterByAmi ? chas.renterByAmi.t6080Share : null,
        ramp(chas.renterByAmi ? chas.renterByAmi.t6080Share : null,
             [[3, 0], [8, 45], [15, 80], [25, 100]])),
      // Set to 0.22 from 0.25 — generic renter burden was over-rewarding
      // low-MHI workforce markets (Pueblo) where the real need is deeply
      // affordable, not workforce. Pivot kept reasonable so resort/SF towns
      // still register but burden alone doesn't dominate.
      ind('Renter cost burden (severe, 35%+)', 0.22,
        renterCBAny,
        ramp(renterCBAny, [[20, 0], [30, 35], [45, 75], [60, 100]])),
      // Bumped to 0.20 from 0.15 — burden *inside* the 51-80% AMI cohort
      // is the cleanest workforce-specific signal (vs generic renter burden,
      // which conflates ELI with workforce). Strong here means actual
      // 60-80% AMI households are under pressure.
      ind('Cost burden in 51–80% AMI cohort', 0.20,
        chas.costBurdenAmi6080,
        ramp(chas.costBurdenAmi6080, [[20, 0], [40, 45], [60, 80], [75, 100]])),
      // Dropped to 0.10 from 0.15 — Fruita (renter 20%) and Salida (37%) score
      // 0 / 50 here but are workforce-pressured by *home prices*, not renter
      // share. Over-weighting this signal makes small SF-dominated boom towns
      // look "no workforce need" when developer intuition is the opposite.
      ind('Renter share of households', 0.10,
        acs.renterPct,
        ramp(acs.renterPct, [[20, 0], [30, 35], [45, 75], [60, 100]])),
      // New signal at 0.10 — picks up workforce squeeze in resort/SF-heavy
      // places where home value to MHI ratio exceeds ~5x (Boulder 13x, Salida
      // 9x, Fruita 4.6x). Without this Boulder reads too low here.
      ind('Home value to MHI ratio (workforce ownership squeeze)', 0.10,
        hvToMhi,
        ramp(hvToMhi, [[3.5, 0], [5, 40], [7, 75], [10, 100]])),
      ind('Attached / multifamily stock share', 0.05,
        acs.attachedShare,
        // Lower attached share = more workforce need
        ramp(acs.attachedShare == null ? null : (60 - Math.min(60, acs.attachedShare)),
             [[10, 0], [25, 50], [40, 100]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'workforceRental',
      label: 'Workforce rental',
      meta: '60–80% AMI · apartment / townhome · rent',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'Blend of 60–80% AMI renter share (32%), severe renter cost burden (28%), ' +
        'cost burden inside the 51–80% cohort (15%), renter share of households (10%), home ' +
        'value to MHI ratio (10%), and a low-attached-stock proxy (5%). The home-value-to-MHI ' +
        'addition catches resort/SF-heavy places where workforce can\'t buy in even when renter ' +
        'share is small.',
      lihtcRelevance: 'Sweet spot for 60–80% AMI LIHTC + workforce overlay (Prop 123 ' +
        'middle-income overlay, CDOH workforce funds).',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'A meaningful 60–80% AMI renter cohort under cost pressure — a fit for ' +
                 'workforce LIHTC at the upper income tiers.';
        }
        if (level === 'Moderate') {
          return 'Moderate workforce-rental signal; pair with employer wage data before ' +
                 'committing to a 60–80% AMI mix.';
        }
        return 'Workforce-rental signal is muted — most renter need sits in a different AMI band.';
      }
    };
  }

  function buildFamilyRental(acs, chas) {
    // Family rental — proxy renter-family demand via familyHHPct × renterPct
    var renterFamilyDemand = (acs.familyHHPct != null && acs.renterPct != null)
      ? (acs.familyHHPct * acs.renterPct) / 100
      : null;
    // Lack of 2-3BR rental supply: invert the share of 2-3BR units (DP04
    // bedroom mix covers all units, but in renter-heavy markets it's a fair
    // bedroom-availability proxy).
    var br23Deficit = acs.br2_3Share != null ? Math.max(0, 65 - acs.br2_3Share) : null;
    // Renter-count scale: an additional family-rental demand signal that
    // captures sheer market depth (Denver 180K renters → needs lots of
    // family product; Salida 1K renters → less so). Combines with familyHHPct
    // and overcrowding for a 3-signal anchor that doesn't depend on overcrowdPct.
    var renterCount = acs.renterCount;
    var indicators = [
      // Bumped to 0.30 from 0.25 — family HH share is the most direct signal
      // of who needs 2-3BR rental, and the count→share fallback now makes it
      // reliable. Pivots adjusted: 50% family HH is roughly the urban baseline,
      // not 40%. Denver 48%, Boulder 40%, Fruita 70%, Pueblo 63%, Salida 54%.
      ind('Family households (% of all HHs)', 0.30,
        acs.familyHHPct,
        ramp(acs.familyHHPct, [[35, 0], [50, 40], [62, 75], [72, 100]])),
      // Bumped to 0.30 from 0.25 — this composite (family% × renter%) IS
      // the family-rental demand signal: Boulder 23, Fruita 14, Denver 25,
      // Pueblo 23, Salida 20. Pivots tightened so urban places score higher.
      ind('Renter-family demand proxy', 0.30,
        renterFamilyDemand,
        ramp(renterFamilyDemand, [[8, 0], [15, 40], [22, 75], [30, 100]])),
      // Dropped to 0.15 from 0.20 — when DP02_0016E is missing we derive
      // avgHHSize from pop/totalHH which biases low in urban places (group
      // quarters + non-family HHs). Lower weight reduces that distortion.
      ind('Average household size', 0.15,
        acs.avgHHSize,
        ramp(acs.avgHHSize, [[2.0, 0], [2.4, 40], [2.8, 75], [3.2, 100]])),
      ind('Overcrowding (≥1.01 occupants/room)', 0.15,
        acs.overcrowdPct,
        ramp(acs.overcrowdPct, [[1, 0], [3, 40], [6, 75], [10, 100]])),
      ind('Renter market depth (renter HH count)', 0.05,
        renterCount,
        ramp(renterCount, [[500, 0], [3000, 35], [15000, 75], [80000, 100]])),
      ind('2–3BR rental deficit proxy (from DP04 mix)', 0.05,
        br23Deficit,
        ramp(br23Deficit, [[0, 0], [5, 35], [15, 75], [25, 100]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'familyRental',
      label: 'Family-sized rental',
      meta: '2–3BR · mixed AMI · MF / townhome · rent',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'Combines family-HH share (25%), renter-family demand proxy (25%), ' +
        'average HH size (20%), overcrowding (20%), and a 2–3BR rental deficit derived from ' +
        'the DP04 bedroom mix (10%).',
      lihtcRelevance: 'Family LIHTC scoring (CHFA QAP family set-aside, larger 2–3BR units, ' +
        'children near schools).',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'Bigger households, family-heavy renter mix, and overcrowding all point to ' +
                 'family-sized rental as a strong fit.';
        }
        if (level === 'Moderate') {
          return 'Family-rental signals are present but mixed — confirm with school-enrollment ' +
                 'trends and renter-HH composition.';
        }
        return 'Family-rental need is weaker than other types here — non-family or senior ' +
               'configurations may absorb faster.';
      }
    };
  }

  function buildSeniorRental(acs) {
    var indicators = [
      // Bumped to 0.40 from 0.35 — now that the count→percentage fallback
      // works, share-of-population is the most reliable senior-density signal
      // (Salida ~25% over-65, Pueblo ~17%, Denver ~12%, Fruita ~16%, Boulder ~12%).
      ind('Senior population (65+ share)', 0.40,
        acs.seniorPct,
        ramp(acs.seniorPct, [[10, 0], [15, 35], [20, 65], [30, 100]])),
      ind('1BR housing supply share', 0.20,
        // Higher 1BR share *helps* seniors, so we invert: low 1BR share = unmet need
        acs.br1Share == null ? null : Math.max(0, 25 - acs.br1Share),
        ramp(acs.br1Share == null ? null : Math.max(0, 25 - acs.br1Share),
             [[0, 0], [5, 35], [15, 75], [22, 100]])),
      // Repointed at severe rent burden — DP04_0142PE (35%+) which is what
      // renterCB30 now sums into; pivot raised because severe burden numbers
      // are smaller than the legacy "30%+" composite. Cost-burdened renters
      // map well to fixed-income senior demand.
      ind('Renter cost burden (severe, 35%+)', 0.20,
        acs.renterCB35,
        ramp(acs.renterCB35, [[15, 0], [25, 35], [40, 75], [55, 100]])),
      // Weight unchanged 0.20 but pivots tightened — 500 → 0 was too
      // generous; tiny places shouldn't score senior need from raw counts
      // alone. Also raised the top pivot so Denver (87K seniors) saturates
      // and registers strong senior demand instead of being a midband score.
      ind('Senior population count (absolute)', 0.20,
        acs.senior65,
        ramp(acs.senior65, [[1000, 0], [3000, 45], [10000, 85], [30000, 100]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'seniorRental',
      label: 'Senior rental',
      meta: '1–2BR · mixed AMI · apartment / cottage · rent',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'Weighted on 65+ share (40%), an inverted 1BR supply share (20%), severe ' +
        'renter cost burden as a senior-renter proxy (20%), and absolute 65+ population (20%, ' +
        'guarded against tiny-place over-fitting). 65+ share derived from DP05_0024E count ' +
        'when DP05_0024PE percentage is unavailable.',
      lihtcRelevance: 'Aligns with CHFA senior-restricted set-asides and HUD 202 / age-restricted ' +
        'LIHTC overlays.',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'High senior share with cost-burdened renters and limited 1BR supply — ' +
                 'senior-restricted rental fits here.';
        }
        if (level === 'Moderate') {
          return 'Senior demand is meaningful; pair with senior cost-burden data before ' +
                 'committing to an age-restricted program.';
        }
        return 'Senior-rental demand is below other types — a senior set-aside on a family ' +
               'project may be a more efficient fit.';
      }
    };
  }

  function buildMissingMiddleOwnership(acs) {
    // Ownership affordability gap: median home value / MHI ratio.
    // National "healthy" ratio is ~3.0; >5 signals stress.
    var hvToMhi = (acs.medHomeVal != null && acs.mhi) ? acs.medHomeVal / acs.mhi : null;
    // Low attached production = need for missing middle
    var attachedDeficit = acs.attachedShare != null ? Math.max(0, 40 - acs.attachedShare) : null;
    var indicators = [
      // Dropped to 0.20 from 0.30 — SF dominance alone over-rewards typical
      // CO suburbs (Fruita 82%, Pueblo 76%, Denver 49%) and was lifting
      // missing-middle scores even where the ownership *gap* was small.
      ind('Detached SF dominance (DP04 structure mix)', 0.20,
        acs.sfDetachedShare,
        ramp(acs.sfDetachedShare, [[55, 0], [70, 45], [80, 80], [90, 100]])),
      // Bumped to 0.35 from 0.30 — the gap between home values and incomes
      // is the strongest direct measure of "stuck renters who can't buy".
      // Boulder 13x, Salida 9x, Denver 7x, Fruita 4.6x, Pueblo 4.7x.
      ind('Home value to MHI ratio (ownership gap)', 0.35,
        hvToMhi,
        ramp(hvToMhi, [[3, 0], [4.5, 45], [6, 80], [8, 100]])),
      ind('Attached-unit production deficit', 0.20,
        attachedDeficit,
        ramp(attachedDeficit, [[0, 0], [10, 40], [25, 80], [35, 100]])),
      // Bumped to 0.25 from 0.20 — owner cost burden directly indicates
      // existing owners squeezed by mortgages, the people who would refinance
      // or downsize into for-sale missing-middle product.
      ind('Owner cost burden (≥30% of income)', 0.25,
        acs.ownerCB30Pct,
        ramp(acs.ownerCB30Pct, [[15, 0], [25, 40], [35, 75], [45, 100]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'missingMiddleOwnership',
      label: 'Missing-middle ownership',
      meta: '80–120% AMI · townhome / duplex / fourplex · own',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'Blend of detached-SF dominance (20%), home-value-to-MHI ratio (35%), ' +
        'attached-unit production deficit (20%), and owner cost burden (25%). Home-value-to-MHI ' +
        'ratio is the strongest "stuck renters who want to buy" signal; SF dominance is now ' +
        'secondary because virtually all CO suburbs hit ≥75% detached.',
      lihtcRelevance: 'Outside core 4%/9% LIHTC but pairs with for-sale Prop 123, MLI, CHFA ' +
        'down-payment, and inclusionary-zoning levers.',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'Detached-SF dominated stock plus a wide home-value-to-income gap point to ' +
                 'attached for-sale missing middle.';
        }
        if (level === 'Moderate') {
          return 'Mixed signals — some ownership-affordability stress, but stock is more ' +
                 'diverse here than a typical missing-middle target.';
        }
        return 'Missing-middle pressure is muted — rental categories likely score higher.';
      }
    };
  }

  function buildDetachedSfOwnership(acs, hud) {
    // High-MHI households drive detached SF demand. We use MHI vs HUD AMI 100%.
    var mhiAboveAmi = (acs.mhi != null && hud.ami100_4p) ? acs.mhi / hud.ami100_4p : null;
    var indicators = [
      ind('MHI vs HUD 100% AMI (4-person)', 0.30,
        mhiAboveAmi,
        ramp(mhiAboveAmi, [[0.8, 0], [1.0, 35], [1.2, 70], [1.5, 100]])),
      ind('School-age population (under 18 share)', 0.25,
        acs.schoolAgePct,
        ramp(acs.schoolAgePct, [[15, 0], [20, 35], [25, 75], [30, 100]])),
      ind('3BR+ unit share (existing detached supply)', 0.20,
        acs.br3pShare,
        // High existing 3BR+ share suggests market demand is met
        ramp(acs.br3pShare == null ? null : Math.max(0, 70 - acs.br3pShare),
             [[0, 0], [15, 40], [30, 80], [45, 100]])),
      // Dropped to 0.10 from 0.15 and pulled the upper pivot up — population
      // scale was pulling Denver into "high SF demand" simply because of size,
      // even though the affordability gap is so wide that *new* market-rate
      // SF supply is overbuilt relative to demand the market can actually
      // serve. Now only true large suburbs (>100K) saturate.
      ind('Population scale', 0.10,
        acs.pop,
        ramp(acs.pop, [[1000, 0], [5000, 35], [25000, 70], [100000, 100]])),
      // Bumped to 0.15 from 0.10 and *inverted* — high owner cost burden
      // signals the existing detached SF stock is already over-stressed, so
      // *additional* market-rate SF supply at top of market is less defensible.
      // Low burden = headroom for more SF demand. Pueblo 31% burden → 30
      // (low SF need); Boulder ~28% → 45; Fruita ~18% → 80.
      ind('Owner cost burden (inverted — high burden = saturated market)', 0.15,
        acs.ownerCB30Pct,
        ramp(acs.ownerCB30Pct, [[15, 100], [25, 60], [35, 25], [45, 0]]))
    ];
    var agg = aggregate(indicators);
    return {
      type: 'detachedSfOwnership',
      label: 'Detached SF ownership',
      meta: '100%+ AMI · 3BR+ · single-family · own',
      indicators: indicators,
      score: agg.score,
      available: agg.available,
      methodology: 'MHI-vs-AMI (30%), school-age share (25%), inverted 3BR+ supply (20%), ' +
        'population scale (10%), and inverted owner cost burden (15%). Indicates headroom for ' +
        'market-rate SF demand: high MHI, kids, low burden, undersupplied 3BR+ stock.',
      lihtcRelevance: 'Not a LIHTC target — but high score here flags healthy market-rate ' +
        'demand that can crowd out affordable land + crew capacity.',
      plainEnglish: function (level) {
        if (level === 'VeryHigh' || level === 'High') {
          return 'Strong market-rate SF demand — affordable projects compete for land and labor ' +
                 'with this segment.';
        }
        if (level === 'Moderate') {
          return 'Some market-rate SF demand; coordination with for-sale developers may ease ' +
                 'land assembly for LIHTC siting.';
        }
        return 'Market-rate SF demand is light — affordable projects face less land competition.';
      }
    };
  }

  // ── confidence calculation ────────────────────────────────────────────────

  function deriveConfidence(category, acs) {
    var n = category.available;
    var level = n >= 4 ? 'high' : (n >= 2 ? 'med' : 'low');
    var reasons = [];
    reasons.push(n + ' of ' + category.indicators.length + ' indicators populated');
    var smallSample = (acs.pop != null && acs.pop < 5000);
    if (smallSample) reasons.push('small place (pop < 5,000) — ACS MOE may be wide');
    if (!acs.hasBedroomMix) reasons.push('DP04 bedroom mix not available');
    if (smallSample && level === 'high') level = 'med';
    return { confidence: level, confidenceReason: reasons.join('; ') };
  }

  // ── public API ────────────────────────────────────────────────────────────

  function compute(input) {
    input = input || {};
    var acs = extractAcs(input.acsProfile);
    var chas = extractChas(input.chasRows);
    var hud  = extractHud(input.hudIncomeLimits);
    var lihtc = extractLihtc(input.lihtcInventory, input.jurisdictionName);

    var categories = [
      buildDeeplyAffordableRental(acs, chas),
      buildWorkforceRental(acs, chas),
      buildFamilyRental(acs, chas),
      buildSeniorRental(acs),
      buildMissingMiddleOwnership(acs),
      buildDetachedSfOwnership(acs, hud)
    ];

    var results = categories.map(function (cat) {
      var level = scoreToLevel(cat.score);
      var conf  = deriveConfidence(cat, acs);
      // Surface top 3 contributing signals (by contribution).
      var topSignals = cat.indicators
        .filter(function (i) { return i.value != null; })
        .sort(function (a, b) { return (b.contribution || 0) - (a.contribution || 0); })
        .slice(0, 3)
        .map(function (i) {
          return {
            name: i.name,
            value: i.raw,
            normalised: i.value == null ? null : Math.round(i.value),
            weight: i.weight,
            contribution: i.contribution == null ? null : Math.round(i.contribution * 10) / 10
          };
        });

      return {
        type: cat.type,
        label: cat.label,
        meta: cat.meta,
        score: cat.score,
        level: level,
        signals: topSignals,
        confidence: conf.confidence,
        confidenceReason: conf.confidenceReason,
        lihtcRelevance: cat.lihtcRelevance,
        plainEnglish: cat.plainEnglish(level),
        methodology: cat.methodology
      };
    });

    // Sort by score descending (callers can re-sort if they want a fixed order).
    results.sort(function (a, b) { return b.score - a.score; });

    // Attach a small piece of context the renderer can show.
    results._context = {
      jurisdiction: input.jurisdictionName || '',
      lihtcUnitsHere: lihtc.lihtcUnits,
      lihtcRecords: lihtc.recordCount,
      pop: acs.pop,
      mhi: acs.mhi,
      hasBedroomMix: acs.hasBedroomMix
    };

    return results;
  }

  root.HousingTypeNeed = {
    compute: compute,
    // exposed for unit tests / debugging
    _scoreToLevel: scoreToLevel,
    _extractAcs: extractAcs
  };

}(typeof window !== 'undefined' ? window : globalThis));
