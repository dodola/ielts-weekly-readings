import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { embeddedPublisherLink, newYorkerContentsLinks } from '../scripts/publisher-links.mjs';
const require = createRequire(path.join(process.env.IELTS_CURATOR_PROJECT ?? '/home/dodola/ai_project/ielts-reading-curator', 'package.json'));
const { load } = require('cheerio');

test('publisher extraction includes explicit Calibre download provenance but never guesses from cited body links', () => {
  const url = 'https://www.wired.com/story/verified-article/';
  assert.equal(embeddedPublisherLink(load(`<a href="https://www.wired.com/story/cited-article/">Citation</a><a rel="calibre-downloaded-from" href="${url}">source</a>`), 'wired'), url);
  assert.equal(embeddedPublisherLink(load('<a href="https://www.wired.com/story/cited-article/">Citation</a>'), 'wired'), null);
  assert.equal(embeddedPublisherLink(load(`<a rel="calibre-downloaded-from" href="${url}">source</a><link rel="canonical" href="https://www.wired.com/story/different-source/">`), 'wired'), null);
  assert.equal(embeddedPublisherLink(load('<a rel="calibre-downloaded-from" href="https://evil.example/story/verified-article/">source</a>'), 'wired'), null);
});
test('New Yorker recovery requires exact title, same-card author, issue and unique official URL', () => {
  const issue = { issueDate: '2026-09-21' }, article = { id: 'sample', title: 'A Proper Title', author: 'By Jane Author' };
  const card = (slug, title = article.title, author = 'Jane Author', date = '2026/09/21') => `<article><a href="/magazine/${date}/${slug}">${title}</a><p>By ${author}</p></article>`;
  assert.equal(newYorkerContentsLinks(load(card('real-url')), issue, [article]).sample.url, 'https://www.newyorker.com/magazine/2026/09/21/real-url');
  for (const html of [card('real-url', 'Different Title'), card('real-url', article.title, 'Wrong Author'),
    card('real-url', article.title, 'Jane Author', '2026/09/14'), card('one-url') + card('two-url')]) {
    assert.deepEqual(newYorkerContentsLinks(load(html), issue, [article]), {});
  }
});
