// Starting numbers for a new project (paul, 14 Nov 2026: option A, "renter-pool mix, cost on request", with his
// changes). Once a project has a place, each scenario that has no homes saved yet shows a probable first project
// there: how many homes, who they are for, their rents, the residents' utility allowance, vacancy and, in Mesa
// County, a local cost. Each number names its rule and its dated source, and one button puts them on the Homes
// form (and the cost on Financials). Nothing is saved to the project until the user saves the Homes form.
//
// Every figure is read from the public site's own files and engines:
//   renters who qualify, by band  PMAMarketScoring.chfaQualifiedRenters, called the way Market check calls it
//   market area                   the scenario's saved market area (a market-snapshot's tracts), else the census
//                                 tracts mostly inside the place (data/hna/place-tract-membership.json, by area),
//                                 else the whole county
//   size                          CHFA's tax credit property list (data/chfa-lihtc.json)
//   bedrooms                      Census ACS B25042, renter homes by bedrooms (data/market/acs_renter_bedrooms_co.json)
//   rent ceilings                 ChfaRentLimits.maxGrossRent on CHFA's 2026 table; HUD FY2027 Fair Market Rents
//   vacancy                       CHFA's minimum (data/policy/lihtc-underwriting-rules.json, pro_forma_vacancy)
//   cost lines                    the Deal Calculator's example budget scaled to the total (LabDealQuick.scaledLines),
//                                 as the live quick estimate scales it
// Two published figures that are not in the site's data yet are written below with their sources: the Division
// of Housing's 2026 apartment utility allowance for its Area 1, and the project costs in Grand Junction's
// December 2024 linkage fee study. The capture lines (10% and 20%) are COHO starting rules, and the page says so.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var P = global.LabProjects;
  var esc = Shell.esc;
  var BANDS = [30, 40, 50, 60];
  var SIZES = ['efficiency', '1BR', '2BR', '3BR'];
  var SIZE_LABEL = { efficiency: 'Studio', '1BR': '1 bedroom', '2BR': '2 bedrooms', '3BR': '3 bedrooms' };
  var SIZE_PLURAL = { efficiency: ['studio', 'studios'], '1BR': ['one-bedroom', 'one-bedrooms'], '2BR': ['two-bedroom', 'two-bedrooms'], '3BR': ['three-bedroom', 'three-bedrooms'] };
  var SHORT = { efficiency: 'Studio', '1BR': '1 BR', '2BR': '2 BR', '3BR': '3 BR' };
  var FMR_KEY = { efficiency: 'efficiency', '1BR': 'one_br', '2BR': 'two_br', '3BR': 'three_br' };
  // COHO starting rules, not published standards. CHFA sets no capture line of its own; its only line is 85%
  // penetration (Market check shows it).
  var GOOD = 0.10, VERY_THIN = 0.20;
  var SINCE = 2015;
  var FILES = {
    placeTracts: 'data/hna/place-tract-membership.json',
    bedrooms: 'data/market/acs_renter_bedrooms_co.json',
    rules: 'data/policy/lihtc-underwriting-rules.json'
  };

  // Colorado Division of Housing, Utility Allowance Schedule, Area 1, Multi-Family (Apartment), effective
  // 1 January 2026 (form HUD-52667). Residents pay electricity only; the owner pays water, sewer and trash.
  // Garfield County is left out because the schedule covers only "Garfield West".
  var DOH_UA = {
    url: 'https://doh.colorado.gov/schedules', effective: '2026-01-01',
    reference: 'Colorado Division of Housing 2026 utility allowance schedule, Area 1, apartments; residents pay electricity (heat, cooking, water heating, other electric, service fee)',
    counties: ['08009', '08011', '08017', '08025', '08027', '08029', '08055', '08061', '08063', '08071', '08073', '08075', '08077',
      '08085', '08089', '08091', '08093', '08095', '08099', '08101', '08103', '08115', '08119', '08121', '08125'],
    // Studio, 1, 2 and 3 bedrooms: electric heating, electric cooking, other electric, electric water heating, and
    // the electricity service fee.
    items: [['Heating', [25, 29, 39, 49]], ['Cooking', [6, 7, 10, 14]], ['Lights and appliances', [23, 27, 38, 48]],
      ['Water heating', [16, 19, 24, 29]], ['Electricity service fee', [8, 8, 8, 8]]],
    paid: ['heat', 'cooking', 'water_heating', 'other_electric']
  };
  function uaFor(fips) {
    if (DOH_UA.counties.indexOf(fips) < 0) return null;
    var out = {};
    SIZES.forEach(function (k, i) { out[k] = DOH_UA.items.reduce(function (t, it) { return t + it[1][i]; }, 0); });
    return out;
  }

  // TischlerBise for the City of Grand Junction, Draft Affordable Housing Linkage Fee Support Study, 13 December
  // 2024, Figure 23, "Multifamily Rental Unit Development Cost" (p. 21; the study's own source: City of Grand
  // Junction and Grand Junction Housing Authority). The starting cost is the average of the two projects the study
  // calls all affordable; the study's own figure, $342,000, also counts market-rate and partly affordable projects.
  var GJ_COST = {
    counties: ['08077'],
    url: 'https://engagegj.org/impact-fees-study', date: '2024-12-13',
    source: 'City of Grand Junction, Draft Affordable Housing Linkage Fee Support Study (TischlerBise), 13 December 2024, Figure 23',
    projects: [['Mother Teresa’s Place', '2023', 14457857, 40, 'all affordable'], ['The Current', '2024', 26393832, 54, 'all affordable'],
      ['The Terminal', '2024 estimate', 35960234, 106, 'partly affordable'], ['Liberty Apartments', '2024 estimate', 20667214, 72, 'partly affordable'],
      ['Market Street', '2022', 23976000, 72, 'market rate'], ['Struthers', '2022', 16992000, 48, 'market rate'], ['The Junction', '2022', 82898639, 256, 'market rate']],
    studyFigure: 342000
  };
  function localCost(fips) {
    if (GJ_COST.counties.indexOf(fips) < 0) return null;
    var aff = GJ_COST.projects.filter(function (r) { return r[4] === 'all affordable'; });
    var cost = aff.reduce(function (t, r) { return t + r[2]; }, 0), homes = aff.reduce(function (t, r) { return t + r[3]; }, 0);
    return { perHome: Math.round(cost / homes), projects: aff };
  }

  function money(n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function num(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function pct(x) { return x == null || !isFinite(x) ? '—' : (Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%'; }
  function sum(o) { return Object.keys(o).reduce(function (t, k) { return t + (Number(o[k]) || 0); }, 0); }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+(town|city|cdp)$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function plural(n, k) { return n + ' ' + SIZE_PLURAL[k][n === 1 ? 0 : 1]; }

  // Whole numbers that add up to `total`, shared by weight; the largest remainders get the leftover.
  function spread(total, weights, keys) {
    var w = keys.map(function (k) { return Math.max(0, Number(weights[k]) || 0); }), all = w.reduce(function (a, b) { return a + b; }, 0), out = {};
    keys.forEach(function (k) { out[k] = 0; });
    if (!(all > 0) || !(total > 0)) return out;
    var exact = w.map(function (x) { return total * x / all; });
    keys.forEach(function (k, i) { out[k] = Math.floor(exact[i]); });
    var left = total - sum(out);
    keys.map(function (k, i) { return [exact[i] - Math.floor(exact[i]), k]; }).sort(function (a, b) { return b[0] - a[0]; })
      .slice(0, left).forEach(function (r) { out[r[1]] += 1; });
    return out;
  }

  // Homes by band and size that keep both totals: each cell starts at its share, then the largest remainders fill in.
  function grid(byBand, bySize) {
    var n = sum(byBand), cell = {}, rowLeft = {}, colLeft = {}, order = [];
    BANDS.forEach(function (b) { cell[b] = {}; SIZES.forEach(function (k) {
      var x = n ? byBand[b] * bySize[k] / n : 0; cell[b][k] = Math.floor(x); order.push([x - Math.floor(x), b, k]);
    }); });
    BANDS.forEach(function (b) { rowLeft[b] = byBand[b] - sum(cell[b]); });
    SIZES.forEach(function (k) { colLeft[k] = bySize[k] - BANDS.reduce(function (t, b) { return t + cell[b][k]; }, 0); });
    order.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (o) {
      if (rowLeft[o[1]] > 0 && colLeft[o[2]] > 0) { cell[o[1]][o[2]] += 1; rowLeft[o[1]] -= 1; colLeft[o[2]] -= 1; }
    });
    BANDS.forEach(function (b) {
      while (rowLeft[b] > 0) {
        var k = SIZES.filter(function (s) { return colLeft[s] > 0; })[0] || '2BR';
        cell[b][k] += 1; rowLeft[b] -= 1; if (colLeft[k] > 0) colLeft[k] -= 1;
      }
    });
    return cell;
  }

  // The engine options the live Market Analysis passes (js/market-analysis.js _chfaQualifiedRenters), as Market check builds them.
  var opts = null;
  function engineOpts(x) {
    if (opts && opts.from === x) return opts.o;
    var idx = {}; ((x.acs && x.acs.tracts) || []).forEach(function (m) { idx[m.geoid] = m; });
    opts = { from: x, o: { acsIdx: Object.keys(idx).length ? idx : null, sizeIdx: x.sizes && x.sizes.tracts ? x.sizes.tracts : null } };
    return opts.o;
  }

  function savedArea(p, s) {
    var a = p.attachments.filter(function (x) { return x.scenarioId === s.scenarioId && x.kind === 'market-snapshot' && x.state !== 'replaced'; })[0];
    if (!a) return null;
    var snap = a.snapshot || {};
    if (!Array.isArray(snap.tracts) || !snap.tracts.length) return null;
    return { att: a, stale: a.state === 'stale', tracts: snap.tracts, label: snap.areaLabel || a.label, site: snap.site || null };
  }

  // The tracts that lie mostly inside the place (over half their area, TIGER 2024, the overlaps the site's own
  // Opportunity Finder reads); a place smaller than every tract gets the one tract that covers most of it.
  function placeArea(pt, geoid) {
    var rec = pt && pt.places && pt.places[geoid];
    if (!rec || !rec.tracts || !rec.tracts.length) return null;
    var most = rec.tracts.filter(function (t) { return t.share_of_tract_area >= 0.5; });
    var rule = 'mostly';
    if (!most.length) { most = [rec.tracts.reduce(function (a, b) { return b.share_of_place_area > a.share_of_place_area ? b : a; })]; rule = 'largest'; }
    return { tracts: most.map(function (t) { return t.tract_geoid; }), rule: rule };
  }

  function typicalSize(lihtc, fips, placeName, countyName) {
    var built = lihtc.features.map(function (f) { return f.properties; }).filter(function (q) {
      return q.ProjectType === 'New Construction' && +q.AwardYear >= SINCE && q.N_UNITS > 0;
    });
    var tiers = [];
    if (placeName) tiers.push([built.filter(function (q) { return q.CNTY_FIPS === fips && norm(q.PROJ_CTY) === norm(placeName); }), placeName]);
    tiers.push([built.filter(function (q) { return q.CNTY_FIPS === fips; }), countyName]);
    tiers.push([built, 'Colorado']);
    for (var i = 0; i < tiers.length; i++) {
      var list = tiers[i][0];
      if (list.length < 3) continue;
      var u = list.map(function (q) { return q.N_UNITS; }).sort(function (a, b) { return a - b; }), m = u.length >> 1;
      return { homes: Math.round(u.length % 2 ? u[m] : (u[m - 1] + u[m]) / 2), count: list.length, where: tiers[i][1] };
    }
    return { homes: 60, count: 0, where: null };
  }

  // Which band's rent each band is underwritten at. A band whose homes would take more than VERY_THIN of the renters
  // who qualify for it uses the rent of the next lower band that, with those homes added, stays at GOOD or less.
  // Bands are taken from the highest down; a band no lower band can take is listed in tooBig and keeps its own rent.
  function moves(byBand, pool) {
    var at = {}, load = {}, tooBig = [];
    BANDS.forEach(function (b) { load[b] = byBand[b] || 0; at[b] = b; });
    BANDS.slice().reverse().forEach(function (b) {
      var n = byBand[b] || 0, c = n > 0 ? (pool[b] > 0 ? n / pool[b] : Infinity) : 0;
      if (!(n > 0) || !(c > VERY_THIN)) return;
      for (var i = BANDS.indexOf(b) - 1; i >= 0; i--) {
        var l = BANDS[i];
        if (pool[l] > 0 && (load[l] + n) / pool[l] <= GOOD) { at[b] = l; load[l] += n; load[b] -= n; return; }
      }
      tooBig.push(b);
    });
    return { at: at, tooBig: tooBig };
  }

  function draftOf(p, s) { var o = p.overrides[s.scenarioId] && p.overrides[s.scenarioId].startDraft; return o ? JSON.parse(JSON.stringify(o)) : { homes: '', bands: null, cost: false }; }

  // Everything the panel shows and the button writes, or { wait } / { error } while the data loads.
  function plan(p, s) {
    var Pl = global.LabPlaces, M = global.LabMarket, UI = global.LabUI, E = global.PMAMarketScoring, C = global.ChfaRentLimits;
    if (!Pl || !M || !UI || !C) return { error: 'The page did not finish loading. Reload to try again.' };
    if (!E || !E.chfaQualifiedRenters) return { error: 'The site’s capture engine did not load.' };
    var geoid = p.jurisdiction.geoid;
    var shared = Pl.data(), extra = UI.load(M.EXTRA), mine = UI.load(FILES);
    var err = shared.error || extra.error || mine.error;
    if (err) return { error: err };
    if (!shared.data || !extra.data || !mine.data) return { wait: true };
    var d = shared.data, x = extra.data, f = mine.data;
    var isCounty = String(geoid).length === 5;
    var facts = Pl.placeFacts(geoid, d);
    var fips = isCounty ? geoid : facts && facts.rec && facts.rec.containing_county_fips;
    if (!fips) return { error: 'No county is on file for ' + p.jurisdiction.name + '.' };
    var county = Pl.countyFacts(fips, d);
    var countyName = county.county ? String(county.county.county_name).replace(/ County$/, '') + ' County' : 'the county';
    var entry = Pl.entryFor(geoid);
    var name = isCounty ? countyName : M.shortName(entry ? entry.label : p.jurisdiction.name);

    // Market area.
    var saved = savedArea(p, s), area;
    var inDemand = function (list) { return list.filter(function (g) { return x.demand.tracts && x.demand.tracts[g]; }); };
    if (saved && !saved.stale) area = { tracts: inDemand(saved.tracts), label: saved.label, saved: saved };
    else {
      var pa = !isCounty ? placeArea(f.placeTracts, geoid) : null;
      if (pa) area = { tracts: inDemand(pa.tracts), label: pa.rule === 'mostly' ? (pa.tracts.length === 1 ? 'the census tract' : 'the ' + pa.tracts.length + ' census tracts') + ' mostly inside ' + name : 'the census tract that covers most of ' + name, placeRule: pa.rule };
      else area = { tracts: Object.keys(x.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === fips; }), label: 'all of ' + countyName };
      if (saved && saved.stale) area.staleSaved = saved;
    }

    // Renters who qualify for each band, counted the CHFA market-study way.
    var limits = {}; (d.chfa.counties || []).forEach(function (c) { limits[c.fips] = c; });
    var list = area.tracts.map(function (g) { return { geoid: g }; }), pool = {};
    BANDS.forEach(function (b) { var q = E.chfaQualifiedRenters(x.demand, limits, list, [b], undefined, engineOpts(x)); pool[b] = q && q.value > 0 ? q.value : 0; });
    var poolAll = sum(pool);

    // Size and incomes.
    var size = typicalSize(d.lihtc, fips, isCounty ? null : name, countyName);
    var dr = draftOf(p, s);
    var custom = dr.bands && BANDS.some(function (b) { return dr.bands[b] !== '' && dr.bands[b] != null; });
    var byBand = {};
    if (custom) BANDS.forEach(function (b) { byBand[b] = Math.max(0, Math.round(Number(dr.bands[b]) || 0)); });
    var homes = custom ? sum(byBand) : Math.max(1, Math.min(1000, Math.round(Number(dr.homes)) || size.homes));
    if (!custom) byBand = spread(homes, pool, BANDS);
    var capture = {}; BANDS.forEach(function (b) { capture[b] = byBand[b] > 0 ? (pool[b] > 0 ? byBand[b] / pool[b] : Infinity) : 0; });

    // Bedrooms from renter homes in the place (or county); 4 bedrooms and up are counted as 3.
    var br = (!isCounty && f.bedrooms.places && f.bedrooms.places[geoid]) || (f.bedrooms.counties && f.bedrooms.counties[fips]) || null;
    var bw = br && br.bedrooms ? { efficiency: br.bedrooms.studio, '1BR': br.bedrooms['1br'], '2BR': br.bedrooms['2br'], '3BR': (br.bedrooms['3br'] || 0) + (br.bedrooms['4br'] || 0) + (br.bedrooms['5plus'] || 0) }
      : { efficiency: 1, '1BR': 1, '2BR': 1, '3BR': 1 };
    var bySize = spread(homes, bw, SIZES);
    var cells = grid(byBand, bySize);

    // Rents: CHFA's ceiling, capped at HUD's Fair Market Rent; a very thin band is underwritten at the rent of the
    // next lower band with good capture, counting the moved homes against that band's renters.
    var step = function (b, k) {
      var c = C.maxGrossRent(d.chfa, fips, b, k, {}), ceiling = c && c.grossRent != null ? c.grossRent : null;
      var fmr = county.hud && county.hud.fmr ? county.hud.fmr[FMR_KEY[k]] : null;
      if (ceiling == null) return { rent: null };
      return fmr != null && fmr < ceiling ? { rent: fmr, ceiling: ceiling, fmr: fmr, capped: true } : { rent: ceiling, ceiling: ceiling, fmr: fmr, capped: false };
    };
    var mv = moves(byBand, pool), at = mv.at, tooBig = mv.tooBig;
    var rent = {};
    BANDS.forEach(function (b) { rent[b] = {}; SIZES.forEach(function (k) { var r = step(at[b], k); r.from = at[b]; rent[b][k] = r; }); });
    var fit = Math.floor(GOOD * poolAll);

    var ua = uaFor(fips), cost = localCost(fips);
    var vacRule = f.rules && f.rules.rules && f.rules.rules.pro_forma_vacancy, vacSrc = vacRule && f.rules.sources && f.rules.sources[vacRule.source];
    return {
      name: name, geoid: geoid, fips: fips, countyName: countyName, isCounty: isCounty, area: area, pool: pool, poolAll: poolAll,
      size: size, homes: homes, custom: custom, byBand: byBand, capture: capture, bySize: bySize, cells: cells, bedroomsFrom: br,
      at: at, rent: rent, tooBig: tooBig, fit: fit, ua: ua, cost: cost, wantCost: !!dr.cost && !!cost,
      vacancy: vacRule && isFinite(vacRule.rate) ? vacRule.rate : 0.07, vacSrc: vacSrc, vacWhere: vacRule && vacRule.location,
      chfa: d.chfa.meta, hud: d.hud.meta, lihtcAt: d.lihtc.fetchedAt, bedroomsMeta: f.bedrooms.meta, ptMeta: f.placeTracts.meta
    };
  }

  function scheduleState(p, s) { return P.stateOf(p.projectId, s.scenarioId, 'rent-schedule'); }

  // ---------------- the panel ----------------
  function siteLink(p, s, words) {
    var M = global.LabMarket, back = '#/project/' + p.projectId;
    var href = M && M.useHref ? M.useHref(null, { g: p.jurisdiction.geoid, project: p.projectId, scenario: s.scenarioId, back: back })
      : '#/market?g=' + encodeURIComponent(p.jurisdiction.geoid);
    return '<a class="button-link secondary" href="' + esc(href) + '">' + esc(words) + '</a>';
  }

  function section(p, s) {
    if (!p.jurisdiction) return '';
    if (p.overrides[s.scenarioId] && p.overrides[s.scenarioId].manualMix) return '';
    if (scheduleState(p, s) !== 'not attached') return '';
    var head = '<details class="start-numbers" open><summary>Starting numbers for ' + esc(p.jurisdiction.name) + '</summary>';
    var r = plan(p, s);
    if (r.wait) return head + '<p role="status" class="note">Loading the public data for ' + esc(p.jurisdiction.name) + '…</p></details>';
    if (r.error) return head + '<p class="callout">' + esc(r.error) + '</p></details>';
    var at = esc(p.projectId) + '/' + esc(s.scenarioId);
    var dr = draftOf(p, s);

    var ideal = 'A ' + r.homes + '-home, 9% tax credit building for renters at 30% to 60% of area median income: ' +
      SIZES.filter(function (k) { return r.bySize[k] > 0; }).map(function (k) { return plural(r.bySize[k], k); }).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';

    var area = r.area.saved
      ? '<div class="callout start-area"><p><strong>Market area: ' + esc(r.area.label) + '.</strong> Saved from Market check ' + esc(Shell.when(r.area.saved.att.attachedAt)) + '. The renters who qualify, the income mix and the rents below are counted in it.</p>' + siteLink(p, s, 'Try another site') + '</div>'
      : '<div class="callout start-area"><p><strong>Biggest assumption: the market area.</strong> No site is picked yet, so these numbers count renters in ' + esc(r.area.label) + (r.area.placeRule ? ' (Census 2024 boundaries)' : '') + '. ' +
        'A real market area is drawn round the site from whole census tracts. It changes how many renters qualify, and so the income mix and the rents.</p>' +
        (r.area.staleSaved ? '<p>The market area saved for the old place is out of date, so it is not used.</p>' : '') + siteLink(p, s, 'Check a site') + '</div>';

    var bandRows = BANDS.map(function (b) {
      var c = r.capture[b], v = r.custom ? r.byBand[b] : (dr.bands && dr.bands[b] != null && dr.bands[b] !== '' ? dr.bands[b] : r.byBand[b]);
      var mark = c === Infinity ? 'No renters qualify' : c > VERY_THIN ? pct(c) + ', very thin' : c > GOOD ? pct(c) + ', thin' : pct(c);
      return '<tr><th scope="row">' + b + '%</th><td class="num">' + num(r.pool[b]) + '</td>' +
        '<td class="num"><input name="b' + b + '" type="number" min="0" max="1000" step="1" inputmode="numeric" value="' + esc(String(v)) + '" aria-label="Homes at ' + b + '% of area median income"></td>' +
        '<td class="num">' + esc(mark) + '</td></tr>';
    }).join('');
    var sizeWhy = r.size.where ? r.size.homes + ' is the middle size of the ' + r.size.count + ' new tax credit buildings awarded in ' + esc(r.size.where) + ' since ' + SINCE + ' (CHFA property list, read ' + esc(String(r.lihtcAt || '').slice(0, 10)) + ').' : '60 is a starting size; no list of local buildings was found.';

    var rentRows = SIZES.filter(function (k) { return r.bySize[k] > 0; }).map(function (k) {
      return '<tr><th scope="row">' + esc(SHORT[k]) + ' (' + r.bySize[k] + ')</th>' + BANDS.map(function (b) {
        var x = r.rent[b][k], tags = (r.at[b] !== b ? ' ↓' : '') + (x.capped ? ' *' : '');
        return '<td class="num">' + (x.rent == null ? '—' : esc(money(x.rent)) + (tags ? '<span class="start-tag">' + esc(tags) + '</span>' : '')) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var moved = BANDS.filter(function (b) { return r.at[b] !== b; });
    var capped = BANDS.some(function (b) { return SIZES.some(function (k) { return r.bySize[k] > 0 && r.rent[b][k].capped; }); });

    var uaText = r.ua
      ? '<p>The owner pays water, sewer and trash. Residents pay electricity, so the allowance is ' + SIZES.map(function (k) { return money(r.ua[k]); }).join(', ') +
        ' a month for a studio to a 3-bedroom: the Colorado Division of Housing’s 2026 apartment schedule for its Area 1, which covers ' + esc(r.countyName) + ', for an all-electric building. ' +
        '<a href="' + DOH_UA.url + '">Source</a>, effective 1 January 2026. If the local housing authority’s own schedule applies, enter it on the Homes form.</p>'
      : '<p>The owner pays water, sewer and trash; residents pay electricity. The allowance schedule this page carries does not cover ' + esc(r.countyName) + ', so the Homes form will ask for the local housing authority’s electric allowance before it prices the homes.</p>';

    var costText;
    if (r.cost) {
      var total = r.cost.perHome * r.homes;
      costText = '<p>Grand Junction’s two all-affordable projects in the city’s December 2024 linkage fee study cost ' + esc(money(r.cost.perHome)) + ' a home on average: ' +
        r.cost.projects.map(function (q) { return esc(q[0]) + ' (' + q[1] + ', ' + q[3] + ' homes, ' + esc(money(q[2] / q[3])) + ' a home)'; }).join(' and ') + '. ' +
        'The study’s own figure, ' + esc(money(GJ_COST.studyFigure)) + ', also counts market-rate and partly affordable projects. These are 2023 and 2024 costs, not brought forward. ' +
        '<a href="' + GJ_COST.url + '">Source</a>.</p>' +
        '<label class="check-line"><input type="checkbox" name="cost"' + (r.wantCost ? ' checked' : '') + '> Also put ' + esc(money(total)) + ' (' + r.homes + ' homes at ' + esc(money(r.cost.perHome)) + ') on Financials</label>' +
        '<p class="note">Financials needs the cost in lines to count tax credits. The total is split the way the Deal Calculator’s example budget splits it, which is a made-up example, not a local project. Replace the lines with your own budget.</p>';
    } else {
      costText = '<p>No public, local cost per home was found for ' + esc(r.countyName) + ', so costs stay blank. Financials then shows the rents, operating income and the loan they carry, but no credits or gap until you enter costs. A statewide average is not used.</p>';
    }

    return head +
      '<p class="lede start-ideal">' + esc(ideal) + '</p>' +
      '<p class="note">Each number below comes from public data with its rule. Change any of them here or on the Homes form, then save there.</p>' +
      area +
      '<form class="start-form" data-start="' + at + '" novalidate>' +
      '<h4>Homes and incomes</h4>' +
      '<label class="field"><span>Homes in the project</span><input name="homes" type="number" min="1" max="1000" step="1" inputmode="numeric" value="' + r.homes + '"></label>' +
      '<p class="note">' + sizeWhy + '</p>' +
      '<div class="table-scroll"><table class="start-table" data-no-sort><caption>Who the homes are for (share = homes \u00f7 renters who qualify)</caption><thead><tr><th scope="col">Band</th><th scope="col" class="num">Renters who qualify</th><th scope="col" class="num">Homes</th><th scope="col" class="num">Share</th></tr></thead><tbody>' + bandRows + '</tbody></table></div>' +
      '<p class="note">' + (r.custom ? 'You set the homes in each band. Change the total to spread them by renters again. ' : 'Homes are spread in proportion to the renters who qualify for each band, so each band takes about the same share of its renters. ') +
      'A household can qualify for more than one band, so the counts overlap. Counted the CHFA market-study way by the site’s own engine (HUD CHAS 2018–2022, Census ACS 2020–2024).</p>' +
      (r.tooBig.length ? '<p class="callout">Too many homes for this market area: no lower band has room for the ' + r.tooBig.map(function (b) { return b + '%'; }).join(' and ') + ' band’s homes. About ' + num(r.fit) + ' homes would keep every band at 10% or less of its renters.</p>' : '') +
      '<h4>Rents</h4>' +
      '<p>Each rent, utilities included, is the lower of CHFA’s 2026 ceiling and HUD’s Fair Market Rent for ' + esc(r.countyName) + '. Where a band would take more than ' + pct(VERY_THIN) + ' of the renters who qualify for it (very thin), its homes are underwritten at the rent of the next lower band that stays at ' + pct(GOOD) + ' or less (good capture). The ' + pct(GOOD) + ' and ' + pct(VERY_THIN) + ' lines are COHO starting rules, not a published standard.</p>' +
      '<div class="table-scroll"><table class="start-table" data-no-sort><caption>Gross rent a month, by size (homes) and band</caption><thead><tr><th scope="col">Size</th>' + BANDS.map(function (b) { return '<th scope="col" class="num">' + b + '%</th>'; }).join('') + '</tr></thead><tbody>' + rentRows + '</tbody></table></div>' +
      '<p class="note">' + (capped ? '* Held to HUD’s Fair Market Rent, below CHFA’s ceiling. ' : '') +
      (moved.length ? '↓ ' + moved.map(function (b) { return b + '% homes at the ' + r.at[b] + '% rent'; }).join('; ') + '. ' : 'No band is very thin, so no rent moves down. ') +
      '<a href="' + esc(r.chfa.source_url) + '">CHFA 2026 limits</a>, effective ' + esc(r.chfa.effective_date) + '; <a href="' + esc(r.hud.url_fmr) + '">HUD FY' + esc(String(r.hud.fiscal_year)) + ' Fair Market Rents</a>. Bedrooms follow renter homes in ' + esc(r.bedroomsFrom ? r.bedroomsFrom.name.replace(/ \((city|town|CDP)\)$/, '') : 'the county') + ' (Census ACS 2020–2024, table B25042); 4 bedrooms and up count as 3.</p>' +
      '<h4>Utilities</h4>' + uaText +
      '<h4>Vacancy</h4><p>' + pct(r.vacancy) + ', CHFA’s minimum for project income' + (r.vacSrc ? ' (<a href="' + esc(r.vacSrc.url) + '">' + esc(r.vacSrc.title) + '</a>' + (r.vacWhere ? ', ' + esc(r.vacWhere) : '') + ')' : '') + '.</p>' +
      '<h4>Cost</h4>' + costText +
      '<div class="actions"><button type="submit">Put these on the Homes form</button>' +
      (dr.homes || dr.bands || dr.cost ? '<button type="button" class="quiet" data-start-reset="' + at + '">Start over</button>' : '') + '</div>' +
      '</form></details>';
  }

  // ---------------- writing the Homes form and Financials ----------------
  function homesDraft(r) {
    var rows = [];
    BANDS.forEach(function (b) { SIZES.forEach(function (k) {
      var n = r.cells[b][k];
      if (!(n > 0)) return;
      var x = r.rent[b][k];
      rows.push({ bedrooms: k, ami_tier: b, count: String(n), proposed_gross_rent: x.rent == null ? '' : String(x.rent), utility_allowance: r.ua ? String(r.ua[k]) : '', fees: '' });
    }); });
    return {
      county_fips: r.fips, total_units: String(r.homes), vacancy_rate: String(Math.round(r.vacancy * 1000) / 10), use_hera_special: false,
      utility_allowance_basis: r.ua ? { method: 'pha', reference: DOH_UA.reference, effective_date: DOH_UA.effective, resident_paid: DOH_UA.paid.slice(), bound_county_fips: r.fips }
        : { method: '', reference: '', effective_date: '', resident_paid: [] },
      unit_mix: rows.length ? rows : [{ bedrooms: '2BR', ami_tier: 60, count: '', proposed_gross_rent: '', utility_allowance: '', fees: '' }]
    };
  }

  function costDraft(p, s, r) {
    var F = global.LabFinancials, Q = global.LabDealQuick, B = global.DealCostBasis;
    if (!F || !Q || !B || !r.cost) return null;
    var total = r.cost.perHome * r.homes, d = F.draftFor(p, s.scenarioId);
    d.fields['dc-tdc'] = String(total);
    Q.scaledLines(B, total).forEach(function (l) {
      if (!(l.id in d.costs)) return;
      d.costs[l.id] = l.amount == null ? '' : String(l.amount);
      if (l.eligibleAmount != null) { d.parts = d.parts || {}; d.parts[l.id] = String(l.eligibleAmount); }
      if (l.used != null) { d.used = d.used || {}; d.used[l.id] = String(l.used); }
    });
    return d;
  }

  function apply(pid, sid) {
    var p = P.get(pid), s = p && p.scenarios.filter(function (x) { return x.scenarioId === sid; })[0];
    if (!s || !p.jurisdiction) return false;
    var r = plan(p, s);
    if (r.wait || r.error) return false;
    P.setOverride(pid, sid, 'homesDraft', homesDraft(r));
    var cd = r.wantCost ? costDraft(p, s, r) : null;
    if (cd) P.setOverride(pid, sid, 'financialsDraft', cd);
    P.setOverride(pid, sid, 'startUsed', { at: new Date().toISOString(), place: p.jurisdiction.name, area: r.area.label, homes: r.homes, cost: cd ? r.cost.perHome : null });
    location.hash = '#/homes/' + pid + '/' + sid;
    return true;
  }

  // One line on the Homes form while it holds starting numbers that are not saved yet.
  function homesNote(p, s) {
    var u = p.overrides[s.scenarioId] && p.overrides[s.scenarioId].startUsed;
    if (!u) return '';
    var saved = p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0];
    if (saved && saved.attachedAt > u.at) return '';
    return '<p class="callout start-note" role="status">These are starting numbers for ' + esc(u.place) + ', counted in ' + esc(u.area) + '. Check each one, change what you know better, then save. ' +
      '<a href="#/project/' + esc(p.projectId) + '">How they were set</a>' + (u.cost ? '. The cost, ' + esc(money(u.cost)) + ' a home, is on Financials.' : '.') + '</p>';
  }

  // ---------------- events ----------------
  function redraw() { if (global.LabRedraw && global.LabRedraw.after) global.LabRedraw.after(Shell.render); else Shell.render(); }
  var main = document.getElementById('main');
  if (main) {
    main.addEventListener('change', function (ev) {
      var form = ev.target && ev.target.form;
      if (!form || !form.dataset || !form.dataset.start) return;
      var ids = form.dataset.start.split('/'), p = P.get(ids[0]);
      if (!p) return;
      var dr = draftOf(p, { scenarioId: ids[1] }), n = ev.target.name;
      if (n === 'homes') { dr.homes = ev.target.value; dr.bands = null; }
      else if (/^b\d+$/.test(n)) {
        dr.bands = {}; BANDS.forEach(function (b) { var el = form.querySelector('[name="b' + b + '"]'); dr.bands[b] = el ? el.value : ''; });
        dr.homes = String(sum(dr.bands));
      } else if (n === 'cost') dr.cost = ev.target.checked;
      else return;
      P.setOverride(ids[0], ids[1], 'startDraft', dr);
      redraw();
    });
    main.addEventListener('submit', function (ev) {
      var form = ev.target;
      if (!form.dataset || !form.dataset.start) return;
      ev.preventDefault();
      var ids = form.dataset.start.split('/');
      apply(ids[0], ids[1]);
    });
    main.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-start-reset]');
      if (!b) return;
      var ids = b.dataset.startReset.split('/');
      P.setOverride(ids[0], ids[1], 'startDraft', { homes: '', bands: null, cost: false });
      Shell.render();
    });
  }

  global.LabStart = { section: section, plan: plan, apply: apply, homesNote: homesNote, homesDraft: homesDraft, spread: spread, grid: grid, moves: moves, uaFor: uaFor, localCost: localCost,
    GOOD: GOOD, VERY_THIN: VERY_THIN, DOH_UA: DOH_UA, GJ_COST: GJ_COST, BANDS: BANDS };
})(window);
