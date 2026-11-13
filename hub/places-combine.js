// "Blended total" on Compare places: the picked places added up as one screening area.
// It is the live needs assessment's "Combine jurisdictions" in its Blended total mode. The sums and every rule
// (two to six members, no place inside a picked county, a missing count never read as zero, no blended medians)
// are the live page's own module, js/hna/combined-geo.js (window.HNACombinedGeo), run on the same eight files the
// live page gives it (js/hna/hna-controller.js _loadCombinedDatasets). The live page's other mode, Side-by-side
// comparison, is the table Compare places already draws.
(function (global) {
  'use strict';
  var Shell = global.LabShell, UI = global.LabUI, esc = Shell.esc;
  var FILES = { placeChas: 'data/hna/place-chas.json', countyChas: 'data/hna/chas_affordability_gap.json', amiGapPlace: 'data/co_ami_gap_by_place.json',
    amiGapCounty: 'data/co_ami_gap_by_county.json', placeCountyLookup: 'data/hna/derived/place_county_lookup.json', crossCountyPlaces: 'data/hna/cross-county-places.json',
    aliases: 'data/hna/place-phantom-aliases.json', homeValueCascade: 'data/hna/home-value-cascade.json' };
  var BANDS = [['lte30', 'At or below 30% AMI'], ['31to50', '31% to 50% AMI'], ['51to80', '51% to 80% AMI'], ['81to100', '81% to 100% AMI'], ['100plus', 'Above 100% AMI']];
  var CHAS_URL = 'https://www.huduser.gov/portal/datasets/cp.html', ACS_URL = 'https://www.census.gov/programs-surveys/acs';
  function num(v) { return v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'); }
  function pct(v) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
  function money(v) { return v == null || !isFinite(v) ? '—' : '$' + Math.round(v).toLocaleString('en-US'); }
  function card(label, value, detail) {
    return '<div class="metric"><p class="metric-label">' + esc(label) + '</p><p class="metric-value">' + esc(value) + '</p>' + (detail ? '<p class="metric-detail">' + esc(detail) + '</p>' : '') + '</div>';
  }

  // picked: geoids as Compare places holds them; nameOf(geoid) -> label; typeOf(geoid) -> 'county' | 'place' | 'cdp'.
  function section(picked, nameOf, typeOf) {
    var head = '<section class="blend" id="blend" aria-labelledby="blend-h"><h2 id="blend-h">Blended total: these places as one area</h2>';
    if (picked.length < 2) return head + '<p class="note">Pick two to six places to add them up.</p></section>';
    var s = UI.load(FILES), G = global.HNACombinedGeo;
    if (s.error) return head + '<p class="callout">' + esc(s.error) + '</p></section>';
    if (!s.data || !G) return head + '<p role="status" class="note">Loading the household files…</p></section>';
    var d = s.data, datasets = { placeChas: d.placeChas, countyChas: d.countyChas, amiGapPlace: d.amiGapPlace, amiGapCounty: d.amiGapCounty, placeCountyLookup: d.placeCountyLookup,
      crossCountyPlaces: d.crossCountyPlaces, aliases: d.aliases, homeValues: d.homeValueCascade && d.homeValueCascade.places };
    var members = picked.map(function (g) { return { geoType: String(g).length === 5 ? 'county' : (typeOf(g) === 'cdp' ? 'cdp' : 'place'), geoid: g, label: nameOf(g) }; });
    var r = G.aggregate(members, datasets), names = picked.map(nameOf);
    if (!r.valid) {
      // The live module's wording points at a paired view the lab does not have; say the same thing plainly.
      var why = (r.errors || []).map(function (e) { return /overlaps a selected county/.test(e) ? 'A town or CDP you picked is inside a county you also picked, so adding them would count its households twice. Remove one of the two.' : e; })
        .filter(function (e, i, a) { return a.indexOf(e) === i; });
      return head + '<div class="callout" role="alert"><p>These places can’t be added up. ' + esc(why.join(' ')) + '</p>' +
        '<p>The table below still shows them side by side.</p></div></section>';
    }
    var rec = r.pseudoChasRecord, sm = rec.summary, total = sm.total_renter_hh + sm.total_owner_hh, share = total ? sm.total_renter_hh / total : null;
    var hv = r.medianMetrics && r.medianMetrics.homeValue;
    var cards = '<div class="metrics">' +
      card('Households', num(total), num(sm.total_renter_hh) + ' rent, ' + num(sm.total_owner_hh) + ' own') +
      card('Renters and owners', share == null ? '—' : pct(share) + ' renters / ' + pct(1 - share) + ' owners', 'Combined CHAS households') +
      card('Renters paying over 30% of income', pct(sm.renter_cb30_share), num(sm.renter_cb30_count) + ' renter households; ' + num(sm.renter_cb50_count) + ' pay over half') +
      card('Owners paying over 30% of income', pct(sm.owner_cb30_share), num(sm.owner_cb30_count) + ' owner households; ' + num(sm.owner_cb50_count) + ' pay over half') +
      (hv && hv.available && hv.min && hv.max
        ? card('Home value', money(hv.min.value) + ' to ' + money(hv.max.value), 'Lowest (' + hv.min.name + ') to highest (' + hv.max.name + ') member; household-weighted average ' + money(hv.weightedAverage) + '. A combined area has no true median.')
        : card('Home value', 'Not available', 'No member has a home value on file.')) + '</div>';
    var quality = '<p class="note"><strong>Data quality: ' + esc(r.dataQuality) + '.</strong> ' + (r.caveats && r.caveats.length ? esc('The weakest member sets it: ' + r.caveats.join('; ') + '.') : 'Every member has a full CHAS record.') + '</p>';
    var bandRows = BANDS.map(function (b) {
      var rr = rec.renter_hh_by_ami[b[0]], oo = rec.owner_hh_by_ami[b[0]];
      return '<tr><th scope="row">' + esc(b[1]) + '</th><td>' + num(rr.total) + '</td><td>' + num(rr.cost_burdened_30pct) + ' (' + pct(rr.pct_cost_burdened_30) + ')</td><td>' + num(oo.total) + '</td><td>' + num(oo.cost_burdened_30pct) + ' (' + pct(oo.pct_cost_burdened_30) + ')</td></tr>';
    }).join('');
    var bands = '<h3>Households by income, added up</h3><div class="table-scroll" role="region" aria-label="Combined households by income band" tabindex="0"><table><caption>' + esc(names.join(' + ')) + ': households by income band</caption>' +
      '<thead><tr><th scope="col">Income band</th><th scope="col">Renter households</th><th scope="col">Renters paying over 30%</th><th scope="col">Owner households</th><th scope="col">Owners paying over 30%</th></tr></thead><tbody>' + bandRows + '</tbody></table></div>';
    var gap = r.amiGapEntry, gapOk = r.availability.amiGap.available, gapHtml = '<h3>Renters and the rentals they can afford, added up</h3>';
    if (gapOk) {
      gapHtml += '<div class="table-scroll" role="region" aria-label="Combined renter shortfall by income" tabindex="0"><table><caption>Renter households, rentals priced within reach, and the shortfall</caption>' +
        '<thead><tr><th scope="col">Income</th><th scope="col">Renter households at or below</th><th scope="col">Rentals priced within reach</th><th scope="col">Shortfall, running total</th></tr></thead><tbody>' +
        G.GAP_BANDS.map(function (b) {
          return '<tr><th scope="row">' + esc(b) + '% AMI</th><td>' + num(gap.households_le_ami_pct[b]) + '</td><td>' + num(gap.units_priced_affordable_le_ami_pct[b]) + '</td><td>' + num(gap.shortfall_households_minus_units_le_ami_pct[b]) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="note">The shortfall adds each band’s own gap (households in the band less rentals priced for it, never below zero), so a surplus in one band does not hide a shortage in another.</p>';
    } else {
      gapHtml += '<p class="callout">Not available. ' + esc(String(r.availability.amiGap.reason || 'One or more members has no AMI-gap record.').replace(/^AMI gap unavailable:\s*/, '')) + ' A missing count is never read as zero.</p>';
    }
    var av = r.availability, counties = av.amiLimits.counties || [];
    var countyName = function (f) { var nm = ((d.countyChas.counties || {})[f] || {}).name; return nm ? (/County$/.test(nm) ? nm : nm + ' County') : f; };
    var notAdded = '<h3>What is not added up</h3><ul class="plain-list">' +
      '<li><strong>Population, income and rent:</strong> a combined area has no Census profile of its own, and medians cannot be added.</li>' +
      '<li><strong>Housing need projection:</strong> ' + esc(av.projections.reason) + '</li>' +
      '<li><strong>Commuting and jobs:</strong> ' + esc(av.commuting.reason.replace(' — ', '; ')) + '</li>' +
      '<li><strong>Tax credit property map:</strong> drawn for one county or the state, not for a combined area.</li>' +
      '<li><strong>Income limits:</strong> ' + (av.amiLimits.available ? 'every member is in one county (' + esc(countyName(counties[0])) + '), so one set of limits applies.' : esc(av.amiLimits.reason)) + '</li></ul>' +
      '<p>Open each member for these: ' + picked.map(function (g) { return '<a href="#/place/' + esc(g) + '">' + esc(nameOf(g)) + '</a>'; }).join(', ') + '.</p>';
    var cm = d.countyChas.meta || {}, gm = d.amiGapPlace.meta || {}, pm = d.placeChas.meta || {};
    return head + '<p>' + esc(names.join(' + ') + ' combines ' + picked.length + ' jurisdictions. Aggregated values are screening estimates from summed CHAS and AMI-gap inputs; panels that cannot be safely aggregated are marked unavailable.') + '</p>' +
      cards + quality + bands + gapHtml + notAdded +
      '<p class="source-line"><span>Source</span> <a href="' + CHAS_URL + '">HUD CHAS ' + esc(cm.vintage || '') + '</a>' + (pm.generated_at ? ', towns apportioned from tracts ' + esc(String(pm.generated_at).slice(0, 10)) : '') +
      '; <a href="' + ACS_URL + '">Census ACS 5-year ' + esc(gm.acs_year || '') + '</a> against HUD ' + esc(gm.hud_income_limits_year || '') + ' income limits, built ' + esc(String(gm.generated_at || '').slice(0, 10)) + '</p></section>';
  }

  global.LabCombine = { section: section, FILES: FILES };
})(window);
