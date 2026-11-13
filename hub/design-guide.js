// Design, health and community (#/design): how the building makes small affordable homes work, brings
// neighbours together and supports health. A lab page to port (paul, 4 Nov 2026: build it now so it gets the
// new graphic standard with the pages going live). Every word comes from the live site's own research brief,
// data/policy_briefs_curated.json, id livability-universal-design-2026, at the pin; the lab orders it for a
// planner and adds graphics drawn from that brief, from C.R.S. 9-5-105 and from the State Demography Office's
// file the HNA reads (data/hna/dola_sya/08000.json). No figure here is typed in by hand.
// Illustration slots (data-illus) are for the building drawings from Gemini Round 9; until they land, the
// slots show nothing extra.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc;
  var FILES = { feed: 'data/policy_briefs_curated.json', sya: 'data/hna/dola_sya/08000.json' };
  var BRIEF_ID = 'livability-universal-design-2026';
  var LIVE = 'https://cohoanalytics.com/research-brief.html?id=' + BRIEF_ID;
  var CRS = 'https://colorado.public.law/statutes/crs_9-5-105';
  var SB109 = 'https://leg.colorado.gov/bill_files/115906/download';
  var QAP = 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf';
  var SDO = 'https://storage.googleapis.com/co-publicdata/sya-county.csv';

  // The order a planner reads it in: the home, the street, health, then who must be able to use it, then the rules.
  var ORDER = [
    { id: 'functional-design', short: 'Small homes' },
    { id: 'community', short: 'Street to home' },
    { id: 'safety', short: 'Safety', illus: 'eyes-on-street' },
    { id: 'privacy', short: 'Privacy and quiet' },
    { id: 'green-happiness', short: 'Green and health', graphic: 'evidence', illus: 'courtyard' },
    { id: 'universal-design', short: 'Access' },
    { id: 'neuro-inclusive', short: 'Neuro-inclusive', fold: true },
    { id: 'supportive-housing', short: 'Supportive housing', fold: true },
    { id: 'qap', short: 'What CHFA asks' },
    { id: 'limits', short: 'Limits' }
  ];

  function brief(feed) { return ((feed && feed.briefs) || []).filter(function (b) { return b && b.id === BRIEF_ID; })[0] || null; }
  function sectionOf(b, id) { return (b.sections || []).filter(function (s) { return s && s.id === id; })[0] || null; }

  // C.R.S. 9-5-105: 6 points for 7 to 14 homes, 12 for 15 to 28, and 6 more for every further 14 homes or part of 14.
  // Below 7 homes a privately funded building is not covered.
  function accessPoints(homes) { return homes < 7 ? 0 : 6 * Math.ceil(homes / 14); }
  // SB26-109: at 50 or more homes, at least 2% must be accessible units (rounded up to whole homes).
  function minAccessibleUnits(homes) { return homes >= 50 ? Math.ceil(homes * 0.02) : 0; }

  function src(html) { return '<p class="metric-source">Source: ' + html + '</p>'; }
  function a(href, text) { return '<a href="' + esc(href) + '">' + esc(text) + '</a>'; }

  // ---------- Graphic: street to home ----------
  // The brief's own five steps, coloured from public (light) to private (dark), one row each on a phone.
  function stepsGraphic(sec) {
    var st = sec && sec.steps;
    if (!st || !Array.isArray(st.items) || !st.items.length) return '';
    var items = st.items.filter(function (x) { return x && typeof x.label === 'string'; });
    return '<figure class="dg-steps" aria-labelledby="dg-steps-cap"><figcaption id="dg-steps-cap" class="viz-title">' + esc(st.caption || 'From street to home') + '</figcaption>' +
      '<ol>' + items.map(function (x, i) {
        return '<li class="dg-step dg-step-' + i + '" data-illus="street-to-home-' + (i + 1) + '"><span class="dg-step-n" aria-hidden="true">' + (i + 1) + '</span>' +
          '<span class="dg-step-body"><strong>' + esc(x.label) + '</strong>' + (x.level ? ' <span class="dg-step-level">' + esc(x.level) + '</span>' : '') +
          (x.text ? '<span class="dg-step-text">' + esc(x.text) + '</span>' : '') + '</span></li>';
      }).join('') + '</ol><p class="dg-steps-ends" aria-hidden="true"><span>More public</span><span>More private</span></p>' +
      src(a(LIVE + '#brief-section-community', 'COHO research brief, after Alexander (1977) and Gehl')) + '</figure>';
  }

  // ---------- Graphic: how strong is the evidence ----------
  // The brief's green-space findings sorted by how each study was designed. Stronger designs first.
  var LEVELS = [
    { key: 'trial', label: 'Randomized trial', test: /randomi[sz]ed/i },
    { key: 'natural', label: 'Natural experiment or same people over time', test: /natural experiment|same people|panel/i },
    { key: 'before', label: 'Before and after, or comparison', test: /before and after|comparison/i },
    { key: 'obs', label: 'Survey or correlation', test: /./ }
  ];
  function levelOf(design) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].test.test(design)) return i;
    return LEVELS.length - 1;
  }
  function evidenceGraphic(sec) {
    var t = sec && sec.table;
    if (!t || !Array.isArray(t.rows) || !t.rows.length) return '';
    var groups = LEVELS.map(function () { return []; });
    t.rows.forEach(function (r) { if (Array.isArray(r) && r.length >= 2) groups[levelOf(String(r[1]))].push(r); });
    var total = t.rows.length;
    return '<figure class="dg-evidence" aria-labelledby="dg-ev-cap"><figcaption id="dg-ev-cap" class="viz-title">How strong is the evidence on green space and health?</figcaption>' +
      '<p class="viz-answer">' + groups[0].length + ' of ' + total + ' findings come from randomized trials; the rest compare people or places without random assignment.</p>' +
      '<ul class="dg-ev-scale">' + LEVELS.map(function (l, i) {
        return '<li class="dg-ev-' + l.key + '"><span class="dg-ev-dots" aria-hidden="true">' + groups[i].map(function () { return '<i></i>'; }).join('') + '</span>' +
          '<span class="dg-ev-label"><strong>' + groups[i].length + '</strong> ' + esc(l.label) + '</span></li>';
      }).join('') + '</ul>' +
      '<details class="dg-fold"><summary>Each finding, strongest design first</summary><ol class="dg-ev-list">' + groups.map(function (g, i) {
        return g.map(function (r) { return '<li><span class="dg-ev-tag dg-ev-' + LEVELS[i].key + '">' + esc(r[1]) + '</span> ' + esc(r[0]) + '</li>'; }).join('');
      }).join('') + '</ol></details>' +
      src(a(LIVE + '#brief-section-green-happiness', 'COHO research brief, the studies it cites') + briefDate()) + '</figure>';
  }

  // ---------- Graphic: accessibility points by building size ----------
  // A step line of C.R.S. 9-5-105 points from 7 to 120 homes, with labelled dots, and the SB26-109 line at 50 homes.
  function accessGraphic(noAnswer) {
    var W = 320, H = 220, x0 = 30, x1 = 310, y0 = 184, y1 = 20, maxH = 120, maxP = accessPoints(maxH);
    var X = function (h) { return x0 + (x1 - x0) * h / maxH; }, Y = function (p) { return y0 - (y0 - y1) * p / maxP; };
    var d = '', path = 'M' + X(7).toFixed(1) + ' ' + Y(accessPoints(7)).toFixed(1);
    for (var h = 8; h <= maxH; h++) {
      var p0 = accessPoints(h - 1), p1 = accessPoints(h);
      if (p1 !== p0) path += ' L' + X(h - 1).toFixed(1) + ' ' + Y(p0).toFixed(1) + ' L' + X(h - 1).toFixed(1) + ' ' + Y(p1).toFixed(1);
    }
    path += ' L' + X(maxH).toFixed(1) + ' ' + Y(accessPoints(maxH)).toFixed(1);
    [0, 24, 48].forEach(function (p) { d += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(p) + '" y2="' + Y(p) + '" class="dg-grid"/><text x="' + (x0 - 5) + '" y="' + (Y(p) + 4) + '" class="dg-ax" text-anchor="end">' + p + '</text>'; });
    d += '<line x1="' + X(50) + '" x2="' + X(50) + '" y1="' + y1 + '" y2="' + y0 + '" class="dg-rule"/><text x="' + (X(50) - 5) + '" y="' + (y1 + 12) + '" class="dg-note" text-anchor="end">2% rule from 50</text>';
    d += '<path d="' + path + '" class="dg-line"/>';
    // Each marked size sits at the right end of a flat step or partway along one, so its label goes above and to the left, clear of the line.
    [14, 28, 60, 100].forEach(function (hh) {
      var p = accessPoints(hh), cx = X(hh), cy = Y(p);
      var below = hh === 60; // its label would cross the 50-home rule above-left, so it goes below-right
      d += '<circle cx="' + cx + '" cy="' + cy + '" r="5" class="dg-dot"/><text x="' + (below ? cx + 6 : cx - 4) + '" y="' + (below ? cy + 20 : cy - 9) + '" class="dg-lbl" text-anchor="' + (below ? 'start' : 'end') + '">' + p + ' pts</text>';
      d += '<text x="' + cx + '" y="' + (y0 + 17) + '" class="dg-ax" text-anchor="middle">' + hh + '</text>';
    });
    d += '<text x="' + ((x0 + x1) / 2) + '" y="' + (H - 5) + '" class="dg-ax" text-anchor="middle">Homes in the building</text>';
    var ex = 60, exP = accessPoints(ex);
    return '<figure class="dg-access" aria-labelledby="dg-acc-cap"><figcaption id="dg-acc-cap" class="viz-title">Accessibility points a Colorado building needs</figcaption>' +
      (noAnswer ? '' : '<p class="viz-answer">A ' + ex + '-home building needs ' + exP + ' points: for example ' + Math.ceil(exP / 6) + ' Type A homes (6 points each), or ' + Math.ceil(exP / 4) + ' Type B homes (4 each).' +
      (minAccessibleUnits(ex) ? ' At 50 homes or more, at least ' + minAccessibleUnits(ex) + ' of them must be accessible units.' : '') + '</p>') +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Accessibility points rise by 6 for every 14 homes: ' + [14, 28, 60, 100].map(function (hh) { return accessPoints(hh) + ' points at ' + hh + ' homes'; }).join(', ') + '. From 50 homes, 2% of homes must be accessible units.">' + d + '</svg>' +
      src(a(CRS, 'C.R.S. 9-5-105') + ' (points by size); ' + a(SB109, 'SB26-109') + ', signed 5 May 2026 (2% at 50+ homes)') + '</figure>';
  }

  // ---------- Graphic: Coloradans 65 and older ----------
  function seniorsGraphic(sya) {
    var sp = sya && sya.seniorPressure;
    if (!sp || !Array.isArray(sp.years) || !Array.isArray(sp.share65plus) || sp.years.length < 2) return '';
    var rows = sp.years.map(function (y, i) { return { y: y, s: sp.share65plus[i], n: sp.pop65plus && sp.pop65plus[i] }; }).filter(function (r) { return r.s != null; });
    var W = 320, H = 150, x0 = 22, x1 = 298, ymin = 14, ymax = 22, a0 = rows[0].y, a1 = rows[rows.length - 1].y;
    var X = function (y) { return x0 + (x1 - x0) * (y - a0) / (a1 - a0); }, Y = function (s) { return 110 - 80 * (s - ymin) / (ymax - ymin); };
    var d = '<polyline points="' + rows.map(function (r) { return X(r.y).toFixed(1) + ',' + Y(r.s).toFixed(1); }).join(' ') + '" class="dg-line"/>';
    var label = { 2020: 1, 2030: 1, 2050: 1 };
    rows.forEach(function (r) {
      d += '<circle cx="' + X(r.y) + '" cy="' + Y(r.s) + '" r="' + (label[r.y] ? 5 : 3) + '" class="dg-dot"/>';
      if (label[r.y]) d += '<text x="' + X(r.y) + '" y="' + (r.y === a0 ? Y(r.s) + 22 : Y(r.s) - 10) + '" class="dg-lbl" text-anchor="' + (r.y === a0 ? 'start' : r.y === a1 ? 'end' : 'middle') + '">' + (Math.round(r.s * 10) / 10) + '%</text>';
      if (label[r.y]) d += '<text x="' + X(r.y) + '" y="' + (H - 12) + '" class="dg-ax" text-anchor="' + (r.y === a0 ? 'start' : r.y === a1 ? 'end' : 'middle') + '">' + r.y + '</text>';
    });
    var first = rows[0], mid = rows.filter(function (r) { return r.y === 2030; })[0] || rows[1];
    var fmtK = function (n) { return n == null ? '' : (Math.round(n / 1000)).toLocaleString('en-US') + 'K'; };
    return '<figure class="dg-seniors" aria-labelledby="dg-sen-cap"><figcaption id="dg-sen-cap" class="viz-title">Coloradans 65 and older, share of all residents</figcaption>' +
      '<p class="viz-answer">From ' + fmtK(first.n) + ' (' + (Math.round(first.s * 10) / 10) + '%) in ' + first.y + ' to ' + fmtK(mid.n) + ' (' + (Math.round(mid.s * 10) / 10) + '%) in ' + mid.y + '. A building financed now will house many of them.</p>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Share of Coloradans aged 65 and older: ' + rows.map(function (r) { return r.y + ' ' + (Math.round(r.s * 10) / 10) + '%'; }).join(', ') + '.">' + d + '</svg>' +
      src(a(SDO, 'Colorado State Demography Office, single year of age by county') + (sya.updated ? ', file read ' + esc(String(sya.updated).slice(0, 10)) : '')) + '</figure>';
  }

  // ---------- Graphic: what CHFA requires and scores ----------
  function qapGraphic(sec) {
    var t = sec && sec.table;
    if (!t || !Array.isArray(t.rows)) return '';
    var groups = [
      { key: 'req', label: 'Required of every project', test: /^Required$/ },
      { key: 'pts', label: 'Earns points', test: /^\d+ points?$/ },
      { key: 'set', label: 'Required for set-aside points', test: /^Required for/ },
      { key: 'oth', label: 'Reviewed or more competitive', test: /./ }
    ];
    var rows = t.rows.filter(function (r) { return Array.isArray(r) && r.length >= 3; });
    var picked = groups.map(function (g) { return rows.filter(function (r) { var gi = 0; while (gi < groups.length && !groups[gi].test.test(String(r[1]))) gi++; return groups[gi] === g; }); });
    return '<figure class="dg-qap" aria-labelledby="dg-qap-cap"><figcaption id="dg-qap-cap" class="viz-title">What CHFA requires, scores and rewards</figcaption>' +
      '<p class="viz-answer">' + picked[0].length + ' design items are required of every tax credit project; ' + picked[1].length + ' more earn points.</p>' +
      '<div class="dg-qap-cols">' + groups.map(function (g, i) {
        if (!picked[i].length) return '';
        return '<div class="dg-qap-col dg-qap-' + g.key + '"><p class="dg-qap-h">' + esc(g.label) + ' <span>' + picked[i].length + '</span></p><ul>' + picked[i].map(function (r) {
          return '<li>' + esc(r[0]) + ' <span class="dg-qap-sec">' + (g.key === 'pts' ? esc(r[1]) + ' · ' : '') + '§' + esc(r[2]) + '</span></li>';
        }).join('') + '</ul></div>';
      }).join('') + '</div>' +
      src(a(QAP, 'CHFA 2027-28 QAP') + ', adopted 25 Sept 2026, approved by the Governor 23 Oct 2026') + '</figure>';
  }

  // ---------- The brief's own text ----------
  var BRIEF_CHECKED = '';
  function briefDate() { return BRIEF_CHECKED ? ', checked ' + esc(BRIEF_CHECKED) : ''; }
  function textOf(sec, skip) {
    var h = (sec.paragraphs || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    if (Array.isArray(sec.items) && sec.items.length) h += (sec.items_heading ? '<h3>' + esc(sec.items_heading) + '</h3>' : '') + '<ul class="dg-list">' + sec.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    var t = sec.table;
    if (t && !skip.table && Array.isArray(t.columns) && Array.isArray(t.rows)) {
      h += '<details class="dg-fold"><summary>' + esc(t.caption || 'The table') + '</summary><div class="table-scroll"><table>' + '<thead><tr>' + t.columns.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        t.rows.map(function (r) { return '<tr>' + (Array.isArray(r) ? r : []).map(function (c, i) { return i ? '<td>' + esc(String(c)) + '</td>' : '<th scope="row">' + esc(String(c)) + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
      h += src(a(LIVE, 'COHO research brief, the studies it cites') + briefDate());
    }
    if (sec.see_also && typeof sec.see_also.text === 'string') h += '<p class="note">' + esc(sec.see_also.text) + '</p>';
    if (sec.note) h += '<p class="note">' + esc(sec.note) + '</p>';
    return h;
  }

  // Research topic: one fold per brief section, holding the brief's own text.
  function section(b, o) {
    var sec = sectionOf(b, o.id);
    if (!sec) return '';
    var illus = o.illus ? '<div class="dg-illus" data-illus="' + esc(o.illus) + '" aria-hidden="true"></div>' : '';
    var text = o.id === 'green-happiness' ? textOf({ paragraphs: sec.paragraphs, table: sec.table }, {}) : textOf(sec, {});
    return '<details id="dg-' + esc(o.id) + '" class="dg-fold dg-research"><summary>' + esc(sec.heading) + '</summary>' + illus + text + '</details>';
  }

  // ---------- The first-site-plan checklist ----------
  // Law rows state the statutes this page already cites; CHFA rows are the brief's QAP table; good-practice
  // rows are the brief's own list of what makes a small home work. Ticks stay in this browser only.
  var FHA = 'https://www.ecfr.gov/current/title-24/subtitle-B/chapter-I/subchapter-A/part-100/subpart-D/section-100.205';
  var S504 = 'https://www.ecfr.gov/current/title-24/subtitle-A/part-8/subpart-C/section-8.22';
  var KEY = 'coho-design-checklist';
  function checklistRows(b) {
    var law = [
      { tag: 'law', text: 'Accessibility points for the building’s size: 6 for 7 to 14 homes, 6 more for every further 14 (use the tool below)', src: 'C.R.S. 9-5-105', href: CRS },
      { tag: 'law', text: 'At 50 or more homes, at least 2% accessible units, including at least one Type A, Type B or Type C home', src: 'SB26-109', href: SB109 },
      { tag: 'law', text: 'Fair Housing Act design features in covered homes: every home in an elevator building, ground-floor homes otherwise', src: '24 CFR 100.205', href: FHA },
      { tag: 'law', text: 'With HUD money such as HOME: 5% of homes for mobility and 2% for hearing or vision (Section 504)', src: '24 CFR 8.22', href: S504 }
    ];
    var q = sectionOf(b, 'qap'), rows = (q && q.table && q.table.rows) || [];
    var chfa = rows.filter(function (r) { return Array.isArray(r) && (r[1] === 'Required' || /^\d+ points?$/.test(r[1])); }).map(function (r) {
      return { tag: r[1] === 'Required' ? 'req' : 'pts', pts: r[1] === 'Required' ? '' : r[1], text: r[0], src: 'QAP §' + r[2], href: QAP };
    });
    chfa.sort(function (x, y) { return (x.tag === 'req' ? 0 : 1) - (y.tag === 'req' ? 0 : 1); });
    var f = sectionOf(b, 'functional-design');
    var good = ((f && f.items) || []).map(function (t) { return { tag: 'good', text: t, src: 'COHO research brief', href: LIVE + '#brief-section-functional-design' }; });
    return law.concat(chfa, good).map(function (r) { r.id = hash(r.text); return r; });
  }
  function hash(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return 'i' + (h >>> 0).toString(36); }
  function ticks() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveTicks(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* private window: ticks last this visit only */ } }
  var TAGS = { law: 'Law', req: 'CHFA requires', pts: 'CHFA points', good: 'Good practice' };
  var GROUPS = [['law', 'Required by law'], ['req', 'Required by CHFA for tax credits'], ['pts', 'Earns CHFA points'], ['good', 'Good practice for small homes']];
  function checklist(b) {
    var rows = checklistRows(b), t = ticks(), done = rows.filter(function (r) { return t[r.id]; }).length;
    return '<section id="dg-checklist" tabindex="-1" class="dg-sec"><h2>Check these on the first site plan</h2>' +
      '<p class="dg-progress" aria-live="polite"><strong data-dg-done>' + done + '</strong> of ' + rows.length + ' on your plan</p>' +
      GROUPS.map(function (g) {
        var list = rows.filter(function (r) { return r.tag === g[0]; });
        if (!list.length) return '';
        var head = '<h3 class="dg-cl-h dg-cl-' + g[0] + '">' + esc(g[1]) + ' <span>' + list.length + '</span></h3>';
        var body = '<ul class="dg-cl">' + list.map(function (r) {
          return '<li><label><input type="checkbox" data-dg-item="' + r.id + '"' + (t[r.id] ? ' checked' : '') + '><span class="dg-cl-text">' + esc(r.text) +
            (r.pts ? ' <strong class="dg-cl-pts">' + esc(r.pts) + '</strong>' : '') + '</span></label> <a class="dg-cl-src" href="' + esc(r.href) + '">' + esc(r.src) + '</a></li>';
        }).join('') + '</ul>';
        // The long good-practice list folds, so the rules come first.
        return g[0] === 'good' ? '<details class="dg-fold dg-cl-fold"' + (list.some(function (r) { return t[r.id]; }) ? ' open' : '') + '><summary>' + head + '</summary>' + body + '</details>' : head + body;
      }).join('') +
      '<p class="note">Ticks stay in this browser only. CHFA items are from its adopted 2027-28 QAP; good-practice items are COHO’s recommendations from the cited studies.</p></section>';
  }

  // ---------- The accessibility tool ----------
  function accessResult(homes, hud) {
    homes = Math.floor(+homes);
    if (!(homes >= 1) || homes > 2000) return '<p class="note">Enter the number of homes, 1 to 2,000.</p>';
    var p = accessPoints(homes), out = [];
    if (!p) out.push('<li><strong>No points needed.</strong> Colorado’s schedule starts at 7 homes for a privately funded building. A building with public money is covered at any size: check with the building department.</li>');
    else out.push('<li><strong>' + p + ' accessibility points.</strong> For example ' + Math.ceil(p / 6) + ' Type A homes (6 each), or ' + Math.ceil(p / 4) + ' Type B homes (4 each), or a mix.</li>');
    var m = minAccessibleUnits(homes);
    if (m) out.push('<li><strong>At least ' + m + ' accessible units</strong> (2% at 50 or more homes, rounded up), including at least one Type A, Type B or Type C home.</li>');
    if (hud) out.push('<li><strong>Section 504: ' + Math.ceil(homes * 0.05) + ' homes for mobility and ' + Math.ceil(homes * 0.02) + ' for hearing or vision</strong> (5% and 2%, rounded up).</li>');
    out.push('<li><strong>CHFA points:</strong> ' + Math.ceil(homes * 0.05) + ' Type A homes (5%) earn 2 points, as does universal design.</li>');
    return '<ul class="dg-tool-out">' + out.join('') + '</ul>';
  }
  var SYA = null;
  function tool() {
    return '<section id="dg-tool" tabindex="-1" class="dg-sec"><h2>How many accessible homes?</h2>' +
      '<div class="dg-tool"><label class="dg-tool-in">Homes in the building <input type="number" inputmode="numeric" min="1" max="2000" value="60" data-dg-homes></label>' +
      '<label class="dg-tool-hud"><input type="checkbox" data-dg-hud> HUD money (such as HOME)</label>' +
      '<div data-dg-out aria-live="polite">' + accessResult(60, false) + '</div>' +
      src(a(CRS, 'C.R.S. 9-5-105') + '; ' + a(SB109, 'SB26-109') + ', signed 5 May 2026; ' + a(S504, '24 CFR 8.22') + '; ' + a(QAP, 'CHFA 2027-28 QAP §5.B.3.g')) +
      '<p class="note">A first check, not a code review. The building department and CHFA have the final word.</p></div>' +
      accessGraphic(true) + seniorsGraphic(SYA) + '</section>';
  }
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t.closest || !t.closest('#dg-tool')) return;
    var box = t.closest('#dg-tool'), out = box.querySelector('[data-dg-out]');
    if (out) out.innerHTML = accessResult(box.querySelector('[data-dg-homes]').value, box.querySelector('[data-dg-hud]').checked);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.closest && t.closest('#dg-tool')) { t.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (!t.dataset || !t.dataset.dgItem) return;
    var all = ticks(); if (t.checked) all[t.dataset.dgItem] = 1; else delete all[t.dataset.dgItem];
    saveTicks(all);
    var n = document.querySelectorAll('#dg-checklist [data-dg-item]:checked').length, el = document.querySelector('[data-dg-done]');
    if (el) el.textContent = n;
  });

  function sources(b) {
    var arts = Array.isArray(b.articles) ? b.articles : [];
    return '<section id="dg-sources" tabindex="-1" class="dg-sec"><h2>Sources</h2><details class="dg-fold"><summary>All ' + arts.length + ' sources the brief cites</summary><ol class="brief-sources">' + arts.map(function (x) {
      var href = typeof x.link === 'string' && /^https?:\/\//.test(x.link) ? x.link : null, t = esc(x.title || x.link || 'Source');
      return '<li>' + (href ? '<a href="' + esc(href) + '">' + t + '</a>' : t) + ([x.source, x.date].filter(Boolean).length ? ' <span class="research-meta">' + esc([x.source, x.date].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>';
    }).join('') + '</ol></details></section>';
  }

  // Related pages elsewhere on the site that carry design material, linked rather than repeated.
  var RELATED = [
    { href: '#/guide/green-building', label: 'Green building in a Colorado deal', desc: 'CHFA certification, energy and water rules, costs and programs.' },
    { href: '#/guide/resident-services', label: 'Resident services', desc: 'Services that help residents stay housed, and the rooms they need.' },
    { href: '#/research/brief/neuro-inclusive-housing-colorado-2026', label: 'Neuro-inclusive housing', desc: 'Homes for people with intellectual and developmental disabilities.' },
    { href: '#/guide/fair-housing', label: 'Fair housing', desc: 'What federal fair housing rules still require.' }
  ];

  function view() {
    var s = UI.load(FILES);
    var crumbs = T.trail('deal', 'Design, health and community');
    var title = 'Design, health and community';
    if (!s.data) return T.head({ kind: 'guide', crumbs: crumbs, title: title }) + (s.error ? '<p class="callout">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading…</p>');
    var b = brief(s.data.feed);
    BRIEF_CHECKED = b && (b.verified || String(b.generated || '').slice(0, 10)) || '';
    if (!b) return T.head({ kind: 'guide', crumbs: crumbs, title: title }) + '<p class="callout">The design brief is not in the research file at this pin.</p>';
    var sp = s.data.sya && s.data.sya.seniorPressure, i2030 = sp && sp.years ? sp.years.indexOf(2030) : -1;
    var share2030 = i2030 > -1 ? (Math.round(sp.share65plus[i2030] * 10) / 10) + '%' : null;
    var research = ORDER.filter(function (o) { return !o.lead && sectionOf(b, o.id); });
    return T.head({
      kind: 'guide', crumbs: crumbs, title: title,
      answer: 'Decide these on the first site plan. They cost little then and a lot after construction drawings.',
      meta: esc('Accessibility, room layout, porches and shared rooms decide whether a small affordable home works. From COHO’s research brief, checked ' + (b.verified || 'date unavailable') + '.'),
      facts: [
        { value: '6 per 14 homes', label: 'Accessibility points a building of 7 or more homes needs', source: 'C.R.S. 9-5-105', href: CRS },
        { value: '2%', label: 'Accessible units required in projects of 50 or more homes', source: 'SB26-109', href: SB109 },
        { value: '2 points', label: 'CHFA score for universal design or Type A units in 5% of homes', source: 'CHFA 2027-28 QAP §5.B.3.g', href: QAP },
        share2030 ? { value: share2030, label: 'Coloradans 65 and older in 2030', source: 'State Demography Office', href: SDO } : {}
      ]
    }) +
      '<div class="dg-illus dg-illus-lead" data-illus="small-home" aria-hidden="true"></div>' +
      T.onThisPage([{ id: 'dg-checklist', title: 'Checklist' }, { id: 'dg-tool', title: 'Accessible homes' }, { id: 'dg-street', title: 'Street to home' }, { id: 'dg-chfa', title: 'CHFA and the evidence' }, { id: 'dg-research-all', title: 'The research' }, { id: 'dg-related', title: 'Related pages' }], true) +
      checklist(b) + (SYA = s.data.sya, tool()) +
      '<section id="dg-street" tabindex="-1" class="dg-sec"><h2>Street to home</h2>' + stepsGraphic(sectionOf(b, 'community')) + '</section>' +
      '<section id="dg-chfa" tabindex="-1" class="dg-sec"><h2>What CHFA scores, and how strong the evidence is</h2>' + qapGraphic(sectionOf(b, 'qap')) + evidenceGraphic(sectionOf(b, 'green-happiness')) + '</section>' +
      '<section id="dg-research-all" tabindex="-1" class="dg-sec"><h2>The research behind it</h2><p class="lede">Each topic opens to the brief’s own summary of the studies.</p>' +
      research.map(function (o) { return section(b, o); }).join('') + '</section>' + sources(b) +
      '<section id="dg-related" tabindex="-1" class="dg-sec"><h2>Related pages</h2><ul class="dg-related">' + RELATED.map(function (r) {
        return '<li><a href="' + esc(r.href) + '">' + esc(r.label) + '</a><span>' + esc(r.desc) + '</span></li>';
      }).join('') + '</ul></section>' +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Test the deal →' }, { href: '#/guide/green-building', label: 'Green building', secondary: true }]);
  }

  Shell.views.design = view;
  global.LabDesignGuide = { view: view, accessResult: accessResult, checklistRows: checklistRows, FILES: FILES, BRIEF_ID: BRIEF_ID, ORDER: ORDER, accessPoints: accessPoints, minAccessibleUnits: minAccessibleUnits, levelOf: levelOf, LEVELS: LEVELS };
})(window);
