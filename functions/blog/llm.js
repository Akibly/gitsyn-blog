'use strict';

const { LLM } = require('./config');

const WINDOW_MS = 60_000;

class LlmError extends Error {
  constructor(message, { status, body, permanent = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.body = body;
    this.permanent = permanent;
  }
}

// Groq's free tier meters tokens per minute *per model*, and the pipeline needs
// several calls per article. Keep a rolling ledger for each model so a run
// spaces its own requests instead of walking into 429s, and so a call to the
// fast model never queues behind the writer's budget.
const ledgers = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ledgerFor(model) {
  const key = String(model || 'default');
  if (!ledgers.has(key)) ledgers.set(key, []);
  return ledgers.get(key);
}

function pruneLedger(ledger, now) {
  while (ledger.length && now - ledger[0].at >= WINDOW_MS) ledger.shift();
}

function usedTokens(ledger, now) {
  pruneLedger(ledger, now);
  return ledger.reduce((sum, entry) => sum + entry.tokens, 0);
}

function estimateTokens(messages, maxTokens) {
  const chars = (messages || []).reduce((sum, message) => sum + String(message?.content || '').length, 0);
  return Math.ceil(chars / 4) + maxTokens;
}

async function waitForBudget(ledger, estimate, tokensPerMinute) {
  if (!tokensPerMinute) return;
  let waited = 0;
  while (waited < WINDOW_MS + 5_000) {
    const now = Date.now();
    const used = usedTokens(ledger, now);
    if (!ledger.length || used + estimate <= tokensPerMinute) return;
    const delay = Math.max(500, WINDOW_MS - (now - ledger[0].at) + 100);
    await sleep(delay);
    waited += delay;
  }
}

function durationMs(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1000;
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let match;
  while ((match = re.exec(text))) {
    const amount = Number(match[1]);
    const unit = match[2];
    total += unit === 'ms' ? amount
      : unit === 's' ? amount * 1000
        : unit === 'm' ? amount * 60_000
          : amount * 3_600_000;
  }
  return total;
}

function retryDelayMs(response) {
  const retryAfter = durationMs(response.headers?.get?.('retry-after'));
  const reset = durationMs(response.headers?.get?.('x-ratelimit-reset-tokens'));
  const delay = retryAfter || reset;
  return Math.min(65_000, Math.max(1_000, delay));
}

function keyName(provider) {
  return provider === 'groq' ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY';
}

function headersFor(provider, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://gitsyn.cc';
    headers['X-Title'] = 'GitSyn Blog';
  }
  return headers;
}

function parseJsonReply(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new LlmError('Model returned an empty reply.');
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LlmError(`Model reply was not JSON: ${unfenced.slice(0, 240)}`);
  }
}

async function request(body, {
  apiKey,
  provider,
  baseUrl,
  timeoutMs,
  fetchImpl,
  estimate,
  tokensPerMinute,
  ledgerKey,
}) {
  if (!apiKey) throw new LlmError(`${keyName(provider)} is not set.`);
  const doFetch = fetchImpl || fetch;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const headers = headersFor(provider, apiKey);
  const ledger = ledgerFor(ledgerKey);
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForBudget(ledger, estimate, tokensPerMinute);

    let response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      await sleep(1200 * (attempt + 1));
      continue;
    }

    const raw = await response.text();
    if (!response.ok) {
      // A daily token ceiling will not clear inside a run, so retrying four
      // times only burns five minutes before the same 429 comes back.
      const daily = /tokens per day|tpd\)/i.test(raw);
      const permanent = daily || /request too large|reduce your message size|context length/i.test(raw);
      lastError = new LlmError(`${provider} ${response.status}: ${raw.slice(0, 400)}`, {
        status: response.status,
        body: raw,
        permanent,
      });
      if (permanent || (response.status !== 429 && response.status < 500)) throw lastError;
      await sleep(response.status === 429 ? retryDelayMs(response) : 1200 * (attempt + 1));
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new LlmError(`${provider} returned a non-JSON envelope: ${raw.slice(0, 200)}`);
    }
    const reported = Number(payload?.usage?.total_tokens);
    ledger.push({
      at: Date.now(),
      tokens: Number.isFinite(reported) && reported > 0 ? reported : estimate,
    });
    return payload;
  }

  throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
}

async function chat({
  apiKey,
  model,
  messages,
  temperature = 0.6,
  maxTokens = 6000,
  timeoutMs = 180000,
  fetchImpl,
  provider = LLM.provider,
  baseUrl = LLM.baseUrl,
  tokensPerMinute = LLM.tokensPerMinute,
  reasoningEffort = LLM.reasoningEffort,
}) {
  const estimate = estimateTokens(messages, maxTokens);
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (reasoningEffort && provider === 'groq') body.reasoning_effort = reasoningEffort;
  const payload = await request(
    body,
    { apiKey, provider, baseUrl, timeoutMs, fetchImpl, estimate, tokensPerMinute, ledgerKey: model }
  );
  const choice = payload?.choices?.[0];
  const text = choice?.message?.content;
  if (!text) {
    throw new LlmError(
      `${provider} returned no text (finish_reason: ${choice?.finish_reason || 'unknown'}).`
    );
  }
  return {
    text: typeof text === 'string' ? text : JSON.stringify(text),
    usage: payload.usage || {},
    model,
  };
}

async function chatJson(options) {
  const result = await chat(options);
  return { ...result, json: parseJsonReply(result.text) };
}

/**
 * Ask an image-capable provider for a hero. The response carries a data URL;
 * callers upload the bytes to Supabase Storage so the post has a stable public
 * address. Groq has no image endpoint, so the pipeline skips this entirely.
 */
async function image({
  apiKey,
  model,
  prompt,
  timeoutMs = 240000,
  fetchImpl,
  baseUrl = 'https://openrouter.ai/api/v1',
  tokensPerMinute = 0,
}) {
  if (!apiKey) throw new LlmError('OPENROUTER_API_KEY is not set.');
  const messages = [{ role: 'user', content: prompt }];
  const payload = await request(
    { model, messages, modalities: ['image', 'text'] },
    {
      apiKey,
      provider: 'openrouter',
      baseUrl,
      timeoutMs,
      fetchImpl,
      estimate: estimateTokens(messages, 0),
      tokensPerMinute,
    }
  );
  const message = payload?.choices?.[0]?.message;
  const dataUrl = message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    throw new LlmError('Image model returned no image.');
  }
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new LlmError('Image model returned a malformed data URL.');
  return {
    mediaType: match[1],
    data: Buffer.from(match[2], 'base64'),
    text: typeof message.content === 'string' ? message.content : '',
    usage: payload.usage || {},
  };
}

module.exports = { chat, chatJson, image, parseJsonReply, LlmError, estimateTokens };
