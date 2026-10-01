import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFullGuide, createFullGuide, FULL_POLICY } from '../scripts/full-reading.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const article = { paragraphs: ['The sample contains 10 items. Each item matters.', 'Its final paragraph must also appear.'] };
const markdown = `---
header: 完整精读
footer: IELTS
---
# ★ 完整双语精读 ★
> ### 【 导读 】
## ◆ 第一块
<!-- source:P001 -->
**En:** The sample contains 10 items.
> **译:** 样例有十项。
**En:** Each item matters.
> **译:** 每项都重要。
<!-- source:P002 -->
**En:** Its final paragraph must also appear.
> **译:** 最后一段也必须出现。
### ✦ 表达清单
### 📖 词汇注释
${[1, 2, 3, 4].map(i => `**▶ ${i}. word**\n原文回填\n常见搭配\n外刊写作赏析\nIELTS 使用提醒`).join('\n')}
### 📖 精读
证据 → 条件 → 判断
能力对接
### 写在最后
`;
test('full-mode coverage matches every original paragraph, quantities and aligned translation', () => {
  const result = validateFullGuide(markdown, article);
  assert.equal(result.coveredParagraphs, 2);
  assert.equal(result.bilingualPairs, 3);
  assert.equal(result.vocabularyEntries, 4);
  assert.equal(result.fullEnglishSequenceMatched, true);
  assert.equal(FULL_POLICY, 'private-full-ielts-v1');
});
test('full-mode rejects omitted/reordered paragraphs, modified numbers and sparse legacy guides', () => {
  for (const invalid of [markdown.replace('<!-- source:P002 -->', ''),
    markdown.replace('The sample contains 10 items.', 'The sample contains 12 items.'),
    markdown.replace('> **译:** 每项都重要。', ''),
    markdown.replace('<!-- source:P001 -->', '<!-- source:P003 -->'),
    `${markdown}\n公开节选版本`]) assert.throws(() => validateFullGuide(invalid, article));
});
test('rejected teaching content is repaired once and needs a fresh successful review', async () => {
  for (const approvedSecondTime of [true, false]) {
    const jobDir = await mkdtemp(path.join(os.tmpdir(), 'full-review-repair-'));
    try {
      const skill = path.join(jobDir, 'skill');
      await mkdir(path.join(skill, 'references'), { recursive: true });
      await mkdir(path.join(skill, 'scripts'));
      for (const file of ['SKILL.md', 'references/method.md', 'references/template-ielts.md', 'references/ielts-targets.md', 'scripts/print_variant.py']) await writeFile(path.join(skill, file), 'complete reference fixture');
      await writeFile(path.join(skill, 'references/template.md'), '六条硬性约束\n6. final constraint\n````markdown\ntextbook-only');
      await writeFile(path.join(jobDir, 'source.json'), JSON.stringify({ article }));
      await writeFile(path.join(jobDir, 'guide.md'), `${markdown}\n语法：错误标签。\n`);
      await writeFile(path.join(jobDir, 'full-generation.codex.log'), 'model: original-worker\nreasoning effort: high\n');
      let repairs = 0, audits = 0;
      const options = { jobDir, article, skill, codex: 'codex', safeEnv: {}, maxCodex: 40, noDocuments: true, independentReview: true,
        reserve: async () => {},
        command: async (_binary, args, { log, input }) => {
          assert.deepEqual(args.slice(0, 5), ['exec', '--model', 'gpt-6.1-sol', '--config', 'model_reasoning_effort="high"']);
          assert.ok(input.includes('complete reference fixture'));
          assert.ok(input.includes(article.paragraphs[1]));
          assert.ok(input.includes('validate-guide.mjs'));
          repairs++;
          const file = path.join(jobDir, 'guide.md');
          await writeFile(file, (await readFile(file, 'utf8')).replace('错误标签', '正确标签'));
          await writeFile(log, 'model: repair-worker\nreasoning effort: high\n');
        },
        generate: async (_dir, _schema, _output, prompt) => {
          assert.ok(prompt.includes('=== ENTIRE GUIDE DATA'));
          assert.ok(prompt.includes('### 写在最后'));
          assert.ok(prompt.includes(article.paragraphs[1]));
          audits++;
          await writeFile(path.join(jobDir, 'full-audit.json.codex.log'), 'model: independent-reviewer\nreasoning effort: high\n');
          return { approved: audits === 2 && approvedSecondTime, reasons: ['A teaching term needs correction.'] };
        } };
      if (approvedSecondTime) {
        const result = await createFullGuide(options);
        assert.equal(result.coverage.fullEnglishSequenceMatched, true);
        assert.equal(result.repair.model, 'repair-worker');
        assert.equal(result.review.model, 'independent-reviewer');
      } else await assert.rejects(createFullGuide(options), /rejected.*after one repair/);
      assert.equal(repairs, 1); assert.equal(audits, 2);
      assert.equal(JSON.parse(await readFile(path.join(jobDir, 'full-review.rejected.json'))).approved, false);
    } finally { await rm(jobDir, { recursive: true, force: true }); }
  }
});

