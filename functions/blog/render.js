'use strict';

const MarkdownIt = require('markdown-it');
const { SITE, APP, AUTHOR } = require('./config');
const { escapeHtml, trimToLength } = require('./text');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:\/\//i.test(href) && !href.startsWith(SITE)) {
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const INTENT_LABEL = {
  'how-to': 'How-to',
  compare: 'Comparison',
  explain: 'Explainer',
};

function renderMarkdown(markdown) {
  const html = md.render(String(markdown || ''));
  return html.replace(/(<[^>]+>)|\[(\d{1,2})\]/g, (match, tag, number) => {
    if (tag) return tag;
    return `<sup class="cite"><a href="#source-${number}" aria-label="Source ${number}">${number}</a></sup>`;
  });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function isoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function absolute(value, fallback = `${SITE}/images/og-card.png`) {
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return `${SITE}${value.startsWith('/') ? '' : '/'}${value}`;
}

function head({
  title,
  description,
  canonical,
  image,
  type = 'website',
  published,
  modified,
  author,
  robots = 'index, follow, max-image-preview:large',
  json,
  extra = '',
}) {
  const ogImage = absolute(image);
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="theme-color" content="#FAF9F7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0F0E13" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${escapeHtml(canonical)}">

  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/logo.png">

  <meta property="og:site_name" content="GitSyn">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  ${published ? `<meta property="article:published_time" content="${escapeHtml(published)}">` : ''}
  ${modified ? `<meta property="article:modified_time" content="${escapeHtml(modified)}">` : ''}
  ${author ? `<meta property="article:author" content="${escapeHtml(author)}">` : ''}

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/blog.css">
  <link rel="alternate" type="application/rss+xml" title="GitSyn Writing" href="${SITE}/blog/rss.xml">
  <link rel="alternate" type="text/plain" title="GitSyn blog for language models" href="${SITE}/blog/llms.txt">
  ${extra}
  ${json ? `<script type="application/ld+json">${jsonLd(json)}</script>` : ''}
</head>`;
}

function nav() {
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="nav" id="nav">
  <div class="container nav__inner">
    <a href="/" class="brand" aria-label="GitSyn home">
      <img src="/logo.png" alt="" width="28" height="28">
      <span>GitSyn</span>
    </a>
    <nav class="nav__links" aria-label="Primary">
      <a href="/blog">Writing</a>
      <a href="/#makers">Who it’s for</a>
      <a href="/#how">How it works</a>
      <a href="/#syn">Syn</a>
    </nav>
    <div class="nav__actions">
      <a href="${APP}" class="btn btn--primary">Open GitSyn</a>
    </div>
    <a href="${APP}" class="btn btn--primary nav__mobile">Open</a>
  </div>
</header>`;
}

function footer() {
  return `<footer class="footer">
  <div class="container">
    <div class="footer__grid">
      <div class="footer__about">
        <a href="/" class="brand"><img src="/logo.png" alt="" width="28" height="28"><span>GitSyn</span></a>
        <p>A home for creative work while it’s being made.</p>
      </div>
      <nav aria-label="Writing">
        <h2>Writing</h2>
        <ul>
          <li><a href="/blog">All posts</a></li>
          <li><a href="/blog/rss.xml">RSS feed</a></li>
          <li><a href="/blog/llms.txt">For AI assistants</a></li>
          <li><a href="/llms.txt">About GitSyn for AI</a></li>
        </ul>
      </nav>
      <nav aria-label="Product">
        <h2>Product</h2>
        <ul>
          <li><a href="${APP}">Open GitSyn</a></li>
          <li><a href="/#makers">Who it’s for</a></li>
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#faq">Questions</a></li>
        </ul>
      </nav>
      <nav aria-label="Policies">
        <h2>Policies</h2>
        <ul>
          <li><a href="/terms">Terms of Service</a></li>
          <li><a href="/privacy">Privacy Policy</a></li>
          <li><a href="/ai-policy">AI policy</a></li>
          <li><a href="/community-guidelines">Community guidelines</a></li>
        </ul>
      </nav>
    </div>
    <div class="footer__base">
      <span>© ${new Date().getUTCFullYear()} GitSyn</span>
      <span>Notes for people who make things.</span>
    </div>
  </div>
</footer>`;
}

function shell({ headHtml, main, bodyClass = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
${headHtml}
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${nav()}
${main}
${footer()}
</body>
</html>`;
}

function organizationGraph() {
  return [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'GitSyn',
      url: `${SITE}/`,
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.png`, width: 512, height: 512 },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      name: 'GitSyn',
      url: `${SITE}/`,
      inLanguage: 'en',
      publisher: { '@id': `${SITE}/#organization` },
    },
  ];
}

