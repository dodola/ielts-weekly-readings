import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFullGuide, FULL_POLICY } from '../scripts/full-reading.mjs';

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
