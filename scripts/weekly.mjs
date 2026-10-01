#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir, rename, stat, open, unlink, copyFile, readdir } from 'node:fs/promises';
import { windowFor, issuesInWindow, sourceURL, digest, publicMetadata, assertPrivateSnapshot } from './notes.mjs';
import { FULL_POLICY, createFullGuide } from './full-reading.mjs';
import { serialQueue, runBounded } from './concurrency.mjs';
import { randomUUID } from 'node:crypto';
import { PUBLICATIONS, PUBLICATION_NAMES, balancedSelection, publicationCounts } from './selection.mjs';
import { embeddedPublisherLink, newYorkerContentsLinks } from './publisher-links.mjs';
import { AGY_MODEL } from './agy-generation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const HELP = `Usage: node scripts/weekly.mjs --project PATH --source PATH --output-repo PATH [--execute --publish]

Every online run safely fast-forward updates the exact --source checkout first.
Default: refresh + private dry-run; no AI calls, no commit, no push.
--execute              Analyze all candidates; generate up to 10 selected guides.
--publish              Commit/push validated PRIVATE artifacts (requires --execute).
--offline              Local-only dry-run; cannot execute or publish.
--date YYYY-MM-DD      Beijing run date, for reproducible backfill/verification.
--from YYYY-MM-DD --to YYYY-MM-DD  Explicit inclusive issue-date range (max 31 days).
--max-articles N       Optional candidate cap; default covers all candidates.
--max-guides N         Selected guide cap (default 10, maximum 10).
--publications KEYS   Optional comma-separated publication subset for supplements.
--cached-only         Refuse missing analyses; no new TypeSafe calls.
--generation-concurrency N  Independent guide workers (default 2, maximum 2); Git is serial.
--max-codex-calls N    Generation/repair reservations per date range (default 40).
--skill-root PATH     Installed intensive-reading skill.
--source-links PATH   Private JSON mapping issueId/articleId -> verified publisher URL.
--no-documents        Generate Markdown only; still check full source coverage.
--output-repo PATH     Separate PRIVATE Git checkout for original texts + guides.
--mode full-ielts      Complete original + translation + IELTS skill template (default).
--generator agy       Existing agy CLI, gemini-3.8-flash-high, effort high (default).
--repository OWNER/NAME  Expected PRIVATE remote (default dodola/ielts-reading-library).

