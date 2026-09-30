import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('workflow stops on dirty/untrusted source and never executes or publishes offline', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ielts-weekly-test-'));
  const repo = path.join(temporary, 'output'), source = path.join(temporary, 'source'), project = path.join(temporary, 'project');
  const original = fileURLToPath(new URL('../', import.meta.url));
  const run = (bin, args, cwd = repo) => {
    const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 30000 });
    if (r.error) throw r.error;
    return r;
  };
  try {
    await mkdir(path.join(repo, 'scripts'), { recursive: true });
    await mkdir(path.join(project, 'bin'), { recursive: true });
    await mkdir(source);
    for (const f of ['weekly.mjs', 'notes.mjs', 'full-reading.mjs', 'concurrency.mjs']) await copyFile(path.join(original, 'scripts', f), path.join(repo, 'scripts', f));
    // This mock cannot make an API call: it only returns an empty issue catalog.
    await writeFile(path.join(project, 'bin/ielts-curator.mjs'), 'process.stdout.write(JSON.stringify({issues:[]}));');
    const git = (...args) => {
      const r = run('git', args, source);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git('init', '-b', 'master');
    await writeFile(path.join(source, 'README.md'), 'original test source');
    git('add', 'README.md');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    git('remote', 'add', 'origin', 'https://github.com/hehonghui/awesome-english-ebooks.git');
    git('update-ref', 'refs/remotes/origin/master', git('rev-parse', 'HEAD'));
    git('config', 'branch.master.remote', 'origin');
    git('config', 'branch.master.merge', 'refs/heads/master');
    const args = ['scripts/weekly.mjs', '--project', project, '--source', source, '--offline', '--date', '2026-10-01'];
    let r = run(process.execPath, args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 issues, 0 candidates/);
    const report = JSON.parse(await readFile(path.join(repo, '.private/runs/2026-09-25_2026-10-01/report.json')));
    assert.equal(report.limits.maxGuides, 10);
    assert.equal(report.limits.typeSafeBudget, 'unlimited-by-user-instruction');
    assert.equal(report.refresh.refreshed, false);
    assert.equal(report.status, 'no-new-issues');
    r = run(process.execPath, [...args, '--execute', '--publish']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /restricted to dry-runs/);
    await writeFile(path.join(source, 'local-work.txt'), 'must remain intact');
    r = run(process.execPath, args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /local changes/);
    assert.equal(await readFile(path.join(source, 'local-work.txt'), 'utf8'), 'must remain intact');
    await rm(path.join(source, 'local-work.txt'));
    git('remote', 'set-url', 'origin', 'https://github.com/example/other.git');
    r = run(process.execPath, args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /origin differs/);
    r = run(process.execPath, [...args, '--from', '2026-09-01', '--to', '2026-10-15']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /1–31 days/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
