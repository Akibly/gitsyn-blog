'use strict';

const db = require('./db');
const { authorized, previewToken } = require('./guard');
const { runGeneration, refillQueue, publishDraft } = require('./pipeline');
const { runLearn } = require('./gsc');
const { LIMITS, SITE, LLM } = require('./config');
const { slugify } = require('./text');

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    if (typeof req.body === 'object') return JSON.stringify(req.body);
  }
  if (req.rawBody) return Buffer.from(req.rawBody).toString('utf8');
  return new Promise((resolve, reject) => {
    let data = '';
    if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
}

function method(req) {
  return (req.method || 'GET').toUpperCase();
}

function normaliseItems(raw) {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
  return list
    .map((item) => {
      const text = typeof item === 'string' ? item : item && item.question;
      const question = String(text || '').trim().replace(/\s+/g, ' ');
      if (question.length < 8 || question.length > 240) return null;
      const withQuestion = question.endsWith('?') ? question : `${question}?`;
      const rawPriority = Number(item && item.priority);
      return {
        question: withQuestion,
        topic_key: slugify((item && item.topic_key) || withQuestion, 48),
        intent: ['explain', 'compare', 'how-to'].includes(item && item.intent) ? item.intent : 'how-to',
        priority: Number.isFinite(rawPriority) ? Math.min(5, Math.max(1, rawPriority)) : 3,
        notes: (item && item.notes) ? String(item.notes).slice(0, 400) : null,
      };
    })
    .filter(Boolean);
}

function createHandler({ getSecret } = {}) {
  return async function blogAdminHandler(req, res) {
    res.set('x-robots-tag', 'noindex, nofollow');
    res.set('cache-control', 'no-store');

    const secret = typeof getSecret === 'function' ? getSecret() : '';
    if (!authorized(req, secret)) {
      res.status(401).set('www-authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }

    const url = new URL(req.originalUrl || req.url || '/', SITE);
    const path = url.pathname.replace(/\/+$/, '');
    const client = db.serviceClient();
    const verb = method(req);

    try {
      if (path === '/api/blog/generate' && verb === 'POST') {
        const body = await readJson(req);
        const result = await runGeneration({
          client,
          llmKey: process.env[LLM.keyEnv],
          tavilyKey: process.env.TAVILY_API_KEY,
          forceStatus: body.publish === true ? 'published' : (body.draft === true ? 'draft' : null),
          trigger: 'api',
        });
        res.status(200).json(result);
        return;
      }

      if (path === '/api/blog/refill' && verb === 'POST') {
        const body = await readJson(req);
        const result = await refillQueue({
          client,
          apiKey: process.env[LLM.keyEnv],
          count: Math.min(40, Math.max(1, Number(body.count) || LIMITS.refillSize)),
        });
        res.status(200).json({ ok: true, ...result });
        return;
      }

      if (path === '/api/blog/learn' && verb === 'POST') {
        const contentType = String(req.get?.('content-type') || req.headers?.['content-type'] || '');
        let result;
        if (/text\/csv/i.test(contentType)) {
          result = await runLearn({
            client,
            apiKey: process.env[LLM.keyEnv],
            csvText: await readBody(req),
            fileName: 'upload.csv',
          });
        } else {
          const body = await readJson(req);
          result = await runLearn({
            client,
            apiKey: process.env[LLM.keyEnv],
            csvText: body.csv ? String(body.csv) : null,
            fileName: body.file_name ? String(body.file_name) : null,
          });
        }
        res.status(200).json(result);
        return;
      }

      if (path === '/api/blog/status' && verb === 'GET') {
        const [stats, settings, runs, imports] = await Promise.all([
          db.queueStats(client),
          db.settings(client),
          db.recentRuns(client, 25),
          db.gscImports(client),
        ]);
        const [{ data: queue }, { data: posts }] = await Promise.all([
          client.from('blog_questions')
            .select('id, question, topic_key, status, priority, error, created_at')
            .order('created_at', { ascending: false })
            .limit(60),
          client.from('blog_posts')
            .select('slug, title, status, published_at, word_count, created_at')
            .order('created_at', { ascending: false })
            .limit(30),
        ]);
        res.status(200).json({ stats, settings, runs, imports, queue: queue || [], posts: posts || [] });
        return;
      }

      if (path === '/api/blog/questions' && verb === 'POST') {
        const body = await readJson(req);
        const items = normaliseItems(body.questions || body.items || body);
        if (!items.length) {
          res.status(400).json({ error: 'No valid questions in the request.' });
          return;
        }
        const inserted = await db.enqueueQuestions(client, items, 'manual');
        res.status(200).json({ ok: true, offered: items.length, inserted, questions: items.map((item) => item.question) });
        return;
      }

      if (path === '/api/blog/publish' && verb === 'POST') {
        const body = await readJson(req);
        const slug = String(body.slug || '').trim();
        if (!slug) {
          res.status(400).json({ error: 'slug is required.' });
          return;
        }
        const post = await publishDraft({ client, slug });
        res.status(200).json({ ok: true, slug: post.slug, status: post.status, published_at: post.published_at });
        return;
      }

      if (path === '/api/blog/preview-link') {
        const body = verb === 'POST' ? await readJson(req) : {};
        const slug = String(body.slug || (req.query && req.query.slug) || '').trim();
        if (!slug) {
          res.status(400).json({ error: 'slug is required.' });
          return;
        }
        const post = await db.postBySlug(client, slug, { includeDrafts: true });
        if (!post) {
          res.status(404).json({ error: `No post with slug ${slug}.` });
          return;
        }
        const token = previewToken(slug, secret);
        res.status(200).json({
          ok: true,
          slug,
          status: post.status,
          token,
          url: `${SITE}/blog/preview/${slug}?token=${token}`,
        });
        return;
      }

      res.status(404).json({ error: 'Unknown route.', path, method: verb });
    } catch (error) {
      console.error('blog admin failed', path, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

module.exports = { createHandler, normaliseItems, readBody, readJson };
