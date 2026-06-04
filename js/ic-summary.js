/**
 * ic-summary.js — render a one-page LIHTC underwriting snapshot for a chosen
 * jurisdiction. The HNA / OF / Compare pages have already been audited so the
 * place-level data files we read here are trustworthy (F30–F46). This page
 * pulls a curated subset into a single printable view so a developer can drop
 * it into an investment-committee packet.
 *
 * URL: ic-summary.html?geoid=<7-digit place geoid>      (place / CDP)
 *      ic-summary.html?geoid=<5-digit county FIPS>      (county)
 *
 * Data loaded (all already in repo):
 *   data/hna/summary/{geoid}.json        — ACS profile (place / county)
 *   data/hna/place-lehd.json             — per-place LEHD blob (F40 + F46)
 *   data/hna/place-chas.json             — per-place CHAS summary (F28)
 *   data/co_ami_gap_by_place.json        — per-place affordable demand (F30)
 *   data/co_ami_gap_by_county.json       — fallback for county selection
 *   data/hna/local-resources.json        — Prop 123 / plans / authority (F44)
 *   data/co-place-centroids.json         — place centroids for radius
 *   data/market/hud_lihtc_co.geojson     — statewide LIHTC points
 *   data/hna/geo-config.json             — place→county membership
 *   data/dda-colorado.json               — DDA designations
 *   data/qct-colorado.json               — QCT tracts
 *
 * Render order matches the underwriting narrative: profile → demand → commute
 * → competition/basis → civic → peers.
 */
