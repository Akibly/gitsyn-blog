'use strict';

const { LIMITS } = require('./config');
const {
  wordCount,
  countCitationMarkers,
  countLinks,
  findPlaceholders,
  numericClaims,
  numericCorpus,
  findBannedPhrases,
  sectionLengths,
  lengthSpread,
  paragraphs,
  similarity,
  claimPresent,
} = require('./text');

function failure(code, message, evidence = []) {
  return { code, message, evidence };
}

const NARRATION_VERBS = 'says|notes|advises|suggests|recommends|stresses|reminds|highlights|explains|adds|warns|argues|points out|encourages|describes|calls|writes|urges';

const SOURCE_NARRATION = new RegExp([
  String.raw`\b(?:the|this)[ \t]+(?:same[ \t]+)?['"“]?[A-Z0-9][^.!?\n]{0,60}?[ \t]+(?:article|guide|blog|site|post|piece|essay|list)\b[^.!?\n]{0,50}?\b(?:${NARRATION_VERBS})\b`,
  String.raw`\b[A-Z][\w’'&-]*(?:[ \t]+[A-Z0-9][\w’'&-]*){0,4}[ \t]+(?:article|guide|blog|site|post|piece|essay)\b[^.!?\n]{0,30}?\b(?:${NARRATION_VERBS})\b`,
  String.raw`\b[A-Z][\w’'&-]*(?:[ \t]+[A-Z0-9][\w’'&-]*){1,4}[ \t]+(?:${NARRATION_VERBS})\b`,
  String.raw`\baccording to (?:the )?['"“]?[A-Z][^.!?\n]{0,60}?\b(?:article|guide|blog|site|post|piece|essay)\b`,
  String.raw`\bas (?:suggested|advised|noted|recommended) by (?:the )?['"“]?[A-Z][^.!?\n]{0,60}?\b(?:article|guide|blog|site|post|piece|essay)\b`,
  String.raw`\bthe article (?:${NARRATION_VERBS})\b`,
].join('|'), 'gi');

const GIT_PRODUCT_CLAIM = /\bGitSyn\s+(?:repositor(?:y|ies)|repos?|branches|commits?|forks?|pull requests?)\b/gi;
const STALE_DETAIL = /\b(?:near future|upcoming (?:event|retreat|session|workshop)|spots? (?:are |is )?(?:available|left|remaining)|tickets? (?:are )?available|waitlist)\b/gi;

/**
 * Voice checks the model keeps failing even after an edit pass: narrating the
 * research instead of giving advice, and inventing Git features GitSyn does
 * not have. These are separate from the publish gate so the pipeline can run
 * one targeted edit before deciding a draft is bad.
 */
function checkVoice(body) {
  const text = String(body || '');
  const failures = [];
  const warnings = [];
  const narration = [...text.matchAll(SOURCE_NARRATION)].map((match) => match[0].trim());
  if (narration.length >= 6) {
    failures.push(failure('source-narration', `The prose narrates its sources ${narration.length} times instead of giving advice.`, narration));
  } else if (narration.length) {
    warnings.push(failure('source-narration', `The prose narrates its sources ${narration.length} time${narration.length === 1 ? '' : 's'}.`, narration));
  }
  const productClaims = [...text.matchAll(GIT_PRODUCT_CLAIM)].map((match) => match[0].trim());
  if (productClaims.length) {
    failures.push(failure('product-claim', 'The post describes GitSyn as a code host with repositories or branches.', productClaims));
  }
  const staleDetails = [...text.matchAll(STALE_DETAIL)].map((match) => match[0].trim());
  if (staleDetails.length) {
    warnings.push(failure('stale-detail', 'The post mentions event dates, availability or prices that will go stale.', staleDetails));
  }
  return { failures, warnings };
}

/**
 * The gate that decides whether a draft can become a post.
 *
 * It checks the things a reader would notice and a model cannot be trusted to
 * police itself on: length, placeholder text, numbers that are not in the
 * research, duplicate content, link counts, meta lengths, citations, and the
 * required honest opinion + limitation. Everything is deterministic.
 *
 * ctx:
 *   minWords, availablePosts, publishedSlugs, existingPosts,
 *   allowedText, duplicateThreshold, requireOpinion
 */
