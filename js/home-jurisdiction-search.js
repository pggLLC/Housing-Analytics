/**
 * js/home-jurisdiction-search.js — B-06 / #1097
 *
 * Inline jurisdiction/place autocomplete for the homepage hero. Lets a
 * visitor search all 546 registry geographies (64 counties, 272 places,
 * 210 CDPs) from the first screen and jump straight to the matched
 * profile, instead of navigating to select-jurisdiction.html first.
 *
 * Routing: every match goes to the interactive profile
 * (housing-needs-assessment.html?geoid=…&geoType=…&auto=1 — the same
 * destination the select-jurisdiction flow ends at, and the ic-summary
 * deep-link convention). Static places/<geoid>.html pages are still the
 * browse-profile surface for the 482 place/CDP entries; uniform HNA routing
 * keeps the search action consistent with the full select-jurisdiction flow.
 *
 * The registry (~130 KB) is fetched lazily on first focus so the
 * homepage's initial load is unaffected.
 *
 * Matching + routing are pure functions with a dual-context export so
 * test/home-jurisdiction-search.test.js exercises the real code in Node
 * (no reimplemented copies — see #1152/#1120 for why that matters).
 */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HomeJurisdictionSearch = api;
  }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var TYPE_LABELS = { county: 'County', place: 'City/Town', cdp: 'CDP' };
  var MAX_RESULTS = 8;

  /**
   * Rank-and-filter registry entries for a query.
   * Prefix matches rank before mid-word matches; ties break by name
   * length (shorter = more exact) then alphabetically. Case-insensitive.
   *
   * @param {Array<{geoid:string,name:string,type:string}>} entries
   * @param {string} query
   * @param {number} [limit]
   * @returns {Array} matched entries, best first
   */
  function searchJurisdictions(entries, query, limit) {
    if (!Array.isArray(entries)) return [];
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var max = limit || MAX_RESULTS;

    var scored = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var name = e && e.name ? String(e.name).toLowerCase() : '';
      if (!name) continue;
      var idx = name.indexOf(q);
      if (idx === -1) continue;
      scored.push({ entry: e, prefix: idx === 0 ? 0 : 1, len: name.length });
    }
    scored.sort(function (a, b) {
      if (a.prefix !== b.prefix) return a.prefix - b.prefix;
      if (a.len !== b.len) return a.len - b.len;
      return a.entry.name < b.entry.name ? -1 : 1;
    });
    return scored.slice(0, max).map(function (s) { return s.entry; });
  }

  /**
   * Profile URL for a registry entry (relative to site root).
   * @param {{geoid:string,type:string}} entry
   * @returns {string|null}
   */
  function jurisdictionUrl(entry) {
    if (!entry || !entry.geoid || !entry.type) return null;
    return 'housing-needs-assessment.html?geoid=' + encodeURIComponent(entry.geoid) +
           '&geoType=' + encodeURIComponent(entry.type) + '&auto=1';
  }

  /* ── Answer card (2026-10-14 persona walk) ─────────────────────────
   * A town search used to drop every visitor onto the full Needs
   * Assessment, 100+ phone screens long. The card answers first: a few
   * plain facts read from that town's metrics digest (the same file the
   * report's numbers come from), then next steps for the door the visitor
   * picked. A fact the digest cannot support is left out, never shown as 0.
   */

  // Practitioners first, one door each; the keys stay stable so shared ?door= links keep working.
  var DOORS = {
    council: 'I work for a town or county',
    build: 'I develop housing',
    operate: 'I run a housing authority or nonprofit',
    fund: 'I fund, lend or invest',
    analyze: 'I research or report on housing',
    rent: 'I need a place to live'
  };

  function digestUrl(geoid) {
    return 'data/hna/jurisdiction-metrics-digest/' + encodeURIComponent(geoid) + '.json';
  }

  function usable(m, money) {
    if (!m || m.value === null || m.value === undefined || m.value === '') return false;
    if (m.denominator_floor_applied) return false;
    var v = Number(m.value);
    if (!isFinite(v)) return false;
    return money ? v > 0 : v >= 0;
  }

  function dollars(v) {
    return '$' + Math.round(Number(v)).toLocaleString('en-US');
  }

  // ACS publishes a top-coded median as the cap plus one dollar: 3501 means
  // "$3,500 or more", never a measured $3,501.
  var ACS_TOP_CODES = { gross_rent_median: 3501, median_hh_income: 250001, median_home_value: 2000001 };

  function money(key, m) {
    var v = Number(m.value);
    if (/^acs/.test(m.source_id || '') && ACS_TOP_CODES[key] === v) return dollars(v - 1) + ' or more';
    return dollars(v);
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function sourceLabel(m) {
    var asOf = String(m.as_of || '');
    var date = /^(\d{4})-(\d{2})-\d{2}$/.exec(asOf);
    var when = date ? MONTHS[Number(date[2]) - 1] + ' ' + date[1] : asOf;
    if (m.source_id === 'zillow-zhvi-county-adjusted') return 'county-adjusted Zillow/ACS estimate, ' + when;
    if (m.source_id === 'zillow-zhvi-city-index') return 'Zillow home value index, ' + when;
    if (/chas/i.test(m.source_id || '')) return when || 'HUD CHAS';
    return when ? 'Census ' + when : 'Census ACS';
  }

  function caveat(m) {
    var notes = [];
    if (m.geography_level === 'county_context') notes.push('county figure');
    if (m.source_id === 'zillow-zhvi-county-adjusted') notes.push('estimated from the county trend');
    if (m.confidence === 'low') notes.push('small sample, treat as rough');
    return notes.length ? ' (' + notes.join('; ') + ')' : '';
  }

  /**
   * Plain-language facts for one jurisdiction's digest.
   * @param {object} digest  data/hna/jurisdiction-metrics-digest/<geoid>.json
   * @returns {Array<{key:string,label:string,value:string,note:string,source:string}>}
   */
  function answerFacts(digest) {
    var m = digest && digest.metrics ? digest.metrics : {};
    var facts = [];
    var cb = m.pct_cost_burdened;
    if (usable(cb, false)) {
      facts.push({ key: 'pct_cost_burdened', label: 'Renters stretched by rent',
        value: Math.round(Number(cb.value)) + '%',
        note: 'of renter households pay 30% or more of their income on rent and utilities' + caveat(cb),
        source: sourceLabel(cb) });
    }
    var rent = m.gross_rent_median;
    if (usable(rent, true)) {
      facts.push({ key: 'gross_rent_median', label: 'Typical rent',
        value: money('gross_rent_median', rent) + ' a month',
        note: 'median rent including utilities' + caveat(rent), source: sourceLabel(rent) });
    }
    var inc = m.median_hh_income;
    if (usable(inc, true)) {
      facts.push({ key: 'median_hh_income', label: 'Typical household income',
        value: money('median_hh_income', inc) + ' a year',
        note: 'median for all households, renters and owners' + caveat(inc), source: sourceLabel(inc) });
    }
    var home = m.median_home_value;
    if (usable(home, true)) {
      facts.push({ key: 'median_home_value', label: 'Typical home value',
        value: money('median_home_value', home),
        note: 'typical value of a home here' + caveat(home), source: sourceLabel(home) });
    }
    return facts;
  }

  /**
   * Next steps for a door, for one jurisdiction. Every href is either a page
   * in this repo or an https link; test/home-answer-card.test.js checks both.
   * @param {string} door  a DOORS key, or anything else for the default
   * @param {{geoid:string,type:string}} entry
   */
  function doorLinks(door, entry) {
    var report = { label: 'Open the full Housing Needs Assessment', href: jurisdictionUrl(entry) };
    var isPlace = entry && /^08\d{5}$/.test(entry.geoid || '');
    var profile = isPlace ? { label: 'Short local profile', href: 'places/' + entry.geoid + '.html' } : null;
    var compare = { label: 'Compare with other Colorado places', href: 'hna-comparative-analysis.html' };
    var links;
    if (door === 'rent') {
      links = [
        { label: 'Free housing help line: Colorado Housing Connects, 1-844-926-6632', href: 'https://coloradohousingconnects.org/', external: true },
        { label: 'Search income-restricted rentals: ColoradoHousingSearch.com', href: 'https://www.coloradohousingsearch.com/', external: true },
        { label: 'Thinking about buying? Help for homebuyers', href: 'help-for-homebuyers.html' }
      ];
    } else if (door === 'council') {
      links = [report, compare, { label: 'What other Colorado towns offer builders', href: 'local-incentives.html' }];
    } else if (door === 'build') {
      links = [
        { label: 'Where tax-credit housing scores well: Opportunity Finder', href: 'lihtc-opportunity-finder.html' },
        { label: 'Test a project: Deal Calculator', href: 'deal-calculator.html' + (isPlace ? '?geoid=' + entry.geoid : '') },
        { label: 'Funding programs that fit', href: 'colorado-deep-dive.html#tab-funding' },
        report
      ];
    } else if (door === 'operate') {
      links = [
        { label: 'What a housing authority can do', href: 'housing-authority-guide.html' },
        { label: 'Homes at risk of losing affordability: Preservation', href: 'preservation.html' },
        { label: 'Resident services', href: 'resident-services.html' },
        report
      ];
    } else if (door === 'fund') {
      links = [
        { label: 'Where housing money goes', href: 'where-housing-money-goes.html' },
        { label: 'Colorado tax credit awards by year', href: 'colorado-deep-dive.html#tab-history' },
        { label: 'Funded deals, one page each', href: 'deal-summary.html' },
        report
      ];
    } else if (door === 'analyze') {
      links = [report, compare,
        { label: 'Every number for this place (JSON)', href: digestUrl(entry.geoid) },
        { label: 'Sources and how we check them', href: 'data-review-hub.html' }];
    } else {
      links = [report];
    }
    if (profile && door !== 'analyze' && door !== 'build') links.push(profile);
    return links.filter(function (l) { return l && l.href; });
  }

  /* ── Browser bootstrap (combobox wiring) ─────────────────────────── */

  function initBrowser() {
    var input = document.getElementById('homeJurisdictionSearch');
    var listbox = document.getElementById('homeJurisdictionSearchResults');
    if (!input || !listbox) return;

    var entries = null;
    var loading = false;
    var results = [];
    var activeIndex = -1;

    function loadRegistry() {
      if (entries || loading) return;
      loading = true;
      fetch('data/hna/geography-registry.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          entries = Array.isArray(data) ? data
            : (data && data.geographies) ? data.geographies : [];
          loading = false;
          if (input.value) render(input.value);
        })
        .catch(function () { loading = false; });
    }

    function close() {
      listbox.hidden = true;
      listbox.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      results = [];
      activeIndex = -1;
    }

    var card = document.getElementById('homeAnswerCard');
    var doorButtons = document.querySelectorAll('[data-home-door]');
    var door = null;
    var current = null;
    var lastDigest;

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }

    function syncUrl() {
      if (!window.history || !window.history.replaceState) return;
      var params = new URLSearchParams(window.location.search);
      if (current) params.set('town', current.geoid); else params.delete('town');
      if (door) params.set('door', door); else params.delete('door');
      var q = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    }

    function renderLinks(target) {
      var list = el('ul', 'home-answer__links');
      doorLinks(door, current).forEach(function (l) {
        var li = el('li');
        var a = el('a', null, l.label);
        a.href = l.href;
        if (l.external) { a.target = '_blank'; a.rel = 'noopener'; }
        li.appendChild(a);
        list.appendChild(li);
      });
      target.appendChild(list);
    }

    function renderCard(entry, digest) {
      card.innerHTML = '';
      card.appendChild(el('h2', 'home-answer__title', entry.name));
      var facts = digest ? answerFacts(digest) : [];
      if (facts.length) {
        var dl = el('dl', 'home-answer__facts');
        var sources = [];
        facts.forEach(function (f) {
          var row = el('div', 'home-answer__fact');
          row.appendChild(el('dt', null, f.label));
          var dd = el('dd');
          dd.appendChild(el('strong', null, f.value));
          dd.appendChild(document.createTextNode(' ' + f.note));
          row.appendChild(dd);
          dl.appendChild(row);
          if (sources.indexOf(f.source) === -1) sources.push(f.source);
        });
        card.appendChild(dl);
        card.appendChild(el('p', 'home-answer__source', 'Sources: ' + sources.join('; ') + '.'));
      } else {
        card.appendChild(el('p', 'home-answer__empty',
          'Public surveys have too few households here to give reliable local numbers. The full report shows the county picture.'));
      }
      card.appendChild(el('p', 'home-answer__next', door ? 'Next steps for you' : 'Next steps (pick what brings you here above to tailor these)'));
      renderLinks(card);
      card.hidden = false;
    }

    function showAnswer(entry) {
      if (!card) {
        var url = jurisdictionUrl(entry);
        if (url) window.location.href = url;
        return;
      }
      current = entry;
      lastDigest = undefined;
      input.value = entry.name;
      close();
      syncUrl();
      card.hidden = false;
      card.innerHTML = '';
      card.appendChild(el('p', 'home-answer__loading', 'Loading ' + entry.name + '…'));
      fetch(digestUrl(entry.geoid))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { if (current === entry) { lastDigest = d; renderCard(entry, d); } })
        .catch(function () { if (current === entry) { lastDigest = null; renderCard(entry, null); } });
    }

    function setDoor(key) {
      door = DOORS[key] ? key : null;
      for (var k = 0; k < doorButtons.length; k++) {
        doorButtons[k].setAttribute('aria-pressed', doorButtons[k].getAttribute('data-home-door') === door ? 'true' : 'false');
      }
    }

    for (var b = 0; b < doorButtons.length; b++) {
      doorButtons[b].addEventListener('click', function () {
        var key = this.getAttribute('data-home-door');
        setDoor(door === key ? null : key);
        syncUrl();
        if (current && lastDigest !== undefined) renderCard(current, lastDigest);
        else input.focus();
      });
    }

    function go(entry) { showAnswer(entry); }

    function setActive(i) {
      activeIndex = i;
      var opts = listbox.querySelectorAll('[role="option"]');
      for (var k = 0; k < opts.length; k++) {
        var on = k === i;
        opts[k].setAttribute('aria-selected', on ? 'true' : 'false');
        opts[k].style.background = on ? 'var(--bg2, #eef4f3)' : 'transparent';
      }
      if (i >= 0 && opts[i]) {
        input.setAttribute('aria-activedescendant', opts[i].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function render(query) {
      if (!entries) { loadRegistry(); return; }
      results = searchJurisdictions(entries, query);
      if (!results.length) { close(); return; }
      listbox.innerHTML = '';
      for (var i = 0; i < results.length; i++) {
        (function (i) {
          var e = results[i];
          var li = document.createElement('li');
          li.id = 'homeJurisdictionOpt' + i;
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.style.cssText = 'padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;';
          var name = document.createElement('span');
          name.textContent = e.name;
          var type = document.createElement('span');
          type.textContent = TYPE_LABELS[e.type] || e.type;
          type.style.cssText = 'color:var(--muted,#777);font-size:.85em;white-space:nowrap;';
          li.appendChild(name);
          li.appendChild(type);
          // mousedown (not click) so it fires before the input's blur closes the list
          li.addEventListener('mousedown', function (ev) { ev.preventDefault(); go(e); });
          li.addEventListener('mousemove', function () { setActive(i); });
          listbox.appendChild(li);
        }(i));
      }
      listbox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }

    // Shared links: ?town=<geoid>&door=<key> reopens the same card.
    (function restore() {
      var params = new URLSearchParams(window.location.search);
      var d = params.get('door');
      if (DOORS[d]) setDoor(d);
      var town = params.get('town');
      if (!card || !/^08\d{3}(\d{2})?$/.test(town || '')) return;
      fetch('data/hna/geography-registry.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          entries = Array.isArray(data) ? data : (data && data.geographies) ? data.geographies : [];
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].geoid === town) { showAnswer(entries[i]); return; }
          }
        })
        .catch(function () {});
    }());

    input.addEventListener('focus', loadRegistry);
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    input.addEventListener('keydown', function (ev) {
      if (listbox.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        render(input.value);
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (results.length) setActive((activeIndex + 1) % results.length);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (results.length) setActive((activeIndex - 1 + results.length) % results.length);
      } else if (ev.key === 'Enter') {
        if (activeIndex >= 0 && results[activeIndex]) {
          ev.preventDefault();
          go(results[activeIndex]);
        } else if (results.length === 1) {
          ev.preventDefault();
          go(results[0]);
        }
      } else if (ev.key === 'Escape') {
        close();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initBrowser);
    } else {
      initBrowser();
    }
  }

  return {
    MAX_RESULTS: MAX_RESULTS,
    TYPE_LABELS: TYPE_LABELS,
    DOORS: DOORS,
    searchJurisdictions: searchJurisdictions,
    jurisdictionUrl: jurisdictionUrl,
    digestUrl: digestUrl,
    answerFacts: answerFacts,
    doorLinks: doorLinks
  };
}));
