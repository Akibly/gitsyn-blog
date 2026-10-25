'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickCandidates, requiredInternalLinks, appTarget } = require('./links');

const posts = [
  { slug: 'serial-platforms', title: 'Where to post serial fiction', topic_key: 'serial-platforms', excerpt: 'Wattpad, Royal Road and Substack', published_at: '2026-10-01' },
  { slug: 'spotify', title: 'How to get music on Spotify', topic_key: 'spotify', excerpt: 'Distributors and release timing', published_at: '2026-10-10' },
  { slug: 'serial-buffer', title: 'How many chapters to bank', topic_key: 'serial-buffer', excerpt: 'A serial fiction buffer', published_at: '2026-10-12' },
];

test('candidates prefer topic overlap, then recency', () => {
  const picked = pickCandidates(posts, { topicKey: 'serial-fiction', title: 'How to share a novel chapter by chapter' });
  assert.equal(picked.length, 3);
  assert.ok(['serial-platforms', 'serial-buffer'].includes(picked[0].slug));
  assert.equal(picked[2].slug, 'spotify');
});

test('required links match how many posts exist', () => {
  const limits = { minInternalLinks: 3 };
  assert.equal(requiredInternalLinks(0, limits), 0);
  assert.equal(requiredInternalLinks(2, limits), 2);
  assert.equal(requiredInternalLinks(9, limits), 3);
});

test('the app target is the heaviest app link', () => {
  const target = appTarget([
    { url: 'https://gitsyn.cc/#how', label: 'How', kind: 'site', weight: 99 },
    { url: 'https://app.gitsyn.cc', label: 'Open GitSyn', kind: 'app', weight: 30 },
    { url: 'https://app.gitsyn.cc/new', label: 'New project', kind: 'app', weight: 5 },
  ]);
  assert.equal(target.url, 'https://app.gitsyn.cc');
});
