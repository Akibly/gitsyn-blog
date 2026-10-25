'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, MEDIA_BUCKET, GSC_BUCKET, LIMITS } = require('./config');

function serviceClient(key) {
  const serviceKey = key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function settings(client) {
  const { data, error } = await client.from('blog_settings').select('value').eq('id', 1).maybeSingle();
  if (error) throw new Error(`blog_settings: ${error.message}`);
  return { ...LIMITS, ...(data?.value || {}) };
}

async function claimQuestion(client, runId, recentDays = LIMITS.recentTopicDays) {
  const { data, error } = await client.rpc('blog_claim_question', {
    p_run_id: runId,
    p_recent_days: recentDays,
  });
  if (error) throw new Error(`claim question: ${error.message}`);
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function failQuestion(client, questionId, message) {
  const { error } = await client.rpc('blog_fail_question', {
    p_question_id: questionId,
    p_error: String(message || 'unknown').slice(0, 2000),
  });
  if (error) throw new Error(`fail question: ${error.message}`);
}

async function requeueQuestion(client, questionId) {
  const { error } = await client
    .from('blog_questions')
    .update({ status: 'queued', error: null, run_id: null, claimed_at: null })
    .eq('id', questionId);
  if (error) throw new Error(`requeue question: ${error.message}`);
}

async function publishPost(client, post, questionId = null) {
  const { data, error } = await client.rpc('blog_publish_post', {
    p_post: post,
    p_question_id: questionId,
  });
  if (error) throw new Error(`publish post: ${error.message}`);
  return data;
}

async function queueStats(client) {
  const { data, error } = await client.rpc('blog_queue_stats');
  if (error) throw new Error(`queue stats: ${error.message}`);
  return data;
}

async function relatedPosts(client, slug, limit = 3) {
  const { data, error } = await client.rpc('blog_related_posts', {
    p_slug: slug,
    p_limit: limit,
  });
  if (error) throw new Error(`related posts: ${error.message}`);
  return data || [];
}

async function publishedPosts(client, limit = 50) {
  const { data, error } = await client
    .from('blog_posts')
    .select('id, slug, title, excerpt, meta_description, topic_key, intent, published_at, body_md, word_count, reading_minutes, hero_image_url, hero_image_alt')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`published posts: ${error.message}`);
  return data || [];
}

async function postBySlug(client, slug, { includeDrafts = false } = {}) {
  let query = client
    .from('blog_posts')
    .select('*, blog_authors(*)')
    .eq('slug', slug);
  if (!includeDrafts) query = query.eq('status', 'published');
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`post by slug: ${error.message}`);
  return data;
}

async function allPostsForSitemap(client) {
  const { data, error } = await client
    .from('blog_posts')
    .select('slug, title, published_at, updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw new Error(`sitemap posts: ${error.message}`);
  return data || [];
}

async function dedupeCorpus(client, limit = 40) {
  const { data, error } = await client
    .from('blog_posts')
    .select('slug, topic_key, body_md')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`dedupe corpus: ${error.message}`);
  return data || [];
}

async function recentTopics(client, days = LIMITS.recentTopicDays) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await client
    .from('blog_posts')
    .select('topic_key, title, published_at')
    .eq('status', 'published')
    .gte('published_at', since);
  if (error) throw new Error(`recent topics: ${error.message}`);
  return data || [];
}

async function publishedSlugs(client) {
  const { data, error } = await client
    .from('blog_posts')
    .select('slug')
    .eq('status', 'published');
  if (error) throw new Error(`published slugs: ${error.message}`);
  return new Set((data || []).map((row) => row.slug));
}

async function allSlugs(client) {
  const { data, error } = await client.from('blog_posts').select('slug');
  if (error) throw new Error(`slugs: ${error.message}`);
  return new Set((data || []).map((row) => row.slug));
}

async function enqueueQuestions(client, items, source = 'learn') {
  const { data, error } = await client.rpc('blog_enqueue_questions', {
    p_items: items,
    p_source: source,
  });
  if (error) throw new Error(`enqueue questions: ${error.message}`);
  return data || 0;
}