function postGraph(post, author, canonical) {
  const authorName = author?.name || AUTHOR.name;
  const person = {
    '@type': 'Person',
    '@id': `${SITE}/#author-${AUTHOR.slug}`,
    name: authorName,
    roleName: author?.role || AUTHOR.role,
    url: author?.site_url || SITE,
    image: absolute(author?.photo_url || AUTHOR.photo),
    sameAs: [author?.github_url, author?.x_url].filter(Boolean),
  };
  const graph = [
    ...organizationGraph(),
    person,
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GitSyn', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Writing', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
      ],
    },
    {
      '@type': 'Article',
      '@id': `${canonical}#article`,
      headline: post.title,
      description: post.meta_description || post.excerpt || post.title,
      image: [absolute(post.hero_image_url)],
      datePublished: isoDate(post.published_at),
      dateModified: isoDate(post.updated_at || post.published_at),
      inLanguage: 'en',
      author: { '@id': person['@id'] },
      publisher: { '@id': `${SITE}/#organization` },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      isPartOf: { '@id': `${SITE}/#website` },
      articleSection: 'Writing',
    },
  ];
  if (Array.isArray(post.faq) && post.faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: post.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function authorBox(author) {
  const name = author?.name || AUTHOR.name;
  const role = author?.role || AUTHOR.role;
  const photo = absolute(author?.photo_url || AUTHOR.photo);
  const links = [
    author?.github_url && `<a href="${escapeHtml(author.github_url)}" rel="me noopener">GitHub</a>`,
    author?.x_url && `<a href="${escapeHtml(author.x_url)}" rel="me noopener">X</a>`,
    `<a href="${escapeHtml(author?.site_url || SITE)}">GitSyn</a>`,
  ].filter(Boolean);
  return `<aside class="author-box" aria-label="About the author">
  <img class="author-box__photo" src="${escapeHtml(photo)}" alt="Portrait of ${escapeHtml(name)}" width="72" height="72" loading="lazy">
  <div class="author-box__text">
    <p class="author-box__name">${escapeHtml(name)}</p>
    <p class="author-box__role">${escapeHtml(role)}</p>
    <p class="author-box__bio">${escapeHtml(author?.bio || 'Writes about making creative work and putting it in front of people.')}</p>
    <p class="author-box__links">${links.join(' · ')}</p>
  </div>
</aside>`;
}

function sourceList(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  const items = sources.map((source, index) => {
    const url = escapeHtml(source.url);
    let host = '';
    try {
      host = new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    return `<li id="source-${index + 1}"><a href="${url}" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>${host ? `<span class="sources__host">${escapeHtml(host)}</span>` : ''}</li>`;
  }).join('');
  return `<section class="sources" aria-labelledby="sources-title">
  <h2 id="sources-title">Sources</h2>
  <ol>${items}</ol>
</section>`;
}

function faqList(faq) {
  if (!Array.isArray(faq) || !faq.length) return '';
  const items = faq.map((item) => `<div class="faq__item">
    <h3>${escapeHtml(item.question)}</h3>
    <div class="faq__answer">${renderMarkdown(item.answer)}</div>
  </div>`).join('');
  return `<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Common questions</h2>
  ${items}
</section>`;
}

function relatedList(posts) {
  if (!Array.isArray(posts) || !posts.length) return '';
  const cards = posts.slice(0, 3).map((post) => `<article class="related__card">
    <p class="related__meta">${escapeHtml(INTENT_LABEL[post.intent] || 'Notes')}</p>
    <h3><a href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h3>
    ${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}
  </article>`).join('');
  return `<section class="related" aria-labelledby="related-title">
  <h2 id="related-title">Keep reading</h2>
  <div class="related__grid">${cards}</div>
</section>`;
}

function postCard(post) {
  const image = absolute(post.hero_image_url);
  const date = formatDate(post.published_at);
  return `<article class="post-card">
  <a class="post-card__media" href="/blog/${escapeHtml(post.slug)}" tabindex="-1" aria-hidden="true">
    <img src="${escapeHtml(image)}" alt="" width="1200" height="800" loading="lazy">
  </a>
  <div class="post-card__body">
    <p class="post-card__meta"><span class="chip">${escapeHtml(INTENT_LABEL[post.intent] || 'Notes')}</span>${date ? `<time datetime="${escapeHtml(isoDate(post.published_at))}">${escapeHtml(date)}</time>` : ''}<span>${post.reading_minutes || 1} min</span></p>
    <h2><a href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
    <p class="post-card__excerpt">${escapeHtml(post.excerpt || post.meta_description || '')}</p>
    <span class="post-card__more">Read<span aria-hidden="true"> →</span></span>
  </div>
</article>`;
}

function renderIndex({ posts, page = 1, perPage = 12 }) {
  const canonical = page > 1 ? `${SITE}/blog?page=${page}` : `${SITE}/blog`;
  const title = page > 1 ? `Writing — page ${page} — GitSyn` : 'Writing — GitSyn';
  const description = 'Practical answers about making creative work and putting it in front of people: writing, music, design, film, games, research and more.';
  const total = posts.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const slice = posts.slice((current - 1) * perPage, current * perPage);
  const cards = slice.map(postCard).join('');
  const pagination = pages > 1 ? `<nav class="pagination" aria-label="Pages">
    ${current > 1 ? `<a href="/blog${current - 1 === 1 ? '' : `?page=${current - 1}`}" rel="prev">Newer</a>` : '<span></span>'}
    <span>Page ${current} of ${pages}</span>
    ${current < pages ? `<a href="/blog?page=${current + 1}" rel="next">Older</a>` : '<span></span>'}
  </nav>` : '';

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      ...organizationGraph(),
      {
        '@type': 'CollectionPage',
        '@id': `${canonical}#page`,
        name: 'GitSyn Writing',
        url: canonical,
        description,
        isPartOf: { '@id': `${SITE}/#website` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: posts.slice(0, 50).map((post, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${SITE}/blog/${post.slug}`,
          })),
        },
      },
    ],
  };

  const headHtml = head({
    title,
    description,
    canonical,
    image: `${SITE}/images/og-card.png`,
    json: graph,
  });

  const empty = `<div class="blog-empty">
    <p>The first pieces are being written. Check back soon, or start something of your own.</p>
    <a class="btn btn--primary" href="${APP}">Open GitSyn</a>
  </div>`;

  const main = `<main id="main">
  <section class="blog-hero">
    <div class="container">
      <p class="eyebrow">Writing</p>
      <h1>Notes for people making things.</h1>
      <p class="lede">Straight answers about finishing work, sharing it before it is ready, and finding the people who care. No growth hacks, no listicles.</p>
    </div>
  </section>
  <section class="blog-list">
    <div class="container">
      ${cards ? `<div class="post-grid">${cards}</div>${pagination}` : empty}
    </div>
  </section>
</main>`;

  return shell({ headHtml, main });
}

function renderPost({ post, author, related, preview = false }) {
  const canonical = `${SITE}/blog/${post.slug}`;
  const hero = absolute(post.hero_image_url);
  const date = formatDate(post.published_at);
  const publishedIso = isoDate(post.published_at);
  const modifiedIso = isoDate(post.updated_at || post.published_at);
  const bodyHtml = renderMarkdown(post.body_md);
  const intent = INTENT_LABEL[post.intent] || 'Notes';
  const description = post.meta_description || post.excerpt || `${post.title} — practical notes from GitSyn.`;

  const headHtml = head({
    title: post.meta_title || post.title,
    description,
    canonical,
    image: hero,
    type: 'article',
    published: publishedIso,
    modified: modifiedIso,
    author: author?.name || AUTHOR.name,
    robots: preview ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
    json: postGraph(post, author, canonical),
  });

  const previewBanner = preview ? `<div class="preview-banner" role="status">Draft preview — this page is not public and is not linked from the blog.</div>` : '';

  const main = `<main id="main">
  ${previewBanner}
  <article class="post">
    <header class="post__head">
      <div class="container post__head-inner">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="/">GitSyn</a><span aria-hidden="true">/</span><a href="/blog">Writing</a>
        </nav>
        <p class="eyebrow">${escapeHtml(intent)}</p>
        <h1>${escapeHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="post__dek">${escapeHtml(post.excerpt)}</p>` : ''}
        <div class="byline">
          <img src="${escapeHtml(absolute(author?.photo_url || AUTHOR.photo))}" alt="" width="36" height="36" loading="lazy">
          <span class="byline__name">${escapeHtml(author?.name || AUTHOR.name)}</span>
          <span class="byline__meta">
            ${date ? `<span class="byline__sep" aria-hidden="true">·</span><time datetime="${escapeHtml(publishedIso)}">${escapeHtml(date)}</time>` : ''}
            <span class="byline__sep" aria-hidden="true">·</span>
            <span>${post.reading_minutes || 1} min read</span>
          </span>
        </div>
      </div>
    </header>

    <figure class="post__hero">
      <div class="container">
        <img src="${escapeHtml(hero)}" alt="${escapeHtml(post.hero_image_alt || post.title)}" width="1200" height="800" fetchpriority="high">
      </div>
    </figure>

    <div class="post__body container">
      <div class="prose">
        ${bodyHtml}
      </div>
      ${sourceList(post.sources)}
      ${faqList(post.faq)}
      ${authorBox(author)}
    </div>

    <div class="container">
      ${relatedList(related)}
    </div>
  </article>
</main>`;

  return shell({ headHtml, main, bodyClass: 'blog-post' });
}

function renderNotFound(path = '') {
  const headHtml = head({
    title: 'Page not found — GitSyn',
    description: 'That page is not here. The writing index is a good place to look next.',
    canonical: `${SITE}/blog`,
    robots: 'noindex, follow',
  });
  const main = `<main id="main" class="not-found">
  <div class="container">
    <p class="eyebrow">404</p>
    <h1>That page is not here.</h1>
    <p class="lede">It may have moved, or the link may be wrong. The writing index has everything we have published.</p>
    <p><a class="btn btn--primary" href="/blog">Go to Writing</a></p>
    ${path ? `<p class="not-found__path"><code>${escapeHtml(path)}</code></p>` : ''}
  </div>
</main>`;
  return shell({ headHtml, main });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rssXml(posts) {
  const items = posts.map((post) => {
    const url = `${SITE}/blog/${post.slug}`;
    return `<item>
  <title>${escapeXml(post.title)}</title>
  <link>${escapeXml(url)}</link>
  <guid isPermaLink="true">${escapeXml(url)}</guid>
  <pubDate>${new Date(post.published_at || Date.now()).toUTCString()}</pubDate>
  <description>${escapeXml(post.excerpt || post.meta_description || post.title)}</description>
  <author>noreply@gitsyn.cc (${escapeXml(AUTHOR.name)})</author>
</item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>GitSyn Writing</title>
  <link>${SITE}/blog</link>
  <description>Practical answers about making creative work and putting it in front of people.</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml"/>
  ${items}
</channel>
</rss>`;
}

function sitemapXml(posts) {
  const urls = [
    `<url><loc>${SITE}/blog</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
    ...posts.map((post) => {
      const lastmod = (post.updated_at || post.published_at || '').slice(0, 10)
        || new Date().toISOString().slice(0, 10);
      return `<url><loc>${escapeXml(`${SITE}/blog/${post.slug}`)}</loc><lastmod>${escapeXml(lastmod)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
    }),
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;
}

function llmsTxt(posts) {
  const lines = [
    '# GitSyn Writing',
    '',
    '> Practical answers to questions people ask while making creative work: writing, music, design, film, games, research and more. Every article is researched, cites its sources, and is written by GitSyn’s founder, Abubakr Dukuray.',
    '',
    `Canonical index: ${SITE}/blog`,
    `RSS: ${SITE}/blog/rss.xml`,
    `Sitemap: ${SITE}/blog-sitemap.xml`,
    `About GitSyn: ${SITE}/llms.txt`,
    '',
    '## Articles',
    '',
  ];
  if (!posts.length) {
    lines.push('- No articles have been published yet.');
  } else {
    for (const post of posts) {
      const summary = trimToLength(post.excerpt || post.meta_description || '', 180);
      lines.push(`- [${post.title}](${SITE}/blog/${post.slug})${summary ? `: ${summary}` : ''}`);
    }
  }
  lines.push(
    '',
    '## About the author',
    '',
    `${AUTHOR.name} is the founder of GitSyn. He writes about the unglamorous part of creative work: keeping a project moving, sharing it before it is finished, and getting it in front of people who care.`,
    '',
    `- GitHub: ${AUTHOR.github}`,
    `- X: ${AUTHOR.x}`,
    `- GitSyn: ${SITE}`,
    ''
  );
  return lines.join('\n');
}

module.exports = {
  renderIndex,
  renderPost,
  renderNotFound,
  rssXml,
  sitemapXml,
  llmsTxt,
  renderMarkdown,
  formatDate,
  escapeXml,
  INTENT_LABEL,
};
