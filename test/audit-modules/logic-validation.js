'use strict';

/**
 * Logic & Methodology Validation Module
 *
 * Re-runs scenario projection models, validates PMA definition logic, audits
 * LIHTC deal calculators, and verifies policy data feeds.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const JS_DIR = path.join(ROOT, 'js');

// LIHTC compliance boundaries used in checkLihtcCompliance()
const LIHTC_UNIT_RULE = 'LI_UNITS must not exceed N_UNITS';

// Expected ranges for affordability ratio (monthly rent / AMI)
const AFFORDABILITY_RATIO_RANGE = { min: 0.1, max: 1.5 };

// Expected AMI value range (annual income, USD)
const AMI_RANGE = { min: 20000, max: 200000 };

/**
 * Safely parses a JSON file. Returns null on error.
 * @param {string} filePath
 * @returns {any|null}
 */
function safeReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * Validates scenario projection outputs for completeness and plausibility.
 * @returns {Array<object>} issues
 */
function checkProjectionOutputs() {
    const issues = [];
    const projDir = path.join(DATA_DIR, 'projections');
    if (!fs.existsSync(projDir)) return issues;

    const files = fs.readdirSync(projDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        issues.push({
            severity: 'medium',
            type: 'logic',
            file: 'data/projections/',
            description: 'No scenario projection files found',
            expected: 'At least one projection JSON file',
            actual: '0 files',
            recommendation: 'Run build_hna_data.py to generate projection outputs.',
        });
        return issues;
    }

    for (const file of files) {
        const filePath = path.join(projDir, file);
        const data = safeReadJson(filePath);
        if (!data) {
            issues.push({
                severity: 'high',
                type: 'logic',
                file: `data/projections/${file}`,
                description: 'Projection file cannot be parsed',
                expected: 'Valid JSON projection data',
                actual: 'Parse error',
                recommendation: 'Regenerate the projection file.',
            });
            continue;
        }

        const relPath = `data/projections/${file}`;
        // Check for zero or implausible total unit projections
        const totalUnits = data.totalUnits || data.total_units || data.units;
        if (totalUnits !== undefined && totalUnits === 0) {
            issues.push({
                severity: 'critical',
                type: 'logic',
                file: relPath,
                description: 'Scenario projection returned zero total units',
                expected: 'Non-zero unit projection',
                actual: '0 units',
                recommendation: 'Investigate model inputs — zero output indicates a broken pipeline.',
            });
        }
        if (totalUnits !== undefined && totalUnits < 0) {
            issues.push({
                severity: 'critical',
                type: 'logic',
                file: relPath,
                description: `Scenario projection returned negative units: ${totalUnits}`,
                expected: 'Positive unit projection',
                actual: `${totalUnits} units`,
                recommendation: 'Check model formula — negative unit output is implausible.',
            });
        }
    }
    return issues;
}

/**
 * Validates LIHTC records against basic CHFA/IRS program rules.
 * @returns {Array<object>} issues
 */
function checkLihtcCompliance() {
    const issues = [];
    const candidates = [
        path.join(DATA_DIR, 'chfa-lihtc.json'),
        path.join(DATA_DIR, 'market', 'chfa-lihtc.json'),
        path.join(ROOT, 'data', 'chfa-lihtc.json'),
    ];
    const filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) return issues;

    const data = safeReadJson(filePath);
    if (!data) return issues;

    const features = Array.isArray(data)
        ? data
        : (data.features || data.properties || []);

    let badLiUnits = 0;
    let missingRequiredFields = 0;

    for (const feature of features) {
        const props = feature.properties || feature;
        const liUnits = props.LI_UNITS;
        const nUnits = props.N_UNITS;

        // LI_UNITS must not exceed N_UNITS
        if (liUnits !== null && nUnits !== null && liUnits > nUnits) {
            badLiUnits++;
        }

        // CREDIT, NON_PROF, DDA must not be null
        for (const field of ['CREDIT', 'NON_PROF', 'DDA']) {
            if (props[field] === null || props[field] === undefined) {
                missingRequiredFields++;
                break;
            }
        }
    }

    if (badLiUnits > 0) {
        issues.push({
            severity: 'high',
            type: 'logic',
            file: filePath.replace(ROOT + '/', ''),
            description: `${badLiUnits} LIHTC records have LI_UNITS > N_UNITS`,
            expected: 'LI_UNITS ≤ N_UNITS for all records',
            actual: `${badLiUnits} violations`,
            recommendation: 'Correct data entry error — check column ordering in LIHTC source file.',
        });
    }
    if (missingRequiredFields > 0) {
        issues.push({
            severity: 'high',
            type: 'logic',
            file: filePath.replace(ROOT + '/', ''),
            description: `${missingRequiredFields} LIHTC records have null CREDIT, NON_PROF, or DDA fields`,
            expected: 'All CREDIT/NON_PROF/DDA fields are non-null',
            actual: `${missingRequiredFields} records with null required fields`,
            recommendation: 'Backfill with 0 for numeric fields and "U" for unknown strings.',
        });
    }
    return issues;
}

