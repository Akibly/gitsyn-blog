'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanBody,
  cleanClaim,
  deNarrate,
  placeClaim,
  isProviderLimit,
  isEnvironmentFault,
  dropTrailingRepeat,
  normaliseFaq,
  pickMetaTitle,
  pickMetaDescription,
  normaliseQuestionItem,
  questionKey,
} = require('./pipeline');
const { containsPhrase, claimPresent } = require('./text');

test('cleanBody removes a leading H1 and a trailing FAQ or sources section', () => {
  const md = '# The title\n\nIntro paragraph.\n\n## A section\n\nText.\n\n## FAQ\n\n### Q?\n\nAnswer.\n\n## Sources\n\n- [1] x';
  assert.equal(cleanBody(md), 'Intro paragraph.\n\n## A section\n\nText.');
});

test('cleanBody leaves a normal article intact', () => {
  const md = 'Intro.\n\n## Section\n\nText [1].';
  assert.equal(cleanBody(md), md);
});

test('cleanBody strips appended FAQ JSON, meta copy and bold step labels', () => {
  const md = 'Intro paragraph.\n\n## Section\n\n**Concrete step:** do the thing.\n\nFAQ:\n[{"question":"Q?"}]\n\nMeta description: x';
  assert.equal(cleanBody(md), 'Intro paragraph.\n\n## Section\n\nDo the thing.');
});

test('cleanBody normalises non-breaking hyphens and spaces from model output', () => {
  const md = 'A role\u2011aware\u00a0process.';
  assert.equal(cleanBody(md), 'A role-aware process.');
});

test('a trailing repeat is dropped only when the phrase also appears earlier', () => {
  const phrase = 'Free plans often cap storage, so a growing show may outgrow the tier.';
  const withRepeat = `## Grow\n\n${phrase}\n\nMore text.\n\n${phrase}`;
  assert.equal(dropTrailingRepeat(withRepeat, phrase), `## Grow\n\n${phrase}\n\nMore text.`);
  const onlyOnce = `Text.\n\n${phrase}`;
  assert.equal(dropTrailingRepeat(onlyOnce, phrase), onlyOnce);
});

test('claim cleanup removes attribution the same way the body was cleaned', () => {
  const claim = 'The WIP Home site reminds creators that serial platforms cap chapter length.';
  assert.equal(cleanClaim(claim), 'Serial platforms cap chapter length.');
});

test('a claim stated in different words is still found in the body', () => {
  const body = '## Limits\n\nMost free serial platforms cap how long a chapter can run, and none of them give you reader analytics.';
  const claim = 'Free serial platforms cap chapter length and give no reader analytics.';
  assert.ok(!containsPhrase(body, claim, 5));
  assert.ok(claimPresent(body, claim));
});

test('placeClaim keeps the body when the prose already carries the claim', () => {
  const body = '## Limits\n\nMost free serial platforms cap how long a chapter can run, and none of them give you reader analytics.';
  const claim = 'Free serial platforms cap chapter length and give no reader analytics.';
  const notes = [];
  const placed = placeClaim(body, { preferred: claim, fallback: '', label: 'Limitation', notes });
  assert.equal(placed.body, body);
  assert.equal(placed.text, claim);
  assert.deepEqual(notes, []);
});

test('placeClaim closes the article with a claim the prose never carried', () => {
  const body = '## Where\n\nYou can post the first three chapters on any serial host.';
  const notes = [];
  const placed = placeClaim(body, { preferred: 'Serial hosts rarely pay out before you reach 50k reads.', fallback: '', label: 'Limitation', notes });
  assert.equal(placed.body, `${body}\n\nSerial hosts rarely pay out before you reach 50k reads.`);
  assert.ok(notes[0].startsWith('Limitation was not in the prose'));
});

test('placeClaim falls back to the draft wording when only that is in the body', () => {
  const body = '## Risk\n\nPosting early invites copycats who never read past the free chapter.';
  const notes = [];
  const placed = placeClaim(body, {
    preferred: 'Early exposure invites plagiarism from readers who skim the free chapter.',
    fallback: 'Posting early invites copycats who never read past the free chapter.',
    label: 'Opinion',
    notes,
  });
  assert.equal(placed.body, body);
  assert.equal(placed.text, 'Posting early invites copycats who never read past the free chapter.');
});

test('placeClaim gives up when no wording exists to place', () => {
  const placed = placeClaim('Some body text.', { preferred: '', fallback: '', label: 'Opinion', notes: [] });
  assert.equal(placed.text, '');
  assert.equal(placed.body, 'Some body text.');
});

test('provider limits send the question back to the queue', () => {
  const groqDaily = 'groq 429: {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 197825"}}';
  assert.ok(isProviderLimit(groqDaily));
  assert.ok(isProviderLimit('groq 429: Rate limit reached for model `x` on tokens per minute (TPM): Limit 8000'));
  assert.ok(!isProviderLimit('outline: Draft has no title.'));
  assert.ok(!isProviderLimit('humanize: Humanize pass failed: Humanize attempt 2 returned 816 words.'));
});

