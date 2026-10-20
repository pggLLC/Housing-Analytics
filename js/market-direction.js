/**
 * market-direction.js — Market Direction tab on colorado-deep-dive.html.
 *
 * Reads data/market/market-direction.json (scripts/market/build_market_direction.py,
 * a step of the derived chain): a call for every county and town, with the
 * readings behind it. A county's projects come from
 * data/market/development-activity.json, loaded the first time one is picked.
 * The page computes nothing the files do not hold except sums and counts of
 * their own rows; the call names, their definitions and the thresholds are
 * read from the file's meta, so the page cannot disagree with the rule.
 *
 * A missing reading renders as "No reading" with its reason, never as 0.
 */
(function (global) {
  'use strict';

  var FILE = 'market/market-direction.json';
  var PROJECTS_FILE = 'market/development-activity.json';
  // Realtor.com's monthly listings summary: context beside the calls, never
  // an input to them. Loaded on its own so a missing file costs three columns,
  // not the tab.
  var LISTINGS_FILE = 'market/realtor_inventory_co.json';
  var listings = null;
  var listingsFailed = false;
  var NONE = 'No reading';
  var started = false;
  var data = null;
  var projects = null;
  var projectsLoading = null;
  var counties = [];
  var places = [];
  var countySort = { key: 'name', dir: 1 };
  var townSort = { key: 'name', dir: 1 };

  // Literal hex, as Leaflet styles need (see js/components/home-need-map.js);
  // the legend swatches are drawn from this same list.
  var CALLS = {
    emerging: { label: 'Emerging', color: '#1d4ed8' },
    steady: { label: 'Steady', color: '#9ca3af' },
    softening: { label: 'Softening', color: '#d97706' },
    falling_demand: { label: 'Falling demand', color: '#991b1b' },
    second_home_shift: { label: 'Second-home shift', color: '#7c3aed' },
    not_enough_data: { label: 'Not enough data', color: '#e5e7eb' }
  };
  // The county calls in the order the file publishes them (meta.calls), plus any
  // call a county carries that meta.calls does not define, so every county is counted.
  var COUNTY_ORDER = [];
  function countyOrder(d) {
    var order = Object.keys(d.meta.calls || {});
    Object.keys(d.meta.call_counts || {}).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    return order;
  }
  // A call gets a tile when any county has it; the four rules that can always apply keep theirs at zero.
  function tileCalls(cc) {
    return COUNTY_ORDER.filter(function (k) { return cc[k] || k !== 'not_enough_data'; });
  }
  var STAGES = {
    under_construction: 'Under construction', funded: 'Funded', land_funded: 'Land funded',
    applied: 'Applied', letter_of_intent: 'Letter of intent', not_funded: 'Not funded'
  };
  var EDGE = { clear: 'Clear', thin: 'Thin', no_edge: 'None' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function dataUrl(key) {
    if (global.DataService && typeof global.DataService.baseData === 'function') return global.DataService.baseData(key);
    return 'data/' + key;
  }

  function fetchJSON(key) {
    return fetch(dataUrl(key)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + key);
      return r.json();
    });
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtInt(v) { return isNum(v) ? Math.round(v).toLocaleString('en-US') : NONE; }
  function signed(v, d) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%'; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(id) { return document.getElementById(id); }
  function setText(id, text) { var e = el(id); if (e) e.textContent = text; }
  function callLabel(c) { return CALLS[c] ? CALLS[c].label : c; }
  function callColor(c) { return CALLS[c] ? CALLS[c].color : '#e5e7eb'; }

  // "rising: permits, price; falling: none" → "Rising: permits, price".
  function why(basis) {
    if (!basis) return '';
    if (basis.indexOf(':') < 0) return basis.charAt(0).toUpperCase() + basis.slice(1);
    var parts = basis.split('; ').filter(function (p) { return !/: none$/.test(p); });
    if (!parts.length) return 'Nothing rising or falling';
    var s = parts.join('; ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // One signal: its value and how the rule read it, or "No reading" and why.
  function signal(s, d, unit) {
    if (!s || !isNum(s.value)) return { text: NONE, title: (s && s.unavailable_reason) || 'No reading for this place', sort: null };
    var word = s.reading === 'up' ? 'rising' : s.reading === 'down' ? 'falling' : 'flat';
    return { text: signed(s.value, d) + (unit || '') + ' (' + word + ')', title: '', sort: s.value };
  }

  function ytd(p) {
    if (!p || !p.ytd) return { text: NONE, title: (p && p.unavailable_reason) || 'Not in the Census monthly permit files', sort: null };
    return { text: fmtInt(p.ytd.total) + ' vs ' + fmtInt(p.prior_ytd && p.prior_ytd.total), title: '', sort: p.ytd.total };
  }

  function ytdChange(p) {
    if (!p || !isNum(p.change_pct)) return { text: NONE, title: (p && p.unavailable_reason) || 'No change can be read', sort: null };
    return { text: signed(p.change_pct, 1), title: '', sort: p.change_pct };
  }

  function monthName(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    return m ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }

  // One county's Realtor.com row, or the reason there is none. A county the
  // month's file leaves out reads "No reading"; it never breaks the table.
  function listingRow(fips) {
    if (!listings) return { row: null, why: listingsFailed ? 'The Realtor.com listings file could not be loaded' : 'Loading Realtor.com listings' };
    var r = (listings.counties || {})[fips];
    return r ? { row: r, why: '' } : { row: null, why: 'Not in Realtor.com’s file for ' + monthName(listings.meta.month) };
  }

  // † marks a county Realtor.com flags this month (quality_flag); the note under the table explains it.
  function listingCell(fips, value, text, sort) {
    var l = listingRow(fips);
    if (!l.row || !isNum(l.row[value])) return { text: NONE, title: l.why || 'Realtor.com publishes no figure for this county this month', sort: null };
    return { text: text(l.row) + (l.row.quality_flag === 1 ? ' †' : ''), title: '', sort: sort(l.row) };
  }

  function forSale(c) {
    return listingCell(c.fips, 'active_listings', function (r) {
      return fmtInt(r.active_listings) + (isNum(r.active_listings_yy_pct) ? ' (' + signed(r.active_listings_yy_pct, 1) + ' from a year before)' : '');
    }, function (r) { return r.active_listings; });
  }

  function daysOnMarket(c) {
    return listingCell(c.fips, 'median_days_on_market', function (r) { return fmtInt(r.median_days_on_market) + ' days'; },
      function (r) { return r.median_days_on_market; });
  }

  function priceCuts(c) {
    return listingCell(c.fips, 'price_reduced_share_pct', function (r) { return r.price_reduced_share_pct.toFixed(0) + '%'; },
      function (r) { return r.price_reduced_share_pct; });
  }

  function renderListingsNote() {
    var note = el('mdListingsNote');
    if (!note) return;
    if (!listings) {
      note.textContent = listingsFailed ? 'The Realtor.com listings columns are empty because their file could not be loaded.' : '';
      return;
    }
    var flagged = counties.filter(function (c) { var r = listings.counties[c.fips]; return r && r.quality_flag === 1; }).length;
    var missing = counties.filter(function (c) { return !listings.counties[c.fips]; }).length;
    note.innerHTML = 'Homes for sale, days on market and price cuts are from <a href="' + escapeHtml(listings.meta.url) +
      '" target="_blank" rel="noopener">Realtor.com</a> listings for ' + escapeHtml(monthName(listings.meta.month)) +
      '. They describe the for-sale market beside each call; no call reads them.' +
      (flagged ? ' † Realtor.com flags ' + flagged + ' ' + (flagged === 1 ? 'county' : 'counties') +
        ' this month because their figures fall outside their usual range, so read those with care.' : '') +
      (missing ? ' ' + missing + ' ' + (missing === 1 ? 'county is' : 'counties are') + ' not in this month’s file.' : '');
  }

  function loadListings() {
    return fetchJSON(LISTINGS_FILE).then(function (d) {
      if (!d || !d.meta || !d.counties) throw new Error('unexpected shape');
      listings = d;
    }).catch(function (err) {
      listingsFailed = true;
      console.warn('[market-direction] Realtor.com listings failed:', err);
    }).then(function () {
      if (!data) return;
      renderCountyTable();
      renderListingsNote();
    });
  }

  function through() {
    var t = data.meta.sources.permits_ytd && data.meta.sources.permits_ytd.through;
    var m = t ? Number(t.split('-')[1]) : NaN;
    return isNum(m) ? { year: Number(t.split('-')[0]), month: m, range: 'January–' + MONTHS[m - 1] } : null;
  }

  // ── Headline ────────────────────────────────────────────────────────
  function renderSummary() {
    var cc = data.meta.call_counts;
    var n = counties.length;
    var parts = COUNTY_ORDER.filter(function (k) { return cc[k]; }).map(function (k) {
      return cc[k] + ' ' + (k === 'falling_demand' ? 'losing household population and jobs' : k === 'not_enough_data' ? 'without enough data to call' : callLabel(k).toLowerCase());
    });
    parts[0] = parts[0].replace(/^(\d+) /, function (m, k) { return k + (k === '1' ? ' is ' : ' are '); });
    var lead = 'Of Colorado’s ' + n + ' counties, ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' : '') + parts[parts.length - 1] + '.';
    var tc = (data.meta.places.call_counts || {}).town || {};
    var towns = places.filter(function (p) { return p.type === 'town'; }).length;
    var townLine = ' Of ' + towns + ' towns, ' + (tc.emerging || 0) + ' are emerging, ' + (tc.softening || 0) + ' softening and ' +
      (tc.falling_demand || 0) + ' losing household population with a market signal that agrees.';
    var t = through();
    var now = 0, before = 0, have = 0;
    counties.forEach(function (c) {
      var p = c.permits_ytd;
      if (p && p.ytd && p.prior_ytd) { now += p.ytd.total; before += p.prior_ytd.total; have++; }
    });
    var permits = t && have === n ? ' Statewide, ' + fmtInt(now) + ' homes were permitted ' + t.range + ' ' + t.year + ', against ' +
      fmtInt(before) + ' in the same months of ' + (t.year - 1) + '.' : '';
    setText('mdSummary', lead + townLine + permits);
    // Which demand readings each rule uses, from the thresholds the file publishes:
    // towns have no jobs series, so their rule reads household population alone.
    var demand = function (t) {
      var d = [t.population ? 'household population' : null, t.jobs ? 'jobs' : null].filter(Boolean);
      return d.length ? d.join(' and ') : 'no demand reading';
    };
    setText('mdIntro', 'A county call reads ' + demand(data.meta.thresholds) + ' (demand) against permits, home prices and rents (the market). ' +
      'A town call reads ' + demand(data.meta.places.thresholds) + ' against the same market signals' +
      (data.meta.places.thresholds.jobs ? '.' : ', because no jobs series exists for towns.') +
      ' The data come from DOLA, the Census Bureau, FHFA and Zillow; the rule and its thresholds are under "How a call is made" below.');
    var gen = data.meta.generated_at ? 'Newest input dated ' + data.meta.generated_at.slice(0, 10) + '.' : '';
    setText('mdGenerated', gen);

    var kpis = el('mdKpis');
    if (kpis) {
      kpis.innerHTML = tileCalls(cc).map(function (k) {
        return '<div class="mi-kpi"><div class="mi-kpi-value"><span class="md-swatch" style="background:' + callColor(k) + '" aria-hidden="true"></span>' +
          fmtInt(cc[k] || 0) + '</div><div class="mi-kpi-label">' + escapeHtml(callLabel(k)) + ' counties</div>' +
          '<div class="mi-kpi-sub">' + escapeHtml(data.meta.calls[k] || '') + '</div></div>';
      }).join('');
    }
  }

  // ── Map ─────────────────────────────────────────────────────────────
  function renderMap() {
    var mount = el('mdMap');
    var legend = el('mdLegend');
    if (legend) {
      legend.innerHTML = tileCalls(data.meta.call_counts || {}).map(function (k) {
        return '<li><span class="md-swatch" style="background:' + callColor(k) + '" aria-hidden="true"></span>' + escapeHtml(callLabel(k)) + '</li>';
      }).join('');
    }
    var byCall = {};
    counties.forEach(function (c) { (byCall[c.call] = byCall[c.call] || []).push(c.name.replace(/ County$/, '')); });
    setText('mdMapText', COUNTY_ORDER.filter(function (k) { return byCall[k]; }).map(function (k) {
      return callLabel(k) + ': ' + byCall[k].join(', ') + '.';
    }).join(' '));
    if (!mount || !global.L) { if (mount) mount.hidden = true; return; }
    fetch('data/co-county-boundaries.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      if (!b || !Array.isArray(b.features)) { mount.hidden = true; return; }
      var map = global.L.map(mount, {
        zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, center: [39.0, -105.5], zoom: 6, zoomSnap: 0.25
      });
      var byFips = {};
      counties.forEach(function (c) { byFips[c.fips] = c; });
      var layer = global.L.geoJSON(b, {
        style: function (f) {
          var c = byFips[f.properties && f.properties.GEOID];
          return { color: '#fff', weight: 1, fillColor: callColor(c && c.call), fillOpacity: 0.85 };
        },
        onEachFeature: function (f, fl) {
          var c = byFips[f.properties && f.properties.GEOID];
          if (!c) return;
          fl.bindTooltip(c.name + ': ' + callLabel(c.call), { sticky: true });
          fl.on('click', function () { pickCounty(c.fips, true); });
        }
      }).addTo(map);
      var bounds = layer.getBounds();
      map.fitBounds(bounds, { padding: [4, 4] });
      var timer = null;
      global.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { map.invalidateSize(); map.fitBounds(bounds, { padding: [4, 4] }); }, 150);
      });
      mount.__mdMap = map;
    }).catch(function () { mount.hidden = true; });
  }

  // ── Tables ──────────────────────────────────────────────────────────
  var COUNTY_COLS = [
    { key: 'name', label: 'County', title: 'Colorado county', get: function (c) { return { text: c.name, sort: c.name }; } },
    { key: 'call', label: 'Call', title: 'The market call: the first rule in the order under "How a call is made" that applies', get: function (c) { return { text: callLabel(c.call), sort: COUNTY_ORDER.indexOf(c.call) }; } },
    { key: 'why', label: 'Why', title: 'The signals that decided the call', get: function (c) { return { text: why(c.call_basis), sort: why(c.call_basis) }; } },
    { key: 'pop', label: 'Household population, per year', title: 'Change in household population (people not in group quarters), % a year, DOLA county profiles', get: function (c) { return signal(c.signals.population, 2); } },
    { key: 'jobs', label: 'Jobs', title: 'Change in jobs located in the county, Census LEHD LODES, from the first year to the last of its window', get: function (c) { return signal(c.signals.jobs, 1); } },
    { key: 'permits', label: 'Permits, 5 years', title: 'Homes permitted in the last five years against the five before, Census Building Permits Survey annual files', get: function (c) { return signal(c.signals.permits, 1); } },
    { key: 'price', label: 'Home prices', title: 'Change in the FHFA house price index over the years shown in the method section; nominal', get: function (c) { return signal(c.signals.price, 1); } },
    { key: 'rent', label: 'Rent, past year', title: 'Change in the Zillow Observed Rent Index over the latest 12 months', get: function (c) { return signal(c.signals.rent, 1); } },
    { key: 'ytd', label: 'Homes permitted this year vs last', title: 'Homes permitted this year to date against the same months last year, Census Building Permits Survey monthly files; context only, no call reads it', get: function (c) { return ytd(c.permits_ytd); } },
    { key: 'ytdpct', label: 'Change this year', title: 'Change in homes permitted this year to date; read only when each period has at least 50 homes', get: function (c) { return ytdChange(c.permits_ytd); } },
    { key: 'forsale', label: 'Homes for sale', title: 'Homes listed for sale on Realtor.com in the month named under the table, and the change from a year earlier; context only, no call reads it', get: forSale },
    { key: 'dom', label: 'Days on market', title: 'Median days a listing has been on Realtor.com, for the same month; context only', get: daysOnMarket },
    { key: 'cuts', label: 'Listings with a price cut', title: 'Share of Realtor.com listings whose price was reduced during the month; context only', get: priceCuts },
    { key: 'edge', label: 'Tax-credit rent edge', title: 'How far the 60% AMI two-bedroom rent sits below HUD Fair Market Rent: clear (10% or more), thin (under 10%) or none', get: function (c) {
      var e = c.rent_edge;
      if (!e || !e.reading) return { text: NONE, title: (e && e.unavailable_reason) || '', sort: null };
      return { text: EDGE[e.reading] + (isNum(e.edge_pct) ? ' (' + e.edge_pct.toFixed(1) + '%)' : ''), title: '', sort: e.edge_pct };
    } },
    { key: 'pipe', label: 'Affordable homes in the pipeline', title: 'Homes in affordable projects a state agency recorded since 2023, at any stage, from the development ledger', get: function (c) {
      var a = c.affordable_activity;
      if (!a) return { text: NONE, title: 'Not in the development ledger', sort: null };
      return { text: fmtInt(a.homes) + ' in ' + a.projects + ' project' + (a.projects === 1 ? '' : 's'), title: '', sort: a.homes };
    } }
  ];

  var TOWN_COLS = [
    { key: 'name', label: 'Town', title: 'Incorporated town or census-designated place (CDP)', get: function (p) { return { text: p.name, sort: p.name }; } },
    { key: 'county', label: 'County', title: 'The county the town sits in', get: function (p) { var c = data.counties[p.county_fips]; var n = c ? c.name : ''; return { text: n, sort: n }; } },
    { key: 'type', label: 'Type', title: 'Town: an incorporated municipality. CDP: a census-designated place, an unincorporated community the Census Bureau names; shown only when the box above is ticked', get: function (p) { var t = p.type === 'cdp' ? 'CDP' : 'Town'; return { text: t, sort: t }; } },
    { key: 'call', label: 'Call', title: 'The town call, on the town rule under "How a call is made"', get: function (p) { return { text: callLabel(p.call), sort: callLabel(p.call) }; } },
    { key: 'why', label: 'Why', title: 'The signals that decided the call', get: function (p) { return { text: why(p.call_basis), sort: why(p.call_basis) }; } },
    { key: 'pop', label: 'Household population, per year', title: 'Change in household population, % a year, DOLA municipal estimates; towns only', get: function (p) { return signal(p.signals.population, 2); } },
    { key: 'permits', label: 'Permits, 5 years', title: 'Homes permitted in the last five years against the five before, Census Building Permits Survey annual place files', get: function (p) { return signal(p.signals.permits, 1); } },
    { key: 'price', label: 'Home prices, past year', title: 'One year of FHFA tract price indexes modelled to the place; nominal', get: function (p) { return signal(p.signals.price, 1); } },
    { key: 'rent', label: 'Rent, past year', title: 'Change in the Zillow Observed Rent Index over the latest 12 months, where Zillow publishes one for the town', get: function (p) { return signal(p.signals.rent, 1); } },
    { key: 'ytd', label: 'Homes permitted this year vs last', title: 'Homes permitted this year to date against the same months last year, for permit offices that report every month; context only', get: function (p) { return ytd(p.permits_ytd); } },
    { key: 'county_call', label: 'County call', title: 'The call for the county the town sits in', get: function (p) { return { text: callLabel(p.county_call), sort: callLabel(p.county_call) }; } }
  ];

  function compare(cols, s) {
    var col = cols.filter(function (c) { return c.key === s.key; })[0];
    return function (a, b) {
      var va = col.get(a).sort, vb = col.get(b).sort;
      var am = va == null || va === '', bm = vb == null || vb === '';
      if (am || bm) return am === bm ? 0 : am ? 1 : -1;   // no reading sorts last both ways
      if (typeof va === 'string') return s.dir * va.localeCompare(vb);
      return s.dir * (va - vb);
    };
  }

  function headHtml(cols, s) {
    return cols.map(function (c) {
      var on = c.key === s.key;
      return '<th scope="col" aria-sort="' + (on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none') + '" title="' + escapeHtml(c.title) +
        '"><button type="button" class="fvn-sort" data-key="' + c.key + '">' + escapeHtml(c.label) + '</button></th>';
    }).join('');
  }

  function rowHtml(cols, r) {
    return '<tr>' + cols.map(function (c, i) {
      var v = c.get(r);
      var tag = i === 0 ? 'th scope="row"' : 'td';
      // A missing reading carries its reason as visible text, which the
      // table download moves to the row's notes column (data-export-note).
      var note = v.text === NONE && v.title ? '<span class="md-none-why" data-export-note>' + escapeHtml(v.title) + '</span>' : '';
      return '<' + tag + (v.title && !note ? ' title="' + escapeHtml(v.title) + '"' : '') + '>' + escapeHtml(v.text) + note + '</' + tag.split(' ')[0] + '>';
    }).join('') + '</tr>';
  }

  function renderCountyTable() {
    var head = el('mdCountyHead'), body = el('mdCountyBody');
    if (!head || !body) return;
    head.innerHTML = headHtml(COUNTY_COLS, countySort);
    body.innerHTML = counties.slice().sort(compare(COUNTY_COLS, countySort)).map(function (c) { return rowHtml(COUNTY_COLS, c); }).join('');
  }

  function townRows() {
    var county = (el('mdCounty') || {}).value || '';
    var call = (el('mdTownCall') || {}).value || '';
    var cdps = !!(el('mdCdps') || {}).checked;
    return places.filter(function (p) {
      return (cdps || p.type === 'town') && (!county || p.county_fips === county) && (!call || p.call === call);
    });
  }

  function renderTownTable() {
    var head = el('mdTownHead'), body = el('mdTownBody');
    if (!head || !body) return;
    head.innerHTML = headHtml(TOWN_COLS, townSort);
    var rows = townRows().sort(compare(TOWN_COLS, townSort));
    body.innerHTML = rows.length ? rows.map(function (p) { return rowHtml(TOWN_COLS, p); }).join('')
      : '<tr><td colspan="' + TOWN_COLS.length + '">No town matches these filters.</td></tr>';
    setText('mdTownCount', rows.length + ' shown.');
  }

  function onSort(cols, s, render, headId) {
    return function (ev) {
      var btn = ev.target.closest && ev.target.closest('.fvn-sort');
      if (!btn) return;
      var key = btn.getAttribute('data-key');
      if (key === s.key) s.dir = -s.dir;
      else { s.key = key; s.dir = 1; }
      render();
      var again = document.querySelector('#' + headId + ' .fvn-sort[data-key="' + key + '"]');
      if (again) again.focus();
    };
  }

  // ── Projects in a county ────────────────────────────────────────────
  function countyProjects(fips) {
    return projects.projects.filter(function (p) {
      return p.county_fips === fips || (Array.isArray(p.county_fips_all) && p.county_fips_all.indexOf(fips) >= 0);
    }).sort(function (a, b) { return (b.latest_year - a.latest_year) || a.name.localeCompare(b.name); });
  }

  function projectRow(p) {
    var last = p.events && p.events.length ? p.events[p.events.length - 1] : null;
    var homes = isNum(p.total_units) ? fmtInt(p.total_units) : NONE;
    var record = last ? escapeHtml(last.agency + ', ' + last.program + (last.round ? ' (' + last.round + ')' : '')) : '';
    if (last && last.source_url) record = '<a href="' + escapeHtml(last.source_url) + '" target="_blank" rel="noopener">' + record + '</a>';
    return '<tr><th scope="row">' + escapeHtml(p.name) + '</th><td>' + escapeHtml(p.city || '') + '</td>' +
      '<td title="' + escapeHtml((projects.meta.stages || {})[p.stage] || '') + '">' + escapeHtml(STAGES[p.stage] || p.stage) + '</td>' +
      '<td>' + homes + (isNum(p.total_units) ? '' : '<span class="md-none-why" data-export-note>' + escapeHtml(p.total_units_unavailable_reason || 'The source prints no unit count') + '</span>') + '</td>' +
      '<td>' + escapeHtml(p.latest_year) + '</td><td>' + record + '</td></tr>';
  }

  function renderProjects(fips) {
    var body = el('mdProjectBody');
    if (!body) return;
    var c = data.counties[fips];
    if (!c) {
      body.innerHTML = '<tr><td colspan="6">Pick a county above, or select one on the map, to list its projects.</td></tr>';
      setText('mdProjectSummary', '');
      return;
    }
    if (!projects) {
      body.innerHTML = '<tr><td colspan="6">Loading the project ledger…</td></tr>';
      loadProjects().then(function () { if ((el('mdCounty') || {}).value === fips) renderProjects(fips); });
      return;
    }
    var list = countyProjects(fips);
    var a = c.affordable_activity;
    var first = list.length ? Math.min.apply(null, list.map(function (p) { return p.first_year; })) : null;
    setText('mdProjectSummary', c.name + ' is ' + callLabel(c.call).toLowerCase() + '. ' + (list.length
      ? 'State agencies have recorded ' + list.length + ' affordable project' + (list.length === 1 ? '' : 's') + ' here, the first in ' + first +
        (a && a.projects ? '; ' + a.projects + ' of them have a record since ' + a.since + ', with ' + fmtInt(a.homes) + ' homes.' : '.')
      : 'No state agency has recorded an affordable project here since 2016.'));
    body.innerHTML = list.length ? list.map(projectRow).join('') : '<tr><td colspan="6">No state agency has recorded an affordable project in ' + escapeHtml(c.name) + ' since 2016.</td></tr>';
  }

  function loadProjects() {
    if (!projectsLoading) {
      projectsLoading = fetchJSON(PROJECTS_FILE).then(function (d) { projects = d; return d; }).catch(function (err) {
        projectsLoading = null;
        console.warn('[market-direction] project ledger failed:', err);
        var body = el('mdProjectBody');
        if (body) body.innerHTML = '<tr><td colspan="6">The project ledger could not be loaded.</td></tr>';
        throw err;
      });
    }
    return projectsLoading;
  }

  function pickCounty(fips, scroll) {
    var sel = el('mdCounty');
    if (sel) sel.value = fips || '';
    renderTownTable();
    renderProjects(fips);
    if (scroll) { var h = el('md-projects-heading'); if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start' }); }
  }

  // ── Method ──────────────────────────────────────────────────────────
  function renderMethod() {
    var m = data.meta;
    var t = m.thresholds, pt = m.places.thresholds;
    var names = { permits: 'Permits, 5 years against the 5 before', price: 'Home prices', rent: 'Rent, past year', population: 'Household population, % a year', jobs: 'Jobs' };
    var body = el('mdThresholdBody');
    if (body) {
      body.innerHTML = Object.keys(names).map(function (k) {
        var c = t[k], p = pt[k];
        var f = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%'; };
        return '<tr><th scope="row">' + escapeHtml(names[k]) + '</th><td>' + (c ? f(c.up_at_or_above) + ' or more' : 'Not used') + '</td><td>' +
          (c ? f(c.down_at_or_below) + ' or less' : 'Not used') + '</td><td>' + (p ? f(p.up_at_or_above) + ' / ' + f(p.down_at_or_below) : 'Not used') + '</td></tr>';
      }).join('');
    }
    var list = el('mdCalls');
    if (list) {
      // Counties and towns have different rules (towns have no jobs trend), so
      // each call shows both definitions, each read from its own meta.
      list.innerHTML = ['falling_demand', 'softening', 'emerging', 'steady', 'second_home_shift', 'not_enough_data'].map(function (k) {
        var county = m.calls[k], town = m.places.calls[k];
        var parts = [];
        if (county && county === town) parts.push(escapeHtml(county));
        else {
          if (county) parts.push('<em>Counties:</em> <span data-md-def="county">' + escapeHtml(county) + '</span>');
          if (town) parts.push('<em>Towns:</em> <span data-md-def="town">' + escapeHtml(town) + '</span>');
        }
        return '<li data-md-call="' + k + '"><strong>' + escapeHtml(callLabel(k)) + '.</strong> ' + parts.join(' ') + '</li>';
      }).join('');
    }
    setText('mdOrder', 'Counties: ' + m.rule_order + '. Towns: ' + m.places.rule_order + '.');
    setText('mdThresholdNote', m.threshold_note);
    // The windows each county reading covers, as the file records them.
    var w = {};
    counties.forEach(function (c) {
      var g = c.signals;
      if (!w.permits && g.permits && g.permits.period_a) w.permits = 'permits ' + g.permits.period_b + ' against ' + g.permits.period_a;
      if (!w.price && g.price && g.price.from_year) w.price = 'county home prices ' + g.price.from_year + ' to ' + g.price.to_year;
      if (!w.jobs && g.jobs && g.jobs.from_year) w.jobs = 'jobs ' + g.jobs.from_year + ' to ' + g.jobs.to_year;
      if (!w.pop && g.population && g.population.from_year) w.pop = 'household population ' + g.population.from_year + ' to ' + g.population.to_year;
      if (!w.rent && g.rent && g.rent.month) w.rent = 'rent over the 12 months to ' + g.rent.month.slice(0, 7);
    });
    var wl = ['pop', 'jobs', 'permits', 'price', 'rent'].filter(function (k) { return w[k]; }).map(function (k) { return w[k]; });
    setText('mdWindows', wl.length ? 'Each county reading covers ' + wl.join('; ') + '. A town’s price reading is the latest single year.' : '');
    var s = m.sources;
    var src = el('mdSources');
    if (src) {
      src.innerHTML = ['population', 'jobs', 'permits', 'price', 'rent', 'permits_ytd', 'fmr', 'lihtc_rents'].filter(function (k) { return s[k] && s[k].url; }).map(function (k) {
        return '<li><a href="' + escapeHtml(s[k].url) + '" target="_blank" rel="noopener">' + escapeHtml(s[k].source) + '</a></li>';
      }).join('') + '<li><a href="https://www.realtor.com/research/data/" target="_blank" rel="noopener">Realtor.com Residential Data, monthly inventory (homes for sale, days on market, price cuts)</a></li>';
    }
  }

  function fillPickers() {
    var sel = el('mdCounty');
    if (sel) {
      sel.innerHTML = '<option value="">All counties</option>' + counties.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (c) {
        return '<option value="' + c.fips + '">' + escapeHtml(c.name) + '</option>';
      }).join('');
      sel.addEventListener('change', function () { pickCounty(sel.value, false); });
    }
    var call = el('mdTownCall');
    if (call) {
      var tc = (data.meta.places.call_counts || {}).town || {};
      // Most common call first.
      var keys = Object.keys(data.meta.places.calls).sort(function (a, b) { return (tc[b] || 0) - (tc[a] || 0); });
      call.innerHTML = '<option value="">Every call</option>' + keys.map(function (k) {
        return '<option value="' + k + '">' + escapeHtml(callLabel(k)) + (isNum(tc[k]) ? ' (' + tc[k] + ' towns)' : '') + '</option>';
      }).join('');
      call.addEventListener('change', renderTownTable);
    }
    var cdps = el('mdCdps');
    if (cdps) cdps.addEventListener('change', renderTownTable);
  }

  function init() {
    if (started) return;
    started = true;
    loadListings();
    fetchJSON(FILE).then(function (d) {
      data = d;
      COUNTY_ORDER = countyOrder(d);
      counties = Object.keys(d.counties).map(function (k) { var c = d.counties[k]; c.fips = k; return c; });
      places = Object.keys(d.places).map(function (k) { var p = d.places[k]; p.geoid = k; return p; });
      renderSummary();
      renderMap();
      fillPickers();
      renderCountyTable();
      renderListingsNote();
      renderTownTable();
      renderProjects('');
      renderMethod();
      var ch = el('mdCountyHead');
      if (ch) ch.addEventListener('click', onSort(COUNTY_COLS, countySort, renderCountyTable, 'mdCountyHead'));
      var th = el('mdTownHead');
      if (th) th.addEventListener('click', onSort(TOWN_COLS, townSort, renderTownTable, 'mdTownHead'));
    }).catch(function (err) {
      console.warn('[market-direction] load failed:', err);
      setText('mdSummary', 'The market direction data could not be loaded.');
    });
  }

  global.MarketDirection = { init: init, _why: why, _signal: signal, _calls: CALLS, _listingRow: listingRow,
    _setListings: function (d, failed) { listings = d; listingsFailed = !!failed; } };

  // Opened straight onto the tab (#tab-direction): the tab script has already revealed it.
  function maybeInit() {
    var panel = el('tab-direction');
    if (panel && !panel.hasAttribute('hidden')) init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
  else maybeInit();
}(window));
