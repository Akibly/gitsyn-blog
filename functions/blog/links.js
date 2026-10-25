'use strict';

const { countLinks, tokens } = require('./text');
const { SITE, LIMITS } = require('./config');

function overlap(a, b) {
  const setA = new Set(tokens(a));
  if (!setA.size) return 0;
  let shared = 0;
  for (const word of new Set(tokens(b))) if (setA.has(word)) shared += 1;
  return shared / setA.size;
}

/**
 * The posts the writer is allowed to link to. Topic overlap first, then the
 * newest, so a post about serial fiction links to serial fiction rather than
 * to whatever was published last.
 */
function pickCandidates(publishedPosts, { topicKey, title, limit = 5 } = {}) {
  const query = `${topicKey || ''} ${title || ''}`.replace(/-/g, ' ');
  return [...(publishedPosts || [])]
    .map((post) => ({
      ...post,
      score: overlap(query, `${post.topic_key || ''} ${post.title || ''} ${post.excerpt || ''}`),
    }))
    .sort((a, b) => b.score - a.score || String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, limit);
}

function requiredInternalLinks(availablePosts, limits) {
  return Math.min(limits.minInternalLinks, Math.max(0, availablePosts));
}

/**
 * If the writer skipped its links, one targeted edit puts them in. This never
 * invents a URL: only candidates that already exist are offered.
 */
async function ensureInternalLinks({
  body,
  candidates,
  required,
  chatJson,
  model,
  apiKey,
  maxTokens = LIMITS.maxTokens.links,
  fetchImpl,
}) {
  const current = countLinks(body);
  if (current.internalPosts >= required) {
    return { body, repaired: false, links: current };
  }
  const missing = required - current.internalPosts;
  const pool = candidates.slice(0, Math.max(missing + 1, 3));
  if (!pool.length) return { body, repaired: false, links: current };

  const result = await chatJson({
    apiKey,
    model,
    messages: require('./prompts').repairLinksMessages({ body, candidates: pool }),
    temperature: 0.3,
    maxTokens,
    fetchImpl,
  });
  const repairedBody = String(result.json?.body_md || '').trim();
  if (!repairedBody || repairedBody.length < body.length * 0.85) {
    return { body, repaired: false, links: current };
  }
  const links = countLinks(repairedBody);
  return { body: repairedBody, repaired: links.internalPosts > current.internalPosts, links };
}

function appTarget(targets) {
  const app = (targets || []).filter((target) => target.kind === 'app');
  if (!app.length) return { url: 'https://app.gitsyn.cc', label: 'Open GitSyn', description: 'Start a project or read public work' };
  return app.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
}

function internalLinkLabel(post) {
  return `${SITE}/blog/${post.slug}`;
}

module.exports = { pickCandidates, requiredInternalLinks, ensureInternalLinks, appTarget, internalLinkLabel, overlap };