(function () {
  'use strict';

  var $  = function (id) { return document.getElementById(id); };
  var fmtN = function (n) { return (n == null || !isFinite(+n)) ? '—' : Math.round(+n).toLocaleString(); };
  var fmtPct = function (n, d) { return (n == null || !isFinite(+n)) ? '—' : (+n).toFixed(d == null ? 1 : d) + '%'; };
  var fmtMoney = function (n) { return (n == null || !isFinite(+n)) ? '—' : '$' + Math.round(+n).toLocaleString(); };

  /* ── URL params ──────────────────────────────────────────────── */
  var params = new URLSearchParams(window.location.search);
  var geoid  = (params.get('geoid') || params.get('fips') || '').replace(/\D/g, '');

  // F203 — WorkflowState fallback. If the URL has no geoid, read the
  // active project's jurisdiction so navigating IC Summary from HNA or
  // Deal Calc auto-targets the user's current work, not "no jurisdiction".
  if (!geoid && window.WorkflowState && window.WorkflowState.getActiveProject) {
    try {
      var proj = window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (jx) {
        geoid = (jx.geoid || jx.fips || '').replace(/\D/g, '');
        // Surface that the geoid was inferred — partner sharing this URL
        // would not get the same view, so the user should add ?geoid=.
        if (geoid) {
          console.log('[IC] Hydrated geoid', geoid, 'from WorkflowState');
        }
      }
    } catch (_) {}
  }

  var geoType = params.get('geoType') ||
    (geoid.length === 7 ? 'place' : (geoid.length === 5 ? 'county' : null));

  if (!geoid || !geoType) {
    var err = $('icErr');
    if (err) {
      err.style.display = 'block';
      err.innerHTML =
        '<strong>Missing jurisdiction.</strong> Add <code>?geoid=&lt;7-digit place&gt;</code> or ' +
        '<code>?geoid=&lt;5-digit county&gt;</code> to the URL.<br>' +
        'Examples: <a href="?geoid=0853395">New Castle</a> · ' +
        '<a href="?geoid=0807850">Boulder</a> · ' +
        '<a href="?geoid=08045">Garfield County</a>.';
    }
    return;
  }

  // F214 — Deal Calc deep-link pill. When the user reached IC Summary
  // via the "Open IC Summary →" button on Deal Calc, the share URL
  // carries a `dc` param pointing back to the underwriting scenario.
  // Surface a pill at the top so the reader can drill back in.
  // Whitelist: dc must be same-origin to prevent open-redirect XSS.
  var dcDeepLink = params.get('dc');
  if (dcDeepLink) {
    try {
      var dcUrl = new URL(dcDeepLink, window.location.origin);
      if (dcUrl.origin === window.location.origin && /deal-calculator\.html?$/.test(dcUrl.pathname)) {
        var dcPill = document.createElement('div');
        dcPill.id = 'ic-dc-back-link';
        dcPill.style.cssText = 'margin:0 18px 12px;max-width:1400px;padding:8px 14px;' +
          'background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius);' +
          'font-size:.85rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;';
        var msg  = document.createElement('span');
        msg.style.color = 'var(--accent)';
        msg.innerHTML = '📊 <strong>Underwriting scenario</strong> attached from Deal Calculator.';
        var link = document.createElement('a');
        link.href = dcUrl.toString();
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open the deal underwriting →';
        link.style.cssText = 'color:var(--accent);font-weight:700;text-decoration:none;border:1px solid var(--accent);padding:4px 12px;border-radius:var(--radius-sm);';
        dcPill.appendChild(msg);
        dcPill.appendChild(link);
        var mainEl = document.querySelector('main') || document.body;
        mainEl.insertBefore(dcPill, mainEl.firstChild);
      }
    } catch (_) { /* non-blocking */ }
  }

  /* ── Fetch helpers ───────────────────────────────────────────── */
  function soft(path) {
    return fetch(path, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([
    soft('data/hna/summary/' + geoid + '.json'),
    soft('data/hna/place-lehd.json'),
    soft('data/hna/place-chas.json'),
    soft('data/co_ami_gap_by_place.json'),
    soft('data/co_ami_gap_by_county.json'),
    soft('data/hna/chas_affordability_gap.json'),
    soft('data/hna/local-resources.json'),
    soft('data/co-place-centroids.json'),
    soft('data/market/hud_lihtc_co.geojson'),
    soft('data/hna/geo-config.json'),
    soft('data/dda-colorado.json'),
    soft('data/qct-colorado.json'),
    soft('data/hna/place-od-flows.json'),
  ]).then(function (parts) {
    var summary    = parts[0]; // ACS profile + geo metadata for THIS jurisdiction
    var placeLehd  = (parts[1] && parts[1].places) || {};
    var placeChas  = (parts[2] && parts[2].places) || {};
    var amiByPlace = (parts[3] && parts[3].places) || {};
    var amiByCounty= (parts[4] && parts[4].counties) || [];
    var chasByCty  = (parts[5] && parts[5].counties) || {};
    var lrAll      = parts[6] || {};
    var centroids  = (parts[7] && parts[7].byGeoid) || {};
    var lihtcFeats = (parts[8] && parts[8].features) || [];
    var geoConfig  = parts[9] || {};
    var ddaFeats   = (parts[10] && parts[10].features) || [];
    var qctFeats   = (parts[11] && parts[11].features) || [];
    var odFlows    = (parts[12] && parts[12].places) || {};

    render(summary, placeLehd, placeChas, amiByPlace, amiByCounty, chasByCty,
           lrAll, centroids, lihtcFeats, geoConfig, ddaFeats, qctFeats, odFlows);
  }).catch(function (e) {
    var err = $('icErr');
    if (err) {
      err.style.display = 'block';
      err.textContent = 'Failed to load IC data: ' + e.message;
    }
  });

  /* ── Render ──────────────────────────────────────────────────── */
  function render(summary, placeLehd, placeChas, amiByPlace, amiByCounty, chasByCty,
                  lrAll, centroids, lihtcFeats, geoConfig, ddaFeats, qctFeats, odFlows) {
    var isPlace = geoType === 'place' || geoType === 'cdp';
    var name, countyFips, countyName;
    if (isPlace) {
      var meta = (geoConfig.places || []).concat(geoConfig.cdps || [])
        .find(function (p) { return p.geoid === geoid; });
      name = (meta && meta.label) ||
             (placeLehd[geoid] && placeLehd[geoid].name) ||
             (summary && summary.geo && summary.geo.NAME) || geoid;
      // Strip "(town)" / "(city)" / "(CDP)" for header headline
      var stripped = name.replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').trim();
      countyFips = meta && meta.containingCounty;
      if (!countyFips && placeLehd[geoid] && placeLehd[geoid].counties_spanned && placeLehd[geoid].counties_spanned[0]) {
        countyFips = placeLehd[geoid].counties_spanned[0];
      }
      $('icTitle').textContent = stripped;
      $('icSubtitle').textContent = countyFips ? (lookupCountyName(countyFips, geoConfig) || '') + ' · ' + (meta && meta.type || 'place') : '';
    } else {
      countyFips = geoid;
      var cn = (geoConfig.counties || []).find(function (c) { return c.geoid === geoid; });
      name = (cn && cn.label) || (summary && summary.geo && summary.geo.NAME) || geoid;
      $('icTitle').textContent = name;
      $('icSubtitle').textContent = 'County';
    }
    countyName = lookupCountyName(countyFips, geoConfig) || '';
    $('icMeta').innerHTML = 'Generated ' + new Date().toLocaleDateString() + '<br>geoid ' + geoid;
    $('icGen').textContent = new Date().toLocaleString();
    var ml = $('icMethodLink'); if (ml) ml.href = 'housing-needs-assessment.html?geoid=' + geoid + '&geoType=' + geoType + '&auto=1';

    /* ── Profile ── */
    var p = (summary && summary.acsProfile) || {};
    $('icPop').textContent    = fmtN(p.DP05_0001E);
    $('icMhi').textContent    = fmtMoney(p.DP03_0062E);
    $('icRent').textContent   = p.DP04_0134E != null ? fmtMoney(p.DP04_0134E) + '/mo' : '—';
    $('icRenter').textContent = p.DP04_0047PE != null ? fmtPct(p.DP04_0047PE) : '—';
    // Rent burden = DP04_0141PE (30-35%) + DP04_0142PE (35%+)
    var rb = (parseFloat(p.DP04_0141PE) || 0) + (parseFloat(p.DP04_0142PE) || 0);
    $('icBurden').textContent = rb > 0 ? fmtPct(rb) : '—';
    $('icProfileSource').textContent = summary && summary._acsYear ? 'ACS ' + summary._acsYear : '';

    /* ── Affordability demand ── */
    renderAmiTiers(isPlace ? amiByPlace[geoid] : findCountyAmi(amiByCounty, countyFips), isPlace);

    /* ── Commute pattern ── */
    renderCommute(isPlace ? placeLehd[geoid] : null, odFlows[geoid] || null, isPlace);

    /* ── LIHTC competition + basis boost ── */
    renderCompetition(lihtcFeats, centroids, countyFips);

    /* ── DDA / QCT ── */
    renderBasisBoost(ddaFeats, qctFeats, countyFips, name);

    /* ── Civic / local resources ── */
    renderCivic(lrAll, geoid, countyFips, isPlace);

    /* ── Peers ── */
    renderPeers(geoConfig, placeLehd, amiByPlace, lihtcFeats, geoid, countyFips, isPlace);

    /* ── F139: Anchor institutions (school district / hospital / employers) ── */
    renderAnchorInstitutions(lrAll, geoid, countyFips, isPlace);

    /* ── F139: Capital partners — scoped to typical LIHTC stack ── */
    renderCapitalPartners();

    /* ── Comparable LIHTC deals (page 2 of packet) ── */
    renderComparableDeals(lihtcFeats, centroids, countyFips);

    /* ── F139: Multi-source comp set from properties.json ── */
    renderMultiSourceComp(centroids, countyFips);

    /* ── F141: Tax abatement / PILOT / fee inventory ── */
    renderTaxAbatement(isPlace);

    /* ── F143: CHFA QAP cycle + upcoming deadlines ── */
    renderQapCalendar();

    /* ── F145: Resort housing authority + workforce-housing programs ── */
    renderResortWfh(isPlace, countyFips);

    /* ── F151: CHFA LIHTC award history for this jurisdiction ── */
    renderChfaAwardHistory(isPlace, countyFips, name);
  }

  /* ── F151: CHFA award history (consume F148 component) ────── */
  function renderChfaAwardHistory(isPlace, countyFips, jurisName) {
    var mount = $('icChfaAwardHistory');
    if (!mount || !window.ChfaAwardHistory) return;
    window.ChfaAwardHistory.attach(mount, {
      placeGeoid: isPlace ? geoid : null,
      countyFips: countyFips ? String(countyFips).slice(-3) : null,
      cityName:   jurisName
    });
  }

  /* ── F145: Resort housing authority detail ──────────────────── */
  function renderResortWfh(isPlace, countyFips) {
    var mount   = $('icResortWfh');
    var section = $('icResortWfhSection');
    if (!mount || !window.ResortWfh) return;
    window.ResortWfh.attach(mount, {
      placeGeoid: isPlace ? geoid : null,
      countyFips: countyFips ? String(countyFips).slice(-3) : null,
      jurisName:  $('icTitle').textContent
    });
    // Reveal section once renderer has injected content
    setTimeout(function () {
      if (section && mount.innerHTML.trim().length > 0) section.hidden = false;
    }, 50);
  }

  /* ── F141: Tax abatement / PILOT / fee inventory ────────────── */
  function renderTaxAbatement(isPlace) {
    var mount = $('icTaxAbatement');
    if (!mount || !window.TaxAbatement) return;
    var geoKey = (isPlace ? 'place:' : 'county:') + geoid;
    window.TaxAbatement.attach(mount, {
      geoKey:    geoKey,
      jurisName: $('icTitle').textContent || undefined
    });
  }

  /* ── F143: CHFA QAP cycle calendar ──────────────────────────── */
  function renderQapCalendar() {
    var mount = $('icQapCalendar');
    if (!mount || !window.QapCalendar) return;
    // IC packet uses compact mode (hide past events) + include rolling
    // programs so IC committee sees the full timing picture.
    window.QapCalendar.attach(mount, { compact: true, showRolling: true });
  }

  function lookupCountyName(fips, geoConfig) {
    if (!fips) return null;
    var c = (geoConfig.counties || []).find(function (x) { return x.geoid === fips; });
    return c && c.label;
  }
  function findCountyAmi(arr, fips) {
    if (!Array.isArray(arr)) return null;
    var target = String(fips).padStart(5, '0');
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].fips).padStart(5, '0') === target) return arr[i];
    }
    return null;
  }

  /* ── AMI tiers ── */
  function renderAmiTiers(rec, isPlace) {
    var row = $('icAmiTiers');
    var bands = [30, 40, 50, 60, 70, 80, 100];
    row.innerHTML = bands.map(function (b) {
      var hh = rec && rec.households_le_ami_pct && rec.households_le_ami_pct[String(b)];
      var lbl = (b === 100 ? '≤100%' : '≤' + b + '%');
      return '<div><div class="ic-tier-k">' + lbl + ' AMI</div>' +
             '<div class="ic-tier-v">' + (hh != null ? fmtN(hh) : '—') + '</div></div>';
    }).join('');
    if (rec && rec.households_le_ami_pct) {
      var hh100 = +rec.households_le_ami_pct['100'] || 0;
      var un100 = +(rec.units_priced_affordable_le_ami_pct || {})['100'] || 0;
      var gap = Math.max(0, hh100 - un100);
      var msg = '<strong>' + fmtN(hh100) + '</strong> households earn ≤100% AMI; ~<strong>' + fmtN(gap)
        + '</strong> remain after netting existing rental units already priced affordable to them. '
        + (isPlace ? 'Place-level (ACS B19001 × HUD 2025 limits at place geography).' : 'County-level.');
      $('icGapCallout').innerHTML = msg;
    } else {
      $('icGapCallout').textContent = 'AMI-gap data unavailable for this geography.';
    }
  }

  /* ── Commute ── */
  function renderCommute(plRec, odRec, isPlace) {
    var lehd = plRec && plRec.lehd;
    var within, inflow, outflow, jobs, source;
    if (lehd) {
      within = +lehd.within || 0; inflow = +lehd.inflow || 0; outflow = +lehd.outflow || 0; jobs = +lehd.jobs || +lehd.C000 || 0;
      source = lehd.flows_source === 'block-od' ? 'LEHD LODES · block-classified'
             : lehd.flows_source === 'tract-lodes' ? 'LEHD LODES · tract-weighted'
             : 'LEHD LODES';
    } else if (odRec) {
      within = odRec.within; inflow = odRec.inflow; outflow = odRec.outflow; jobs = odRec.jobs;
      source = 'LEHD LODES · block-classified';
    } else {
      $('icWithin').textContent = $('icInflow').textContent = $('icOutflow').textContent = $('icJobs').textContent = '—';
      $('icFlowSource').textContent = 'LEHD LODES';
      $('icFlowCallout').textContent = 'Commute flows unavailable for this geography.';
      return;
    }
    $('icWithin').textContent  = fmtN(within);
    $('icInflow').textContent  = fmtN(inflow);
    $('icOutflow').textContent = fmtN(outflow);
    $('icJobs').textContent    = fmtN(jobs);
    $('icFlowSource').textContent = source;
    var pattern;
    if (within + inflow + outflow === 0) {
      pattern = 'No data.';
    } else if (inflow > outflow * 1.5 && inflow > within) {
      pattern = '<strong>Job hub:</strong> inflow ' + fmtN(inflow) + ' ≫ outflow ' + fmtN(outflow)
              + ' — this market attracts workers from elsewhere. LIHTC demand here is workforce-driven.';
    } else if (outflow > inflow * 1.5 && outflow > within) {
      pattern = '<strong>Bedroom community:</strong> outflow ' + fmtN(outflow) + ' ≫ inflow ' + fmtN(inflow)
              + ' — residents commute out for work. LIHTC demand here is housing-pressure-driven (residents priced out of job-hub markets).';
    } else {
      pattern = '<strong>Balanced live-work:</strong> within ' + fmtN(within) + ' is roughly the size of net flow.';
    }
    $('icFlowCallout').innerHTML = pattern;
  }

  /* ── LIHTC competition ── */
  function haversineMi(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function renderCompetition(lihtcFeats, centroids, countyFips) {
    var isPlace = geoType === 'place' || geoType === 'cdp';
    var placeName = $('icTitle').textContent.toUpperCase();
    var countyTarget = String(countyFips || '').padStart(5, '0');
    var inPlace = 0, inPlaceUnits = 0, inCounty = 0, inCountyUnits = 0;
    lihtcFeats.forEach(function (f) {
      var p = f.properties || {};
      var fips = String(p.CNTY_FIPS || p.cnty_fips || '').padStart(5, '0');
      var city = (p.PROJ_CTY || p.proj_cty || '').trim().toUpperCase();
      var units = parseInt(p.LI_UNITS || p.li_units || 0, 10) || 0;
      if (fips === countyTarget) { inCounty++; inCountyUnits += units; }
      if (isPlace && city === placeName) { inPlace++; inPlaceUnits += units; }
    });
    if (isPlace) {
      $('icLihtcPlace').textContent = fmtN(inPlace) + (inPlace ? ' projects · ' + fmtN(inPlaceUnits) + ' LI units' : ' projects');
    } else {
      $('icLihtcPlace').textContent = 'n/a (county view)';
    }
    $('icLihtcCounty').textContent = fmtN(inCounty) + ' projects · ' + fmtN(inCountyUnits) + ' LI units';

    // 15-mi radius
    var c = centroids[geoid];
    if (c && c.lat && c.lng) {
      var n = 0, u = 0;
      lihtcFeats.forEach(function (f) {
        var coords = f.geometry && f.geometry.coordinates;
        if (!coords) return;
        if (haversineMi(c.lat, c.lng, coords[1], coords[0]) <= 15) {
          n++;
          u += parseInt((f.properties || {}).LI_UNITS || (f.properties || {}).li_units || 0, 10) || 0;
        }
      });
      $('icLihtcRadius').textContent = fmtN(n) + ' projects · ' + fmtN(u) + ' LI units';
    } else {
      $('icLihtcRadius').textContent = 'centroid unavailable';
    }
  }

  function renderBasisBoost(ddaFeats, qctFeats, countyFips, jurisdictionName) {
    var qctCount = 0;
    var countyTarget = String(countyFips || '').padStart(5, '0');
    qctFeats.forEach(function (f) {
      var p = f.properties || {};
      if ((p.GEOID || '').slice(0, 5) === countyTarget) qctCount++;
    });
    $('icQct').textContent = fmtN(qctCount) + ' tract' + (qctCount === 1 ? '' : 's');

    var ddaRec = ddaFeats.find(function (f) {
      var p = f.properties || {};
      return (p.GEOID || p.STATEFP + p.COUNTYFP || '') === countyTarget;
    });
    if (ddaRec) {
      var props = ddaRec.properties || {};
      var t = (props.DDA_TYPE || props.DDATYPE || props.DDA_CODE || '').toUpperCase();
      var nm = props.NAME || props.DDA_NAME || '';
      var isNm = /\bNM\b|NON.?METRO|NCNTY/.test(t);
      $('icDda').textContent = 'DDA ✓';
      $('icDdaNote').textContent = isNm
        ? nm + ' is a HUD Non-Metropolitan DDA — designated county-wide, so ' + jurisdictionName + ' qualifies for the 30% basis boost.'
        : nm + ' contains a HUD Small Area DDA (designated by ZIP code) — confirm the project ZIP on HUD’s DDA map.';
    } else {
      $('icDda').textContent = 'Non-DDA';
      $('icDdaNote').textContent = (jurisdictionName || 'this geography') + ' is not in a HUD Difficult Development Area.';
    }
  }

  /* ── Civic / local resources ── */
  function renderCivic(lrAll, placeGeoid, countyFips, isPlace) {
    // Look up place first; fall back to county only when there's no place
    // entry. Mirror the place-vs-county labelling we apply on other panels
    // so the user knows whether they're reading place-specific civic data
    // or the containing-county fallback (otherwise the IC packet quietly
    // attributes county-level Prop 123 / housing lead values to the place).
    var placeRec = isPlace ? (lrAll['place:' + placeGeoid] || null) : null;
    var rec = placeRec || lrAll['county:' + countyFips] || null;
    var fromCounty = !placeRec && rec && isPlace;
    if (!rec) {
      $('icProp123').textContent = 'No local-resources data on file.';
      $('icHousingLead').textContent = '—';
      $('icHousingAuth').textContent = '—';
      $('icPlans').innerHTML = '<li class="ic-muted">—</li>';
      return;
    }
    var fallbackNote = fromCounty ? ' (county-level)' : '';
    $('icProp123').textContent = (rec.prop123 ? (rec.prop123.status || 'See DOLA') : 'Not on file') + fallbackNote;
    $('icHousingLead').textContent = ((rec.housingLead && rec.housingLead.name) || '—') + fallbackNote;
    var ha = (rec.housingAuthority && rec.housingAuthority.length) ? rec.housingAuthority[0].name : '—';
    $('icHousingAuth').textContent = ha + fallbackNote;
    var plans = rec.housingPlans || [];
    if (plans.length) {
      $('icPlans').innerHTML = plans.slice(0, 4).map(function (p) {
        return '<li>' + escHtml(p.type || 'Plan') + (p.year ? ' (' + p.year + ')' : '') + ' — ' + escHtml(p.name || '') + '</li>';
      }).join('') + (fromCounty ? '<li class="ic-muted" style="margin-top:4px"><em>County-level fallback — no place-specific plans on file.</em></li>' : '');
    } else {
      $('icPlans').innerHTML = '<li class="ic-muted">None on file' + (fromCounty ? ' at county level' : '') + '.</li>';
    }
  }

  /* ── F139: Anchor institutions ─────────────────────────────────── */
  // School district + hospital set the AMI mix; named employers
  // identify workforce-housing partnerships the developer can plug
  // into. Surfaces the F131/F132/F133 curated fields from local-
  // resources.json.
  function renderAnchorInstitutions(lrAll, placeGeoid, countyFips, isPlace) {
    var placeRec = isPlace ? (lrAll['place:' + placeGeoid] || null) : null;
    var rec = placeRec || lrAll['county:' + countyFips] || null;
    if (!rec) {
      $('icSchoolDist').textContent = '—';
      $('icHospital').textContent = '—';
      $('icEmployers').innerHTML = '<li class="ic-muted">No curated entry on file.</li>';
      return;
    }
    var fromCounty = !placeRec && isPlace ? ' (county-level)' : '';

    // School district
    var sdHtml = '—';
    if (rec.schoolDistrict && rec.schoolDistrict.name) {
      sdHtml = rec.schoolDistrict.url
        ? '<a href="' + escHtml(rec.schoolDistrict.url) + '" target="_blank" rel="noopener">' + escHtml(rec.schoolDistrict.name) + '</a>'
        : escHtml(rec.schoolDistrict.name);
      sdHtml += fromCounty;
    }
    $('icSchoolDist').innerHTML = sdHtml;

    // Hospital
    var hHtml = '—';
    if (rec.hospital && rec.hospital.name) {
      hHtml = rec.hospital.url
        ? '<a href="' + escHtml(rec.hospital.url) + '" target="_blank" rel="noopener">' + escHtml(rec.hospital.name) + '</a>'
        : escHtml(rec.hospital.name);
      hHtml += fromCounty;
    }
    $('icHospital').innerHTML = hHtml;

    // Major employers (top 5)
    var emp = (rec.majorEmployers || []).slice(0, 5);
    if (emp.length) {
      $('icEmployers').innerHTML = emp.map(function (e) {
        var name = e.url
          ? '<a href="' + escHtml(e.url) + '" target="_blank" rel="noopener">' + escHtml(e.name) + '</a>'
          : escHtml(e.name);
        var note = e.note ? ' <span class="ic-muted">— ' + escHtml(e.note) + '</span>' : '';
        var wh = e.workforce_housing_url
          ? ' <a href="' + escHtml(e.workforce_housing_url) + '" target="_blank" rel="noopener" style="font-size:.78rem;font-weight:700">[↳ WFH]</a>'
          : '';
        return '<li>' + name + wh + note + '</li>';
      }).join('') + (fromCounty ? '<li class="ic-muted" style="margin-top:4px"><em>County-level fallback.</em></li>' : '');
    } else {
      $('icEmployers').innerHTML = '<li class="ic-muted">No curated employer roster on file' + (fromCounty ? ' at county level' : '') + '.</li>';
    }
  }

  /* ── F139: Capital partners (scoped to typical LIHTC stack) ─── */
  // Show partners aligned to 4% LIHTC + preservation — the workhorse
  // stack in 2026. The full directory is reachable via HNA.
  function renderCapitalPartners() {
    var mount = $('icCapitalPartners');
    if (!mount || !window.CapitalPartners) return;
    window.CapitalPartners.attach(mount, {
      dealTypes: ['lihtc-4pct','lihtc-state','preservation','prop123','soft-debt','equity-syndication'],
      jurisName: $('icTitle').textContent || undefined
    });
  }

  /* ── F139: Multi-source comparable affordable properties ─────── */
  // 5 nearest deduped affordable-housing records from properties.json.
  // Augments the existing CHFA-LIHTC-only "Comparable LIHTC deals"
  // section with the broader 5-source unified set.
  function renderMultiSourceComp(centroids, countyFips) {
    var mount = $('icMultiSourceComp');
    if (!mount) return;
    if (!window.AffordableHousingLayer || !window.AffordableHousingLayer.loadProperties) {
      mount.innerHTML = '<p class="ic-muted">AffordableHousingLayer not available.</p>';
      return;
    }
    var c = centroids[geoid];
    if (!c) {
      mount.innerHTML = '<p class="ic-muted">No centroid available — cannot compute nearest comps.</p>';
      return;
    }
    mount.innerHTML = '<p class="ic-muted">Loading multi-source comp set…</p>';
    window.AffordableHousingLayer.loadProperties().then(function (props) {
      if (!Array.isArray(props) || !props.length) {
        mount.innerHTML = '<p class="ic-muted">properties.json returned no records.</p>';
        return;
      }
      var R = 3958.7613;  // earth radius in miles
      function dist(lat1, lng1, lat2, lng2) {
        var rl1 = lat1 * Math.PI / 180, rl2 = lat2 * Math.PI / 180;
        var dl = (lat2 - lat1) * Math.PI / 180;
        var dn = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dl/2)**2 + Math.cos(rl1)*Math.cos(rl2)*Math.sin(dn/2)**2;
        return 2 * R * Math.asin(Math.sqrt(a));
      }
      var scored = [];
      for (var i = 0; i < props.length; i++) {
        var p = props[i];
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        scored.push({ p: p, miles: dist(c.lat, c.lng, p.lat, p.lng) });
      }
      scored.sort(function (a, b) { return a.miles - b.miles; });
      var top = scored.slice(0, 5);
      if (!top.length) {
        mount.innerHTML = '<p class="ic-muted">No properties with valid coords found in properties.json.</p>';
        return;
      }
      var AHL = window.AffordableHousingLayer;
      function badge(p) {
        var cat = AHL.categorize ? AHL.categorize(p) : null;
        if (!cat) return '';
        return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:1px 6px;' +
               'border-radius:9px;background:' + cat.color + '20;color:' + cat.color + ';' +
               'border:1px solid ' + cat.color + '60;font-weight:700;white-space:nowrap" title="' + escHtml(cat.desc || '') + '">' +
                 '<span style="width:5px;height:5px;border-radius:50%;background:' + cat.color + '"></span>' +
                 escHtml(cat.label) +
               '</span>';
      }
      var rows = top.map(function (s) {
        var p = s.p;
        var name = escHtml(p.property_name || 'Unnamed');
        var city = escHtml(p.city || '—');
        var units = p.total_units || p.assisted_units || 0;
        var year = p.year_placed_in_service || p.award_year || p.latest_year || '—';
        var credit = escHtml(p.type_of_credits || '—');
        var fact = p.pbv_contract_sunset
          ? 'PBV sunsets ' + escHtml(p.pbv_contract_sunset)
          : (Number.isFinite(p.years_to_expiration)
              ? (p.years_to_expiration <= 5
                  ? '⚠ expires in ' + p.years_to_expiration + 'y'
                  : p.years_to_expiration + 'y to expiration')
              : (p.subsidy_type && p.subsidy_type !== 'unknown' ? escHtml(p.subsidy_type) : ''));
        return '<tr>' +
                 '<td><strong>' + s.miles.toFixed(1) + ' mi</strong></td>' +
                 '<td>' + badge(p) + '</td>' +
                 '<td><strong>' + name + '</strong><br><span class="ic-muted">' + city + '</span></td>' +
                 '<td class="num">' + units + '</td>' +
                 '<td class="num">' + year + '</td>' +
                 '<td>' + credit + (fact ? '<br><span class="ic-muted" style="font-size:.78rem">' + fact + '</span>' : '') + '</td>' +
               '</tr>';
      }).join('');
      mount.innerHTML =
        '<table class="ic-peers" style="width:100%">' +
          '<thead><tr><th>Dist</th><th>Program</th><th>Property</th><th class="num">Units</th><th class="num">Year</th><th>Credit / Detail</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        (window.MethodFooter ? window.MethodFooter.html({
          sources: [
            { label: 'CHFA LIHTC + Preservation', url: 'https://co.chfainfo.com/' },
            { label: 'HUD MULTIFAMILY_PROPERTIES_ASSISTED', url: 'https://hudgis-hud.opendata.arcgis.com/' },
            { label: 'USDA Rural Housing', url: 'https://www.rd.usda.gov/' },
            { label: 'Local PHA roster (curated)', url: 'https://github.com/pggLLC/Housing-Analytics/tree/main/data/affordable-housing/local-pha-roster' }
          ],
          vintage:    'live CHFA + HUD ArcGIS; PHA roster vintage 2026-06',
          method:     '5 nearest deduped affordable-housing records to jurisdiction centroid by great-circle distance. Categorized + color-coded by program. CHFA standard PMA is 5 mi urban / up to 30 mi rural.',
          confidence: 'high'
        }) : '');
    }).catch(function (e) {
      mount.innerHTML = '<p class="ic-muted">Comp set failed: ' + escHtml(e && e.message || 'fetch error') + '</p>';
    });
  }

  /* ── Peers ── */
  function renderPeers(geoConfig, placeLehd, amiByPlace, lihtcFeats, ownGeoid, countyFips, isPlace) {
    var tbody = $('icPeers').querySelector('tbody');
    if (!isPlace) { tbody.innerHTML = '<tr><td colspan="4" class="ic-muted">Peers shown only for place selections.</td></tr>'; return; }
    var allPlaces = (geoConfig.places || []).concat(geoConfig.cdps || []);
    var peers = allPlaces.filter(function (p) {
      return p.containingCounty === countyFips && p.geoid !== ownGeoid;
    });
    peers = peers.map(function (p) {
      var lehd = placeLehd[p.geoid];
      var pop = lehd && lehd.place_pop;
      var ami = amiByPlace[p.geoid];
      var demand100 = ami && ami.households_le_ami_pct && +ami.households_le_ami_pct['100'];
      var city = (p.label || '').replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').toUpperCase();
      var lihtcN = 0;
      lihtcFeats.forEach(function (f) {
        var pc = (f.properties && (f.properties.PROJ_CTY || f.properties.proj_cty) || '').trim().toUpperCase();
        if (pc === city) lihtcN++;
      });
      // F72: classify peer's labor-market character (same logic as Compare F69).
      // The IC packet readers — IC committees, internal underwriting — find
      // this single signal more actionable than raw inflow/outflow numbers.
      var character = null;
      if (lehd) {
        var w = +lehd.lehd?.within || +lehd.within || 0;
        var out = +lehd.lehd?.outflow || +lehd.outflow || 0;
        var residents = w + out;
        if (residents > 0) {
          var pct = 100 * out / residents;
          character = pct >= 70 ? '🛏️ Bedroom'
                    : pct >= 40 ? '🔀 Mixed'
                                 : '🏢 Self-contained';
        }
      }
      return { label: p.label, pop: pop, demand: demand100, lihtc: lihtcN, character: character };
    }).filter(function (p) { return p.pop != null; });
    peers.sort(function (a, b) { return (b.pop || 0) - (a.pop || 0); });
    var top = peers.slice(0, 6);
    if (!top.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="ic-muted">No peer jurisdictions in this county with data.</td></tr>';
      return;
    }
    tbody.innerHTML = top.map(function (p) {
      return '<tr><td>' + escHtml(p.label) + '</td>' +
        '<td class="num">' + fmtN(p.pop) + '</td>' +
        '<td class="num">' + fmtN(p.demand) + '</td>' +
        '<td class="num">' + fmtN(p.lihtc) + '</td>' +
        '<td>' + (p.character || '—') + '</td></tr>';
    }).join('');
  }

  /* ── Comparable LIHTC deals (packet page 2) ── */
  function renderComparableDeals(lihtcFeats, centroids, countyFips) {
    var sub = $('icCompSub');
    var tbody = $('icDeals').querySelector('tbody');
    var c = centroids[geoid];
    // Anchor distances from a known centroid; if missing for a county selection,
    // fall back to averaging the county's own LIHTC project coordinates so the
    // table still ranks by distance from the geographic mass of the county.
    var anchor = c && c.lat && c.lng ? { lat: c.lat, lng: c.lng } : null;
    if (!anchor && countyFips) {
      var clats = [], clngs = [];
      lihtcFeats.forEach(function (f) {
        var p = f.properties || {};
        if (String(p.CNTY_FIPS || p.cnty_fips || '').padStart(5, '0') !== String(countyFips).padStart(5, '0')) return;
        var co = f.geometry && f.geometry.coordinates;
        if (!co) return;
        clats.push(co[1]); clngs.push(co[0]);
      });
      if (clats.length) {
        anchor = {
          lat: clats.reduce(function (s, v) { return s + v; }, 0) / clats.length,
          lng: clngs.reduce(function (s, v) { return s + v; }, 0) / clngs.length
        };
        if (sub) sub.textContent = '≤25 mi · placed in service ≥ 2015 · anchor = county centroid';
      }
    }
    if (!anchor) {
      tbody.innerHTML = '<tr><td colspan="6" class="ic-muted">Centroid unavailable for this geography — cannot rank by distance.</td></tr>';
      return;
    }
    var nowYear = new Date().getFullYear();
    var minYear = 2015;
    var radiusMi = 25;
    var rows = [];
    lihtcFeats.forEach(function (f) {
      var coords = f.geometry && f.geometry.coordinates;
      if (!coords) return;
      var p = f.properties || {};
      var year = parseInt(p.YR_PIS || p.yr_pis, 10);
      // Skip rows with bad / placeholder years (8888 / 9999 are HUD sentinels for unknown).
      if (!Number.isFinite(year) || year < minYear || year > nowYear + 1 || year === 8888 || year === 9999) return;
      var dist = haversineMi(anchor.lat, anchor.lng, coords[1], coords[0]);
      if (dist > radiusMi) return;
      rows.push({
        project: p.PROJECT || p.project || '—',
        city:    p.PROJ_CTY || p.proj_cty || '—',
        year:    year,
        units:   parseInt(p.LI_UNITS || p.li_units || 0, 10) || 0,
        credit:  (p.CREDIT || p.credit || '').toString(),
        dist:    dist
      });
    });
    rows.sort(function (a, b) {
      if (b.year !== a.year) return b.year - a.year;
      return b.units - a.units;
    });
    var top = rows.slice(0, 12);
    if (!top.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="ic-muted">No LIHTC deals within ' + radiusMi + ' mi placed in service since ' + minYear + '.</td></tr>';
      return;
    }
    tbody.innerHTML = top.map(function (r) {
      var cred = r.credit ? escHtml(r.credit) : '—';
      return '<tr>' +
        '<td>' + escHtml(r.project) + '</td>' +
        '<td>' + escHtml(toTitleCase(r.city)) + '</td>' +
        '<td class="num">' + r.year + '</td>' +
        '<td class="num">' + fmtN(r.units) + '</td>' +
        '<td>' + cred + '</td>' +
        '<td class="num">' + r.dist.toFixed(1) + ' mi</td>' +
      '</tr>';
    }).join('');
  }

  function toTitleCase(s) {
    return String(s || '').toLowerCase().replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' :
             c === '"' ? '&quot;' : '&#39;';
    });
  }

  /* ── Print button ── */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'icPrintBtn') { window.print(); }
  });
})();
