#!/usr/bin/env node
/**
 * Step 7 — the recommendation.
 *
 * Every conclusion this repo can reach is computed somewhere and then left
 * there: the HNA's short answer, the AMI-gap module, the ownership screen, the
 * deal calculator. A reader finished the six-step workflow holding six pages
 * and no answer, and #1620 §3 records step 7 as having no owner at all.
 *
 * Two things this file exists to hold:
 *
 * 1. **It is a data contract, not a DOM harvest.** The workflow's own saved
 *    state already IS a harvest — WorkflowState.setStep('hsa', …) stores
 *    `costBurden: "49.5%"`, a formatted string scraped out of a <span> — and a
 *    synthesis built on that inherits every one of its silences: a step never
 *    opened and a step whose element was missing look identical. So place
 *    conclusions come from the jurisdiction digest, which carries value,
 *    confidence, source, vintage, geography level and denominator for all 136
 *    metrics, and the reader's own steps are quoted back as a record rather
 *    than fed into a calculation.
 *
 * 2. **Insufficient evidence is a verdict, not a hole.** 220 of 546
 *    jurisdictions carry `confidence: "low"` on the core need metrics and 199
 *    have a cost-burden rate below the denominator floor. Half the state gets
 *    no recommendation. A page that only worked on the good half would be
 *    wrong for most of Colorado, so the insufficient state has its own text,
 *    its own drawing, and its own list of what is missing — and the headline
 *    never softens it into a hedge that reads like advice.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const Contract = require('../js/workflow/recommendation-contract.js');
const Page = require('../js/workflow/recommendation-page.js');

const DIGEST_DIR = 'data/hna/jurisdiction-metrics-digest';
const digest = (geoid) => json(`${DIGEST_DIR}/${geoid}.json`);
const ALL = fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => f.endsWith('.json'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('recommendation-leads-with-the-conclusion');

/* ── The contract is built from data, not from other pages ──────────────── */

