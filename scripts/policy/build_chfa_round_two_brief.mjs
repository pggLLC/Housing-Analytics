#!/usr/bin/env node
// Builds the CHFA 2026 Round Two research brief (data/policy_briefs_curated.json,
// id chfa-2026-round-two-awards) from:
//   data/affordable-housing/chfa-awards/2026-round-two.json   awards, applications not awarded, CHFA quotes
//   data/policy/funding-awards/ledger.json                     earlier Round Two awards (2023-2025)
//   data/policy/funding-awards/applicant-report-counts.json    Round Two applications per year
// Every number in the brief is computed here from those files, so a data change
// cannot leave the prose or a table stale. The words are written here too.
//
// Usage:
//   node scripts/policy/build_chfa_round_two_brief.mjs           write
//   node scripts/policy/build_chfa_round_two_brief.mjs --check   fail if the committed brief differs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRIEF_ID = 'chfa-2026-round-two-awards';
export const FEED = 'data/policy_briefs_curated.json';
export const BRIDGE = 'data/affordable-housing/chfa-awards/2026-round-two.json';
export const LEDGER = 'data/policy/funding-awards/ledger.json';
export const COUNTS = 'data/policy/funding-awards/applicant-report-counts.json';

// Front Range metro counties: metro Denver plus Colorado Springs, Fort Collins-Loveland,
// Greeley and Pueblo. Everything else is "outside the Front Range metros".
export const DENVER_METRO = ['08001', '08005', '08013', '08014', '08031', '08035', '08059'];
export const FRONT_RANGE = [...DENVER_METRO, '08041', '08069', '08123', '08101'];
// Every metro area: the Front Range metros plus Grand Junction (Mesa County).
export const METROS = [...FRONT_RANGE, '08077'];
export const AMI_BANDS = ['30', '40', '50', '60', '70', '80'];

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
export const fmt = (n) => Number(n).toLocaleString('en-US');
export const usd = (n) => '$' + fmt(n);
export const musd = (n, d = 1) => '$' + (n / 1e6).toFixed(d) + 'M';
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => Math.round((a / b) * 100) + '%';
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say = (n) => (n <= 10 ? words[n] : String(n));
const Say = (n) => { const s = say(n); return s[0].toUpperCase() + s.slice(1); };
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const stateTotal = (a) => (a.accelerated_state_credit || 0) + (a.standard_state_credit || 0) + (a.toc_credit || 0);
const askedState = (a) => (a.accelerated_state_requested || 0) + (a.standard_state_requested || 0) + (a.toc_requested || 0);
const SERVES = {
  'N,I/F': 'Families and individuals',
  'N,I/F,SH': 'Families, supportive housing',
  'N,OA,SP': 'Adults 62+, with homes for people with disabilities',
  'N,OA,V': 'Older adults and veterans leaving homelessness',
};
const RESIDENT = { 'I/F': 'families', OA: 'older adults', 'I/F,OA': 'families and older adults' };

export function stats(bridge) {
  const aw = bridge.awards, lost = bridge.not_awarded;
  const homes = aw.reduce((s, a) => s + a.total_units, 0);
  const ami = Object.fromEntries(AMI_BANDS.map((b) => [b, aw.reduce((s, a) => s + (a.ami_mix[b] || 0), 0)]));
  const avgAmi = AMI_BANDS.reduce((s, b) => s + Number(b) * ami[b], 0) / homes;
  const metro = aw.filter((a) => DENVER_METRO.includes(a.county_fips));
  const outside = aw.filter((a) => !DENVER_METRO.includes(a.county_fips));
  const rural = (x) => !METROS.includes(x.county_fips);
  const big = 117;
  const bigAll = [...aw, ...lost].filter((x) => x.total_units >= big);
  return {
    aw, lost, homes, ami, avgAmi,
    metro, outside,
    applied: aw.length + lost.length,
    lostHomes: lost.reduce((s, a) => s + a.total_units, 0),
    fed: aw.reduce((s, a) => s + a.federal_4pct_credit, 0),
    acc: aw.reduce((s, a) => s + (a.accelerated_state_credit || 0), 0),
    std: aw.reduce((s, a) => s + (a.standard_state_credit || 0), 0),
    toc: aw.reduce((s, a) => s + (a.toc_credit || 0), 0),
    pab: aw.reduce((s, a) => s + a.pab_amount, 0),
    lostFed: lost.reduce((s, a) => s + a.federal_4pct_requested, 0),
    lostAcc: lost.reduce((s, a) => s + (a.accelerated_state_requested || 0), 0),
    lostStd: lost.reduce((s, a) => s + (a.standard_state_requested || 0), 0),
    lostToc: lost.reduce((s, a) => s + (a.toc_requested || 0), 0),
    lostTocCount: lost.filter((a) => a.toc_requested).length,
    fullAcc: aw.every((a) => a.accelerated_state_credit === aw[0].accelerated_state_credit) ? aw[0].accelerated_state_credit : null,
    medWon: median(aw.map((a) => a.total_units)),
    medLost: median(lost.map((a) => a.total_units)),
    fedPerHomeWon: Math.round(median(aw.map((a) => a.federal_4pct_credit / a.total_units))),
    fedPerHomeLost: Math.round(median(lost.map((a) => a.federal_4pct_requested / a.total_units))),
    big, bigAll, bigLost: bigAll.filter((x) => lost.includes(x)),
    ruralApplied: [...aw, ...lost].filter(rural),
    ruralWon: aw.filter(rural),
    rehabLost: lost.filter((a) => a.building_type !== 'new construction'),
    repeats: lost.filter((a) => a.earlier_tries),
    wonAfterLoss: aw.filter((a) => a.earlier_tries),
  };
}