async function queuedQuestions(client, limit = 200) {
  const { data, error } = await client
    .from('blog_questions')
    .select('question, topic_key, status')
    .in('status', ['queued', 'used', 'claimed'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`queued questions: ${error.message}`);
  return data || [];
}

async function insertResearch(client, postId, sources) {
  if (!sources.length) return;
  const rows = sources.map((source) => ({
    post_id: postId,
    url: source.url,
    title: source.title || null,
    snippet: source.snippet || null,
    raw: source.content || source.raw || null,
  }));
  const { error } = await client.from('blog_research').upsert(rows, { onConflict: 'post_id,url' });
  if (error) throw new Error(`insert research: ${error.message}`);
}

async function startRun(client, kind, detail = {}) {
  const { data, error } = await client
    .from('blog_runs')
    .insert({ kind, status: 'running', detail })
    .select('id')
    .single();
  if (error) throw new Error(`start run: ${error.message}`);
  return data.id;
}

async function finishRun(client, runId, { status, error, detail, questionId, postId } = {}) {
  const patch = {
    status: status || 'ok',
    finished_at: new Date().toISOString(),
    detail: detail || {},
  };
  if (error) patch.error = String(error).slice(0, 4000);
  if (questionId) patch.question_id = questionId;
  if (postId) patch.post_id = postId;
  const { error: updateError } = await client.from('blog_runs').update(patch).eq('id', runId);
  if (updateError) throw new Error(`finish run: ${updateError.message}`);
}

async function uploadImage(client, path, buffer, mediaType = 'image/png') {
  const { error } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(path, buffer, { contentType: mediaType, upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`upload image: ${error.message}`);
  const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function listGscFiles(client) {
  const { data, error } = await client.storage
    .from(GSC_BUCKET)
    .list('', { limit: 100, sortBy: { column: 'updated_at', order: 'desc' } });
  if (error) throw new Error(`list gsc: ${error.message}`);
  return (data || []).filter((file) => /\.csv$/i.test(file.name || ''));
}

async function downloadGscFile(client, path) {
  const { data, error } = await client.storage.from(GSC_BUCKET).download(path);
  if (error) throw new Error(`download gsc: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function recordGscImport(client, { fileName, contentHash, rows, payload }) {
  const { error } = await client.from('blog_gsc_imports').insert({
    file_name: fileName,
    content_hash: contentHash,
    rows_count: rows,
    payload,
  });
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(`record gsc import: ${error.message}`);
  }
  return true;
}

async function gscImportExists(client, hash) {
  const { data, error } = await client
    .from('blog_gsc_imports')
    .select('id')
    .eq('content_hash', hash)
    .maybeSingle();
  if (error) throw new Error(`gsc import exists: ${error.message}`);
  return Boolean(data);
}

async function gscImports(client) {  const { data, error } = await client
    .from('blog_gsc_imports')
    .select('id, file_name, rows_count, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`gsc imports: ${error.message}`);
  return data || [];
}

async function author(client, slug) {
  const { data, error } = await client
    .from('blog_authors')
    .select('id, slug, name, role, photo_url, bio, github_url, x_url, site_url')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`author: ${error.message}`);
  return data;
}

async function linkTargets(client) {  const { data, error } = await client
    .from('blog_link_targets')
    .select('url, label, description, kind, weight')
    .eq('enabled', true)
    .order('weight', { ascending: false });
  if (error) throw new Error(`link targets: ${error.message}`);
  return data || [];
}

async function recentRuns(client, limit = 20) {
  const { data, error } = await client
    .from('blog_runs')
    .select('id, kind, status, started_at, finished_at, error, post_id, question_id, detail')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recent runs: ${error.message}`);
  return data || [];
}

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  serviceClient,
  settings,
  claimQuestion,
  failQuestion,
  requeueQuestion,
  publishPost,
  queueStats,
  relatedPosts,
  publishedPosts,
  postBySlug,
  allPostsForSitemap,
  dedupeCorpus,
  recentTopics,
  publishedSlugs,
  allSlugs,
  enqueueQuestions,
  queuedQuestions,
  insertResearch,
  startRun,
  finishRun,
  uploadImage,
  listGscFiles,
  downloadGscFile,
  recordGscImport,
  gscImportExists,
  gscImports,
  linkTargets,
  author,
  recentRuns,
  contentHash,
};
