'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { SITE } = require('./config');

// Files the blog owns and regenerates on every run, so production's copy is
// never the source of truth for them.
const BLOG_OWNED = ['blog.css', 'blog-sitemap.xml'];

// The three files the blog legitimately appends to.
const ADDITIVE = ['robots.txt', 'sitemap.xml', 'llms.txt'];

// Hosting serves these from the site root but nothing links to them, so a crawl
// cannot find them. Losing robots.txt would drop every AI-crawler rule at once.
const MUST_SEED = ['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', 'favicon.png', 'logo.png'];

// Records every path production served when this list was captured. Anything on
// it is fetched by name, so a live page that nothing links to still survives a
// deploy from a tree that only contains the blog. Kept outside the deploy
// directory so it is never published as /live-files.txt.
const MANIFEST = 'live-files.txt';
const MANIFEST_PATH = path.join(__dirname, MANIFEST);

function normalise(rel) {
  return String(rel).split(path.sep).join('/');
}

function isBlogOwned(rel) {
  const p = normalise(rel);
  return p === 'blog' || p.startsWith('blog/') || BLOG_OWNED.includes(p);
}

// Hosting serves terms.html at /terms, so the URL drops the extension.
function urlFor(rel) {
  const p = normalise(rel);
  return p === 'index.html' ? '/' : `/${p.replace(/\.html$/, '')}`;
}

function fileFor(urlPath) {
  const p = decodeURIComponent(urlPath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) return 'index.html';
  return /\.[a-z0-9]{2,5}$/i.test(p) ? p : `${p}.html`;
}

function localFiles(publicDir) {
  return fs.readdirSync(publicDir, { recursive: true })
    .map(normalise)
    .filter((rel) => fs.statSync(path.join(publicDir, rel)).isFile());
}

const IMAGE_META = /^(?:og:image|og:image:secure_url|twitter:image|msapplication-[a-z-]*image)$/i;

// A page can point at an asset in five different ways, and a deploy that misses
// one of them deletes that asset. href/src miss og:image, which is how the social
// card is referenced on every policy page.
function linksIn(html, baseUrl) {
  const host = new URL(baseUrl).host;
  const out = new Set();
  const add = (raw) => {
    const value = String(raw || '').trim();
    if (!value || /^(?:mailto:|tel:|javascript:|data:|#)/i.test(value)) return;
    let url;
    try {
      url = new URL(value, baseUrl);
    } catch {
      return;
    }
    if (url.host !== host) return;
    out.add(url.pathname.replace(/\/+$/, '') || '/');
  };

  for (const match of html.matchAll(/(?:href|src|poster)="([^"]+)"/gi)) add(match[1]);
  for (const match of html.matchAll(/srcset="([^"]+)"/gi)) {
    for (const candidate of match[1].split(',')) add(candidate.trim().split(/\s+/)[0]);
  }
  for (const match of html.matchAll(/<meta[^>]+>/gi)) {
    const key = /(?:property|name)="([^"]+)"/i.exec(match[0]);
    const value = /content="([^"]+)"/i.exec(match[0]);
    if (key && value && IMAGE_META.test(key[1])) add(value[1]);
  }
  return [...out];
}

