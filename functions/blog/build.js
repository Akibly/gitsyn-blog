'use strict';

const fs = require('node:fs');
const path = require('node:path');

const db = require('./db');
const render = require('./render');

const PUBLIC_DIR = path.resolve(__dirname, '../../landing/public');
const BLOG_DIR = path.join(PUBLIC_DIR, 'blog');

function write(relativePath, contents) {
  const target = path.join(PUBLIC_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
  return target;
}

/**
 * Render the published blog to static files under landing/public, so Hosting
 * serves it on the Spark plan with no Cloud Functions. The page markup comes
 * from the same renderer the function used, so the output is identical.
 */
async function buildStaticBlog({ client } = {}) {
  const supabase = client || db.serviceClient();
  const posts = await db.publishedPosts(supabase, 100);
  const sitemapPosts = await db.allPostsForSitemap(supabase);
  const files = [];

  fs.rmSync(BLOG_DIR, { recursive: true, force: true });

  for (const summary of posts) {
    const post = await db.postBySlug(supabase, summary.slug);
    if (!post) continue;
    const related = await db.relatedPosts(supabase, post.slug, 3).catch(() => []);
    files.push(write(
      `blog/${post.slug}/index.html`,
      render.renderPost({ post, author: post.blog_authors, related })
    ));
  }

  const perPage = 12;
  const pages = Math.max(1, Math.ceil(posts.length / perPage));
  for (let page = 1; page <= pages; page += 1) {
    files.push(write(
      page === 1 ? 'blog/index.html' : `blog/page/${page}/index.html`,
      render.renderIndex({ posts, page, perPage })
    ));
  }

  files.push(write('blog-sitemap.xml', render.sitemapXml(sitemapPosts)));
  files.push(write('blog/rss.xml', render.rssXml(posts)));
  files.push(write('blog/llms.txt', render.llmsTxt(posts)));

  return { posts: posts.length, files: files.length };
}

module.exports = { buildStaticBlog, PUBLIC_DIR, BLOG_DIR };