test('a missing key or a dead search API is not the question\'s fault', () => {
  assert.ok(isEnvironmentFault('research: GROQ_API_KEY is not set.'));
  assert.ok(isEnvironmentFault('research: Tavily 432: Too many requests'));
  assert.ok(isEnvironmentFault('groq 429: Rate limit reached on tokens per day (TPD): Limit 200000'));
});

test('a question with nothing to cite is still a real failure', () => {
  assert.ok(!isEnvironmentFault('research: Only 0 usable sources found; at least 2 are needed.'));
  assert.ok(!isEnvironmentFault('outline: Draft has no title.'));
});

test('FAQ normalisation accepts aliases and drops incomplete rows', () => {
  const faq = normaliseFaq([
    { question: 'Why?', answer: 'Because.' },
    { q: 'How?', a: 'Like this.' },
    { question: 'No answer?' },
    null,
  ]);
  assert.equal(faq.length, 2);
  assert.equal(faq[1].question, 'How?');
});

test('meta title and description are trimmed to the limits', () => {
  assert.equal(pickMetaTitle('A good title for the post', 'Fallback'), 'A good title for the post');
  assert.ok(pickMetaTitle('x'.repeat(90), 'A sensible fallback title').length <= 60);
  const description = pickMetaDescription('', 'This excerpt explains what the reader gets from the article in one clear sentence.', 'Title');
  assert.ok(description.length <= 155);
  assert.ok(description.length >= 30);
});

test('a filler meta description falls back to the excerpt', () => {
  const description = pickMetaDescription(
    'Learn practical steps to publish drafts and protect your work.',
    'Publishing drafts on the right platform builds a community while protecting the finished piece.',
    'Sharing Work in Progress'
  );
  assert.match(description, /^Publishing drafts/);
});

test('question normalisation adds a question mark, fixes intent and clamps priority', () => {
  const item = normaliseQuestionItem(
    { question: 'How do I price freelance design work', intent: 'nonsense', priority: 99 },
    new Set(),
    new Set(),
    new Set(),
    new Set()
  );
  assert.equal(item.question, 'How do I price freelance design work?');
  assert.equal(item.intent, 'how-to');
  assert.equal(item.priority, 5);
  assert.equal(item.topic_key, 'how-do-i-price-freelance-design-work');
});

test('question normalisation refuses duplicates and repeats of existing topics', () => {
  const existingKeys = new Set([questionKey('How do I price design work?')]);
  const batchKeys = new Set();
  const batchTopics = new Set();
  const duplicate = normaliseQuestionItem(
    { question: 'How do I price design work?' },
    existingKeys,
    new Set(),
    batchKeys,
    batchTopics
  );
  assert.equal(duplicate, null);

  const existingTopics = new Set(['design-pricing']);
  const repeatedTopic = normaliseQuestionItem(
    { question: 'What should I charge for a logo?', topic_key: 'design-pricing' },
    new Set(),
    existingTopics,
    new Set(),
    new Set()
  );
  assert.equal(repeatedTopic, null);
});

test('question normalisation enforces length', () => {
  const keys = new Set();
  assert.equal(normaliseQuestionItem({ question: 'Why?' }, keys, new Set(), new Set(), new Set()), null);
  assert.equal(normaliseQuestionItem({ question: 'x'.repeat(241) }, keys, new Set(), new Set(), new Set()), null);
});

test('deNarrate turns a named source into advice the reader can act on', () => {
  assert.equal(
    deNarrate('The guide advises narrowing your focus to one area [2].'),
    'Narrow your focus to one area [2].'
  );
  assert.equal(
    deNarrate('The article notes that a niche portfolio converts better.'),
    'A niche portfolio converts better.'
  );
  assert.equal(
    deNarrate('The Ironhack article outlines this structure and recommends keeping each section concise.'),
    'Keep each section concise.'
  );
});

test('deNarrate removes an audience instead of leaving it as the subject', () => {
  assert.equal(
    deNarrate('The WIP Home site reminds creators that a private link is enough.'),
    'A private link is enough.'
  );
});

test('deNarrate keeps a sentence whose subject was the source, not its opinion', () => {
  const product = 'RSS.com focuses on a four-step launch, whereas Podbean adds a mobile recording app to its free plan.';
  assert.equal(deNarrate(product), product);
  const twoVerbs = 'Todd Henry stresses that specific recommendations help and points to the first paragraph.';
  assert.equal(deNarrate(twoVerbs), twoVerbs);
  const stub = 'The article notes that everything is fine.';
  assert.equal(deNarrate(stub), stub);
});

test('deNarrate leaves a sentence that already opens with its own advice', () => {
  const own = 'Publishing weekly keeps the algorithm warm.';
  assert.equal(deNarrate(own), own);
});

test('deNarrate keeps a sentence whose subject was a gerund, not an instruction', () => {
  const subject =
    'The guide notes that having an email list would have given them an initial group of buyers [1].';
  assert.equal(deNarrate(subject), subject);
});
