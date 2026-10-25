'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reconcileProduction, assertDeploySafe, isBlogOwned } = require('./sync-live');

// Keep the unit tests off the real live-files manifest; the tests that care
// about it write their own.
const NONE = path.join(os.tmpdir(), 'no-such-manifest.txt');

const INDEX = '<html><body><a href="/terms">Terms</a><a href="/early-access">Early access</a><a href="/blog">Writing</a><link rel="stylesheet" href="/blog.css"></body></html>';

function fakeSite(files, { failOn = [] } = {}) {
  return async function fetchImpl(url) {
    const pathname = new URL(url).pathname;
    if (failOn.includes(pathname)) throw new Error('network down');
    const entry = files[pathname];
    if (!entry) return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '', arrayBuffer: async () => new Uint8Array() };
    const body = Buffer.from(entry.body);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? entry.type || 'text/html' : null) },
      text: async () => body.toString('utf8'),
      arrayBuffer: async () => body,
    };
  };
}

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sync-live-'));
}

function write(dir, rel, body) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

const LIVE = {
  '/': { body: INDEX },
  '/terms': { body: '<html><body>Terms</body></html>' },
  '/early-access': { body: '<html><body>Sign up early</body></html>' },
  '/robots.txt': { body: 'User-agent: *\nAllow: /\n', type: 'text/plain' },
  '/sitemap.xml': { body: '<urlset><url><loc>https://gitsyn.cc/</loc></url></urlset>', type: 'application/xml' },
  '/blog': { body: '<html><body>old blog</body></html>' },
  '/blog.css': { body: '.old { color: red }', type: 'text/css' },
};

test('a page that exists in production but not locally is copied down, so a deploy cannot delete it', async () => {
  const dir = scratchDir();
  write(dir, 'index.html', INDEX);
  write(dir, 'terms.html', '<html><body>Terms</body></html>');
  write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n');
  write(dir, 'sitemap.xml', LIVE['/sitemap.xml'].body);

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: fakeSite(LIVE), manifestPath: NONE });

  assert.deepEqual(result.restored.map((f) => f.path), ['early-access.html']);
  assert.equal(fs.readFileSync(path.join(dir, 'early-access.html'), 'utf8'), '<html><body>Sign up early</body></html>');
  assert.deepEqual(result.drift, []);
  await assertDeploySafe({ publicDir: dir, fetchImpl: fakeSite(LIVE), reconciled: result, manifestPath: NONE });
});

test('a local edit to a shared page blocks the deploy instead of shipping over production', async () => {
  const dir = scratchDir();
  write(dir, 'index.html', INDEX);
  write(dir, 'early-access.html', '<html><body>Sign up early</body></html>');
  write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n');
  write(dir, 'sitemap.xml', LIVE['/sitemap.xml'].body);
  write(dir, 'terms.html', '<html><body>Terms, rewritten locally</body></html>');

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: fakeSite(LIVE), manifestPath: NONE });
  assert.deepEqual(result.drift.map((f) => f.path), ['terms.html']);

  await assert.rejects(
    () => assertDeploySafe({ publicDir: dir, fetchImpl: fakeSite(LIVE), reconciled: result, manifestPath: NONE }),
    /deploy blocked[\s\S]*\/terms: differs from production/
  );
});

test('the blog may add its own lines to robots, the sitemap and llms.txt, but not remove live ones', async () => {
  const dir = scratchDir();
  for (const [rel, body] of Object.entries({
    'index.html': INDEX,
    'terms.html': '<html><body>Terms</body></html>',
    'early-access.html': '<html><body>Sign up early</body></html>',
    'sitemap.xml': LIVE['/sitemap.xml'].body,
  })) write(dir, rel, body);
  write(dir, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://gitsyn.cc/blog-sitemap.xml\n');

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: fakeSite(LIVE), manifestPath: NONE });
  await assertDeploySafe({ publicDir: dir, fetchImpl: fakeSite(LIVE), reconciled: result, manifestPath: NONE });

  write(dir, 'robots.txt', 'Sitemap: https://gitsyn.cc/blog-sitemap.xml\n');
  const lost = await reconcileProduction({ publicDir: dir, fetchImpl: fakeSite(LIVE), manifestPath: NONE });
  await assert.rejects(
    () => assertDeploySafe({ publicDir: dir, fetchImpl: fakeSite(LIVE), reconciled: lost }),
    /would drop 2 live line/
  );
});

test('blog-owned files are regenerated locally, so production\'s copy is never treated as drift', async () => {
  const dir = scratchDir();
  write(dir, 'index.html', INDEX);
  write(dir, 'terms.html', '<html><body>Terms</body></html>');
  write(dir, 'early-access.html', '<html><body>Sign up early</body></html>');
  write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n');
  write(dir, 'sitemap.xml', LIVE['/sitemap.xml'].body);
  write(dir, 'blog.css', '.new { color: blue }');
  write(dir, 'blog/index.html', '<html><body>fresh blog</body></html>');

  assert.equal(isBlogOwned('blog.css'), true);
  assert.equal(isBlogOwned(path.join('blog', 'a-post', 'index.html')), true);
  assert.equal(isBlogOwned('terms.html'), false);

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: fakeSite(LIVE), manifestPath: NONE });
  assert.deepEqual(result.drift, []);
  assert.equal(fs.readFileSync(path.join(dir, 'blog.css'), 'utf8'), '.new { color: blue }');
});