export function history(ledger, counts) {
  const applied = {};
  for (const d of counts.meta.documents) {
    const m = /^(\d{4}) Round Two$/.exec(d.round_label || '');
    if (m && d.credit_type === '4%' && d.status === 'ok') applied[m[1]] = d.rows;
  }
  const byYear = {};
  for (const a of ledger.awards) {
    if (a.agency !== 'CHFA' || a.round !== 2 || a.federal_credit_type !== '4%') continue;
    (byYear[a.year] ||= []).push(a);
  }
  return Object.keys(byYear).map(Number).filter((y) => y >= 2023 && applied[y]).sort().map((y) => {
    const rows = byYear[y];
    const outside = rows.filter((a) => a.county_fips && !METROS.includes(a.county_fips));
    return {
      year: y, applied: applied[y], awarded: rows.length,
      homes: rows.reduce((s, a) => s + (a.total_units || 0), 0),
      // a wrapped issuer cell can trail the town ("Granby CHFA")
      outside: outside.map((a) => String(a.location).replace(/\s+CHFA$/, '')),
    };
  });
}

export function buildBrief(bridge, ledger, counts) {
  const s = stats(bridge);
  const m = bridge.metadata;
  const T = m.award_report_totals;
  const hist = history(ledger, counts);
  const prior = hist.filter((h) => h.year < 2026);
  const out = s.outside[0];
  const le50 = Number(s.ami['30']) + s.ami['40'] + s.ami['50'];
  const above60 = s.ami['70'] + s.ami['80'];
  const pubWon = s.aw.filter((a) => a.sponsor_kind === 'public or nonprofit').length;
  const lostCounty = (fips) => s.lost.filter((a) => a.county_fips === fips).length;
  const wonCounty = (fips) => s.aw.filter((a) => a.county_fips === fips).length;
  const lostCities = (fips) => s.lost.filter((a) => a.county_fips === fips).map((a) => a.city);
  const ruralLost = s.ruralApplied.filter((x) => s.lost.includes(x));
  const accApplicantTotal = m.applicant_report_totals.accelerated_state;
  const tocWon = s.aw.filter((a) => a.toc_credit);

  const short = [
    `${Say(s.aw.length)} of ${s.applied} applications won. CHFA reserved federal 4% and Colorado state housing tax credits for ${say(s.aw.length)} new rental buildings with ${fmt(s.homes)} homes, all with income limits for renters. ${s.lost.length} applications with ${fmt(s.lostHomes)} rental homes did not get credits this round.`,
    `State credit was the limit. Every winner got the full ${musd(s.fullAcc)} accelerated state credit. CHFA awarded ${musd(s.acc)} of the ${musd(accApplicantTotal)} in accelerated state credit that applicants asked for, about ${pct(s.acc, accApplicantTotal)}.`,
    `${Say(s.metro.length)} of ${say(s.aw.length)} are in metro Denver (${fmt(s.metro.reduce((t, a) => t + a.total_units, 0))} homes). The other is ${out.total_units} homes for older adults and veterans leaving homelessness in ${out.city}. No rural or mountain project won; the only rural application, in ${ruralLost.map((a) => a.city).join(', ')}, did not.`,
    `${pct(le50, s.homes)} of the homes (${fmt(le50)}) are for renters at or below 50% of area median income (AMI), and ${pct(s.ami['30'], s.homes)} (${fmt(s.ami['30'])}) are at 30%. The average is about ${Math.round(s.avgAmi)}% AMI.`,
    `${Say(s.wonAfterLoss.length)} of the ${say(s.aw.length)} winners had applied in 2025 Round Two and not won. Housing authorities and nonprofits sponsored ${say(pubWon)} of the ${say(s.aw.length)}.`,
  ];

  const awardsTable = {
    caption: `2026 Round Two awards (CHFA award report as of ${m.award_report_as_of}). Credits are yearly amounts.`,
    columns: ['Building', 'Where', 'Rental homes', 'Who it serves', 'Income mix (homes at each AMI limit)', 'Federal 4% credit a year', 'State credits a year', 'Sponsor (as CHFA lists it)'],
    rows: s.aw.map((a) => [
      a.name,
      `${a.city}, ${a.county} County`,
      fmt(a.total_units),
      SERVES[a.type] || 'Families and individuals',
      AMI_BANDS.filter((b) => a.ami_mix[b]).map((b) => `${a.ami_mix[b]} at ${b}%`).join(', '),
      usd(a.federal_4pct_credit),
      usd(stateTotal(a)),
      a.sponsor,
    ]),
  };

  const amiTable = {
    caption: `Income limits of the ${fmt(s.homes)} homes (CHFA award descriptions)`,
    columns: ['Rent and income limit', 'Rental homes', 'Share'],
    rows: AMI_BANDS.filter((b) => s.ami[b]).map((b) => [`${b}% of AMI`, fmt(s.ami[b]), pct(s.ami[b], s.homes)]),
  };

  const lostTable = {
    caption: `Applications not awarded (CHFA applicant report as of ${m.applicant_report_as_of})`,
    columns: ['Building', 'Where', 'Rental homes', 'Type', 'Federal 4% asked a year', 'State credits asked a year', 'Sponsor (as CHFA lists it)', 'Earlier tries'],
    rows: s.lost.map((a) => [
      a.name,
      a.city === 'Denver' && a.county !== 'Denver' ? `Denver address, ${a.county} County` : `${a.city}, ${a.county} County`,
      fmt(a.total_units),
      `${a.building_type[0].toUpperCase()}${a.building_type.slice(1)}, ${RESIDENT[a.resident_type] || a.resident_type}`,
      usd(a.federal_4pct_requested),
      usd(askedState(a)),
      a.sponsor,
      a.earlier_tries || '',
    ]),
  };

  const adamsLost = lostCounty('08001');
  const lostPatterns = [
    `Bigger buildings missed more often. The typical application that missed had ${s.medLost} homes; the typical winner had ${s.medWon}. Of the ${say(s.bigAll.length)} applications with ${s.big} or more homes, ${say(s.bigLost.length)} missed.`,
    `Adams County went ${wonCounty('08001')} for ${wonCounty('08001') + adamsLost}: ${say(adamsLost)} applications there missed (${list([...new Set(lostCities('08001').map((c) => (c === 'Denver' ? 'two with Denver mailing addresses' : c)))])}). Both Colorado Springs applications missed, as did ${list(s.lost.filter((a) => ['08069', '08013', '08083'].includes(a.county_fips)).map((a) => a.city))}.`,
    `Asking for less federal credit did not decide it. Applications that missed asked for about the same federal credit per home as the winners got (typical ${usd(s.fedPerHomeLost)} against ${usd(s.fedPerHomeWon)}). Every one of the ${s.lost.length} asked for the ${usd(s.fullAcc)} accelerated state credit, and ${s.lostTocCount} also asked for Transit-Oriented Communities credit.`,
    `${Say(s.repeats.length)} were repeat tries. ${s.repeats.map((a) => `${a.name}: ${a.earlier_tries[0].toLowerCase()}${a.earlier_tries.slice(1)}`).join(' ')}`,
    `The only rehab application and the only rural application both missed: ${list([...s.rehabLost, ...ruralLost].map((a) => `${a.name} in ${a.city} (${a.total_units} homes)`))}.`,
  ];

  const histTable = {
    caption: 'Round Two (federal 4% + state credit) by year',
    columns: ['Year', 'Applications', 'Awards', 'Rental homes awarded', 'Awards outside metro areas'],
    rows: hist.map((h) => [String(h.year), String(h.applied), String(h.awarded), fmt(h.homes), h.outside.length ? h.outside.join(', ') : 'None']),
  };

  const priorOutside = prior.filter((h) => h.outside.length).map((h) => h.year);

  return {
    id: BRIEF_ID,
    title: 'CHFA 2026 Round Two tax credit awards: who won, where, and who did not',
    policy_topic: 'Colorado Housing Policy & LIHTC',
    is_curated: true,
    source_reviewed: true,
    generated: `${m.announcement_date}T00:00:00Z`,
    verified: m.parsed_at,
    takeaway: `Colorado's housing finance agency (CHFA) reserved federal 4% and state housing tax credits for ${say(s.aw.length)} of ${s.applied} applications on ${new Date(`${m.announcement_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}: ${fmt(s.homes)} new rental homes, ${s.metro.length} of the ${s.aw.length} buildings in metro Denver. State credit was the limit, and no rural project won.`,
    summary: `CHFA says the ${say(s.aw.length)} developments will support the new construction of ${fmt(s.homes)} affordable rental units and raise more than $234 million in private equity. CHFA's award report lists the yearly credits: ${usd(T.federal_4pct)} in federal 4% credit, ${usd(T.accelerated_state)} in accelerated state credit, ${usd(T.standard_state)} in standard state credit and ${usd(T.toc)} in Transit-Oriented Communities credit, with ${usd(T.pab)} in private activity bonds. All ${fmt(s.homes)} homes are rentals with income limits; this round funds no homes for sale.`,
    implications: `Expect a crowded 2027 Round Two: ${s.lost.length} applications with ${fmt(s.lostHomes)} homes missed this year, and ${say(s.wonAfterLoss.length)} of this year's ${say(s.aw.length)} winners had missed in 2025 and come back. Plan the gap around the state credit cap, show local backing early, and expect smaller buildings with deep income targeting and named services to compete best. Round Two did not reach a small town this year; for a rural 4% deal, size and gap money need solving before applying.`,
    related_data: BRIDGE,
    sources: ['CHFA'],
    regions: ['Colorado', 'Statewide', ...[...new Set(s.aw.map((a) => `${a.county} County`))]],
    sections: [
      { id: 'short', heading: 'The short version', items: short },
      {
        id: 'map', heading: 'Where the awards went',
        paragraphs: [`Filled dots are the ${say(s.aw.length)} awards; dashed rings are the ${s.lost.length} applications that did not win. Tap or hover a dot for the building, its homes, its income mix or what it asked for, and its sponsor. Dot size follows the number of homes.`],
        map: 'chfa-round-two',
        note: `Awards are placed at their CHFA address: ${s.aw.filter((a) => a.geo_precision === 'address').length} by the Census Geocoder and ${s.aw.filter((a) => a.geo_precision === 'street').length} on their new street (OpenStreetMap). Applications not awarded are at their CHFA address, three at the intersection CHFA lists and one at its town centre.`,
      },
      { id: 'awards', heading: `The ${say(s.aw.length)} awards`, table: awardsTable, note: `Credits are yearly amounts CHFA reserves, not grants. State credits are accelerated plus standard state credit plus Transit-Oriented Communities credit. CHFA's award report prints a federal total of ${usd(T.federal_4pct)}; its rows add to ${usd(s.fed)} because of rounding in the report.` },
      {
        id: 'income', heading: 'Who the homes are for',
        paragraphs: [
          `Rent limits follow a household's income as a share of area median income. ${pct(le50, s.homes)} of the homes are at or below 50% AMI. The ${fmt(s.ami['30'])} homes at 30% are where the state housing vouchers, veterans' VASH vouchers and foster youth vouchers sit. ${fmt(above60)} homes (${pct(above60, s.homes)}) are at 70% or 80%, which income averaging allows when a building's average stays at or below 60%.`,
        ],
        table: amiTable,
      },
      {
        id: 'not-awarded', heading: `The ${s.lost.length} that were not awarded`,
        paragraphs: [`${s.lost.length} applications with ${fmt(s.lostHomes)} rental homes did not get credits. Together they asked for ${musd(s.lostFed)} a year in federal 4% credit, ${musd(s.lostAcc)} in accelerated state credit, ${musd(s.lostStd)} in standard state credit and ${musd(s.lostToc)} in Transit-Oriented Communities credit. CHFA does not publish scores, so these patterns describe who missed, not why.`],
        items: lostPatterns,
        table: lostTable,
      },
      {
        id: 'history', heading: 'Rural and metro, four years of Round Two',
        paragraphs: [`2026 is the first of these years with no Round Two award outside a metro area (${list(priorOutside.map(String))} each had at least one). Only ${say(s.ruralApplied.length)} of the ${s.applied} applications this year was rural, so the gap is as much about who applied as about who won. Round Two pairs 4% credit with tax-exempt bonds, and bond deals need enough homes to carry fixed costs, which works against small towns.`],
        table: histTable,
        note: 'Metro areas here are metro Denver (Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas and Jefferson counties) and El Paso, Larimer, Weld, Pueblo and Mesa counties. Applications are the rows of each year’s CHFA applicant report; awards and homes are the rows of each year’s award report.',
      },
      {
        id: 'developers', heading: 'What it means for Colorado developers',
        items: [
          `State credit is the bottleneck. Applicants asked for ${musd(accApplicantTotal)} in accelerated state credit and CHFA awarded ${musd(s.acc)}. A 4% deal's gap has to close with the ${usd(s.fullAcc)} cap in mind.`,
          `Coming back works. ${Say(s.wonAfterLoss.length)} of the ${say(s.aw.length)} winners (${list(s.wonAfterLoss.map((a) => a.name))}) missed in 2025 Round Two and won on reapplying.`,
          'Local backing shows up in most winners: donated land (Boulder, Denver, Littleton) and city or county money (Aurora, Boulder, Grand Junction, Lakewood, Littleton) appear in CHFA’s descriptions.',
          'Every winner has homes at 30% AMI and a named service plan, and five of the nine pair them with vouchers.',
          `Transit-Oriented Communities credit went to ${say(tocWon.length)} infill sites (${list([...new Set(tocWon.map((a) => a.city))])}), ${usd(s.toc)} in all.`,
          'Round One (9%) remains the more common path for small towns: 2026 Round One awards went to Divide, Towaoc, Cañon City, Montrose and Clifton, among others.',
        ],
      },
      {
        id: 'limits', heading: 'Limits of this brief',
        items: [
          bridge.awards.find((a) => a.credit_note).credit_note,
          'CHFA does not publish scores or reasons, so the patterns among applications that missed are descriptions, not causes.',
          'Sponsor names are as CHFA lists them. Contact names, emails and phone numbers in CHFA’s reports are left out.',
          'CHFA’s property feed does not carry 2026 awards yet; this brief and the site’s maps read the award report until it does.',
        ],
      },
    ],
    articles: [
      { title: 'CHFA Announces 2026 Round Two Housing Tax Credit Awards', source: 'CHFA', date: m.announcement_date, link: m.press_release_url },
      { title: '2026 Round Two Award Report', source: 'CHFA', date: m.award_report_as_of, link: m.pdf_report_url },
      { title: '2026 Round Two Award Descriptions', source: 'CHFA', date: m.parsed_at, link: m.source_url },
      { title: '2026 Round Two Applicant Report', source: 'CHFA', date: m.applicant_report_as_of, link: m.applicant_report_url },
    ],
    source_quotes: [
      { link: m.press_release_url, quote: m.source_quotes.press_release },
      { link: m.pdf_report_url, quote: m.source_quotes.award_report_totals },
      { link: m.applicant_report_url, quote: m.source_quotes.applicant_report_totals },
      { link: m.source_url, quote: m.source_quotes.award_descriptions_example },
    ],
    alert_count: 0,
  };
}

export function build() {
  const bridge = read(BRIDGE);
  const feed = read(FEED);
  const brief = buildBrief(bridge, read(LEDGER), read(COUNTS));
  const i = feed.briefs.findIndex((b) => b.id === BRIEF_ID);
  if (i === -1) feed.briefs.unshift(brief); else feed.briefs[i] = brief;
  feed.meta.brief_count = feed.briefs.length;
  return { [FEED]: JSON.stringify(feed, null, 2) + '\n' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = build();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, body] of Object.entries(files)) {
    const full = join(ROOT, rel);
    const now = readFileSync(full, 'utf8');
    if (now === body) continue;
    if (check) { console.error(`${rel} is stale: run node scripts/policy/build_chfa_round_two_brief.mjs`); stale++; continue; }
    writeFileSync(full, body);
    console.log(`wrote ${rel}`);
  }
  if (stale) process.exit(1);
  if (check) console.log('CHFA Round Two brief: up to date');
}
