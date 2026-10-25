'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  researchQuestion,
  canonicalUrl,
  mergeSources,
  hostOf,
  ResearchError,
} = require('./research');

function tavilyReply(results) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ results }),
  };
}

function result(url, title, score = 0.8) {
  return {
    url,
    title,
    content: `Snippet about ${title}. `.repeat(4),
    raw_content: `Full text about ${title}. It mentions 1,500 words and 2025. `.repeat(12),
    score,
  };
}

test('canonicalUrl keeps https, drops tracking and fragments', () => {
  assert.equal(
    canonicalUrl('https://example.com/a?utm_source=x&id=3#top'),
    'https://example.com/a?id=3'
  );
  assert.equal(canonicalUrl('http://example.com/a'), null);
  assert.equal(canonicalUrl('nope'), null);
});

test('hostOf normalises www', () => {
  assert.equal(hostOf('https://www.example.com/a'), 'example.com');
});

test('mergeSources dedupes URLs and caps each host at two', () => {
  const batch = [
    result('https://a.com/1', 'A1'),
    result('https://a.com/2', 'A2'),
    result('https://a.com/3', 'A3'),
    result('https://b.com/1', 'B1'),
    result('https://a.com/1?utm_source=x', 'A1 again'),
  ];
  const merged = mergeSources([batch], 6);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((source) => source.index), [1, 2, 3]);
  assert.equal(merged.filter((source) => hostOf(source.url) === 'a.com').length, 2);
});

test('researchQuestion keeps at least two sources and builds the fact corpus', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.query);
    if (body.query.includes('reddit')) {
      return tavilyReply([result('https://b.com/1', 'B1')]);
    }
    return tavilyReply([
      result('https://a.com/1', 'A1'),
      result('https://c.com/1', 'C1'),
    ]);
  };

  const research = await researchQuestion({
    question: 'How many chapters should I write first?',
    topicKey: 'serial-buffer',
    apiKey: 'test',
    fetchImpl: fakeFetch,
  });

  assert.equal(calls.length, 2);
  assert.ok(research.sources.length >= 2);
  assert.match(research.allowedText, /1,500/);
  assert.match(research.allowedText, /2025/);
  assert.ok(research.sources.every((source) => source.content.length <= 7000));
});

test('researchQuestion refuses thin research', async () => {
  const fakeFetch = async () => tavilyReply([result('https://a.com/1', 'Only one')]);
  await assert.rejects(
    () => researchQuestion({
      question: 'How do I share a song?',
      topicKey: 'song',
      apiKey: 'test',
      fetchImpl: fakeFetch,
    }),
    (error) => error instanceof ResearchError && /at least 2/.test(error.message)
  );
});
