#!/usr/bin/env node
'use strict';

// The whole free-tier cycle in one process: reconcile the deploy directory with
// production, write one article, render the blog to static files, then refuse to
// continue unless the result provably changes nothing that already exists.
// Deploying is the caller's job so this gate can abort before anything ships.

const { scheduledGenerate, scheduledLearn } = require('./schedule');
const { buildStaticBlog, PUBLIC_DIR } = require('./build');
const { reconcileProduction, assertDeploySafe } = require('./sync-live');

async function main(job) {
  const reconciled = await reconcileProduction({ publicDir: PUBLIC_DIR });

  let result;
  if (job === 'check') {
    // Re-render and re-verify without spending any model tokens.
    result = { job, status: 'render-only' };
  } else if (job === 'learn') {
    result = { job, ...summarise(await scheduledLearn()) };
  } else {
    result = { job, ...summarise(await scheduledGenerate()) };
  }

  const built = await buildStaticBlog();
  const safe = await assertDeploySafe({ publicDir: PUBLIC_DIR, reconciled });

  return { ...result, built, restoredFromProduction: reconciled.restored.length, ...safe };
}

function summarise(result) {
  if (!result) return { status: 'empty' };
  return { status: result.status, reason: result.reason, slug: result.post?.slug || result.slug };
}

const job = process.argv.includes('--job=learn')
  ? 'learn'
  : (process.argv.includes('--job=check') ? 'check' : 'generate');

main(job)
  .then((summary) => {
    console.log(JSON.stringify({ ok: true, ...summary }));
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, job, error: String(error && error.message || error) }));
    process.exit(1);
  });
