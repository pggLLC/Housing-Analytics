/**
 * place-card.js — one card per place on the gated Jurisdiction Report: the
 * readiness reading, why the place is in the pipeline, the sites on file and
 * whether each is open to a new developer, the three people to call first, the
 * next step and the latest signals, with links to the dossier.
 *
 * It only joins what the gated site already serves: the pipeline and network
 * files (PrivateWorkspace), the researched public contacts
 * (data/jurisdiction-briefs/_contacts/), and data/ripeness.json, which the
 * private backend builds at deploy time with each site's dossier card and its
 * developer check. None of those is in this repository, and nothing here
 * reaches the printed report.
 *
 * "Call first" ranks every contact for the place, from both sources, by how well
 * the role fits the next step, then by whether a phone or email is on file, then
 * by whether you have talked before. Each pick says why.
 *
 * Lives in js/whitepaper/ because the gated bundle copies that folder and the
 * public build excludes it. window.PlaceCard in the browser; module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlaceCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABEL = { ripe: 'Ripe', ripening: 'Ripening', on_file: 'Site on file', not_yet: 'Not yet', none: 'No site on file' };
  var RANK = { ripe: 0, ripening: 1, on_file: 2, not_yet: 3, none: 4 };
  var STAGE = {
    land_funded: 'land funded, no tax credit yet',
    applied: 'applied, decision pending',
    letter_of_intent: 'letter of intent filed',
    not_funded: 'applied, not funded',
    dossier: 'studied in a site dossier',
    public_land: 'land held by a public owner'
  };
  // The developer check on each site, from the backend's site research.
  var OPENING = {
    open: { label: 'Open: land held, no developer chosen', rank: 0 },
    rfp: { label: 'Open: developer search under way or coming', rank: 1 },
    opening: { label: 'Opening: the last applicant appears to have moved on', rank: 2 },
    unclear: { label: 'Unclear: no developer named in public records', rank: 3 },
    taken: { label: 'Taken: a developer is still on it', rank: 4 }
  };
  var COVERS = {
    zoning: 'zoning and entitlements',
    land: 'the land',
    funding: 'local money',
    'housing-authority': 'the housing authority',
    council: 'the council vote',
    management: 'the staff'
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ext(text, url) {
    return /^https:\/\//.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text);
  }
  function nameKey(s) { return String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }

  // What a role decides, read from its title when the contact file does not say.
  function coversFromRole(role) {
    var r = String(role || '').toLowerCase(), out = [];
    if (/planning|community development|zoning|land use|building/.test(r)) out.push('zoning');
    if (/housing authority|housing (director|manager|program|coordinator|specialist|division)|executive director/.test(r)) out.push('housing-authority', 'land');
    if (/finance|budget|grants?/.test(r)) out.push('funding');
    if (/mayor|council|trustee|commissioner/.test(r)) out.push('council', 'funding');
    if (/manager|administrator|clerk/.test(r) && !/housing|program/.test(r)) out.push('management');
    return out;
  }

  // What the next step needs, most important first. Plain outreach goes to the
  // housing lead, then planning, then the manager.
  function needsFromAction(text) {
    var t = String(text || '').toLowerCase(), out = [];
    function add() { for (var i = 0; i < arguments.length; i++) if (out.indexOf(arguments[i]) === -1) out.push(arguments[i]); }
    if (/zoning|entitle|annex|code|comp(rehensive)? plan|pud|plat|inclusionary|density/.test(t)) add('zoning');
    if (/land|site|parcel|rfp|rfq|land.?bank|ground lease|lots?\b|acre/.test(t)) add('land', 'housing-authority');
    if (/fund|grant|fee|money|budget|prop(osition)? ?123|arpa|waiver|tax/.test(t)) add('funding');
    if (/housing authority|ihs|housing director|housing program/.test(t)) add('housing-authority');
    if (/council|vote|board|trustee|election/.test(t)) add('council');
    add('housing-authority', 'zoning', 'management');
    return out;
  }

  // Every contact for the place from both sources, the same person once.
  function mergeContacts(network, researched) {
    var byName = {}, out = [];
    (network || []).forEach(function (c) {
      if (!c || !c.name) return;
      var row = { name: c.name, role: c.role || '', org: c.org || '', email: c.email || '', phone: c.phone || '',
        last_talked: c.last_talked && c.last_talked !== 'never' ? c.last_talked : '', tier: c.relationship_tier || '',
        covers: coversFromRole(c.role), source_url: '', source_label: '', mine: true };
      byName[nameKey(c.name)] = row; out.push(row);
    });
    (researched || []).forEach(function (c) {
      if (!c || !c.name || !/^https:\/\//.test(c.source_url || '')) return;
      var have = byName[nameKey(c.name)];
      var covers = Array.isArray(c.covers) && c.covers.length ? c.covers : coversFromRole(c.role);
      if (have) {
        have.email = have.email || c.email || '';
        have.phone = have.phone || c.phone || '';
        have.covers = have.covers.concat(covers.filter(function (x) { return have.covers.indexOf(x) === -1; }));
        have.source_url = c.source_url; have.source_label = c.source_label || '';
        if (!have.role) have.role = c.role || '';
        return;
      }
      var row = { name: c.name, role: c.role || '', org: c.org || '', email: c.email || '', phone: c.phone || '',
        last_talked: '', tier: '', covers: covers, source_url: c.source_url, source_label: c.source_label || '', mine: false };
      byName[nameKey(c.name)] = row; out.push(row);
    });
    return out;
  }

  // The latest logged discussion with each person, by name.
  function lastTalked(notes) {
    var out = {};
    (notes || []).forEach(function (n) {
      var k = nameKey(n.contact);
      if (k && /^\d{4}-\d{2}-\d{2}$/.test(n.date || '') && (!out[k] || n.date > out[k])) out[k] = n.date;
    });
    return out;
  }

  // Contacts ranked against the next step, each with a score and a reason.
  function rankContacts(network, researched, nextAction, notes) {
    var needs = needsFromAction(nextAction);
    var logged = lastTalked(notes);
    return mergeContacts(network, researched).map(function (c) {
      var k = nameKey(c.name);
      if (logged[k] && (!c.last_talked || logged[k] > c.last_talked)) c = Object.assign({}, c, { last_talked: logged[k] });
      var fit = needs.filter(function (n) { return c.covers.indexOf(n) !== -1; });
      var fitScore = fit.reduce(function (s, n) { return s + (needs.length - needs.indexOf(n)); }, 0);
      var reach = (c.phone ? 1 : 0) + (c.email ? 1 : 0);
      var talked = c.last_talked ? 3 : (c.tier === '1' ? 2 : c.tier === '2' ? 1 : 0);
      var why = [];
      if (fit.length) why.push('decides ' + fit.slice(0, 2).map(function (n) { return COVERS[n]; }).join(' and '));
      if (talked && c.last_talked) why.push('you talked on ' + c.last_talked);
      else if (c.tier === '1' || c.tier === '2') why.push('a ' + (c.tier === '1' ? 'strong' : 'warm') + ' relationship');
      why.push(reach === 2 ? 'phone and email on file' : c.phone ? 'phone on file' : c.email ? 'email on file' : 'no phone or email yet');
      return Object.assign({}, c, { score: fitScore * 2 + reach + talked, fit: fit, why: why.join('; ') });
    }).sort(function (a, b) {
      return b.score - a.score || (b.phone || b.email ? 1 : 0) - (a.phone || a.email ? 1 : 0) || a.name.localeCompare(b.name);
    });
  }

  function siteReading(s) { return s.card ? s.card.reading : 'on_file'; }

  // The place's sites, best first: a readiness reading, then an open site, then size.
  function sitesFor(ripeness, geoid) {
    return ((ripeness && ripeness.sites) || []).filter(function (s) { return s.geoid === geoid; }).sort(function (a, b) {
      var oa = a.opening && OPENING[a.opening.status], ob = b.opening && OPENING[b.opening.status];
      return RANK[siteReading(a)] - RANK[siteReading(b)] || (oa ? oa.rank : 9) - (ob ? ob.rank : 9) || (b.homes || 0) - (a.homes || 0);
    });
  }

  function phoneLink(p) { return '<a href="tel:' + esc(String(p).replace(/\(.*?\)/g, '').replace(/[^0-9+]/g, '')) + '">' + esc(p) + '</a>'; }

  function siteHtml(s) {
    var c = s.card, o = s.opening;
    var line = c
      ? LABEL[c.reading] + ' (dossier, checked ' + c.checked + '). What would change it: ' + c.trigger
      : [s.program, s.agency].filter(Boolean).join(', ') + (s.program || s.agency ? ', ' : '') + (STAGE[s.stage] || s.stage) + (s.year ? ' (' + s.year + ')' : '') + '.';
    var h = '<li><strong>' + esc(s.name) + '</strong>' + (s.homes ? ' · ' + esc(s.homes) + ' homes' : '') + '<br>' + esc(line);
    if (o && OPENING[o.status]) {
      h += '<br><span class="pc-open pc-open-' + esc(o.status) + '">' + esc(OPENING[o.status].label) + '</span> ' + esc(o.why || '') +
        (o.developer ? ' Developer: ' + esc(o.developer) + '.' : '') + (o.next_window ? ' Next: ' + esc(o.next_window) + '.' : '') +
        ((o.sources || []).length ? ' ' + o.sources.slice(0, 2).map(function (src, i) { return ext('source' + (o.sources.length > 1 ? ' ' + (i + 1) : ''), src.url); }).join(' ') : '');
    }
    var links = [];
    if (c && c.dossier_href) links.push('<a href="' + esc(c.dossier_href) + '">Open the dossier</a>', '<a href="' + esc(c.dossier_href) + '#comps-map">Comparables map</a>');
    if (/^https:\/\//.test(s.source_url || '')) links.push(ext('Public record', s.source_url));
    return h + (links.length ? '<br>' + links.join(' · ') : '') + '</li>';
  }

  // opts: { name, geoid, pipeline (row or null), network, researched, signals, ripeness, anti }
  function render(opts) {
    var p = opts.pipeline || null;
    var sites = sitesFor(opts.ripeness, opts.geoid);
    var best = sites[0] || null;
    var reading = best ? siteReading(best) : 'none';
    var place = (opts.ripeness && opts.ripeness.places && opts.ripeness.places[opts.geoid]) || null;
    // The pipeline's own next step first; the dossier's dated step when the row has none.
    var cardNext = best && best.card && best.card.next ? best.card.next : null;
    var fromPipe = !!(p && p.next_action);
    var next = fromPipe ? p.next_action : cardNext ? cardNext.what : '';
    var ranked = rankContacts(opts.network, opts.researched, next, opts.notes);
    var top = ranked.slice(0, 3);
    var sig = (opts.signals || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 3);

    var why = [
      p && p.ioi_score ? 'Pipeline score ' + p.ioi_score + (p.stage ? ', stage ' + p.stage : '') : (p ? 'In the pipeline at ' + (p.stage || 'no stage') : 'Not in your pipeline'),
      place && place.prop123 ? 'Prop 123 ' + String(place.prop123).toLowerCase() + (place.prop123_units ? ' (' + place.prop123_units + ' homes)' : '') : '',
      best ? 'Best site: ' + best.name + (best.homes ? ' (' + best.homes + ' homes)' : '') : 'No site on file in public program records'
    ].filter(Boolean).join('. ') + '.';

    var h = '<div class="pc-card" id="place-card">';
    h += '<p class="pc-head"><span class="pc-badge pc-' + esc(reading) + '">' + esc(LABEL[reading]) + '</span> ' + esc(why) + '</p>';
    if (opts.anti) h += '<p class="ib-anti-flag"><strong>Set aside</strong> ' + esc(opts.anti.date_dropped) + ': ' + esc(opts.anti.reason) + '</p>';

    h += '<h3>Next step</h3>' + (next
      ? '<p>' + esc(next) + (fromPipe ? (p.next_action_due ? ' <span class="ib-muted">(due ' + esc(p.next_action_due) + ')</span>' : '') : ' <span class="ib-muted">(' + esc(cardNext.date) + ', from the dossier)</span>') + '</p>'
      : '<p class="ib-muted">' + (p ? 'No next step set on the pipeline row.' : 'No next step set. Add the place to the pipeline from Working tools below.') + '</p>');

    h += '<h3>Call first</h3>';
    if (top.length) {
      h += '<ol class="pc-call">' + top.map(function (c) {
        return '<li><strong>' + esc(c.name) + '</strong>, ' + esc(c.role) + (c.org ? ' (' + esc(c.org) + ')' : '') + '<br>' +
          [c.phone ? phoneLink(c.phone) : '', c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : ''].filter(Boolean).join(' · ') +
          (c.phone || c.email ? '<br>' : '') + '<span class="ib-muted">Why: ' + esc(c.why) + '.' +
          (c.source_url ? ' ' + ext(c.source_label || 'Public source', c.source_url) : c.mine ? ' From your network file.' : '') + '</span></li>';
      }).join('') + '</ol>';
      if (ranked.length > 3) h += '<p class="ib-muted">' + (ranked.length - 3) + ' more below in Your contacts and in the report\'s Who to contact.</p>';
      if (!top.some(function (c) { return c.phone || c.email; })) h += '<p class="ib-muted">No phone or email on file for anyone here yet.</p>';
    } else {
      h += '<p class="ib-muted">No contacts on file for this place yet.</p>';
    }

    h += '<h3>Sites here</h3>' + (sites.length ? '<ul class="pc-sites">' + sites.map(siteHtml).join('') + '</ul>'
      : '<p class="ib-muted">No site on file in public program records (tax credit applications and Prop 123 land banking since 2023).</p>');

    if (sig.length) {
      h += '<h3>Latest signals</h3><ul class="pc-sig">' + sig.map(function (s) {
        return '<li><strong>' + esc(s.date) + '</strong> ' + esc(s.signal_type) + ': ' + esc(s.summary) + (/^https:\/\//.test(s.source_url || '') ? ' ' + ext('source', s.source_url) : '') + '</li>';
      }).join('') + '</ul>';
    }
    h += notesHtml(opts.notes, ranked, opts.notesState);
    return h + '<p><a href="developer-pipeline.html#readyToBuild">Pipeline and Ready to build</a> · <a href="dossiers/">All dossiers</a></p></div>';
  }

  // Today's date on the viewer's own calendar (toISOString is UTC, a day ahead
  // in a Colorado evening).
  function localToday(d) {
    d = d || new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // The discussion log: every talk about this place, newest first, and a form
  // to add one. notes is null when the site has nowhere to save them.
  function notesHtml(notes, contacts, state) {
    var h = '<h3 id="discussions">Discussions</h3>';
    if (notes === null || notes === undefined) {
      return h + '<p class="ib-muted">' + (state === 'loading' ? 'Loading the discussion log…' : 'The discussion log is saved on the developer site and opens there.') + '</p>';
    }
    h += notes.length ? '<ul class="pc-notes">' + notes.map(function (n) {
      return '<li><strong>' + esc(n.date) + '</strong>' + (n.contact ? ' with ' + esc(n.contact) : '') + (n.by ? ' <span class="ib-muted">logged by ' + esc(n.by) + '</span>' : '') +
        '<br>' + esc(n.said) + (n.next ? '<br><strong>Next:</strong> ' + esc(n.next) + (n.next_date ? ' (' + esc(n.next_date) + ')' : '') : '') +
        ' <button type="button" class="pc-note-remove" data-note="' + esc(n.id) + '">Remove</button></li>';
    }).join('') + '</ul>' : '<p class="ib-muted">No discussions logged yet.</p>';
    var today = localToday();
    return h + '<form class="pc-note-form" id="pcNoteForm"><fieldset><legend>Log a discussion</legend>' +
      '<label>Date <input type="date" name="date" value="' + today + '" required></label>' +
      '<label>Who <input type="text" name="contact" list="pcContactList" autocomplete="off" maxlength="120"></label>' +
      '<datalist id="pcContactList">' + (contacts || []).map(function (c) { return '<option value="' + esc(c.name) + '"></option>'; }).join('') + '</datalist>' +
      '<label>What was said <textarea name="said" rows="3" required maxlength="4000"></textarea></label>' +
      '<label>Next step <input type="text" name="next" maxlength="400"></label>' +
      '<label>By when <input type="date" name="next_date"></label>' +
      '<button type="submit" class="btn">Save to the log</button> <span class="pc-note-status" role="status"></span>' +
      '<p class="ib-muted">Everyone you let into the developer site can read this log.</p></fieldset></form>';
  }

  // Wires the form and remove buttons inside a rendered card. save(body) posts
  // to the site and resolves to the new list; done(list) re-renders.
  function wireNotes(root, geoid, save, done) {
    var form = root.querySelector('#pcNoteForm');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements, status = form.querySelector('.pc-note-status');
      var body = { geoid: geoid, date: f.date.value, contact: f.contact.value.trim(), said: f.said.value.trim(), next: f.next.value.trim(), next_date: f.next_date.value };
      if (!body.said) return;
      status.textContent = 'Saving…';
      save(body).then(done, function () { status.textContent = 'Not saved. Check you are still signed in, then try again.'; });
    });
    Array.prototype.forEach.call(root.querySelectorAll('.pc-note-remove'), function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('Remove this entry from the log for everyone?')) return;
        save({ geoid: geoid, remove: b.getAttribute('data-note') }).then(done);
      });
    });
  }

  return {
    coversFromRole: coversFromRole, needsFromAction: needsFromAction, mergeContacts: mergeContacts,
    rankContacts: rankContacts, lastTalked: lastTalked, localToday: localToday, sitesFor: sitesFor, render: render, wireNotes: wireNotes, OPENING: OPENING
  };
});
