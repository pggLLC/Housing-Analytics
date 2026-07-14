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
})();
