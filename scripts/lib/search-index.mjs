// Records for dist/search-index.json, which js/site-search.js (the header search box and
// search.html) ranks in the browser. Pure functions over page source, so the coverage test
// can derive what the index must contain from the same inputs the builder reads.
//
// Record fields: t title, u URL relative to the site root, d description, k headings,
// a aliases (old names that now redirect here), b the page's other visible words, each once.

import { isSensitive } from './public-sensitive-patterns.mjs';

const STOP_WORDS = new Set(('a an and are as at be by for from has have in is it its of on or ' +
  'that the this to was were will with you your').split(' '));
const MAX_BODY_WORDS = 1500;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", mdash: '—', ndash: '–' };

// One pass, so "&amp;lt;" decodes to the text "&lt;", never on to "<".
function decode(text) {
  return String(text).replace(/&(nbsp|amp|lt|gt|quot|#39|mdash|ndash);/g, (m, name) => ENTITIES[name]);
}

function clean(text) {
  return decode(String(text).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Text a reader can see in the static HTML: no scripts (JSON-LD included), styles or comments.
export function pageText(html) {
  return clean(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' '));
}

// Each distinct word once, in first-seen order. Phrase order is lost, which is why the
// browser scores this field lowest: it answers "does this page talk about X", not "is it about X".
export function wordBag(text, exclude = '') {
  const skip = new Set(String(exclude).toLowerCase().split(/[^a-z0-9]+/));
  const seen = new Set();
  for (const word of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    // A word the public guard forbids on its own (the one allowed photo credit's brand name)
    // stays out of the bag, where it would lose the words around it that make it allowed.
    if (word.length < 2 || STOP_WORDS.has(word) || skip.has(word) || seen.has(word) || isSensitive(word)) continue;
    seen.add(word);
    if (seen.size >= MAX_BODY_WORDS) break;
  }
  return Array.from(seen).join(' ');
}

function headings(html) {
  // Not from scripts: a heading inside a template literal is code, not a heading.
  return (String(html).replace(/<script\b[\s\S]*?<\/script>/gi, ' ').match(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi) || [])
    .map(clean).filter(Boolean);
}

function record(t, u, d, headingList, bodyHtml, { body = true } = {}) {
  const k = Array.from(new Set(headingList)).join(' · ');
  const rec = { t, u, d, k };
  if (body) {
    // A map or chart has no visible words of its own; its aria-label says what it shows.
    const labels = Array.from(String(bodyHtml).matchAll(/\saria-label="([^"]*)"/gi), (m) => m[1]).join(' ');
    const b = wordBag(`${pageText(bodyHtml)} ${decode(labels)}`, `${t} ${d} ${k}`);
    if (b) rec.b = b;
  }
  return rec;
}

// The page-level tabs a page offers, in order: [{ id, label }]. Only the `.page-tabs`
// component, because its script opens the panel a URL hash names; inner tab strips do not.
export function pageTabs(html) {
  const bar = String(html).match(/<div[^>]*role="tablist"[^>]*class="page-tabs"[^>]*>([\s\S]*?)<\/div>/i);
  if (!bar) return [];
  return Array.from(bar[1].matchAll(/<button[^>]*aria-controls="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi))
    .map((m) => ({ id: m[1], label: clean(m[2]) }));
}

// One record per page, or one per page-level tab so a search lands on the tab that answers it.
// The first tab keeps the bare URL (it is what the page opens on); the others get #<panel id>.
export function pageRecords(rel, html, { body = true } = {}) {
  const titleM = String(html).match(/<title>([\s\S]*?)<\/title>/i);
  const title = clean(titleM ? titleM[1] : '');
  if (!title) return [];
  const descM = String(html).match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const desc = clean(descM ? descM[1] : '');
  const tabs = pageTabs(html);
  const starts = tabs.map((tab) => String(html).search(new RegExp(`<[^>]+role="tabpanel"[^>]*id="${tab.id}"|<[^>]+id="${tab.id}"[^>]*role="tabpanel"`)));
  if (tabs.length < 2 || starts.some((s) => s < 0)) {
    return [record(title, rel, desc, headings(html), html, { body })];
  }
  const pageName = title.replace(/\s*\|.*$/, '');
  return tabs.map((tab, i) => {
    // Everything before the second panel belongs to the first: the page header sits above the tabs.
    const from = i === 0 ? 0 : starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : html.length;
    const part = html.slice(from, to);
    const t = i === 0 ? title : `${tab.label} — ${pageName} | COHO Analytics`;
    const u = i === 0 ? rel : `${rel}#${tab.id}`;
    return record(t, u, desc, [tab.label, ...headings(part)], part, { body });
  });
}

// A redirect stub's old name, and where it now points: market-intelligence.html →
// { alias: 'Market Intelligence', target: 'colorado-deep-dive.html#tab-signals' }.
export function redirectAlias(rel, html) {
  const m = String(html).match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"']+)["']/i);
  if (!m) return null;
  const target = m[1].trim();
  if (/^[a-z]+:|^\/\//i.test(target)) return null;
  const base = rel.split('/').pop().replace(/\.html$/, '');
  const alias = base.split(/[-_]/).filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  return { alias, target: dir + target.replace(/^\.\//, '') };
}

// Counties have no profile page; the Housing Needs Assessment opens on one from its GEOID.
// auto=1 makes the URL win over a jurisdiction the reader had selected earlier.
export function countyRecords(rankingIndex) {
  return (rankingIndex.rankings || [])
    .filter((row) => row.type === 'county' && /^08\d{3}$/.test(row.geoid))
    .map((row) => ({
      t: `${row.name} — Housing Needs Assessment | COHO Analytics`,
      u: `housing-needs-assessment.html?geoid=${row.geoid}&geoType=county&auto=1`,
      d: `Housing needs, affordability, and LIHTC context for ${row.name}, Colorado${row.region ? ` (${row.region})` : ''}.`,
      k: `${row.name} · County · Housing Needs Assessment`
    }));
}

// Every string research-brief.html renders as text for a brief: takeaway, summary, practical
// implications, long-form sections (headings, paragraphs, list, table, note) and source titles.
// The search record and test/public-build-metadata.test.mjs both read it, so a field the reader
// starts rendering is searchable once it is added here.
export function briefRenderedText(brief) {
  const sections = (Array.isArray(brief.sections) ? brief.sections : []).flatMap((s) => [
    s && s.heading, ...((s && s.paragraphs) || []), s && s.items_heading, ...((s && s.items) || []),
    s && s.table && s.table.caption, ...((s && s.table && s.table.columns) || []),
    ...((s && s.table && s.table.rows) || []).flat(), s && s.note,
    s && s.steps && s.steps.caption,
    ...((s && s.steps && s.steps.items) || []).flatMap((step) => [step && step.level, step && step.label, step && step.text]),
    s && s.see_also && s.see_also.text
  ]);
  return [brief.takeaway, brief.summary, brief.implications, ...sections, ...(brief.articles || []).map((a) => a && a.title)]
    .flat().filter((v) => typeof v === 'string');
}

// Curated research briefs are only reachable by id; the bare reader is an empty shell.
export function briefRecords(curated) {
  return (curated.briefs || [])
    .filter((brief) => brief.is_curated && brief.id)
    .map((brief) => {
      const rec = {
        t: `${clean(brief.title)} | COHO Research Brief`,
        u: `research-brief.html?id=${encodeURIComponent(brief.id)}`,
        d: clean(brief.summary || '').slice(0, 300),
        k: clean(brief.policy_topic || 'Research brief')
      };
      const text = briefRenderedText(brief).map(clean).join(' ');
      const b = wordBag(text, `${rec.t} ${rec.k}`);
      if (b) rec.b = b;
      return rec;
    });
}

// Each program in the developer funding guide opens its own card on the Funding Sources tab
// (colorado-deep-dive.html?program=<id>#tab-funding). The cards are drawn from JSON, so the
// tab's static HTML never carries a program's name; without these a search for "Section 811"
// or "CAPABLE" found nothing. URL form matches js/funding-fit.js guideUrl().
export function fundingProgramRecords(guide) {
  return ((guide && guide.programs) || [])
    .filter((p) => p && p.id && p.name)
    .map((p) => {
      const rec = {
        t: `${clean(p.name)} | COHO Funding Sources`,
        u: `colorado-deep-dive.html?program=${encodeURIComponent(p.id)}#tab-funding`,
        d: clean(p.what_it_funds || '').slice(0, 300),
        k: clean([p.administrator, 'Funding Sources'].filter(Boolean).join(' · '))
      };
      const text = [p.eligible_projects, p.eligible_applicants, p.ami_restriction, p.award_size, p.application_cycle,
        ...(p.key_considerations || [])].filter((v) => typeof v === 'string').map(clean).join(' ');
      const b = wordBag(text, `${rec.t} ${rec.d} ${rec.k}`);
      if (b) rec.b = b;
      return rec;
    });
}

// A public methodology doc: its first heading is the title, its first paragraph the description.
export function markdownRecord(rel, md) {
  const text = String(md);
  const h1 = text.match(/^#\s+(.+)$/m);
  const name = h1 ? h1[1].replace(/[*_`]/g, '').trim() : rel.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' ');
  const para = text.split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !/^(#|>|\||-{3,}|```|!\[)/.test(p)) || '';
  const d = para.replace(/[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 300);
  const k = (text.match(/^#{2,3}\s+.+$/gm) || []).map((h) => h.replace(/^#+\s+/, '').replace(/[*_`]/g, '').trim()).join(' · ');
  const t = `${name} | COHO Methodology`;
  const rec = { t, u: rel, d, k };
  const b = wordBag(text.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']'), `${t} ${d} ${k}`);
  if (b) rec.b = b;
  return rec;
}
