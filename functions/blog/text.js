'use strict';

const crypto = require('node:crypto');
const { SITE, APP } = require('./config');

const STOPWORDS = new Set((
  'a an and are as at be been but by can could did do does for from had has have he her him his how ' +
  'i if in into is it its just like may me might more most my no not of on one or our out over own ' +
  'same she should so some than that the their them then there these they this those to too up us ' +
  'was we were what when where which who why will with would you your yours about after all also any ' +
  'because before being between both each few get got has had here make many much now only other ' +
  'per say says see still such take use used very way well work works year years'
).split(/\s+/));

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\[\d+\]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/^[-:| ]+$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(md) {
  const text = stripMarkdown(md);
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function readingMinutes(words) {
  return Math.max(1, Math.round(words / 220));
}

function slugify(title, maxLength = 70) {
  const ascii = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .toLowerCase();
  let slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-[^-]*$/, '').replace(/-+$/, '');
  }
  return slug || 'post';
}

function uniqueSlug(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  if (!used.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function hashContent(text) {
  return crypto.createHash('sha256').update(stripMarkdown(text).toLowerCase()).digest('hex');
}

function tokens(text) {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function shingleSet(text, size = 4) {
  const list = tokens(text);
  const n = Math.min(size, Math.max(1, list.length));
  const out = new Set();
  for (let i = 0; i + n <= list.length; i += 1) {
    out.add(list.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function similarity(left, right) {
  return jaccard(shingleSet(left), shingleSet(right));
}

function maxSimilarity(text, corpus) {
  let worst = { score: 0, slug: null };
  for (const item of corpus || []) {
    const score = similarity(text, item.body_md || item.body || '');
    if (score > worst.score) worst = { score, slug: item.slug || null };
  }
  return worst;
}

function trimToLength(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max + 1);
  const atSpace = cut.lastIndexOf(' ');
  const base = atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut.slice(0, max);
  return base.replace(/[\s,;:–-]+$/, '');
}

function countCitationMarkers(md) {
  const found = new Set();
  const re = /\[(\d{1,2})\]/g;
  let match;
  while ((match = re.exec(String(md || ''))) !== null) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g;

function countLinks(md) {
  const text = String(md || '');
  const seen = new Set();
  const result = { total: 0, internalPosts: 0, app: 0, site: 0, external: 0, urls: [] };
  let match;
  while ((match = LINK_RE.exec(text)) !== null) {
    const url = match[2];
    if (seen.has(url)) continue;
    seen.add(url);
    result.total += 1;
    result.urls.push(url);
    let parsed;
    try {
      parsed = new URL(url, SITE);
    } catch {
      result.external += 1;
      continue;
    }
    if (parsed.hostname === new URL(APP).hostname) {
      result.app += 1;
    } else if (parsed.hostname === new URL(SITE).hostname) {
      if (parsed.pathname.startsWith('/blog/') && parsed.pathname !== '/blog/') {
        result.internalPosts += 1;
      } else {
        result.site += 1;
      }
    } else {
      result.external += 1;
    }
  }
  return result;
}

const PLACEHOLDER_PATTERNS = [
  /\[(?:todo|tbd|insert[^\]]*|source|citation needed|link|image|placeholder)[^\]]*\]/i,
  /\b(?:lorem ipsum|tbd|to be determined|placeholder text|your name here)\b/i,
  /\{\{[^}]*\}\}/,
  /\bexample\.com\b/i,
  /\bxxx+\b/i,
  /\bas an ai\b/i,
  /\b(?:insert|add) (?:a |the )?(?:link|source|image|quote)\b/i,
];

function findPlaceholders(text) {
  const value = String(text || '');
  return PLACEHOLDER_PATTERNS.filter((re) => re.test(value)).map((re) => re.source);
}

function numericClaims(text) {
  const value = stripMarkdown(text);
  const out = new Set();
  const re = /(?<![\w.])(?:[$£€]\s?)?(\d[\d,]*(?:\.\d+)?)(\s?%|k\b|m\b|bn\b)?/gi;
  let match;
  while ((match = re.exec(value)) !== null) {
    const raw = match[1].replace(/,/g, '');
    const suffix = (match[2] || '').trim().toLowerCase();
    const significant = raw.replace('.', '').length >= 2 || suffix || /[$£€]/.test(match[0]);
    if (!significant) continue;
    out.add(suffix === '%' ? `${raw}%` : raw);
  }
  return [...out];
}

function numericCorpus(text) {
  const value = String(text || '');
  const out = new Set();
  const re = /(\d[\d,]*(?:\.\d+)?)(\s?%)?/g;
  let match;
  while ((match = re.exec(value)) !== null) {
    const raw = match[1].replace(/,/g, '');
    out.add(raw);
    if (match[2]) out.add(`${raw}%`);
  }
  return out;
}

const HARD_BANNED = [
  /\bdelve\b/i,
  /\btestament to\b/i,
  /\bin conclusion\b/i,
];

const SOFT_BANNED = [
  /\bin today'?s (?:fast-paced|digital) world\b/i,
  /\bit'?s important to note\b/i,
  /\bnavigat(?:e|ing) the (?:landscape|world)\b/i,
  /\bunlock(?:ing)? the (?:power|potential)\b/i,
  /\bgame[- ]changer\b/i,
  /\blet'?s dive in\b/i,
  /\bwhen it comes to\b/i,
  /\bat the end of the day\b/i,
  /\bfirst and foremost\b/i,
  /\bneedless to say\b/i,
  /\ba tapestry of\b/i,
  /\bin the realm of\b/i,
  /\bembark on a journey\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bmoreover\b/i,
  /\bfurthermore\b/i,
  /\bthat being said\b/i,
  /\btake it to the next level\b/i,
];

const FAKE_FRIENDLY = [
  /\bgreat question\b/i,
  /\bi'?m glad you asked\b/i,
  /\bhope this helps\b/i,
  /\byou'?ve got this\b/i,
  /\bhappy writing\b/i,
  /\blet'?s get started\b/i,
  /\bwithout further ado\b/i,
];

function findBannedPhrases(text) {
  const value = String(text || '');
  return {
    hard: HARD_BANNED.filter((re) => re.test(value)).map((re) => re.source),
    soft: SOFT_BANNED.filter((re) => re.test(value)).map((re) => re.source),
    fakeFriendly: FAKE_FRIENDLY.filter((re) => re.test(value)).map((re) => re.source),
  };
}

function sectionLengths(md) {
  const lines = String(md || '').split('\n');
  const sections = [];
  let current = { heading: '(intro)', words: 0 };
  for (const line of lines) {
    const heading = /^\s{0,3}##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      sections.push(current);
      current = { heading: heading[1].trim(), words: 0 };
      continue;
    }
    current.words += wordCount(line);
  }
  sections.push(current);
  return sections.filter((s, i) => i > 0 || s.words > 0);
}

function lengthSpread(sections) {
  const counts = sections.map((s) => s.words).filter((n) => n > 0);
  if (counts.length < 2) return 0;
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  return max === 0 ? 0 : (max - min) / max;
}

function paragraphs(md) {
  return String(md || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function containsPhrase(body, phrase, size = 5) {
  const needle = tokens(phrase);
  if (needle.length === 0) return false;
  const n = Math.min(size, needle.length);
  const haystack = shingleSet(body, n);
  for (let i = 0; i + n <= needle.length; i += 1) {
    if (haystack.has(needle.slice(i, i + n).join(' '))) return true;
  }
  return false;
}

/**
 * Is this opinion/limitation actually in the article? An exact word run is the
 * strict answer; otherwise the sentence's own words must overwhelmingly appear
 * inside one passage. Body cleanups reword sentences after the model writes
 * them, so an exact-only test throws away articles that do state the point.
 */
function claimPresent(body, claim, threshold = 0.75) {
  const text = String(claim || '').trim();
  if (!text) return false;
  if (containsPhrase(body, text, 5)) return true;
  const wanted = new Set(tokens(text));
  if (wanted.size < 4) return false;
  return paragraphs(body).some((passage) => {
    const have = new Set(tokens(passage));
    let shared = 0;
    for (const word of wanted) {
      if (have.has(word)) shared += 1;
    }
    return shared / wanted.size >= threshold;
  });
}

function looksLikeQuestion(text) {
  const value = String(text || '').trim();
  return /\?$/.test(value) && value.split(/\s+/).length >= 4;
}

module.exports = {
  STOPWORDS,
  escapeHtml,
  stripMarkdown,
  wordCount,
  readingMinutes,
  slugify,
  uniqueSlug,
  hashContent,
  tokens,
  shingleSet,
  jaccard,
  similarity,
  maxSimilarity,
  trimToLength,
  countCitationMarkers,
  countLinks,
  findPlaceholders,
  numericClaims,
  numericCorpus,
  findBannedPhrases,
  sectionLengths,
  lengthSpread,
  paragraphs,
  containsPhrase,
  claimPresent,
  looksLikeQuestion,
};
