#!/usr/bin/env node
// Isolated cold generation: copies only source.json, never reads a cached guide
// into the new job and never contacts TypeSafe or publishes to either repository.
// User's current default omits independent model review and PDF sampling.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createFullGuide } from './full-reading.mjs';
import { digest } from './notes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'baseline-job': { type: 'string' }, name: { type: 'string' }, 'skill-root': { type: 'string' }, resume: { type: 'boolean' } } });
if (!values['baseline-job'] || !/^[a-z0-9][a-z0-9-]*$/.test(values.name ?? '')) throw new Error('--baseline-job PATH and unique --name SLUG required.');
const baseline = path.resolve(values['baseline-job']);
const jobDir = path.join(root, '.private/benchmarks', values.name);
await mkdir(path.dirname(jobDir), { recursive: true, mode: 0o700 });
if (values.resume) await stat(path.join(jobDir, 'full-generation.codex.log.timing.json'));
else await mkdir(jobDir, { mode: 0o700 }); // Existing experiments cannot be overwritten.
const source = JSON.parse(await readFile(path.join(baseline, 'source.json'), 'utf8'));
await writeFile(path.join(jobDir, 'source.json'), JSON.stringify(source), { mode: 0o600 });
const safeEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'CODEX_HOME', 'TMPDIR']
  .filter(k => process.env[k]).map(k => [k, process.env[k]]));
const stages = values.resume ? JSON.parse(await readFile(path.join(jobDir, 'stages.json'), 'utf8')) : [], active = new Set(); let calls = 0;
const stop = () => { for (const child of active) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(130); });
async function command(binary, args, { cwd = jobDir, env = safeEnv, input, timeout = 120000, log } = {}) {
  const startedAt = new Date();
  console.log(`Started ${path.basename(binary)}${log ? `: ${path.basename(log)}` : ''} at ${startedAt.toISOString()}`);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    active.add(child);
    const stream = log ? createWriteStream(log, { mode: 0o600 }) : null;
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; stream?.write(data); });
    child.stderr.on('data', data => { stderr += data; stream?.write(data); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000).unref(); }, timeout);
    child.on('error', reject);
    child.on('close', async code => {
      clearTimeout(timer); active.delete(child);
      if (stream) await new Promise(r => stream.end(r));
      const finishedAt = new Date(), record = { command: path.basename(binary), stage: log ? path.basename(log) : args[0],
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt - startedAt, exitCode: code };
      stages.push(record);
      await writeFile(path.join(jobDir, 'stages.json'), JSON.stringify(stages, null, 2));
      if (log) await writeFile(`${log}.timing.json`, JSON.stringify(record));
      console.log(`Finished ${record.stage}: ${record.durationMs}ms, exit ${code}`);
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${path.basename(binary)} failed; inspect the private experiment log.`));
    });
  });
  return output;
}
const codex = process.env.CODEX_BINARY || 'codex';
async function generate(dir, schema, output, prompt, images) {
  calls++;
  const schemaFile = path.join(dir, `${output}.schema.json`);
  await writeFile(schemaFile, JSON.stringify(schema));
  await command(codex, ['exec', '--model', 'gpt-6.1-sol', '--config', 'model_reasoning_effort="high"', '--ephemeral',
    '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', dir, '--output-schema', schemaFile,
    '--output-last-message', path.join(dir, output), ...images.flatMap(p => ['-i', p]), '-'],
  { input: prompt, timeout: 25 * 60000, log: path.join(dir, `${output}.codex.log`) });
  return JSON.parse(await readFile(path.join(dir, output), 'utf8'));
}
const files = ['source.json', 'guide.md', 'guide.docx', 'guide.pdf'];
async function snapshot() { return Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(baseline, file)))]))); }
const before = await snapshot(), startedAt = values.resume ? new Date(stages[0].startedAt) : new Date();
const result = await createFullGuide({ jobDir, article: source.article,
  skill: values['skill-root'] ?? path.join(os.homedir(), '.codex/skills/intensive-reading'), codex, safeEnv,
  command, generate, reserve: async () => { if (++calls > 6) throw new Error('Isolated experiment call guard reached.'); },
  maxCodex: 6, noDocuments: false });
async function metrics(dir, file) {
  const log = await readFile(path.join(dir, file), 'utf8');
  return { toolCalls: (log.match(/^(?:exec|apply_patch|file update)\s*$/gm) ?? []).length + (log.match(/^patch: completed\s*$/gm) ?? []).length,
    reportedTokensUsed: Number(log.match(/tokens used\s*\n([\d,]+)/)?.[1].replaceAll(',', '')) || null };
}
const summary = { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), durationMs: new Date() - startedAt,
  cold: true, screeningReused: true, published: false, model: 'gpt-6.1-sol', reasoningEffort: 'high', result, stages,
  generation: await metrics(jobDir, 'full-generation.codex.log'), independentReview: result.independentReview,
  baselineGeneration: await metrics(baseline, 'full-generation.codex.log'), baselineAudit: await metrics(baseline, 'full-audit.json.codex.log'),
  markdownBytes: (await stat(path.join(jobDir, 'guide.md'))).size, baselineMarkdownBytes: (await stat(path.join(baseline, 'guide.md'))).size,
  originalJobUnchanged: JSON.stringify(before) === JSON.stringify(await snapshot()),
  limits: 'Historical comparison at different times/load, one article, stochastic content; not a controlled speed estimate. Reported tokens lack input/output/reasoning breakdown.' };
await writeFile(path.join(jobDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
