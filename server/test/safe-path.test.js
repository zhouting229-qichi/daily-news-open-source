import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveWebPath } from '../src/safe-path.js';

const WEB = '/srv/app/web';

test('root maps to index.html', () => {
  assert.equal(resolveWebPath(WEB, '/'), join(WEB, 'index.html'));
});

test('normal asset resolves inside web root', () => {
  assert.equal(resolveWebPath(WEB, '/app.js'), join(WEB, 'app.js'));
  assert.equal(resolveWebPath(WEB, '/sub/style.css'), join(WEB, 'sub', 'style.css'));
});

test('query string and fragment are stripped', () => {
  assert.equal(resolveWebPath(WEB, '/app.js?v=2#top'), join(WEB, 'app.js'));
});

test('path traversal with ../ is rejected', () => {
  assert.equal(resolveWebPath(WEB, '/../../etc/passwd'), null);
  assert.equal(resolveWebPath(WEB, '/sub/../../secret'), null);
});

test('URL-encoded traversal (%2e%2e) is rejected', () => {
  assert.equal(resolveWebPath(WEB, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('a sibling dir sharing the web-root prefix is rejected', () => {
  // /srv/app/web-secret must not be reachable from /srv/app/web
  assert.equal(resolveWebPath(WEB, '/../web-secret/key'), null);
});

test('malformed percent-encoding falls back to raw and stays safe', () => {
  // decodeURIComponent throws on '%'; raw path is kept and still resolves in-root
  assert.equal(resolveWebPath(WEB, '/100%.js'), join(WEB, '100%.js'));
});
