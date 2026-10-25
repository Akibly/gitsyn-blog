'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseGscCsv, aggregatePages, topQueries, blogSlug } = require('./gsc');

test('CSV parser handles quotes, commas and newlines', () => {
  const rows = parseCsv('a,b\n"x, y",2\n"line\nbreak",3\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', '2'], ['line\nbreak', '3']]);
});

test('a Pages export is recognised by its headers', () => {
  const csv = [
    'Top pages,Clicks,Impressions,CTR,Position',
    '"https://gitsyn.cc/blog/one",12,300,4%,8.2',
    '"https://gitsyn.cc/blog/one",3,100,3%,9.1',
    '"https://gitsyn.cc/",99,1000,9.9%,2',
  ].join('\n');
  const parsed = parseGscCsv(csv);
  assert.equal(parsed.kind, 'pages');
  assert.equal(parsed.pages.length, 3);
  assert.equal(parsed.pages[0].clicks, 12);
  assert.equal(parsed.queries.length, 0);
});

test('a Queries export is recognised by its headers', () => {
  const csv = [
    'Top queries,Clicks,Impressions,CTR,Position',
    '"how to share a novel",4,200,2%,11.5',
    '"serial fiction platform",1,50,2%,14',
  ].join('\n');
  const parsed = parseGscCsv(csv);
  assert.equal(parsed.kind, 'queries');
  assert.equal(parsed.queries.length, 2);
  assert.equal(parsed.queries[0].query, 'how to share a novel');
});

test('a CSV with neither tab is rejected with a useful message', () => {
  assert.throws(() => parseGscCsv('Date,Clicks\n2026-10-01,2\n'), /no page or query column/i);
});

test('blog URLs map to slugs and other URLs do not', () => {
  assert.equal(blogSlug('https://gitsyn.cc/blog/serial-fiction?utm_source=x'), 'serial-fiction');
  assert.equal(blogSlug('https://www.gitsyn.cc/blog/one/'), 'one');
  assert.equal(blogSlug('https://gitsyn.cc/about'), null);
  assert.equal(blogSlug('https://app.gitsyn.cc/blog/one'), null);
  assert.equal(blogSlug('not a url'), null);
});

test('pages aggregate per slug with impression-weighted position', () => {
  const posts = new Map([['one', { title: 'One post' }]]);
  const aggregated = aggregatePages([
    { page: 'https://gitsyn.cc/blog/one', clicks: 12, impressions: 300, position: 8.2 },
    { page: 'https://gitsyn.cc/blog/one', clicks: 3, impressions: 100, position: 9.1 },
    { page: 'https://gitsyn.cc/blog/two', clicks: 20, impressions: 500, position: 5 },
    { page: 'https://gitsyn.cc/', clicks: 999, impressions: 5000, position: 1 },
  ], posts);
  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[0].slug, 'two');
  assert.equal(aggregated[0].clicks, 20);
  const one = aggregated.find((row) => row.slug === 'one');
  assert.equal(one.clicks, 15);
  assert.equal(one.impressions, 400);
  assert.equal(one.position, 8.4);
  assert.equal(one.title, 'One post');
});

test('topQueries ranks by clicks then impressions', () => {
  const rows = topQueries([
    { query: 'a', clicks: 1, impressions: 100, position: 4 },
    { query: 'b', clicks: 5, impressions: 20, position: 9 },
    { query: 'c', clicks: 1, impressions: 200, position: 7 },
  ]);
  assert.deepEqual(rows.map((row) => row.query), ['b', 'c', 'a']);
});
