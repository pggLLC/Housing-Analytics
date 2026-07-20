# `scripts/sync-docs.mjs`

sync-docs.mjs — Unified audit, quarantine-candidate report, and doc updater
- Generates docs/GENERATED-INVENTORY.md
- Reports unreferenced js/css/scripts files to data/audit/quarantine-candidates.json
  (REPORT ONLY — files are never moved or deleted; a human decides.
  The old behavior moved them into gitignored _audit/, which on an
  ephemeral CI runner is silent permanent deletion: it destroyed
  scripts/hna/build_place_projections.py minutes after PR #1040 merged,
  because nothing referenced that filename yet. See PR #1044.)
- Rewrites _audit/ to _audit/ everywhere
- Updates "Actionable Recommendations" in key doc files

Also refreshes the auto-sync banner in every deprecated/superseded doc so
they always show the current date and live repo stats rather than going stale.
Banner blocks are delimited by HTML comments:
  <!-- sync-banner:start --> … <!-- sync-banner:end -->

Usage: node scripts/sync-docs.mjs
npm script: "docs:sync"

## Symbols

### `DEPRECATED_DOCS`

/*`, { cwd: ROOT, absolute: false, nodir: true });
    files.sort();
    for (const f of files) {
      const size = fmtSize(statSync(join(ROOT, f)).size);
      rows.push(`| \`${f}\` | ${size} |`);
      total++;
    }
  }
  const markdown = [
    '## Test Files',
    '',
    `${total} test files found.`,
    '',
    '| File | Size |',
    '|------|------|',
    ...rows,
  ].join('\n');
  return { markdown, count: total };
}

async function scanWorkflows() {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) {
    return { markdown: '## GitHub Actions Workflows\n\n_No `.github/workflows/` directory found._', count: 0 };
  }
  const files = await glob('.github/workflows/*.yml', { cwd: ROOT, absolute: false });
  files.sort();
  const rows = files.map(f => {
    const size = fmtSize(statSync(join(ROOT, f)).size);
    return `| \`${f}\` | ${size} |`;
  });
  const markdown = [
    '## GitHub Actions Workflows',
    '',
    `${files.length} workflow files found.`,
    '',
    '| File | Size |',
    '|------|------|',
    ...rows,
  ].join('\n');
  return { markdown, count: files.length };
}

function gitignoreSection() {
  const { exists, missing } = checkGitignore();
  if (!exists) {
    return '## .gitignore Completeness\n\n⚠️ `.gitignore` not found.';
  }
  if (missing.length === 0) {
    return '## .gitignore Completeness\n\n✅ All required entries present.';
  }
  return [
    '## .gitignore Completeness',
    '',
    '⚠️ Missing recommended entries:',
    '',
    ...missing.map(m => `- \`${m}\``),
  ].join('\n');
}

// 2. ==== Quarantine, reference updates, actionable recommendations ====

// Utility—find all files with specific extensions recursively in a dir
function findFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  let res = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) res = res.concat(findFiles(p, exts));
    else if (exts.some(e => item.name.endsWith(e))) res.push(p);
  }
  return res;
}

// Detect dead/unreferenced files — REPORT ONLY, never move or delete.
// The pre-#1044 version renameSync'd hits into _audit/, but _audit/ is
// gitignored, so on the ephemeral CI runner "archiving" was actually
// permanent deletion with no reviewable trace. A file can also be
// legitimately unreferenced-by-name for a short window (e.g. a generator
// merged before the workflow that calls it), which is exactly when
// auto-deletion does the most damage.
// Read a file for reference-scanning. Markdown gets its auto-generated
// "## Actionable Recommendations" block stripped first — that block LISTS
// the quarantine candidates, so counting it as a reference would clear
// every candidate on the run after it was first reported (report → doc
// mention → "referenced" → dropped → re-reported, oscillating each merge).
function readForRefScan(path) {
  const content = readFileSync(path, 'utf8');
  if (!path.endsWith('.md')) return content;
  return content.replace(/## Actionable Recommendations[\s\S]*?(?=\n## |$)/g, '');
}

function findDeadFiles(dir, exts, docRefDirs) {
  const files = findFiles(dir, exts);
  const candidates = [];
  // npm scripts are a legal way to reference a script file; the directory
  // scan below never reads package.json, so check it explicitly.
  const pkgPath = join(ROOT, 'package.json');
  const pkgJson = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '';
  for (const f of files) {
    if (f.includes('_audit')) continue;
    // Check if the file is referenced in HTML, JS, CSS, MD, YML, MJS,
    // Python files, or package.json scripts:
    const basename_ = basename(f);
    let referenced = pkgJson.includes(basename_);
    for (const d of docRefDirs) {
      if (referenced) break;
      if (!existsSync(d)) continue;
      for (const test of findFiles(d, ['.html', '.js', '.mjs', '.css', '.md', '.yml', '.yaml', '.py'])) {
        if (readForRefScan(test).includes(basename_)) {
          referenced = true;
          break;
        }
      }
    }
    if (!referenced) {
      candidates.push(relative(ROOT, f));
    }
  }
  return candidates;
}

// Persist the candidate list where the post-merge workflow can read it to
// open/refresh a tracking issue, and where the QA dashboard can display it.
const QUARANTINE_REPORT = join(ROOT, 'data', 'audit', 'quarantine-candidates.json');

function writeQuarantineReport(candidates) {
  mkdirSync(dirname(QUARANTINE_REPORT), { recursive: true });
  const payload = {
    generated_at: now,
    generator: 'scripts/sync-docs.mjs',
    policy: 'report-only — files are never moved or deleted automatically. '
      + 'To clear an entry: delete the file deliberately, or reference it '
      + 'from a workflow/doc/npm script if it is actually used.',
    heuristic: 'basename appears in no .html/.js/.mjs/.css/.md/.yml/.yaml/.py '
      + 'file under docs/, test(s)/, .github/, or the repo root, and not in '
      + 'package.json.',
    count: candidates.length,
    candidates,
  };
  writeFileSync(QUARANTINE_REPORT, JSON.stringify(payload, null, 2) + '\n');
}

// Update all _audit/ to _audit/
function rewriteReferences(rootDirs) {
  for (const dir of rootDirs) {
    if (!existsSync(dir)) continue;
    for (const f of findFiles(dir, ['.js', '.css', '.md', '.html', '.yml', '.yaml'])) {
      const content = readFileSync(f, 'utf8');
      if (content.includes('_audit')) {
        const updated = content.replace(/_audit/g, '_audit');
        writeFileSync(f, updated);
      }
    }
  }
}

// For docs: update actionable recommendations
function generateRecommendations(deadFileCandidates) {
  let recs = [];
  for (const f of deadFileCandidates) {
    recs.push(`Quarantine candidate: \`${f}\` — no file references its name. `
      + 'Delete it deliberately, or reference it (workflow/doc/npm script) if it is used.');
  }
  // Legacy: anything that survived in a committed _audit/ tree (the dir is
  // gitignored now, so this is normally empty).
  for (const d of [JS_DIR, CSS_DIR, SCRIPTS_DIR]) {
    const auditDir = join(AUDIT_DIR, d.replace(ROOT + '/', ''));
    if (existsSync(auditDir)) {
      for (const f of findFiles(auditDir, ['.js', '.css', '.py', '.mjs'])) {
        recs.push(`Archived file: \`${relative(ROOT, f)}\` — review and remove fully if unneeded.`);
      }
    }
  }
  recs.push('Docs and site-audit pipeline are automatically updated after every merge.');
  return recs;
}

function updateDocsWithRecs(docs, recs) {
  const blockHeader = '## Actionable Recommendations';
  const block = [blockHeader, '', ...recs.map(r => `- ${r}`), ''].join('\n');
  for (const d of docs) {
    if (!existsSync(d)) continue;
    let content = readFileSync(d, 'utf8');
    if (content.includes(blockHeader)) {
      content = content.replace(
        new RegExp(blockHeader + '[\\s\\S]*?(?:\n## |$)', 'g'),
        block + '\n## '
      );
    } else {
      content = content + '\n' + block + '\n';
    }
    writeFileSync(d, content);
  }
}

// ---------------------------------------------------------------------------
// Deprecated-doc banner refresh
// ---------------------------------------------------------------------------

const BANNER_START = '<!-- sync-banner:start -->';
const BANNER_END   = '<!-- sync-banner:end -->';

/**
Docs that carry a "superseded" notice.  Each entry describes the file,
which canonical doc to point to, and optional secondary references.

### `makeBanner(entry, stats)`

Build the blockquote banner text for a deprecated doc.
@param {{ canonical: string, reason: string, also?: string }} entry
@param {{ date: string, htmlCount: number, dataFileCount: number, workflowCount: number }} stats

### `syncDeprecatedBanners(stats)`

Read each deprecated doc, replace (or insert) the sync-banner block, and
write it back.  Returns the number of files updated.
