// The free preliminary report for any Colorado place (drawing 4.3; paul 26 Oct: "download = preliminary HNA +
// market study, free and member editions"). #/report?g=<geoid> lays out printable pages: a cover, households
// and homes, who can afford what, the twenty-year need, the rental market, and notes on missing figures.
// "Download PDF" is the browser's own print to PDF, so nothing is generated or sent anywhere.
// Every figure is one the lab already shows: the HNA's per-place files, the Market check and For-sale parts
// (site/market.js), and the HNA's own "Where it's heading" chapter (site/hna.js). The member edition (site
// comparison, deal fit) stays on the member site; this page links to it and copies none of it.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, Pl = global.LabPlaces, M = global.LabMarket;
  var esc = Shell.esc, num = Pl.num, money = Pl.money;
  var LIVE = Pl.LIVE;
  var TITLE = 'Free report';

  // The figures the report leans on. One the files do not hold is listed under "Notes on missing figures".
  var KEY = [['median_hh_income', 'Median household income'], ['gross_rent_median', 'Median rent paid'], ['median_home_value', 'Typical home value'],
    ['pct_cost_burdened', 'Renters paying over 30% of income'], ['active_market_vacancy_rate_pct', 'Homes vacant and for rent or sale'],
    ['population_projection_20yr', 'Population in 20 years'], ['future_units_needed_20yr', 'Homes needed over 20 years']];
  var STRENGTH = { strong: 'Strong', mixed: 'Mixed', thin: 'Thin' };

  function pct(v) { return v == null ? null : (Math.round(v * 10) / 10) + '%'; }
  function srcOf(s, k) { var m = M.metric(s.c, k); return m ? global.LabHna.sourceOf(m, { geoid: s.entry.geoid }) : null; }

  // One tile: label, value, source. A missing value shows as "Not available" with the reason, never as zero.
  function tile(label, value, source, why) {
    return value != null
      ? '<li class="rpt-tile"><span class="rpt-l">' + esc(label) + '</span><span class="rpt-v">' + esc(value) + '</span><span class="rpt-s">' + esc(source || '') + '</span></li>'
      : '<li class="rpt-tile rpt-missing"><span class="rpt-l">' + esc(label) + '</span><span class="rpt-v">Not available</span><span class="rpt-s">' + esc(why || 'Not in the public files for this place.') + '</span></li>';
  }
  function tiles(list) { return '<ul class="rpt-tiles">' + list.join('') + '</ul>'; }

  // Sections run to more than one printed page, so the foot names the section, not a page number.
  function sheet(cls, body, foot, mark) {
    return '<section class="sheet' + (cls ? ' ' + cls : '') + '">' + body +
      '<p class="sheet-foot"><span>' + esc(foot) + '</span><span>' + esc(mark) + '</span></p></section>';
  }

  function report(params) {
    var g = params.get('g');
    if (!g) return M.picker('report', TITLE, 'A printable preliminary housing needs and market summary for any Colorado place, from public data.', params.get('q'), 'places');
    var s = M.gather(g, TITLE, 'places');
    if (s.html) return s.html;
    var st = global.LabStrength ? global.LabStrength.load() : null;
    if (st && !st.file && !st.error) return T.head({ kind: 'tool', crumbs: T.trail('places', TITLE), title: TITLE }) + '<p role="status" class="note">Reading the survey margins…</p>';
    if (!global.OwnershipFinance) return T.head({ kind: 'tool', crumbs: T.trail('places', TITLE), title: TITLE }) + '<p class="callout">The public site’s ownership engine did not load.</p>';

    var v = function (k) { var m = M.metric(s.c, k); return m ? m.value : null; };
    var name = s.name, here = s.isCounty ? Pl.AT.county : Pl.AT.place;
    var asOf = global.LAB_DATA_AS_OF ? new Date(global.LAB_DATA_AS_OF + 'T12:00:00Z') : new Date();
    var dated = asOf.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    var tally = st && st.file ? global.LabStrength.tally(g) : null, grade = st && st.file ? global.LabStrength.grade(tally) : null;
    var foot = name + ' · Preliminary summary · Free edition';
    var b30 = s.place ? s.place.bands[0] : null;

    // Cover.
    var cover = '<p class="rpt-brand">COHO Analytics</p><h2 class="rpt-title">Preliminary housing needs<br>and market summary</h2>' +
      '<p class="rpt-place">' + esc(s.entry.label) + (s.isCounty ? '' : ', ' + esc(s.countyName)) + '</p>' +
      '<p class="rpt-date">Public data as of ' + esc(dated) + '</p><p class="rpt-edition">Free edition</p>' +
      tiles([
        tile('Renter households', s.place ? num(s.place.rec.renter_households_total) : null, 'Source: Census ACS 2020–2024'),
        tile('Homes needed, 20 years', v('future_units_needed_20yr') != null ? num(v('future_units_needed_20yr')) : null, 'Source: ' + (srcOf(s, 'future_units_needed_20yr') || 'COHO HNA')),
        tile('Data strength', grade ? STRENGTH[grade] : null, 'Basis: Census survey margins', 'The margins file did not load.')
      ]) +
      '<h3>What is inside</h3><ol class="rpt-contents"><li>Households and homes</li><li>Who can afford what</li><li>Twenty-year need</li><li>Rental market</li><li>Notes on missing figures and sources</li></ol>';

    // 1. Households and homes.
    var vac = v('active_market_vacancy_rate_pct');
    var gapLine = b30 && b30.shortfall != null ? (b30.shortfall > 0
      ? name + ' has ' + num(b30.households) + ' renter households at or below 30% AMI and ' + num(b30.homes) + ' homes priced for them, ' + num(b30.shortfall) + ' more renters than homes.'
      : 'Homes priced at or below 30% AMI outnumber or match the renters at that income in ' + name + '.') : '';
    var one = '<h2>1. Households and homes</h2>' + (gapLine ? '<p class="chapter-finding">' + esc(gapLine) + '</p>' : '') +
      tiles([
        tile('Median household income', v('median_hh_income') != null ? money(v('median_hh_income')) : null, 'Source: ' + (srcOf(s, 'median_hh_income') || '')),
        tile('Renters paying over 30% of income', pct(v('pct_cost_burdened')), 'Source: ' + (srcOf(s, 'pct_cost_burdened') || '')),
        tile('Homes vacant, for rent or sale', pct(vac), 'Source: ' + (srcOf(s, 'active_market_vacancy_rate_pct') || ''), 'No vacancy figure is published for this place.')
      ]) +
      (s.place ? Pl.gapChart(s.place, here, s.d) : '<p class="note">The income gap file has no row for this place.</p>');

    // 2. Who can afford what: renters by the gap above, buyers by the ownership engine.
    var r = M.reachPart(s);
    var two = '<h2>2. Who can afford what</h2>' +
      tiles([
        tile('Most an 80% AMI household can pay for a home', r.at80 != null ? '$' + num(r.at80) : null, 'Source: COHO ownership engine'),
        tile('Typical home value', r.home != null ? '$' + num(r.home) : null, 'Source: ' + (srcOf(s, 'median_home_value') || '')),
        tile('Owners paying over 30% of income', pct(v('pct_owner_burdened_30plus')), 'Source: ' + (srcOf(s, 'pct_owner_burdened_30plus') || ''))
      ]) + (r.fig || '<p class="note">No home value or income limit is published for this place.</p>');

    // 3. Twenty-year need: the HNA's own chapter.
    var three = '<h2>3. Twenty-year need</h2>' + global.LabHna.chapter(s.c, g, 'future', s.entry, s.place);

    // 4. Rental market.
    var rent = M.rentPart(s), supply = M.supplyPart(s);
    var cap = M.capturePart(s, 60, 60, true);
    var four = '<h2>4. Rental market</h2>' + rent.fig + '<h3>Tax credit supply in ' + esc(s.countyName) + '</h3>' + supply.html +
      '<h3>Capture rate for a 60-home project at 60% AMI</h3>' + cap.html;

    // 5. Notes: what is missing, how strong the data is, and what this report is not.
    var missing = KEY.filter(function (k) { return v(k[0]) == null; }).map(function (k) { return k[1]; });
    if (rent.zr == null) missing.push('Typical asking rent (Zillow covers no city or county row for it)');
    if (!s.place) missing.push('Renters and homes by income band');
    var five = '<h2>5. Notes on missing figures and sources</h2>' +
      '<div class="rpt-notes"><h3>Missing figures</h3>' + (missing.length ? '<ul>' + missing.map(function (x) { return '<li>' + esc(x) + ': not published for ' + esc(name) + '.</li>'; }).join('') + '</ul>'
        : '<p>Every figure this report uses is published for ' + esc(name) + '.</p>') +
      '<h3>How strong the data is</h3><p>' + (tally ? esc(tally.good + ' of ' + tally.total + ' survey figures rate good' + (tally.fair ? ', ' + tally.fair + ' fair' : '') + (tally.caution ? ', ' + tally.caution + ' use with caution' : '') + '.') + ' ' : '') +
      'Census survey samples shrink with population, so small places carry wider margins. Read figures for a small place as a range. The rating is about how certain the figures are, not about the place.</p>' +
      '<h3>What this report is not</h3><p>It is a screen from public data, not a market study. It draws no market area around a site. The capture rate uses the whole county and a sample 60-home project at 60% AMI. Supply and rent limits are county-wide. Every figure carries its source under it.</p></div>' +
      '<div class="callout no-print">The member edition adds a market area around your site, site comparison and deal fit. It is on the <a href="' + esc(LIVE + 'market-analysis.html') + '">member site ↗</a>.</div>';

    return T.head({
      kind: 'tool', crumbs: T.trail('places', TITLE, [{ label: 'Pick a place', href: '#/report' }]), title: 'Free report: ' + s.entry.label,
      answer: 'A preliminary housing needs and market summary you can print or save as a PDF. Five short sections, every figure sourced.',
      aside: '<div class="actions report-actions"><button type="button" class="button-link" data-print>Download PDF</button>' +
        '<a class="button-link secondary" href="#/place/' + esc(g) + '">Full needs assessment</a><a class="button-link secondary" href="#/market?g=' + esc(g) + '">Market check</a></div>' +
        '<p class="note">Download opens your browser’s print window; choose “Save as PDF”.</p>'
    }) +
      '<article class="report" aria-label="Preliminary summary for ' + esc(s.entry.label) + '">' +
      sheet('sheet-cover', cover, 'COHO Analytics · cohoanalytics.com', 'Free edition') +
      [one, two, three, four, five].map(function (x, i) { return sheet('', x, foot, 'Section ' + (i + 1) + ' of 5'); }).join('') +
      '</article>';
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-print]');
    if (b) { ev.preventDefault(); global.print(); }
  });

  Shell.views.report = report;
  global.LabReport = { report: report, KEY: KEY };
})(window);
