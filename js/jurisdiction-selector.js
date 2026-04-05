/**
 * jurisdiction-selector.js
 * Handles all interaction logic for select-jurisdiction.html (Step 1 of the
 * COHO Analytics LIHTC workflow).
 *
 * ES5 IIFE — no build step required.
 * Depends on: workflow-state.js (optional), site-state.js (optional).
 */
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * 1. Inject page styles
   * ───────────────────────────────────────────────────────────────────────── */
  (function injectStyles() {
    var css = [
      /* Workflow progress bar */
      '.workflow-progress{max-width:640px;margin:0 auto;padding:24px 16px 8px;}',
      '.workflow-progress__steps{display:flex;align-items:flex-start;gap:0;counter-reset:step;}',
      '.wf-step{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;}',
      '.wf-step:not(:last-child)::after{content:"";position:absolute;top:16px;left:calc(50% + 16px);right:calc(-50% + 16px);height:2px;background:var(--border);z-index:0;}',
      '.wf-step__num{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;background:var(--bg2);color:var(--muted);border:2px solid var(--border);z-index:1;position:relative;}',
      '.wf-step__label{font-size:.7rem;color:var(--muted);margin-top:5px;line-height:1.2;}',
      '.wf-step--active .wf-step__num{background:var(--accent);color:#fff;border-color:var(--accent);}',
      '.wf-step--active .wf-step__label{color:var(--accent);font-weight:600;}',
      '.wf-step--done .wf-step__num{background:var(--good);color:#fff;border-color:var(--good);}',
      '.wf-step--done .wf-step__num::after{content:"✓";}',
      '.wf-step--done .wf-step__num span{display:none;}',

      /* Page header */
      '.sj-header{max-width:640px;margin:0 auto;padding:40px 16px 24px;text-align:center;}',
      '.sj-header h1{font-size:var(--h1);color:var(--text-strong);margin:0 0 12px;}',
      '.sj-lead{font-size:1.05rem;color:var(--muted);line-height:1.65;margin:0;}',

      /* Two-path layout */
      '.sj-paths{display:grid;grid-template-columns:1fr auto 1fr;gap:24px;max-width:960px;margin:0 auto;padding:0 16px 40px;align-items:start;}',

      /* Individual path cards */
      '.sj-path{padding:28px;border:1.5px solid var(--border);border-radius:var(--radius);background:var(--card);}',
      '.sj-path--primary{border-color:rgba(9,110,101,.25);}',
      '.sj-path__header{margin-bottom:20px;}',
      '.sj-path__header h2{font-size:var(--h2);color:var(--text-strong);margin:0 0 6px;}',
      '.sj-path__header p{font-size:var(--small);color:var(--muted);margin:0;line-height:1.5;}',

      /* Divider */
      '.sj-divider{display:flex;align-items:center;justify-content:center;padding-top:60px;}',
      '.sj-divider span{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:600;color:var(--muted);background:var(--bg2);border:1px solid var(--border);}',

      /* Form fields */
      '.sj-field-group{margin-bottom:20px;position:relative;}',
      '.sj-label{display:block;font-weight:600;font-size:var(--small);color:var(--text);margin-bottom:6px;}',
      '.sj-optional{font-weight:400;color:var(--muted);}',
      '.sj-search-wrap{position:relative;}',
      '.sj-input{width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.95rem;font-family:var(--font-sans);color:var(--text);background:var(--card);outline:none;transition:border-color .15s;}',
      '.sj-input:focus{border-color:var(--accent);box-shadow:var(--focus-ring);}',
      '.sj-hint{font-size:var(--tiny);color:var(--muted);margin:5px 0 0;}',

      /* Results dropdown — z-index 9100 clears the sticky header (z-index 9000) */
      '.sj-results{position:absolute;top:calc(100% + 4px);left:0;right:0;margin:0;padding:0;list-style:none;max-height:240px;overflow-y:auto;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--card);box-shadow:var(--shadow);z-index:9100;}',
      '.sj-results li{padding:10px 14px;cursor:pointer;font-size:.95rem;color:var(--text);border-bottom:1px solid var(--border);}',
      '.sj-results li:last-child{border-bottom:none;}',
      '.sj-results li:hover,.sj-results li[aria-selected="true"]{background:var(--accent-dim);color:var(--accent);}',
      '.sj-results li .sj-result-fips{font-size:var(--tiny);color:var(--muted);margin-left:8px;}',

      /* Selection badge */
      '.sj-selection{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:var(--radius-sm);background:var(--bg2);border:1.5px solid var(--border);margin-bottom:0;}',
      '.sj-selection__badge{flex:1;}',
      '.sj-selection__badge strong{display:block;font-size:.95rem;color:var(--text-strong);}',
      '.sj-selection__sub{font-size:var(--small);color:var(--muted);}',
      '.sj-selection__clear{background:none;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 14px;font-size:var(--small);color:var(--muted);cursor:pointer;font-family:var(--font-sans);transition:border-color .15s,color .15s;}',
      '.sj-selection__clear:hover{border-color:var(--accent);color:var(--accent);}',

      /* Actions */
      '.sj-actions{margin-top:24px;}',
      '.sj-actions__note{font-size:var(--tiny);color:var(--muted);margin:8px 0 0;}',

      /* Continue button */
      '.btn-primary.sj-continue{width:100%;padding:12px 20px;font-size:.95rem;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-family:var(--font-sans);transition:opacity .15s,background .15s;}',
      '.btn-primary.sj-continue:hover:not(:disabled){background:#07584f;}',
      '.btn-primary.sj-continue:disabled{background:var(--bg3);color:var(--muted);cursor:not-allowed;}',

      /* Explore links */
      '.sj-explore-links{display:flex;flex-direction:column;gap:0;}',
      '.sj-explore-link{display:flex;flex-direction:column;padding:14px 18px;border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:10px;text-decoration:none;color:var(--text);transition:border-color .15s,background .15s;}',
      '.sj-explore-link:last-child{margin-bottom:0;}',
      '.sj-explore-link:hover{border-color:var(--accent);background:var(--accent-dim);}',
      '.sj-explore-link__title{font-size:.9rem;font-weight:600;color:var(--text-strong);margin-bottom:3px;}',
      '.sj-explore-link:hover .sj-explore-link__title{color:var(--accent);}',
      '.sj-explore-link__desc{font-size:var(--small);color:var(--muted);line-height:1.4;}',

      /* Recent projects */
      '.sj-recent{max-width:960px;margin:0 auto;padding:32px 16px 48px;border-top:1px solid var(--border);}',
      '.sj-recent h3{font-size:var(--h2);color:var(--text-strong);margin:0 0 16px;}',
      '.sj-recent__list{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}',
      '.sj-recent-card{padding:18px 20px;border:1.5px solid var(--border);border-radius:var(--radius);background:var(--card);}',
      '.sj-recent-card__name{font-size:.9rem;font-weight:700;color:var(--text-strong);margin:0 0 4px;}',
      '.sj-recent-card__meta{font-size:var(--tiny);color:var(--muted);margin:0 0 12px;line-height:1.4;}',
      '.sj-recent-card__resume{display:inline-block;font-size:var(--small);font-weight:600;color:var(--accent);text-decoration:none;}',
      '.sj-recent-card__resume:hover{text-decoration:underline;}',

      /* Responsive */
      '@media(max-width:768px){',
      '.sj-paths{grid-template-columns:1fr;grid-template-rows:auto auto auto;}',
      '.sj-divider{padding-top:0;}',
      '.sj-recent__list{grid-template-columns:1fr;}',
      '}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'sj-injected-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }());

  /* ─────────────────────────────────────────────────────────────────────────
   * 2. Colorado counties data — all 64 counties with FIPS codes
   * ───────────────────────────────────────────────────────────────────────── */
  var CO_COUNTIES = [
    { name: 'Adams',       fips: '08001' },
    { name: 'Alamosa',     fips: '08003' },
    { name: 'Arapahoe',    fips: '08005' },
    { name: 'Archuleta',   fips: '08007' },
    { name: 'Baca',        fips: '08009' },
    { name: 'Bent',        fips: '08011' },
    { name: 'Boulder',     fips: '08013' },
    { name: 'Broomfield',  fips: '08014' },
    { name: 'Chaffee',     fips: '08015' },
    { name: 'Cheyenne',    fips: '08017' },
    { name: 'Clear Creek', fips: '08019' },
    { name: 'Conejos',     fips: '08021' },
    { name: 'Costilla',    fips: '08023' },
    { name: 'Crowley',     fips: '08025' },
    { name: 'Custer',      fips: '08027' },
    { name: 'Delta',       fips: '08029' },
    { name: 'Denver',      fips: '08031' },
    { name: 'Dolores',     fips: '08033' },
    { name: 'Douglas',     fips: '08035' },
    { name: 'Eagle',       fips: '08037' },
    { name: 'Elbert',      fips: '08039' },
    { name: 'El Paso',     fips: '08041' },
    { name: 'Fremont',     fips: '08043' },
    { name: 'Garfield',    fips: '08045' },
    { name: 'Gilpin',      fips: '08047' },
    { name: 'Grand',       fips: '08049' },
    { name: 'Gunnison',    fips: '08051' },
    { name: 'Hinsdale',    fips: '08053' },
    { name: 'Huerfano',    fips: '08055' },
    { name: 'Jackson',     fips: '08057' },
    { name: 'Jefferson',   fips: '08059' },
    { name: 'Kiowa',       fips: '08061' },
    { name: 'Kit Carson',  fips: '08063' },
    { name: 'Lake',        fips: '08065' },
    { name: 'La Plata',    fips: '08067' },
    { name: 'Larimer',     fips: '08069' },
    { name: 'Las Animas',  fips: '08071' },
    { name: 'Lincoln',     fips: '08073' },
    { name: 'Logan',       fips: '08075' },
    { name: 'Mesa',        fips: '08077' },
    { name: 'Mineral',     fips: '08079' },
    { name: 'Moffat',      fips: '08081' },
    { name: 'Montezuma',   fips: '08083' },
    { name: 'Montrose',    fips: '08085' },
    { name: 'Morgan',      fips: '08087' },
    { name: 'Otero',       fips: '08089' },
    { name: 'Ouray',       fips: '08091' },
    { name: 'Park',        fips: '08093' },
    { name: 'Phillips',    fips: '08095' },
    { name: 'Pitkin',      fips: '08097' },
    { name: 'Prowers',     fips: '08099' },
    { name: 'Pueblo',      fips: '08101' },
    { name: 'Rio Blanco',  fips: '08103' },
    { name: 'Rio Grande',  fips: '08105' },
    { name: 'Routt',       fips: '08107' },
    { name: 'Saguache',    fips: '08109' },
    { name: 'San Juan',    fips: '08111' },
    { name: 'San Miguel',  fips: '08113' },
    { name: 'Sedgwick',    fips: '08115' },
    { name: 'Summit',      fips: '08117' },
    { name: 'Teller',      fips: '08119' },
    { name: 'Washington',  fips: '08121' },
    { name: 'Weld',        fips: '08123' },
    { name: 'Yuma',        fips: '08125' }
  ];

  /* ─────────────────────────────────────────────────────────────────────────
   * 3. State
   * ───────────────────────────────────────────────────────────────────────── */
  var state = {
    selectedCounty:  null,   // { name, fips }
    selectedCity:    null,   // string or null
    countyFocusIdx:  -1,
    cityFocusIdx:    -1,
    geoConfig:       null,   // loaded from data/hna/geo-config.json
    citiesForCounty: [],     // incorporated places for the selected county
    allCdps:         []      // all CDPs (no county filter — containingCounty missing for most)
  };

  /* ─────────────────────────────────────────────────────────────────────────
   * 2b. Geo-config loader — populates city/CDP list per county
   * ───────────────────────────────────────────────────────────────────────── */

  function loadGeoConfig(callback) {
    if (state.geoConfig) {
      if (callback) callback(state.geoConfig);
      return;
    }
    var url = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl('data/hna/geo-config.json')
      : 'data/hna/geo-config.json';
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (cfg) {
          state.geoConfig = cfg;
          // Pre-cache all CDPs for text search (most CDPs lack containingCounty)
          state.allCdps = Array.isArray(cfg.cdps)
            ? cfg.cdps.map(function (c) { return { name: c.label, type: 'cdp' }; })
            : [];
        }
        if (callback) callback(cfg);
      })
      .catch(function () { if (callback) callback(null); });
  }

  function _buildCitiesForCounty(countyFips) {
    var cfg = state.geoConfig;
    if (!cfg) { state.citiesForCounty = []; return; }
    var list = [];
    // Incorporated places — filter by containingCounty (all places have this field)
    if (Array.isArray(cfg.places)) {
      cfg.places.forEach(function (p) {
        if (p.containingCounty === countyFips || p.county_fips === countyFips) {
          list.push({ name: p.label, type: 'place' });
        }
      });
    }
    // Note: CDPs mostly lack containingCounty in the data source.
    // They are searched globally via state.allCdps when the user types.
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    state.citiesForCounty = list;
  }

  function filterCities(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) {
      // No query — show up to 15 incorporated places for this county
      return state.citiesForCounty.slice(0, 15);
    }
    // With query — match places first, then CDPs from the full statewide list
    var results = [];
    var seen = {};
    state.citiesForCounty.forEach(function (c) {
      if (c.name.toLowerCase().indexOf(q) !== -1) {
        results.push(c);
        seen[c.name] = true;
      }
    });
    // Append matching CDPs (statewide search — most lack county info)
    if (results.length < 15) {
      state.allCdps.forEach(function (c) {
        if (!seen[c.name] && c.name.toLowerCase().indexOf(q) !== -1) {
          results.push(c);
          if (results.length >= 15) { return; }
        }
      });
    }
    return results.slice(0, 15);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 4. DOM references (populated in init)
   * ───────────────────────────────────────────────────────────────────────── */
  var el = {};

  /* ─────────────────────────────────────────────────────────────────────────
   * 5. Helpers
   * ───────────────────────────────────────────────────────────────────────── */

  function formatCountyName(name) {
    return name + ' County';
  }

  function filterCounties(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) { return CO_COUNTIES.slice(); }  // all 64 when empty
    var results = [];
    for (var i = 0; i < CO_COUNTIES.length; i++) {
      if (CO_COUNTIES[i].name.toLowerCase().indexOf(q) !== -1) {
        results.push(CO_COUNTIES[i]);
      }
    }
    return results;
  }

  function formatRelativeDate(isoString) {
    if (!isoString) { return ''; }
    var then;
    try { then = new Date(isoString).getTime(); } catch (e) { return ''; }
    var diffMs = Date.now() - then;
    if (diffMs < 0) { diffMs = 0; }
    var diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) { return 'Saved today'; }
    if (diffDays === 1) { return 'Saved yesterday'; }
    if (diffDays < 30)  { return 'Saved ' + diffDays + ' days ago'; }
    var diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) { return 'Saved 1 month ago'; }
    if (diffMonths < 12)  { return 'Saved ' + diffMonths + ' months ago'; }
    return 'Saved over a year ago';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 6. County dropdown rendering & keyboard nav
   * ───────────────────────────────────────────────────────────────────────── */

  function renderCountyResults(matches) {
    el.countyResults.innerHTML = '';
    if (!matches || matches.length === 0) {
      el.countyResults.hidden = true;
      el.countySearch.setAttribute('aria-expanded', 'false');
      return;
    }
    for (var i = 0; i < matches.length; i++) {
      (function (county, idx) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.setAttribute('data-idx', String(idx));
        var nameText = document.createTextNode(county.name + ' County');
        var fipsSpan = document.createElement('span');
        fipsSpan.className = 'sj-result-fips';
        fipsSpan.textContent = county.fips;
        li.appendChild(nameText);
        li.appendChild(fipsSpan);
        li.addEventListener('mousedown', function (e) {
          e.preventDefault(); // prevent input blur before click registers
          selectCounty(county);
        });
        el.countyResults.appendChild(li);
      }(matches[i], i));
    }
    state.countyFocusIdx = -1;
    el.countyResults.hidden = false;
    el.countySearch.setAttribute('aria-expanded', 'true');
  }

  function updateCountyFocus(idx) {
    var items = el.countyResults.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      items[i].setAttribute('aria-selected', String(i === idx));
    }
    state.countyFocusIdx = idx;
  }

  function hideCountyResults() {
    el.countyResults.hidden = true;
    el.countySearch.setAttribute('aria-expanded', 'false');
    state.countyFocusIdx = -1;
  }

  function selectCounty(county) {
    state.selectedCounty = county;
    state.selectedCity = null;

    // Update search input
    el.countySearch.value = formatCountyName(county.name);
    hideCountyResults();

    // Update hint
    el.countyHint.textContent = 'FIPS: ' + county.fips;

    // Show selection badge
    el.sjSelectionName.textContent = formatCountyName(county.name);
    el.sjSelectionSub.textContent = '';
    el.sjSelection.hidden = false;

    // Show city field
    el.cityFieldGroup.hidden = false;
    el.citySearch.value = '';
    el.citySearch.placeholder = 'Search cities in ' + county.name + ' County…';

    // Load geo-config and build city list for this county
    loadGeoConfig(function () {
      _buildCitiesForCounty(county.fips);
      // Show full list immediately so users see available options
      if (state.citiesForCounty.length > 0) {
        renderCityResults(filterCities('').map(function (c) { return c.name; }));
      }
    });

    // Enable continue button
    el.sjContinueBtn.disabled = false;
    el.sjActionNote.textContent = 'Ready to begin. You can optionally select a city above.';
  }

  function handleCountyKeydown(e) {
    var items = el.countyResults.querySelectorAll('li');
    var count = items.length;
    if (el.countyResults.hidden || count === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var matches = filterCounties(el.countySearch.value);
        renderCountyResults(matches);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateCountyFocus(Math.min(state.countyFocusIdx + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateCountyFocus(Math.max(state.countyFocusIdx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.countyFocusIdx >= 0 && items[state.countyFocusIdx]) {
        items[state.countyFocusIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    } else if (e.key === 'Escape') {
      hideCountyResults();
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 7. City dropdown (basic free-text with simple list stub)
   * ───────────────────────────────────────────────────────────────────────── */

  function hideCityResults() {
    el.cityResults.hidden = true;
    el.citySearch.setAttribute('aria-expanded', 'false');
    state.cityFocusIdx = -1;
  }

  function selectCity(cityName) {
    state.selectedCity = cityName || null;
    el.citySearch.value = cityName || '';
    hideCityResults();

    // Update selection badge subtitle
    if (state.selectedCounty) {
      el.sjSelectionName.textContent = formatCountyName(state.selectedCounty.name);
      el.sjSelectionSub.textContent = cityName ? cityName + ', CO' : '';
    }
  }

  function renderCityResults(items) {
    el.cityResults.innerHTML = '';
    if (!items || items.length === 0) {
      el.cityResults.hidden = true;
      el.citySearch.setAttribute('aria-expanded', 'false');
      return;
    }
    for (var i = 0; i < items.length; i++) {
      (function (cityName, idx) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = cityName;
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectCity(cityName);
        });
        el.cityResults.appendChild(li);
      }(items[i], i));
    }
    state.cityFocusIdx = -1;
    el.cityResults.hidden = false;
    el.citySearch.setAttribute('aria-expanded', 'true');
  }

  function handleCityKeydown(e) {
    var items = el.cityResults.querySelectorAll('li');
    var count = items.length;
    if (el.cityResults.hidden || count === 0) { return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var newIdx = Math.min(state.cityFocusIdx + 1, count - 1);
      for (var i = 0; i < items.length; i++) {
        items[i].setAttribute('aria-selected', String(i === newIdx));
      }
      state.cityFocusIdx = newIdx;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var newIdxUp = Math.max(state.cityFocusIdx - 1, 0);
      for (var j = 0; j < items.length; j++) {
        items[j].setAttribute('aria-selected', String(j === newIdxUp));
      }
      state.cityFocusIdx = newIdxUp;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.cityFocusIdx >= 0 && items[state.cityFocusIdx]) {
        items[state.cityFocusIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else {
        selectCity(el.citySearch.value.trim() || null);
      }
    } else if (e.key === 'Escape') {
      hideCityResults();
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 8. Reset / clear
   * ───────────────────────────────────────────────────────────────────────── */

  function resetSelection() {
    state.selectedCounty = null;
    state.selectedCity   = null;

    el.countySearch.value = '';
    el.citySearch.value = '';
    hideCountyResults();
    hideCityResults();

    el.cityFieldGroup.hidden = true;
    el.sjSelection.hidden = true;
    el.sjContinueBtn.disabled = true;
    el.sjActionNote.textContent = 'Select a county above to continue.';
    el.countyHint.textContent = 'All 64 Colorado counties';

    el.countySearch.focus();
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 9. Recent projects
   * ───────────────────────────────────────────────────────────────────────── */

  function loadRecentProjects() {
    if (!global.WorkflowState || typeof global.WorkflowState.listProjects !== 'function') {
      return;
    }
    var projects;
    try {
      projects = global.WorkflowState.listProjects();
    } catch (e) {
      return;
    }
    if (!projects || projects.length === 0) { return; }

    // Show up to 3 most-recently saved projects
    var sorted = projects.slice().sort(function (a, b) {
      var aTime = a.savedAt ? new Date(a.savedAt).getTime() : 0;
      var bTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
      return bTime - aTime;
    });
    var recent = sorted.slice(0, 3);

    el.sjRecentList.innerHTML = '';
    for (var i = 0; i < recent.length; i++) {
      (function (proj) {
        var card = document.createElement('div');
        card.className = 'sj-recent-card';

        var jurisdictionText = proj.jurisdictionName || 'Unknown jurisdiction';
        var savedText = formatRelativeDate(proj.savedAt);
        var stepsText = proj.completedSteps
          ? proj.completedSteps + ' step' + (proj.completedSteps === 1 ? '' : 's') + ' completed'
          : 'Not yet started';

        card.innerHTML =
          '<p class="sj-recent-card__name">' + _esc(jurisdictionText) + '</p>' +
          '<p class="sj-recent-card__meta">' + _esc(savedText) + ' &middot; ' + _esc(stepsText) + '</p>' +
          '<a class="sj-recent-card__resume" href="housing-needs-assessment.html" data-proj-id="' + _esc(proj.id) + '">Resume →</a>';

        // Clicking Resume activates this project first
        var resumeLink = card.querySelector('.sj-recent-card__resume');
        resumeLink.addEventListener('click', function (e) {
          var projId = this.getAttribute('data-proj-id');
          try {
            if (global.WorkflowState && typeof global.WorkflowState.loadProject === 'function') {
              global.WorkflowState.loadProject(projId);
            }
          } catch (err) {
            // non-fatal — navigation will still proceed
          }
        });

        el.sjRecentList.appendChild(card);
      }(recent[i]));
    }

    el.sjRecent.hidden = false;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 10. Restore pre-selected county from WorkflowState
   * ───────────────────────────────────────────────────────────────────────── */

  function restoreFromWorkflowState() {
    // #12: if arriving via ?new=1, start a fresh project instead of restoring
    try {
      var sp = new URLSearchParams(global.location.search);
      if (sp.get('new') === '1' && global.WorkflowState && global.WorkflowState.newProject) {
        global.WorkflowState.newProject('New Project');
        return;   // blank slate — don't pre-fill anything
      }
    } catch (_) {}

    if (!global.WorkflowState || typeof global.WorkflowState.getStep !== 'function') { return; }
    var step;
    try { step = global.WorkflowState.getStep('jurisdiction'); } catch (e) { return; }
    if (!step || !step.fips || !step.name) { return; }

    // Find matching county object
    var county = null;
    for (var i = 0; i < CO_COUNTIES.length; i++) {
      if (CO_COUNTIES[i].fips === step.fips) {
        county = CO_COUNTIES[i];
        break;
      }
    }
    if (!county) { return; }

    selectCounty(county);

    // Restore city if saved
    if (step.type === 'city' && step.displayName) {
      var cityName = step.displayName;
      el.citySearch.value = cityName;
      selectCity(cityName);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 11. Continue button handler
   * ───────────────────────────────────────────────────────────────────────── */

  function handleContinue() {
    if (!state.selectedCounty) { return; }

    var fips       = state.selectedCounty.fips;
    var countyName = formatCountyName(state.selectedCounty.name);
    var cityName   = (el.citySearch.value.trim()) || null;

    // Persist into WorkflowState (create project if none active)
    if (global.WorkflowState && typeof global.WorkflowState.setJurisdiction === 'function') {
      try {
        if (!global.WorkflowState.getActiveProject() && typeof global.WorkflowState.newProject === 'function') {
          global.WorkflowState.newProject(countyName + ' Analysis');
        }
        var payload = {
          fips: fips,
          name: countyName
        };
        if (cityName) {
          payload.type        = 'city';
          payload.displayName = cityName;
        } else {
          payload.type = 'county';
        }
        global.WorkflowState.setJurisdiction(payload);
      } catch (e) {
        console.warn('[jurisdiction-selector] WorkflowState.setJurisdiction failed:', e);
      }
    }

    // Also sync to SiteState directly (belt-and-suspenders)
    if (global.SiteState && typeof global.SiteState.setCounty === 'function') {
      try {
        global.SiteState.setCounty(fips, countyName);
      } catch (e) {
        console.warn('[jurisdiction-selector] SiteState.setCounty failed:', e);
      }
    }

    global.location.href = 'housing-needs-assessment.html';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 12. HTML escape helper
   * ───────────────────────────────────────────────────────────────────────── */

  function _esc(str) {
    if (str === null || str === undefined) { return ''; }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 13. init — wire up everything
   * ───────────────────────────────────────────────────────────────────────── */

  function init() {
    // Gather DOM refs
    el.countySearch    = document.getElementById('countySearch');
    el.countyResults   = document.getElementById('countyResults');
    el.countyHint      = document.getElementById('countyHint');
    el.cityFieldGroup  = document.getElementById('cityFieldGroup');
    el.citySearch      = document.getElementById('citySearch');
    el.cityResults     = document.getElementById('cityResults');
    el.sjSelection     = document.getElementById('sjSelection');
    el.sjSelectionName = document.getElementById('sjSelectionName');
    el.sjSelectionSub  = document.getElementById('sjSelectionSub');
    el.sjClearBtn      = document.getElementById('sjClearBtn');
    el.sjContinueBtn   = document.getElementById('sjContinueBtn');
    el.sjActionNote    = document.getElementById('sjActionNote');
    el.sjRecent        = document.getElementById('sjRecent');
    el.sjRecentList    = document.getElementById('sjRecentList');

    if (!el.countySearch) { return; } // not on the right page

    // County search — input handler
    el.countySearch.addEventListener('input', function () {
      var matches = filterCounties(this.value);
      renderCountyResults(matches);
      // If user clears the field after a county was selected, reset
      if (!this.value.trim() && state.selectedCounty) {
        resetSelection();
      }
    });

    el.countySearch.addEventListener('focus', function () {
      if (!state.selectedCounty) {
        var matches = filterCounties(this.value);
        renderCountyResults(matches);
      }
    });

    el.countySearch.addEventListener('blur', function () {
      // Delay so mousedown on result fires first
      setTimeout(hideCountyResults, 180);
    });

    el.countySearch.addEventListener('keydown', handleCountyKeydown);

    // City search handlers — filter against geo-config places/CDPs for the county
    el.citySearch.addEventListener('input', function () {
      var val = this.value.trim();
      state.selectedCity = val || null;
      if (state.selectedCounty) {
        el.sjSelectionSub.textContent = val ? val + ', CO' : '';
      }
      if (state.citiesForCounty.length > 0) {
        var matches = filterCities(val);
        renderCityResults(matches.map(function (c) { return c.name; }));
      } else {
        hideCityResults();
      }
    });

    el.citySearch.addEventListener('focus', function () {
      if (state.citiesForCounty.length > 0 && !state.selectedCity) {
        renderCityResults(filterCities('').map(function (c) { return c.name; }));
      }
    });

    el.citySearch.addEventListener('keydown', handleCityKeydown);

    el.citySearch.addEventListener('blur', function () {
      setTimeout(hideCityResults, 180);
    });

    // Clear / change button
    el.sjClearBtn.addEventListener('click', resetSelection);

    // Continue button
    el.sjContinueBtn.addEventListener('click', handleContinue);

    // Close dropdowns on outside click
    document.addEventListener('click', function (e) {
      if (!el.countySearch.contains(e.target) && !el.countyResults.contains(e.target)) {
        hideCountyResults();
      }
      if (!el.citySearch.contains(e.target) && !el.cityResults.contains(e.target)) {
        hideCityResults();
      }
    });

    // Restore any existing state
    restoreFromWorkflowState();

    // Load recent projects panel
    loadRecentProjects();
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 14. Bootstrap
   * ───────────────────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window));
