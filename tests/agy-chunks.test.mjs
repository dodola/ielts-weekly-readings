import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { agyChunkedGuide, validateBlockPlan, sourceWindows } from '../scripts/agy-chunks.mjs';
import { validateFullGuide } from '../scripts/full-reading.mjs';

const article = { paragraphs: ['Families share books and discuss stories at public libraries.', 'Reading together helps neighbours learn and build trust.'] };
const expressions = ['share books', 'discuss stories', 'public libraries', 'Reading together', 'build trust'].map(en => ({ en, gloss: '结合语境理解表达' }));
const plan = { blocks: [{ heading: '共同阅读连接社区', paragraphIds: ['P001', 'P002'], expressions }] };

test('functional plans preserve exact source order and genuine expressions; source windows never split paragraphs', () => {
  assert.equal(validateBlockPlan(JSON.stringify(plan), article).blocks.length, 1);
  assert.throws(() => validateBlockPlan(JSON.stringify({ blocks: [{ ...plan.blocks[0], paragraphIds: ['P002', 'P001'] }] }), article), /original order/);
  assert.throws(() => validateBlockPlan(JSON.stringify({ blocks: [{ ...plan.blocks[0], expressions: expressions.map((e, i) => i ? e : { en: 'not in source', gloss: 'synthetic' }) }] }), article), /occur/);
  const paragraphs = Array.from({ length: 7 }, (_, i) => ({ id: `P00${i + 1}`, text: 'word '.repeat(150) }));
  const windows = sourceWindows(paragraphs);
  assert.deepEqual(windows.flat(), paragraphs);
  assert.ok(windows.every(w => w.length <= 3 && w.reduce((n, p) => n + p.text.trim().split(/\s+/).length, 0) <= 400));
});

test('bounded parts split truncation, preserve all teaching/source layers and resume successful checkpoints', async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'agy-chunk-fixture-'));
  let calls = 0, sourceTruncated = false, vocabularyTruncated = false;
  const textCall = async ({ name, prompt, conversation }) => {
    calls++;
    if (calls > 1) assert.equal(conversation, '00000000-0000-0000-0000-000000000001');
    let markdown;
    if (name.startsWith('plan-')) markdown = JSON.stringify(plan);
    else if (name.startsWith('cover-')) markdown = '---\nheader: 公共文化 · 外刊精读\nfooter: 公共文化 · 阅读\n---\n\n# ★ 公共文化 · 外刊精读 ★\n\n**Reading Together**\n\n**共同阅读**\n\n> ### 【 导读 · Lead-in 】\n> 阅读如何建立信任？\n';
    else if (name.includes('-source-')) {
      const data = JSON.parse(prompt.match(/Source data: (\[[^\n]+\])/)[1]);
      if (data.length > 1 && !sourceTruncated) { sourceTruncated = true; throw new Error('Agy exceeded its output token limit'); }
      markdown = data.map(p => `<!-- source:${p.id} -->\n**En:** ${p.text}\n\n> **译:** ${p.id === 'P001' ? '家庭分享书籍，并在公共图书馆讨论故事。' : '共同阅读帮助邻里学习，并建立信任。'}\n`).join('\n');
    } else if (name.includes('-vocabulary-')) {
      const data = JSON.parse(prompt.match(/entries for (\[[^\n]+?\]) from/)[1]);
      if (data.length > 2 && !vocabularyTruncated) { vocabularyTruncated = true; throw new Error('Agy exceeded its output token limit'); }
      markdown = data.map(e => `**▶ ${e.number}. ${e.en}**\n\n> 中文释义：结合语境理解。\n> **原文：** ${article.paragraphs[0]}\n> 语境译：家庭分享书籍。\n> 常见搭配：share books / discuss stories / build trust\n\n**▶ 外刊写作赏析**\n\n> 作者用具体行动展示公共生活。\n\n**▶ 🎓 IELTS 使用提醒**\n\n> ✓✓ 直接迁移：社区与教育话题。\n`).join('\n');
    } else if (name.includes('-analysis-')) markdown = '### 📖 精读｜公共空间让学习发生\n\n分享书籍 → 讨论观点\n\n共同阅读 → 建立信任\n\n竞争性解释：信任也可能来自其他邻里活动。\n\n能力对接：追踪因果与观点限定。\n';
    else markdown = '> ### 【 写在最后 · Epilogue & Reflection 】\n> 回到共同阅读的社会意义。\n\n*--- 全文精读完结 · 勤加复盘 ---*\n';
    return { markdown, receipt: { conversationId: '00000000-0000-0000-0000-000000000001', model: 'gemini-3.8-flash-high', reasoningEffort: 'high', toolCalls: 0, usage: { total_tokens: 10 }, serviceHosts: ['synthetic.invalid'] } };
  };
  try {
    const options = { jobDir, prompt: 'Synthetic complete skill and original input context; no private article.', article,
      textCall, validateGuide: text => validateFullGuide(text, article) };
    const receipt = await agyChunkedGuide(options);
    const markdown = await readFile(path.join(jobDir, 'guide.md'), 'utf8');
    assert.equal(validateFullGuide(markdown, article).coveredParagraphs, 2);
    assert.equal(validateFullGuide(markdown, article).vocabularyEntries, 5);
    assert.ok(sourceTruncated && vocabularyTruncated);
    assert.ok(receipt.callsReserved <= 80);
    const before = calls;
    const resumed = await agyChunkedGuide({ ...options, textCall: async () => assert.fail('unexpected new model request') });
    assert.equal(calls, before); assert.equal(resumed.newCallsThisRun, 0); assert.ok(resumed.cachedParts > 0);
    await assert.rejects(agyChunkedGuide({ ...options, validateGuide: () => { throw new Error('final integrity failure'); },
      textCall: async () => assert.fail('unexpected new model request') }), /final integrity failure/);
    assert.equal(await readFile(path.join(jobDir, 'guide.md'), 'utf8'), markdown);
    if (process.env.CHUNK_EXPORT_PROBE_DIR) {
      await mkdir(process.env.CHUNK_EXPORT_PROBE_DIR, { recursive: true });
      await writeFile(path.join(process.env.CHUNK_EXPORT_PROBE_DIR, 'guide.md'), markdown);
    }
  } finally { await rm(jobDir, { recursive: true, force: true }); }
});