Generation reservations persist per date range, including failed attempts. TypeSafe
has no monetary or logical-request cap, per user instruction. SDK may retry each
logical request twice (up to 3 transport attempts). No auto-recharge or scheduling.
`;
const privateRoot = path.join(root, '.private');
const cache = path.join(privateRoot, 'cache');
let outputRoot = path.join(privateRoot, 'library');
let publicRoot = path.join(outputRoot, 'readings');
const active = new Set();
const stop = () => {
  for (const child of active) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
};
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(130); });

async function exists(p) { try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function json(p) { return JSON.parse(await readFile(p, 'utf8')); }
async function save(p, value) {
  await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const temporary = `${p}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, p);
}
async function command(binary, args, { cwd = root, env = process.env, input, timeout = 120000, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    active.add(child);
    const startedAt = new Date();
    let out = '', err = '', ended = false;
    const timer = setTimeout(() => {
      ended = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000).unref();
      reject(new Error(`${path.basename(binary)} timed out; private intermediate files retained.`));
    }, timeout);
    child.on('error', e => { clearTimeout(timer); active.delete(child); reject(e); });
    child.stdout.on('data', b => { out += b; });
    child.stderr.on('data', b => { err += b; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', async code => {
      clearTimeout(timer); active.delete(child);
      if (log) {
        await save(log, `${out}\n${err}`).catch(() => {});
        const finishedAt = new Date();
        await save(`${log}.timing.json`, { command: path.basename(binary), startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(), durationMs: finishedAt - startedAt, exitCode: code }).catch(() => {});
      }
      if (ended) return;
      // Raw SDK/Codex output stays private. Never echo untrusted error bodies.
      if (code !== 0) reject(new Error(`${path.basename(binary)} failed (exit ${code}); inspect private logs locally.`));
      else resolve(out.trim());
    });
  });
}
async function sourceRefresh(source, offline, runDir) {
  const git = (...args) => command('git', ['-C', source, ...args]);
  const remote = await git('remote', 'get-url', 'origin');
  if (!['https://github.com/hehonghui/awesome-english-ebooks.git',
    'https://github.com/hehonghui/awesome-english-ebooks',
    'git@github.com:hehonghui/awesome-english-ebooks.git'].includes(remote)) {
    throw new Error('Source origin differs from the existing verified source; stopped.');
  }
  if (await git('status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Source checkout contains local changes; preserved and stopped before refresh.');
  }
  const branch = await git('branch', '--show-current');
  const upstream = await git('rev-parse', '--abbrev-ref', '@{upstream}');
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(branch) || upstream !== `origin/${branch}`) {
    throw new Error('Source requires an attached branch tracking origin with the same name.');
  }
  const before = await git('rev-parse', 'HEAD');
  if (!offline) {
    console.log('Refreshing the existing periodical source (fast-forward only)…');
    await command('git', ['-C', source, 'pull', '--ff-only', '--no-rebase', '--no-recurse-submodules', 'origin', branch],
      { timeout: 15 * 60000, log: path.join(runDir, 'source-refresh.log') });
    if (await git('status', '--porcelain', '--untracked-files=all')) throw new Error('Source became dirty during refresh; stopped.');
  }
  return { refreshed: !offline, branch, before, after: await git('rev-parse', 'HEAD') };
}
function int(v, fallback, max) {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Budget must be an integer from 1 to ${max}.`);
  return n;
}
function safeId(s) { if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error('Unsafe article or issue ID.'); return s; }
async function main() {
  const { values: v } = parseArgs({ options: {
    help: { type: 'boolean' }, project: { type: 'string' }, source: { type: 'string' },
    execute: { type: 'boolean' }, publish: { type: 'boolean' }, offline: { type: 'boolean' },
    date: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, 'max-articles': { type: 'string' }, 'max-guides': { type: 'string' },
    'max-codex-calls': { type: 'string' }, 'generation-concurrency': { type: 'string' },
    'skill-root': { type: 'string' }, 'source-links': { type: 'string' },
    'no-documents': { type: 'boolean' }, repository: { type: 'string' }, 'output-repo': { type: 'string' }, mode: { type: 'string' },
    publications: { type: 'string' }, 'cached-only': { type: 'boolean' },
    generator: { type: 'string' },
  } });
  if (v.help) { console.log(HELP); return; }
  if (v.mode && v.mode !== 'full-ielts') throw new Error('Only --mode full-ielts is supported; excerpt mode is disabled.');
  if (v.generator && v.generator !== 'agy') throw new Error('Only the authorized agy generator is supported.');
  if (!v.project || !v.source) throw new Error('--project and --source are required.');
  if (v.publish && !v.execute) throw new Error('--publish requires --execute.');
  if (v.offline && (v.execute || v.publish)) throw new Error('--offline is restricted to dry-runs.');
  if (v.execute && !v['output-repo']) throw new Error('--execute requires an explicit --output-repo private checkout.');
  const project = path.resolve(v.project), source = path.resolve(v.source);
  const skill = path.resolve(v['skill-root'] ?? path.join(os.homedir(), '.codex/skills/intensive-reading'));
  const maxArticles = int(v['max-articles'], Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), maxGuides = int(v['max-guides'], 10, 10);
  const maxCodex = int(v['max-codex-calls'], 40, 40);
  const generationConcurrency = int(v['generation-concurrency'], 2, 2);
  const publicationFilter = v.publications ? [...new Set(v.publications.split(','))].sort() : null;
  if (publicationFilter?.some(key => !PUBLICATIONS.includes(key))) throw new Error('Unknown --publications key.');
  const repository = v.repository ?? 'dodola/ielts-reading-library';
  outputRoot = path.resolve(v['output-repo'] ?? outputRoot);
  if (outputRoot === root) throw new Error('Artifact checkout must be separate from the public workflow code.');
  publicRoot = path.join(outputRoot, 'readings');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository name.');
  if (v.date && (!/^20\d\d-\d\d-\d\d$/.test(v.date) || new Date(`${v.date}T00:00:00Z`).toISOString().slice(0, 10) !== v.date)) {
    throw new Error('--date must be a valid YYYY-MM-DD.');
  }
  const window = windowFor(v.date ? new Date(`${v.date}T04:00:00Z`) : new Date());
  if (Boolean(v.from) !== Boolean(v.to)) throw new Error('--from and --to must be supplied together.');
  if (v.from) {
    for (const date of [v.from, v.to]) if (!/^20\d\d-\d\d-\d\d$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid date range.');
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000 + 1;
    if (days < 1 || days > 31) throw new Error('Inclusive date range must contain 1–31 days.');
    window.start = v.from; window.end = v.to;
  }
  const runDir = path.join(privateRoot, 'runs', `${window.start}_${window.end}${publicationFilter ? `_${publicationFilter.join('-')}` : ''}`);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(privateRoot, 'weekly.lock');
  try { const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close(); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await readFile(lockPath, 'utf8'));
    try { process.kill(pid, 0); throw new Error('Another weekly run is active.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath);
    const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close();
  }
  const globalTimer = setTimeout(() => { console.error('4-hour total runtime cap reached.'); stop(); process.exit(1); }, 240 * 60000);
  try {
    const refresh = await sourceRefresh(source, v.offline, runDir);
    const cli = path.join(project, 'bin/ielts-curator.mjs');
    if (!await exists(cli)) throw new Error('Existing curator CLI is missing.');
    const base = ['--source', source, '--data-dir', cache];
    const call = (operation, args = [], opts = {}) => command(process.execPath, [cli, operation, ...base, ...args],
      { cwd: project, log: path.join(runDir, `${operation}-${digest(JSON.stringify(args)).slice(0, 8)}.log`), ...opts });
    const months = [...new Set([window.start.slice(0, 7), window.end.slice(0, 7)])];
    let allIssues = [];
    for (const month of months) allIssues.push(...JSON.parse(await call('list', ['--month', month, '--json'])).issues);
    const issues = issuesInWindow(allIssues, window).filter(issue => !publicationFilter || publicationFilter.includes(issue.publicationKey));
    const tasks = [];
    const groups = [];
    for (const issue of issues) {
      const args = ['--publication', issue.publicationKey, '--issue', issue.issueDate,
        ...(v['max-articles'] ? ['--limit', String(maxArticles - tasks.length)] : [])];
      const plan = JSON.parse(await call('analyze', [...args, '--dry-run']));
      if (v['cached-only'] && plan.plannedRequests > 0) throw new Error('Cached-only run found missing analyses; stopped before any TypeSafe call.');
      const rows = JSON.parse(await call('report', [...args, '--json'])).results;
      groups.push({ issue, args, plannedRequests: plan.plannedRequests, cached: plan.cached, articles: rows.length });
      for (const row of rows) {
        const article = row.article;
        safeId(issue.id); safeId(article.id);
        tasks.push({ issue, article, cached: Boolean(row.analysis) });
      }
      if (tasks.length >= maxArticles) break;
    }
    const report = { schemaVersion: 1, policy: FULL_POLICY, mode: 'full-ielts', window, refresh,
      limits: { maxArticles: v['max-articles'] ? maxArticles : 'all', maxGuides, maxCodexCalls: maxCodex, generationConcurrency,
        typeSafeBudget: 'unlimited-by-user-instruction', retriesPerRequest: 2, timeoutMinutes: 240 },
      issues: issues.map(({ id, publication, issueDate }) => ({ id, publication, issueDate })),
      candidates: tasks.map(t => ({ issueId: t.issue.id, articleId: t.article.id,
        title: t.article.title, cached: t.cached })),
      issuePlans: groups.map(g => ({ issueId: g.issue.id, articles: g.articles, cached: g.cached, plannedRequests: g.plannedRequests })),
      plannedRequests: groups.reduce((s, g) => s + g.plannedRequests, 0),
      selectionPolicy: 'balanced-publications-v1', publicationFilter, cachedOnly: Boolean(v['cached-only']),
      status: tasks.length ? 'planned' : 'no-new-issues', guides: [],
    };
    await save(path.join(runDir, 'report.json'), report);
    console.log(`${window.start}…${window.end} (Asia/Shanghai): ${issues.length} issues, ${tasks.length} candidates, ${report.plannedRequests} new logical requests; at most ${maxGuides} guides.`);
    if (!tasks.length) {
      console.log('Source refreshed successfully; no issues in the seven-day window. No AI call or publication.');
      return;
    }
    if (!v.execute) { console.log('Dry-run complete; no AI call, no publication. Private report saved.'); return; }
    for (const file of ['SKILL.md', 'references/method.md', 'references/template-ielts.md', 'references/ielts-targets.md']) {
      if (!await exists(path.join(skill, file))) throw new Error('Installed intensive-reading skill is incomplete.');
    }
    const codex = process.env.CODEX_BINARY || 'codex';
    const agy = process.env.AGY_BINARY || 'agy';
    const models = await command(agy, ['models']);
    if (!new RegExp(`(^|\\s)${AGY_MODEL}(\\s|$)`).test(models)) throw new Error('Requested agy model is unavailable; no fallback.');
    if (!v['no-documents']) for (const dep of ['pandoc', 'soffice', 'python3', 'pdftotext', 'pdfinfo', 'pdftoppm']) {
      await command('which', [dep]);
    }
    if (v.execute) {
      await assertPrivateRepository(repository);
      const actual = await command('git', ['remote', 'get-url', 'origin'], { cwd: outputRoot });
      if (![ `https://github.com/${repository}.git`, `git@github.com:${repository}.git` ].includes(actual)) throw new Error('Output repository remote mismatch.');
      const dirty = (await command('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: outputRoot })).split('\n').filter(Boolean);
      if (dirty.some(line => !/^readings\//.test(line.slice(3)) && line.slice(3) !== 'INDEX.md')) throw new Error('Output checkout has unrelated local changes; commit preparation first.');
      await command('gh', ['api', 'user', '--jq', '.login']);
      await command('git', ['pull', '--ff-only', '--no-rebase', 'origin', 'main'],
        { cwd: outputRoot, log: path.join(runDir, 'output-refresh.log') });
    }
    const ledgerPath = path.join(runDir, 'budget.json');
    let ledger = await exists(ledgerPath) ? await json(ledgerPath) : { typeSafeReserved: 0, codexReserved: 0 };
    const reserveSerial = serialQueue();
    async function reserve(kind, count, limit) { return reserveSerial(async () => {
      if (ledger[kind] + count > limit) throw new Error(`Persistent per-date ${kind} budget exhausted; stopped.`);
      ledger[kind] += count; await save(ledgerPath, ledger);
    }); }
    const req = createRequire(path.join(project, 'package.json'));
    const AdmZip = req('adm-zip'); const cheerio = req('cheerio');
    const sourceLinks = v['source-links'] ? await json(path.resolve(v['source-links'])) : {};
    const safeEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'CODEX_HOME', 'TMPDIR']
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const skillHash = digest((await Promise.all(['SKILL.md', 'references/method.md', 'references/template-ielts.md',
      'references/ielts-targets.md', 'references/template.md', 'references/style-spec.md', 'scripts/build.sh', 'scripts/postprocess.py', 'scripts/print_variant.py',
      'scripts/make_ref.py', 'scripts/tokens.py'].map(f => readFile(path.join(skill, f))))).map(b => b.toString()).join('\n'));
    const selected = [];
    report.inputTokens = 0;
    report.analyzed = 0;
    for (const g of groups) {
      console.log(`Screening ${g.issue.publication} ${g.issue.issueDate}: ${g.articles} candidates (${g.cached} cached)…`);
      const result = JSON.parse(await call('analyze', [...g.args, '--json'], { timeout: 45 * 60000 }));
      for (const row of result.results) {
        const analysis = row.analysis;
        if (!analysis) throw new Error('Curator did not return a valid analysis; stopped.');
        if (row.state !== 'cached') report.inputTokens += analysis.usage?.inputTokens ?? 0;
        if (analysis.decision === 'selected') selected.push({ issue: g.issue, article: row.article, analysis });
        report.analyzed += 1;
      }
      await save(path.join(runDir, 'report.json'), report);
    }
    report.selectedCount = selected.length;
    await save(path.join(runDir, 'report.json'), report);
    report.blockedArticles = [];
    const eligible = [], datasets = new Map(), archives = new Map(), contents = new Map();
    const pending = [];
    for (const t of selected) {
      if (!datasets.has(t.issue.id)) datasets.set(t.issue.id, await json(path.join(cache, 'issues', `${t.issue.id}.json`)));
      const dataset = datasets.get(t.issue.id);
      const article = dataset.articles.find(a => a.id === t.article.id);
      if (!article) throw new Error('Selected source article missing from private cache.');
      if (!archives.has(t.issue.id)) archives.set(t.issue.id, new AdmZip(path.join(source, t.issue.sourceDirectory, t.issue.epubName)));
      const z = archives.get(t.issue.id);
      const entry = z.getEntry(article.sourceEntry);
      if (!entry) throw new Error('Source EPUB article entry is missing.');
      const $ = cheerio.load(entry.getData().toString('utf8'));
      const supplied = sourceLinks[`${t.issue.id}/${article.id}`];
      let link = embeddedPublisherLink($, t.issue.publicationKey, supplied);
      if (!link && t.issue.publicationKey === 'new-yorker') {
        if (!contents.has(t.issue.id)) {
          const tocUrl = `https://www.newyorker.com/magazine/${t.issue.issueDate.replaceAll('-', '/')}`;
          const saved = path.join(privateRoot, 'publisher-links', `${t.issue.id}.json`);
          let snapshot = await exists(saved) ? await json(saved) : null;
          if (snapshot?.sourceDigest !== dataset.issue.sourceDigest || snapshot?.tocUrl !== tocUrl) {
            try {
              const response = await fetch(tocUrl, { signal: AbortSignal.timeout(20000) });
              if (!response.ok || response.url !== tocUrl) throw new Error('Official contents page failed or redirected.');
              snapshot = { tocUrl, sourceDigest: dataset.issue.sourceDigest, verifiedAt: new Date().toISOString(),
                articles: newYorkerContentsLinks(cheerio.load(await response.text()), t.issue, dataset.articles) };
              await save(saved, snapshot);
            } catch { snapshot = { articles: {}, lookupFailed: true }; }
          }
          contents.set(t.issue.id, snapshot);
        }
        const record = contents.get(t.issue.id).articles[article.id];
        if (record?.title === article.title && record?.author === article.author) link = sourceURL(record.url, 'new-yorker');
      }
      if (!link) {
        report.blockedArticles.push({ issueId: t.issue.id, articleId: article.id,
          title: article.title, reason: 'missing-or-ambiguous-publisher-link' });
        console.log(`Publisher link unavailable: ${t.issue.id}/${article.id}; retained privately, considering the next selected article.`);
        await save(path.join(runDir, 'report.json'), report);
        continue;
      }
      eligible.push({ ...t, article, sourceUrl: link });
    }
    const chosen = balancedSelection(eligible, maxGuides);
    report.publicationCounts = { candidates: publicationCounts(tasks), selected: publicationCounts(selected),
      linkedEligible: publicationCounts(eligible), chosen: publicationCounts(chosen) };
    report.missingPublications = (publicationFilter ?? PUBLICATIONS).filter(key => !report.publicationCounts.chosen[key])
      .map(key => ({ publicationKey: key, reason: !report.publicationCounts.candidates[key] ? 'no-issues-in-window' :
        !report.publicationCounts.selected[key] ? 'no-selected-candidates' : !report.publicationCounts.linkedEligible[key] ? 'no-trusted-publisher-link' : 'guide-limit' }));
    await save(path.join(runDir, 'report.json'), report);
    console.log(`Balanced selection: ${JSON.stringify(report.publicationCounts.chosen)}; missing: ${JSON.stringify(report.missingPublications)}.`);
    for (const t of chosen) {
      const { article, analysis } = t;
      const metadata = { ...publicMetadata(article, t.issue, t.sourceUrl, analysis), mode: 'full-ielts', policy: FULL_POLICY };
      const contentHash = digest(JSON.stringify({ article, analysis, metadata, skillHash, policy: FULL_POLICY }));
      const jobDir = path.join(privateRoot, 'jobs', contentHash.slice(0, 24));
      await mkdir(jobDir, { recursive: true, mode: 0o700 });
      await save(path.join(jobDir, 'source.json'), { article, metadata });
      const finalDir = path.join(publicRoot, t.issue.id, article.id);
      if (await exists(path.join(finalDir, 'metadata.json'))) {
        const previous = await json(path.join(finalDir, 'metadata.json'));
        if (previous.contentHash === contentHash && previous.mode === 'full-ielts' && previous.coverage?.fullEnglishSequenceMatched === true && ['approved', 'disabled-by-user'].includes(previous.independentReview) && previous.artifactHashes && previous.artifacts.includes('original.txt') &&
            (await Promise.all(previous.artifacts.map(async f => previous.artifactHashes[f] === digest(await readFile(path.join(finalDir, f)))))).every(Boolean)) {
          report.guides.push({ issueId: t.issue.id, articleId: article.id, state: 'already-published' });
          continue;
        }
      }
      pending.push({ t, article, metadata, contentHash, jobDir, finalDir });
    }
    const completeSerial = serialQueue();
    let publicationDone = false;
    const buildSerial = serialQueue();
    const guideCommand = (binary, args, options) => binary === 'bash'
      ? buildSerial(() => command(binary, args, options)) : command(binary, args, options);
    const alreadyCompleted = report.guides.length;
    await runBounded(pending, generationConcurrency, async ({ t, article, metadata, contentHash, jobDir, finalDir }, index) => {
      console.log(`Generating/reusing COMPLETE IELTS guide ${alreadyCompleted + index + 1}/${maxGuides}: ${article.title}…`);
      const full = await createFullGuide({ jobDir, article, skill, codex, safeEnv, command: guideCommand,
        reserve, maxCodex, noDocuments: v['no-documents'], generator: 'agy', agy });
      await completeSerial(async () => {
      const artifactFiles = [...full.artifactFiles];
      await mkdir(finalDir, { recursive: true });
      for (const f of artifactFiles) await copyFile(path.join(jobDir, f), path.join(finalDir, f));
      await assertPrivateRepository(repository);
      await save(path.join(finalDir, 'original.txt'), `${article.title}\n${article.publication} | ${article.author || 'Author not listed'} | Issue ${t.issue.issueDate}\nPublisher source: ${metadata.sourceUrl}\n\nLocal user-provided input; private study archive.\n\n${article.paragraphs.join('\n\n')}\n`);
      artifactFiles.push('original.txt');
      await save(path.join(finalDir, 'metadata.json'), { ...metadata, contentHash, coverage: full.coverage,
        artifacts: artifactFiles, artifactHashes: Object.fromEntries(await Promise.all(artifactFiles.map(async f =>
          [f, digest(await readFile(path.join(finalDir, f)))]))), independentReview: full.independentReview,
        generation: full.generation, review: full.review, repair: full.repair });
      report.guides.push({ issueId: t.issue.id, articleId: article.id, state: 'generated', sourceUrl: metadata.sourceUrl });
      await save(path.join(runDir, 'report.json'), report);
      if (v.publish) { await publish(repository, runDir, window.end); publicationDone = true; }
      });
    });
    report.status = report.guides.length ? 'completed' : 'no-selected-articles';
    report.budget = ledger;
    await save(path.join(runDir, 'report.json'), report);
    console.log(`Completed: ${report.guides.length} guides (caps are processing ceilings, not guaranteed output).`);
    if (v.publish && report.guides.length && !publicationDone) await publish(repository, runDir, window.end);
  } finally { clearTimeout(globalTimer); await unlink(lockPath).catch(() => {}); }
}
async function publish(repository, runDir, runDate) {
  await assertPrivateRepository(repository);
  // Publish only trusted allowlisted artifacts; never git add . or cache/logs.
  const paths = [];
  const archiveCounts = Object.fromEntries(PUBLICATIONS.map(key => [key, 0]));
  const index = ['# IELTS Reading Library', '', '用户指定本地外刊输入的个人私有阅读库。原文单独保存，精读完整覆盖原文并逐句双语讲解；不代表出版方转载授权。', '',
    '| 文章与期号 | 出版方原文 | 筛选理由 | 本地原文 | 精读 | Word | PDF |',
    '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const issue of (await readdir(publicRoot)).sort()) {
    safeId(issue);
    for (const article of (await readdir(path.join(publicRoot, issue))).sort()) {
      safeId(article);
      const dir = path.join(publicRoot, issue, article), meta = await json(path.join(dir, 'metadata.json'));
      if (meta.mode !== 'full-ielts') continue; // Legacy excerpts are never indexed as full guides.
      const publicationKey = PUBLICATIONS.find(key => PUBLICATION_NAMES[key] === meta.publication);
      if (publicationKey) archiveCounts[publicationKey]++;
      if (!['approved', 'disabled-by-user'].includes(meta.independentReview) || meta.coverage?.fullEnglishSequenceMatched !== true) {
        throw new Error('Full IELTS metadata lacks an explicit review policy or complete English coverage.');
      }
      const markdown = await readFile(path.join(dir, 'guide.md'), 'utf8');
      const noSecrets = text => {
        if (/\/home\/|\/Users\/|TYPESAFE_API_KEY|github_pat_|gh[pousr]_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}|PRIVATE KEY/.test(text)) throw new Error('Public secret/path scan failed.');
      };
      noSecrets(markdown); noSecrets(JSON.stringify(meta));
      const rel = path.relative(outputRoot, dir);
      if (meta.artifacts.some(f => !['guide.md', 'guide.docx', 'guide.pdf', 'original.txt'].includes(f))) throw new Error('Unknown archive artifact.');
      for (const f of [...meta.artifacts, 'metadata.json']) {
        const p = path.join(dir, f);
        if ((await stat(p)).size > 20 * 1024 * 1024) throw new Error('Public artifact size limit exceeded.');
        if (f !== 'metadata.json' && (!meta.artifactHashes?.[f] || digest(await readFile(p)) !== meta.artifactHashes[f])) throw new Error('Public artifact changed after approval; stopped.');
        paths.push(path.join(rel, f));
      }
      index.push(`| ${meta.issueDate} · ${meta.publication} · ${meta.title.replace(/[\[\]\n|]/g, '')} | [原文链接](${meta.sourceUrl}) | 推荐；综合分 ${meta.compositeScore}；置信度 ${(meta.confidence * 100).toFixed(0)}%；${meta.topic} / ${meta.difficulty} | [原文](${rel}/original.txt) | [MD](${rel}/guide.md) | ${meta.artifacts.includes('guide.docx') ? `[DOCX](${rel}/guide.docx)` : '—'} | ${meta.artifacts.includes('guide.pdf') ? `[PDF](${rel}/guide.pdf)` : '—'} |`);
    }
  }
  index.splice(4, 0, '累计完整精读（历史成品保留；每轮最多10篇）：' + PUBLICATIONS.map(key => `${PUBLICATION_NAMES[key]} ${archiveCounts[key]}篇`).join(' · '), '');
  await save(path.join(outputRoot, 'INDEX.md'), `${index.join('\n')}\n`);
  await save(path.join(outputRoot, 'README.md'), `${index.join('\n')}\n\n流程代码及运行说明：[ielts-weekly-readings](https://github.com/dodola/ielts-weekly-readings)。本库不新增协作者。\n`);
  paths.push('INDEX.md', 'README.md');
  // Refuse existing staged files or unrelated changes; only this run's outputs
  // may be committed. Files that are unchanged are harmless in the allowlist.
  if (await command('git', ['diff', '--cached', '--name-only'], { cwd: outputRoot })) throw new Error('Pre-existing staged files; stopped before publication.');
  await command('git', ['add', '--', ...paths], { cwd: outputRoot });
  const staged = (await command('git', ['diff', '--cached', '--name-only'], { cwd: outputRoot })).split('\n').filter(Boolean);
  if (staged.some(f => !paths.includes(f))) throw new Error('Unexpected staged file; stopped.');
  if (staged.length) await command('git', ['commit', '-m', `Publish IELTS reading notes ${runDate}`],
    { cwd: outputRoot, log: path.join(runDir, 'commit.log') });
  await assertPrivateRepository(repository);
  await command('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'push', 'origin', 'HEAD:main'], { cwd: outputRoot, log: path.join(runDir, 'push.log') });
  console.log(`Published to https://github.com/${repository}`);
}
async function assertPrivateRepository(repository) {
  const repo = JSON.parse(await command('gh', ['api', `repos/${repository}`, '--jq', '{full_name: .full_name, private: .private}']));
  assertPrivateSnapshot(repository, repo);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
