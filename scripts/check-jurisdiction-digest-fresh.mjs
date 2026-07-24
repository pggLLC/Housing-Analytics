#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const TARGETS = [
  'data/hna/jurisdiction-metrics-digest/',
  'data/hna/ownership-need.json',
];

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function git(...args) {
  return run('git', args);
}

function restoreWorkingTree() {
  git('checkout', '--', ...TARGETS);
  git('clean', '-fdq', '--', ...TARGETS);
}

function untrackedUnderTargets() {
  const out = git('status', '--porcelain', '--', ...TARGETS).stdout || '';
  return out
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function changedTrackedFiles() {
  const out = git('diff', '--name-only', '--', ...TARGETS).stdout || '';
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

let exitCode = 0;

try {
  const build = run('npm', ['run', 'build:jurisdiction-metrics-digest']);
  if (build.status !== 0) {
    const tail = (build.stderr || build.stdout || '').slice(-2000);
    console.error(`build:jurisdiction-metrics-digest failed:\n${tail}`);
    exitCode = 2;
  } else {
    const drift = git('diff', '--quiet', '--', ...TARGETS).status !== 0;
    const untracked = untrackedUnderTargets();

    if (drift || untracked.length > 0) {
      const changed = changedTrackedFiles();
      const stale = [...new Set([...changed, ...untracked])];
      console.error('digests are STALE — run npm run build:jurisdiction-metrics-digest and commit');
      if (stale.length > 0) {
        console.error('first few drifted files:');
        for (const file of stale.slice(0, 8)) {
          console.error(`  ${file}`);
        }
      }
      exitCode = 1;
    } else {
      console.log('jurisdiction metrics digests are fresh.');
      exitCode = 0;
    }
  }
} finally {
  restoreWorkingTree();
}

process.exit(exitCode);
