// Member access: the Home panel that sells it, and the quote request form (#/request-access).
// paul, 5 Nov 2026: Home should sell advanced access, not list free tools; no seat price on the site; visitors
// ask for a quote through a form that sizes their scope and timeline, then send it.
// The lab has no server, so "Send request" opens an email to info@cohoanalytics.com with the request written
// out, plus a block of plain "key: value" lines that the team reads to size the work. Nothing is stored and
// no price, rate or estimate is shown here: sizing and pricing happen privately after the request arrives.
// The member tools themselves stay behind the member gate; this file only describes them and links the
// Member tools page.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl;
  var esc = Shell.esc;
  var TO = 'info@cohoanalytics.com';
  var ROUTE = '#/request-access';

  // What member access adds. Plain descriptions only; no member data or figures.
  var OFFER = [
    ['map', 'Where a deal pencils', 'A county map of where a tax credit deal can close its gap, and what moves it.'],
    ['file', 'Site dossiers', 'One file per site: need, market, environmental screen, land sales and approvals.'],
    ['sheet', 'Deal workbooks', 'Sources and uses, a pro forma and an investor summary, exported as a locked workbook.'],
    ['pin', 'Market screen and Where to look', 'Capture rate, rents and every town ranked for the 4% or 9% deal you are chasing.']
  ];
  var ICON = { map: 'map', file: 'report', sheet: 'sheet', pin: 'place' };

  function panel() {
    return '<section class="ma-panel" aria-labelledby="ma-h"><div class="ma-head"><p class="ma-kicker">For developers and housing teams</p>' +
      '<h2 id="ma-h">Member access: the tools behind a deal</h2>' +
      '<p>The public pages show need and market for any place. Members get the site-level work that goes into an application.</p></div>' +
      '<ul class="ma-tiles">' + OFFER.map(function (o) {
        return '<li><span class="ma-icon">' + global.LabIcon.svg(ICON[o[0]]) + '</span><h3>' + esc(o[1]) + '</h3><p>' + esc(o[2]) + '</p></li>';
      }).join('') + '</ul>' +
      '<div class="ma-cta"><a class="button-link" href="' + ROUTE + '">Request a quote</a>' +
      '<a class="button-link secondary" href="#/members">See member tools</a>' +
      '<p class="note">Tell us your sites and timeline. We reply with a scope and quote. Seats and project work are quoted per team.</p></div></section>';
  }

  // ---- The form ----------------------------------------------------------------------------------
  var ROLES = ['Developer', 'Housing authority', 'Town or county', 'Lender or investor', 'Consultant', 'Other'];
  var NEEDS = [
    ['tools', 'Member tool access for my team'],
    ['dossier', 'Site dossiers for specific sites'],
    ['workbook', 'A deal workbook and pro forma built for a project'],
    ['review', 'A review of a pro forma or application we already have'],
    ['market', 'Market study support for a CHFA application'],
    ['hna', 'A housing needs assessment or Prop 123 plan for a town or county'],
    ['other', 'Something else (describe below)']
  ];
  var SITES = [['1', '1'], ['2-3', '2 to 3'], ['4-10', '4 to 10'], ['10+', 'More than 10'], ['0', 'None yet']];
  var DEAL = [['9pct', '9% tax credit'], ['4pct', '4% tax credit with bonds'], ['both', 'Both'], ['forsale', 'For-sale or ownership'], ['unsure', 'Not sure yet']];
  var STAGE = [['exploring', 'Exploring places'], ['site', 'Have a site in mind'], ['contract', 'Site under contract'], ['applying', 'Applying in an upcoming round'], ['awarded', 'Awarded, now closing or building']];
  var WHEN = [['2wk', 'Within 2 weeks'], ['1mo', 'Within a month'], ['1-3mo', 'In 1 to 3 months'], ['3mo+', 'More than 3 months out']];
  var TERM = [['project', 'One project'], ['6mo', 'About 6 months'], ['12mo', 'A year'], ['ongoing', 'Ongoing']];

  function radios(name, opts, required) {
    return opts.map(function (o, i) {
      return '<label><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (required && i === 0 ? ' required' : '') + '> ' + esc(o[1]) + '</label>';
    }).join('');
  }
  function field(id, label, type, extra) {
    return '<label for="rq-' + id + '">' + label + '</label><input id="rq-' + id + '" name="' + id + '" type="' + (type || 'text') + '"' + (extra || '') + '>';
  }

  function form(p) {
    return '<form class="stack rq-form" data-action="quote" novalidate>' +
      '<fieldset><legend>1. About you</legend>' +
      field('name', 'Your name', 'text', ' required autocomplete="name"') +
      field('org', 'Organization', 'text', ' required autocomplete="organization"') +
      field('email', 'Email', 'email', ' required autocomplete="email"') +
      '<label for="rq-role">Role</label><select id="rq-role" name="role">' + ROLES.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select>' +
      '</fieldset>' +
      '<fieldset><legend>2. What you need (pick any)</legend>' + NEEDS.map(function (n) {
        return '<label><input type="checkbox" name="need" value="' + n[0] + '"' + (p.get('need') === n[0] ? ' checked' : '') + '> ' + esc(n[1]) + '</label>';
      }).join('') +
      field('seats', 'How many people need sign-in?', 'number', ' min="0" max="50" value="1" inputmode="numeric"') + '</fieldset>' +
      '<fieldset><legend>3. Scope</legend>' +
      '<p class="rq-q">How many sites or projects?</p>' + radios('sites', SITES) +
      field('places', 'Towns or counties', 'text', ' placeholder="For example Mesa County, Montrose"') +
      '<p class="rq-q">Deal type</p>' + radios('deal', DEAL) +
      '<p class="rq-q">Where are you now?</p>' + radios('stage', STAGE) + '</fieldset>' +
      '<fieldset><legend>4. Timeline</legend>' +
      '<p class="rq-q">When do you need the first results?</p>' + radios('when', WHEN) +
      field('deadline', 'A hard date, if there is one (an application round, a board meeting)', 'date') +
      field('deadlineWhat', 'What is that date?', 'text', ' placeholder="For example CHFA 9% round"') +
      '<p class="rq-q">How long do you expect to use the tools?</p>' + radios('term', TERM) + '</fieldset>' +
      '<fieldset><legend>5. Anything else</legend><label for="rq-notes" class="sr-only">Notes</label>' +
      '<textarea id="rq-notes" name="notes" rows="4" placeholder="Sites, unit counts, what you have already done, what worries you"></textarea></fieldset>' +
      '<p class="note">We check every request for conflicts of interest before we reply. ' +
      'What you send goes to ' + esc(TO) + ' only. See the <a href="#/privacy">Privacy policy</a>.</p>' +
      '<div class="rq-errors" role="alert" aria-live="assertive"></div>' +
      '<button type="submit">Review my request</button></form>';
  }

  function label(opts, v) { var o = opts.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : ''; }

  // Read the form into a plain request. Pure, so the check can run it without a browser.
  function read(get, getAll) {
    var r = {
      name: (get('name') || '').trim(), org: (get('org') || '').trim(), email: (get('email') || '').trim(), role: get('role') || '',
      needs: getAll('need') || [], seats: Math.max(0, Math.min(50, parseInt(get('seats'), 10) || 0)),
      sites: get('sites') || '', places: (get('places') || '').trim(), deal: get('deal') || '', stage: get('stage') || '',
      when: get('when') || '', deadline: get('deadline') || '', deadlineWhat: (get('deadlineWhat') || '').trim(),
      term: get('term') || '', notes: (get('notes') || '').trim()
    };
    return r;
  }
  function problems(r) {
    var out = [];
    if (!r.name) out.push('Add your name.');
    if (!r.org) out.push('Add your organization.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) out.push('Add an email we can reply to.');
    if (!r.needs.length) out.push('Pick at least one thing you need.');
    if (!r.when) out.push('Say when you need the first results.');
    return out;
  }

  // A plain read of size and pace for the visitor. No hours, rates or prices.
  function glance(r) {
    var n = { '0': 0, '1': 1, '2-3': 3, '4-10': 10, '10+': 12 }[r.sites] || 0;
    var heavy = r.needs.filter(function (x) { return ['dossier', 'workbook', 'review', 'market', 'hna'].indexOf(x) >= 0; }).length;
    var size = n >= 4 || heavy >= 3 || r.needs.indexOf('hna') >= 0 ? 'Larger' : n >= 2 || heavy >= 2 ? 'Medium' : 'Focused';
    var days = r.deadline ? Math.round((new Date(r.deadline + 'T12:00:00') - new Date()) / 864e5) : null;
    var rush = r.when === '2wk' || (days !== null && days >= 0 && days < 21);
    return { size: size, pace: rush ? 'Rush' : r.when === '3mo+' ? 'Planned ahead' : 'Standard', days: days };
  }

  function ref(r, now) {
    var d = (now || new Date()).toISOString().slice(2, 10).replace(/-/g, '');
    var h = 0, s = r.email + r.org + r.name;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'Q-' + d + '-' + (h % 46656).toString(36).toUpperCase().padStart(3, '0');
  }

  // The email body: a readable summary, then the block the team parses.
  function body(r, code) {
    var needs = r.needs.map(function (x) { return label(NEEDS, x); });
    var lines = [
      'Quote request ' + code, '',
      r.name + ', ' + r.org + ' (' + r.role + ')', r.email, '',
      'Needs: ' + needs.join('; '),
      'People who need sign-in: ' + r.seats,
      'Sites or projects: ' + (label(SITES, r.sites) || 'not given') + (r.places ? ' in ' + r.places : ''),
      'Deal type: ' + (label(DEAL, r.deal) || 'not given') + '. Stage: ' + (label(STAGE, r.stage) || 'not given'),
      'First results: ' + label(WHEN, r.when) + (r.deadline ? '. Hard date ' + r.deadline + (r.deadlineWhat ? ' (' + r.deadlineWhat + ')' : '') : ''),
      'Expected use: ' + (label(TERM, r.term) || 'not given'),
      '', 'Notes: ' + (r.notes || 'none'), '',
      '--- COHO quote request v1 ---',
      'ref: ' + code, 'role: ' + r.role, 'needs: ' + r.needs.join(','), 'seats: ' + r.seats, 'sites: ' + r.sites,
      'places: ' + r.places, 'deal: ' + r.deal, 'stage: ' + r.stage, 'when: ' + r.when, 'deadline: ' + r.deadline,
      'deadline_what: ' + r.deadlineWhat, 'term: ' + r.term,
      '--- end ---'
    ];
    return lines.join('\n');
  }
  function mailto(r, code) {
    return 'mailto:' + TO + '?subject=' + encodeURIComponent('Quote request ' + code + ': ' + r.org) + '&body=' + encodeURIComponent(body(r, code));
  }

  function review(r) {
    var code = ref(r), g = glance(r);
    return '<section class="rq-review" aria-labelledby="rq-rev-h"><h2 id="rq-rev-h" tabindex="-1">Your request at a glance</h2>' +
      '<ul class="rq-glance"><li><span class="rq-g-n">' + esc(g.size) + '</span><span class="rq-g-l">scope</span></li>' +
      '<li><span class="rq-g-n">' + esc(g.pace) + '</span><span class="rq-g-l">timeline' + (g.days !== null && g.days >= 0 ? ', ' + g.days + ' days to your date' : '') + '</span></li>' +
      '<li><span class="rq-g-n">' + esc(String(r.seats)) + '</span><span class="rq-g-l">' + (r.seats === 1 ? 'person' : 'people') + ' to sign in</span></li></ul>' +
      '<pre class="rq-body">' + esc(body(r, code).split('\n--- COHO')[0]) + '</pre>' +
      '<div class="actions"><a class="button-link rq-send" href="' + esc(mailto(r, code)) + '">Send request</a>' +
      '<button type="button" class="button-link secondary rq-edit">Change something</button></div>' +
      '<p class="note">Send request opens your email with everything filled in, addressed to ' + esc(TO) + '. If no email app opens, copy the text above and send it there with ' + esc(code) + ' in the subject. ' +
      'We reply with a scope, a schedule and a quote.</p></section>';
  }

  function view(p) {
    return T.head({
      kind: 'tool', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Member tools', href: '#/members' }, { label: 'Request a quote' }],
      title: 'Request a quote for member access',
      answer: 'Tell us your sites, what you need and when. We reply with a scope, a schedule and a quote for your team.'
    }) + '<div class="rq-wrap">' + form(p) + '<div class="rq-out"></div></div>';
  }

  // The shell's submit handler stops every form from leaving the page; this one then reads the quote form.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (!f || !f.dataset || f.dataset.action !== 'quote') return;
      ev.preventDefault();
      var fd = new FormData(f);
      var r = read(function (k) { return fd.get(k); }, function (k) { return fd.getAll(k); });
      var errs = problems(r), box = f.querySelector('.rq-errors'), out = f.parentNode.querySelector('.rq-out');
      if (errs.length) { box.innerHTML = '<ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'; return; }
      box.innerHTML = '';
      f.hidden = true;
      out.innerHTML = review(r);
      out.querySelector('h2').focus();
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.rq-edit');
      if (!b) return;
      var wrap = b.closest('.rq-wrap');
      wrap.querySelector('.rq-out').innerHTML = '';
      var f = wrap.querySelector('.rq-form'); f.hidden = false; f.querySelector('input').focus();
    });
  }

  Shell.views['request-access'] = view;
  global.LabAccess = { panel: panel, OFFER: OFFER, NEEDS: NEEDS, read: read, problems: problems, glance: glance, ref: ref, body: body, mailto: mailto, review: review, TO: TO };
})(typeof window !== 'undefined' ? window : globalThis);
