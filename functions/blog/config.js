'use strict';

const SITE = 'https://gitsyn.cc';
const APP = 'https://app.gitsyn.cc';

const PROVIDER = process.env.BLOG_LLM_PROVIDER || 'groq';
const IS_GROQ = PROVIDER === 'groq';

const LLM = {
  provider: PROVIDER,
  baseUrl: process.env.BLOG_LLM_BASE_URL
    || (IS_GROQ ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1'),
  keyEnv: IS_GROQ ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY',
  supportsImages: !IS_GROQ,
  tokensPerMinute: Number(process.env.BLOG_LLM_TPM) || (IS_GROQ ? 8000 : 0),
  // Groq's gpt-oss models reason before writing; low effort keeps enough of
  // the output budget for the article itself.
  reasoningEffort: process.env.BLOG_LLM_REASONING_EFFORT || (IS_GROQ ? 'low' : ''),
};

module.exports = {
  SITE,
  APP,
  BLOG_PATH: '/blog',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://xouuijihbdigvicuvwaw.supabase.co',
  MEDIA_BUCKET: 'blog-media',
  GSC_BUCKET: 'blog-gsc',
  LLM,

  MODELS: {
    writer: process.env.BLOG_WRITER_MODEL || (IS_GROQ ? 'openai/gpt-oss-120b' : 'anthropic/claude-sonnet-5.5'),
    fast: process.env.BLOG_FAST_MODEL || (IS_GROQ ? 'openai/gpt-oss-20b' : 'anthropic/claude-haiku-5.5'),
    image: process.env.BLOG_IMAGE_MODEL || (IS_GROQ ? '' : 'google/gemini-3.1-flash-image'),
  },

  LIMITS: {
    minWords: 900,
    maxPostsPer24h: 4,
    recentTopicDays: 7,
    refillSize: 20,
    learnSize: 10,
    minInternalLinks: 3,
    maxInternalLinks: 5,
    maxAppLinks: 1,
    // Groq's free tier allows 8,000 tokens per minute, so both the research
    // context and the requested output have to stay inside that budget.
    maxSources: IS_GROQ ? 4 : 6,
    maxCharsPerSource: IS_GROQ ? 1800 : 7000,
    targetWords: IS_GROQ ? '1,150 to 1,400' : '1,100 to 1,600',
    maxTokens: IS_GROQ
      ? { outline: 2200, draft: 3600, humanize: 4000, links: 3600, refill: 2600, learn: 2400, alt: 220 }
      : { outline: 3500, draft: 9000, humanize: 9000, links: 8000, refill: 4000, learn: 3000, alt: 220 },
    duplicateThreshold: 0.3,
    scheduleHours: 6,
  },

  AUTHOR: {
    slug: 'abubakr-dukuray',
    name: 'Abubakr Dukuray',
    role: 'Founder, GitSyn',
    photo: `${SITE}/images/author-abubakr.png`,
    github: 'https://github.com/Akibly',
    x: 'https://x.com/abubakrdembad',
    site: SITE,
  },
};
