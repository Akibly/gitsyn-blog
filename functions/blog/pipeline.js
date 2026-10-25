'use strict';

const db = require('./db');
const { researchQuestion } = require('./research');
const { chatJson } = require('./llm');
const {
  outlineMessages,
  draftMessages,
  expandMessages,
  humanizeMessages,
  repairNumbersMessages,
  refillMessages,
} = require('./prompts');
const { checkPost } = require('./quality');
const {
  pickCandidates,
  requiredInternalLinks,
  ensureInternalLinks,
  appTarget,
} = require('./links');
const { generateHero } = require('./image');
const {
  slugify,
  uniqueSlug,
  trimToLength,
  wordCount,
  readingMinutes,
  hashContent,
  containsPhrase,
  claimPresent,
  looksLikeQuestion,
  numericClaims,
  numericCorpus,
  countCitationMarkers,
} = require('./text');
const { LIMITS, MODELS, AUTHOR } = require('./config');

const VALID_INTENTS = new Set(['explain', 'compare', 'how-to']);

function isProviderLimit(message) {
  return /rate limit reached|tokens per (?:day|minute)|tpd\)|429|too many requests|(?:tavily|groq|openrouter) 4\d\d/i.test(String(message || ''));
}

/**
 * An outage or a credential problem, not a bad question. A question that was
 * never researched or written cannot be judged, so it goes back to the queue
 * instead of joining the failed list. A search that legitimately returns
 * nothing is still the question's problem and stays failed.
 */
function isEnvironmentFault(message) {
  const text = String(message || '');
  return isProviderLimit(text)
    || /is not set|invalid api key|unauthorized|unauthorised|quota|credits|billing|payment required|service unavailable|overloaded/i.test(text);
}

function tidyText(value) {
  return String(value ?? '')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim();
}

const PUBLICATION = '(?:article|guide|blog|site|post|piece|essay|list)';
const NARRATION = 'notes|says|advises|suggests|recommends|stresses|reminds|explains|adds|warns|argues|points out|encourages|describes|writes|urges|outlines|covers|presents|details|highlights';
const AUDIENCE = 'creators|readers|writers|designers|artists|makers|listeners|authors|us|them';
// Verbs that only ever introduce someone else's opinion. Object-complement
// verbs ("Todd Henry calls the hook the audition") are deliberately absent:
// deleting the name would leave a fragment, so those are left for the edit pass.
const SAY = 'notes|says|said|stresses|emphasizes|adds|explains|argues|writes|urges|suggests|advises|recommends|reminds|warns|highlights|outlines|details|describes|shares|points out';
const NAME = '[A-Z][\\w’\'-]*(?:[ \\t]+[A-Z][\\w\'-]*){1,3}';
// An attribution is only worth deleting when the verb is introducing content:
// "Todd Henry notes that X", "Megan Weeks suggests doing X", "Podbean adds
// “X”". Without this, "Podbean adds a mobile app" loses its subject and the
// sentence stops meaning anything.
const REPORTS = `(?:that[ \\t]+|[“"']|(?=\\w+ing\\b)|to[ \\t]+)`;

/**
 * Rewrite the source-tour sentences a model falls into: "The Wix article notes
 * that X" becomes "X". Only the attribution is removed, so the claim and its
 * citation stay exactly where they were. The result is deterministic, which
 * matters more here than elegance.
 */
