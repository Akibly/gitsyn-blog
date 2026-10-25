'use strict';

const db = require('./db');
const { chatJson } = require('./llm');
const { gscQuestionsMessages } = require('./prompts');
const { normaliseQuestionItem, questionKey } = require('./pipeline');
const { LIMITS, MODELS } = require('./config');

function parseCsv(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function numberValue(value) {
  const cleaned = String(value ?? '').replace(/[,\s%]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function columnIndex(headers, ...names) {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function blogSlug(value) {
  try {
    const url = new URL(value);
    if (!/^(www\.)?gitsyn\.cc$/i.test(url.hostname)) return null;
    const match = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(url.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Accepts either Search Console export shape: the Pages tab or the Queries
 * tab. Columns are matched by name because Google's headers vary by locale
 * and by export type.
 */
function parseGscCsv(input) {
  const rows = parseCsv(input);
  if (rows.length < 2) return { kind: 'empty', rows: [], pages: [], queries: [] };
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const pageIdx = columnIndex(headers, 'top pages', 'page', 'pages', 'landing page');
  const queryIdx = columnIndex(headers, 'top queries', 'query', 'queries');
  const clicksIdx = columnIndex(headers, 'clicks', 'url clicks');
  const impressionsIdx = columnIndex(headers, 'impressions');
  const positionIdx = columnIndex(headers, 'position', 'average position');
  if (pageIdx < 0 && queryIdx < 0) {
    throw new Error('This CSV has no page or query column. Export the Pages or Queries tab from Search Console.');
  }

  const pages = [];
  const queries = [];
  for (const row of rows.slice(1)) {
    const clicks = clicksIdx >= 0 ? numberValue(row[clicksIdx]) : 0;
    const impressions = impressionsIdx >= 0 ? numberValue(row[impressionsIdx]) : 0;
    const position = positionIdx >= 0 ? numberValue(row[positionIdx]) : 0;
    if (pageIdx >= 0 && row[pageIdx]) {
      pages.push({ page: row[pageIdx].trim(), clicks, impressions, position });
    }
    if (queryIdx >= 0 && row[queryIdx]) {
      queries.push({ query: row[queryIdx].trim(), clicks, impressions, position });
    }
  }

  return {
    kind: pageIdx >= 0 ? 'pages' : 'queries',
    rows: rows.slice(1),
    pages,
    queries,
  };
}

function aggregatePages(pages, postsBySlug) {
  const bySlug = new Map();
  for (const row of pages) {
    const slug = blogSlug(row.page);
    if (!slug) continue;
    const entry = bySlug.get(slug) || { slug, clicks: 0, impressions: 0, weighted: 0 };
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    entry.weighted += row.position * Math.max(row.impressions, 1);
    bySlug.set(slug, entry);
  }
  return [...bySlug.values()]
    .map((entry) => ({
      slug: entry.slug,
      title: postsBySlug.get(entry.slug)?.title || entry.slug.replace(/-/g, ' '),
      clicks: entry.clicks,
      impressions: entry.impressions,
      position: Number((entry.weighted / Math.max(entry.impressions, 1)).toFixed(1)),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

function topQueries(queries, limit = 12) {
  return [...queries]
    .filter((row) => row.query)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit)
    .map((row) => ({ ...row, position: Number(row.position.toFixed(1)) }));
}

/**
 * Weekly lesson from Search Console: pages already earning clicks get ten
 * related questions added to the queue. Reads the newest CSV in the private
 * blog-gsc bucket, or accepts a CSV body from the admin route. Each export is
 * imported once, keyed by its content hash.
 */
async function runLearn({
  client,
  apiKey,
  model = MODELS.fast,
  csvText = null,
  fileName = null,
  fetchImpl,
}) {
  const runId = await db.startRun(client, 'learn', { fileName });
  try {
    let buffer;
    let name = fileName;
    if (csvText) {
      buffer = Buffer.from(String(csvText), 'utf8');
      name = name || 'upload.csv';
    } else {
      const files = await db.listGscFiles(client);
      if (!files.length) {
        await db.finishRun(client, runId, { status: 'skipped', detail: { reason: 'no-export' } });
        return { status: 'skipped', reason: 'no-export', runId };
      }
      const newest = files[0];
      name = newest.name;
      buffer = await db.downloadGscFile(client, name);
    }

    const hash = db.contentHash(buffer);
    if (await db.gscImportExists(client, hash)) {
      await db.finishRun(client, runId, { status: 'skipped', detail: { reason: 'already-imported', name } });
      return { status: 'skipped', reason: 'already-imported', runId, fileName: name };
    }

    const parsed = parseGscCsv(buffer.toString('utf8'));
    if (!parsed.pages.length && !parsed.queries.length) {
      await db.finishRun(client, runId, { status: 'skipped', detail: { reason: 'empty-export', name } });
      return { status: 'skipped', reason: 'empty-export', runId, fileName: name };
    }

    const [published, existing, recentTopics] = await Promise.all([
      db.publishedPosts(client, 100),
      db.queuedQuestions(client, 300),
      db.recentTopics(client, LIMITS.recentTopicDays),
    ]);
    const postsBySlug = new Map(published.map((post) => [post.slug, post]));
    const clicked = aggregatePages(parsed.pages, postsBySlug);
    const queries = topQueries(parsed.queries);
    const clickedPosts = (clicked.length ? clicked : published.slice(0, 5).map((post) => ({
      ...post,
      clicks: 0,
      impressions: 0,
      position: 0,
    }))).slice(0, 5);

    const existingKeys = new Set(existing.map((item) => questionKey(item.question)));
    const existingTopics = new Set(existing.map((item) => item.topic_key).filter(Boolean));
    recentTopics.forEach((post) => post.topic_key && existingTopics.add(post.topic_key));

    const result = await chatJson({
      apiKey,
      model,
      messages: gscQuestionsMessages({
        count: LIMITS.learnSize,
        clickedPosts,
        queries,
        existingQuestions: existing.map((item) => item.question),
      }),
      temperature: 0.8,
      maxTokens: LIMITS.maxTokens.learn,
      fetchImpl,
    });

    const raw = Array.isArray(result.json?.questions) ? result.json.questions : [];
    const batchKeys = new Set();
    const batchTopics = new Set();
    const items = [];
    for (const item of raw) {
      const clean = normaliseQuestionItem(item, existingKeys, existingTopics, batchKeys, batchTopics);
      if (clean) items.push(clean);
      if (items.length >= LIMITS.learnSize) break;
    }

    const inserted = items.length ? await db.enqueueQuestions(client, items, 'learn') : 0;
    await db.recordGscImport(client, {
      fileName: name,
      contentHash: hash,
      rows: parsed.rows.length,
      payload: parsed.rows.slice(0, 60),
    });

    await db.finishRun(client, runId, {
      status: 'ok',
      detail: {
        fileName: name,
        kind: parsed.kind,
        rows: parsed.rows.length,
        clicked: clickedPosts.slice(0, 5).map((post) => ({ slug: post.slug, clicks: post.clicks })),
        queries: queries.length,
        inserted,
      },
    });

    return {
      status: 'ok',
      runId,
      fileName: name,
      kind: parsed.kind,
      rows: parsed.rows.length,
      clickedPosts: clickedPosts.slice(0, 5),
      inserted,
      questions: items.map((item) => item.question),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await db.finishRun(client, runId, { status: 'failed', error: message });
    } catch {
      /* run log is best effort */
    }
    return { status: 'failed', error: message, runId };
  }
}

module.exports = { runLearn, parseCsv, parseGscCsv, aggregatePages, topQueries, blogSlug };