test('default user policy skips independent review and PDF sampling but preserves full coverage', async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'no-independent-review-'));
  try {
    await writeFile(path.join(jobDir, 'guide.md'), markdown);
    await writeFile(path.join(jobDir, 'full-generation.codex.log'), 'model: gpt-6.1-sol\nreasoning effort: high\n');
    const result = await createFullGuide({ jobDir, article, skill: '/not-needed-for-cache', noDocuments: true,
      reserve: async () => assert.fail('unexpected model reservation'), command: async () => assert.fail('unexpected command'),
      generate: async () => assert.fail('independent review must not run') });
    assert.equal(result.independentReview, 'disabled-by-user');
    assert.equal(result.coverage.fullEnglishSequenceMatched, true);
    assert.equal(result.review, undefined);
  } finally { await rm(jobDir, { recursive: true, force: true }); }
});

test('cold default generation uses Codex high and ignores stale AGY provenance', async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'codex-default-'));
  try {
    const skill = path.join(jobDir, 'skill');
    await mkdir(path.join(skill, 'references'), { recursive: true });
    await mkdir(path.join(skill, 'scripts'));
    for (const file of ['SKILL.md', 'references/method.md', 'references/template-ielts.md', 'references/ielts-targets.md', 'scripts/print_variant.py']) await writeFile(path.join(skill, file), 'complete reference fixture');
    await writeFile(path.join(skill, 'references/template.md'), '六条硬性约束\n6. final constraint\n````markdown\ntextbook-only');
    await writeFile(path.join(jobDir, 'source.json'), JSON.stringify({ article }));
    await writeFile(path.join(jobDir, 'generation-provenance.json'), JSON.stringify({ model: 'stale-agy' }));
    let calls = 0;
    const result = await createFullGuide({ jobDir, article, skill, codex: 'codex', noDocuments: true,
      safeEnv: {}, maxCodex: 40, reserve: async () => {},
      command: async (binary, args, options) => {
        calls++;
        assert.equal(binary, 'codex');
        assert.ok(args.includes('gpt-6.1-sol'));
        assert.ok(args.includes('model_reasoning_effort="high"'));
        assert.ok(options.input.includes(article.paragraphs[1]));
        await writeFile(path.join(jobDir, 'guide.md'), markdown);
        await writeFile(options.log, 'model: gpt-6.1-sol\nreasoning effort: high\n');
      }, generate: async () => assert.fail('no independent review') });
    assert.equal(calls, 1);
    assert.equal(result.generation.model, 'gpt-6.1-sol');
    assert.equal(result.generation.reasoningEffort, 'high');
    assert.equal(result.coverage.fullEnglishSequenceMatched, true);
    assert.equal(result.independentReview, 'disabled-by-user');
  } finally { await rm(jobDir, { recursive: true, force: true }); }
});