function deNarrate(markdown) {
  const text = String(markdown || '').replace(
    /,?\s+(?:which|that)\s+(?:hosts?|offers?|runs?)[^.]*?(?=\s*(?:\[\d+\]|[.;]|$))/gi,
    ''
  );
  const lines = text.split('\n').map((line) => {
    if (/^\s{0,3}#/.test(line)) return line;
    return line
      .split(/(?<=[.!?])\s+/)
      .map(stripAttribution)
      .join(' ');
  });
  return lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function stripAttribution(sentence) {
  let text = sentence
    .replace(new RegExp(`^(?:And\\s+)?(?:The|This|A|An)\\s+(?:same\\s+)?(?:['"“]?[A-Za-z][^,.]{0,60}?\\s+)?${PUBLICATION}['"”?]?\\s+(?:also\\s+)?(?:${NARRATION})(?:\\s+(?:${AUDIENCE}))?\\s+(?:that\\s+|to\\s+)?`, 'i'), '')
    .replace(new RegExp(`^(?:The|This)\\s+[A-Z][^,.]{0,40}?\\s+(?:reminds|tells|urges|warns|advises)\\s+(?:${AUDIENCE})\\s+(?:that\\s+|to\\s+)?`, 'i'), '')
    .replace(new RegExp(`^(?:And\\s+|But\\s+|So\\s+)?${NAME}\\s+(?:also\\s+)?(?:${SAY})\\s+${REPORTS}`, 'i'), '')
    .replace(new RegExp(`^(?:And\\s+|But\\s+|So\\s+)?(?!Everyone|Someone|Anyone|No\\s|Many|Most|Some|All|They|These|Those|He|She|We\\b)[A-Z][\\w’'-]*\\s+(?:also\\s+)?(?:${SAY})\\s+that\\s+`, 'i'), '')
    .replace(new RegExp(`([.,;:”"]?\\s*)((?:and|but|while|whereas|so)\\s+)(?:${NAME}|[A-Z][\\w’'-]*)\\s+(?:also\\s+)?(?:${SAY})\\s+${REPORTS}`, 'gi'), (_, punctuation, conjunction) => `${punctuation}${conjunction}`)
    .replace(/^According to (?:the )?[^,]{1,70}?,\s*/i, '')
    .replace(/^As (?:suggested|advised|noted|recommended) by (?:the )?[^,]{1,70}?,\s*/i, '')
    .replace(/(?:,\s*)?with the latest update noted in the article\b/gi, '')
    .replace(/,\s+noting that\s+/gi, ', because ')
    .replace(new RegExp(`(?:,\\s*)?(?:and|while)\\s+the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION}\\s+highlights\\s+(?:the\\s+)?`, 'gi'), ', and there is an ')
    .replace(new RegExp(`(?:,\\s*)?(?:and|while)\\s+the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION}\\s+(?:${NARRATION})\\s+that\\s+`, 'gi'), ', and ')
    .replace(new RegExp(`(?:;|,)\\s*(?:and\\s+)?the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION}\\s+recommends\\s+(?:that\\s+)?`, 'gi'), '; the recommendation is ')
    .replace(new RegExp(`(?:,\\s*)?the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION}\\s+advises\\s+(\\w+ing)\\b`, 'gi'), (_, gerund) => `, ${gerundToBase(gerund)}`)
    .replace(new RegExp(`(?:,\\s*)?according to the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION},\\s+which\\s+`, 'gi'), ', which ')
    .replace(new RegExp(`(?:,\\s*)?as (?:suggested|advised|noted|recommended) by the\\s+[A-Z][^,.]{0,60}?\\s+${PUBLICATION}\\b`, 'gi'), '')
    .replace(new RegExp(`described in (?:the\\s+)?[A-Z][^,.]{0,60}?\\s+narrative about\\s+`, 'gi'), 'that comes from ');

  // A strip can leave a sentence whose real subject was the source, a second
  // verb with nobody to do it, or a stub too short to stand alone. Garbled
  // prose is worse than a narrating sentence, so put the original back.
  const wasStripped = text !== sentence;
  const remaining = text.split(/\s+/).filter((word) => /[\w’']/.test(word)).length;
  const subjectless = new RegExp(
    `\\s+(?:and|but|or|while|whereas|so)\\s+(?:[\\w’'-]+\\s+){0,3}(?:${NARRATION}|${SAY}|points?|calls?|frames?|tells?)\\b`,
    'i'
  ).test(text);
  if (wasStripped && (remaining < 4 || subjectless || /^(?:this|these|that|those|such|it)\b/i.test(text))) {
    return sentence.trim();
  }

  // "The guide advises keeping each section concise" becomes "Keeping each
  // section concise", which is a fragment, not advice. Only a gerund whose
  // imperative is known can be rewritten: "having" in "having an email list
  // would have given them…" was the sentence's subject, and forcing it into
  // an imperative breaks the grammar. Keep the original instead.
  if (wasStripped) {
    const gerund = /^(\w+ing)\b/.exec(text);
    if (gerund) {
      const base = GERUND_BASE[gerund[1].toLowerCase()];
      if (!base) return sentence.trim();
      text = text.replace(/^(\w+ing)\b/, (word) => base);
    }
  }

  text = text.replace(/^([a-z])/, (first) => first.toUpperCase());
  return text
    .replace(/\s*[—–-]\s*\./g, '.')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const GERUND_BASE = {
  establishing: 'establish', sharing: 'share', making: 'make', using: 'use', keeping: 'keep',
  posting: 'post', asking: 'ask', setting: 'set', writing: 'write', creating: 'create',
  publishing: 'publish', planning: 'plan', starting: 'start', choosing: 'choose', giving: 'give',
  taking: 'take', adding: 'add', building: 'build', testing: 'test', saving: 'save',
  narrowing: 'narrow', focusing: 'focus', showing: 'show', telling: 'tell', turning: 'turn',
  running: 'run', cutting: 'cut', pricing: 'price', selling: 'sell', pitching: 'pitch',
  sending: 'send', reviewing: 'review', naming: 'name', listing: 'list', limiting: 'limit',
  scheduling: 'schedule', measuring: 'measure', tracking: 'track', treating: 'treat',
};

function gerundToBase(gerund) {
  return GERUND_BASE[String(gerund || '').toLowerCase()] || `it is worth ${gerund}`;
}

function cleanProductClaims(markdown) {
  return String(markdown || '')
    .replace(/\b(?:a |the )?private GitSyn (?:repository|repo)\b/gi, 'your platform’s own project space')
    .replace(/\bGitSyn (?:repository|repo)\b/gi, 'project space')
    .replace(/\bcommit(?:ting)? (?:the|your) (?:current )?(?:state|changes|work) to a (?:private )?branch\b/gi, 'save the current state to a private copy')
    .replace(/\bcommitting and tagging\b/gi, 'saving and labelling')
    .replace(/\bprivate branch\b/gi, 'private copy')
    .replace(/\btag it with a date\b/gi, 'label it with a date');
}

function assertOutline(outline, sourceCount) {
  if (!outline || typeof outline !== 'object') throw new Error('Outline was not an object.');
  if (!Array.isArray(outline.sections) || outline.sections.length < 3) {
    throw new Error('Outline has fewer than 3 sections.');
  }
  if (!VALID_INTENTS.has(outline.intent)) outline.intent = 'how-to';
  const sections = outline.sections
    .filter((section) => section && (section.heading || section.purpose))
    .slice(0, 9);
  if (sections.length < 3) throw new Error('Outline sections are malformed.');
  outline.sections = sections;
  outline.sections.forEach((section) => {
    if (!Array.isArray(section.source_indexes)) section.source_indexes = [];
    section.source_indexes = section.source_indexes
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount);
  });
  return outline;
}

function assertDraft(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('Draft was not an object.');
  if (!String(draft.title || '').trim()) throw new Error('Draft has no title.');
  if (String(draft.body_md || '').trim().length < 400) throw new Error('Draft body is too short to be an article.');
  draft.faq = normaliseFaq(draft.faq);
  return draft;
}

function normaliseFaq(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item) return null;
      const question = tidyText(item.question ?? item.q ?? '');
      const answer = deNarrate(cleanProductClaims(tidyText(item.answer ?? item.a ?? '')));
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * The opinion and limitation are quoted back at the reader as their own lines,
 * so they must go through the same prose cleanup as the body. Comparing an
 * uncleaned sentence against a cleaned body makes a present claim look absent.
 */
function cleanClaim(value) {
  return deNarrate(cleanProductClaims(tidyText(value))).trim();
}

/**
 * Keep the article's own words when the claim is in them; otherwise fall back
 * to the draft's version, and if the claim only ever existed in the structured
 * fields, close the article with it. Free models drop the limitation line from
 * the prose often enough that losing the whole run costs more than one sentence.
 */
function placeClaim(body, { preferred, fallback, label, notes }) {
  for (const candidate of [preferred, fallback]) {
    if (candidate && claimPresent(body, candidate)) return { body, text: candidate };
  }
  const first = preferred || fallback || '';
  if (first) {
    notes.push(`${label} was not in the prose; it was added as a closing line.`);
    return { body: `${body}\n\n${first}`.trim(), text: first };
  }
  return { body, text: '' };
}

function dropUncitedFaq(faq) {
  const cited = (faq || []).filter((item) => countCitationMarkers(item.answer).length > 0);
  return cited.length >= 3 ? cited : (faq || []);
}

function cleanBody(markdown) {
  let body = tidyText(String(markdown || '').replace(/\r\n/g, '\n')).trim();
  body = body.replace(/^\s{0,3}#\s+[^\n]+\n+/, '');
  for (const heading of ['FAQ', 'Frequently asked questions', 'Sources', 'References', 'Meta description']) {
    const re = new RegExp(`^\\s{0,3}(?:#{1,6}\\s*|\\*\\*)?${heading}\\s*:?\\s*(?:\\*\\*)?\\s*$`, 'im');
    const match = re.exec(body);
    if (match) body = body.slice(0, match.index).trim();
  }
  body = body.replace(
    /\*\*(?:concrete step|trade-?off|tip|key takeaway|action|example):\*\*\s*([a-z])/gi,
    (_, first) => first.toUpperCase()
  );
  body = deNarrate(cleanProductClaims(body));
  return body.trim();
}

/**
 * Drop a closing paragraph that only repeats the opinion or limitation already
 * stated earlier. Models like to tack both on as a summary, which reads as a
 * duplicated sentence to anyone scrolling.
 */
function dropTrailingRepeat(body, phrase) {
  const text = String(phrase || '').trim();
  if (!text) return body;
  const paragraphs = String(body || '').split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1]?.trim();
  if (!last || !containsPhrase(last, text, 5)) return body;
  if (wordCount(last) > wordCount(text) + 12) return body;
  const rest = paragraphs.slice(0, -1).join('\n\n').trim();
  return containsPhrase(rest, text, 5) ? rest : body;
}

function pickMetaTitle(candidate, title) {
  const clean = trimToLength(tidyText(candidate || ''), 60);
  if (clean.length >= 10) return clean;
  return trimToLength(tidyText(title || 'GitSyn'), 60);
}

function pickMetaDescription(candidate, excerpt, title) {
  let description = trimToLength(tidyText(candidate || ''), 155);
  if (/^(?:learn|discover|find out|everything you need|this article)\b/i.test(description)) {
    const fallback = trimToLength(tidyText(excerpt || ''), 155);
    if (fallback.length >= 60) description = fallback;
  }
  if (description.length < 60 && excerpt) {
    description = trimToLength(`${description} ${tidyText(excerpt)}`.trim(), 155);
  }
  if (description.length < 30) {
    description = trimToLength(`${tidyText(title) || 'A practical guide'} — practical notes from GitSyn.`, 155);
  }
  return description;
}

function questionKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normaliseQuestionItem(item, existingKeys, existingTopics, batchKeys, batchTopics) {
  if (!item || typeof item !== 'object') return null;
  let question = String(item.question || '').trim().replace(/\s+/g, ' ');
  if (!looksLikeQuestion(question)) {
    if (question.split(/\s+/).length < 6) return null;
    question = `${question.replace(/[.?!]+$/, '')}?`;
  }
  if (question.length < 8 || question.length > 240) return null;
  const key = questionKey(question);
  if (!key || existingKeys.has(key) || batchKeys.has(key)) return null;
  const topicKey = slugify(item.topic_key || question, 48);
  if (existingTopics.has(topicKey) || batchTopics.has(topicKey) || existingKeys.has(topicKey)) return null;
  batchKeys.add(key);
  batchTopics.add(topicKey);
  return {
    question,
    topic_key: topicKey,
    intent: VALID_INTENTS.has(item.intent) ? item.intent : 'how-to',
    priority: Math.min(5, Math.max(1, Number(item.priority) || 3)),
    notes: item.notes ? String(item.notes).slice(0, 400) : null,
  };
}

/**
 * Ask the model for fresh questions, drop anything already queued or on a
 * recently covered topic, and insert the rest. Returns what was inserted.
 */
async function refillQueue({
  client,
  apiKey,
  model = MODELS.fast,
  count = LIMITS.refillSize,
  source = 'refill',
  fetchImpl,
}) {
  const [existing, recentTopics, recentPosts] = await Promise.all([
    db.queuedQuestions(client, 300),
    db.recentTopics(client, LIMITS.recentTopicDays),
    db.publishedPosts(client, 12),
  ]);

  const existingKeys = new Set(existing.map((item) => questionKey(item.question)));
  const existingTopics = new Set(existing.map((item) => item.topic_key).filter(Boolean));
  recentTopics.forEach((post) => post.topic_key && existingTopics.add(post.topic_key));

  const result = await chatJson({
    apiKey,
    model,
    messages: refillMessages({
      count,
      existingQuestions: existing.map((item) => item.question),
      recentPosts,
      recentTopics: [...new Set(recentTopics.map((post) => post.topic_key).filter(Boolean))],
    }),
    temperature: 0.9,
    maxTokens: LIMITS.maxTokens.refill,
    fetchImpl,
  });

  const raw = Array.isArray(result.json?.questions) ? result.json.questions : [];
  const batchKeys = new Set();
  const batchTopics = new Set();
  const items = [];
  for (const item of raw) {
    const clean = normaliseQuestionItem(item, existingKeys, existingTopics, batchKeys, batchTopics);
    if (clean) items.push(clean);
    if (items.length >= count) break;
  }

  const inserted = items.length ? await db.enqueueQuestions(client, items, source) : 0;
  return {
    requested: count,
    proposed: raw.length,
    inserted,
    questions: items.map((item) => item.question),
  };
}

/**
 * One generation run: claim, research, plan, draft, humanize, link, illustrate,
 * gate, save. Never throws for a normal failure — the run row records it and
 * the question is marked failed so the queue moves on.
 */
async function runGeneration({
  client,
  llmKey,
  tavilyKey,
  fetchImpl,
  forceStatus = null,
  trigger = 'manual',
}) {
  const runId = await db.startRun(client, 'generate', { trigger });
  let question = null;
  let savedPost = null;
  let stage = 'settings';
  let notes = [];

  try {
    const cfg = await db.settings(client);
    const stats = await db.queueStats(client);
    const usedToday = (stats?.published_24h || 0) + (stats?.drafted_24h || 0);

    if (usedToday >= cfg.max_posts_per_day) {
      await db.finishRun(client, runId, {
        status: 'skipped',
        detail: { reason: 'daily-cap', usedToday, cap: cfg.max_posts_per_day },
      });
      return { status: 'skipped', reason: 'daily-cap', runId, stats };
    }

    stage = 'claim';
    question = await db.claimQuestion(client, runId, cfg.recent_topic_days);

    let refill = null;
    if (!question && (stats?.queued || 0) === 0) {
      stage = 'refill';
      refill = await refillQueue({
        client,
        apiKey: llmKey,
        count: cfg.refill_size,
        fetchImpl,
      });
      question = await db.claimQuestion(client, runId, cfg.recent_topic_days);
    }

    if (!question) {
      await db.finishRun(client, runId, {
        status: 'skipped',
        detail: { reason: 'empty-queue', refill },
      });
      return { status: 'skipped', reason: 'empty-queue', runId, refill, stats };
    }

    stage = 'research';
    const research = await researchQuestion({
      question: question.question,
      topicKey: question.topic_key,
      apiKey: tavilyKey,
      fetchImpl,
    });

    stage = 'context';
    const [published, corpus, targets, allSlugs, author] = await Promise.all([
      db.publishedPosts(client, 40),
      db.dedupeCorpus(client, 40),
      db.linkTargets(client),
      db.allSlugs(client),
      db.author(client, AUTHOR.slug),
    ]);
    if (!author) throw new Error('The blog author row is missing. Apply the blog migration seed first.');

    stage = 'outline';
    // Outline and link insertion are structural, so they run on the fast model:
    // Groq meters each model's free token budget separately, and every call
    // moved off the writer is budget the article itself can spend.
    const planned = await chatJson({
      apiKey: llmKey,
      model: MODELS.fast,
      messages: outlineMessages({
        question: question.question,
        intentHint: question.intent,
        research: research.sources,
        publishedPosts: published,
      }),
      temperature: 0.4,
      maxTokens: LIMITS.maxTokens.outline,
      fetchImpl,
    });
    const outline = assertOutline(planned.json, research.sources.length);

    stage = 'draft';
    const candidates = pickCandidates(published, {
      topicKey: question.topic_key,
      title: outline.working_title,
      limit: 5,
    });
    const drafted = await chatJson({
      apiKey: llmKey,
      model: MODELS.writer,
      messages: draftMessages({
        question: question.question,
        outline,
        research: research.sources,
        publishedPosts: candidates,
        appTarget: appTarget(targets),
        targetWords: LIMITS.targetWords,
      }),
      temperature: 0.7,
      maxTokens: LIMITS.maxTokens.draft,
      fetchImpl,
    });
    let draft = assertDraft(drafted.json);
    let draftBody = cleanBody(draft.body_md);

    for (let attempt = 0; attempt < 2 && wordCount(draftBody) < cfg.min_words; attempt += 1) {
      stage = 'expand';
      const shortWords = wordCount(draftBody);
      const expanded = await chatJson({
        apiKey: llmKey,
        model: MODELS.writer,
        messages: expandMessages({ draft, research: research.sources, minWords: cfg.min_words }),
        temperature: 0.5,
        maxTokens: LIMITS.maxTokens.draft,
        fetchImpl,
      });
      const expandedBody = cleanBody(expanded.json?.body_md);
      if (!expandedBody || wordCount(expandedBody) <= shortWords) break;
      draft = {
        ...draft,
        body_md: expanded.json.body_md,
        faq: normaliseFaq(expanded.json.faq?.length >= 3 ? expanded.json.faq : draft.faq),
        opinion: expanded.json.opinion || draft.opinion,
        limitation: expanded.json.limitation || draft.limitation,
      };
      draftBody = cleanBody(draft.body_md);
      notes.push(`Draft expanded from ${shortWords} to ${wordCount(draftBody)} words.`);
    }

    stage = 'humanize';
    let human = null;
    let humanError = null;
    for (let attempt = 0; attempt < 2 && !human; attempt += 1) {
      try {
        const edited = await chatJson({
          apiKey: llmKey,
          model: MODELS.writer,
          messages: humanizeMessages({ draft, question: question.question, minWords: cfg.min_words }),
          temperature: 0.6,
          maxTokens: LIMITS.maxTokens.humanize,
          fetchImpl,
        });
        const candidateBody = cleanBody(edited.json?.body_md);
        if (wordCount(candidateBody) >= cfg.min_words) human = edited.json;
        else humanError = `Humanize attempt ${attempt + 1} returned ${wordCount(candidateBody)} words.`;
      } catch (error) {
        humanError = error.message;
      }
    }
    if (!human) {
      if (wordCount(draftBody) >= cfg.min_words) {
        notes.push(`Humanize pass came back short (${humanError || 'no usable body'}); kept the draft body.`);
        human = {
          body_md: draft.body_md,
          faq: draft.faq,
          opinion: draft.opinion,
          limitation: draft.limitation,
        };
      } else {
        throw new Error(`Humanize pass failed: ${humanError || 'no usable body'} (draft was ${wordCount(draftBody)} words)`);
      }
    }

    let body = cleanBody(human.body_md) || draftBody;
    let faq = normaliseFaq(human.faq?.length >= 3 ? human.faq : draft.faq);
    const faqBeforeDrop = faq.length;
    faq = dropUncitedFaq(faq);
    if (faq.length < faqBeforeDrop) {
      notes.push(`Dropped ${faqBeforeDrop - faq.length} FAQ answer${faqBeforeDrop - faq.length === 1 ? '' : 's'} with no citation.`);
    }

    const opinionClaim = placeClaim(body, {
      preferred: cleanClaim(human.opinion),
      fallback: cleanClaim(draft.opinion),
      label: 'Opinion',
      notes,
    });
    body = opinionClaim.body;
    let opinion = opinionClaim.text;

    const limitationClaim = placeClaim(body, {
      preferred: cleanClaim(human.limitation),
      fallback: cleanClaim(draft.limitation),
      label: 'Limitation',
      notes,
    });
    body = limitationClaim.body;
    let limitation = limitationClaim.text;

    stage = 'links';
    const required = requiredInternalLinks(published.length, cfg);
    const linked = await ensureInternalLinks({
      body,
      candidates,
      required,
      chatJson,
      model: MODELS.fast,
      apiKey: llmKey,
      maxTokens: LIMITS.maxTokens.links,
      fetchImpl,
    });
    body = linked.body;
    body = dropTrailingRepeat(body, limitation);
    body = dropTrailingRepeat(body, opinion);

    stage = 'image';
    const title = tidyText(draft.title || outline.working_title);
    const slug = uniqueSlug(slugify(title), allSlugs);
    const hero = await generateHero({
      client,
      apiKey: llmKey,
      model: MODELS.image,
      fastModel: MODELS.fast,
      title,
      thesis: outline.thesis,
      intent: outline.intent,
      slug,
      fetchImpl,
    });
    if (!hero.generated && !hero.skipped) notes.push(`Hero fallback used: ${hero.error}`);
    if (linked.repaired) notes.push('Internal links were repaired in a second edit.');

    stage = 'gate';
    const status = forceStatus === 'published' ? 'published' : (forceStatus === 'draft' ? 'draft' : (cfg.auto_publish ? 'published' : 'draft'));
    const publishNow = status === 'published';
    let words = wordCount(body);
    const post = {
      slug,
      title,
      meta_title: pickMetaTitle(draft.meta_title, title),
      meta_description: pickMetaDescription(draft.meta_description, draft.excerpt, title),
      excerpt: trimToLength(tidyText(draft.excerpt || ''), 220),
      body_md: body,
      intent: outline.intent,
      topic_key: question.topic_key,
      faq,
      sources: research.sources.map((source) => ({
        url: source.url,
        title: source.title,
        snippet: source.snippet,
      })),
      hero_image_url: hero.url,
      hero_image_alt: tidyText(hero.alt),
      author_id: author.id,
      status,
      word_count: words,
      reading_minutes: readingMinutes(words),
      content_hash: hashContent(body),
      published_at: publishNow ? new Date().toISOString() : null,
      opinion,
      limitation,
    };

    const gateCtx = {
      minWords: cfg.min_words,
      availablePosts: published.length,
      publishedSlugs: new Set(published.map((entry) => entry.slug)),
      existingPosts: corpus,
      allowedText: research.allowedText,
      duplicateThreshold: cfg.duplicate_threshold || LIMITS.duplicateThreshold,
      requireOpinion: true,
    };
    let gate = checkPost(post, gateCtx);

    for (let attempt = 0; attempt < 2 && !gate.ok; attempt += 1) {
      if (!gate.failures.length || !gate.failures.every((failure) => failure.code === 'invented-numbers')) break;
      stage = 'repair-numbers';
      const allowed = numericCorpus(research.allowedText);
      const invented = numericClaims([
        body,
        post.meta_description,
        ...faq.map((item) => item.answer || ''),
      ].join('\n')).filter((claim) => !allowed.has(claim));
      if (!invented.length) break;

      const repaired = await chatJson({
        apiKey: llmKey,
        model: MODELS.writer,
        messages: repairNumbersMessages({
          body,
          faq,
          metaDescription: post.meta_description,
          numbers: invented,
          opinion,
          limitation,
        }),
        temperature: 0.3,
        maxTokens: LIMITS.maxTokens.humanize,
        fetchImpl,
      });
      const repairedBody = cleanBody(repaired.json?.body_md);
      if (!repairedBody || wordCount(repairedBody) < Math.ceil(cfg.min_words * 0.9)) break;

      body = repairedBody;
      faq = normaliseFaq(repaired.json?.faq?.length >= 3 ? repaired.json.faq : faq);
      const safeFaq = faq.filter((item) => numericClaims(`${item.question} ${item.answer}`)
        .every((claim) => allowed.has(claim)));
      if (safeFaq.length >= 3) faq = safeFaq;

      const repairedOpinion = placeClaim(body, {
        preferred: cleanClaim(repaired.json?.opinion),
        fallback: opinion,
        label: 'Opinion',
        notes,
      });
      body = repairedOpinion.body;
      opinion = repairedOpinion.text;

      const repairedLimitation = placeClaim(body, {
        preferred: cleanClaim(repaired.json?.limitation),
        fallback: limitation,
        label: 'Limitation',
        notes,
      });
      body = repairedLimitation.body;
      limitation = repairedLimitation.text;

      const repairedMeta = pickMetaDescription(repaired.json?.meta_description, post.excerpt, title);
      post.body_md = body;
      post.meta_description = numericClaims(repairedMeta).every((claim) => allowed.has(claim))
        ? repairedMeta
        : pickMetaDescription('', '', title);
      post.faq = faq;
      post.opinion = opinion;
      post.limitation = limitation;
      words = wordCount(body);
      post.word_count = words;
      post.reading_minutes = readingMinutes(words);
      post.content_hash = hashContent(body);
      gate = checkPost(post, gateCtx);
      notes.push(`Removed unsupported numbers: ${invented.join(', ')}.`);
    }

    post.quality = {
      ...gate.stats,
      warnings: gate.warnings.map((warning) => warning.code),
    };

    if (!gate.ok) {
      await db.failQuestion(client, question.id, gate.failures.map((f) => `${f.code}: ${f.message}`).join(' | '));
      await db.finishRun(client, runId, {
        status: 'failed',
        questionId: question.id,
        detail: {
          reason: 'quality-gate',
          failures: gate.failures,
          warnings: gate.warnings,
          stats: gate.stats,
          slug,
          notes,
        },
      });
      return { status: 'failed', reason: 'quality-gate', runId, question, gate, notes };
    }

    stage = 'publish';
    savedPost = await db.publishPost(client, post, question.id);
    try {
      await db.insertResearch(client, savedPost.id, research.sources);
    } catch (error) {
      notes.push(`Research rows not saved: ${error.message}`);
    }

    await db.finishRun(client, runId, {
      status: 'ok',
      questionId: question.id,
      postId: savedPost.id,
      detail: {
        trigger,
        status,
        slug,
        words,
        sources: research.sources.length,
        links: gate.stats,
        notes,
        usage: { outline: planned.usage, draft: drafted.usage, humanize: null },
      },
    });

    return { status: publishNow ? 'published' : 'drafted', runId, question, post: savedPost, gate, notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (question && !savedPost) {
      try {
        // A provider limit or a credential problem is not the question's fault.
        // Putting it back in the queue keeps the failed list honest about real
        // rejections.
        if (isEnvironmentFault(message)) {
          await db.requeueQuestion(client, question.id);
        } else {
          await db.failQuestion(client, question.id, `${stage}: ${message}`);
        }
      } catch {
        /* the run log below is the source of truth */
      }
    }
    try {
      await db.finishRun(client, runId, {
        status: 'failed',
        questionId: question?.id,
        postId: savedPost?.id,
        error: `${stage}: ${message}`,
        detail: { stage, notes },
      });
    } catch {
      /* nothing else to do */
    }
    return { status: 'failed', reason: stage, error: message, runId, question, notes };
  }
}

async function publishDraft({ client, slug }) {
  const existing = await db.postBySlug(client, slug, { includeDrafts: true });
  if (!existing) throw new Error(`No post with slug ${slug}.`);
  const post = {
    slug: existing.slug,
    title: existing.title,
    meta_title: existing.meta_title,
    meta_description: existing.meta_description,
    excerpt: existing.excerpt,
    body_md: existing.body_md,
    body_html: existing.body_html,
    intent: existing.intent,
    topic_key: existing.topic_key,
    faq: existing.faq,
    sources: existing.sources,
    hero_image_url: existing.hero_image_url,
    hero_image_alt: existing.hero_image_alt,
    author_id: existing.author_id,
    status: 'published',
    word_count: existing.word_count,
    reading_minutes: existing.reading_minutes,
    quality: existing.quality,
    content_hash: existing.content_hash,
    published_at: existing.published_at || new Date().toISOString(),
  };
  return db.publishPost(client, post, existing.question_id);
}

module.exports = {
  runGeneration,
  refillQueue,
  publishDraft,
  cleanBody,
  cleanClaim,
  placeClaim,
  tidyText,
  deNarrate,
  dropUncitedFaq,
  dropTrailingRepeat,
  normaliseFaq,
  pickMetaTitle,
  pickMetaDescription,
  normaliseQuestionItem,
  questionKey,
  assertOutline,
  assertDraft,
  isProviderLimit,
  isEnvironmentFault,
};
