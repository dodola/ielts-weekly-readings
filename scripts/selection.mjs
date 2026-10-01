export const PUBLICATIONS = ['economist', 'new-yorker', 'atlantic', 'wired'];
export const PUBLICATION_NAMES = { economist: 'The Economist', 'new-yorker': 'The New Yorker', atlantic: 'The Atlantic', wired: 'Wired' };
const identity = t => `${t.issue.id}/${t.article.id}`;
export function compareQuality(a, b) {
  return b.analysis.compositeScore - a.analysis.compositeScore ||
    (b.analysis.averageConfidence ?? 0) - (a.analysis.averageConfidence ?? 0) ||
    (a.article.wordCount ?? Infinity) - (b.article.wordCount ?? Infinity) ||
    b.issue.issueDate.localeCompare(a.issue.issueDate) || identity(a).localeCompare(identity(b));
}

// Only eligible, linked candidates enter this allocator. Equal representation
// takes priority between publications; quality orders their available heads.
export function balancedSelection(candidates, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Guide limit must be 1–10.');
  const queues = new Map(), seen = new Set(), counts = new Map();
  for (const t of [...candidates].sort(compareQuality)) {
    if (t.analysis.decision !== 'selected' || !t.sourceUrl || seen.has(identity(t))) continue;
    seen.add(identity(t));
    const key = t.issue.publicationKey;
    if (!queues.has(key)) { queues.set(key, []); counts.set(key, 0); }
    queues.get(key).push(t);
  }
  const result = [];
  while (result.length < limit) {
    const available = [...queues.keys()].filter(key => queues.get(key).length);
    if (!available.length) break;
    const floor = Math.min(...available.map(key => counts.get(key)));
    const key = available.filter(key => counts.get(key) === floor)
      .sort((a, b) => compareQuality(queues.get(a)[0], queues.get(b)[0]) || a.localeCompare(b))[0];
    result.push(queues.get(key).shift()); counts.set(key, counts.get(key) + 1);
  }
  return result;
}

export function publicationCounts(rows) {
  const counts = Object.fromEntries(PUBLICATIONS.map(key => [key, 0]));
  for (const row of rows) counts[row.issue.publicationKey] = (counts[row.issue.publicationKey] ?? 0) + 1;
  return counts;
}