test('the contract touches no DOM and no network', () => {
  const src = read('js/workflow/recommendation-contract.js');
  assert.ok(!/document\.|window\.|fetch\(|localStorage/.test(src.replace(/^[\s\S]*?function \(\) \{/, '')),
    'the contract reaches for the page or the network; it must take everything as arguments');
  assert.ok(!/new Date\(\)/.test(src),
    'the contract reads the clock, so its output is not reproducible from its inputs');
});

test('every one of the 546 jurisdictions produces a contract', () => {
  // Not a sample. A synthesis that throws on one town in the state is a
  // synthesis nobody can trust to open.
  assert.ok(ALL.length >= 500, `only ${ALL.length} digests found`);
  const broken = [];
  for (const file of ALL) {
    try {
      const contract = Contract.build({
        digest: json(`${DIGEST_DIR}/${file}`), project: null, generatedAt: 'x'
      });
      if (!contract.headline || !contract.headline.verdict) broken.push(`${file}: no headline`);
      if (contract.conclusions.length !== 5) broken.push(`${file}: ${contract.conclusions.length} conclusions`);
    } catch (e) { broken.push(`${file}: ${e.message}`); }
  }
  assert.deepStrictEqual(broken.slice(0, 10), [], `${broken.length} jurisdictions broke: ${broken.slice(0, 5).join('; ')}`);
});

/* ── Insufficient evidence is a real, common verdict ────────────────────── */

test('insufficient evidence is the outcome for a large share of the state', () => {
  // If this ever collapses to a handful, the thresholds have drifted loose and
  // the page has started answering questions the data cannot answer.
  const states = { established: 0, provisional: 0, insufficient: 0 };
  for (const file of ALL) {
    const contract = Contract.build({ digest: json(`${DIGEST_DIR}/${file}`), project: null, generatedAt: 'x' });
    states[contract.headline.state] += 1;
  }
  assert.ok(states.insufficient > ALL.length * 0.2,
    `only ${states.insufficient} of ${ALL.length} jurisdictions reach "insufficient"; `
    + 'the thresholds have loosened and the page is answering what the data cannot');
  assert.ok(states.insufficient < ALL.length * 0.9,
    `${states.insufficient} of ${ALL.length} are insufficient; the page now says nothing about anywhere`);
});

test('no headline claims more than the digest does', () => {
  // The ownership engine's metrics are tagged medium confidence throughout the
  // digest, so no jurisdiction can currently reach "established" at the
  // headline. That is a true statement about the data, not dead code — pinned
  // so that if the digest ever upgrades those metrics, someone reads this
  // comment instead of assuming the state was always unreachable.
  const established = ALL.filter((file) => {
    const d = json(`${DIGEST_DIR}/${file}`);
    return Contract.build({ digest: d, project: null, generatedAt: 'x' }).headline.state === Contract.ESTABLISHED;
  });
  const ownershipConfidences = new Set(ALL.slice(0, 50).map((file) =>
    json(`${DIGEST_DIR}/${file}`).metrics.ownership_need_recommendation.confidence));
  if (established.length > 0) {
    assert.ok(!ownershipConfidences.has('medium'),
      `${established.length} headlines are "established" while the ownership metric is still `
      + 'medium confidence; the page is claiming more than its source');
  }
});

test('an insufficient conclusion names what is missing and asserts nothing', () => {
  // Aetna Estates: cost burden reported as 0% on 201 households, median home
  // value $52,038 carried over from the county. A page that printed those as
  // this CDP's answer would be the exact failure step 7 exists to prevent.
  const contract = Contract.build({ digest: digest('0800620'), project: null, generatedAt: 'x' });
  const need = contract.conclusions.find((c) => c.id === 'need');
  assert.strictEqual(need.state, Contract.INSUFFICIENT);
  assert.strictEqual(need.verdict, null, 'an insufficient conclusion still asserted a verdict');
  assert.ok(need.blocking.length > 0, 'nothing is listed as blocking');
  for (const line of need.blocking) {
    assert.ok(/—/.test(line), `blocking line does not say why: ${line}`);
  }
  assert.strictEqual(contract.headline.state, Contract.INSUFFICIENT);
  assert.ok(/No recommendation/.test(contract.headline.verdict),
    `the headline hedged instead of declining: ${contract.headline.verdict}`);
});

test('a figure borrowed from another geography is always named as borrowed', () => {
  // The masking bug, stated as an assertion. A place's median home value often
  // arrives as `county_context` — a real number about the surrounding county.
  const borrowed = [];
  for (const file of ALL.slice(0, 120)) {
    const d = json(`${DIGEST_DIR}/${file}`);
    if (d.geography.type === 'county') continue;
    const contract = Contract.build({ digest: d, project: null, generatedAt: 'x' });
    for (const conclusion of contract.conclusions) {
      for (const item of conclusion.evidence) {
        const level = (d.metrics[item.key] || {}).geography_level;
        if (level && level !== 'place' && item.borrowedFrom === null) {
          borrowed.push(`${d.geography.name} ${item.key} is ${level} but is not flagged`);
        }
      }
    }
  }
  assert.deepStrictEqual(borrowed.slice(0, 5), [],
    `${borrowed.length} borrowed figures presented as the jurisdiction's own`);
});

test('a rate on too few households is refused, whatever its confidence says', () => {
  // Exercised directly, because no published metric reaches this branch today:
  // all 3,847 floored metrics in the digest are ALSO tagged low confidence,
  // which is caught one line earlier. That makes the floor check look like
  // dead code in a scan of the data, and a scan is how it would get deleted.
  // It is the guard that matters if the digest ever tags a floored rate as
  // confident — a cost-burden percentage resting on forty households is not a
  // finding at any confidence level.
  const floored = Contract.evidence(
    { made_up: { value: 61.2, confidence: 'high', geography_level: 'place',
      source_id: 'test', as_of: 'test', denominator: 41, min_denominator: 50,
      denominator_floor_applied: true } },
    'made_up', 'Renters paying over 30% of income', { requestedLevel: 'place' });
  assert.strictEqual(floored.state, Contract.INSUFFICIENT,
    'a rate below the denominator floor was accepted because its confidence said high');
  assert.ok(/41/.test(floored.why) && /50/.test(floored.why),
    `the reason does not name the denominator or the floor: ${floored.why}`);

  // And the reality above, recorded: if a floored metric ever arrives without
  // low confidence, this stops being a hypothetical.
  let flooredAndConfident = 0;
  for (const file of ALL) {
    const metrics = json(`${DIGEST_DIR}/${file}`).metrics;
    for (const metric of Object.values(metrics)) {
      if (metric.denominator_floor_applied === true && metric.value !== null
        && metric.confidence !== 'low' && metric.confidence !== 'missing') flooredAndConfident += 1;
    }
  }
  assert.strictEqual(flooredAndConfident, 0,
    `${flooredAndConfident} metrics are now floored AND confident. That is not a failure — it `
    + 'means the branch above is live. Check that the page still refuses them and update this count.');
});

test('a conclusion takes the worst state of its evidence, never the average', () => {
  assert.strictEqual(Contract.worst(['established', 'insufficient']), 'insufficient');
  assert.strictEqual(Contract.worst(['established', 'provisional']), 'provisional');
  assert.strictEqual(Contract.worst(['established', 'established']), 'established');
  // And it shows up in a real record: one solid measure must not carry an
  // absent one.
  const mixed = ALL.map((f) => Contract.build({ digest: json(`${DIGEST_DIR}/${f}`), project: null, generatedAt: 'x' }))
    .flatMap((c) => c.conclusions)
    .filter((c) => new Set(c.evidence.map((e) => e.state)).size > 1);
  assert.ok(mixed.length > 0, 'no conclusion in the whole state has mixed evidence; the scan is blind');
  for (const conclusion of mixed.slice(0, 200)) {
    assert.strictEqual(conclusion.state, Contract.worst(conclusion.evidence.map((e) => e.state)),
      `${conclusion.id} settled above its weakest evidence`);
  }
});

/* ── The reader's own steps are quoted, not recomputed ──────────────────── */

test('an unfinished step says so and links to itself', () => {
  const contract = Contract.build({ digest: digest('0820000'), project: null, generatedAt: 'x' });
  assert.strictEqual(contract.project.length, Contract.STEPS.length);
  for (const step of contract.project) {
    assert.strictEqual(step.status, 'not_run', `${step.key} reported as recorded with no project`);
    assert.deepStrictEqual(step.fields, [], `${step.key} invented values for a step never run`);
    assert.ok(step.href, `${step.key} offers no way to go and do it`);
  }
});

test('a recorded step is quoted verbatim, with its date', () => {
  const project = {
    hsa: { completedAt: '2026-09-15T10:00:00Z', costBurden: '49.5%', population: '715,878' },
    deal: { completedAt: '2026-09-15T11:00:00Z', outputs: { gap: '$4,200,000' } }
  };
  const contract = Contract.build({ digest: digest('0820000'), project, generatedAt: 'x' });
  const hsa = contract.project.find((s) => s.key === 'hsa');
  assert.strictEqual(hsa.status, 'recorded');
  assert.strictEqual(hsa.recordedAt, '2026-09-15T10:00:00Z');
  assert.ok(hsa.fields.some((f) => f.value === '49.5%'),
    'the recorded cost burden was reformatted or recomputed rather than quoted');
  const deal = contract.project.find((s) => s.key === 'deal');
  assert.ok(deal.fields.some((f) => f.value === '$4,200,000'), 'the deal gap was not read from outputs');
  const market = contract.project.find((s) => s.key === 'market');
  assert.strictEqual(market.status, 'not_run', 'a step with no data was reported as recorded');
});

/* ── What the reader sees ───────────────────────────────────────────────── */

function renderFor(geoid, project) {
  const dom = new JSDOM('<main><div id="mount"></div></main>', { url: 'http://127.0.0.1/recommendation.html' });
  const contract = Contract.build({ digest: digest(geoid), project: project || null, generatedAt: 'x' });
  const mount = dom.window.document.getElementById('mount');
  Page.render(mount, contract);
  return { dom, mount, contract };
}

test('the conclusion is literally first on the page', () => {
  const { mount } = renderFor('0820000');
  const first = mount.firstElementChild;
  assert.ok(first.classList.contains('rec-headline'),
    `the page opens with .${first.className} instead of the verdict`);
  const verdict = first.querySelector('.rec-headline__verdict');
  assert.ok(verdict && verdict.textContent.trim().length > 0, 'the headline carries no verdict');
  // And nothing a reader has to work through comes before it.
  const firstTable = mount.querySelector('table');
  if (firstTable) {
    const order = first.compareDocumentPosition(firstTable);
    assert.ok(order & first.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      'a table renders above the verdict');
  }
});

test('the evidence is present but folded away', () => {
  const { mount } = renderFor('0820000');
  const details = mount.querySelectorAll('.rec-conclusion details.rec-evidence');
  assert.strictEqual(details.length, 5, `${details.length} evidence blocks; expected one per conclusion`);
  for (const node of details) {
    assert.strictEqual(node.hasAttribute('open'), false,
      'evidence is expanded by default, which puts a table between the reader and the answer');
    assert.ok(node.querySelector('table'), 'an evidence block holds no table');
  }
});

test('an insufficient verdict is drawn as a different thing, not a red number', () => {
  const { mount } = renderFor('0800620');
  const headline = mount.querySelector('.rec-headline');
  assert.strictEqual(headline.getAttribute('data-state'), 'insufficient');
  assert.ok(/No recommendation/.test(headline.textContent),
    'the insufficient headline reads as an answer rather than a refusal');
  const blocked = mount.querySelectorAll('.rec-conclusion[data-state="insufficient"] .rec-blocking li');
  assert.ok(blocked.length > 0, 'nothing on screen says what is missing');
  const none = mount.querySelectorAll('.rec-conclusion[data-state="insufficient"] .rec-none');
  assert.ok(none.length > 0, 'an unanswered question still shows a verdict');
});

test('every rendered figure carries its source and its standing', () => {
  const { mount } = renderFor('0820000');
  const rows = mount.querySelectorAll('.rec-table tbody tr');
  assert.ok(rows.length >= 8, `only ${rows.length} evidence rows rendered`);
  for (const row of rows) {
    assert.ok(row.getAttribute('data-state'), 'an evidence row carries no standing');
    assert.ok(row.querySelector('.rec-chip'), 'an evidence row shows no standing chip');
    assert.ok(row.children.length === 5, 'the evidence table lost a column');
    assert.ok(row.children[3].textContent.trim().length > 0, 'an evidence row names no source');
  }
});

test('the page never prints a raw provenance token at a reader', () => {
  const { mount } = renderFor('0820000');
  const text = mount.textContent;
  for (const token of ['county_context', 'hud-chas-place-apportioned', 'undefined', 'null', 'NaN', '[object']) {
    if (token === 'hud-chas-place-apportioned') {
      // Source ids ARE shown, deliberately — they are how a reader re-checks a
      // figure. They belong in the source column and nowhere else.
      continue;
    }
    assert.ok(!text.includes(token), `"${token}" reached the reader`);
  }
});

/* ── The evidence links back to the steps that produced it ──────────────── */

test('every conclusion says where it was computed, and that place exists', () => {
  // #1620 §6 criterion 7: "one screen, conclusion first, then evidence links
  // back to steps 2-6". Shipped without this half — the evidence tables named
  // a source_id and nothing more, so a reader could see a figure came from
  // `hud-chas-place-apportioned` and still have no way to reach the working.
  //
  // The link is checked against the target markup, not just spelled correctly.
  // A chapter that moves a section should break the build rather than ship a
  // link that scrolls nowhere, which is indistinguishable from a working one
  // until someone clicks it.
  const contract = Contract.build({ digest: digest('0820000'), project: null, generatedAt: 'x' });
  assert.strictEqual(contract.conclusions.length, 5);
  for (const conclusion of contract.conclusions) {
    const at = conclusion.computedAt;
    assert.ok(at, `${conclusion.id} does not say where it was computed`);
    assert.ok(fs.existsSync(path.join(ROOT, at.page)), `${conclusion.id} points at ${at.page}, which does not exist`);
    assert.ok(read(at.page).includes(`id="${at.anchor}"`),
      `${conclusion.id} links to ${at.page}#${at.anchor}, but that page has no element with that id`);
    assert.ok(at.label && at.label.length > 3, `${conclusion.id} has no readable link text`);
  }
});

test('an insufficient conclusion still links to the evidence it lacks', () => {
  // The reader told their evidence is too thin is the one who most wants to go
  // and look at it. Dropping the link on the unanswered questions would leave
  // exactly the wrong half linked.
  const contract = Contract.build({ digest: digest('0800620'), project: null, generatedAt: 'x' });
  const blocked = contract.conclusions.filter((c) => c.state === Contract.INSUFFICIENT);
  assert.ok(blocked.length > 0, 'the sample jurisdiction answers everything; pick another');
  for (const conclusion of blocked) {
    assert.ok(conclusion.computedAt, `${conclusion.id} lost its link because it could not be answered`);
  }
});

test('the rendered page carries one back-link per conclusion', () => {
  const { mount } = renderFor('0820000');
  const links = mount.querySelectorAll('.rec-conclusion .rec-source-link a');
  assert.strictEqual(links.length, 5, `${links.length} back-links rendered; expected one per conclusion`);
  for (const link of links) {
    const href = link.getAttribute('href');
    assert.ok(/^[a-z0-9-]+\.html#[A-Za-z][\w-]*$/.test(href), `back-link href is malformed: ${href}`);
    assert.ok(link.textContent.trim().length > 6, 'a back-link has no readable text');
  }
});

test('a recorded step keeps its link, not only an unfinished one', () => {
  // It had the relationship backwards: the step a reader most wants to reopen
  // is the one they already did and now want to change.
  const project = {
    hsa: { completedAt: '2026-09-15T10:00:00Z', costBurden: '49.5%' },
    deal: { completedAt: '2026-09-15T11:00:00Z', outputs: { gap: '$4,200,000' } }
  };
  const { mount } = renderFor('0820000', project);
  const steps = mount.querySelectorAll('.rec-step');
  assert.strictEqual(steps.length, Contract.STEPS.length);
  for (const step of steps) {
    const link = step.querySelector('a[href]');
    assert.ok(link, `the ${step.dataset.stepKey} step (${step.dataset.status}) offers no way back to it`);
    const expected = Contract.STEPS.find((s) => s.key === step.dataset.stepKey).href;
    assert.strictEqual(link.getAttribute('href'), expected,
      `the ${step.dataset.stepKey} step links somewhere other than its own page`);
  }
  const recorded = mount.querySelectorAll('.rec-step[data-status="recorded"] a[href]');
  assert.strictEqual(recorded.length, 2, 'the recorded steps lost their links again');
});

test('the PDF spells out the path a reader cannot click', () => {
  const lines = [];
  const stub = function () {
    return {
      internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
      setFontSize() {}, setFont() {}, setTextColor() {}, addPage() {},
      splitTextToSize: (t) => [String(t)],
      text: (t) => lines.push(Array.isArray(t) ? t.join(' ') : String(t))
    };
  };
  const { contract } = renderFor('0820000');
  Page.exportPdf(contract, stub);
  const body = lines.join('\n');
  for (const conclusion of contract.conclusions) {
    assert.ok(body.includes(conclusion.computedAt.page),
      `the PDF never says where "${conclusion.question}" was computed; it is the copy that gets forwarded`);
  }
});

/* ── Step 7 is on the route ─────────────────────────────────────────────── */

test('step 7 is on every rail, and the component agrees', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const railed = pages.filter((f) => read(f).includes('class="wf-step'));
  assert.ok(railed.length >= 12, `only ${railed.length} rails found`);
  const missing = railed.filter((f) => !/data-step="7"/.test(read(f)));
  assert.deepStrictEqual(missing, [], `these rails stop at step 6: ${missing.join(', ')}`);

  const component = read('js/components/workflow-progress.js');
  const step7 = /\{ num: 7,[^}]*href: '([^']+)' \}/.exec(component);
  assert.ok(step7, 'the rail component has no step 7');
  assert.strictEqual(step7[1], 'recommendation.html');
});

