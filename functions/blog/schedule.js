'use strict';

const db = require('./db');
const { runGeneration } = require('./pipeline');
const { runLearn } = require('./gsc');
const { LLM } = require('./config');

async function scheduledGenerate() {
  const client = db.serviceClient();
  const result = await runGeneration({
    client,
    llmKey: process.env[LLM.keyEnv],
    tavilyKey: process.env.TAVILY_API_KEY,
    trigger: 'schedule',
  });
  console.log(JSON.stringify({ job: 'blogGenerate', ...summarise(result) }));
  return result;
}

async function scheduledLearn() {
  const client = db.serviceClient();
  const result = await runLearn({
    client,
    apiKey: process.env[LLM.keyEnv],
  });
  console.log(JSON.stringify({ job: 'blogLearn', ...summarise(result) }));
  return result;
}

function summarise(result) {
  if (!result) return { status: 'empty' };
  return {
    status: result.status,
    reason: result.reason,
    runId: result.runId,
    slug: result.post?.slug || result.slug,
    inserted: result.inserted,
    error: result.error,
  };
}

module.exports = { scheduledGenerate, scheduledLearn };
