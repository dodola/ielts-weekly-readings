import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';

export const AGY_MODEL = 'gemini-3.8-flash-high';
export function parseAgyOutput(output) {
  let events;
  try { events = output.split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw new Error('Agy returned invalid NDJSON; inspect private logs.'); }
  const init = events.find(e => e.event === 'init')?.init;
  if (init?.model !== AGY_MODEL) throw new Error('Agy session model differs from the authorized model.');
  const result = events.findLast(e => e.event === 'result')?.result;
  if (result?.status !== 'SUCCESS') {
    if (/output token limit|response was cut off/i.test(result?.error ?? '')) {
      throw new Error('Agy exceeded its output token limit; incomplete response retained in private logs, not published.');
    }
    throw new Error('Agy generation did not report SUCCESS; inspect private logs, draft retained.');
  }
  // Provider errors and resume system messages are passive events, not tools.
  // Unknown action types remain fail-closed.
  if (events.some(e => e.event === 'step_update' && !['user_input', 'agent_response', 'error_message', 'system_message'].includes(e.step_update?.step_type))) {
    throw new Error('Text-only generation invoked a tool or other action; not accepting its output.');
  }
  if (typeof result.response !== 'string' || !result.response.trim()) throw new Error('Agy returned empty text; private draft retained.');
  return { init, result };
}
export function agyArgs(jobDir, { name = 'full-generation', conversation } = {}) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Unsafe generation part name.');
  if (conversation && !/^[a-zA-Z0-9-]+$/.test(conversation)) throw new Error('Unsafe conversation identifier.');
  const args = ['--model', AGY_MODEL, '--effort', 'high', '--mode', 'plan', '--sandbox',
    '--disable-slash-commands', '--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '45m',
    '--log-file', path.join(jobDir, `${name}.agy.runtime.log`)];
  if (conversation) args.push('--conversation', conversation);
  return args;
}
export async function agyText({ jobDir, prompt, command, binary = 'agy', safeEnv, name = 'full-generation', conversation }) {
  const args = agyArgs(jobDir, { name, conversation });
  await writeFile(path.join(jobDir, name === 'full-generation' ? 'generation-prompt.txt' : `${name}-prompt.txt`), prompt, { mode: 0o600 });
  const output = await command(binary, args, { cwd: jobDir, env: safeEnv,
    input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
    timeout: 46 * 60000, log: path.join(jobDir, `${name}.agy.log`), progressLabel: name });
  const { init, result } = parseAgyOutput(output);
  if (conversation && result.conversation_id !== conversation) throw new Error('Agy resumed a different conversation; stopped.');
  const runtime = await readFile(path.join(jobDir, `${name}.agy.runtime.log`), 'utf8');
  if (!runtime.includes(`Resolving model ${AGY_MODEL}`)) throw new Error('Agy runtime did not confirm requested model resolution.');
  const receipt = { backend: 'agy', model: AGY_MODEL, reasoningEffort: 'high',
    modelEvidence: 'CLI argument, stream init model receipt and runtime resolver; no separate provider model field',
    effortEvidence: 'explicit CLI --effort high and high model ID',
    serviceHosts: [...new Set([...runtime.matchAll(/https:\/\/([A-Za-z0-9.-]+)\//g)].map(m => m[1]))],
    conversationId: result.conversation_id, status: result.status, durationSeconds: result.duration_seconds,
    turns: result.num_turns, usage: result.usage, transport: 'stdin-text-response', toolCalls: 0,
    permissionMode: init.permission_mode };
  const markdown = result.response.trim().replace(/^```(?:markdown|md|json)\s*\n([\s\S]*)\n```$/, '$1') + '\n';
  return { markdown, receipt };
}
export async function agyDraft(options) {
  const { jobDir } = options;
  const { markdown, receipt } = await agyText(options);
  try {
    const partial = await stat(path.join(jobDir, 'guide.codex-partial.md'));
    receipt.continuedDraft = { backend: 'codex', savedPartialBytes: partial.size,
      note: 'Agy continued a preserved earlier draft; this is not an all-Gemini cold generation.' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(path.join(jobDir, 'guide.md'), markdown, { mode: 0o600 });
  await writeFile(path.join(jobDir, 'generation-provenance.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return receipt;
}
