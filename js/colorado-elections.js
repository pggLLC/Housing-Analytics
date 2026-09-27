/* Election records are curated data; campaign claims are never government actions. */
(function () {
  'use strict';
  var DAY = 86400000;
  var ELECTION = '2026-11-03';
  var STATES = {
    not_researched: 'Not yet researched',
    verified_measure_found: 'Housing-related measure found (see certification status)',
    official_ballot_reviewed_none_found: 'Official ballot reviewed — no direct housing measure found',
    source_unreadable: 'Official source unreadable',
    official_notice_unavailable: 'Official notice unavailable',
    not_applicable: 'Not applicable'
  };
  var past = document.getElementById('past-election-records');

  function node(tag, text, className) {
    var el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function add(parent, tag, text, className) {
    var el = node(tag, text, className);
    parent.appendChild(el);
    return el;
  }
  function link(parent, label, url) {
    // Even a malformed fixture cannot turn a source into an executable URL.
    if (!/^https:\/\//i.test(url || '')) return add(parent, 'span', label + ' — source unavailable');
    var a = add(parent, 'a', label);
    a.href = url;
    a.rel = 'noopener noreferrer';
    return a;
  }
  function check(parent, v) {
    var text = 'Not yet checked';
    if (v && v.level === 'primary') text = 'Checked against ' + (v.against || 'published campaign material') + ' on ' + v.checked;
    if (v && v.level === 'reported') text = 'As reported by ' + v.by + '; link checked ' + v.checked + '. Not checked against a primary document.';
    add(parent, 'p', text, 'election-check');
  }
  function expired(record, electionDate) {
    var time = Date.parse((electionDate || '') + 'T00:00:00Z');
    var today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    return record.archived === true || (Number.isFinite(time) && today - time >= 45 * DAY);
  }
  function pastGroup(title) {
    document.getElementById('past-elections').hidden = false;
    var section = add(past, 'section');
    add(section, 'h3', title);
    return section;
  }
  function excerpts(parent, title, evidence) {
    if (!evidence || !evidence.length) return;
    var detail = add(parent, 'details');
    add(detail, 'summary', title);
    evidence.forEach(function (e) {
      add(detail, 'p', e.section, 'election-check');
      add(detail, 'blockquote', e.quote, 'election-quote');
    });
  }
  function notes(parent, limitations) {
    if (!limitations || !limitations.length) return;
    var detail = add(parent, 'details', null, 'research-notes');
    add(detail, 'summary', 'Research notes and limitations');
    var list = add(detail, 'ul');
    limitations.forEach(function (text) { add(list, 'li', text); });
  }
  function ballotCard(parent, entry, heading) {
    var card = add(parent, 'article', null, 'election-card');
    card.dataset.ballotId = entry.id;
    add(card, heading || 'h4', entry.jurisdiction.name + ' — ' + entry.neutral_title);
    add(card, 'p', 'Status: ' + entry.status.replace(/_/g, ' ') + ' · Election: ' + entry.election.date, 'election-check');
    if (entry.detail) add(card, 'p', entry.detail);
    excerpts(card, 'Official question and source excerpts', entry.evidence);
    var source = entry.sources.certification || entry.sources.ballot_notice || entry.sources.official_text || entry.sources.resolution;
    link(card, 'Official source', source && source.url);
    check(card, entry.verification);
    notes(card, entry.limitations);
    if (entry.result) {
      add(card, 'p', 'Result: ' + entry.result.outcome + ' (' + entry.result.stage + '), as of ' + entry.result.as_of);
      link(card, 'Election result source', entry.result.source.url);
    }
  }
  function renderBallots(files, counties) {
    var entries = files.flatMap(function (file) { return file.entries; });
    var active = entries.filter(function (e) {
      return !expired(e, e.election.date) && e.election.date === ELECTION && ['certified', 'on_ballot'].includes(e.status);
    });
    var host = document.getElementById('on-ballot-records');
    host.replaceChildren();
    [['state', 'Statewide'], ['county', 'County'], ['municipal', 'Municipal']].forEach(function (group) {
      var section = add(host, 'section');
      add(section, 'h3', group[1]);
      var items = active.filter(function (e) { return e.jurisdiction.level === group[0]; });
      if (!items.length) add(section, 'p', 'No certified or on-ballot housing entries are listed here. Check the coverage table for research status.');
      items.forEach(function (e) { ballotCard(section, e); });
    });
    // Terminal statuses are not on-ballot entries. Keep their results reachable
    // during the interval before the same day-45 archive rule takes effect.
    var results = entries.filter(function (e) {
      return !expired(e, e.election.date) && ['passed', 'failed'].includes(e.status);
    });
    var resultHost = document.getElementById('election-result-records');
    resultHost.replaceChildren();
    document.getElementById('election-results').hidden = !results.length;
    results.forEach(function (e) { ballotCard(resultHost, e, 'h3'); });
    var old = entries.filter(function (e) { return expired(e, e.election.date); });
    if (old.length) {
      var archive = pastGroup('Ballot measures');
      old.forEach(function (e) { ballotCard(archive, e); });
    }

    var localRows = files.slice(1).flatMap(function (file) { return file.coverage; });
    var unchecked = localRows.filter(function (row) { return row.coverage_state === 'not_researched'; }).length;
    var checked = localRows.length - unchecked;
    var summary = document.getElementById('ballot-coverage-summary');
    summary.replaceChildren();
    summary.append('Local ballots checked: ');
    add(summary, 'span', checked).dataset.count = 'checked';
    summary.append(' of ');
    add(summary, 'span', localRows.length).dataset.count = 'total';
    summary.append(' jurisdictions. ');
    add(summary, 'span', unchecked).dataset.count = 'not-researched';
    summary.append(' not yet researched. ');
    var coverageLink = add(summary, 'a', 'View full coverage table');
    coverageLink.href = '#ballot-coverage';

    var filter = document.getElementById('coverage-county');
    counties.forEach(function (county) {
      var option = add(filter, 'option', county.label);
      option.value = county.geoid;
    });
    var body = document.getElementById('coverage-rows');
    body.replaceChildren();
    files.forEach(function (file, index) {
      file.coverage.forEach(function (row) {
        var tr = add(body, 'tr');
        tr.dataset.geoid = row.geoid;
        tr.dataset.county = index ? counties[index - 1].geoid : 'state';
        tr.dataset.coverageState = row.coverage_state;
        var th = add(tr, 'th', row.name);
        th.scope = 'row';
        add(tr, 'td', index ? counties[index - 1].label : 'Statewide');
        add(tr, 'td', STATES[row.coverage_state] || row.coverage_state);
        add(tr, 'td', row.checked || 'Not yet checked');
        var source = add(tr, 'td');
        if (row.reviewed_source) link(source, 'Reviewed source', row.reviewed_source);
        else add(source, 'span', 'No source reviewed');
        notes(source, row.limitations);
      });
    });
    function filterRows() {
      var shown = 0;
      Array.from(body.rows).forEach(function (row) {
        row.hidden = !!filter.value && row.dataset.county !== filter.value;
        if (!row.hidden) shown++;
      });
      var message = shown + ' coverage rows shown. All research states are included.';
      document.getElementById('coverage-status').textContent = message;
      if (window.__announceUpdate) window.__announceUpdate(message);
    }
    filter.addEventListener('change', filterRows);
    filter.disabled = false;
    filterRows();
  }

  function sameCandidate(record, race, identity) {
    return record.office === race.office && record.candidate === identity.candidate && record.party === identity.party;
  }
  function candidateCard(parent, identity, records, incomplete) {
    var card = add(parent, 'li', null, 'election-card');
    card.dataset.candidate = identity.candidate;
    add(card, 'h4', identity.candidate);
    add(card, 'p', 'Ballot label: ' + identity.party, 'election-check');
    var campaign = records.find(function (c) { return !c.verification || c.verification.level !== 'reported'; });
    if (campaign) {
      if (campaign.coverage_state === 'official_material_reviewed_no_housing_position_found') {
        add(card, 'p', 'No housing position found in published campaign material' +
          (campaign.verification && campaign.verification.checked ? ' (checked ' + campaign.verification.checked + ')' : ''));
      } else if (campaign.coverage_state === 'campaign_source_unavailable') {
        add(card, 'p', 'Campaign source unavailable. No housing position can be established from this record.');
      } else if (campaign.coverage_state === 'not_researched') {
        add(card, 'p', 'Not yet researched');
      } else if (!incomplete) {
        add(card, 'p', campaign.neutral_summary, 'candidate-summary');
        excerpts(card, 'Campaign wording', [{ section: 'Published campaign material', quote: campaign.quote }]);
      } else {
        add(card, 'p', 'Campaign material checked; positions are withheld until all candidates have been checked.');
      }
      if (campaign.campaign_source.url) link(card, 'Campaign source', campaign.campaign_source.url);
      check(card, campaign.verification);
      if (!incomplete) campaign.proposed_appointments.forEach(function (claim) {
        var item = add(card, 'div', null, 'campaign-claim');
        add(item, 'p', 'Campaign claim — proposed appointment: ' + claim.role + (claim.person ? ' — ' + claim.person : ' (no person named)'));
        add(item, 'blockquote', claim.quote, 'election-quote');
        link(item, 'Campaign claim source', claim.source.url);
      });
    } else {
      add(card, 'p', records.length ? 'Campaign coverage is not included in this group.' : 'Not yet researched');
    }
    if (!incomplete) records.filter(function (c) { return c.verification && c.verification.level === 'reported'; }).forEach(function (report) {
      var item = add(card, 'aside', null, 'candidate-report');
      add(item, 'h5', 'As reported by ' + report.verification.by + ' — supplemental reporting');
      add(item, 'p', 'This is an outlet report, not a verified campaign statement.');
      add(item, 'p', report.neutral_summary, 'candidate-summary');
      excerpts(item, 'Quoted by the outlet', [{ section: report.verification.by, quote: report.quote }]);
      link(item, report.verification.by + ' report', report.campaign_source.url);
      check(item, report.verification);
    });
  }
  function renderCandidates(data) {
    var host = document.getElementById('candidate-records');
    host.replaceChildren();
    var archive;
    data.races.forEach(function (race) {
      var roster = race.certified_candidates;
      var all = data.candidates.filter(function (c) { return c.office === race.office; });
      var incomplete = race.coverage_state !== 'complete' || !roster.length || roster.some(function (identity) {
        var c = all.find(function (item) { return sameCandidate(item, race, identity) && (!item.verification || item.verification.level !== 'reported'); });
        return !c || c.coverage_state === 'not_researched';
      });
      [false, true].forEach(function (isPast) {
        var records = all.filter(function (c) { return (expired(race, race.election_date) || expired(c, race.election_date)) === isPast; });
        var identities = roster.filter(function (identity) {
          return records.some(function (c) { return sameCandidate(c, race, identity); }) ||
            (expired(race, race.election_date) === isPast && !all.some(function (c) { return sameCandidate(c, race, identity); }));
        });
        if (!identities.length && (roster.length || expired(race, race.election_date) !== isPast)) return;
        if (isPast && !archive) archive = pastGroup("Candidates' stated housing positions");
        var section = add(isPast ? archive : host, 'section', null, 'candidate-race');
        section.dataset.race = race.office;
        add(section, 'h3', race.office);
        add(section, 'p', 'Election: ' + race.election_date + '. Candidates appear in certified ballot order.');
        if (race.candidates_source) link(section, 'Certified candidate list', race.candidates_source);
        if (race.roster_checked) add(section, 'p', 'Roster checked ' + race.roster_checked, 'election-check');
        if (incomplete) add(section, 'p', 'Not all candidates checked yet', 'race-incomplete');
        if (!roster.length) add(section, 'p', 'The certified candidate roster has not yet been researched.');
        var list = add(section, 'ol', null, 'candidate-list');
        identities.forEach(function (identity) {
          candidateCard(list, identity, records.filter(function (c) { return sameCandidate(c, race, identity); }), incomplete);
        });
      });
    });
    if (!host.children.length) add(host, 'p', 'No current candidate records are listed. Archived records, when available, appear under Past elections.');
  }
  function renderPeople(data) {
    var host = document.getElementById('people-records');
    host.replaceChildren();
    var archive;
    data.entries.filter(function (e) { return e.section === 'people'; }).forEach(function (person) {
      var isPast = expired(person, person.election_date || (person.election && person.election.date));
      if (isPast && !archive) archive = pastGroup('People and roles');
      var card = add(isPast ? archive : host, 'article', null, 'election-card');
      card.dataset.personId = person.id;
      add(card, 'h3', person.title);
      add(card, 'p', person.status, 'election-check');
      add(card, 'p', person.detail);
      var fields = [['Role', person.role], ['Agency', person.agency], ['Appointing authority', person.appointing_authority], ['Predecessor', person.predecessor]];
      Object.entries(person.dates || {}).forEach(function (pair) { if (pair[1]) fields.push([pair[0].replace(/_/g, ' '), pair[1]]); });
      var dl = add(card, 'dl');
      fields.forEach(function (pair) { if (pair[1]) { add(dl, 'dt', pair[0]); add(dl, 'dd', pair[1]); } });
      (person.relevance || []).forEach(function (text) { add(card, 'p', text); });
      link(card, person.source.label || 'Official source', person.source.url);
      check(card, person.verification);
      excerpts(card, 'Source wording', person.evidence);
    });
    if (!host.children.length) add(host, 'p', 'No current people and roles entries are available.');
  }
  async function read(path) {
    var url = window.resolveAssetUrl ? window.resolveAssetUrl(path) : path;
    var response = await (window.fetchWithTimeout || window.fetch)(url, {}, 15000);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }
  function unavailable(id, label) {
    var el = document.getElementById(id);
    el.replaceChildren(node('p', label + ' could not be loaded. Please try again later. No complete count or coverage claim is available.'));
    el.dataset.loadState = 'unavailable';
  }
  async function load() {
    await Promise.all([
      (async function () {
        try {
          var geo = await read('data/hna/geo-config.json');
          if (!Array.isArray(geo.counties) || !geo.counties.length || geo.counties.some(function (c) { return !/^08\d{3}$/.test(c.geoid); })) throw new Error('Invalid counties');
          var paths = ['data/policy/ballot-2026/statewide.json'].concat(geo.counties.map(function (c) { return 'data/policy/ballot-2026/counties/' + c.geoid + '.json'; }));
          var files = await Promise.all(paths.map(read));
          if (files.some(function (file) { return file.schema !== 'ballot/v1' || !Array.isArray(file.coverage) || !file.coverage.length || !Array.isArray(file.entries); })) throw new Error('Invalid ballot file');
          renderBallots(files, geo.counties);
        } catch (err) {
          unavailable('on-ballot-records', 'Ballot records');
          unavailable('ballot-coverage-summary', 'Complete ballot coverage');
          document.getElementById('coverage-status').textContent = 'Coverage unavailable — at least one required file could not be loaded.';
        }
      })(),
      read('data/policy/candidate-platforms-2026.json').then(function (data) {
        if (data.schema !== 'candidate-platforms/v1' || !Array.isArray(data.races) || !Array.isArray(data.candidates)) throw new Error('Invalid candidates');
        renderCandidates(data);
      }).catch(function () { unavailable('candidate-records', 'Candidate records'); }),
      read('data/policy/policy-watch.json').then(function (data) {
        if (data.schema !== 'policy-watch/v1' || !Array.isArray(data.entries)) throw new Error('Invalid people');
        renderPeople(data);
      }).catch(function () { unavailable('people-records', 'People and roles'); })
    ]);
    document.getElementById('election-data').dataset.loadState = 'ready';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
