/*
 * search-links.js
 *
 * F165 — Targeted Google search-URL builder for all housing-context
 * lookups across the site. Replaces ~11 generic
 * `google.com/search?q=<jurisdiction>` calls that surfaced irrelevant
 * results (random PDFs from 2003, parks meeting minutes, same-named
 * places in other states) with laser-targeted queries that:
 *
 *   1. Quote the jurisdiction so Google honors it as a phrase and we
 *      don't catch "Boulder, Montana" or "Aurora, Illinois".
 *   2. Wrap housing terms in OR groups so we catch the full vocabulary
 *      ("affordable housing" OR "workforce housing" OR "attainable
 *      housing") on every query.
 *   3. Time-bound with BOTH `after:YYYY-MM-DD` (the Google search
 *      operator) AND `tbs=qdr:m12` / `qdr:m6` (the result-page sidebar
 *      filter) so users clicking through don't lose the recency
 *      constraint.
 *   4. Use site: filters for Colorado housing press (coloradosun.com,
 *      cpr.org, denverpost.com, bizwest.com, denverite.com,
 *      coloradoan.com) so we get real journalism, not blog spam.
 *   5. Use filetype:pdf for staff reports / agenda packets when the
 *      context is policy / agenda.
 *
 * Companion to:
 *   - agenda-search-links.js (F162) → city/county agenda + minutes PDFs
 *
 * Pure URL construction. No fetches, no external data, no DOM.
 *
 * Exposes: window.SearchLinks.build({
 *   jurisdictionName, isCounty, context, propertyName, countyName
 * }) → { url, label, title }
 *
 * Supported contexts:
 *   - news            : CO affordable-housing news for jurisdiction
 *   - property-news   : Specific property + jurisdiction, m12, OR
 *                       filters for funding / award / preservation /
 *                       refinance / closing / lease-up
 *   - council-news    : Council / BoCC housing discussions, m6, policy
 *                       keywords (zoning, comp plan, fee waiver, IZ,
 *                       ADU)
 *   - housing-policy  : .gov / state housing pages mentioning the
 *                       jurisdiction. m12.
 *   - county-news     : Same as news but county-level scope swap.
 *   - colorado-sun    : site:coloradosun.com + housing keywords + m12
 *   - cpr             : site:cpr.org    + housing keywords + m12
 *   - bizwest         : site:bizwest.com + housing keywords + m12
 *   - google-news     : Google News search w/ housing context + m12
 *   - housing-staff   : Find the housing coordinator / director /
 *                       manager for a jurisdiction (no time bound)
 *   - largest-employers : "largest employers in X Colorado" m12
 *   - workforce-employers : workforce-housing employer partnerships
 *   - school-district : find school district serving X (no time bound)
 *   - public-library  : public library, no time bound
 *   - community-center : community/rec center, no time bound
 *   - boards          : housing advisory board / commission
 *   - housing-authority-board : housing authority board meetings
 *   - local-advocates : local affordable-housing advocates near X
 *   - faith-housing   : faith-based housing partners (Habitat, etc.)
 *   - agenda-generic  : generic agenda + minutes (F95 fallback)
 *   - housing-news-general : same as 'news' alias used by hna F95
 *   - co-press        : multi-site CO press housing roundup
 */
