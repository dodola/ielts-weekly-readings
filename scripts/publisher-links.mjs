import { sourceURL } from './notes.mjs';

const normalized = s => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
export function embeddedPublisherLink($, publicationKey, supplied) {
  // Download provenance is distinct from cited links in the article body.
  const raw = [supplied, $('link[rel="canonical"]').attr('href'), $('meta[property="og:url"]').attr('content'),
    ...$('.link_navbar a[href], a[rel~="calibre-downloaded-from"]').map((_, e) => $(e).attr('href')).get()].filter(Boolean);
  const links = [...new Set(raw.flatMap(url => { try { return [sourceURL(url, publicationKey)]; } catch { return []; } }))];
  return links.length === 1 ? links[0] : null;
}

export function newYorkerContentsLinks($, issue, articles) {
  const matched = {};
  for (const article of articles) {
    const author = normalized(article.author ?? '').replace(/^by\s+/, '');
    if (!author) continue;
    const links = new Set();
    for (const e of $('a[href]').toArray()) {
      if (normalized($(e).text()) !== normalized(article.title)) continue;
      let url;
      try { url = sourceURL(new URL($(e).attr('href'), 'https://www.newyorker.com').href, 'new-yorker'); } catch { continue; }
      if (!new URL(url).pathname.startsWith(`/magazine/${issue.issueDate.replaceAll('-', '/')}/`)) continue;
      // A title and author must occur in the same individual article card.
      const cards = $(e).parents('.summary-item, article').toArray();
      if (!cards.some(card => normalized($(card).text()).includes(`by ${author}`))) continue;
      links.add(url);
    }
    if (links.size === 1) matched[article.id] = { url: [...links][0], title: article.title, author: article.author };
  }
  return matched;
}