test('a production file that cannot be read blocks the deploy rather than risking a deletion', async () => {
  const dir = scratchDir();
  write(dir, 'index.html', INDEX);
  write(dir, 'terms.html', '<html><body>Terms</body></html>');
  write(dir, 'early-access.html', '<html><body>Sign up early</body></html>');
  write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n');
  write(dir, 'sitemap.xml', LIVE['/sitemap.xml'].body);

  const fetchImpl = fakeSite(LIVE, { failOn: ['/terms'] });
  const result = await reconcileProduction({ publicDir: dir, fetchImpl, manifestPath: NONE });
  assert.deepEqual(result.unreachable.map((f) => f.path), ['/terms']);
  await assert.rejects(
    () => assertDeploySafe({ publicDir: dir, fetchImpl, reconciled: result }),
    /could not be read from production/
  );
});

test('robots and the sitemap are seeded even though no page links to them', async () => {
  const dir = scratchDir();
  const site = fakeSite({
    '/': { body: '<html><body>plain</body></html>' },
    '/robots.txt': { body: 'User-agent: *\n', type: 'text/plain' },
    '/sitemap.xml': { body: '<urlset/>', type: 'application/xml' },
  });

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: site, manifestPath: NONE });

  assert.deepEqual(result.restored.map((f) => f.path).sort(), ['index.html', 'robots.txt', 'sitemap.xml']);
});

test('a live file that nothing links to is still restored because the manifest names it', async () => {
  const dir = scratchDir();
  const manifest = path.join(scratchDir(), 'live-files.txt');
  fs.writeFileSync(manifest, '# one path per line\nposter.html\nimages/og-card.png\n\n');
  const site = fakeSite({
    '/': { body: '<html><body>nothing links to the promo page</body></html>' },
    '/poster.html': { body: '<html><body>Promo</body></html>' },
    '/images/og-card.png': { body: 'PNG', type: 'image/png' },
  });

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: site, manifestPath: manifest });

  assert.deepEqual(result.restored.map((f) => f.path).sort(), ['images/og-card.png', 'index.html', 'poster.html']);
  await assertDeploySafe({ publicDir: dir, fetchImpl: site, reconciled: result, manifestPath: manifest });
});

test('og:image and srcset references are followed, not only href and src', async () => {
  const dir = scratchDir();
  const site = fakeSite({
    '/': {
      body: '<html><head><meta property="og:image" content="/images/og-card.png"></head>'
        + '<body><img srcset="/images/app.png 1x, /images/app@2x.png 2x" src="/images/app.png">'
        + '<meta name="description" content="A home for creative work"></body></html>',
    },
    '/images/og-card.png': { body: 'OG', type: 'image/png' },
    '/images/app.png': { body: 'APP', type: 'image/png' },
    '/images/app@2x.png': { body: 'APP2', type: 'image/png' },
  });

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: site, manifestPath: NONE });

  assert.deepEqual(result.restored.map((f) => f.path).sort(), ['images/app.png', 'images/app@2x.png', 'images/og-card.png', 'index.html']);
});

test('an asset only the blog links to is seeded from the blog pages themselves', async () => {
  const dir = scratchDir();
  write(dir, 'blog/index.html', '<html><body><img src="/images/author-abubakr.png" alt=""></body></html>');
  const site = fakeSite({
    '/': { body: '<html><body>the walk never reads /blog</body></html>' },
    '/images/author-abubakr.png': { body: 'PHOTO', type: 'image/png' },
  });

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: site, manifestPath: NONE });

  assert.deepEqual(result.restored.map((f) => f.path).sort(), ['images/author-abubakr.png', 'index.html']);
});

test('url() in a stylesheet is resolved against the stylesheet, not the page', async () => {
  const dir = scratchDir();
  const site = fakeSite({
    '/': { body: '<html><head><link rel="stylesheet" href="/theme.css"></head><body></body></html>' },
    '/theme.css': { body: '.hero{background:url("images/feature.png")}.x{background:url(/fonts/a.woff)}', type: 'text/css' },
    '/images/feature.png': { body: 'F', type: 'image/png' },
    '/fonts/a.woff': { body: 'W', type: 'font/woff' },
  });

  const result = await reconcileProduction({ publicDir: dir, fetchImpl: site, manifestPath: NONE });

  assert.deepEqual(result.restored.map((f) => f.path).sort(), ['fonts/a.woff', 'images/feature.png', 'index.html', 'theme.css']);
});