// Stylesheets resolve url() against their own location, not the page's.
function cssUrls(css, baseUrl) {
  const host = new URL(baseUrl).host;
  const out = new Set();
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const value = match[1].trim();
    if (/^(?:data:|#)/i.test(value)) continue;
    let url;
    try {
      url = new URL(value, baseUrl);
    } catch {
      continue;
    }
    if (url.host === host) out.add(url.pathname.replace(/\/+$/, '') || '/');
  }
  return [...out];
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function blogRelated(line) {
  return /blog/i.test(line) || /^##\s+Writing\s*$/.test(line);
}

/**
 * Walk production and reconcile it against the deploy directory.
 *
 * A Hosting deploy replaces the whole site, so a page that exists live but not
 * in the tree would be deleted — that already happened once with /early-access.
 * Files missing locally are copied down, which is strictly additive. Files that
 * exist on both sides but differ are reported as drift and left alone: the gate
 * fails on drift rather than picking a winner, because silently overwriting
 * either side loses somebody's work.
 */
async function reconcileProduction({ publicDir, origin = SITE, fetchImpl = fetch, manifestPath = MANIFEST_PATH } = {}) {
  const get = fetchImpl;
  const host = new URL(origin).host;
  const seen = new Set();
  const restored = [];
  const drift = [];
  const unreachable = [];

  const seeds = new Set(['/']);
  for (const name of MUST_SEED) seeds.add(`/${name}`);
  for (const rel of localFiles(publicDir)) {
    if (!isBlogOwned(rel)) {
      seeds.add(urlFor(rel));
      continue;
    }
    // The walk skips /blog, so a site asset only the blog links to would never
    // be found. Read the references out of the blog's own rendered pages.
    if (!/\.html$/i.test(rel)) continue;
    const html = fs.readFileSync(path.join(publicDir, rel), 'utf8');
    for (const link of linksIn(html, `${origin}/`)) {
      if (!isBlogOwned(fileFor(link))) seeds.add(link);
    }
  }
  try {
    for (const line of fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/)) {
      const p = line.trim();
      if (!p || p.startsWith('#') || isBlogOwned(p)) continue;
      seeds.add(p.startsWith('/') ? p : `/${p}`);
    }
  } catch { /* no manifest: the crawl and the must-seed list still cover us */ }
  try {
    const sitemap = await (await get(`${origin}/sitemap.xml`)).text();
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      try {
        const url = new URL(match[1]);
        if (url.host === host) seeds.add(url.pathname.replace(/\/+$/, '') || '/');
      } catch { /* an unusable sitemap entry is not worth failing a reconcile */ }
    }
  } catch { /* no sitemap: the local file list and the crawl still cover us */ }

  const queue = [...seeds];
  while (queue.length) {
    const urlPath = queue.shift();
    if (seen.has(urlPath)) continue;
    seen.add(urlPath);
    const rel = fileFor(urlPath);
    if (isBlogOwned(rel) || urlPath.startsWith('/blog')) continue;

    let res;
    try {
      res = await get(origin + encodeURI(urlPath));
    } catch (error) {
      unreachable.push({ path: urlPath, reason: String((error && error.message) || error) });
      continue;
    }
    if (res.status === 301 || res.status === 302) {
      const location = new URL(res.headers.get('location'), origin);
      if (location.host === host) queue.push(location.pathname.replace(/\/+$/, '') || '/');
      continue;
    }
    if (res.status === 404) continue;
    if (!res.ok) {
      unreachable.push({ path: urlPath, reason: `HTTP ${res.status}` });
      continue;
    }

    const live = Buffer.from(await res.arrayBuffer());
    const localPath = path.join(publicDir, rel);

    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, live);
      restored.push({ path: rel, bytes: live.length });
    } else {
      const local = fs.readFileSync(localPath);
      if (sha256(live) !== sha256(local)) {
        drift.push({ path: rel, url: urlPath, live: live.length, local: local.length });
      }
    }

    const type = res.headers.get('content-type') || '';
    const docUrl = origin + encodeURI(urlPath);
    if (/text\/html/i.test(type)) {
      for (const next of linksIn(live.toString('utf8'), docUrl)) queue.push(next);
    } else if (/text\/css/i.test(type)) {
      for (const next of cssUrls(live.toString('utf8'), docUrl)) queue.push(next);
    }
  }

  return { restored, drift, unreachable };
}

/**
 * Fail closed. Refuses to deploy when production has a page the tree lacks, when
 * a file we cannot reach might be about to be dropped, or when a shared file
 * differs in a way that is not a blog reference.
 */
async function assertDeploySafe({ publicDir, origin = SITE, fetchImpl = fetch, reconciled, manifestPath = MANIFEST_PATH } = {}) {
  const get = fetchImpl;
  const state = reconciled || await reconcileProduction({ publicDir, origin, fetchImpl: get, manifestPath });
  const problems = [];

  if (state.unreachable.length) {
    problems.push(...state.unreachable.map((f) => `${f.path}: could not be read from production (${f.reason}), so it may be dropped by the deploy`));
  }

  for (const item of state.drift) {
    if (!ADDITIVE.includes(item.path)) {
      problems.push(`${item.url}: differs from production (live ${item.live}b, deploy ${item.local}b) and is not a file the blog may edit`);
      continue;
    }
    const live = await (await get(origin + encodeURI(item.url))).text();
    const local = fs.readFileSync(path.join(publicDir, item.path), 'utf8');
    const liveLines = live.split(/\r?\n/);
    const localLines = local.split(/\r?\n/);
    const dropped = liveLines.filter((line) => !localLines.includes(line));
    const added = localLines.filter((line) => !liveLines.includes(line));
    if (dropped.length) problems.push(`${item.url}: would drop ${dropped.length} live line(s)`);
    const unrelated = added.filter((line) => line.trim() && !blogRelated(line));
    if (unrelated.length) problems.push(`${item.url}: adds ${unrelated.length} line(s) unrelated to the blog`);
  }

  if (problems.length) {
    throw new Error(`deploy blocked — ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  }
  return { restored: state.restored.length, drift: state.drift.length };
}

module.exports = {
  reconcileProduction,
  assertDeploySafe,
  isBlogOwned,
  urlFor,
  fileFor,
  linksIn,
  cssUrls,
  ADDITIVE,
  BLOG_OWNED,
  MUST_SEED,
  MANIFEST,
  MANIFEST_PATH,
};