test('the homepage offers it as the seventh card', () => {
  const src = read('index.html');
  assert.ok(/aria-label="Step 7: Recommendation"/.test(src), 'no step 7 card on the homepage');
  assert.ok(/<span class="home-step__num"[^>]*>07<\/span>/.test(src), 'the seventh card is not numbered 07');
});

test('the page loads what it needs, and nothing it does not', () => {
  const html = read('recommendation.html');
  for (const src of ['js/workflow-state-core.js', 'js/workflow-state-api.js',
    'js/components/jurisdiction-url-context.js', 'js/workflow/recommendation-contract.js',
    'js/workflow/recommendation-page.js']) {
    assert.ok(html.includes(`src="${src}"`), `recommendation.html does not load ${src}`);
  }
  assert.ok(!/hna-renderers\.js|hna-export\.js/.test(html),
    'the page pulls in the HNA page\'s modules; step 7 must read the contract, not another page');
});

/* ── Export ─────────────────────────────────────────────────────────────── */

test('the export is built from the contract, not from the screen', () => {
  const src = read('js/workflow/recommendation-page.js');
  const exportBody = src.slice(src.indexOf('function exportPdf'));
  assert.ok(!/document\.|getElementById|querySelector|canvas/.test(exportBody),
    'the PDF builder reads the DOM; on this page that would export someone else\'s screen');
});

