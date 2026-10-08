'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runUiValidationChecks } = require('./audit-modules/ui-validation');
const root = path.resolve(__dirname, '..');

(async () => {
    const stats = {};
    const issues = await runUiValidationChecks({ stats });
    assert.deepEqual(issues, [], 'the UI audit must have no findings, including high and medium');
    assert(stats.canvases >= 1, 'canvas check must scan real canvases');
    assert(stats.landmarkPages >= 50, 'landmark check must examine at least 50 root pages');
    assert(stats.navigationPages > 0, 'scan must encounter navigation injection');
    assert.equal(stats.parsedPages, stats.landmarkPages, 'each scanned page is parsed exactly once');
    assert.deepEqual(Object.keys(stats.excludedPages), ['og-card.html'], 'redirects must stay in the scan');
    for (const reason of Object.values(stats.excludedPages)) assert(reason.trim(), 'every excluded non-page has a reason');

    // Exercise the actual audit against a copy: the credit must come from the
    // navigation implementation it reads, not from a hard-coded exemption.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-navigation-'));
    try {
        for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
            fs.copyFileSync(path.join(root, file), path.join(copy, file));
        }
        fs.cpSync(path.join(root, 'css'), path.join(copy, 'css'), { recursive: true });
        fs.mkdirSync(path.join(copy, 'js'));
        const navigation = fs.readFileSync(path.join(root, 'js/navigation.js'), 'utf8');
        const withoutFooter = navigation.replace(/createElement\(\s*(['"])footer\1\s*\)/g, "createElement('div')");
        assert.notEqual(withoutFooter, navigation, 'footer-removal mutation must apply');
        fs.writeFileSync(path.join(copy, 'js/navigation.js'), withoutFooter);
        const copiedStats = {};
        const broken = await runUiValidationChecks({ root: copy, stats: copiedStats });
        assert.equal(copiedStats.navigation.createsFooter, false);
        assert(broken.some(issue => issue.file === 'about.html' && issue.actual.includes('<footer>')),
            'removing navigation footer creation must bring landmark findings back');
        assert.equal(copiedStats.landmarkPages, stats.landmarkPages, 'same complete page scan under sabotage');

        fs.writeFileSync(path.join(copy, 'js/navigation.js'), navigation);
        const aboutPath = path.join(copy, 'about.html');
        const about = fs.readFileSync(aboutPath, 'utf8');
        const withoutMain = about.replace(/<main\b[^>]*>/i, '<div>').replace(/<\/main>/i, '</div>');
        assert.notEqual(withoutMain, about, 'main-removal fixture must apply');
        fs.writeFileSync(aboutPath, withoutMain);
        const missingMain = await runUiValidationChecks({ root: copy });
        assert(missingMain.some(issue => issue.file === 'about.html' && issue.actual.includes('<main>')),
            'navigation must never provide credit for the page-owned main landmark');

        fs.writeFileSync(aboutPath, about);
        const redirectPath = path.join(copy, 'state-allocation-map.html');
        const redirect = fs.readFileSync(redirectPath, 'utf8');
        const redirectWithoutMain = redirect.replace(/<main\b[^>]*>/i, '').replace(/<\/main>/i, '');
        assert.notEqual(redirectWithoutMain, redirect, 'redirect main-removal mutation must apply');
        fs.writeFileSync(redirectPath, redirectWithoutMain);
        const redirectStats = {};
        const missingRedirectMain = await runUiValidationChecks({ root: copy, stats: redirectStats });
        assert(missingRedirectMain.some(issue => issue.file === 'state-allocation-map.html' && issue.actual.includes('<main>')),
            'redirect fallback content must have its own main landmark');
        assert.equal(redirectStats.landmarkPages, stats.landmarkPages, 'redirect sabotage keeps the complete scan');
    } finally {
        fs.rmSync(copy, { recursive: true, force: true });
    }
    console.log(`ui-audit-clean: PASS (${stats.canvases} canvases; ${stats.landmarkPages} root pages; ${stats.navigationPages} navigation consumers)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
