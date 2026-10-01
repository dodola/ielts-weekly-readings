import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';

export const AGY_MODEL = 'gemini-3.8-flash-high';
export function agyArgs(jobDir) {
  return ['--model', AGY_MODEL, '--effort', 'high', '--mode', 'accept-edits', '--sandbox',
    '--disable-slash-commands', '--output-format', 'json', '--print-timeout', '45m',
    '--log-file', path.join(jobDir, 'full-generation.agy.runtime.log'),
    '--print=Read generation-prompt.txt in the current directory and carry out its complete instructions. It contains the full authorized local-input IELTS task and references. Write guide.md here; do not publish.'];
}
export async function agyDraft({ jobDir, prompt, command, binary = 'agy', safeEnv }) {
  await writeFile(path.join(jobDir, 'generation-prompt.txt'), prompt, { mode: 0o600 });
  const result = JSON.parse(await command(binary, agyArgs(jobDir), { cwd: jobDir, env: safeEnv,
    timeout: 46 * 60000, log: path.join(jobDir, 'full-generation.agy.log') }));
  if (result.status !== 'SUCCESS') throw new Error('Agy generation did not report SUCCESS; private draft retained.');
  const runtime = await readFile(path.join(jobDir, 'full-generation.agy.runtime.log'), 'utf8');
  if (!runtime.includes(`Resolving model ${AGY_MODEL}`)) throw new Error('Agy runtime did not confirm requested model resolution.');
  const receipt = { backend: 'agy', model: AGY_MODEL, reasoningEffort: 'high',
    modelEvidence: 'CLI argument and runtime resolver; response has no separate provider model field',
    effortEvidence: 'explicit CLI --effort high and high model ID',
    serviceHosts: [...new Set([...runtime.matchAll(/https:\/\/([A-Za-z0-9.-]+)\//g)].map(m => m[1]))],
    conversationId: result.conversation_id, status: result.status, durationSeconds: result.duration_seconds,
    turns: result.num_turns, usage: result.usage };
  try {
    const partial = await stat(path.join(jobDir, 'guide.codex-partial.md'));
    receipt.continuedDraft = { backend: 'codex', savedPartialBytes: partial.size,
      note: 'Agy continued a preserved earlier draft; this is not an all-Gemini cold generation.' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(path.join(jobDir, 'generation-provenance.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return receipt;
}
