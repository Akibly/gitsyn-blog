'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/sample-post');
const render = require('./render');

const author = {
  name: 'Abubakr Dukuray',
  role: 'Founder, GitSyn',
  photo_url: 'https://gitsyn.cc/images/author-abubakr.png',
  bio: 'Builds GitSyn.',
  github_url: 'https://github.com/Akibly',
  x_url: 'https://x.com/abubakrdembad',
  site_url: 'https://gitsyn.cc',
};

function post(extra = {}) {
  return {
    ...structuredClone(fixture.post),
    published_at: '2026-10-24T08:00:00.000Z',
    updated_at: '2026-10-24T08:00:00.000Z',
    reading_minutes: 6,
    ...extra,
  };
}

function ldJson(html) {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'page has JSON-LD');
  return JSON.parse(match[1]);
}

test('markdown citations become source superscripts and external links are safe', () => {
  const html = render.renderMarkdown('A claim [2] and a [link](https://example.com/x).');
  assert.match(html, /<sup class="cite"><a href="#source-2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script/i);
});

test('a post page carries canonical, Article, FAQPage, sources and author', () => {
  const html = render.renderPost({ post: post(), author, related: [] });
  assert.match(html, /<link rel="canonical" href="https:\/\/gitsyn\.cc\/blog\/how-to-share-a-novel-chapter-by-chapter">/);
  const graph = ldJson(html);
  const types = graph['@graph'].map((item) => item['@type']);
  assert.ok(types.includes('Article'));
  assert.ok(types.includes('FAQPage'));
  assert.ok(types.includes('BreadcrumbList'));
  assert.match(html, /class="author-box"/);
  assert.match(html, /GitHub/);
  assert.match(html, /id="source-4"/);
  assert.match(html, /Common questions/);
  assert.match(html, /og:type" content="article"/);
  assert.match(html, /2026-10-24T08:00:00.000Z/);
});

test('draft preview is noindex and shows a banner', () => {
  const html = render.renderPost({ post: post({ status: 'draft' }), author, related: [], preview: true });
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /Draft preview/);
});

test('titles and excerpts are escaped, not injected', () => {
  const html = render.renderPost({
    post: post({ title: 'Bad <script>alert(1)</script> title', meta_title: 'Bad <script>alert(1)</script> title' }),
    author,
    related: [],
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('the index lists published posts and paginates', () => {
  const posts = Array.from({ length: 14 }, (_, i) => post({
    slug: `post-${i + 1}`,
    title: `Post number ${i + 1}`,
    published_at: `2026-10-${String((i % 20) + 1).padStart(2, '0')}T08:00:00.000Z`,
  }));
  const first = render.renderIndex({ posts, page: 1 });
  assert.match(first, /Post number 1/);
  assert.doesNotMatch(first, /Post number 13/);
  assert.match(first, /Page 1 of 2/);
  const second = render.renderIndex({ posts, page: 2 });
  assert.match(second, /Post number 13/);
  const graph = ldJson(second);
  assert.ok(graph['@graph'].some((item) => item['@type'] === 'CollectionPage'));
});

test('the empty index is honest and links to the app', () => {
  const html = render.renderIndex({ posts: [] });
  assert.match(html, /first pieces are being written/);
  assert.match(html, /https:\/\/app\.gitsyn\.cc/);
});

test('RSS, sitemap and llms.txt expose the published set', () => {
  const posts = [post()];
  const rss = render.rssXml(posts);
  assert.match(rss, /<rss version="2.0"/);
  assert.match(rss, /https:\/\/gitsyn\.cc\/blog\/how-to-share-a-novel-chapter-by-chapter/);
  assert.match(rss, /GitSyn Writing/);

  const sitemap = render.sitemapXml(posts);
  assert.match(sitemap, /<loc>https:\/\/gitsyn\.cc\/blog<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/gitsyn\.cc\/blog\/how-to-share-a-novel-chapter-by-chapter<\/loc>/);

  const llms = render.llmsTxt(posts);
  assert.match(llms, /^# GitSyn Writing/);
  assert.match(llms, /\[How to Share Your Novel Chapter by Chapter/);
  assert.match(llms, /Abubakr Dukuray/);
});

test('the 404 page is styled and noindex', () => {
  const html = render.renderNotFound('/blog/gone');
  assert.match(html, /That page is not here/);
  assert.match(html, /noindex, follow/);
  assert.match(html, /\/blog\/gone/);
});
