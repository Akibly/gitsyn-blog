'use strict';

const { SITE, APP } = require('./config');

const SITE_BRIEF = [
  'GitSyn is a home for creative work while it is still being made. People start a project in one of 15 disciplines — writing, music, visual art, design, film, photography, comics, podcasting, games, software, research, teaching and more — move it through stages, and publish it in parts (chapters, tracks, episodes, releases, cuts, lessons).',
  'It is free and runs in any browser at https://app.gitsyn.cc. A built-in reader shows long-form work as pages. Syn, the assistant, is opt-in and AI involvement is labelled. The founder is Abubakr Dukuray, and the blog is written by him.',
  'The marketing site is https://gitsyn.cc.',
].join(' ');

const HOUSE_RULES = `
House style — follow all of it:
- British English (organise, colour, labelled), except inside quoted source titles.
- Answer the question directly in the first paragraph, with no heading above it. Two to four sentences. A reader who stops there should have the answer.
- Use only facts, numbers, dates, names and quotes that appear in the numbered research. Put the citation marker immediately after the claim, like this: [2]. Never cite a number that is not a research item.
- Write advice in your own voice, not as a tour of the research. Never write "the article says", "the guide notes", "according to [source title]", "source [1] recommends", or repeat a source title in the prose. Name a source at most twice in the article, and only when its specific experience is the point. A citation marker alone is enough attribution.
- The research is a source of facts, not a set of texts to summarise. Decide what the reader should do, say it directly, then cite the number that supports it. Do not describe what a source covers.
- Do not begin two sections the same way. Start from the reader's decision or the work, not from where the idea came from.
- GitSyn is a project site, not a code host. Never say GitSyn has repositories, branches, commits, tags, forks or pull requests, and do not give Git commands as general creative advice. For backups, say save dated copies or use the platform's own version history.
- Do not mention upcoming events, retreat dates, ticket availability, waitlists or current prices. They go stale and are not what the reader came for.
- Every digit in the article — dimensions, percentages, prices, dates, times, counts — must appear in the research exactly as written. If a figure is not there, write the sentence without it. Never round, convert, estimate, or add a figure from general knowledge, even one you are confident about.
- If the research is thin or disagrees with itself, say so plainly instead of filling the gap. Never invent a study, a statistic, a person, a book, a quote or an anecdote.
- Include one honest opinion, in the author's voice, and one real limitation of the advice. Both must be visible in the prose, not in a labelled box.
- Do not open with "In this article", "When it comes to", "In today's...", or a rhetorical question. Do not end with a conclusion section or restate the opening.
- No emojis. No exclamation marks unless quoting. No fake friendliness ("Great question", "Hope this helps", "You've got this").
- No bold labels such as **Concrete step:**, **Trade-off:**, **Tip:**, **Key takeaway:**, **Action:** or **Example:**. Fold the action or caveat into a normal sentence.
- The title must not promise a number of steps or ways ("Four Simple Steps", "7 Ways"), and must not use "simple", "ultimate", "complete" or "everything you need". Say what the article actually settles.
- Banned phrases: delve, testament to, in conclusion, it's important to note, a tapestry of, in the realm of, embark on a journey, game-changer, unlock the power, let's dive in.
- The meta description states the payoff in plain terms. Do not open with "Learn how to", "Discover", "This article", or "Everything you need".
- Markdown only: ## for sections, ### for subsections, short paragraphs (one to four sentences), bullet lists where a list is genuinely clearer. No tables, no code blocks, no H1.
- Vary section lengths and sentence lengths. Three sentences of the same shape in a row is a tell.
- Paragraphs should carry an example, a number from the research, a named thing, or a decision the reader can make. Cut any paragraph that only says "it is important to".
`.trim();

function systemWriter(extra = '') {
  return [
    'You are Abubakr Dukuray, founder of GitSyn, writing the GitSyn blog. You are a careful editor, not a content marketer. You would rather leave a fact out than guess it.',
    SITE_BRIEF,
    HOUSE_RULES,
    extra,
  ].filter(Boolean).join('\n\n');
}

