/*
 * The market test on deal-calculator.html (workbook piece 7; paul approved the workbook pieces on 25 Nov 2026).
 * "Can the market fill these homes?": the calculator's own homes, by income band and bedroom size, against the
 * renters who qualify for each band in a market area. It reads figures and changes none.
 *
 * Every number comes from the site's own files and engine, counted the way the deal hub's Financials counts them
 * (hub/financials.js captureMarket, hub/start-numbers.js captureCheck):
 *   homes            the calculator's priced rows (window.__DealCalc.getResult().pricedRows), bands up to 80% AMI
 *   renters          PMAMarketScoring.chfaQualifiedRenters (js/market-analysis-scoring.js) on
 *                    data/market/chfa_renter_demand_co.json, with the ACS options the live Market Analysis passes
 *   income limits    CHFA's 2026 county table (data/chfa-income-rent-limits-2026.json)
 *   market area      a market area saved from the deal hub's Market check for this county, in this browser (read
 *                    only from the hub's own project store, 'coho-lab.' keys), else the whole county
 * The 10% and 20% lines are COHO starting rules, not a published standard. CHFA's only published line is 85%
 * penetration, which needs the existing supply Market Analysis counts.
 */
(function (global) {
  'use strict';

  var GOOD = 0.10, VERY_THIN = 0.20;
  var STEP_BANDS = [20, 30, 40, 50, 60, 70, 80];
  var ENGINE_BR = { efficiency: '0br', studio: '0br', '1BR': '1br', '1br': '1br', '2BR': '2br', '2br': '2br', '3BR': '3br', '3br': '3br' };
  var SIZE_NAME = { '0br': 'Studio', '1br': '1BR', '2br': '2BR', '3br': '3BR' };
  var FILES = {
    demand: 'data/market/chfa_renter_demand_co.json',
    acs: 'data/market/acs_tract_metrics_co.json',
    sizes: 'data/market/acs_tract_renter_household_size_co.json',
    limits: 'data/chfa-income-rent-limits-2026.json'
  };
  var STORE = 'coho-lab.';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'); }
  function pct(x) { return x == null || !isFinite(x) ? '—' : (Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%'; }
  function level(share) { return share === Infinity ? 'none' : share > VERY_THIN ? 'very thin' : share > GOOD ? 'thin' : 'good'; }
  function list(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || ''; }

  // The calculator's homes: by band (bands up to 80%, as the CHFA count covers), by band and engine size, the sizes
  // on offer, and the bands left out. Market-rate rows carry no band.
  function homesFrom(rows) {
    var by = {}, cell = {}, offered = {}, over = {}, big = 0;
    (rows || []).forEach(function (r) {
      var t = Number(r && r.tier), n = Number(r && r.units) || 0;
      if (!(t > 0) || !(n > 0)) return;
      if (t > 80) { over[t] = true; return; }
      by[t] = (by[t] || 0) + n;
      var br = ENGINE_BR[r.bedrooms];
      if (!br) { big += n; return; }
      offered[br] = true;
      cell[t] = cell[t] || {};
      cell[t][br] = (cell[t][br] || 0) + n;
    });
    // The sizes each band's own homes come in, so a band counts only renters a home in that band fits (Codex P1 on
    // HA #3016): 30% one-bedrooms do not add 60% renters who need a one-bedroom.
    var sizesByBand = {};
    Object.keys(by).forEach(function (t) { sizesByBand[t] = ['0br', '1br', '2br', '3br'].filter(function (k) { return cell[t] && cell[t][k] > 0; }); });
    return { byBand: by, cell: cell, sizesByBand: sizesByBand, bedrooms: ['0br', '1br', '2br', '3br'].filter(function (k) { return offered[k]; }),
      over: Object.keys(over).map(Number).sort(function (a, b) { return a - b; }), noRule: big };
  }

  // The same check as the deal hub (hub/start-numbers.js captureCheck; test/dc-market-test.test.js holds them equal):
  // each band's share of its renters, the renters a 10% share needs, and for a weak band the next band down that
  // stays at 10% with these homes added.
  // step (optional): { sizesByBand, poolFor(band, sizes) }. With it, a lower band is tested for the sizes of the
  // homes that would move there together with the sizes already there, so a 60% two-bedroom moved to 50% is
  // counted against 50% renters a two-bedroom fits (Codex P1 on HA #3016). Without it, as the hub counts.
  function captureCheck(byBand, pool, step) {
    var sizesAt = {};
    if (step) Object.keys(step.sizesByBand || {}).forEach(function (b) { sizesAt[b] = (step.sizesByBand[b] || []).slice(); });
    var bands = Object.keys(byBand).map(Number).filter(function (b) { return byBand[b] > 0; }).sort(function (a, b) { return a - b; });
    var load = {}; Object.keys(pool).forEach(function (b) { load[b] = byBand[b] || 0; });
    var rows = bands.map(function (b) {
      var n = byBand[b], q = pool[b] || 0, share = q > 0 ? n / q : Infinity, needed = Math.ceil(n / GOOD - 1e-9);
      return { band: b, homes: n, renters: q, share: share, needed: needed, short: Math.max(0, needed - Math.round(q)), level: level(share), down: null };
    });
    rows.slice().reverse().forEach(function (r) {
      if (r.level === 'good') return;
      var lower = Object.keys(pool).map(Number).filter(function (l) { return l < r.band; }).sort(function (a, b) { return b - a; });
      for (var i = 0; i < lower.length; i++) {
        var l = lower[i];
        var q = pool[l], merged = null;
        if (step) {
          merged = ['0br', '1br', '2br', '3br'].filter(function (k) { return (sizesAt[l] || []).indexOf(k) >= 0 || (sizesAt[r.band] || []).indexOf(k) >= 0; });
          q = step.poolFor(l, merged);
        }
        if (q > 0 && (load[l] + r.homes) / q <= GOOD) {
          load[l] += r.homes; r.down = { band: l, share: load[l] / q };
          if (merged) sizesAt[l] = merged;
          return;
        }
      }
    });
    return { rows: rows, weak: rows.filter(function (r) { return r.level !== 'good'; }) };
  }

  // Market areas saved from the deal hub's Market check for this county, newest first. Read only; a replaced or
  // out-of-date area is skipped, as the hub skips it.
  function savedAreas(storage, fips) {
    var out = [];
    if (!storage || !fips) return out;
    var read = function (k) { try { var v = storage.getItem(STORE + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } };
    var idx = read('projects');
    (Array.isArray(idx) ? idx : []).forEach(function (e) {
      var p = e && e.projectId ? read('project.' + e.projectId) : null;
      if (!p || p.projectId !== e.projectId || !Array.isArray(p.attachments)) return;
      p.attachments.forEach(function (a) {
        if (!a || a.kind !== 'market-snapshot' || a.state === 'replaced' || a.state === 'stale') return;
        var s = a.snapshot || {};
        if (!Array.isArray(s.tracts) || !s.tracts.length) return;
        var inCounty = s.countyFips ? s.countyFips === fips : s.tracts.filter(function (g) { return String(g).slice(0, 5) === fips; }).length * 2 > s.tracts.length;
        if (!inCounty) return;
        out.push({ key: 'saved:' + p.projectId + ':' + (a.attachmentId || out.length), tracts: s.tracts.map(String),
          label: (s.areaLabel || a.label || 'saved market area'), project: p.name || 'a project', at: a.attachedAt || '', screening: !!s.screeningOnly });
      });
    });
    return out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  }

  // Renters who qualify, band by band, in an area, and by size for each band the deal has homes in. A band with
  // homes is counted for the sizes its own homes come in (sizesByBand); a band a weak band could step down to is
  // counted for every size the deal offers (bedrooms). No size with a CHFA rule: the engine's 1-3BR default.
  function countRenters(E, data, tracts, bands, sizesByBand, bedrooms) {
    var limits = {}; ((data.limits && data.limits.counties) || []).forEach(function (c) { limits[c.fips] = c; });
    var idx = {}; ((data.acs && data.acs.tracts) || []).forEach(function (m) { idx[m.geoid] = m; });
    var opts = { acsIdx: Object.keys(idx).length ? idx : null, sizeIdx: data.sizes && data.sizes.tracts ? data.sizes.tracts : null };
    var tl = tracts.filter(function (g) { return data.demand.tracts && data.demand.tracts[g]; }).map(function (g) { return { geoid: g }; });
    var pool = {}, bySize = {}, all = bedrooms && bedrooms.length ? bedrooms : undefined, memo = {};
    // Renters who qualify for one band, for the given sizes (none: the engine's 1-3BR default), counted once.
    function count(b, br) {
      var k = b + '|' + (br || []).join(',');
      if (!(k in memo)) memo[k] = E.chfaQualifiedRenters(data.demand, limits, tl, [b], br && br.length ? br : undefined, opts);
      return memo[k];
    }
    bands.forEach(function (b) {
      var own = sizesByBand && sizesByBand[b], br = own ? own : all;
      var q = count(b, br);
      pool[b] = q && q.value > 0 ? q.value : 0;
      if (own) bySize[b] = (q && q.byBedroom) || {};
    });
    return { pool: pool, bySize: bySize, tracts: tl.length,
      poolFor: function (b, br) { var q = count(b, br); return q && q.value > 0 ? q.value : 0; } };
  }

  // The bands a weak band can step down to (the unit grid's bands up to 80% that CHFA's table carries for the
  // county) and the deal's own bands, lowest first: as hub/start-numbers.js marketFor counts them.
  function bandsFor(limitsRec, byBand) {
    var reg = (limitsRec && limitsRec.regular_tiers) || {}, bands = [];
    STEP_BANDS.forEach(function (b) { if (reg[String(b)]) bands.push(b); });
    Object.keys(byBand).forEach(function (b) { b = Number(b); if (bands.indexOf(b) < 0) bands.push(b); });
    return bands.sort(function (a, b) { return a - b; });
  }

  function cellHtml(r) {
    return r.level === 'none' ? 'No renters qualify' : esc(pct(r.share)) + (r.level === 'good' ? '' : ' <small style="display:block;color:var(--warn,#a15c00);font-weight:600;">' + esc(r.level) + '</small>');
  }

  // The panel's body for a finished count.
  function render(h, area, cnt, chk, countyName, areas, pick, fips) {
    var sizes = h.bedrooms;
    var choice = areas.length > 1 ? '<label style="display:block;margin:.4rem 0;font-size:var(--small);">Count renters in <select id="dc-mt-area" style="display:block;width:100%;max-width:32rem;min-height:44px;margin-top:.2rem;">' +
      areas.map(function (a) { return '<option value="' + esc(a.key) + '"' + (a.key === pick ? ' selected' : '') + '>' + esc(a.saved ? a.label + ' (saved in ' + a.project + ')' : 'All of ' + countyName) + '</option>'; }).join('') + '</select></label>' : '';
    var hub = 'deal-hub.html#/market?g=' + encodeURIComponent(fips);
    var lead = area.saved
      ? 'Renters counted in the market area saved from Market check in ' + area.project + ': ' + area.label + (area.screening ? '. It is a screening area, not a CHFA market area.' : '.')
      : 'Renters counted in all of ' + countyName + '. No market area for this county is saved in this browser, so this is the biggest assumption here.';
    var rows = chk.rows.map(function (r) {
      return '<tr' + (r.level === 'good' ? '' : ' data-weak style="background:var(--warn-dim,rgba(161,92,0,.08));"') + '><th scope="row">' + r.band + '%</th><td class="num">' + num(r.homes) + '</td><td class="num">' + num(r.renters) +
        '</td><td class="num">' + cellHtml(r) + '</td><td class="num">' + num(r.needed) + '</td></tr>';
    }).join('');
    var bandTable = '<p style="font-size:var(--tiny);color:var(--muted);margin:.5rem 0 .2rem;">By income band: homes, the renters who qualify, the share (homes ÷ renters), and the renters a 10% share needs.</p>' +
      '<div class="table-scroll" role="region" aria-label="Capture by band" tabindex="0"><table data-no-sort aria-label="Homes against the renters who qualify, by income band" style="width:100%;font-size:var(--small);">' +
      '<thead><tr><th scope="col">Band</th><th scope="col" class="num">Homes</th><th scope="col" class="num">Renters</th><th scope="col" class="num">Share</th><th scope="col" class="num">Needed</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    var sizeTable = '';
    if (sizes.length) {
      var srows = chk.rows.map(function (r) {
        var bs = cnt.bySize[r.band] || {}, c = h.cell[r.band] || {};
        return '<tr><th scope="row">' + r.band + '%</th>' + sizes.map(function (k) {
          var n = c[k] || 0, q = bs[k] || 0;
          if (!n) return '<td class="num" style="color:var(--muted);">—</td>';
          var x = { share: q > 0 ? n / q : Infinity }; x.level = level(x.share);
          return '<td class="num">' + num(n) + ' of ' + num(q) + '<br>' + cellHtml(x) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      sizeTable = '<p style="font-size:var(--tiny);color:var(--muted);margin:.5rem 0 .2rem;">By size: homes of that size, of the renters in the band whom a home that size fits, and the share.</p>' +
        '<div class="table-scroll" role="region" aria-label="Capture by band and size" tabindex="0"><table data-no-sort aria-label="Homes against the renters who qualify, by band and size" style="width:100%;font-size:var(--small);">' +
        '<thead><tr><th scope="col">Band</th>' + sizes.map(function (k) { return '<th scope="col" class="num">' + SIZE_NAME[k] + '</th>'; }).join('') + '</tr></thead><tbody>' + srows + '</tbody></table></div>';
    }
    var warn = chk.weak.length ? '<div role="note" style="margin-top:.5rem;padding:.4rem .6rem;border-left:3px solid var(--warn,#a15c00);background:var(--bg);"><p style="margin:0 0 .3rem;"><strong>Weak capture.</strong> A band that needs more than 10% of the renters who qualify for it is a lease-up risk, and a lender or CHFA’s market analyst will ask who moves in.</p><ul style="margin:0;padding-left:1.1rem;">' +
      chk.weak.map(function (r) {
        var head = 'The ' + r.band + '% band: ' + r.homes + ' home' + (r.homes === 1 ? '' : 's') + (r.level === 'none' ? ', and no renter in this area qualifies for it.'
          : ' would need ' + pct(r.share) + ' of its ' + num(r.renters) + ' qualifying renters. Staying at 10% takes about ' + num(r.needed) + ', ' + num(r.short) + ' more than this area counts.');
        var then = r.down ? 'Recommended: rent these homes at the ' + r.down.band + '% rent, where they would take ' + pct(r.down.share) + ' of that band’s renters.'
          : r.renters > 0 ? 'No lower band has room. About ' + num(Math.floor(GOOD * r.renters + 1e-9)) + ' homes in this band would stay at 10%, or count renters in a wider area.'
            : 'No lower band has room. Count renters in a wider area.';
        return '<li>' + esc(head) + ' <strong>' + esc(then) + '</strong></li>';
      }).join('') + '</ul></div>' : '<p style="margin:.5rem 0 0;">Every band stays at 10% or less of the renters who qualify for it.</p>';
    var notes = [];
    notes.push(sizes.length ? 'Each band is counted for the sizes its own homes come in (here ' + list(sizes.map(function (k) { return SIZE_NAME[k]; })) + ' in all): a household counts only if one fits it. CHFA’s limits: studio 1 person, 1BR 1 to 2, 2BR 2 to 3, 3BR 3 to 5.'
      : 'Counted for 1 to 3 bedroom homes: no size these homes come in has a CHFA household rule.');
    if (h.noRule) notes.push(h.noRule + ' four-bedroom home' + (h.noRule === 1 ? ' is' : 's are') + ' in the band totals but not the size table: the CHFA count has no four-bedroom rule.');
    if (h.over.length) notes.push('Homes at ' + list(h.over.map(function (t) { return t + '%'; })) + ' of area median income are not counted: the CHFA count covers bands up to 80%.');
    notes.push('A household can qualify for more than one band, so the counts overlap. The 10% and 20% lines are COHO starting rules, not a published standard; CHFA’s only published line is 85% penetration, which Market Analysis shows with the existing tax credit homes.');
    notes.push('Source: the site’s own count, the CHFA market-study way (HUD CHAS 2018–2022 scaled to Census ACS 2020–2024 renters; CHFA 2026 income limits). Nothing here changes a figure above.');
    return '<p style="margin:.2rem 0 .4rem;">' + esc(lead) + ' <a href="' + esc(hub) + '">' + (area.saved ? 'Change the market area' : 'Draw a market area round the site') + '</a></p>' + choice + bandTable + sizeTable + warn +
      notes.map(function (n) { return '<p style="font-size:var(--tiny);color:var(--muted);line-height:1.45;margin:.35rem 0 0;">' + esc(n) + '</p>'; }).join('');
  }

  global.DcMarketTest = { GOOD: GOOD, VERY_THIN: VERY_THIN, FILES: FILES, homesFrom: homesFrom, captureCheck: captureCheck, savedAreas: savedAreas,
    countRenters: countRenters, bandsFor: bandsFor, render: render };

  // ---- the page ----
  var doc = global.document;
  var mount = doc && doc.getElementById && doc.getElementById('dc-market-test-mount');
  if (!mount) return;

  var data = null, loading = null, failed = null, pick = null, timer = null, last = null;
  function getJSON(url) {
    var DS = global.DataService;
    if (DS && typeof DS.getJSON === 'function') return DS.getJSON(url);
    return global.fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); });
  }
  function load() {
    if (data || loading) return loading;
    var keys = Object.keys(FILES);
    loading = Promise.all(keys.map(function (k) { return getJSON(FILES[k]); })).then(function (vals) {
      var d = {}; keys.forEach(function (k, i) { d[k] = vals[i]; }); data = d; return d;
    }).catch(function (e) { failed = 'The renter count did not load (' + (e && e.message ? e.message : 'network error') + '). Reload to try again.'; });
    return loading;
  }
  function county() {
    var sel = doc.getElementById('dc-county-select');
    if (!sel || !/^08\d{3}$/.test(sel.value || '')) return null;
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? String(opt.textContent).split(' — ')[0].trim() : '';
    return { fips: sel.value, name: /County$/.test(name) ? name : name + ' County' };
  }

  // Tighter cells than the site's tables, so the share fits a phone screen without scrolling.
  mount.innerHTML = '<style>#dc-market-test th,#dc-market-test td{padding:.35rem .45rem;}#dc-market-test thead th{letter-spacing:0;}#dc-market-test tr[data-weak] th{background:inherit;}</style>' +
    '<details id="dc-market-test" style="margin:var(--sp2,1rem) 0;border:1px solid var(--border);border-radius:var(--radius);padding:.5rem .75rem;background:var(--bg2);">' +
    '<summary style="cursor:pointer;min-height:44px;font-weight:700;display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;">Can the market fill these homes? <span id="dc-mt-flag" role="status" aria-live="polite" style="font-weight:400;font-size:var(--small);color:var(--muted);">Open to count the renters who qualify</span></summary>' +
    '<div id="dc-mt-body" style="font-size:var(--small);line-height:1.45;"></div></details>';
  var det = doc.getElementById('dc-market-test'), body = doc.getElementById('dc-mt-body'), flag = doc.getElementById('dc-mt-flag');

  function draw() {
    if (!det.open) return;
    var c = county(), DC = global.__DealCalc, E = global.PMAMarketScoring;
    var say = function (t, f) { body.innerHTML = '<p style="margin:.3rem 0;">' + esc(t) + '</p>'; flag.textContent = f || ''; };
    if (!c) return say('Pick a county to count the renters who qualify there.', 'Pick a county first');
    var regime = doc.getElementById('dc-rent-limit-regime');
    if (regime && regime.value === 'market') return say('Market-rate homes have no income band, so there are no qualifying renters to count. Choose income-restricted rents to run this test.', 'Not for market-rate homes');
    var r = DC && DC.getResult ? DC.getResult() : null;
    var h = homesFrom(r && r.pricedRows);
    if (!Object.keys(h.byBand).length) return say('No income-restricted homes yet. Enter homes in at least one band up to 80% AMI.', 'No restricted homes yet');
    if (!E || !E.chfaQualifiedRenters) return say('The site’s renter count did not load. Reload to try again.');
    if (failed) return say(failed);
    if (!data) { say('Counting the renters who qualify in ' + c.name + '…', 'Counting…'); load().then(draw); return; }
    var saved = savedAreas(safeStorage(), c.fips).map(function (a) { a.saved = true; return a; });
    var countyArea = { key: 'county', tracts: Object.keys(data.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === c.fips; }), label: 'all of ' + c.name };
    var areas = saved.concat([countyArea]);
    var area = areas.filter(function (a) { return a.key === pick; })[0] || areas[0];
    var rec = ((data.limits && data.limits.counties) || []).filter(function (x) { return x.fips === c.fips; })[0];
    var bands = bandsFor(rec, h.byBand);
    // The count changes only with the area, the bands and the sizes, not with costs or rents: kept for the last ones.
    var ck = [c.fips, area.key, bands.join(','), JSON.stringify(h.sizesByBand), h.bedrooms.join(',')].join('|');
    if (!last || last.key !== ck) last = { key: ck, cnt: countRenters(E, data, area.tracts, bands, h.sizesByBand, h.bedrooms) };
    var cnt = last.cnt;
    var chk = captureCheck(h.byBand, cnt.pool, { sizesByBand: h.sizesByBand, poolFor: cnt.poolFor });
    body.innerHTML = render(h, area, cnt, chk, c.name, areas, area.key, c.fips);
    flag.textContent = chk.weak.length ? 'Weak in the ' + list(chk.weak.map(function (x) { return x.band + '%'; })) + ' band' + (chk.weak.length === 1 ? '' : 's') : 'Every band at 10% or less';
    flag.setAttribute('data-weak', chk.weak.map(function (x) { return x.band; }).join(','));
    flag.style.color = chk.weak.length ? 'var(--warn,#a15c00)' : 'var(--muted)';
  }
  function safeStorage() { try { return global.localStorage; } catch (_) { return null; } }
  function soon() { clearTimeout(timer); timer = setTimeout(draw, 150); }

  det.addEventListener('toggle', function () { if (det.open) draw(); });
  body.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 'dc-mt-area') { pick = ev.target.value; draw(); } });
  doc.addEventListener('deal-calc:updated', soon);
  doc.addEventListener('change', function (ev) { var t = ev.target; if (t && t.id === 'dc-county-select') pick = null; if (t && (t.id === 'dc-county-select' || t.id === 'dc-rent-limit-regime')) soon(); });
})(typeof window !== 'undefined' ? window : globalThis);
