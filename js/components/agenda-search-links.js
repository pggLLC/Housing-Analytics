/*
 * agenda-search-links.js
 *
 * F162 — Targeted Google searches for housing topics on actual city /
 * county council + planning agendas, minutes, and staff reports.
 *
 * The existing HNA "Housing on the agenda" panel uses broad
 * `site:domain housing` queries that surface a LOT of noise (CIP
 * documents, parks meetings, archived 2003 PDFs). This component
 * builds laser-targeted queries that:
 *
 *   1. Quote phrase-match the actual document type ("council agenda",
 *      "planning commission minutes") so we hit agendas/minutes and
 *      not random PDFs.
 *   2. Wrap the housing terms in an OR group so we catch the full
 *      housing vocabulary ("affordable housing", "workforce housing",
 *      density bonus, ADU, inclusionary, rezoning, comp plan, etc.).
 *   3. Time-bound with both `after:YYYY-MM-DD` (Google operator) AND
 *      the `tbs=qdr:m12` / `tbs=qdr:m6` URL param (UI filter) so
 *      Google honors recency on BOTH the query and the result-page
 *      sidebar.
 *   4. Use `filetype:pdf` for the agenda + minutes queries — those
 *      records are almost always posted as PDFs.
 *   5. Auto-rewrite "City Council" → "Board of County Commissioners"
 *      / "BoCC" and "Planning Commission" → "County Planning
 *      Commission" for county geographies.
 *
 * Pure URL construction. No fetches, no external data, no DOM.
 *
 * Exposes: window.AgendaSearchLinks.build({ jurisdictionName, isCounty })
 *   → Array<{ label, url, summary }>
 */
