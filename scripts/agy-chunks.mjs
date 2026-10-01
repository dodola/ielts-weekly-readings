import path from 'node:path';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { agyText, AGY_MODEL } from './agy-generation.mjs';
import { digest } from './notes.mjs';

export const CHUNK_POLICY = 'full-ielts-functional-parts-v1';
const MAX_RESPONSE_CHARACTERS = 30000, MAX_CALLS = 80;
const norm = s => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const id = n => `P${String(n + 1).padStart(3, '0')}`;
async function save(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}
async function exists(file) { try { return (await stat(file)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

export function validateBlockPlan(text, article) {
  let plan;
  try { plan = JSON.parse(text); } catch { throw new Error('Functional block plan is not valid JSON.'); }
  if (!Array.isArray(plan.blocks) || !plan.blocks.length || plan.blocks.length > 10) throw new Error('Functional plan needs 1–10 blocks.');
  const expected = article.paragraphs.map((_, i) => id(i));
  const ordered = plan.blocks.flatMap(b => b.paragraphIds ?? []);
  if (ordered.join(',') !== expected.join(',')) throw new Error('Functional plan must cover every source paragraph once in original order.');
  for (const block of plan.blocks) {
    if (typeof block.heading !== 'string' || !block.heading.trim() || /[\n<>]/.test(block.heading)) throw new Error('Invalid functional block heading.');
    if (!Array.isArray(block.expressions) || block.expressions.length < 5 || block.expressions.length > 8) throw new Error('Every functional block needs 5–8 real expressions.');
    const source = norm(block.paragraphIds.map(p => article.paragraphs[expected.indexOf(p)]).join(' ')).toLowerCase();
    const distinct = new Set();
    for (const e of block.expressions) {
      if (typeof e.en !== 'string' || !e.en.trim() || typeof e.gloss !== 'string' || !e.gloss.trim() || /[\n<>]/.test(e.en + e.gloss)) throw new Error('Invalid planned expression/gloss.');
      const en = norm(e.en).toLowerCase();
      if (!source.includes(en) || distinct.has(en)) throw new Error('Planned expressions must occur in their own source block and be distinct.');
      distinct.add(en);
    }
  }
  return plan;
}

export function sourceWindows(paragraphs) {
  const windows = []; let current = [], words = 0;
  for (const paragraph of paragraphs) {
    const count = paragraph.text.split(/\s+/).length;
    if (current.length && (current.length >= 3 || words + count > 400)) { windows.push(current); current = []; words = 0; }
    current.push(paragraph); words += count;
  }
  if (current.length) windows.push(current);
  return windows;
}

function sourceCheck(text, paragraphs) {
  const sections = new Map(); const ordered = []; let current;
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s*<!--\s*source:(P\d{3})\s*-->\s*$/);
    if (marker) { current = marker[1]; ordered.push(current); sections.set(current, { en: [], zh: 0 }); }
    const en = line.match(/^\*\*En:\*\*\s*(.+)$/);
    if (en) { if (!current) throw new Error('Source part lacks marker.'); sections.get(current).en.push(en[1]); }
    if (/^>\s*\*\*译:\*\*\s*\S/.test(line) && current) sections.get(current).zh += 1;
  }
  if (ordered.join(',') !== paragraphs.map(p => p.id).join(',')) throw new Error('Source part paragraph coverage/order mismatch.');
  for (const p of paragraphs) {
    const s = sections.get(p.id);
    if (norm(s.en.join(' ')) !== norm(p.text) || !s.en.length || s.zh < s.en.length) throw new Error('Source part English or aligned translation is incomplete.');
  }
}
function noSource(text) { if (/<!--\s*source:|^\*\*En:\*\*/m.test(text)) throw new Error('Teaching part must not duplicate the reserved source layer.'); }

export async function agyChunkedGuide({ jobDir, prompt, article, command, binary = 'agy', safeEnv, validateGuide, textCall = agyText }) {
  const startedAt = Date.now();
  const dir = path.join(jobDir, 'agy-chunks-v1', digest(prompt).slice(0, 16));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await save(path.join(jobDir, 'generation-prompt.txt'), prompt);
  const stateFile = path.join(dir, 'state.json');
  const state = await exists(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : { callsReserved: 0, parts: {}, conversationId: null };
  state.splits ??= {};
  const initialCalls = state.callsReserved; let cachedParts = 0;
  const receipts = new Map();
  async function part(name, instruction, check) {
    const fingerprint = digest(instruction), file = path.join(dir, `${name}.md`);
    const cached = state.parts[name];
    if (cached?.fingerprint === fingerprint && await exists(file)) {
      const markdown = await readFile(file, 'utf8');
      if (digest(markdown) === cached.hash) { check(markdown); cachedParts++; receipts.set(name, cached.receipt); return markdown; }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (state.callsReserved >= MAX_CALLS) throw new Error('Bounded generation reached 80 attempts; successful parts retained.');
      state.callsReserved++; await save(stateFile, state);
      console.log(`IELTS part ${name}: model request ${state.callsReserved}/${MAX_CALLS} (completed parts retained).`);
      const currentPrompt = `${state.conversationId ? '' : prompt}\nCURRENT STAGE ONLY: ${instruction}\nDo not call any tools, read or write files, execute commands, publish, or repeat other parts. Retain the FULL IELTS requirements and terminology in this conversation. Return only this requested text, no wrapping code fence. ${attempt ? 'The previous part failed structural checks; verify every required element carefully.' : ''}`;
      let reply;
      try {
        reply = await textCall({ jobDir: dir, prompt: currentPrompt, command, binary, safeEnv,
          name: `${name}-attempt-${attempt + 1}`, conversation: state.conversationId });
        state.conversationId = reply.receipt.conversationId;
        await save(stateFile, state);
        if (reply.markdown.length > MAX_RESPONSE_CHARACTERS) throw new Error('Part exceeded local response size ceiling.');
        check(reply.markdown);
      } catch (error) {
        if (/output token limit|local response size ceiling|tool or other action|different conversation|model differs/.test(error.message) || attempt === 1) throw error;
        continue;
      }
      await save(file, reply.markdown);
      state.parts[name] = { fingerprint, hash: digest(reply.markdown), receipt: reply.receipt };
      await save(stateFile, state); receipts.set(name, reply.receipt); return reply.markdown;
    }
  }
  async function bounded(name, units, instruction, check) {
    const fingerprint = digest(instruction(units));
    const split = async () => {
      const midpoint = Math.ceil(units.length / 2);
      return await bounded(`${name}-a`, units.slice(0, midpoint), instruction, check) + '\n\n' +
        await bounded(`${name}-b`, units.slice(midpoint), instruction, check);
    };
    if (state.splits[name] === fingerprint && units.length > 1) return split();
    try { return await part(name, instruction(units), text => check(text, units)); }
    catch (error) {
      if (!/output token limit|local response size ceiling/.test(error.message) || units.length < 2) throw error;
      state.splits[name] = fingerprint; await save(stateFile, state);
      return split();
    }
  }
  const planText = await part('plan', 'Return ONLY a small JSON object {"blocks":[{"heading":"Chinese claim-style functional heading","paragraphIds":["P001"],"expressions":[{"en":"exact expression from this block","gloss":"brief contextual Chinese gloss"}]}]}. Plan 1–10 semantic argument blocks, not mechanical one-paragraph blocks; group consecutive paragraphs by argument move. Every source paragraph exactly once in order. Choose 5–8 distinct worthwhile real expressions per block, following the skill. Do not generate the guide yet.', text => validateBlockPlan(text, article));
  const plan = validateBlockPlan(planText, article);
  let markdown = await part('cover', 'Write ONLY the full IELTS YAML header/footer, cover and complete 导读. Include the verified publisher source link and required cover/lead-in roles. Do not start any functional block or bilingual source layer.', text => { noSource(text); if (!text.includes('header:') || !text.includes('footer:') || !text.includes('# ★') || !text.includes('导读')) throw new Error('Cover roles missing.'); });
  for (const [index, block] of plan.blocks.entries()) {
    const blockName = `block-${index + 1}`;
    markdown += `\n\n## ◆ ${block.heading}\n\n`;
    const paragraphs = block.paragraphIds.map(p => ({ id: p, text: article.paragraphs[Number(p.slice(1)) - 1] }));
    for (const [i, window] of sourceWindows(paragraphs).entries()) {
      markdown += '\n\n' + await bounded(`${blockName}-source-${i + 1}`, window,
        ps => `Write ONLY complete sentence-by-sentence **En:** / > **译:** pairs for this data, with each <!-- source:Pnnn --> marker once before its first pair. Copy ALL exact English, no omissions/ellipsis. Full accurate Chinese; explain genuinely difficult interpretations briefly where needed. No block heading, expression list or vocabulary yet. Source data: ${JSON.stringify(ps)}`, sourceCheck);
    }
    markdown += '\n### ✦ 这一段最值得学习的表达\n\n' + block.expressions.map(e => `- **${e.en}** —— ${e.gloss}`).join('\n') + '\n\n### 📖 词汇注释\n\n';
    const expressions = block.expressions.map((e, i) => ({ ...e, number: i + 1 }));
    for (let i = 0; i < expressions.length; i += 3) {
      markdown += '\n\n' + await bounded(`${blockName}-vocabulary-${i / 3 + 1}`, expressions.slice(i, i + 3),
        es => `Write ONLY full skill-format numbered vocabulary entries for ${JSON.stringify(es)} from functional block ${index + 1} (${block.heading}). Start each **▶ n. expression**, use the supplied numbers. Include pronunciation/POS as appropriate, complete contextual 原文/语境译 backfill, layered meanings, >=3 collocations, useful register/synonym contrasts, 外刊写作赏析 and 🎓 IELTS 使用提醒 with transfer grade, topic domain or safer alternatives as appropriate. Preserve ALL required depth; do not summarize entries. Do not repeat the module heading, source markers, En/译 labels, other entries or close reading.`, (text, es) => {
          noSource(text);
          if ((text.match(/^\*\*▶\s*\d+[.、]/gm) ?? []).length !== es.length ||
              (text.match(/外刊写作赏析/g) ?? []).length < es.length || (text.match(/IELTS 使用提醒/g) ?? []).length < es.length || !text.includes('常见搭配') || !text.includes('原文')) throw new Error('Full vocabulary modules incomplete.');
        });
    }
    markdown += '\n\n' + await part(`${blockName}-analysis`, `Write ONLY ### 📖 精读｜a claim-style heading and complete close reading for functional block ${index + 1} (${block.heading}), using the complete original article and previous parts. Distinguish claim/evidence/stance/qualifications, teach argument relationships and end with 能力对接. ${index < 2 ? `Include ${plan.blocks.length === 1 ? 'two substantive arrow argument maps' : 'a substantive arrow argument map'} (→).` : ''} ${index === 0 ? 'Include a genuine competing explanation and weigh its evidence.' : ''} Add an IELTS writing transfer chain where supported; no invented Task1 evidence. Do not repeat source pairs, vocabulary, block heading or epilogue.`, text => { noSource(text); if (!/###\s+📖\s*精读/.test(text) || !text.includes('能力对接') || (index < 2 && !text.includes('→'))) throw new Error('Close reading roles incomplete.'); });
  }
  markdown += '\n\n' + await part('reflection', 'Write ONLY the complete 写在最后 · Epilogue & Reflection and the skill final completion line. Answer the central question, return to a bilingual original quote, synthesize the ENTIRE article and explain supported IELTS transfer. Do not repeat source markers, En/译 labels, cover or functional blocks.', text => { noSource(text); if (!text.includes('写在最后')) throw new Error('Final reflection missing.'); });
  validateGuide(markdown);
  await save(path.join(jobDir, 'guide.md'), markdown);
  const list = [...receipts.values()];
  const usage = {};
  for (const receipt of list) for (const [key, value] of Object.entries(receipt.usage ?? {})) if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value;
  const receipt = { backend: 'agy', model: AGY_MODEL, reasoningEffort: 'high', status: 'SUCCESS',
    transport: CHUNK_POLICY, completedParts: list.length, callsReserved: state.callsReserved, maxCalls: MAX_CALLS,
    maxResponseCharacters: MAX_RESPONSE_CHARACTERS, toolCalls: 0, durationSeconds: (Date.now() - startedAt) / 1000,
    newCallsThisRun: state.callsReserved - initialCalls, cachedParts,
    modelEvidence: 'Each uncached part validates CLI stream init model and runtime resolver', usage,
    usageEvidence: 'Sum of successful part receipts, including cached parts; failed attempts are logged separately and not included.',
    serviceHosts: [...new Set(list.flatMap(r => r.serviceHosts ?? []))] };
  await save(path.join(jobDir, 'generation-provenance.json'), receipt);
  return receipt;
}
