import test from 'node:test';
import assert from 'node:assert/strict';
import { readerScope } from '../scripts/reader-scope.mjs';
const analysis = { topic: { value: 'technology' }, difficulty: { value: 'target_b2_c1' }, signals: { generalAudienceAccessible: 0.9 } };
const article = title => ({ title, paragraphs: ['This article explains the effects on ordinary people.'], wordCount: 500 });

test('specialist programming and mathematical methods are excluded even with a high existing score', () => {
  for (const title of ['Python Is So Slow. Can Julia Solve the Two-Language Problem?', 'Ruby Is Not a Serious Programming Language',
    'Programming in Assembly Is Brutal, Beautiful, and Maybe Even a Path to Better AI', 'Numerical Methods for Differential Equations']) {
    assert.equal(readerScope(article(title), { ...analysis, compositeScore: 99 }).eligible, false, title);
  }
  assert.equal(readerScope({ title: 'Technical notebook', wordCount: 120, paragraphs: ['Bytecode compiler pointers type inference eigenvalues numerical integration.'] }, analysis).eligible, false);
});

test('public-interest technology, science, culture and human news remain eligible', () => {
  for (const [title, topic] of [['Can the AI arms race be stopped?', 'technology'], ['Chinese EV Batteries Are Eating the World', 'work_economy'],
    ['You’ve Never Heard of China’s Greatest Sci-Fi Novel', 'culture_media'], ['How to Protect Democracy', 'politics_policy'],
    ['Bring Back the Blue-Book Exam', 'education'], ['Gene editing and public ethics', 'science']]) {
    assert.equal(readerScope(article(title), { ...analysis, topic: { value: topic } }).eligible, true, title);
  }
  assert.equal(readerScope(article('I’m a Normie. Can Normies Really Vibe Code?'), analysis).eligible, true);
  assert.equal(readerScope(article('Opaque laboratory methods'), { ...analysis, difficulty: { value: 'too_specialist' } }).eligible, false);
  assert.equal(readerScope(article('Specialist audience'), { ...analysis, signals: { generalAudienceAccessible: 0.4 } }).eligible, false);
  assert.equal(readerScope(article('Unknown accessibility'), { ...analysis, signals: {} }).eligible, false);
});
