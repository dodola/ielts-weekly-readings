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
      assert.equal(JSON.parse(options.input).message.content, prompt);
      assert.equal(await readFile(path.join(jobDir, 'generation-prompt.txt'), 'utf8'), prompt);
      await writeFile(path.join(jobDir, 'full-generation.agy.runtime.log'), `Resolving model ${AGY_MODEL}\nURL: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`);
      return [JSON.stringify({ event: 'init', init: { model: AGY_MODEL, permission_mode: 'request-review' } }),
        JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '# complete synthetic guide', conversation_id: 'fixture', duration_seconds: 2, num_turns: 1, usage: { total_tokens: 10 } } })].join('\n');
    };
    const receipt = await agyDraft({ jobDir, prompt, command, safeEnv: {} });
    assert.equal(receipt.model, AGY_MODEL);
    assert.match(receipt.modelEvidence, /no separate provider model field/);
    assert.deepEqual(receipt.serviceHosts, ['daily-cloudcode-pa.googleapis.com']);
    assert.equal(receipt.toolCalls, 0);
    assert.equal(await readFile(path.join(jobDir, 'guide.md'), 'utf8'), '# complete synthetic guide\n');
    const reply = result => [JSON.stringify({ event: 'init', init: { model: AGY_MODEL } }), JSON.stringify({ event: 'result', result })].join('\n');
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => reply({ status: 'ERROR' }) }), /did not report SUCCESS/);
    await writeFile(path.join(jobDir, 'full-generation.agy.runtime.log'), 'unknown model');
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => reply({ status: 'SUCCESS', response: 'synthetic' }) }), /did not confirm/);
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => JSON.stringify({ event: 'init', init: { model: 'other-model' } }) }), /differs/);
    await assert.rejects(agyDraft({ jobDir, prompt, command: async () => `${reply({ status: 'SUCCESS', response: 'synthetic' })}\n${JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool_call' } })}` }), /invoked a tool/);
  } finally { await rm(jobDir, { recursive: true, force: true }); }
});
