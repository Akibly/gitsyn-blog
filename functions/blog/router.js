'use strict';

const db = require('./db');
const render = require('./render');
const { verifyPreviewToken } = require('./guard');
const { SITE } = require('./config');

const CACHE_PAGE = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400';
const CACHE_FEED = 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400';

function pathOf(req) {
  const raw = req.originalUrl || req.url || '/';
  const path = raw.split('?')[0].replace(/\/+$/, '');
  return path || '/';
}

function pageParam(req) {
  const value = Number.parseInt((req.query && req.query.page) || '1', 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createHandler({ serviceKey } = {}) {
  return async function blogHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('allow', 'GET, HEAD').status(405).type('text/plain').send('Method not allowed');
      return;
    }

    const path = pathOf(req);
    const client = db.serviceClient(serviceKey);

    try {
      if (path === '/blog') {
        const posts = await db.publishedPosts(client, 100);
        const html = render.renderIndex({ posts, page: pageParam(req) });
        res.set('cache-control', CACHE_PAGE).status(200).type('html').send(html);
        return;
      }

      if (path === '/blog-sitemap.xml') {
        const posts = await db.allPostsForSitemap(client);
        res.set('cache-control', CACHE_FEED).status(200).type('application/xml').send(render.sitemapXml(posts));
        return;
      }

      if (path === '/blog/rss.xml' || path === '/blog/feed.xml') {
        const posts = await db.publishedPosts(client, 30);
        res.set('cache-control', CACHE_FEED).status(200).type('application/rss+xml').send(render.rssXml(posts));
        return;
      }

      if (path === '/blog/llms.txt') {
        const posts = await db.publishedPosts(client, 200);
        res.set('cache-control', CACHE_FEED).status(200).type('text/plain').send(render.llmsTxt(posts));
        return;
      }

      const preview = /^\/blog\/preview\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
      if (preview) {
        const slug = preview[1];
        const token = (req.query && req.query.token) || '';
        if (!verifyPreviewToken(slug, token, process.env.CRON_SECRET)) {
          res.set('cache-control', 'no-store').status(404).type('html').send(render.renderNotFound(path));
          return;
        }
        const post = await db.postBySlug(client, slug, { includeDrafts: true });
        if (!post) {
          res.set('cache-control', 'no-store').status(404).type('html').send(render.renderNotFound(path));
          return;
        }
        const related = await db.relatedPosts(client, slug, 3).catch(() => []);
        res.set('cache-control', 'no-store').status(200).type('html').send(render.renderPost({
          post,
          author: post.blog_authors,
          related,
          preview: true,
        }));
        return;
      }

      const match = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
      if (match) {
        const slug = match[1];
        const post = await db.postBySlug(client, slug);
        if (!post) {
          res.set('cache-control', 'no-cache').status(404).type('html').send(render.renderNotFound(path));
          return;
        }
        const related = await db.relatedPosts(client, slug, 3).catch(() => []);
        res.set('cache-control', CACHE_PAGE).status(200).type('html').send(render.renderPost({
          post,
          author: post.blog_authors,
          related,
        }));
        return;
      }

      res.set('cache-control', 'no-cache').status(404).type('html').send(render.renderNotFound(path));
    } catch (error) {
      console.error('blog render failed', path, error);
      res.set('cache-control', 'no-store').status(500).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The blog is having a minute — GitSyn</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/style.css"></head>
<body><main id="main" class="not-found"><div class="container">
<p class="eyebrow">500</p><h1>The page could not load.</h1>
<p class="lede">Something on our side failed. It is safe to try again in a minute.</p>
<p><a class="btn btn--primary" href="${SITE}/blog">Go to Writing</a></p>
</div></main></body></html>`);
    }
  };
}

module.exports = { createHandler };
