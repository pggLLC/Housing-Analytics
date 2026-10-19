/**
 * js/components/cra-coverage-map.js
 *
 * The bank and CRA coverage map on affordable-deal-team.html.
 *
 * Two readings, matching the page's two cards:
 *   - Conservative: counties shaded by how many banks have a branch there
 *     (FDIC Summary of Deposits). A branch county is a screen for the bank's
 *     assessment area, not the area itself; the panel says so.
 *   - Expansive: every bank with a Colorado branch has a Colorado assessment
 *     area. A large bank may count an investment anywhere in the state under
 *     the "broader statewide or regional area" text of 12 CFR 228.23(a); an
 *     intermediate small bank may too, under the agencies' Q&A 12(h)-6 (its
 *     own test's rule text names no area). Both only if the bank has served
 *     its own areas first. The map is one shade and
 *     the panel lists those banks for the chosen county.
 *
 * Pick a county by clicking it or from the list under the map (the list is
 * the keyboard and screen-reader route). Data: data/cra/co-bank-branches.json,
 * built by scripts/cra/fetch_fdic_branches_co.py.
 */
(function () {
  'use strict';

  var BOUNDARIES_PATH = 'data/co-county-boundaries.json';
  var BANKS_PATH = 'data/cra/co-bank-branches.json';

  // Literal hex for Leaflet path styles (see home-need-map.js); the legend
  // swatches are built from this same list.
  var BINS = [
    { min: 11, color: '#08306b', label: '11 or more banks' },
    { min: 6, color: '#2171b5', label: '6 to 10' },
    { min: 3, color: '#6baed6', label: '3 to 5' },
    { min: 1, color: '#c6dbef', label: '1 or 2' },
    { min: 0, color: '#f1f1f1', label: 'No bank branch' },
  ];
  var EXPANSIVE_COLOR = '#6baed6';
  var OFFICE_COLOR = '#d94801'; // orange, apart from the blue county shades
  var OFFICE_RING = '#111';
  var BANK_COUNTY_COLOR = '#2171b5'; // a branch county of the one bank picked
  var CONS_LABEL = 'Map of Colorado counties shaded by the number of banks with a branch in each, with a dot at each branch office. Choose a county from the list below the map for the same information.';
  var EXP_LABEL = 'Map of Colorado with every county shaded the same, with a dot at each branch office: under the expansive reading, a large or intermediate small bank with a Colorado branch may get credit in any county. Choose a county from the list below the map for the banks.';

  var SIZE_LABEL = {
    large: 'Large (investment test)',
    intermediate: 'Intermediate small (community development test)',
    small: 'Small (lending test only)',
  };
  var REG_LABEL = { OCC: 'OCC', FDIC: 'FDIC', FED: 'Federal Reserve' };

  function binFor(n) {
    for (var i = 0; i < BINS.length; i++) if (n >= BINS[i].min) return BINS[i];
    return BINS[BINS.length - 1];
  }

  function fetcher(path) {
    if (typeof window.safeFetchJSON === 'function') return window.safeFetchJSON(path);
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(k) {
    if (k === null || k === undefined) return 'Not reported';
    var d = k * 1000;
    if (d >= 1e9) return '$' + (d / 1e9).toFixed(1) + 'B';
    if (d >= 1e6) return '$' + Math.round(d / 1e6) + 'M';
    if (d > 0) return '$' + Math.round(d / 1e3) + 'K';
    return '$0';
  }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return months[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  // Long lists show the first rows and a button for the rest, so a phone
  // reader is not handed sixty stacked cards at once.
  var FIRST_ROWS = 10;
  function rowsHtml(certs, rowFn) {
    return certs.map(function (c, i) {
      var html = rowFn(c);
      return i < FIRST_ROWS ? html : html.replace('<tr>', '<tr class="cra-map__more" hidden>');
    }).join('');
  }
  function moreButton(n) {
    return n > FIRST_ROWS ? '<button type="button" class="cra-map__showall">Show all ' + n + ' banks</button>' : '';
  }

  function bankLink(cert, name) {
    return '<a href="https://banks.data.fdic.gov/bankfind-suite/bankfind/details/' +
      encodeURIComponent(cert) + '" rel="noopener">' + esc(name) + '</a>';
  }

  function init() {
    var root = document.getElementById('craMap');
    if (!root || !window.L) return;
    var mount = root.querySelector('.cra-map__canvas');
    var status = root.querySelector('.cra-map__status');
    var panel = root.querySelector('.cra-map__panel');
    var select = root.querySelector('#craCounty');
    var legend = root.querySelector('.cra-map__legend');
    var modeBtns = root.querySelectorAll('[data-cra-mode]');
    var asOf = root.querySelector('[data-cra-asof]');

    Promise.all([fetcher(BOUNDARIES_PATH), fetcher(BANKS_PATH)]).then(function (res) {
      var boundaries = res[0], data = res[1];
      if (!boundaries || !boundaries.features || !data || !data.banks) {
        panel.innerHTML = '<p>The bank map could not load. The FDIC Summary of Deposits link above has the same branch list.</p>';
        mount.style.display = 'none';
        return;
      }
      var mode = 'conservative';
      var selected = null;
      var focusBank = null; // cert of the one bank shown, or null for all
      var banks = data.banks;
      var counties = data.counties || {};
      var names = {};
      boundaries.features.forEach(function (f) { names[f.properties.GEOID] = f.properties.NAMELSAD; });
      if (asOf && data.meta) {
        asOf.textContent = 'Branches as of ' + longDate(data.meta.sod_as_of) + '; ' + data.meta.bank_count +
          ' banks, ' + data.meta.branch_count + ' Colorado offices.';
      }

      function countIn(geoid) {
        var c = counties[geoid];
        return c ? Object.keys(c.banks).length : 0;
      }
      function bankIn(cert, geoid) {
        return !!(counties[geoid] && counties[geoid].banks[cert]);
      }

      var map = window.L.map(mount, {
        zoomControl: false, attributionControl: false, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false,
        center: [39.0, -105.5], zoom: 6, zoomSnap: 0.1,
      });

      function style(feature) {
        var g = feature.properties.GEOID;
        var fill = focusBank ? (bankIn(focusBank, g) ? BANK_COUNTY_COLOR : BINS[BINS.length - 1].color)
          : mode === 'conservative' ? binFor(countIn(g)).color : EXPANSIVE_COLOR;
        return {
          color: g === selected ? '#111' : '#fff',
          weight: g === selected ? 3 : 1,
          fillColor: fill,
          fillOpacity: 0.85,
        };
      }

      // Counties and branch dots share Leaflet's one SVG layer: dots, added
      // later, draw on top, and a click off a dot still reaches the county.
      // (Not canvas: the site's global canvas width rule distorts it.)
      var layer = window.L.geoJSON(boundaries, {
        style: style,
        onEachFeature: function (feature, fl) {
          var g = feature.properties.GEOID;
          function countyTip() {
            if (focusBank) {
              var here = counties[g] && counties[g].banks[focusBank];
              return esc(names[g]) + ': ' + (here ? here.branches + (here.branches === 1 ? ' branch' : ' branches')
                : 'no branch') + ' of ' + esc(banks[focusBank].name);
            }
            var n = countIn(g);
            return esc(names[g]) + ': ' + n + (n === 1 ? ' bank' : ' banks') + ' with a branch';
          }
          fl.bindTooltip(countyTip, { sticky: true });
          // With a mouse, the one tooltip names the branch under the pointer
          // when there is one, and the county otherwise.
          fl.on('mousemove', function (e) {
            var d = nearestOffice(e.containerPoint, 6);
            fl.setTooltipContent(d ? esc(banks[d.o[0]].name) + '<br>' + esc(d.o[3]) + ', ' + esc(d.o[4]) : countyTip());
          });
          fl.on('click', function (e) {
            if (openNearestOffice(e.containerPoint)) return;
            choose(g);
          });
          fl.on('add', function () {
            var el = fl.getElement && fl.getElement();
            if (el) el.style.cursor = 'pointer';
          });
        },
      }).addTo(map);
      // One dot per branch office. The dots themselves take no clicks: a tap
      // within hitPx() of a dot opens the nearest one, which gives each dot a
      // 44px target without covering the counties. The county panel lists the
      // same addresses for keyboard and screen-reader users.
      // 44px target for fingers; a mouse is precise, so it gets a small one
      // and a click between dots still picks the county. Read per tap, since
      // a touchscreen laptop has both.
      var lastPointer = '';
      mount.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || ''; }, true);
      function hitPx() {
        if (lastPointer) return lastPointer === 'mouse' ? 6 : 22;
        return window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches ? 22 : 6;
      }
      var OVERLAP_PX = 4, MAX_POP = 6;
      var officeLayer = window.L.layerGroup();
      var officeDots = [];
      (data.offices || []).forEach(function (o) {
        if (banks[o[0]]) officeDots.push({ o: o, ll: window.L.latLng(o[1], o[2]) });
      });
      var shownDots = officeDots;
      // No one edge color stands out on every county shade, so each dot gets
      // a white ring inside a dark one: the white clears 3:1 on the darker
      // blues, the dark on the lighter ones. All dark rings go first so none
      // covers a neighbor's dot.
      function drawOffices() {
        officeLayer.clearLayers();
        shownDots = focusBank ? officeDots.filter(function (d) { return d.o[0] === focusBank; }) : officeDots;
        shownDots.forEach(function (d) {
          window.L.circleMarker(d.ll, {
            radius: 5, stroke: false, interactive: false, fillColor: OFFICE_RING, fillOpacity: 1,
          }).addTo(officeLayer);
        });
        shownDots.forEach(function (d) {
          window.L.circleMarker(d.ll, {
            radius: 3, weight: 1.5, color: '#fff', opacity: 1, interactive: false,
            fillColor: OFFICE_COLOR, fillOpacity: 1,
          }).addTo(officeLayer);
        });
      }
      drawOffices();

      // list: every office under the tapped dot; g: the tapped office's county.
      function officePopup(list, g) {
        function button(c, many) {
          return names[c] ? '<br><button type="button" class="cra-map__popcounty" data-g="' + esc(c) +
            '"' + (many ? ' data-open="1">List the branches in ' : '>All banks in ') +
            esc(names[c]) + '</button>' : '';
        }
        var county = button(g, false);
        // A city center at statewide scale is dozens of dots in one spot, too
        // many for a popup; the county address lists have them all, so offer
        // one for each county in the cluster, the tapped one first.
        if (list.length > MAX_POP) {
          var gs = [g];
          list.forEach(function (o) { if (gs.indexOf(o[6]) < 0) gs.push(o[6]); });
          return '<strong>' + list.length + ' branches are too close together to pick one at this scale.</strong>' +
            gs.map(function (c) { return button(c, true); }).join('');
        }
        return (list.length > 1 ? '<strong>' + list.length + ' branches at this spot</strong><hr>' : '') + list.map(function (o) {
          var b = banks[o[0]];
          return '<strong>' + bankLink(o[0], b.name) + '</strong><br>' +
            esc(o[3]) + '<br>' + esc(o[4]) + ', CO ' + esc(o[5]) + '<br>' +
            'CRA size: ' + esc(SIZE_LABEL[b.cra_size] || 'Unknown') +
            (focusBank ? '' : '<br><button type="button" class="cra-map__popcounty" data-bank="' + esc(o[0]) +
              '">Show only this bank</button>');
        }).join('<hr>') +
          // The tap that opened this may have been meant for the county, which
          // dots crowd on a phone, so offer the county too.
          county;
      }

      mount.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.cra-map__popcounty');
        if (!btn) return;
        map.closePopup();
        if (btn.getAttribute('data-bank')) {
          chooseBank(btn.getAttribute('data-bank'));
          bankSelect.scrollIntoView({ block: 'nearest' });
          return;
        }
        // "All banks in X" means the banks with a branch there, which is the
        // conservative view; the expansive one lists the others.
        var cons = root.querySelector('[data-cra-mode="conservative"]');
        if (mode !== 'conservative' && cons) cons.click();
        choose(btn.getAttribute('data-g'));
        var list = btn.getAttribute('data-open') && panel.querySelector('.cra-map__addresses');
        if (list) list.open = true;
        (list || panel).scrollIntoView({ block: 'nearest' });
      });

      function nearestOffice(pt, px) {
        if (!pt || !map.hasLayer(officeLayer)) return null;
        var best = null, bestD = px;
        shownDots.forEach(function (d) {
          var dist = map.latLngToContainerPoint(d.ll).distanceTo(pt);
          if (dist <= bestD) { bestD = dist; best = d; }
        });
        return best;
      }

      function openNearestOffice(pt) {
        var best = nearestOffice(pt, hitPx());
        if (!best) return false;
        // Dots drawn on top of one another (a shared building, or a dense
        // downtown at statewide scale) are one dot to the eye, so the popup
        // lists every office under it. Some banks report two offices (say, a
        // lobby and a drive-up) at one address; name each once.
        var at = map.latLngToContainerPoint(best.ll);
        var seen = {};
        var here = shownDots.filter(function (d) {
          var k = d.o[0] + '|' + d.o[3];
          if (seen[k] || map.latLngToContainerPoint(d.ll).distanceTo(at) > OVERLAP_PX) return false;
          seen[k] = true;
          return true;
        }).map(function (d) { return d.o; });
        window.L.popup({ maxHeight: 200 }).setLatLng(best.ll).setContent(officePopup(here, best.o[6])).openOn(map);
        return true;
      }
      var showOffices = root.querySelector('#craOffices');
      if (data.offices && data.offices.length) {
        officeLayer.addTo(map);
        if (showOffices) {
          showOffices.addEventListener('change', function () {
            if (showOffices.checked) officeLayer.addTo(map); else map.removeLayer(officeLayer);
            drawLegend();
          });
        }
      } else if (showOffices) {
        showOffices.closest('label').hidden = true;
      }

      var bounds = layer.getBounds();
      // On touch screens, leave a finger's reach (the 22px hit radius) around
      // the state so border dots keep their whole target inside the map.
      var FIT_PAD = window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches ? [22, 22] : [4, 4];
      map.fitBounds(bounds, { padding: FIT_PAD });
      // A tap just outside the state line can still be meant for a border
      // dot, so an invisible frame around the counties catches those taps.
      window.L.rectangle(bounds.pad(0.1), { stroke: false, fillOpacity: 0, className: 'cra-map__frame' })
        .on('click', function (e) { openNearestOffice(e.containerPoint); })
        .addTo(map).bringToBack();
      var t = null;
      window.addEventListener('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () { map.invalidateSize(); map.fitBounds(bounds, { padding: FIT_PAD }); }, 150);
      });
      // A popup near the edge pans the map to fit; the map can't be dragged
      // back, so put the whole state back in view when the popup closes.
      map.on('popupclose', function () { map.fitBounds(bounds, { padding: FIT_PAD, animate: false }); });

      Object.keys(names).sort(function (a, b) { return names[a].localeCompare(names[b]); }).forEach(function (g) {
        var o = document.createElement('option');
        o.value = g;
        o.textContent = names[g];
        select.appendChild(o);
      });
      select.addEventListener('change', function () { choose(select.value || null); });

      // One bank at a time: its dots only, and its branch counties shaded.
      var bankSelect = root.querySelector('#craBank');
      Object.keys(banks).sort(function (a, b) { return banks[a].name.localeCompare(banks[b].name); }).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c;
        o.textContent = banks[c].name + ' (' + banks[c].co_branches + (banks[c].co_branches === 1 ? ' branch)' : ' branches)');
        bankSelect.appendChild(o);
      });
      bankSelect.addEventListener('change', function () { chooseBank(bankSelect.value || null); });
      function chooseBank(cert) {
        // An open popup may list banks the new filter hides.
        map.closePopup();
        focusBank = cert && banks[cert] ? cert : null;
        bankSelect.value = focusBank || '';
        selected = null;
        select.value = '';
        // A bank's branch counties are the conservative reading, so the
        // reading buttons say so.
        if (focusBank && mode !== 'conservative') {
          mode = 'conservative';
          Array.prototype.forEach.call(modeBtns, function (b) {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-cra-mode') === 'conservative'));
          });
        }
        // The dots are the bank's footprint, so show them even if they were off.
        if (focusBank && showOffices && !showOffices.checked) { showOffices.checked = true; officeLayer.addTo(map); }
        drawOffices();
        layer.setStyle(style);
        drawLegend();
        drawPanel();
        setLabel();
        if (status) {
          status.textContent = focusBank ? 'Showing only ' + banks[focusBank].name + ': ' + shownDots.length +
            ' branches in ' + banks[focusBank].co_counties.length + ' counties.' : 'Showing all banks.';
        }
      }

      Array.prototype.forEach.call(modeBtns, function (btn) {
        btn.addEventListener('click', function () {
          mode = btn.getAttribute('data-cra-mode');
          // A reading covers every bank, so it ends the one-bank view.
          if (focusBank) { focusBank = null; bankSelect.value = ''; drawOffices(); }
          Array.prototype.forEach.call(modeBtns, function (b) {
            b.setAttribute('aria-pressed', String(b === btn));
          });
          layer.setStyle(style);
          drawLegend();
          drawPanel();
          setLabel();
          var msg = mode === 'conservative'
            ? 'Conservative reading: counties shaded by the number of banks with a branch there.'
            : 'Expansive reading: every county shaded, since a large or intermediate small bank with a Colorado branch may get credit anywhere in the state, if it has served its own areas first.';
          if (status) status.textContent = msg;
        });
      });

      function choose(g) {
        // A county's table lists every bank, so picking one ends the
        // one-bank view rather than mixing the two.
        if (g && focusBank) {
          focusBank = null;
          bankSelect.value = '';
          drawOffices();
          drawLegend();
          setLabel();
        }
        selected = g;
        select.value = g || '';
        layer.setStyle(style);
        drawPanel();
      }

      function setLabel() {
        mount.setAttribute('aria-label', focusBank
          ? 'Map of Colorado with the counties where ' + banks[focusBank].name + ' has a branch shaded, and a dot at each of its ' +
            shownDots.length + ' branch offices. Its counties and addresses are listed below the map.'
          : mode === 'conservative' ? CONS_LABEL : EXP_LABEL);
      }

      function drawLegend() {
        var html;
        if (focusBank) {
          html = '<span class="cra-map__key"><i style="background:' + BANK_COUNTY_COLOR + '"></i>County where ' +
            esc(banks[focusBank].name) + ' has a branch</span><span class="cra-map__key"><i style="background:' +
            BINS[BINS.length - 1].color + '"></i>No branch</span>';
        } else if (mode === 'conservative') {
          html = BINS.map(function (b) {
            return '<span class="cra-map__key"><i style="background:' + b.color + '"></i>' + esc(b.label) + '</span>';
          }).join('');
        } else {
          html = '<span class="cra-map__key"><i style="background:' + EXPANSIVE_COLOR +
            '"></i>Every county: a large or intermediate small bank with a Colorado branch may get credit here, if it has served its own areas first</span>';
        }
        if (map.hasLayer(officeLayer)) {
          html += '<span class="cra-map__key"><i class="cra-map__dot" style="background:' + OFFICE_COLOR +
            '"></i>Bank branch (click a dot for its bank and address)</span>';
        }
        legend.innerHTML = html;
      }

      // cells: [[label, html], ...]; labels show on phones, where rows stack.
      function row(cert, cells) {
        var b = banks[cert];
        cells = cells.concat([
          ['CRA size', esc(SIZE_LABEL[b.cra_size] || 'Unknown')],
          ['Examiner', esc(REG_LABEL[b.regulator] || b.regulator || '')],
          ['Headquarters', esc(b.hq)],
        ]);
        return '<tr><th scope="row">' + bankLink(cert, b.name) + '</th>' + cells.map(function (c) {
          return '<td data-label="' + esc(c[0]) + '">' + c[1] + '</td>';
        }).join('') + '</tr>';
      }

      var TAIL_HEAD = '<th scope="col" data-tip="Set by total assets on December 31 of the two prior years. Only large banks are graded on an investment test; intermediate small banks on a community development test that includes investments; small banks on lending only.">CRA size</th>' +
        '<th scope="col" data-tip="The federal agency that examines the bank for CRA. Its performance evaluation search has the bank\'s assessment areas.">Examiner</th>' +
        '<th scope="col" data-tip="Main office city and state, from the FDIC.">Headquarters</th>';

      // Every office in the county, as text: the keyboard route to what the
      // map's dots show.
      function officesHtml(g) {
        var list = officeDots.filter(function (d) { return d.o[6] === g; }).map(function (d) { return d.o; });
        if (!list.length) return '';
        list.sort(function (a, b) {
          return banks[a[0]].name.localeCompare(banks[b[0]].name) || a[3].localeCompare(b[3]);
        });
        return '<details class="cra-map__addresses"><summary>Branch addresses in ' + esc(names[g]) +
          ' (' + list.length + ')</summary><ul>' + list.map(function (o) {
            return '<li>' + bankLink(o[0], banks[o[0]].name) + ': ' + esc(o[3]) + ', ' + esc(o[4]) + ' ' + esc(o[5]) + '</li>';
          }).join('') + '</ul></details>';
      }

      function drawPanel() {
        if (!selected && focusBank) {
          panel.innerHTML = bankPanel(focusBank);
          return;
        }
        if (!selected) {
          panel.innerHTML = '<p>Click a county on the map, or choose one from the list, to see the banks.</p>';
          return;
        }
        var name = esc(names[selected]);
        var here = counties[selected] ? counties[selected].banks : {};
        var hereCerts = Object.keys(here);
        if (mode === 'conservative') {
          if (!hereCerts.length) {
            panel.innerHTML = '<h4>' + name + '</h4><p>No FDIC-insured bank reports a branch here. Switch to the expansive reading to see banks that could still count an investment here.</p>';
            return;
          }
          hereCerts.sort(function (a, b) { return (here[b].deposits_k || 0) - (here[a].deposits_k || 0); });
          panel.innerHTML = '<h4>' + name + ': ' + hereCerts.length + (hereCerts.length === 1 ? ' bank' : ' banks') + ' with a branch</h4>' +
            '<p>Each is a first call, once you confirm the project\'s census tract is inside its assessment area (its performance evaluation or public file shows the area).</p>' +
            '<div class="dt-table-wrap dt-stack"><table class="data-table"><thead><tr>' +
            '<th scope="col">Bank</th>' +
            '<th scope="col" data-tip="Offices this bank reports in the county in the FDIC Summary of Deposits.">Branches here</th>' +
            '<th scope="col" data-tip="Deposits booked at this bank\'s offices in the county, as of June 30.">Deposits here</th>' +
            TAIL_HEAD + '</tr></thead><tbody>' +
            rowsHtml(hereCerts, function (c) { return row(c, [['Branches here', here[c].branches], ['Deposits here', money(here[c].deposits_k)]]); }) +
            '</tbody></table></div>' + moreButton(hereCerts.length) + officesHtml(selected);
        } else {
          var others = Object.keys(banks).filter(function (c) {
            return !here[c] && (banks[c].cra_size === 'large' || banks[c].cra_size === 'intermediate');
          });
          var unknown = Object.keys(banks).filter(function (c) { return !here[c] && !banks[c].cra_size; }).length;
          others.sort(function (a, b) {
            return (banks[a].cra_size === 'large' ? 0 : 1) - (banks[b].cra_size === 'large' ? 0 : 1) ||
              banks[b].co_branches - banks[a].co_branches;
          });
          var large = others.filter(function (c) { return banks[c].cra_size === 'large'; }).length;
          var isb = others.length - large;
          panel.innerHTML = '<h4>' + name + ': ' + others.length + ' more banks may be able to count an investment here</h4>' +
            '<p>These banks have Colorado branches but none in ' + name + '. Under the 1995 CRA rules examiners apply today:</p><ul>' +
            '<li>The ' + large + ' large banks are graded on an investment test that counts investments benefiting \u201ca broader statewide or regional area that includes the bank\u2019s assessment area(s)\u201d (12 CFR 228.23(a)).</li>' +
            '<li>The ' + isb + ' intermediate small banks have a community development test whose rule text names no area; the agencies\u2019 guidance says a retail institution \u201cwill receive consideration\u201d for activity in that broader area, so it may count for them too.</li>' +
            '<li>Either way, only \u201cas long as the institution has been responsive to community development needs and opportunities in its assessment area(s)\u201d (Interagency Q&amp;A \u00a7__.12(h)\u20136). The bank\u2019s latest performance evaluation says whether examiners found that.</li></ul>' +
            '<p>' + (hereCerts.length ? 'The ' + hereCerts.length + (hereCerts.length === 1 ? ' bank' : ' banks') + ' with a branch here ' + (hereCerts.length === 1 ? 'is' : 'are') + ' under the conservative reading. ' : '') +
            'Small banks are left out: their examiners weigh investments only as an optional part of a lending test (12 CFR 228.26(b)).' +
            (unknown ? ' ' + unknown + (unknown === 1 ? ' bank is' : ' banks are') + ' also left out because the FDIC has not reported both year-end asset totals that set its size class.' : '') + '</p>' +
            '<div class="dt-table-wrap dt-stack"><table class="data-table"><thead><tr>' +
            '<th scope="col">Bank</th>' +
            '<th scope="col" data-tip="All offices this bank reports in Colorado.">Colorado branches</th>' +
            '<th scope="col" data-tip="Colorado counties where this bank has at least one branch.">Colorado counties</th>' +
            TAIL_HEAD + '</tr></thead><tbody>' +
            rowsHtml(others, function (c) { return row(c, [['Colorado branches', banks[c].co_branches], ['Colorado counties', banks[c].co_counties.length]]); }) +
            '</tbody></table></div>' + moreButton(others.length) + officesHtml(selected);
        }
      }

      // The chosen bank's Colorado footprint: its branch counties are the
      // screen for its assessment areas, as in the conservative reading.
      function bankPanel(cert) {
        var b = banks[cert];
        var gs = b.co_counties.filter(function (g) { return bankIn(cert, g); });
        gs.sort(function (a, c) { return (counties[c].banks[cert].deposits_k || 0) - (counties[a].banks[cert].deposits_k || 0); });
        var mine = officeDots.filter(function (d) { return d.o[0] === cert; }).map(function (d) { return d.o; });
        mine.sort(function (a, c) { return a[4].localeCompare(c[4]) || a[3].localeCompare(c[3]); });
        var reach = b.cra_size === 'large' || b.cra_size === 'intermediate'
          ? 'Under the expansive reading it may also count an investment elsewhere in Colorado, if it has served these areas first.'
          : b.cra_size === 'small' ? 'As a small bank, its examiners weigh investments only as an optional part of its lending test (12 CFR 228.26(b)).' : '';
        return '<h4>' + bankLink(cert, b.name) + ': ' + b.co_branches + (b.co_branches === 1 ? ' branch' : ' branches') +
          ' in ' + gs.length + (gs.length === 1 ? ' county' : ' counties') + '</h4>' +
          '<p>CRA size: ' + esc(SIZE_LABEL[b.cra_size] || 'Unknown') + '. Examiner: ' + esc(REG_LABEL[b.regulator] || b.regulator || '') +
          '. Headquarters: ' + esc(b.hq) + '.</p>' +
          '<p>The shaded counties are where it has a branch, a first screen for its assessment areas; its performance evaluation or public file shows the areas themselves. ' + reach + '</p>' +
          '<div class="dt-table-wrap dt-stack"><table class="data-table"><thead><tr>' +
          '<th scope="col">County</th>' +
          '<th scope="col" data-tip="Offices this bank reports in the county in the FDIC Summary of Deposits.">Branches</th>' +
          '<th scope="col" data-tip="Deposits booked at this bank\'s offices in the county, as of June 30.">Deposits</th>' +
          '</tr></thead><tbody>' + gs.map(function (g) {
            var h = counties[g].banks[cert];
            return '<tr><th scope="row">' + esc(names[g] || g) + '</th><td data-label="Branches">' + h.branches +
              '</td><td data-label="Deposits">' + money(h.deposits_k) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (mine.length ? '<details class="cra-map__addresses"><summary>Branch addresses (' + mine.length + ')</summary><ul>' +
            mine.map(function (o) { return '<li>' + esc(o[3]) + ', ' + esc(o[4]) + ' ' + esc(o[5]) + '</li>'; }).join('') +
            '</ul></details>' : '') +
          '<button type="button" class="cra-map__allbanks">Show all banks</button>';
      }

      // Capture phase: the shared sort arrow stops propagation, so a bubbling
      // listener would miss it.
      panel.addEventListener('click', function (e) {
        // Sorting a half-shown list would mix shown and hidden rows, so a
        // header click shows them all first.
        if (e.target.closest && e.target.closest('.cra-map__allbanks')) {
          // The button goes with the panel, so keep keyboard focus nearby.
          chooseBank(null);
          bankSelect.focus();
          return;
        }
        if (!e.target.closest || !e.target.closest('.cra-map__showall, thead')) return;
        Array.prototype.forEach.call(panel.querySelectorAll('.cra-map__more'), function (tr) { tr.hidden = false; });
        var btn = panel.querySelector('.cra-map__showall');
        if (btn) btn.remove();
      }, true);

      drawLegend();
      drawPanel();
    }).catch(function () {
      if (panel) panel.innerHTML = '<p>The bank map could not load. The FDIC Summary of Deposits link above has the same branch list.</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
