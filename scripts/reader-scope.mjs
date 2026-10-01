export const READER_SCOPE = 'general-interest-no-specialist-v1';
const topics = new Set(['society', 'technology', 'culture_media', 'politics_policy', 'education', 'work_economy', 'environment', 'health', 'science']);
const explicit = /\b(?:programming languages?|two-language problem|programming in assembly|software engineering|compiler (?:design|optimization)|database internals|kernel (?:development|programming)|differential equations?|tensor calculus|numerical methods|proof of (?:a |the )?theorem|statistical (?:estimators|inference methods))\b/i;
const jargon = [ /\b(?:bytecode|opcodes?|assembly language)\b/gi, /\b(?:compilers?|just-in-time|JIT)\b/gi,
  /\b(?:garbage collection|memory allocation|pointers?)\b/gi, /\b(?:type inference|type systems?|multiple dispatch)\b/gi,
  /\b(?:Big[- ]O|computational complexity|asymptotic)\b/gi, /\b(?:eigenvalues?|eigenvectors?|Jacobians?)\b/gi,
  /\b(?:partial differential|matrix decomposition|numerical integration)\b/gi ];

export function readerScope(article, analysis) {
  const topic = analysis.topic?.value;
  if (!topics.has(topic)) return { eligible: false, reason: 'outside-general-interest-topics' };
  const heading = `${article.title ?? ''} ${article.dek ?? ''}`;
  if (explicit.test(heading)) return { eligible: false, reason: 'specialist-subject-in-title' };
  const text = (article.paragraphs ?? []).join('\n');
  const hits = jargon.map(regex => [...text.matchAll(regex)].length);
  const words = article.wordCount ?? text.split(/\s+/).length;
  if (hits.filter(n => n > 0).length >= 4 && hits.reduce((a, b) => a + b, 0) / Math.max(words, 1) >= 0.012) {
    return { eligible: false, reason: 'dense-unexplained-specialist-method-vocabulary' };
  }
  if (analysis.difficulty?.value === 'too_specialist') return { eligible: false, reason: 'cached-specialist-difficulty' };
  const accessible = analysis.signals?.generalAudienceAccessible;
  if (typeof accessible !== 'number' || accessible < 0.75) return { eligible: false, reason: 'insufficient-cached-general-audience-accessibility' };
  return { eligible: true, topic, generalAudienceAccessible: accessible };
}
