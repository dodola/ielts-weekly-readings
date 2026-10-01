import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedSelection, publicationCounts, PUBLICATIONS } from '../scripts/selection.mjs';

const row = (key, n, score = 90) => ({ issue: { publicationKey: key, id: `${key}-issue`, issueDate: '2026-09-02' },
  article: { id: `article-${n}`, wordCount: 1000 }, analysis: { decision: 'selected', compositeScore: score, averageConfidence: .8 },
  sourceUrl: 'https://publisher.example/article' });
test('balanced selection guarantees available publication coverage and ten-guide cap despite unequal global scores', () => {
  const rows = PUBLICATIONS.flatMap((key, p) => Array.from({ length: 15 }, (_, i) => row(key, i, 99 - p * 7)));
  const chosen = balancedSelection(rows, 10), counts = Object.values(publicationCounts(chosen));
  assert.equal(chosen.length, 10); assert.equal(Math.min(...counts), 2); assert.equal(Math.max(...counts), 3);
  assert.deepEqual(balancedSelection([...rows].reverse(), 10), chosen);
});
test('selection never invents coverage for rejected, unlinked or exhausted publications', () => {
  const a = row('economist', 1), b = row('wired', 1), rejected = row('atlantic', 1), noLink = row('new-yorker', 1);
  rejected.analysis.decision = 'rejected'; noLink.sourceUrl = null;
  assert.deepEqual(balancedSelection([a, a, b, rejected, noLink], 10), [a, b]);
  assert.equal(publicationCounts([a, b]).atlantic, 0);
  assert.throws(() => balancedSelection([a], 11));
});
test('quality ties use confidence, reading length and stable identity instead of input order', () => {
  const a = row('wired', 1), b = row('wired', 2), c = row('atlantic', 1);
  b.article.wordCount = 700;
  assert.equal(balancedSelection([a, b], 1)[0], b);
  a.analysis.averageConfidence = .9;
  assert.equal(balancedSelection([b, a], 1)[0], a);
  assert.equal(balancedSelection([c, a, b], 1)[0], a);
});
