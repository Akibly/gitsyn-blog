'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slugify,
  uniqueSlug,
  wordCount,
  readingMinutes,
  countLinks,
  countCitationMarkers,
  trimToLength,
  numericClaims,
  numericCorpus,
  findBannedPhrases,
  findPlaceholders,
  sectionLengths,
  containsPhrase,
  shingleSet,
  jaccard,
  similarity,
  escapeHtml,
} = require('./text');

test('slugify strips punctuation, accents and filler', () => {
  assert.equal(slugify('How do I share my novel chapter by chapter?'), 'how-do-i-share-my-novel-chapter-by-chapter');
  assert.equal(slugify('Café & Crème: a guide'), 'cafe-and-creme-a-guide');
  assert.equal(slugify('   '), 'post');
  assert.ok(slugify('x'.repeat(120)).length <= 70);
});

test('uniqueSlug adds a counter only when needed', () => {
  assert.equal(uniqueSlug('a-post', new Set()), 'a-post');
  assert.equal(uniqueSlug('a-post', new Set(['a-post'])), 'a-post-2');
  assert.equal(uniqueSlug('a-post', new Set(['a-post', 'a-post-2'])), 'a-post-3');
});

test('wordCount ignores markdown furniture', () => {
  const md = '# Title\n\n## Heading\n\nOne two three four five. [six](https://example.com) `seven` [1]\n\n- eight\n- nine';
  assert.equal(wordCount(md), 8);
  assert.equal(readingMinutes(1100), 5);
});

test('countLinks separates post, app, site and external links', () => {
  const md = [
    '[a](https://gitsyn.cc/blog/one)',
    '[b](https://gitsyn.cc/blog/two)',
    '[c](https://gitsyn.cc/blog/one)',
    '[app](https://app.gitsyn.cc)',
    '[home](https://gitsyn.cc/#how)',
    '[source](https://example.com/x)',
  ].join(' ');
  const links = countLinks(md);
  assert.equal(links.internalPosts, 2);
  assert.equal(links.app, 1);
  assert.equal(links.site, 1);
  assert.equal(links.external, 1);
});

test('citation markers are found once each, in order', () => {
  assert.deepEqual(countCitationMarkers('A [2] b [1] c [2] d'), [1, 2]);
});

test('trimToLength cuts at a word boundary', () => {
  assert.equal(trimToLength('one two three four', 13), 'one two three');
  assert.equal(trimToLength('short', 20), 'short');
});

test('numeric claims ignore list numbers and one-digit prose', () => {
  const claims = numericClaims('## 3 steps\n\n1. Do it in 1,500 words, about 40% of the time, for $20.\n2. 2025');
  assert.ok(claims.includes('1500'));
  assert.ok(claims.includes('40%'));
  assert.ok(claims.includes('20'));
  assert.ok(claims.includes('2025'));
  assert.ok(!claims.includes('3'));
  const corpus = numericCorpus('It took 1500 words and 40% of 2025.');
  assert.ok(corpus.has('1500'));
  assert.ok(corpus.has('40%'));
  assert.ok(corpus.has('2025'));
});

test('banned phrase detection and placeholders', () => {
  const found = findBannedPhrases('In conclusion, this is a testament to the craft. Let us delve in. Great question.');
  assert.equal(found.hard.length, 3);
  assert.equal(found.fakeFriendly.length, 1);
  assert.ok(findPlaceholders('Text [TODO: source]').length >= 1);
  assert.ok(findPlaceholders('{{title}}').length >= 1);
  assert.equal(findPlaceholders('A clean paragraph.').length, 0);
});

test('section lengths and phrase presence', () => {
  const md = 'Intro one two.\n\n## A\nOne two three four five.\n\n## B\nOne.\n';
  const sections = sectionLengths(md);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].heading, '(intro)');
  assert.ok(containsPhrase('The buffer is what makes the schedule hold.', 'The buffer is what makes the schedule', 3));
  assert.ok(containsPhrase('The buffer is what makes the schedule hold.', 'buffer what makes', 3));
  assert.ok(!containsPhrase('Something unrelated entirely.', 'A buffer is what makes it hold', 3));
});

test('similarity catches near duplicates', () => {
  const a = 'Serial fiction rewards a chapter buffer and a fixed weekly schedule, not a perfect platform.';
  const b = 'Serial fiction rewards a chapter buffer and a fixed weekly schedule, not a perfect platform.';
  assert.equal(jaccard(shingleSet(a), shingleSet(b)), 1);
  assert.ok(similarity(a, 'A completely different sentence about music release schedules.') < 0.2);
});

test('escapeHtml closes the obvious holes', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
