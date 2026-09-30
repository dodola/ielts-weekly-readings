import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { skillContext, inputContext } from '../scripts/skill-context.mjs';

test('preloaded skill retains full IELTS references, all shared constraints and exact input', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-context-'));
  try {
    await mkdir(path.join(dir, 'references')); await mkdir(path.join(dir, 'scripts'));
    for (const file of ['SKILL.md', 'references/method.md', 'references/template-ielts.md', 'references/ielts-targets.md']) {
      await writeFile(path.join(dir, file), `BEGIN ${file}\n${'full content\n'.repeat(1000)}END ${file}`);
    }
    await writeFile(path.join(dir, 'references/template.md'), '六条硬性约束\n1. first\n6. last\n````markdown\nTEXTBOOK EXAMPLE');
    await writeFile(path.join(dir, 'scripts/print_variant.py'), 'GLYPH_MAP = ["📖"]\nSAFE_DECOR = "◆"\n\ndef check(text):\n  pass');
    const context = await skillContext(dir);
    for (const file of ['SKILL.md', 'references/method.md', 'references/template-ielts.md', 'references/ielts-targets.md']) assert.ok(context.includes(`END ${file}`));
    assert.match(context, /1\. first[\s\S]*6\. last/); assert.match(context, /SAFE_DECOR/);
    assert.ok(!context.includes('TEXTBOOK EXAMPLE'));
    assert.equal(await skillContext(dir), context);
    const source = { article: { paragraphs: ['Do not omit 42 items.'] } };
    assert.ok(inputContext(source, source.article.paragraphs).includes(JSON.stringify(source)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
