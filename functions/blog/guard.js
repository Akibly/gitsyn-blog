'use strict';

const crypto = require('node:crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function header(req, name) {
  if (typeof req.get === 'function') return req.get(name) || '';
  return (req.headers && (req.headers[name.toLowerCase()] || req.headers[name])) || '';
}

function bearer(req) {
  const value = header(req, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

/** The admin API accepts the secret as a bearer token, an x-cron-secret header,
 *  or ?key= for quick curl checks. Comparison is constant-time. */
function authorized(req, secret) {
  if (!secret) return false;
  const query = req.query && (req.query.key || req.query.secret);
  return safeEqual(bearer(req), secret)
    || safeEqual(header(req, 'x-cron-secret'), secret)
    || safeEqual(query, secret);
}

function previewToken(slug, secret) {
  if (!secret) throw new Error('CRON_SECRET is not set.');
  return crypto.createHmac('sha256', secret).update(`blog-preview:${slug}`).digest('hex').slice(0, 32);
}

function verifyPreviewToken(slug, token, secret) {
  if (!slug || !token || !secret) return false;
  return safeEqual(token, previewToken(slug, secret));
}

module.exports = { authorized, previewToken, verifyPreviewToken, safeEqual, bearer };
