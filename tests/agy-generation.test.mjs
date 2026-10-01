import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agyArgs, agyDraft, AGY_MODEL } from '../scripts/agy-generation.mjs';

test('agy generation pins the requested model and high effort without exposing source in argv or widening permissions', async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'agy-fixture-'));
  try {
    const prompt = 'Private synthetic input and complete reference fixture';
    const args = agyArgs(jobDir);
    assert.equal(args[args.indexOf('--model') + 1], AGY_MODEL);
    assert.equal(args[args.indexOf('--effort') + 1], 'high');
    assert.ok(args.includes('--sandbox'));
    assert.ok(!args.some(a => a.includes('skip-permissions') || a.includes(prompt)));
    const command = async (_binary, actual, options) => {
      assert.deepEqual(actual, args);
      assert.equal(options.cwd, jobDir);
      assert.equal(await readFile(path.join(jobDir, 'generation-prompt.txt'), 'utf8'), prompt);
      await writeFile(path.join(jobDir, 'full-generation.agy.runtime.log'), `Resolving model ${AGY_MODEL}\nURL: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`);
      return JSON.stringify({ status: 'SUCCESS', conversation_id: 'fixture', duration_seconds: 2, num_turns: 1, usage: { total_tokens: 10 } });
    };
    const receipt = await agyDraft({ jobDir, prompt, command, safeEnv: {} });
    assert.equal(receipt.model, AGY_MODEL);
    assert.match(receipt.modelEvidence, /no separate provider model field/);
    assert.deepEqual(receipt.serviceHosts, ['daily-cloudcode-pa.googleapis.com']);
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => '{"status":"ERROR"}' }), /did not report SUCCESS/);
    await writeFile(path.join(jobDir, 'full-generation.agy.runtime.log'), 'unknown model');
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => '{"status":"SUCCESS"}' }), /did not confirm/);
  } finally { await rm(jobDir, { recursive: true, force: true }); }
});
