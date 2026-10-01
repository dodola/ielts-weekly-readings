import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DIAMOND_MAPPING = '    ("♦", "◆"),  # original publisher end marker: print-safe diamond\n';
export async function skillBuildScript(skill, jobDir, markdown) {
  if (!markdown.includes('♦')) return path.join(skill, 'scripts/build.sh');
  // A local export copy preserves the installed skill and every build gate.
  // This single additional print mapping was verified on an actual PDF probe.
  const scripts = path.join(jobDir, '.print-skill/scripts');
  await mkdir(scripts, { recursive: true, mode: 0o700 });
  for (const file of ['build.sh', 'make_ref.py', 'postprocess.py', 'print_variant.py', 'tokens.py']) {
    await copyFile(path.join(skill, 'scripts', file), path.join(scripts, file));
  }
  const filename = path.join(scripts, 'print_variant.py');
  let text = await readFile(filename, 'utf8');
  if (!text.includes(DIAMOND_MAPPING)) {
    if (!text.includes('GLYPH_MAP = [\n')) throw new Error('Installed glyph map format differs; stopped.');
    text = text.replace('GLYPH_MAP = [\n', `GLYPH_MAP = [\n${DIAMOND_MAPPING}`);
    await writeFile(filename, text, { mode: 0o600 });
  }
  return path.join(scripts, 'build.sh');
}
