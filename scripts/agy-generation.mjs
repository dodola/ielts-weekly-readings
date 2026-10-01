import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';

export const AGY_MODEL = 'gemini-3.8-flash-high';
export function agyArgs(jobDir) {
  return ['--model', AGY_MODEL, '--effort', 'high', '--mode', 'plan', '--sandbox',
    '--disable-slash-commands', '--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '45m',
    '--log-file', path.join(jobDir, 'full-generation.agy.runtime.log')];
}
export async function agyDraft({ jobDir, prompt, command, binary = 'agy', safeEnv }) {
  await writeFile(path.join(jobDir, 'generation-prompt.txt'), prompt, { mode: 0o600 });
  const output = await command(binary, agyArgs(jobDir), { cwd: jobDir, env: safeEnv,
    input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
    timeout: 46 * 60000, log: path.join(jobDir, 'full-generation.agy.log') });
  const events = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const init = events.find(e => e.event === 'init')?.init;
  if (init?.model !== AGY_MODEL) throw new Error('Agy session model differs from the authorized model.');
  if (events.some(e => e.event === 'step_update' && !['user_input', 'agent_response'].includes(e.step_update?.step_type))) {
    throw new Error('Text-only generation invoked a tool or other action; not accepting its output.');
  }
  const result = events.findLast(e => e.event === 'result')?.result;
  if (result?.status !== 'SUCCESS' || typeof result.response !== 'string' || !result.response.trim()) throw new Error('Agy generation did not report SUCCESS with text; private draft retained.');
  const runtime = await readFile(path.join(jobDir, 'full-generation.agy.runtime.log'), 'utf8');
  if (!runtime.includes(`Resolving model ${AGY_MODEL}`)) throw new Error('Agy runtime did not confirm requested model resolution.');
  const receipt = { backend: 'agy', model: AGY_MODEL, reasoningEffort: 'high',
    modelEvidence: 'CLI argument, stream init model receipt and runtime resolver; no separate provider model field',
    effortEvidence: 'explicit CLI --effort high and high model ID',
    serviceHosts: [...new Set([...runtime.matchAll(/https:\/\/([A-Za-z0-9.-]+)\//g)].map(m => m[1]))],
    conversationId: result.conversation_id, status: result.status, durationSeconds: result.duration_seconds,
    turns: result.num_turns, usage: result.usage, transport: 'stdin-text-response', toolCalls: 0,
    permissionMode: init.permission_mode };
  try {
    const partial = await stat(path.join(jobDir, 'guide.codex-partial.md'));
    receipt.continuedDraft = { backend: 'codex', savedPartialBytes: partial.size,
      note: 'Agy continued a preserved earlier draft; this is not an all-Gemini cold generation.' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const markdown = result.response.trim().replace(/^```(?:markdown|md)\s*\n([\s\S]*)\n```$/, '$1') + '\n';
  await writeFile(path.join(jobDir, 'guide.md'), markdown, { mode: 0o600 });
  await writeFile(path.join(jobDir, 'generation-provenance.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return receipt;
}