function checkPost(post, ctx = {}) {
  const failures = [];
  const warnings = [];
  const limits = { ...LIMITS, ...ctx };
  const body = String(post.body_md || '');
  const faq = Array.isArray(post.faq) ? post.faq : [];
  const sources = Array.isArray(post.sources) ? post.sources : [];
  const title = String(post.title || '').trim();
  const metaTitle = String(post.meta_title || '').trim();
  const metaDescription = String(post.meta_description || '').trim();
  const allProse = [body, ...faq.map((f) => `${f.question || ''} ${f.answer || ''}`)].join('\n\n');

  const words = wordCount(body);
  if (words < limits.minWords) {
    failures.push(failure('too-short', `Body is ${words} words; the floor is ${limits.minWords}.`));
  }

  if (!title || title.length < 10 || title.length > 140) {
    failures.push(failure('bad-title', 'Title must be between 10 and 140 characters.'));
  }
  if (!metaTitle || metaTitle.length > 60) {
    failures.push(failure('bad-meta-title', 'Meta title is missing or longer than 60 characters.'));
  }
  if (!metaDescription || metaDescription.length > 155) {
    failures.push(failure('bad-meta-description', 'Meta description is missing or longer than 155 characters.'));
  }

  if (findPlaceholders(`${title}\n${metaTitle}\n${metaDescription}\n${allProse}`).length) {
    failures.push(failure('placeholder', 'Draft still contains placeholder text.'));
  }

  const h2s = (body.match(/^\s{0,3}##\s+\S/gm) || []).length;
  if (h2s < 3) {
    failures.push(failure('too-few-sections', `Only ${h2s} H2 sections; at least 3 are needed.`));
  }

  if (!['explain', 'compare', 'how-to'].includes(post.intent)) {
    failures.push(failure('bad-intent', 'Intent must be explain, compare or how-to.'));
  }

  if (!String(post.topic_key || '').trim()) {
    failures.push(failure('missing-topic', 'Topic key is missing.'));
  }

  if (faq.length < 3) {
    failures.push(failure('thin-faq', `FAQ has ${faq.length} entries; at least 3 are needed.`));
  }
  if (faq.length > 8) {
    warnings.push(failure('long-faq', `FAQ has ${faq.length} entries; more than 8 starts to read as filler.`));
  }
  faq.forEach((item, index) => {
    const q = String(item?.question || '').trim();
    const a = String(item?.answer || '').trim();
    if (!q.endsWith('?')) {
      failures.push(failure('faq-question', `FAQ ${index + 1} does not end in a question mark.`));
    }
    if (wordCount(a) < 12) {
      failures.push(failure('faq-answer', `FAQ ${index + 1} answer is too short to be useful.`));
    }
    if (!countCitationMarkers(a).length) {
      failures.push(failure('faq-uncited', `FAQ ${index + 1} answer has no citation and cannot be checked against the research.`));
    }
  });

  const voice = checkVoice(allProse);
  failures.push(...voice.failures);
  warnings.push(...voice.warnings);

  if (/^(?:learn|discover|find out|everything you need|this article)\b/i.test(metaDescription)) {
    warnings.push(failure('filler-meta', 'Meta description opens with a filler phrase instead of the payoff.'));
  }

  const urls = new Set();
  sources.forEach((source, index) => {
    const url = String(source?.url || '').trim();
    if (!/^https:\/\/\S+$/i.test(url)) {
      failures.push(failure('bad-source', `Source ${index + 1} has no https URL.`));
    } else if (urls.has(url)) {
      failures.push(failure('duplicate-source', `Source ${index + 1} repeats ${url}.`));
    }
    urls.add(url);
    if (!String(source?.title || '').trim()) {
      warnings.push(failure('source-title', `Source ${index + 1} has no title.`));
    }
  });
  if (sources.length < 2) {
    failures.push(failure('too-few-sources', `Only ${sources.length} sources; at least 2 are needed.`));
  }

  const cited = countCitationMarkers(`${body}\n${faq.map((f) => f.answer || '').join('\n')}`);
  const outOfRange = cited.filter((n) => n < 1 || n > sources.length);
  if (outOfRange.length) {
    failures.push(failure('bad-citation', `Citations ${outOfRange.join(', ')} point at sources that do not exist.`));
  }
  if (cited.length < Math.min(2, sources.length)) {
    failures.push(failure('uncited', 'Fewer than two sources are cited in the text.'));
  }
  const unused = sources.map((_, i) => i + 1).filter((n) => !cited.includes(n));
  if (unused.length) {
    warnings.push(failure('unused-sources', `Sources ${unused.join(', ')} are listed but never cited.`));
  }

  if (limitedNumbers(ctx)) {
    const allowed = numericCorpus(ctx.allowedText);
    const claims = numericClaims([body, metaDescription, ...faq.map((f) => f.answer || '')].join('\n'));
    const invented = claims.filter((claim) => !allowed.has(claim));
    if (invented.length) {
      failures.push(failure('invented-numbers', `Numbers not found in the research: ${invented.slice(0, 8).join(', ')}.`));
    }
  }

  const links = countLinks(body);
  const available = Number.isFinite(limits.availablePosts) ? limits.availablePosts : 0;
  const minInternal = Math.min(limits.minInternalLinks, available);
  if (links.internalPosts < minInternal) {
    failures.push(failure(
      'too-few-post-links',
      `${links.internalPosts} links to published posts; at least ${minInternal} are needed.`
    ));
  }
  if (links.internalPosts > limits.maxInternalLinks) {
    failures.push(failure(
      'too-many-post-links',
      `${links.internalPosts} links to published posts; at most ${limits.maxInternalLinks} are allowed.`
    ));
  }
  if (links.app > limits.maxAppLinks) {
    failures.push(failure('too-many-app-links', `${links.app} links to the app; at most ${limits.maxAppLinks} is allowed.`));
  }

  if (limits.publishedSlugs && links.urls.length) {
    const known = limits.publishedSlugs instanceof Set
      ? limits.publishedSlugs
      : new Set(limits.publishedSlugs);
    for (const url of links.urls) {
      let parsed;
      try {
        parsed = new URL(url, 'https://gitsyn.cc');
      } catch {
        continue;
      }
      if (parsed.hostname === 'gitsyn.cc' && parsed.pathname.startsWith('/blog/')) {
        const slug = parsed.pathname.replace(/^\/blog\//, '').replace(/\/$/, '');
        if (slug && slug === post.slug) {
          failures.push(failure('self-link', 'Post links to itself.'));
        } else if (slug && !known.has(slug)) {
          failures.push(failure('unknown-internal-link', `Internal link points at an unpublished slug: ${slug}.`));
        }
      }
    }
  }

  if (limits.requireOpinion !== false) {
    const opinion = String(post.opinion || '').trim();
    const limitation = String(post.limitation || '').trim();
    if (!opinion || !claimPresent(body, opinion)) {
      failures.push(failure('missing-opinion', 'The body has no clearly present honest opinion.', [opinion]));
    }
    if (!limitation || !claimPresent(body, limitation)) {
      failures.push(failure('missing-limitation', 'The body has no clearly present limitation.', [limitation]));
    }
  }

  const banned = findBannedPhrases(allProse);
  for (const pattern of banned.hard) {
    failures.push(failure('banned-phrase', `Draft contains a banned phrase matching ${pattern}.`));
  }
  for (const pattern of banned.soft) {
    warnings.push(failure('ai-phrase', `Draft contains an AI-sounding phrase matching ${pattern}.`));
  }
  for (const pattern of banned.fakeFriendly) {
    warnings.push(failure('fake-friendly', `Draft contains fake friendliness matching ${pattern}.`));
  }

  if (post.hero_image_alt) {
    const alt = String(post.hero_image_alt).trim();
    if (alt.length < 10 || alt.length > 220) {
      failures.push(failure('bad-alt', 'Featured image alt text must be 10-220 characters.'));
    }
  } else {
    warnings.push(failure('missing-alt', 'No featured image alt text.'));
  }

  const sections = sectionLengths(body);
  if (sections.length >= 4 && lengthSpread(sections) < 0.2) {
    warnings.push(failure('even-sections', 'Sections are suspiciously even in length.'));
  }

  const intro = paragraphs(body)[0] || '';
  const tail = paragraphs(body).slice(-1)[0] || '';
  if (intro && tail && similarity(intro, tail) > 0.5) {
    warnings.push(failure('restated-thesis', 'The closing paragraph restates the opening too closely.'));
  }

  let duplicate = { score: 0, slug: null };
  if (Array.isArray(ctx.existingPosts) && ctx.existingPosts.length) {
    for (const existing of ctx.existingPosts) {
      const score = similarity(body, existing.body_md || '');
      if (score > duplicate.score) duplicate = { score, slug: existing.slug || null };
    }
    if (duplicate.score > (limits.duplicateThreshold ?? 0.3)) {
      failures.push(failure(
        'duplicate',
        `Draft is ${(duplicate.score * 100).toFixed(0)}% similar to ${duplicate.slug || 'an existing post'}.`
      ));
    }
  }

  if (ctx.existingPosts && ctx.existingPosts.some((p) => p.topic_key && p.topic_key === post.topic_key)) {
    warnings.push(failure('same-topic', 'An existing post shares this topic key.'));
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    stats: {
      words,
      sections: sections.length,
      sectionSpread: Number(lengthSpread(sections).toFixed(2)),
      faq: faq.length,
      sources: sources.length,
      cited: cited.length,
      internalLinks: links.internalPosts,
      appLinks: links.app,
      siteLinks: links.site,
      externalLinks: links.external,
      duplicateScore: Number(duplicate.score.toFixed(3)),
    },
  };
}

function limitedNumbers(ctx) {
  return ctx.enforceNumbers !== false && typeof ctx.allowedText === 'string' && ctx.allowedText.trim().length > 0;
}

module.exports = { checkPost, checkVoice };