(function (global) {
  'use strict';

  // ── Date helpers ────────────────────────────────────────────────
  // `after:YYYY-MM-DD` is the Google search operator; `tbs=qdr:m12`
  // is the UI sidebar filter. Use both so a user clicking through
  // doesn't see Google quietly drop the recency filter.

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function isoMonthsAgo(monthsBack) {
    var d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function googleUrl(query, qdr) {
    var base = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    if (qdr) base += '&tbs=' + encodeURIComponent('qdr:' + qdr);
    return base;
  }

  // ── Body-name helpers (city vs. county) ─────────────────────────
  // For county geographies, swap in BoCC / County Planning Commission
  // language. Many Colorado counties use "Board of County
  // Commissioners" (BoCC) in their published PDFs.

  function councilName(isCounty) {
    return isCounty
      ? '("Board of County Commissioners" OR "BoCC" OR "County Commissioners")'
      : '("City Council" OR "Town Council" OR "Town Board")';
  }

  function planningName(isCounty) {
    return isCounty
      ? '("County Planning Commission" OR "Planning Commission")'
      : '("Planning Commission" OR "Planning Board")';
  }

  // ── Likely municipal domain guesses ─────────────────────────────
  // We don't know the actual gov domain here (the renderer that
  // wires the curated record passes its own govDomain into the
  // existing F95 panel). For laser-targeted searches we use a
  // best-guess site: filter that matches the dominant Colorado
  // municipal domain patterns.

  function slugify(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/\bcity of\b|\btown of\b|\bcounty\b/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }

  function siteFilter(jurisName, isCounty) {
    var slug = slugify(jurisName);
    if (!slug) return '';
    // Use OR group across the four dominant patterns in CO:
    //   <city>.gov   <city>co.gov   <city>.co.us   <county>county.gov
    // The OR group is fine inside a Google query.
    var parts = [
      'site:' + slug + '.gov',
      'site:' + slug + 'co.gov',
      'site:' + slug + '.co.us',
      'site:' + slug + 'co.us'
    ];
    if (isCounty) {
      parts.push('site:' + slug + 'county.gov');
      parts.push('site:' + slug + 'county.co.us');
    }
    return '(' + parts.join(' OR ') + ')';
  }

  // ── Build the link list ─────────────────────────────────────────

  function build(opts) {
    opts = opts || {};
    var jurisName = (opts.jurisdictionName || '').trim();
    var isCounty = !!opts.isCounty;
    if (!jurisName) return [];

    var qJuris  = '"' + jurisName + '"';
    var council = councilName(isCounty);
    var planning = planningName(isCounty);
    var site = siteFilter(jurisName, isCounty);
    var siteClause = site ? (site + ' ') : '';

    var d12 = isoMonthsAgo(12);
    var d6  = isoMonthsAgo(6);

    var housingTerms = '("affordable housing" OR "workforce housing" OR "attainable housing")';
    var zoningTerms  = '("density bonus" OR "rezoning" OR "upzone" OR "inclusionary" OR "ADU" OR "accessory dwelling")';

    var bodyLabel = isCounty ? 'BoCC' : 'City Council';
    var planLabel = isCounty ? 'County Planning Commission' : 'Planning Commission';

    var links = [];

    // 1) Council agendas (PDF) — housing topics, last 12 mo
    links.push({
      label: bodyLabel + ' agendas mentioning housing (PDFs, last 12 mo)',
      summary: 'Time-bounded PDF search across council agenda packets for affordable / workforce housing items.',
      url: googleUrl(
        siteClause + council + ' (agenda OR "agenda packet") ' + housingTerms +
          ' filetype:pdf after:' + d12 + ' ' + qJuris + ' Colorado',
        'm12'
      )
    });

    // 2) Planning Commission agendas (PDF) — zoning + density, last 12 mo
    links.push({
      label: planLabel + ' agendas — density, rezoning, ADU (PDFs, last 12 mo)',
      summary: 'PC agendas where rezonings, density bonuses, and ADU code changes get scoped before council vote.',
      url: googleUrl(
        siteClause + planning + ' (agenda OR "agenda packet") ' + zoningTerms +
          ' filetype:pdf after:' + d12 + ' ' + qJuris + ' Colorado',
        'm12'
      )
    });

    // 3) Council minutes — housing votes, last 6 mo
    links.push({
      label: bodyLabel + ' minutes referencing housing (last 6 mo)',
      summary: 'Minutes capture the actual vote + commentary — useful for tracking how members lean on housing items.',
      url: googleUrl(
        siteClause + council + ' minutes ' + housingTerms +
          ' after:' + d6 + ' ' + qJuris + ' Colorado',
        'm6'
      )
    });

    // 4) Planning Commission minutes — last 6 mo
    links.push({
      label: planLabel + ' minutes — zoning + housing decisions (last 6 mo)',
      summary: 'PC minutes show how staff + commissioners interpreted the code on recent housing proposals.',
      url: googleUrl(
        siteClause + planning + ' minutes (' + housingTerms + ' OR ' + zoningTerms + ')' +
          ' after:' + d6 + ' ' + qJuris + ' Colorado',
        'm6'
      )
    });

    // 5) Specific affordable-housing projects on the agenda
    links.push({
      label: 'Active affordable-housing projects on the agenda',
      summary: 'Catches site-specific project filings (PUD, site plan, conditional use) that mention affordable units.',
      url: googleUrl(
        '"affordable housing" (project OR development OR application OR PUD OR "site plan") ' +
          qJuris + ' Colorado after:' + d12,
        'm12'
      )
    });

    // 6) Policy levers: inclusionary / linkage / ADU
    links.push({
      label: 'Inclusionary zoning, linkage fees, ADU code in ' + jurisName,
      summary: 'Tracks the three most-common municipal policy levers and any current code updates.',
      url: googleUrl(
        '("inclusionary zoning" OR "linkage fee" OR "linkage program" OR "accessory dwelling" OR "ADU ordinance") ' +
          qJuris + ' Colorado after:' + d12,
        'm12'
      )
    });

    // 7) Comprehensive plan housing element
    links.push({
      label: 'Comprehensive plan housing element / update',
      summary: 'Surfaces the master-plan housing chapter + any active comp-plan update touching housing policy.',
      url: googleUrl(
        '("comprehensive plan" OR "master plan" OR "comp plan") ("housing element" OR "housing chapter" OR "housing strategy") ' +
          qJuris + ' Colorado',
        'y'
      )
    });

    // 8) Staff reports + memos (PDF) — last 12 mo
    links.push({
      label: 'Housing staff reports & memos (PDFs, last 12 mo)',
      summary: 'Staff reports are where the substantive housing analysis lives ahead of any council vote.',
      url: googleUrl(
        siteClause + '("staff report" OR "staff memo" OR memorandum) ' + housingTerms +
          ' filetype:pdf after:' + d12 + ' ' + qJuris + ' Colorado',
        'm12'
      )
    });

    return links;
  }

  global.AgendaSearchLinks = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