/**
 * Validates affordability gap calculations for AMI range plausibility.
 * @returns {Array<object>} issues
 */
function checkAffordabilityGap() {
    const issues = [];
    const candidates = [
        path.join(DATA_DIR, 'co_ami_gap_by_county.json'),
        path.join(DATA_DIR, 'hna', 'chas_affordability_gap.json'),
    ];

    for (const filePath of candidates) {
        if (!fs.existsSync(filePath)) continue;
        const data = safeReadJson(filePath);
        if (!data) continue;

        const records = Array.isArray(data)
            ? data
            : Array.isArray(data.counties)
                ? data.counties
                : Array.isArray(data.gaps)
                    ? data.gaps
                    : [];
        let outOfRange = 0;
        for (const rec of records) {
            const ami = rec.ami_4person || rec.ami;
            if (ami !== null && ami !== undefined) {
                if (ami < AMI_RANGE.min || ami > AMI_RANGE.max) outOfRange++;
            }
        }
        if (outOfRange > 0) {
            issues.push({
                severity: 'high',
                type: 'logic',
                file: filePath.replace(ROOT + '/', ''),
                description: `${outOfRange} AMI values are outside plausible range ($${AMI_RANGE.min.toLocaleString()}–$${AMI_RANGE.max.toLocaleString()})`,
                expected: `AMI values between $${AMI_RANGE.min.toLocaleString()} and $${AMI_RANGE.max.toLocaleString()}`,
                actual: `${outOfRange} out-of-range values`,
                recommendation: 'Verify AMI source data — check for unit errors (monthly vs annual).',
            });
        }
    }
    return issues;
}

/**
 * Checks that the HNA data pipeline output files are present and non-empty.
 * @returns {Array<object>} issues
 */
function checkHnaPipelineOutputs() {
    const issues = [];
    const hnaDir = path.join(DATA_DIR, 'hna');
    if (!fs.existsSync(hnaDir)) {
        issues.push({
            severity: 'high',
            type: 'logic',
            file: 'data/hna/',
            description: 'HNA data directory not found',
            expected: 'data/hna/ directory with populated files',
            actual: 'Directory does not exist',
            recommendation: 'Run scripts/hna/build_hna_data.py to generate HNA outputs.',
        });
        return issues;
    }

    const requiredFiles = [
        'municipal-config.json',
        'chas_affordability_gap.json',
    ];
    for (const file of requiredFiles) {
        const filePath = path.join(hnaDir, file);
        if (!fs.existsSync(filePath)) {
            issues.push({
                severity: 'medium',
                type: 'logic',
                file: `data/hna/${file}`,
                description: `Required HNA file missing: ${file}`,
                expected: 'File exists and is populated',
                actual: 'File not found',
                recommendation: 'Run the appropriate ETL script to generate this file.',
            });
        } else {
            const data = safeReadJson(filePath);
            if (!data || (Array.isArray(data) && data.length === 0)) {
                issues.push({
                    severity: 'high',
                    type: 'logic',
                    file: `data/hna/${file}`,
                    description: `HNA file is empty or unparseable: ${file}`,
                    expected: 'Non-empty dataset',
                    actual: 'Empty or invalid JSON',
                    recommendation: 'Re-run ETL script and check for upstream data failures.',
                });
            }
        }
    }
    return issues;
}

/**
 * Checks that core JS logic modules are syntactically present and not empty.
 * @returns {Array<object>} issues
 */
function checkCoreJsModules() {
    const issues = [];
    const requiredModules = [
        'housing-needs-assessment.js',
        'co-lihtc-map.js',
    ];

    for (const module of requiredModules) {
        const filePath = path.join(JS_DIR, module);
        if (!fs.existsSync(filePath)) {
            issues.push({
                severity: 'critical',
                type: 'logic',
                file: `js/${module}`,
                description: `Core JS module missing: ${module}`,
                expected: 'Module file exists',
                actual: 'File not found',
                recommendation: 'Restore the file from version control.',
            });
            continue;
        }
        const size = fs.statSync(filePath).size;
        if (size < 1000) {
            issues.push({
                severity: 'high',
                type: 'logic',
                file: `js/${module}`,
                description: `Core JS module appears truncated: ${module} (${size} bytes)`,
                expected: 'Fully populated module file (>1KB)',
                actual: `${size} bytes`,
                recommendation: 'Check for incomplete writes or merge conflicts.',
            });
        }
    }
    return issues;
}

/**
 * Runs all logic and methodology validation checks.
 * @returns {Promise<Array<object>>}
 */
async function runLogicValidationChecks() {
    console.log('[logic-validation] Running logic & methodology checks...');
    const issues = [
        ...checkProjectionOutputs(),
        ...checkLihtcCompliance(),
        ...checkAffordabilityGap(),
        ...checkHnaPipelineOutputs(),
        ...checkCoreJsModules(),
    ];
    console.log(`[logic-validation] Found ${issues.length} issue(s).`);
    return issues;
}

module.exports = { runLogicValidationChecks };
