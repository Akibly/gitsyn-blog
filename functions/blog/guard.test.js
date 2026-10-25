'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorized, previewToken, verifyPreviewToken } = require('./guard');

function request(headers = {}, query = {}) {
  return {
    headers,
    query,
    get(name) {
      return headers[name.toLowerCase()] || '';
    },
  };
}

test('the cron secret can arrive as a bearer token, a header or a query key', () => {
  assert.equal(authorized(request({ authorization: 'Bearer s3cret' }), 's3cret'), true);
  assert.equal(authorized(request({ 'x-cron-secret': 's3cret' }), 's3cret'), true);
  assert.equal(authorized(request({}, { key: 's3cret' }), 's3cret'), true);
});

test('wrong or missing secrets are rejected', () => {
  assert.equal(authorized(request({ authorization: 'Bearer nope' }), 's3cret'), false);
  assert.equal(authorized(request(), 's3cret'), false);
  assert.equal(authorized(request({ authorization: 'Bearer s3cret' }), ''), false);
  assert.equal(authorized(request({ authorization: 'Bearer s3cret' }), 's3cret '), false);
});

test('preview tokens are tied to the slug and the secret', () => {
  const token = previewToken('a-post', 's3cret');
  assert.equal(token.length, 32);
  assert.equal(verifyPreviewToken('a-post', token, 's3cret'), true);
  assert.equal(verifyPreviewToken('another-post', token, 's3cret'), false);
  assert.equal(verifyPreviewToken('a-post', token, 'other-secret'), false);
  assert.equal(verifyPreviewToken('a-post', '', 's3cret'), false);
  assert.equal(previewToken('a-post', 's3cret'), token);
});
