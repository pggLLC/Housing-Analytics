/**
 * funding-region-map.js — region and town map on where-housing-money-goes.html.
 *
 * Reads data/derived/funding-map.json (scripts/funding/build_funding_map.py),
 * which places every CHFA, OEDIT, Division of Housing and DOLA award from the
 * page's own award files on a site, town and state planning region. Draws a
 * region and town picker, town cards, a pin map beside the award list, capital
 * stacks from the deal summaries, and region or town downloads that carry the
 * data's limits. Loads its data only when the section nears the screen.
 */
(function () {
  'use strict';
  var URL_DATA = 'data/derived/funding-map.json';
  var AG = { CHFA: { label: 'CHFA', v: '--frm-chfa' }, OEDIT: { label: 'OEDIT', v: '--frm-oedit' },
    DOH: { label: 'Division of Housing', v: '--frm-doh' }, DOLA: { label: 'DOLA local government', v: '--frm-dola' } };
  var AGS = ['CHFA', 'DOH', 'DOLA', 'OEDIT'];
  var KORDER = ['state', 'equity', 'federal', 'local', 'gift', 'owner', 'otherstate', 'debt'];
  var KL = { state: 'State awards', equity: 'Tax credit equity', federal: 'Federal', local: 'Local government and tribes',
    gift: 'Foundations and community', owner: 'Owner and developer', otherstate: 'Other state agencies', debt: 'Bank and private loans',
    other: 'Other', cost: 'Project cost (not a source)', credits: 'Tax credits', bonds: 'Bonds', summary: 'Summary' };

  var root = document.querySelector('[data-funding-region-map]');
  if (!root) return;

  var D, SITE, T, R, map, regionL, CO_BOUNDS = [[36.99, -109.06], [41.0, -102.04]];
  var on = { CHFA: true, OEDIT: true, DOH: true, DOLA: true };
  var region = 0, town = null, cardsAll = false, detailAll = false, stacksAll = false;
  var markers = {}, townMarkers = {}, SITE_ZOOM = 11, LIMITS = [], LIMITS_TXT = [];

  function fmt(n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function short(n) {
    return n >= 1e9 ? '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
      : n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M'
      : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Links from the data: only web addresses and the site's own relative pages
  function safeUrl(u) { u = String(u || ''); return /^https?:\/\//i.test(u) || /^[a-z0-9][a-z0-9._\/-]*(\?[a-z0-9=&._-]*)?$/i.test(u) ? u : ''; }
  function $(id) { return document.getElementById(id); }
  function vis(a) { return on[a.agency]; }
  function inSel(a) { return (region === 0 || a.region === region) && (!town || a.town === town); }
  function selAwards() { return D.awards.filter(function (a) { return inSel(a) && vis(a); }); }
  function selName() { return town ? T[town].name : region ? 'Region ' + region + ': ' + R[region].name : 'All Colorado'; }
  function nameOf(a) { return a.site ? SITE[a.site].name : (T[a.town].kind === 'place' ? T[a.town].name + ': town-wide programs' : T[a.town].name); }
  function unitTxt(a) { return a.amount_unit === 'usd_per_year_tax_credit' && a.amount != null ? ' a year' : a.amount_unit === 'usd_bonds' ? ' in bonds' : ''; }
  function amtHtml(a) {
    return fmt(a.amount) + unitTxt(a) + (a.flag === 'unconfirmed' ? ' <span class="frm-flag">unconfirmed</span>' : a.flag === 'requested' ? ' <span class="frm-flag">requested</span>' : '');
  }
  function totals(list) {
    var t = { CHFA: 0, OEDIT: 0, DOH: 0, DOLA: 0 }, cr = 0, crn = 0, bonds = 0;
    list.forEach(function (a) {
      if (a.counts_in_totals) t[a.agency] += a.amount;
      if (a.amount_unit === 'usd_per_year_tax_credit') { crn++; if (a.amount) cr += a.amount; }
      if (a.amount_unit === 'usd_bonds' && a.amount) bonds += a.amount;
    });
    return { t: t, cr: cr, crn: crn, bonds: bonds, sum: t.CHFA + t.OEDIT + t.DOH + t.DOLA };
  }
  function grad(list) {
    var ags = []; list.forEach(function (a) { if (ags.indexOf(a.agency) < 0) ags.push(a.agency); });
    var step = 100 / ags.length;
    return ags.map(function (g, i) { return 'var(' + AG[g].v + ') ' + (i * step) + '% ' + ((i + 1) * step) + '%'; }).join(',');
  }
  function dateTxt(iso) {
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function shell() {
    root.innerHTML =
      '<header><h2 id="frm-h">Map by region and town</h2>' +
      '<p class="frm-lede">The same awards, placed on a map. Pick one of Colorado\'s 14 planning regions, then a town, to see every funded project, what each agency put in, and the full capital stack where a deal record prints one. Download what you pick.</p></header>' +
      '<div class="frm-picker" role="group" aria-label="Choose a place">' +
        '<label for="frm-reg">Region</label><select id="frm-reg"></select>' +
        '<label for="frm-town">Town</label><select id="frm-town"></select>' +
        '<div class="frm-dl" role="group" aria-label="Downloads"><b id="frm-dlwhat">Download all Colorado:</b>' +
          '<button class="frm-btn" type="button" data-dl="awards">Awards (CSV)</button>' +
          '<button class="frm-btn" type="button" data-dl="stacks">Capital stacks (CSV)</button>' +
          '<button class="frm-btn" type="button" data-dl="report">Report (prints to PDF)</button>' +
          '<span class="frm-msg" id="frm-msg" role="status"></span></div>' +
      '</div>' +
      '<details class="frm-limits" open><summary>What this data covers, and what it misses</summary>' +
        '<p class="frm-sub">Read this before citing any total. It is a record of awards found in public documents, not an official or complete list. The same notes go into every download.</p>' +
        '<ul id="frm-limits"></ul></details>' +
      '<section aria-labelledby="frm-cards-h" class="frm-sec"><div class="frm-row"><h3 id="frm-cards-h">By region</h3><span class="frm-sub" id="frm-cards-note"></span></div>' +
        '<div class="frm-cards" id="frm-cards"></div><button class="frm-btn frm-link" type="button" id="frm-cards-more" hidden></button></section>' +
      '<div class="frm-row" role="group" aria-label="Show agencies" id="frm-chips"></div>' +
      '<div class="frm-main"><div class="frm-map" id="frm-map" role="region" aria-label="Map of funded sites in Colorado"></div>' +
        '<div class="frm-detail" id="frm-detail" aria-live="polite"></div></div>' +
      '<section aria-labelledby="frm-stk-h" class="frm-sec"><div class="frm-row"><h3 id="frm-stk-h">Capital stacks: every public source per project</h3><span class="frm-sub" id="frm-stk-note"></span></div>' +
        '<p class="frm-lede">Sources beyond the state award (tax credit equity and federal, local, foundation, owner and bank money), as named in the deal records. The bar is scaled to the project\'s total cost where one is printed; the hatched part is money no public source accounts for. Construction loans, bonds, credits and in-kind help are listed but not added.</p>' +
        '<div class="frm-klegend" id="frm-klegend"></div><div class="frm-stacks" id="frm-stacks"></div>' +
        '<button class="frm-btn frm-link" type="button" id="frm-stk-more" hidden></button></section>';
  }

  function setLimits() {
    var unm = D.unmapped.length, unmSum = D.unmapped.reduce(function (x, a) { return x + (a.flag ? 0 : (a.amount || 0)); }, 0);
    var approx = D.sites.filter(function (s) { return s.approximate; }).length;
    LIMITS = [
      '<b>Sources.</b> CHFA housing tax credits come from CHFA\'s award reports, 2016 to 2026. Older credit properties come from CHFA\'s property list, which gives the year and homes but no credit amount. OEDIT\'s Prop 123 awards cover 2023 to 2026. Division of Housing awards come from State Housing Board votes, Division of Housing award tables and its annual reports.',
      '<b>Big gaps.</b> Division of Housing awards before mid-2023 are mostly missing, because older board packets are offline and several DOLA releases were deleted. DOLA local government grants (incentive grants, More Housing Now) are listed for only a few counties. CHFA\'s own loans and homebuyer lending are not published by project, so they appear only where a deal record names them. Treat a thin region as less documented, not necessarily less funded.',
      '<b>Units are never mixed.</b> "State dollars" adds grants and loans with printed amounts. Tax credits are annual amounts, claimed for 10 years (federal), and are shown apart. Private activity bonds are tax-exempt debt under the state\'s bond cap, not state money, so they are shown apart too. Amounts printed only as a request, or only in the news, are listed but not added.',
      '<b>Places.</b> ' + approx + ' sites have no matched address and sit at the town or county center (dashed pins). ' + unm + ' awards (' + short(unmSum) + ') print no town or county, such as statewide down payment and loan funds. They are in the all-Colorado download but not on the map or in any region\'s totals.',
      '<b>Capital stacks are partial.</b> They come from COHO\'s deal summaries of recent awards, sorted into source types automatically, so check the linked summary before relying on a figure. Equity amounts are rarely published. A stack that adds up to more than the printed cost probably counts a loan and its refinance twice.',
      '<b>Matching.</b> Awards are joined to projects by name and county. Different spellings of one project can show up as two sites, and two phases with one name can merge.',
      '<b>Not an official record.</b> Compiled ' + dateTxt(D.compiled) + ' from public documents that can change. Check the linked record before citing an amount.'
    ];
    // Plain-text copies for the CSV notes: drop the leading <b>…</b> label markup
    LIMITS_TXT = LIMITS.map(function (x) { return x.split('<b>').join('').split('</b>').join(''); });
    $('frm-limits').innerHTML = LIMITS.map(function (x) { return '<li>' + x + '</li>'; }).join('');
  }

  function fillTowns() {
    var sel = $('frm-town');
    var ks = Object.keys(T).filter(function (k) { return region !== 0 && T[k].region === region; }).sort(function (a, b) {
      return (T[a].kind === 'place' ? 0 : 1) - (T[b].kind === 'place' ? 0 : 1) || T[a].name.localeCompare(T[b].name);
    });
    sel.innerHTML = '<option value="">' + (region ? 'Whole region' : 'Pick a region first') + '</option>' +
      ks.map(function (k) { return '<option value="' + k + '">' + esc(T[k].name) + '</option>'; }).join('');
    sel.disabled = !region; sel.value = town || '';
  }

  function drawCards() {
    var cards;
    if (region === 0) {
      $('frm-cards-h').textContent = 'By region';
      cards = Object.keys(R).map(function (r) {
        return { key: 'R' + r, label: 'Region ' + r, name: R[r].name, sub: R[r].counties.map(function (c) { return D.counties[c].name; }).join(', '),
          list: D.awards.filter(function (a) { return a.region === +r && vis(a); }) };
      });
    } else {
      $('frm-cards-h').textContent = 'Towns in ' + R[region].name;
      cards = Object.keys(T).filter(function (k) { return T[k].region === region; }).map(function (k) {
        return { key: k, label: T[k].county ? D.counties[T[k].county].name + ' County' : 'Several counties', name: T[k].name,
          list: D.awards.filter(function (a) { return a.town === k && vis(a); }) };
      });
    }
    cards.forEach(function (c) { c.T = totals(c.list); });
    cards.sort(function (a, b) { return b.T.sum - a.T.sum || b.list.length - a.list.length; });
    var lim = cardsAll || region === 0 ? cards.length : 12;
    $('frm-cards').innerHTML = cards.slice(0, lim).map(function (c) {
      var bar = c.T.sum ? AGS.filter(function (g) { return c.T.t[g]; }).map(function (g) {
        return '<i style="--c:var(' + AG[g].v + ');width:' + (c.T.t[g] / c.T.sum * 100).toFixed(1) + '%" title="' + AG[g].label + ' ' + fmt(c.T.t[g]) + '"></i>';
      }).join('') : '';
      var sites = {}; c.list.forEach(function (a) { if (a.site) sites[a.site] = 1; });
      var n = Object.keys(sites).length;
      var pressed = c.key === 'R' + region || c.key === town;
      return '<button class="frm-card" type="button" data-k="' + c.key + '" aria-pressed="' + pressed + '"' + (c.sub ? ' title="' + esc(c.sub) + '"' : '') + '>' +
        '<span class="frm-cty">' + esc(c.label) + '</span><strong>' + esc(c.name) + '</strong>' +
        '<span class="frm-big">' + (c.T.sum ? short(c.T.sum) : '$0') + ' <span class="frm-meta">state dollars</span></span>' +
        '<span class="frm-bar" aria-hidden="true">' + bar + '</span>' +
        '<span class="frm-meta">' + c.list.length + ' award' + (c.list.length === 1 ? '' : 's') + (n ? ' · ' + n + ' site' + (n === 1 ? '' : 's') : '') +
        (c.T.cr ? ' · credits ' + short(c.T.cr) + '/yr' : '') + '</span></button>';
    }).join('');
    var more = $('frm-cards-more');
    more.hidden = cards.length <= 12 || region === 0;
    more.textContent = cardsAll ? 'Show the top 12' : 'Show all ' + cards.length + ' towns';
    $('frm-cards-note').textContent = region === 0 ? 'Pick a region to see its towns.' : 'Sorted by state dollars. Pick a town to narrow the map and stacks.';
  }

  // Map
  function cssVar(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  function drawRegions() {
    if (regionL) regionL.remove();
    var feats = Object.keys(R).map(function (r) { return { type: 'Feature', properties: { region: +r }, geometry: R[r].shape }; });
    regionL = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
      style: function (f) {
        var me = f.properties.region === region;
        return { weight: me ? 3 : 1.4, color: cssVar('--frm-region'), opacity: me || region === 0 ? 0.9 : 0.45, fill: true, fillOpacity: me || region === 0 ? 0 : 0.12, fillColor: '#888' };
      },
      onEachFeature: function (f, l) {
        l.on('click', function () { if (region === 0 || map.getZoom() < 8) pick(f.properties.region, null, true); })
          .bindTooltip(f.properties.region + '. ' + R[f.properties.region].name, { sticky: true });
      }
    }).addTo(map);
    regionL.bringToBack();
  }
  function siteAwards(id) { return D.awards.filter(function (a) { return a.site === id && vis(a); }); }
  function srcSum(list) {
    var Tt = totals(list), rows = AGS.filter(function (g) { return Tt.t[g]; });
    if (!rows.length && !Tt.cr && !Tt.bonds) return '<div class="frm-srcsum"><span>No dollar amount printed</span></div>';
    var mix = Tt.sum ? '<span class="frm-mix" aria-hidden="true">' + rows.map(function (g) {
      return '<i style="--c:var(' + AG[g].v + ');width:' + (Tt.t[g] / Tt.sum * 100).toFixed(1) + '%"></i>';
    }).join('') + '</span>' : '';
    return '<div class="frm-srcsum">' + rows.map(function (g) {
      return '<span><em style="color:var(' + AG[g].v + ')">' + AG[g].label + '</em><b>' + fmt(Tt.t[g]) + '</b></span>';
    }).join('') + (rows.length > 1 ? '<span><em>State total</em><b>' + fmt(Tt.sum) + '</b></span>' : '') +
      (Tt.cr ? '<span><em>Tax credits</em><b>' + fmt(Tt.cr) + ' a year</b></span>' : '') +
      (Tt.bonds ? '<span><em>Bonds (not state dollars)</em><b>' + fmt(Tt.bonds) + '</b></span>' : '') + mix + '</div>';
  }
  function awardLi(a) {
    return '<li><b style="color:var(' + AG[a.agency].v + ')">' + AG[a.agency].label + '</b>, ' + esc(a.year_label) + ': ' + esc(a.program) +
      (a.recipient ? ', to ' + esc(a.recipient) : '') + '. ' + amtHtml(a) +
      (safeUrl(a.source_url) ? ' <a href="' + esc(safeUrl(a.source_url)) + '" target="_blank" rel="noopener">source</a>' : '') + '</li>';
  }
  function popupHtml(id) {
    var s = SITE[id], list = siteAwards(id).sort(function (a, b) { return a.year - b.year; });
    return '<h4>' + esc(s.name) + '</h4><span class="frm-sub">' + esc(T[s.town].name) +
      (s.address && s.address !== T[s.town].name ? ' · ' + esc(s.address) : '') + (s.homes ? ' · ' + s.homes + ' homes' : '') +
      (s.approximate ? ' · location approximate' : '') + '</span>' + srcSum(list) + '<ul>' + list.map(awardLi).join('') + '</ul>' + stackPopup(id);
  }
  function drawMarkers() {
    D.sites.forEach(function (s) {
      var list = siteAwards(s.id), show = list.length && (region === 0 || T[s.town].region === region);
      if (!show) { if (markers[s.id]) { markers[s.id].remove(); delete markers[s.id]; } return; }
      var icon = L.divIcon({ className: '', html: '<div class="frm-pin' + (s.approximate ? ' frm-approx' : '') + '" style="background:conic-gradient(' + grad(list) + ')">' + list.length + '</div>',
        iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });
      if (!markers[s.id]) markers[s.id] = L.marker([s.lat, s.lng], { icon: icon, title: s.name, keyboard: true }).bindPopup(function () { return popupHtml(s.id); }, { maxWidth: 340, maxHeight: 420 });
      else markers[s.id].setIcon(icon);
    });
    Object.keys(T).forEach(function (k) {
      var t = T[k]; if (t.lat == null) return;
      var list = D.awards.filter(function (a) { return a.town === k && vis(a); }), show = list.length && (region === 0 || t.region === region);
      if (!show) { if (townMarkers[k]) { townMarkers[k].remove(); delete townMarkers[k]; } return; }
      var lab = region === 0 ? '' : esc(t.kind === 'county' ? t.name.split(',')[0] : t.name);
      var icon = L.divIcon({ className: '', html: '<div class="frm-tpin' + (region === 0 ? ' frm-dot' : '') + '"><b style="background:conic-gradient(' + grad(list) + ')">' + list.length + '</b>' + lab + '</div>', iconSize: [0, 0] });
      if (!townMarkers[k]) townMarkers[k] = L.marker([t.lat, t.lng], { icon: icon, title: t.name, keyboard: true }).on('click', function () { pick(t.region, k, true); });
      else townMarkers[k].setIcon(icon);
    });
    syncZoom();
  }
  function syncZoom() {
    var siteMode = map.getZoom() >= SITE_ZOOM;
    Object.keys(markers).forEach(function (k) { var m = markers[k]; if (siteMode) { if (!map.hasLayer(m)) m.addTo(map); } else if (map.hasLayer(m)) { m.closePopup(); m.remove(); } });
    Object.keys(townMarkers).forEach(function (k) { var m = townMarkers[k]; if (!siteMode) { if (!map.hasLayer(m)) m.addTo(map); } else if (map.hasLayer(m)) m.remove(); });
  }

  function drawDetail() {
    var list = selAwards(), Tt = totals(list), groups = {};
    list.forEach(function (a) { var k = a.site || ('@' + a.town); (groups[k] = groups[k] || []).push(a); });
    var keys = Object.keys(groups).sort(function (x, y) {
      return Math.max.apply(null, groups[y].map(function (a) { return a.year; })) - Math.max.apply(null, groups[x].map(function (a) { return a.year; }));
    });
    var lim = detailAll ? keys.length : 40;
    $('frm-detail').innerHTML = '<div><h3>' + esc(selName()) + '</h3><span class="frm-sub">' + list.length + ' awards · ' + short(Tt.sum) + ' in state dollars' +
      (Tt.cr ? ' · ' + short(Tt.cr) + ' a year in tax credits' : '') + ' · newest first' + (region === 0 ? ' · pick a region to narrow' : '') + '</span></div>' +
      keys.slice(0, lim).map(function (k) {
        var g = groups[k].sort(function (a, b) { return b.year - a.year; });
        if (k.charAt(0) === '@') return '<div class="frm-site"><h4>' + esc(T[k.slice(1)].name) + ': programs with no single site</h4><span class="frm-sub">Not on the map as a pin.</span><ul>' + g.map(awardLi).join('') + '</ul></div>';
        var s = SITE[k];
        return '<div class="frm-site"><h4><button class="frm-name" type="button" data-s="' + k + '">' + esc(s.name) + '</button></h4><span class="frm-sub">' + esc(T[s.town].name) +
          (s.homes ? ' · ' + s.homes + ' homes' : '') + (s.approximate ? ' · location approximate' : '') + '</span>' + srcSum(g) + '<ul>' + g.map(awardLi).join('') + '</ul></div>';
      }).join('') +
      (keys.length > lim ? '<button class="frm-btn frm-link" type="button" data-more="1">Show all ' + keys.length + ' projects and programs</button>' : '');
  }
  function focusSite(id) {
    var s = SITE[id];
    if (T[s.town].region !== region) pick(T[s.town].region, null, false);
    map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
    map.once('moveend', function () { syncZoom(); if (markers[id]) markers[id].openPopup(); });
    $('frm-map').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  // Capital stacks
  function stackOf(id) {
    var c = D.stacks[id]; if (!c) return null;
    var rows = c.rows.map(function (r) {
      var ag = r.category === 'state' ? (/CHFA/.test(r.label) ? 'CHFA' : /Division of Housing|\bDOH\b/.test(r.label) ? 'DOH' : /OEDIT|Prop 123/.test(r.label) ? 'OEDIT' : /DOLA/.test(r.label) ? 'DOLA' : null) : null;
      return { label: r.label, cat: r.category, ag: ag, amount: r.amount, text: r.amount_text, phase: r.phase,
        tag: r.phase === 'perunit' ? 'per home, not added' : r.phase === 'construction' ? 'short-term, not added' : r.phase === 'inkind' ? 'in-kind, not added'
          : r.phase === 'summary' ? (r.category === 'cost' ? 'a cost, not a source' : r.category === 'credits' ? 'credits, shown apart' : r.category === 'bonds' ? 'bonds, not added' : 'not added') : '',
        note: r.note, src_title: r.source_title, src_url: r.source_url };
    });
    var by = {};
    rows.forEach(function (r) { if (r.phase === 'perm' && r.amount) { var k = KORDER.indexOf(r.cat) >= 0 ? r.cat : 'debt'; by[k] = (by[k] || 0) + r.amount; } });
    var known = 0; Object.keys(by).forEach(function (k) { known += by[k]; });
    var cr = D.awards.filter(function (a) { return a.site === id && a.amount_unit === 'usd_per_year_tax_credit' && a.amount; }).reduce(function (x, a) { return x + a.amount; }, 0);
    return { c: c, rows: rows, by: by, known: known, tdc: c.tdc, cr: cr };
  }
  function sbar(st) {
    var base = Math.max(st.tdc ? st.tdc.amount : 0, st.known); if (!base) return '';
    var segs = KORDER.filter(function (k) { return st.by[k]; }).map(function (k) {
      return '<i style="--c:var(--frm-k-' + k + ');width:' + (st.by[k] / base * 100).toFixed(2) + '%" title="' + KL[k] + ' ' + fmt(st.by[k]) + '"></i>';
    });
    if (st.tdc && st.tdc.amount > st.known) segs.push('<i class="frm-gap" style="width:' + ((st.tdc.amount - st.known) / base * 100).toFixed(2) + '%" title="Not accounted for by public sources ' + fmt(st.tdc.amount - st.known) + '"></i>');
    return '<div class="frm-sbar" role="img" aria-label="' + esc(KORDER.filter(function (k) { return st.by[k]; }).map(function (k) { return KL[k] + ' ' + fmt(st.by[k]); }).join(', ')) + '">' + segs.join('') + '</div>';
  }
  function sumLine(st) {
    var t = st.tdc, pct = t && t.amount ? Math.round(st.known / t.amount * 100) : null;
    return '<div class="frm-sum">' + (t ? 'Total cost <b>' + short(t.amount) + '</b> · ' : 'Total cost not printed · ') + 'documented <b>' + (st.known ? short(st.known) : '$0') + '</b>' +
      (pct != null ? ' (' + pct + '%' + (pct > 105 ? ', likely overlap' : '') + ')' : '') + (st.cr ? ' · credits ' + short(st.cr) + ' a year' : '') + '</div>';
  }
  function stackPopup(id) {
    var st = stackOf(id); if (!st) return '';
    return '<div class="frm-srcsum"><b>Capital stack</b>' + sbar(st) + sumLine(st) + '<a href="#frm-stk-' + id + '">See every source</a></div>';
  }
  function srcColor(r) { return r.cat === 'state' && r.ag ? 'var(' + AG[r.ag].v + ')' : KORDER.indexOf(r.cat) >= 0 ? 'var(--frm-k-' + r.cat + ')' : 'var(--border-strong)'; }
  function stackCard(id) {
    var st = stackOf(id), s = SITE[id];
    var li = st.rows.map(function (r) {
      return '<li><span class="frm-sw" style="--c:' + srcColor(r) + '" title="' + esc(r.cat === 'state' && r.ag ? AG[r.ag].label : KL[r.cat] || r.cat) + '"></span>' +
        '<span>' + esc(r.label) + (r.tag ? '<span class="frm-tag">' + esc(r.tag) + '</span>' : '') + '</span><span class="frm-amt">' + esc(r.text) + '</span>' +
        '<span class="frm-why">' + (r.note ? esc(r.note) + ' ' : '') + (safeUrl(r.src_url) ? '<a href="' + esc(safeUrl(r.src_url)) + '" target="_blank" rel="noopener">' + esc(r.src_title) + '</a>' : esc(r.src_title)) + '</span></li>';
    }).join('');
    return '<article class="frm-stk" id="frm-stk-' + id + '"><h4><button class="frm-name" type="button" data-s="' + id + '">' + esc(s.name) + '</button></h4>' +
      '<span class="frm-sub">' + esc(T[s.town].name) + (s.homes ? ' · ' + s.homes + ' homes' : '') + '</span>' + sbar(st) + sumLine(st) +
      '<ul class="frm-srows">' + li + '</ul>' + (st.c.note ? '<span class="frm-sub">' + esc(st.c.note) + '</span>' : '') +
      '<span class="frm-sub">Sorted automatically from the deal summary. <a href="' + esc(safeUrl(st.c.deal_url)) + '">Read the summary</a>.</span></article>';
  }
  function stackIds() {
    return Object.keys(D.stacks).filter(function (id) { return (region === 0 || T[SITE[id].town].region === region) && (!town || SITE[id].town === town); })
      .map(function (id) { return [id, stackOf(id)]; })
      .sort(function (a, b) { return Math.max(b[1].tdc ? b[1].tdc.amount : 0, b[1].known) - Math.max(a[1].tdc ? a[1].tdc.amount : 0, a[1].known); })
      .map(function (x) { return x[0]; });
  }
  function drawStacks() {
    var ids = stackIds(), lim = stacksAll ? ids.length : 12;
    $('frm-stacks').innerHTML = ids.length ? ids.slice(0, lim).map(stackCard).join('') : '<p class="frm-sub">No deal records found for projects in ' + esc(selName()) + '.</p>';
    var withT = ids.filter(function (id) { return D.stacks[id].tdc; }).length;
    $('frm-stk-note').textContent = ids.length + ' project' + (ids.length === 1 ? '' : 's') + ' with deal records; ' + withT + ' print a total cost.';
    var m = $('frm-stk-more'); m.hidden = ids.length <= 12; m.textContent = stacksAll ? 'Show the largest 12' : 'Show all ' + ids.length + ' stacks';
  }

  // Downloads
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function csvCell(v) { if (v == null) return ''; var s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(head, rows) { return [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n'; }
  function notesBlock() { return LIMITS_TXT.map(function (x) { return '# ' + x; }).join('\n') + '\n# Place: ' + selName() + '\n'; }
  function save(filename, text, type) {
    var a = document.createElement('a'), href = URL.createObjectURL(new Blob([text], { type: type }));
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
    $('frm-msg').textContent = 'Downloading ' + filename + '.';
  }
  function awardsCsv() {
    var rows = D.awards.filter(inSel).map(function (a) {
      return [a.id, R[a.region].name, a.county ? D.counties[a.county].name : '', T[a.town].name, a.site ? SITE[a.site].name : '', a.site && SITE[a.site].approximate ? 'yes' : 'no',
        a.year, a.year_label, a.agency, a.program, a.recipient, a.amount,
        a.amount_unit === 'usd' ? 'dollars' : a.amount_unit === 'usd_bonds' ? 'bond cap dollars' : 'tax credit dollars per year',
        a.counts_in_totals ? 'yes' : 'no', a.flag || '', a.source_title, a.source_url];
    });
    if (region === 0) rows = rows.concat(D.unmapped.map(function (a) {
      return ['', 'No place printed', '', '', '', '', a.year, String(a.year), a.agency, a.program, a.recipient, a.amount, 'dollars', 'no', a.flag || '', a.source_title, a.source_url];
    }));
    return notesBlock() + csv(['award_id', 'region', 'county', 'town', 'project', 'location_approximate', 'year', 'year_label', 'agency', 'program', 'recipient', 'amount',
      'amount_unit', 'counts_in_state_dollars', 'flag', 'source_title', 'source_url'], rows);
  }
  function stacksCsv() {
    var rows = [];
    stackIds().forEach(function (id) {
      var st = stackOf(id), s = SITE[id];
      if (st.tdc) rows.push([s.name, T[s.town].name, 'Total cost', '', st.tdc.amount, st.tdc.text, '', '', st.tdc.source_title, st.tdc.source_url]);
      st.rows.forEach(function (r) { rows.push([s.name, T[s.town].name, r.label, KL[r.cat] || r.cat, r.amount, r.text, r.phase === 'perm' && r.amount ? 'yes' : 'no', r.tag || r.note, r.src_title, r.src_url]); });
    });
    return notesBlock() + csv(['project', 'town', 'source', 'type', 'amount', 'amount_as_printed', 'added_to_documented', 'notes', 'source_title', 'source_url'], rows);
  }
  function projRows() {
    var by = {};
    D.awards.filter(inSel).forEach(function (a) { if (a.site) (by[a.site] = by[a.site] || []).push(a); });
    return Object.keys(by).map(function (id) {
      var s = SITE[id], Tt = totals(by[id]);
      return { name: s.name, tname: T[s.town].name, homes: s.homes, t: Tt.t, sum: Tt.sum, cr: Tt.cr, bonds: Tt.bonds };
    }).sort(function (a, b) { return b.sum - a.sum || b.cr - a.cr; });
  }
  function reportHtml() {
    var list = D.awards.filter(inSel), Tt = totals(list), ids = stackIds(), base = 'https://cohoanalytics.com/';
    function row(cells) { return '<tr>' + cells.map(function (x) { return '<td' + (/^\$/.test(String(x)) ? ' class="n"' : '') + '>' + x + '</td>'; }).join('') + '</tr>'; }
    function abs(u) { u = safeUrl(u); return !u || /^https?:/i.test(u) ? u : base + u; }
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>State housing awards: ' + esc(selName()) + '</title>' +
      '<style>body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2422;max-width:960px;margin:24px auto;padding:0 16px}h1{font-size:26px;margin:0}h2{font-size:18px;margin:24px 0 6px;border-bottom:2px solid #1d2422}h3{font-size:15px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid #d9dedb;padding:5px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5b6662}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.box{border-left:4px solid #9a5f06;padding:6px 12px;background:#faf7f0}.box li{margin:4px 0}a{color:#0f5c8a}.k{display:flex;flex-wrap:wrap;gap:8px 24px}.k div b{display:block;font-size:18px}@media print{a{color:inherit}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>' +
      '<h1>State housing awards: ' + esc(selName()) + '</h1><p>CHFA, OEDIT, Division of Housing and DOLA local government awards with public records, from COHO Analytics (' + esc(base) + 'where-housing-money-goes.html). Compiled ' + dateTxt(D.compiled) + '. Print this page to save it as a PDF.</p>' +
      '<div class="k"><div>State dollars<b>' + fmt(Tt.sum) + '</b></div>' + AGS.map(function (g) { return '<div>' + AG[g].label + '<b>' + fmt(Tt.t[g]) + '</b></div>'; }).join('') +
      '<div>Tax credits a year<b>' + fmt(Tt.cr) + '</b></div><div>Bonds (not state dollars)<b>' + fmt(Tt.bonds) + '</b></div></div>' +
      '<h2>Limits of this data</h2><div class="box"><ul>' + LIMITS.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' +
      '<h2>Funding per project</h2><table><tr><th>Project</th><th>Town</th><th>Homes</th>' + AGS.map(function (g) { return '<th>' + g + '</th>'; }).join('') + '<th>State total</th><th>Credits a year</th><th>Bonds</th></tr>' +
      projRows().map(function (r) {
        return row([esc(r.name), esc(r.tname), r.homes == null ? '—' : r.homes].concat(AGS.map(function (g) { return r.t[g] ? fmt(r.t[g]) : '—'; }),
          [r.sum ? fmt(r.sum) : '—', r.cr ? fmt(r.cr) : '—', r.bonds ? fmt(r.bonds) : '—']));
      }).join('') + '</table>' +
      (ids.length ? '<h2>Capital stacks</h2>' + ids.map(function (id) {
        var k = stackOf(id), s = SITE[id];
        return '<h3>' + esc(s.name) + ', ' + esc(T[s.town].name) + '</h3><p>' + (k.tdc ? 'Total cost ' + fmt(k.tdc.amount) : 'Total cost not printed') + '; documented ' + fmt(k.known) +
          '. Sorted automatically from <a href="' + esc(abs(k.c.deal_url)) + '">COHO\'s deal summary</a>.</p><table><tr><th>Source</th><th>Type</th><th>Amount</th><th>Notes</th><th>Record</th></tr>' +
          k.rows.map(function (r) {
            return row([esc(r.label), esc(KL[r.cat] || r.cat), esc(r.text), esc([r.tag, r.note].filter(Boolean).join('; ')), r.src_url ? '<a href="' + esc(abs(r.src_url)) + '">' + esc(r.src_title) + '</a>' : esc(r.src_title)]);
          }).join('') + '</table>';
      }).join('') : '') +
      '<h2>Every award</h2><table><tr><th>Year</th><th>Project</th><th>Town</th><th>Agency and program</th><th>Recipient</th><th>Amount</th><th>Record</th></tr>' +
      list.slice().sort(function (a, b) { return b.year - a.year; }).map(function (a) {
        return row([esc(a.year_label), esc(nameOf(a)), esc(T[a.town].name), a.agency + ': ' + esc(a.program), esc(a.recipient || '—'),
          fmt(a.amount) + unitTxt(a) + (a.flag ? ' (' + a.flag + ')' : ''), '<a href="' + esc(abs(a.source_url)) + '">' + esc(a.source_title) + '</a>']);
      }).join('') + '</table>' +
      (region === 0 ? '<h2>Awards with no place printed</h2><table><tr><th>Year</th><th>Award</th><th>Recipient</th><th>Program</th><th>Amount</th><th>Record</th></tr>' +
        D.unmapped.map(function (a) {
          return row([a.year, esc(a.name), esc(a.recipient || '—'), a.agency + ': ' + esc(a.program), fmt(a.amount) + (a.flag ? ' (' + a.flag + ')' : ''), '<a href="' + esc(abs(a.source_url)) + '">' + esc(a.source_title) + '</a>']);
        }).join('') + '</table>' : '') + '</body></html>';
  }

  function pick(r, t, fly) {
    var changed = r !== region;
    region = r; town = t; $('frm-reg').value = String(r); fillTowns();
    cardsAll = false; detailAll = false; stacksAll = false;
    $('frm-dlwhat').textContent = 'Download ' + selName() + ':';
    if (changed) drawRegions();
    drawAll();
    if (!fly) return;
    if (t && T[t].lat != null) {
      var pts = D.sites.filter(function (s) { return s.town === t; }).map(function (s) { return [s.lat, s.lng]; });
      if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts).pad(0.3), { duration: 0.6, maxZoom: 14 });
      else map.flyTo([T[t].lat, T[t].lng], 12.5, { duration: 0.6 });
      return;
    }
    if (r === 0) { map.flyToBounds(CO_BOUNDS, { duration: 0.6 }); return; }
    map.flyToBounds(L.geoJSON(R[r].shape).getBounds().pad(0.05), { duration: 0.6 });
  }
  function drawAll() { drawCards(); drawMarkers(); drawDetail(); drawStacks(); }

  function start(data) {
    D = data; T = D.towns; R = D.regions; SITE = {};
    D.sites.forEach(function (s) { SITE[s.id] = s; });
    shell(); setLimits();
    $('frm-reg').innerHTML = '<option value="0">All Colorado</option>' + Object.keys(R).map(function (r) { return '<option value="' + r + '">' + r + '. ' + esc(R[r].name) + '</option>'; }).join('');
    $('frm-reg').addEventListener('change', function () { pick(+this.value, null, true); });
    $('frm-town').addEventListener('change', function () { pick(region, this.value || null, true); });
    $('frm-cards').addEventListener('click', function (e) {
      var b = e.target.closest('.frm-card'); if (!b) return; var k = b.dataset.k;
      if (k.charAt(0) === 'R') pick(+k.slice(1), null, true); else pick(region, k === town ? null : k, true);
    });
    $('frm-cards-more').addEventListener('click', function () { cardsAll = !cardsAll; drawCards(); });
    $('frm-chips').innerHTML = AGS.map(function (g) { return '<button class="frm-chip" type="button" aria-pressed="true" data-g="' + g + '" style="--c:var(' + AG[g].v + ')"><i></i>' + AG[g].label + '</button>'; }).join('');
    $('frm-chips').addEventListener('click', function (e) {
      var c = e.target.closest('.frm-chip'); if (!c) return; var g = c.dataset.g;
      on[g] = !on[g]; c.setAttribute('aria-pressed', String(on[g])); drawAll();
    });
    $('frm-detail').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-s]'); if (b) focusSite(b.dataset.s);
      if (e.target.closest('[data-more]')) { detailAll = true; drawDetail(); }
    });
    $('frm-stacks').addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (b) focusSite(b.dataset.s); });
    $('frm-stk-more').addEventListener('click', function () { stacksAll = !stacksAll; drawStacks(); });
    $('frm-klegend').innerHTML = KORDER.map(function (k) { return '<span><i style="--c:var(--frm-k-' + k + ')"></i>' + KL[k] + '</span>'; }).join('') +
      '<span><i class="frm-gap"></i>Not accounted for</span><span>State rows keep their agency colour.</span>';
    root.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () {
        var base = 'co-housing-awards-' + slug(selName()), k = b.dataset.dl;
        if (k === 'awards') save(base + '.csv', awardsCsv(), 'text/csv');
        else if (k === 'stacks') save(base + '-capital-stacks.csv', stacksCsv(), 'text/csv');
        else save(base + '-report.html', reportHtml(), 'text/html');
      });
    });

    map = L.map('frm-map', { zoomSnap: 0.25, minZoom: 6, maxZoom: 17, scrollWheelZoom: false, maxBounds: [[35.8, -110.6], [42.2, -100.6]] });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Regions: U.S. Census Bureau counties' }).addTo(map);
    map.fitBounds(CO_BOUNDS);
    map.on('zoomend', syncZoom);
    // Redraw tiles when the map's box changes size (phone rotation, layout shifts)
    if ('ResizeObserver' in window) new ResizeObserver(function () { map.invalidateSize(); }).observe($('frm-map'));
    drawRegions();
    fillTowns(); drawAll();
  }

  function load() {
    var url = window.resolveAssetUrl ? window.resolveAssetUrl(URL_DATA) : URL_DATA;
    fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (window.L) start(d);
        else window.addEventListener('load', function () { start(d); });
      })
      .catch(function () { root.innerHTML = '<p>The region map could not load. The award lists above are unaffected.</p>'; });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '600px' });
    io.observe(root);
  } else load();
})();
