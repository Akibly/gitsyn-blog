'use strict';

const crypto = require('node:crypto');
const { image, chatJson } = require('./llm');
const { heroPrompt, altTextMessages } = require('./prompts');
const { uploadImage } = require('./db');
const { trimToLength } = require('./text');
const { SITE } = require('./config');

const FALLBACK_HERO = `${SITE}/images/og-card.png`;
const FALLBACK_ALT = 'GitSyn editorial card with the GitSyn wordmark on a warm off-white background.';

function detectImage(buffer) {
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', type: 'image/png' };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return { ext: 'png', type: 'image/png' };
}

async function makeAlt({ title, thesis, intent, apiKey, model, fetchImpl }) {
  try {
    const result = await chatJson({
      apiKey,
      model,
      messages: altTextMessages({ title, thesis, intent }),
      temperature: 0.3,
      maxTokens: 200,
      fetchImpl,
    });
    const alt = trimToLength(result.json?.alt, 220);
    if (alt && alt.length >= 10) return alt;
  } catch {
    /* fall through to a description built from the title */
  }
  return trimToLength(`${title}. An editorial illustration for this article.`, 220);
}

/**
 * Generated hero, uploaded to Supabase Storage. A failed image call does not
 * lose the article: the branded share card stands in and the alt text still
 * describes the article. The caller gets `generated: false` so the run log
 * shows it.
 */
async function generateHero({
  client,
  apiKey,
  model,
  fastModel,
  title,
  thesis,
  intent,
  slug,
  fetchImpl,
}) {
  if (!model) {
    return {
      url: FALLBACK_HERO,
      alt: FALLBACK_ALT,
      generated: false,
      skipped: true,
      error: 'no image model for this provider',
    };
  }
  let alt = await makeAlt({ title, thesis, intent, apiKey, model: fastModel, fetchImpl });
  try {
    const generated = await image({
      apiKey,
      model,
      prompt: heroPrompt({ title, thesis, intent }),
      fetchImpl,
    });
    if (generated.data.length > 10 * 1024 * 1024) throw new Error('hero image over 10 MB');
    const format = detectImage(generated.data);
    const hash = crypto.createHash('sha1').update(generated.data).digest('hex').slice(0, 10);
    const path = `hero/${slug}-${hash}.${format.ext}`;
    const url = await uploadImage(client, path, generated.data, format.type);
    return { url, alt, generated: true };
  } catch (error) {
    return { url: FALLBACK_HERO, alt, generated: false, error: error.message };
  }
}

module.exports = { generateHero, detectImage, FALLBACK_HERO, FALLBACK_ALT, makeAlt };
