'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/sample-post');
const { checkPost, checkVoice } = require('./quality');

function base() {
  return structuredClone(fixture.post);
}

function ctx(extra = {}) {
  return {
    minWords: 900,
    availablePosts: 3,
    publishedSlugs: new Set(fixture.publishedSlugs),
    existingPosts: [],
    allowedText: fixture.allowedText,
    duplicateThreshold: 0.3,
    requireOpinion: true,
    ...extra,
  };
}

function codes(result) {
  return result.failures.map((failure) => failure.code);
}

test('the reviewed sample passes the gate', () => {
  const result = checkPost(base(), ctx());
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.ok(result.stats.words >= 900);
  assert.equal(result.stats.internalLinks, 3);
  assert.equal(result.stats.appLinks, 1);
});

test('under 900 words is rejected', () => {
  const post = base();
  post.body_md = post.body_md.slice(0, 2500);
  const result = checkPost(post, ctx({ requireOpinion: false }));
  assert.ok(codes(result).includes('too-short'));
});

test('an opinion reworded by the prose cleanup still counts as present', () => {
  const post = base();
  post.body_md = post.body_md.replace(
    'A reliable weekly chapter on an imperfect platform beats a sporadic masterpiece on the perfect one.',
    'A reliable weekly chapter on an imperfect platform is better than a sporadic masterpiece on a perfect one.'
  );
  const result = checkPost(post, ctx());
  assert.ok(!codes(result).includes('missing-opinion'), JSON.stringify(result.failures));
});

test('an opinion the article never states is rejected', () => {
  const post = base();
  post.body_md = post.body_md.replace(
    'A reliable weekly chapter on an imperfect platform beats a sporadic masterpiece on the perfect one.',
    'Consistency is the part that decides whether anyone keeps reading.'
  );
  const result = checkPost(post, ctx());
  assert.ok(codes(result).includes('missing-opinion'));
});

test('placeholder text is rejected', () => {
  const post = base();
  post.body_md += '\n\n[TODO: add source]\n';
  assert.ok(codes(checkPost(post, ctx())).includes('placeholder'));
});

test('a number that is not in the research is rejected', () => {
  const post = base();
  post.body_md = post.body_md.replace('a three-week runway', 'a 37-day runway');
  assert.ok(codes(checkPost(post, ctx())).includes('invented-numbers'));
});

test('a duplicate of a published post is rejected', () => {
  const post = base();
  const result = checkPost(post, ctx({
    existingPosts: [{ slug: 'earlier-post', topic_key: 'other', body_md: fixture.post.body_md }],
  }));
  assert.ok(codes(result).includes('duplicate'));
});

test('the honest opinion and limitation must be in the prose', () => {
  const noOpinion = base();
  noOpinion.opinion = '';
  assert.ok(codes(checkPost(noOpinion, ctx())).includes('missing-opinion'));

  const noLimitation = base();
  noLimitation.limitation = '';
  assert.ok(codes(checkPost(noLimitation, ctx())).includes('missing-limitation'));

  const notPresent = base();
  notPresent.opinion = 'The moon is made of cheese and that is my firm view.';
  assert.ok(codes(checkPost(notPresent, ctx())).includes('missing-opinion'));
});

test('more than one app link is rejected', () => {
  const post = base();
  post.body_md += '\n\nSee [the project page](https://app.gitsyn.cc/projects) too.\n';
  assert.ok(codes(checkPost(post, ctx())).includes('too-many-app-links'));
});

test('too few links to published posts is rejected', () => {
  const post = base();
  post.body_md = post.body_md.replace(/\[([^\]]*)\]\(https:\/\/gitsyn\.cc\/blog\/reader-list\)/g, '$1');
  const result = checkPost(post, ctx());
  assert.ok(codes(result).includes('too-few-post-links'));
});

test('a link to a post that does not exist is rejected', () => {
  const result = checkPost(base(), ctx({ publishedSlugs: new Set(['serial-platforms']) }));
  assert.ok(codes(result).includes('unknown-internal-link'));
});

test('meta lengths, citations, sources and FAQ are enforced', () => {
  const longMeta = base();
  longMeta.meta_title = 'x'.repeat(61);
  assert.ok(codes(checkPost(longMeta, ctx())).includes('bad-meta-title'));

  const longDescription = base();
  longDescription.meta_description = 'y'.repeat(156);
  assert.ok(codes(checkPost(longDescription, ctx())).includes('bad-meta-description'));

  const badCitation = base();
  badCitation.body_md += '\n\nA claim without a source [9].\n';
  assert.ok(codes(checkPost(badCitation, ctx())).includes('bad-citation'));

  const oneSource = base();
  oneSource.sources = oneSource.sources.slice(0, 1);
  assert.ok(codes(checkPost(oneSource, ctx())).includes('too-few-sources'));

  const thinFaq = base();
  thinFaq.faq = thinFaq.faq.slice(0, 2);
  assert.ok(codes(checkPost(thinFaq, ctx())).includes('thin-faq'));
});

test('banned phrases and bad alt text are rejected', () => {
  const post = base();
  post.body_md += '\n\nIn conclusion, keep going.\n';
  assert.ok(codes(checkPost(post, ctx())).includes('banned-phrase'));

  const shortAlt = base();
  shortAlt.hero_image_alt = 'Desk';
  assert.ok(codes(checkPost(shortAlt, ctx())).includes('bad-alt'));
});

test('a FAQ answer without a citation is rejected', () => {
  const post = base();
  post.faq[0].answer = 'This answer sounds plausible but points at nothing in particular.';
  assert.ok(codes(checkPost(post, ctx())).includes('faq-uncited'));
});

test('voice checks catch source narration and invented Git features', () => {
  const narrated = 'The Wix article notes that teasers work. The Writing blog advises a private link. WIP Home reminds creators to back up.';
  const narration = [...checkVoice(narrated).failures, ...checkVoice(narrated).warnings];
  assert.ok(narration.some((issue) => issue.code === 'source-narration'));

  const product = 'Keep the draft safe in a private GitSyn repository.';
  assert.ok(checkVoice(product).failures.some((issue) => issue.code === 'product-claim'));

  const clean = 'Save a dated copy before you share the link. Tell reviewers which parts you want comments on.';
  assert.equal(checkVoice(clean).failures.length, 0);
});

test('curly quotes and en dashes survive the gate', () => {
  assert.ok(fixture.post.body_md.includes('–'));
  assert.ok(fixture.post.body_md.includes('“') || fixture.post.body_md.includes('"'));
  assert.ok(fixture.post.faq.length >= 3);
});
