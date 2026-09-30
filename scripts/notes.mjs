import { createHash } from 'node:crypto';

export const POLICY = 'public-ielts-v1';
export const domains = {
  economist: 'economist.com', 'new-yorker': 'newyorker.com',
  atlantic: 'theatlantic.com', wired: 'wired.com',
};
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function windowFor(date = new Date()) {
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  // Seven Beijing calendar dates, including the execution date.
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  return { start, end };
}
export function issuesInWindow(issues, { start, end }) {
  return issues.filter(i => i.issueDate >= start && i.issueDate <= end)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || a.id.localeCompare(b.id));
}
export function sourceURL(value, publicationKey) {
  const u = new URL(value);
  const domain = domains[publicationKey];
  if (u.protocol !== 'https:' || u.username || u.password || !domain ||
      !(u.hostname === domain || u.hostname === `www.${domain}`) || u.pathname.length < 8) {
    throw new Error('Article source must be an HTTPS article URL on its publisher domain.');
  }
  u.hash = ''; u.search = '';
  return u.href;
}
const string = { type: 'string' };
const object = properties => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: string };
export const noteSchema = object({
  chineseTitle: string, question: string, overview: string,
  quotation: object({ text: string, translation: string }),
  expressions: { type: 'array', minItems: 1, maxItems: 3, items: object({
    expression: string, meaning: string, authorTechnique: string,
    grade: { type: 'string', enum: ['direct', 'optional', 'partial', 'reading-only'] },
    ieltsAdvice: string, alternative: string,
    collocations: { ...strings, minItems: 3, maxItems: 3 },
    examples: { ...strings, minItems: 2, maxItems: 2 },
  }) },
  arguments: { type: 'array', minItems: 2, maxItems: 3, items: object({ heading: string, commentary: string, logic: string }) },
  criticalReading: string, conclusion: string,
});
export const auditSchema = object({ approved: { type: 'boolean' }, reasons: strings });
export const words = text => text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) ?? [];
const tokens = text => words(text).map(x => x.toLowerCase().replaceAll('’', "'"));
function textValues(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(textValues);
}
export function assertPrivateSafe(text) {
  if (/(?:\/home\/|\/Users\/|\.env(?:\b|\.)|TYPESAFE_API_KEY|gh[pousr]_[A-Za-z0-9]{20}|github_pat_|sk-[A-Za-z0-9]{20}|-----BEGIN .*PRIVATE KEY|Bearer\s+\S{12})/i.test(text)) {
    throw new Error('Public output contains a private path or a credential-like value.');
  }
  // Disallow injected HTML, embedded media, Markdown links, and Markdown structure
  // inside generated text. Trusted rendering adds the publisher link itself.
  if (/<\/?[A-Za-z][^>]*>|!\[|\]\(|https?:\/\/|^\s*(?:#{1,6}\s|---\s*$)/m.test(text)) {
    throw new Error('Generated content contains unapproved links, HTML, or structural markup.');
  }
}
export function validateNote(note, article) {
  const all = textValues(note);
  all.forEach(assertPrivateSafe);
  if (all.some(x => !x.trim() || x.length > 1800)) throw new Error('Empty or oversized note field.');
  if (note.overview.length > 300 || note.quotation.translation.length > 200 ||
      note.expressions.length < 1 || note.expressions.length > 3 ||
      note.arguments.length < 2 || note.arguments.length > 3) throw new Error('Public teaching-note size limits failed.');
  const source = article.paragraphs.join('\n\n');
  if (!source.includes(note.quotation.text)) throw new Error('Quotation is not an exact source fragment.');
  const quoteWords = words(note.quotation.text).length;
  const expressionWords = note.expressions.reduce((n, e) => n + words(e.expression).length, 0);
  if (quoteWords < 1 || quoteWords > 20 || quoteWords + expressionWords > 25) {
    throw new Error('Quotation plus expression budget exceeds 25 source words.');
  }
  for (const e of note.expressions) {
    if (!source.toLowerCase().includes(e.expression.toLowerCase()) || words(e.expression).length > 3 ||
        e.collocations.length !== 3 || e.examples.length !== 2 ||
        !['direct', 'optional', 'partial', 'reading-only'].includes(e.grade)) {
      throw new Error('Expression, register grade, or original teaching examples are invalid.');
    }
  }
  // Catch undeclared English excerpts. Semantic review separately checks Chinese
  // translation and whether commentary substitutes for the article.
  const sourceWords = tokens(source);
  const grams = new Set(sourceWords.slice(0, -5).map((_, i) => sourceWords.slice(i, i + 6).join(' ')));
  const commentary = { ...note, quotation: { translation: note.quotation.translation },
    expressions: note.expressions.map(({ expression, ...rest }) => rest) };
  for (const value of textValues(commentary)) {
    const w = tokens(value);
    if (w.slice(0, -5).some((_, i) => grams.has(w.slice(i, i + 6).join(' ')))) {
      throw new Error('Undeclared source quotation detected in teaching commentary.');
    }
  }
  if (JSON.stringify(note).length > 18000 ||
      note.arguments.filter(a => a.logic.includes('→')).length < 2) {
    throw new Error('Teaching commentary is too long or lacks two argument diagrams.');
  }
  return { quoteWords, expressionWords };
}
const clean = value => value.replace(/\r/g, '').trim();
const gradeLabel = {
  direct: '✓✓ 直接迁移', optional: '✓ 可迁移但不必常用',
  partial: '✧ 部分迁移', 'reading-only': '⚠️ 只读不迁',
};
export function renderNote(note, metadata) {
  const q = t => t.split('\n').map(line => `> ${line}`).join('\n');
  const lines = [
    '---', 'header: IELTS Weekly Readings · 公开节选讲解',
    `footer: ${metadata.issueDate} · IELTS 阅读学习`, '---', '',
    '# ★ 外刊 · 公开节选精读 ★', '', `**${clean(metadata.title)}**`, '',
    `**${clean(note.chineseTitle)}**`, '',
    `${metadata.publication}｜${metadata.author || '作者未标注'}｜期号 ${metadata.issueDate}`, '',
    `[文章来源](${metadata.sourceUrl})`, '',
    '本讲义使用 intensive-reading 的外刊分析方法，采用公开节选版本。内容为原创总结与教学讲解，仅翻译下方短引文；完整原文请在出版方阅读。期号是筛选日期依据，未据此推定单篇文章发表日。', '',
    '---', '', '> ### 【 导读 · Lead-in 】', '>', q(`**${note.question}**\n\n${note.overview}`), '',
    '## ◆ 短引文｜观察作者怎样推进观点', '', `**En:** ${note.quotation.text}`, '',
    `> **译:** ${note.quotation.translation}`, '', '### ✦ 值得学习的表达', '',
    ...note.expressions.map(e => `- **${e.expression}** —— ${e.meaning}`), '', '### 📖 词汇注释', '',
  ];
  for (const [i, e] of note.expressions.entries()) lines.push(
    `**▶ ${i + 1}. ${e.expression}**`, '', `语境义：${e.meaning}`, '',
    '**▶ 外刊写作赏析**', '', e.authorTechnique, '',
    `**▶ 🎓 IELTS 使用提醒｜${gradeLabel[e.grade]}**`, '', e.ieltsAdvice, '',
    `替代或同义辨析：${e.alternative}`, '', '搭配家族（原创教学搭配）：', '',
    ...e.collocations.map(x => `- ${x}`), '', '原创例句（不是原文句子）：', '',
    ...e.examples.map(x => `- ${x}`), '',
  );
  for (const a of note.arguments) lines.push('> ### 📖 精读', '>', q(`**${a.heading}**\n\n${a.commentary}\n\n${a.logic}`), '');
  lines.push('## 批判性阅读', '', note.criticalReading, '',
    '## 【 写在最后 · Epilogue & Reflection 】', '', note.conclusion, '',
    '这份公开讲义不按原文段落逐一复述，也不提供全文或全文译文。', '');
  return `${lines.join('\n')}\n`;
}
export function publicMetadata(article, issue, sourceUrl, analysis) {
  const safe = value => { assertPrivateSafe(value); return value; };
  return { articleId: article.id, title: safe(article.title), author: safe(article.author),
    publication: safe(article.publication), issueDate: issue.issueDate, sourceUrl,
    decision: analysis.decision, compositeScore: analysis.compositeScore,
    confidence: analysis.averageConfidence, topic: analysis.topic.value,
    difficulty: analysis.difficulty.value, policy: POLICY };
}
