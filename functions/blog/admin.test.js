'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseItems } = require('./admin');

test('manual questions are cleaned, given a question mark and clamped', () => {
  const items = normaliseItems([
    'How do I price a logo design project',
    { question: 'Is Wattpad still worth it?', intent: 'compare', priority: 0, topic_key: '' },
    'short',
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].question, 'How do I price a logo design project?');
  assert.equal(items[0].priority, 3);
  assert.equal(items[1].intent, 'compare');
  assert.equal(items[1].priority, 1);
  assert.equal(items[1].topic_key, 'is-wattpad-still-worth-it');
});

test('a bare object is accepted as a single question', () => {
  const items = normaliseItems({ question: 'How do I share a rough cut?', intent: 'how-to' });
  assert.equal(items.length, 1);
  assert.equal(items[0].question, 'How do I share a rough cut?');
});
