const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name + '\n    ' + err.message);
    process.exitCode = 1;
  }
}

(async () => {
  const ROOT = path.resolve(__dirname, '..');
  const { isDeniedCandidateUrl, urlVariants } = await import('../scripts/discover-local-resources.mjs');
  const localResources = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/local-resources.json'), 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/local-resources-candidates.json'), 'utf8'));

  console.log('Local resources discovery guards');

  run('denies known squatter domain for Greenwood Village', () => {
    assert.strictEqual(isDeniedCandidateUrl('https://townofgreenwood.org/'), true);
    assert.strictEqual(isDeniedCandidateUrl('https://www.townofgreenwood.org/housing'), true);
    assert.strictEqual(isDeniedCandidateUrl('https://www.greenwoodvillage.com/'), false);
  });

  run('Greenwood slug variants do not include townofgreenwood.org', () => {
    const variants = urlVariants('greenwood');
    assert(variants.length > 0, 'variant generation is non-vacuous');
    assert(!variants.some((url) => /townofgreenwood\.org/i.test(url)), 'known squatter domain is excluded');
  });

  run('Greenwood Village has a curated local-resources entry', () => {
    const entry = localResources['place:0833035'];
    assert(entry, 'place:0833035 exists in local-resources.json');
    assert.strictEqual(entry.housingLead.name, 'Greenwood Village Community Development');
    assert.strictEqual(entry.housingLead.url, 'https://www.greenwoodvillage.com/1064/Community-Development');
  });

  run('candidate snapshot no longer carries Greenwood squatter URL', () => {
    const serialized = JSON.stringify(candidates);
    assert(!/townofgreenwood\.org/i.test(serialized), 'candidate file excludes townofgreenwood.org');
  });

  // ── #2125: non-Colorado and junk-host candidates are dropped ──────────
  // Fixtures are shaped on what the 2026-10-09 digest actually listed.
  const { classifyBaseCandidate, isNonMunicipalHost, looksLikeColorado } =
    await import('../scripts/discover-local-resources.mjs');

  const DROP = [
    { label: 'Las Animas -> geo.org tour-booking page (mentions colorado, still junk)',
      c: { url: 'https://www.lasanimas.org/', finalUrl: 'https://geo.org/tours/?keywords1=947&keywords2=colorado-l947',
           title: 'Tours &#8211; Book Things To Do, Attractions &amp; Tours &#8211; Geo.org',
           body: '<a href="/tours/?keywords2=colorado-l947">Colorado tours</a>' },
      reason: 'non-municipal-host' },
    { label: 'Glendale -> parked domain-for-sale page',
      c: { url: 'https://cityofglendale.org/', finalUrl: 'https://cityofglendale.org/',
           title: 'cityofglendale.org - contact with domain owner | Epik.com', body: '<p>Make an offer</p>' },
      reason: 'parked-domain' },
    { label: 'Evans -> Evans, New York',
      c: { url: 'https://www.townofevans.org/', finalUrl: 'https://townofevansny.gov/', title: 'Town of Evans',
           body: '<p>Town of Evans, 8787 Erie Road, Angola, NY 14006. Town Board co-op agenda. Co. Highway</p>' },
      reason: 'no-colorado-mention' },
    { label: 'Florence -> Florence, South Carolina',
      c: { url: 'https://www.cityofflorence.com/', finalUrl: 'https://www.cityofflorencesc.gov/', title: 'City of Florence, SC',
           body: '<p>324 W Evans St, Florence, SC 29501</p>' },
      reason: 'no-colorado-mention' },
  ];
  const KEEP = [
    { label: 'Dacono (", CO" in the title)',
      c: { url: 'https://www.daconoco.gov/', finalUrl: 'https://www.daconoco.gov/',
           title: 'Dacono, CO - Official Website | Official Website', body: '<p>City Council agenda</p>' } },
    { label: 'Fountain Housing Authority ("CO 80817" address only)',
      c: { url: 'https://fountainhousingauthority.colorado.gov/', finalUrl: 'https://fountainhousingauthority.colorado.gov/',
           title: 'Home | Fountain Housing Authority', body: '<p>501 E IOWA AVE. FOUNTAIN CO 80817</p>' } },
    { label: 'Evans, Colorado (word "Colorado" in the body)',
      c: { url: 'https://www.evanscolorado.gov/', finalUrl: 'https://www.evanscolorado.gov/',
           title: 'Home | City of Evans', body: '<p>Welcome to the City of Evans, Colorado</p>' } },
  ];

  run('#2125 non-Colorado, parked and junk-host candidates are dropped', () => {
    assert(DROP.length > 0, 'non-vacuous');
    for (const { label, c, reason } of DROP) {
      const v = classifyBaseCandidate(c);
      assert.strictEqual(v.keep, false, `${label} must be dropped`);
      assert.strictEqual(v.reason, reason, `${label} dropped for the right reason`);
    }
  });

  run('#2125 real Colorado municipal homepages are kept', () => {
    assert(KEEP.length > 0, 'non-vacuous');
    for (const { label, c } of KEEP) {
      const v = classifyBaseCandidate(c);
      assert.strictEqual(v.keep, true, `${label} must be kept (got ${v.reason})`);
    }
  });

  run('#2125 junk hosts match on subdomains, municipal hosts do not', () => {
    assert.strictEqual(isNonMunicipalHost('https://geo.org/tours/'), true);
    assert.strictEqual(isNonMunicipalHost('https://www.geo.org/tours/'), true);
    assert.strictEqual(isNonMunicipalHost('https://cityoflasanimasco.gov/'), false);
    assert.strictEqual(isNonMunicipalHost('https://fountain.colorado.gov/'), false);
    assert.strictEqual(looksLikeColorado('<p>co-op, Co. Road 12</p>', 'Town of Evans'), false,
      '"CO" counts only in an address context');
  });

  // A host can answer HEAD and GET differently. Stub fetch so HEAD stays on a
  // municipal-looking host while the metadata GET is redirected; the
  // candidate must be judged (and listed) by where the GET landed.
  const { discoverForPlace } = await import('../scripts/discover-local-resources.mjs');
  const realFetch = global.fetch;
  async function discoverWith(getLandsOn, body) {
    global.fetch = async (url, opts) => {
      const u = String(url);
      const isBase = /^https?:\/\/[^/]+\/?$/.test(u);
      if (!isBase) return { ok: false, status: 404, url: u, text: async () => '' };
      if (opts.method === 'HEAD') return { ok: true, status: 200, url: u, text: async () => '' };
      return { ok: true, status: 200, url: getLandsOn(u), text: async () => body };
    };
    try { return await discoverForPlace({ geoid: '0899999', name: 'Testville' }); }
    finally { global.fetch = realFetch; }
  }
  const coBody = '<title>Town of Testville</title><p>Testville, Colorado 81000</p>';
  try {
    const junk = await discoverWith(() => 'https://geo.org/tours/?keywords1=colorado', coBody);
    run('#2175 a GET redirect to a junk host drops the base though HEAD looked municipal', () => {
      assert.deepStrictEqual(junk.candidateUrls.map((c) => c.url), []);
    });
    const moved = await discoverWith(() => 'https://www.testvilleco.gov/', coBody);
    run('#2175 a kept base is listed at the URL the GET landed on', () => {
      assert.strictEqual(moved.candidateUrls[0] && moved.candidateUrls[0].url, 'https://www.testvilleco.gov/');
    });
  } catch (err) {
    console.error('  ✗ #2175 stubbed discovery threw\n    ' + err.message);
    process.exitCode = 1;
  }

  run('#2125 discoverForPlace applies the filter and has no non-CO fallback', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/discover-local-resources.mjs'), 'utf8');
    const body = src.slice(src.indexOf('async function discoverForPlace'), src.indexOf('/* ── Main'));
    assert(/classifyBaseCandidate\(/.test(body), 'discoverForPlace must call classifyBaseCandidate');
    assert(/if \(!verdict\.keep\) continue;/.test(body), 'a failing base must be skipped, not kept');
    assert(!/looksLikeColorado:\s*false/.test(body), 'no candidate may be emitted as looksLikeColorado:false');
  });
})();