function researchDigest(sources) {
  return sources.map((source, index) => {
    return [
      `[${index + 1}] ${source.title || 'Untitled'}`,
      source.url,
      source.content,
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
}

function outlineMessages({ question, intentHint, research, publishedPosts }) {
  const candidates = (publishedPosts || []).length
    ? publishedPosts.map((p) => `- ${p.title}`).join('\n')
    : '- none yet';
  return [
    { role: 'system', content: systemWriter() },
    {
      role: 'user',
      content: `Question to answer: "${question}"
${intentHint ? `Likely search intent: ${intentHint}. Decide for yourself; change it if the research points elsewhere.` : 'Decide the search intent yourself: explain, compare or how-to.'}

Research (cite these by number):
${researchDigest(research)}

Published posts on the blog so far:
${candidates}

Plan the article before writing it. Return JSON only, with this shape:
{
  "intent": "explain" | "compare" | "how-to",
  "working_title": "specific, plain, no colon unless it earns it",
  "thesis": "one sentence the article will defend",
  "sections": [
    { "heading": "## heading text", "purpose": "what this section settles", "source_indexes": [1, 2] }
  ],
  "faq": [
    { "question": "a real follow-up question, ending in ?", "source_indexes": [1] }
  ],
  "opinion": "one sentence of honest judgement the author can defend",
  "limitation": "one sentence naming where this advice breaks down"
}

Rules for the plan:
- 6 to 8 sections, in an order a person would actually read. How-to plans follow the order of the work; compare plans give each option its own section; explain plans move from mechanism to consequences.
- Each section should have enough substance for 150 to 220 words. If a section can only support one short paragraph, merge it with a neighbour.
- Every section must have at least one research index, and every source should be used at least once.
- 4 to 6 FAQ questions that are different from the section headings.
- The opinion and the limitation must be specific to this question, not generic advice.`,
    },
  ];
}

function draftMessages({ question, outline, research, publishedPosts, appTarget, targetWords }) {
  const candidates = (publishedPosts || []).length
    ? publishedPosts.map((p) => `- ${SITE}/blog/${p.slug} — ${p.title}${p.excerpt ? `. ${p.excerpt}` : ''}`).join('\n')
    : '- There are no published posts yet. Do not invent any.';
  const appLine = appTarget
    ? `- ${appTarget.url} — ${appTarget.label}. ${appTarget.description || ''}`
    : `- ${APP} — GitSyn.`;
  return [
    { role: 'system', content: systemWriter() },
    {
      role: 'user',
      content: `Write the article for this question: "${question}"

Plan:
${JSON.stringify(outline, null, 2)}

Research (cite by number, nothing else):
${researchDigest(research)}

Internal links you may use — each at most once, absolute URLs, natural anchor text:
${candidates}

The app link — at most ONE link to ${APP} in the whole article, and only where a reader would genuinely act on it (for example, when the article explains a way to start, share or publish work). If this article is not about starting, sharing or publishing work on GitSyn, omit it entirely. Never add it as an aside, a comparison or a courtesy mention:
${appLine}

Length: ${targetWords || '1,150 to 1,400'} words of body prose, excluding the FAQ. The quality gate rejects anything under 900 words. Count as you write; do not stop at one short paragraph per heading.

What the body must contain:
- The direct answer in the first paragraph, no heading above it.
- Every section from the plan, in order, with ## headings. Each section needs 150 to 220 words and at least one concrete detail, name, number or example from the research. If a section is thin, expand it with the research you already have; do not repeat the heading as a sentence.
- A short paragraph counts as unfinished work. Two or three developed paragraphs per section is normal.
- No number that is not in the research. This includes pixel dimensions, royalty percentages, fees and time windows; leave the figure out rather than guessing.
- The honest opinion and the limitation, written as normal prose inside the relevant sections.
- Citations [n] after factual claims. Every source used at least once.
- The internal post links, woven where they help the reader go deeper. If fewer than 3 candidate posts exist, use the ones that fit; never invent a post or a URL.
- No FAQ inside the body. No sources list. No title.

FAQ: 4 to 6 entries. Each answer 40 to 90 words, grounded in the research, with [n] where it makes a factual claim. Every answer must contain at least one [n]. If a question has no factual basis in the research, leave it out. Answer directly in your own voice; do not start answers with "The article says" or repeat source titles.

Return JSON only:
{
  "title": "the final title, 45-95 characters, no clickbait",
  "meta_title": "max 60 characters, includes the main phrase",
  "meta_description": "max 155 characters, says what the reader gets",
  "excerpt": "one or two sentences, max 220 characters",
  "body_md": "the full article in Markdown",
  "faq": [{ "question": "...?", "answer": "..." }],
  "opinion": "the exact sentence from the body that states the honest opinion",
  "limitation": "the exact sentence from the body that states the limitation",
  "hero_alt": "12-22 words describing a featured illustration literally, no 'image of'"
}`,
    },
  ];
}

function expandMessages({ draft, research, minWords = 900 }) {
  const current = String(draft.body_md || '').trim().split(/\s+/).filter(Boolean).length;
  return [
    {
      role: 'system',
      content: `You are deepening a short article for the GitSyn blog. You may only use facts, numbers, names and quotes that appear in the numbered research. Every digit you add must appear in that research exactly; do not add a dimension, percentage, fee or time window from general knowledge. Do not add a new source, statistic, study, quote, person or anecdote. Keep every heading, citation marker [n], internal link and app link exactly as it is. Do not add a conclusion or restate the opening. No bold labels such as **Concrete step:** or **Trade-off:**; write normal sentences. British English, plain prose, no emojis.`,
    },
    {
      role: 'user',
      content: `The article below is ${current} words; it needs at least ${minWords} words before the FAQ. Expand body_md to at least ${minWords + 150} words by developing each existing section. For each section add one or more of: a concrete step the reader can take, an example or detail from the research, a trade-off, or an explanation of why the step matters. Do not repeat the same point in different words, and do not pad with generic advice.

Research (cite by number, nothing else):
${researchDigest(research)}

Article to expand:
${JSON.stringify({
        body_md: draft.body_md,
        faq: draft.faq,
        opinion: draft.opinion,
        limitation: draft.limitation,
      }, null, 2)}

Return JSON only:
{
  "body_md": "the expanded article, same headings and links",
  "faq": [{ "question": "...?", "answer": "..." }],
  "opinion": "the exact sentence in the expanded body that states the honest opinion",
  "limitation": "the exact sentence in the expanded body that states the limitation"
}`,
    },
  ];
}

function humanizeMessages({ draft, question, minWords = 900 }) {
  const draftWords = String(draft.body_md || '').trim().split(/\s+/).filter(Boolean).length;
  const floor = Math.max(minWords, draftWords);
  return [
    {
      role: 'system',
      content: `You are a line editor with a good ear and no patience for machine prose. You are editing a draft for the GitSyn blog. You do not add facts, numbers, names, studies or links. You keep every citation marker [n] attached to the same claim.

What to fix:
- Rhythm. Make the sections uneven: some two paragraphs, some five. Mix sentence lengths, including a short one after a long one. Let one sentence stand alone where it lands.
- Remove any restated thesis at the end. The last section should end on a concrete point, a decision, or a caveat — not a summary of the opening.
- Remove these and anything like them: delve, testament to, in conclusion, it's important to note, in today's fast-paced world, when it comes to, at the end of the day, first and foremost, moreover, furthermore, seamless, robust, leverage, unlock, elevate, game-changer, tapestry, realm, embark, navigate the landscape.
- Remove fake friendliness, rhetorical questions used as transitions, and "Let's..." openers.
- Remove source narration: "the article says", "the guide notes", "according to [title]", and repeated source titles. State the advice directly and keep the [n] marker where the claim is. A source may be named once or twice if its experience is the point, never as a paragraph opener in section after section.
- Remove any claim that GitSyn has repositories, branches, commits, tags, forks or pull requests, and any Git commands presented as general creative advice. GitSyn is a project site, not a code host. Replace backup advice with dated copies or the platform's own version history.
- Remove upcoming-event details, retreat dates, ticket availability, waitlists and current prices.
- Remove bold labels such as **Concrete step:**, **Trade-off:**, **Tip:**, **Key takeaway:**, **Action:** and **Example:**. Turn each into a normal sentence.
- Never repeat a sentence verbatim. If a point is already made, cut the repeat.
- Prefer concrete verbs and named things over abstractions. Cut any sentence that only asserts importance.
- Keep the honest opinion and the limitation, and keep them specific. Do not soften them into balance-speak.
- Keep the FAQ questions. Polish the answers in the same voice.
- Length: return at least ${floor} words, never less than the draft (${draftWords} words). This is an edit, not a summary. If you cut a phrase, replace it with a sharper one of similar length. Do not compress sections or drop paragraphs. If the draft is already tight, leave it alone.

Return JSON only:
{
  "body_md": "the edited body, with the same headings and links",
  "faq": [{ "question": "...", "answer": "..." }],
  "opinion": "the exact sentence in the edited body that states the honest opinion",
  "limitation": "the exact sentence in the edited body that states the limitation",
  "notes": "one short line on what you changed"
}`,
    },
    {
      role: 'user',
      content: `Question the article answers: "${question}"

Draft to edit:
${JSON.stringify({
        title: draft.title,
        body_md: draft.body_md,
        faq: draft.faq,
        opinion: draft.opinion,
        limitation: draft.limitation,
      }, null, 2)}`,
    },
  ];
}

function repairNumbersMessages({ body, faq, metaDescription, numbers, opinion, limitation }) {
  return [
    {
      role: 'system',
      content: `You are a fact-checking line editor for the GitSyn blog. The article uses numbers that are not in its research: ${numbers.join(', ')}. Rewrite only the sentences that contain those numbers. Replace each offending figure with a qualitative description, or remove the figure, so the sentence stays true and useful. Do not add any new number, statistic, study, quote, name or anecdote. Keep every heading, citation marker [n], internal link, app link and paragraph in place. Keep the honest opinion and limitation. Keep the article within 5% of its current length. British English, plain prose.`,
    },
    {
      role: 'user',
      content: `Article:
${body}

FAQ:
${JSON.stringify(faq || [], null, 2)}

Meta description: ${metaDescription || ''}

The honest opinion sentence is: ${opinion || '(none)'}
The limitation sentence is: ${limitation || '(none)'}

If you rewrite either sentence, return the exact new sentence. Return JSON only:
{
  "body_md": "...",
  "meta_description": "...",
  "faq": [{ "question": "...?", "answer": "..." }],
  "opinion": "...",
  "limitation": "..."
}`,
    },
  ];
}

function repairLinksMessages({ body, candidates }) {
  return [
    {
      role: 'system',
      content: `You are editing one article for the GitSyn blog. Add the missing internal links without changing anything else. Keep every fact, number, citation marker, heading and paragraph exactly as it is; only insert or replace anchor text where a link genuinely helps the reader.

Return JSON only: { "body_md": "the full article with the links added" }`,
    },
    {
      role: 'user',
      content: `Add links to these published posts, each at most once, using absolute URLs:
${candidates.map((p) => `- ${SITE}/blog/${p.slug} — ${p.title}${p.excerpt ? `. ${p.excerpt}` : ''}`).join('\n')}

The article already has these links:
${(body.match(/\[[^\]]*\]\((?:https?:\/\/[^)\s]+|\/[^)\s]*)\)/g) || []).join('\n') || '(none)'}

Article:
${body}`,
    },
  ];
}

function altTextMessages({ title, thesis, intent }) {
  return [
    {
      role: 'system',
      content: 'You write alt text for editorial illustrations. Literal, specific, 12-22 words, no "image of", no "illustration of", no keyword stuffing.',
    },
    {
      role: 'user',
      content: `Article title: ${title}\nThesis: ${thesis || title}\nIntent: ${intent}\n\nReturn JSON only: { "alt": "..." }`,
    },
  ];
}

function heroPrompt({ title, thesis, intent }) {
  return [
    'Editorial illustration for an article on a calm, literary website.',
    `Article: "${title}".`,
    thesis ? `Idea: ${thesis}` : '',
    `Format: ${intent === 'compare' ? 'two or three related objects side by side, a comparison in shapes' : intent === 'how-to' ? 'a workbench or desk mid-task, tools arranged in a workable sequence' : 'one clear object that shows how the thing works'}.`,
    'Style: flat vector gouache, warm off-white paper (#FAF9F7), ink (#17151D), one violet accent (#6E56CF), soft grain, generous negative space, editorial magazine illustration.',
    'No text, no letters, no numbers, no logos, no faces, no hands, no people. Landscape 3:2 composition with room on the left for a title overlay.',
  ].filter(Boolean).join(' ');
}

function refillMessages({ count, existingQuestions, recentPosts, recentTopics }) {
  return [
    {
      role: 'system',
      content: `You plan the editorial calendar for GitSyn's blog. GitSyn is for people making creative work — writers, musicians, designers, illustrators, filmmakers, photographers, comic artists, podcasters, game developers, researchers, teachers and founders. The blog answers questions these people actually type into Google, ChatGPT or Perplexity.

Write real search questions, not content-marketing topics. A question is 8-18 words, starts the way a person starts a search ("How do I...", "Is ... worth it", "What is ...", "Why does ..."), and has one clear answer. No listicles, no "ultimate guide", no year in the question.

Avoid every question already in the queue and every topic covered by a recent post. Prefer questions a working creator would ask in the middle of a project, not at the start of a marketing funnel.

Return JSON only:
{
  "questions": [
    {
      "question": "...?",
      "intent": "explain" | "compare" | "how-to",
      "topic_key": "short-kebab-case-topic",
      "priority": 1-5,
      "notes": "one line on why this is worth answering"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Write ${count} questions.

Already queued or answered:
${existingQuestions.map((q) => `- ${q}`).join('\n') || '- none'}

Topics covered in the last 7 days (do not repeat):
${recentTopics.map((t) => `- ${t}`).join('\n') || '- none'}

Recently published posts:
${recentPosts.map((p) => `- ${p.title}`).join('\n') || '- none'}`,
    },
  ];
}

function gscQuestionsMessages({ count, clickedPosts, queries, existingQuestions }) {
  return [
    {
      role: 'system',
      content: `You plan follow-up articles for GitSyn's blog using Search Console data. You are given pages that already earn clicks and, when available, the queries behind them. Propose real questions a reader of those pages would ask next, or a closely related question with search demand that the page does not answer.

Each question is 8-18 words and reads like a search. Do not repeat existing questions or rephrase a published title. Prefer the question that turns one page view into a decision the reader can act on.

Return JSON only:
{
  "questions": [
    {
      "question": "...?",
      "intent": "explain" | "compare" | "how-to",
      "topic_key": "short-kebab-case-topic",
      "priority": 1-5,
      "notes": "which page and click data motivated this"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Write ${count} questions.

Pages earning clicks:
${clickedPosts.map((p) => `- ${p.title} (${p.clicks} clicks, ${p.impressions} impressions, average position ${p.position})`).join('\n') || '- none'}

Queries earning impressions:
${(queries || []).map((q) => `- "${q.query}" (${q.clicks} clicks, ${q.impressions} impressions, average position ${q.position})`).join('\n') || '- none'}

Questions already queued or answered:
${existingQuestions.map((q) => `- ${q}`).join('\n') || '- none'}`,
    },
  ];
}

const SITE_FACTS = [
  SITE_BRIEF,
  'There are 15 disciplines on GitSyn.',
  'GitSyn is free to use.',
  'Syn is GitSyn\'s built-in AI assistant; it is opt-in and AI involvement is labelled on posts.',
  'The blog is written by Abubakr Dukuray, the founder.',
].join(' ');

module.exports = {
  SITE_BRIEF,
  SITE_FACTS,
  HOUSE_RULES,
  systemWriter,
  researchDigest,
  outlineMessages,
  draftMessages,
  expandMessages,
  humanizeMessages,
  repairNumbersMessages,
  repairLinksMessages,
  altTextMessages,
  heroPrompt,
  refillMessages,
  gscQuestionsMessages,
};
