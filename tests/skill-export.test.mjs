import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { skillBuildScript, DIAMOND_MAPPING } from '../scripts/skill-export.mjs';

test('original diamond export support uses a private skill copy, preserving source and all installed gates', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'skill-export-'));
  try {
    const skill = path.join(temporary, 'installed'), job = path.join(temporary, 'job');
    await mkdir(path.join(skill, 'scripts'), { recursive: true });
    const original = 'GLYPH_MAP = [\n]\n# original unsupported-glyph guard remains\n';
    for (const file of ['build.sh', 'make_ref.py', 'postprocess.py', 'tokens.py']) await writeFile(path.join(skill, 'scripts', file), `unchanged ${file}`);
    await writeFile(path.join(skill, 'scripts/print_variant.py'), original);
    assert.equal(await skillBuildScript(skill, job, 'no special source marker'), path.join(skill, 'scripts/build.sh'));
    const script = await skillBuildScript(skill, job, 'complete unchanged original ♦');
    assert.ok(script.startsWith(job));
    assert.equal(await readFile(path.join(skill, 'scripts/print_variant.py'), 'utf8'), original);
    const copied = await readFile(path.join(job, '.print-skill/scripts/print_variant.py'), 'utf8');
    assert.equal(copied.replace(DIAMOND_MAPPING, ''), original);
    assert.equal(await readFile(script, 'utf8'), 'unchanged build.sh');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