test('the PDF is named after the jurisdiction it is about', () => {
  const { contract } = renderFor('0820000');
  assert.strictEqual(Page.pdfFilename(contract), 'denver-city-recommendation.pdf');
  const empty = Contract.build({ digest: null, project: null, generatedAt: 'x' });
  assert.strictEqual(Page.pdfFilename(empty), 'no-jurisdiction-recommendation.pdf');
});

test('the PDF carries the verdict and every blocking reason', () => {
  const lines = [];
  const stub = function () {
    return {
      internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
      setFontSize() {}, setFont() {}, setTextColor() {}, addPage() {},
      splitTextToSize: (t) => [String(t)],
      text: (t) => lines.push(Array.isArray(t) ? t.join(' ') : String(t))
    };
  };
  const { contract } = renderFor('0800620');
  Page.exportPdf(contract, stub);
  const body = lines.join('\n');
  assert.ok(body.includes(contract.headline.verdict), 'the PDF omits the verdict');
  for (const conclusion of contract.conclusions) {
    assert.ok(body.includes(conclusion.question), `the PDF omits "${conclusion.question}"`);
    for (const line of conclusion.blocking) {
      assert.ok(body.includes(line), 'the PDF drops a blocking reason, so it reads more certain than the page');
    }
  }
  assert.ok(/not a housing needs study|Screening synthesis/i.test(body),
    'the exported document carries no screening disclosure');
});

test('no jurisdiction gives a usable page rather than an empty one', () => {
  const dom = new JSDOM('<main><div id="mount"></div></main>', { url: 'http://127.0.0.1/recommendation.html' });
  const contract = Contract.build({ digest: null, project: null, generatedAt: 'x' });
  Page.render(dom.window.document.getElementById('mount'), contract);
  const text = dom.window.document.getElementById('mount').textContent;
  assert.ok(/No jurisdiction selected/.test(text), 'the empty state says nothing');
  assert.ok(/Choose a jurisdiction/.test(text), 'the empty state offers no way forward');
  assert.strictEqual(contract.conclusions.length, 0, 'conclusions were invented with no jurisdiction');
});

console.log(failures === 0
  ? '  recommendation-leads-with-the-conclusion: PASS'
  : `  recommendation-leads-with-the-conclusion: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
