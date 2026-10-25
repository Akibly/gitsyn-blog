'use strict';

const { LIMITS } = require('./config');
const { SITE_FACTS } = require('./prompts');

const TAVILY_URL = 'https://api.tavily.com/search';

class ResearchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResearchError';
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function tavilySearch({ apiKey, query, maxResults = 5, timeoutMs = 45000, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  if (!apiKey) throw new ResearchError('TAVILY_API_KEY is not set.');
  const response = await doFetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      include_raw_content: true,
      include_answer: false,
      max_results: maxResults,
      topic: 'general',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ResearchError(`Tavily ${response.status}: ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  return Array.isArray(payload.results) ? payload.results : [];
}

function normaliseResult(result, query) {
  const url = canonicalUrl(result.url);
  if (!url) return null;
  const raw = String(result.raw_content || '');
  const snippet = String(result.content || '').trim();
  const content = (raw || snippet).trim().slice(0, LIMITS.maxCharsPerSource);
  if (content.length < 160) return null;
  return {
    url,
    title: String(result.title || url).trim().slice(0, 300),
    snippet: snippet.slice(0, 500),
    content,
    score: Number(result.score) || 0,
    query,
  };
}

function mergeSources(batches, limit = LIMITS.maxSources) {
  const seen = new Set();
  const perHost = new Map();
  const merged = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (!item || seen.has(item.url)) continue;
      const host = hostOf(item.url);
      const used = perHost.get(host) || 0;
      if (used >= 2) continue;
      seen.add(item.url);
      perHost.set(host, used + 1);
      merged.push(item);
    }
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit).map((item, index) => ({ ...item, index: index + 1 }));
}

/**
 * Search the web for the question and keep what the writer is allowed to use.
 * Two searches normally, a third only when the first two are thin. Results are
 * deduplicated, capped at two per host, and trimmed to a size the model can
 * read without dropping the end of every source.
 */
async function researchQuestion({ question, topicKey, apiKey, fetchImpl, maxSources = LIMITS.maxSources }) {
  if (!question || !question.trim()) throw new ResearchError('No question to research.');
  const topicPhrase = String(topicKey || '').replace(/-/g, ' ').trim();
  const firstQueries = [question, `${question} reddit`];
  const settled = await Promise.allSettled(
    firstQueries.map((query) => tavilySearch({ apiKey, query, fetchImpl }))
  );
  const batches = settled
    .filter((entry) => entry.status === 'fulfilled')
    .map((entry, i) => entry.value.map((r) => normaliseResult(r, firstQueries[i])).filter(Boolean));

  let sources = mergeSources(batches, maxSources);

  if (sources.length < 2 && topicPhrase) {
    try {
      const extra = await tavilySearch({
        apiKey,
        query: `${topicPhrase} practical guide`,
        fetchImpl,
      });
      sources = mergeSources(
        [...batches, extra.map((r) => normaliseResult(r, `${topicPhrase} practical guide`)).filter(Boolean)],
        maxSources
      );
    } catch {
      /* the first two searches are enough to decide below */
    }
  }

  if (sources.length < 2) {
    throw new ResearchError(
      `Only ${sources.length} usable source${sources.length === 1 ? '' : 's'} found; at least 2 are needed.`
    );
  }

  const allowedText = [
    SITE_FACTS,
    ...sources.flatMap((s) => [s.title, s.url, s.snippet, s.content]),
  ].join('\n');

  return {
    sources,
    queries: firstQueries,
    allowedText,
  };
}

module.exports = { researchQuestion, tavilySearch, canonicalUrl, hostOf, mergeSources, ResearchError };
