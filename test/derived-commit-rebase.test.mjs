#!/usr/bin/env node
// Exercise real Git/rebase/push in disposable local remotes. Build commands
// are deterministic stubs here; the PR also records an actual CHFA chain run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'derived-rebase-'));
const helper = fs.readFileSync(path.join(root, 'scripts/commit-with-derived-chain.sh'), 'utf8');
const outputs = [...helper.match(/^PATHS=\(([\s\S]*?)^\)/m)[1].matchAll(/^\s+([A-Za-z][A-Za-z0-9_./-]+)\s*$/gm)].map(m => m[1]);
const dirs = new Set(['data/hna/ranking-scenarios', 'data/hna/jurisdiction-metrics-digest', 'data/jurisdiction-briefs', 'places', 'data/paper']);
function run(cmd, args, cwd, env = process.env, success = true) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (success) assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r;
}
const git = (cwd, ...args) => run('git', args, cwd).stdout.trim();
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
try {
  for (const [label, branch, conflict] of [['manifests', 'main', false], ['derived-conflict', 'main', false], ['selected-ref', 'verify-data', false], ['source-conflict', 'main', true], ['keeps-moving', 'main', false]]) {
    const dir = path.join(temp, label); fs.mkdirSync(dir);
    const origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work'), peer = path.join(dir, 'peer'), bin = path.join(dir, 'bin');
    fs.mkdirSync(work); fs.mkdirSync(bin);
    git(dir, 'init', '--bare', origin);
    git(work, 'init', '-b', branch); git(work, 'config', 'user.name', 'Test'); git(work, 'config', 'user.email', 'test@example.invalid');
    write(path.join(work, 'scripts/commit-with-derived-chain.sh'), helper);
    for (const output of outputs) write(path.join(work, output, ...(dirs.has(output) ? ['fixture.json'] : [])), 'baseline\n');
    write(path.join(work, 'data/source.json'), '{"value":"before"}\n');
    write(path.join(work, 'data/remote.json'), '{"revision":0}\n');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'baseline'); git(work, 'remote', 'add', 'origin', origin); git(work, 'push', '-u', 'origin', branch);
    git(dir, 'clone', '--branch', branch, origin, peer); git(peer, 'config', 'user.name', 'Test'); git(peer, 'config', 'user.email', 'test@example.invalid');
    for (const name of ['data/_manifest.json', 'data/manifest.json']) write(path.join(peer, name), 'concurrent manifest\n');
    write(path.join(peer, 'data/remote.json'), '{"revision":1}\n');
    if (label === 'derived-conflict') write(path.join(peer, 'data/hna/ranking-index.json'), 'concurrent derived output\n');
    if (conflict) write(path.join(peer, 'data/source.json'), '{"value":"remote"}\n');
    git(peer, 'add', '.'); git(peer, 'commit', '-m', 'concurrent source and manifest update'); git(peer, 'push');
    const remoteBefore = git(peer, 'rev-parse', 'HEAD');
    write(path.join(work, 'data/source.json'), '{"value":"local"}\n');
    const counter = path.join(dir, 'build-count');
    const generator = `#!${process.execPath}\nconst fs=require('fs'),path=require('path'),cp=require('child_process');\n` +
      `if(process.argv.includes('rebuild:derived')){const counter=${JSON.stringify(counter)};const n=Number(fs.existsSync(counter)?fs.readFileSync(counter,'utf8'):0)+1;fs.writeFileSync(counter,String(n));` +
      `if(${JSON.stringify(label)}==='keeps-moving' && n===2){const peer=${JSON.stringify(peer)};fs.writeFileSync(path.join(peer,'data/hna/ranking-index.json'),'newer remote derived output');for(const args of [['add','.'],['commit','-m','another concurrent update'],['push']])cp.execFileSync('git',args,{cwd:peer,stdio:'pipe'});}}\n` +
      `const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v)};\n` +
      `const data=fs.readFileSync('data/source.json','utf8')+fs.readFileSync('data/remote.json','utf8');\n` +
      `if(process.argv.includes('rebuild:derived')) for(const p of ${JSON.stringify(outputs.map(p => dirs.has(p) ? p + '/fixture.json' : p))})write(p,'derived:'+data);\n` +
      `if(process.argv.includes('audit:file-manifest'))write('data/_manifest.json','manifest:'+data);\n` +
      `if(process.argv.includes('scripts/rebuild_manifest.py'))write('data/manifest.json','bytes:'+fs.readFileSync('data/_manifest.json','utf8'));\n`;
    for (const name of ['npm', 'python3']) { write(path.join(bin, name), generator); fs.chmodSync(path.join(bin, name), 0o755); }
    write(path.join(bin, 'node'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(bin, 'node'), 0o755);
    const result = run('bash', ['scripts/commit-with-derived-chain.sh', 'Refresh source and derived data', '--', 'data/source.json'], work,
      { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DERIVED_COMMIT_BRANCH: branch, GITHUB_OUTPUT: path.join(dir, 'output') }, false);
    const remoteAfter = git(dir, '--git-dir=' + origin, 'rev-parse', 'refs/heads/' + branch);
    const builds = Number(fs.readFileSync(counter, 'utf8'));
    if (conflict || label === 'keeps-moving') {
      assert.notEqual(result.status, 0, 'an input conflict or second rebase conflict must fail');
      assert.equal(remoteAfter, git(peer, 'rev-parse', 'HEAD'), 'a conflict must never push the local refresh');
      assert.equal(builds, conflict ? 1 : 2, 'at most one rebuild retry');
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(builds, 2, 'initial chain plus exactly one retry from the new tip');
      assert.equal(git(work, 'rev-parse', 'HEAD^'), remoteBefore, 'one input+derived commit follows the remote head');
      assert.equal(remoteAfter, git(work, 'rev-parse', 'HEAD'));
      const files = git(work, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n');
      for (const required of ['data/source.json', 'data/hna/ranking-index.json', 'data/_manifest.json', 'data/manifest.json']) assert(files.includes(required), required);
      assert(fs.readFileSync(path.join(work, 'data/hna/ranking-index.json'), 'utf8').includes('"revision":1'), 'the ranking index is rebuilt from the new tip, not retained from the failed commit');
      assert(fs.readFileSync(path.join(work, 'data/_manifest.json'), 'utf8').includes('"revision":1'), 'manifest regenerated from rebased tree');
      assert.equal(fs.readFileSync(path.join(work, 'data/manifest.json'), 'utf8'), 'bytes:' + fs.readFileSync(path.join(work, 'data/_manifest.json'), 'utf8'));
    }
    console.log(`derived commit: ${label} PASS (real Git; deterministic build fixture)`);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
