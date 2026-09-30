import test from 'node:test';
import assert from 'node:assert/strict';
import { windowFor, issuesInWindow, sourceURL, validateNote, renderNote, assertPrivateSafe, assertPrivateSnapshot } from '../scripts/notes.mjs';

export const article = { paragraphs: [
  'Public libraries provide access to information. They help residents examine evidence before reaching conclusions. A successful programme may require sustained investment from local government.'
] };
export const note = {
  chineseTitle: '公共图书馆与信息判断', question: '获得信息之后，怎样判断信息是否可靠？',
  overview: '这里选择信息获取与判断之间的关系作为阅读切口。讲解聚焦一个表达与两种论证动作，帮助读者在其他材料中识别证据的作用。',
  quotation: { text: 'provide access to information', translation: '提供获取信息的途径' },
  expressions: [{ expression: 'access', meaning: '使用资源的机会或途径',
    authorTechnique: '这个名词把注意力放在资源能否被实际使用，适合讨论公共服务的有效性。',
    grade: 'direct', ieltsAdvice: '讨论教育公平时可以使用；注意名词后接 to，通常不加不定冠词。',
    alternative: 'availability 表示资源是否存在，access 更关注人能否使用。',
    collocations: ['improve access to education', 'equal access to services', 'digital access'],
    examples: ['Better transport can improve access to training.', 'Equal access to healthcare matters in rural areas.'] }],
  arguments: [{ heading: '把资源供给和实际使用连接起来', commentary: '阅读公共政策材料时，可以区分投入、服务和效果这三个层次。只发现资源存在，还不足以证明效果已经出现。',
    logic: '资源投入 → 使用机会 → 可能的学习效果' },
  { heading: '证据怎样支持结论', commentary: '作者从资源用途转向判断能力时，读者应检查中间有没有解释机制。原因链中的一个环节薄弱，结论的确定性就要降低。',
    logic: '获得材料 → 比较证据 → 形成判断' }],
  criticalReading: '其他因素也可能影响学习结果，例如教学质量。相关性不能直接证明因果关系；比较时要考虑群体原有差异。',
  conclusion: '阅读后的追问是：什么证据可以说明使用机会转化成了判断能力？带着这个问题重新阅读，可以帮助区分主张与支持主张的理由。',
};
export const metadata = { title: 'Learning from public services', author: 'Teaching fixture',
  publication: 'Original test material', issueDate: '2026-09-30', sourceUrl: 'https://www.economist.com/example/testing' };

test('Beijing week boundary crosses months and rejects future/old issues', () => {
  assert.deepEqual(windowFor(new Date('2026-09-30T17:00:00Z')), { start: '2026-09-25', end: '2026-10-01' });
  const issues = ['2026-09-24', '2026-09-25', '2026-10-01', '2026-10-02'].map((issueDate, i) => ({ issueDate, id: String(i) }));
  assert.deepEqual(issuesInWindow(issues, windowFor(new Date('2026-09-30T17:00:00Z'))).map(i => i.issueDate), ['2026-10-01', '2026-09-25']);
});
test('publisher URLs cannot use a spoofed domain, credentials, HTTP or homepage', () => {
  for (const url of ['https://economist.com.evil.test/news/2026', 'https://person:password@economist.com/news/2026', 'http://economist.com/news/2026', 'https://economist.com/']) {
    assert.throws(() => sourceURL(url, 'economist'));
  }
  assert.equal(sourceURL('https://www.economist.com/science/2026/09/30/test?tracking=a#section', 'economist'),
    'https://www.economist.com/science/2026/09/30/test');
});
test('only exact limited excerpts and original teaching examples pass', () => {
  assert.deepEqual(validateNote(note, article), { quoteWords: 4, expressionWords: 1 });
  const copied = structuredClone(note); copied.arguments[0].commentary = article.paragraphs[0];
  assert.throws(() => validateNote(copied, article), /Undeclared source quotation/);
  const fake = structuredClone(note); fake.quotation.text = 'invented quoted material';
  assert.throws(() => validateNote(fake, article), /exact source/);
  const full = structuredClone(note); full.quotation.text = article.paragraphs[0];
  assert.throws(() => validateNote(full, article), /budget/);
});
test('private paths, credentials and injected HTML cannot enter public notes', () => {
  for (const s of ['/home/alice/.env.local', 'TYPESAFE_API_KEY=secret', '<script>alert(1)</script>', '[a](https://evil.test)']) assert.throws(() => assertPrivateSafe(s));
});
test('public renderer uses skill roles and labels examples as original', () => {
  const md = renderNote(note, metadata);
  for (const role of ['# ★', '【 导读 · Lead-in 】', '**En:**', '**译:**', '**▶ 1.', '### 📖 精读', '原创例句', '公开节选版本']) assert.ok(md.includes(role));
  assert.equal((md.match(/provide access to information/g) ?? []).length, 1);
});
test('original article publication refuses public, unknown or mismatched destinations', () => {
  const name = 'dodola/ielts-reading-library';
  assert.doesNotThrow(() => assertPrivateSnapshot(name, { full_name: name, private: true }));
  for (const snapshot of [{ full_name: name, private: false }, { full_name: name }, { full_name: 'other/repository', private: true }]) {
    assert.throws(() => assertPrivateSnapshot(name, snapshot), /PRIVATE destination/);
  }
});