(function (global) {
  'use strict';

  // ── Date helpers ────────────────────────────────────────────────
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function isoMonthsAgo(monthsBack) {
    var d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // ── URL helper ──────────────────────────────────────────────────
  function googleUrl(query, qdr, opts) {
    opts = opts || {};
    var host = opts.news ? 'https://news.google.com/search?q=' :
                           'https://www.google.com/search?q=';
    var url = host + encodeURIComponent(query);
    if (opts.tbm) url += '&tbm=' + encodeURIComponent(opts.tbm);
    if (qdr) url += '&tbs=' + encodeURIComponent('qdr:' + qdr);
    if (opts.news) url += '&hl=en-US&gl=US&ceid=US%3Aen';
    return url;
  }

  // ── Vocabulary blocks ───────────────────────────────────────────
  // F227 — Broadened housing terms. Old query required exact match for
  // "affordable/workforce/attainable housing" which filtered out general
  // development news, council approvals, planning updates, and zoning
  // changes — all relevant context for a LIHTC dev evaluating a small
  // jurisdiction like Fruita. New query adds "housing" + "residential" +
  // "development" + "LIHTC" as broader fallback terms.
  var HOUSING_TERMS = '("affordable housing" OR "workforce housing" OR "attainable housing" OR LIHTC OR "tax credit" OR "low-income housing" OR ("housing" AND (development OR project OR units OR construction)))';
  var HOUSING_TERMS_BROAD = '(housing OR residential OR development OR "land use" OR "planning commission")';
  var FUNDING_TERMS = '(funding OR award OR preservation OR refinance OR closing OR "lease-up" OR groundbreaking OR opens)';
  var POLICY_TERMS  = '(zoning OR "comp plan" OR "comprehensive plan" OR "fee waiver" OR "inclusionary zoning" OR "IZ" OR ADU OR "accessory dwelling")';
  // F227 — Added Daily Sentinel (Grand Junction / Mesa County) +
  // Glenwood Springs Post Independent (Glenwood + Garfield County) +
  // Aspen Daily News + Steamboat Pilot. These cover small Western Slope
  // jurisdictions that the metro-focused press sites miss.
  var CO_PRESS_SITES = '(site:coloradosun.com OR site:cpr.org OR site:denverpost.com OR site:bizwest.com OR site:denverite.com OR site:coloradoan.com OR site:gjsentinel.com OR site:postindependent.com OR site:aspendailynews.com OR site:steamboatpilot.com OR site:summitdaily.com OR site:vaildaily.com)';

  function councilName(isCounty) {
    return isCounty
      ? '("Board of County Commissioners" OR "BoCC" OR "County Commissioners")'
      : '("City Council" OR "Town Council" OR "Town Board")';
  }

  function quote(s) { return '"' + String(s || '').trim() + '"'; }

  // ── Per-context builders ────────────────────────────────────────
  function buildNews(jur) {
    var d = isoMonthsAgo(12);
    var q = quote(jur) + ' Colorado ' + HOUSING_TERMS + ' ' + CO_PRESS_SITES + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: 'Recent housing news for ' + jur,
      title: 'Colorado housing-press coverage of ' + jur + ' from the last 12 months (12 statewide + Western Slope outlets: Colorado Sun, CPR, Denver Post, BizWest, Denverite, Coloradoan, Daily Sentinel, Glenwood Springs Post Independent, Aspen Daily News, Steamboat Pilot, Summit Daily, Vail Daily).'
    };
  }

  // F227 — Broader fallback search. Used when buildNews returns 0 results.
  // Drops the quote on the place name (catches partial matches like
  // "Fruita Mews Phase II") and broadens vocabulary beyond LIHTC-specific
  // terms to include any housing / residential / planning coverage.
  function buildNewsBroad(jur) {
    var d = isoMonthsAgo(24);  // 24-month window — small jurisdictions need wider net
    var q = String(jur).trim() + ' Colorado ' + HOUSING_TERMS_BROAD + ' after:' + d;
    return {
      url:   googleUrl(q, 'm24'),
      label: 'Try broader search (any housing / development / planning news)',
      title: 'Drops the quoted-name + LIHTC vocabulary filter. Useful for small jurisdictions where the focused query returns 0 results — catches council approvals, planning commission decisions, and general development news that mentions ' + jur + '.'
    };
  }
  // F227 — Archive fallback. Search the open web (not just news outlets)
  // for any historical coverage. Useful for small jurisdictions with
  // older / pre-2024 coverage that Google News has since dropped.
  function buildNewsArchive(jur) {
    var q = String(jur).trim() + ' Colorado housing OR development OR LIHTC OR "tax credit"';
    return {
      url:   'https://www.google.com/search?q=' + encodeURIComponent(q),
      label: 'Search archives (open web, all years)',
      title: 'Open-web search for historical coverage of ' + jur + ' — no date filter, no press-site restriction. Useful when "Recent news" returns 0 hits but you suspect older items exist.'
    };
  }

  function buildCountyNews(countyName) {
    var d = isoMonthsAgo(12);
    var name = String(countyName || '').replace(/\s+County$/i, '');
    var q = quote(name + ' County') + ' Colorado ' + HOUSING_TERMS + ' ' + CO_PRESS_SITES + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: name + ' County housing news',
      title: 'Colorado housing-press coverage of ' + name + ' County from the last 12 months.'
    };
  }

  function buildPropertyNews(propertyName, jurName) {
    var d = isoMonthsAgo(12);
    var pieces = [quote(propertyName), 'Colorado', HOUSING_TERMS, FUNDING_TERMS];
    if (jurName) pieces.splice(1, 0, quote(jurName));
    pieces.push('after:' + d);
    var q = pieces.join(' ');
    return {
      url:   googleUrl(q, 'm12'),
      label: 'Property news',
      title: 'Recent news mentions of this property: funding, award, preservation, refinance, closing, lease-up announcements (last 12 months).'
    };
  }

  function buildCouncilNews(jur, isCounty) {
    var d = isoMonthsAgo(6);
    var q = quote(jur) + ' Colorado ' + councilName(isCounty) + ' ' + HOUSING_TERMS + ' ' + POLICY_TERMS + ' after:' + d;
    return {
      url:   googleUrl(q, 'm6'),
      label: (isCounty ? 'BoCC' : 'Council') + ' housing discussions',
      title: 'Recent ' + (isCounty ? 'BoCC' : 'council') + ' debate on zoning, comp plan, fee waivers, IZ, ADU — last 6 months.'
    };
  }

  function buildHousingPolicy(jur) {
    var d = isoMonthsAgo(12);
    var govSites = '(site:.gov OR site:cdola.colorado.gov OR site:colorado.gov OR site:hud.gov OR site:chfainfo.com)';
    var q = govSites + ' ' + quote(jur) + ' Colorado ' + HOUSING_TERMS + ' ' + POLICY_TERMS + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: 'Housing policy on .gov sites',
      title: 'State / federal housing policy pages discussing ' + jur + ' (last 12 months, .gov + CHFA).'
    };
  }

  function buildColoradoSun(jur) {
    var d = isoMonthsAgo(12);
    var q = 'site:coloradosun.com ' + quote(jur) + ' ' + HOUSING_TERMS + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: 'Colorado Sun',
      title: 'Colorado Sun coverage of ' + jur + ' affordable / workforce housing — last 12 months.'
    };
  }

  function buildCpr(jur) {
    var d = isoMonthsAgo(12);
    var q = 'site:cpr.org ' + quote(jur) + ' ' + HOUSING_TERMS + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: 'Colorado Public Radio',
      title: 'CPR coverage of ' + jur + ' affordable / workforce housing — last 12 months.'
    };
  }

  function buildBizwest(jur) {
    var d = isoMonthsAgo(12);
    var q = 'site:bizwest.com ' + quote(jur) + ' ' + HOUSING_TERMS + ' after:' + d;
    return {
      url:   googleUrl(q, 'm12'),
      label: 'BizWest',
      title: 'BizWest coverage of ' + jur + ' affordable / workforce housing — last 12 months.'
    };
  }

  function buildGoogleNews(jur) {
    var q = quote(jur) + ' Colorado ' + HOUSING_TERMS;
    return {
      url:   googleUrl(q, 'm12', { news: true }),
      label: 'Google News',
      title: 'Google News index for ' + jur + ' Colorado affordable / workforce housing — last 12 months.'
    };
  }

  function buildHousingStaff(jur) {
    var q = quote(jur) + ' Colorado (housing) (coordinator OR director OR manager OR planner) -site:linkedin.com';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Find housing staff',
      title: 'Locate the housing coordinator / director / planner serving ' + jur + ' (last 12 months, no LinkedIn).'
    };
  }

  function buildLargestEmployers(jur) {
    var q = '"largest employers" ' + quote(jur) + ' Colorado';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Largest employers in ' + jur,
      title: 'Identify top employers — informs AMI mix decisions and surfaces possible workforce-housing partners.'
    };
  }

  function buildWorkforceEmployers(jur) {
    var q = quote(jur) + ' Colorado ("workforce housing" OR "employee housing" OR "master lease") (employer OR partnership OR program)';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Workforce-housing employer partnerships near ' + jur,
      title: 'Employers that run published workforce-housing programs (master-lease, direct-build, surplus land partnerships).'
    };
  }

  function buildSchoolDistrict(jur) {
    var q = quote(jur) + ' Colorado "school district"';
    return {
      url:   googleUrl(q),
      label: 'School district serving ' + jur,
      title: 'Identify the school district — many run workforce-housing programs for teachers.'
    };
  }

  function buildPublicLibrary(jur) {
    var q = quote(jur) + ' Colorado "public library"';
    return {
      url:   googleUrl(q),
      label: jur + ' public library',
      title: 'Public library — convening venue for housing town-halls and where flyers are posted.'
    };
  }

  function buildCommunityCenter(jur) {
    var q = quote(jur) + ' Colorado ("community center" OR "recreation center" OR "rec center")';
    return {
      url:   googleUrl(q),
      label: 'Community / rec center',
      title: 'Community / recreation centers in ' + jur + ' — convening venues for housing conversations.'
    };
  }

  function buildBoards(jur, govDomain) {
    var sitePart = govDomain ? ('site:' + govDomain + ' ') : '';
    var q = sitePart + quote(jur) + ' ("housing advisory" OR "housing commission" OR "housing board" OR "housing task force")';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Housing Advisory Board / Commission',
      title: 'Find a standing housing advisory body for ' + jur + (govDomain ? ' (scoped to ' + govDomain + ')' : '') + '.'
    };
  }

  function buildHousingAuthorityBoard(jur, govDomain) {
    var sitePart = govDomain ? ('site:' + govDomain + ' ') : '';
    var q = sitePart + quote(jur) + ' "housing authority" (board OR commissioners OR meeting OR agenda)';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Housing Authority board agendas',
      title: 'Housing Authority board meetings + agendas for ' + jur + (govDomain ? ' (scoped to ' + govDomain + ')' : '') + '.'
    };
  }

  function buildLocalAdvocates(jur) {
    var q = quote(jur) + ' Colorado ' + HOUSING_TERMS +
            ' (coalition OR alliance OR advocate OR nonprofit OR equity) -site:linkedin.com';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Local affordable-housing advocates near ' + jur,
      title: 'Surfaces local advocacy orgs, coalitions, and nonprofits working on housing in ' + jur + '.'
    };
  }

  function buildFaithHousing(jur) {
    var q = quote(jur) + ' Colorado ' + HOUSING_TERMS +
            ' (Habitat OR "Catholic Charities" OR "Volunteers of America" OR "Mercy Housing" OR YIMBY OR faith OR church OR congregation)';
    return {
      url:   googleUrl(q, 'y'),
      label: 'Faith-based or community housing partners',
      title: 'Faith-based + national-affiliate housing partners active in ' + jur + ' (Habitat, Catholic Charities, Mercy Housing, etc.).'
    };
  }

  // ── Public API ──────────────────────────────────────────────────
  function build(opts) {
    opts = opts || {};
    var jur = String(opts.jurisdictionName || '').trim();
    var isCounty = !!opts.isCounty;
    var ctx = String(opts.context || 'news').trim();
    var propName = String(opts.propertyName || '').trim();
    var countyName = String(opts.countyName || '').trim();
    var govDomain = String(opts.govDomain || '').trim();

    // jurisdiction is required for every context except property-news
    // (which can fall back to property alone) and county-news (which
    // can fall back to county alone).
    if (!jur && ctx !== 'property-news' && ctx !== 'county-news') {
      return { url: 'https://www.google.com/', label: 'Google', title: '' };
    }

    switch (ctx) {
      case 'news':
      case 'housing-news-general':
      case 'co-press':
        return buildNews(jur);
      // F227 — new contexts for the "no results?" fallback flow
      case 'news-broad':
      case 'news-broader':
        return buildNewsBroad(jur);
      case 'news-archive':
      case 'news-archives':
        return buildNewsArchive(jur);
      case 'county-news':
        return buildCountyNews(countyName || jur);
      case 'property-news':
        return buildPropertyNews(propName, jur);
      case 'council-news':
        return buildCouncilNews(jur, isCounty);
      case 'housing-policy':
        return buildHousingPolicy(jur);
      case 'colorado-sun':
        return buildColoradoSun(jur);
      case 'cpr':
        return buildCpr(jur);
      case 'bizwest':
        return buildBizwest(jur);
      case 'google-news':
        return buildGoogleNews(jur);
      case 'housing-staff':
        return buildHousingStaff(jur);
      case 'largest-employers':
        return buildLargestEmployers(jur);
      case 'workforce-employers':
        return buildWorkforceEmployers(jur);
      case 'school-district':
        return buildSchoolDistrict(jur);
      case 'public-library':
        return buildPublicLibrary(jur);
      case 'community-center':
        return buildCommunityCenter(jur);
      case 'boards':
        return buildBoards(jur, govDomain);
      case 'housing-authority-board':
        return buildHousingAuthorityBoard(jur, govDomain);
      case 'local-advocates':
        return buildLocalAdvocates(jur);
      case 'faith-housing':
        return buildFaithHousing(jur);
      default:
        return buildNews(jur);
    }
  }

  global.SearchLinks = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
